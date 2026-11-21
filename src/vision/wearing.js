// Vision for a photo of a person wearing an outfit: find the body bands (top / bottom / shoes / layer)
// and read their colors, all on-device, no AI. Pure (no DOM): runs in Node and browsers. Never throws.
// Contract: see ARCHITECTURE.md "Fit check".
//
//   analyzeWearing(imageData, { guide }) ->
//     { ok:true,  person:{x,y,w,h}, bands:{ top, bottom, shoes, layer? }, skin:{hex}|null, guide, whitePoint }
//     { ok:false, reason, bands:{} }
//   band = { box:{x,y,w,h}, colors:[{hex,family,weight}], pattern, confidence:0..1 }
// All boxes/fractions are 0..1 of the photo. `guide` = { neck, waist, hem, ankle } as fractions of the photo height:
//   neck  = the collar line, waist = where the top ends and the bottoms begin, hem = bottom of the pants,
//   ankle = where the shoes start. Defaults suit a head-to-toe mirror selfie.
//
// How it works: the background is modeled from the left/right edge strips of each band, the person is the central
// column that differs from it, and each garment is read from the inner part of that column (arms, hands and face
// skin are filtered out using a skin sample taken just above the neck). An open jacket shows up as outer strips
// that agree with each other but differ from the middle strip.
import { rgbToLab, extractColors, guessPattern, estimateWhitePoint } from './color.js';

export const DEFAULT_GUIDE = { neck: 0.2, waist: 0.47, hem: 0.82, ankle: 0.9 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Make any guide usable: fill gaps with defaults, clamp, keep neck < waist < hem <= ankle with sane gaps. */
export function normalizeGuide(g) {
  const o = g && typeof g === 'object' ? g : {};
  let neck = clamp(num(o.neck) ?? DEFAULT_GUIDE.neck, 0.06, 0.55);
  let waist = clamp(num(o.waist) ?? DEFAULT_GUIDE.waist, 0.15, 0.8);
  let hem = clamp(num(o.hem) ?? DEFAULT_GUIDE.hem, 0.3, 0.95);
  let ankle = clamp(num(o.ankle) ?? DEFAULT_GUIDE.ankle, 0.4, 0.97);
  waist = Math.max(waist, neck + 0.06);
  hem = Math.max(hem, waist + 0.08);
  ankle = Math.max(ankle, hem);
  if (ankle > 0.97) { ankle = 0.97; hem = Math.min(hem, ankle); waist = Math.min(waist, hem - 0.08); neck = Math.min(neck, waist - 0.06); }
  return { neck, waist, hem, ankle };
}

// ---------- small helpers ----------
const validImage = (im) => im && im.width > 0 && im.height > 0 && im.data && im.data.length >= im.width * im.height * 4;
const fail = (reason) => ({ ok: false, reason, bands: {} });

function hueDeg(a, b) { let h = Math.atan2(b, a) * 180 / Math.PI; if (h < 0) h += 360; return h; }
function skinLike(L, a, b) {
  if (L < 14 || L > 96) return false;
  const C = Math.hypot(a, b);
  if (C < 6 || C > 45) return false;
  const h = hueDeg(a, b);
  return h >= 20 && h <= 85;
}
const dist76 = (L1, a1, b1, L2, a2, b2) => Math.hypot((L1 - L2) * 0.65, a1 - a2, b1 - b2);
const median = (arr) => { if (!arr.length) return 0; const s = Float32Array.from(arr).sort(); return s[s.length >> 1]; };

/** Stride-downsample to a long edge <= max (nearest sample); returns the same object when already small. */
function shrink(im, max = 400) {
  const k = Math.ceil(Math.max(im.width, im.height) / max);
  if (k <= 1) return im;
  const w = Math.floor(im.width / k), h = Math.floor(im.height / k);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y * k) * im.width + x * k) * 4, d = (y * w + x) * 4;
    out[d] = im.data[s]; out[d + 1] = im.data[s + 1]; out[d + 2] = im.data[s + 2]; out[d + 3] = im.data[s + 3];
  }
  return { width: w, height: h, data: out };
}

function labPlanes(im) {
  const n = im.width * im.height;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab(im.data[i * 4], im.data[i * 4 + 1], im.data[i * 4 + 2]);
    L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
  }
  return { L, A, B };
}

function cropImage(im, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * im.width + x0) * 4;
    out.set(im.data.subarray(s, s + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

// ---------- background model ----------
/** Median Lab of the left / right edge strips of rows [y0,y1), in 3 vertical slabs; `reliable` when both are uniform. */
function bgModel(P, W, y0, y1) {
  const strip = Math.max(2, Math.round(W * 0.06));
  const slabs = 3, sh = Math.max(1, (y1 - y0) / slabs);
  const out = { slabs: [], reliable: true, y0, sh };
  for (let s = 0; s < slabs; s++) {
    const ya = Math.floor(y0 + s * sh), yb = Math.max(ya + 1, Math.floor(y0 + (s + 1) * sh));
    const side = (xa, xb) => {
      const Ls = [], As = [], Bs = [];
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { const i = y * W + x; Ls.push(P.L[i]); As.push(P.A[i]); Bs.push(P.B[i]); }
      const m = [median(Ls), median(As), median(Bs)];
      let near = 0;
      for (let k = 0; k < Ls.length; k++) if (dist76(Ls[k], As[k], Bs[k], m[0], m[1], m[2]) < 9) near++;
      return { m, uni: Ls.length ? near / Ls.length : 0 };
    };
    const l = side(0, strip), r = side(W - strip, W);
    if (l.uni < 0.55 || r.uni < 0.55) out.reliable = false;
    out.slabs.push({ l: l.m, r: r.m });
  }
  return out;
}
function bgDist(bg, P, i, y) {
  const s = bg.slabs[Math.min(bg.slabs.length - 1, Math.max(0, Math.floor((y - bg.y0) / bg.sh)))];
  const d1 = dist76(P.L[i], P.A[i], P.B[i], s.l[0], s.l[1], s.l[2]);
  const d2 = dist76(P.L[i], P.A[i], P.B[i], s.r[0], s.r[1], s.r[2]);
  return Math.min(d1, d2);
}
const BG_T = 13;

/** Central foreground run over rows [y0,y1): { x0, x1, frac } (frac = foreground share inside the run), or null. */
function fgRun(P, W, bg, y0, y1, cx) {
  const cols = new Float32Array(W);
  const rows = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (bgDist(bg, P, y * W + x, y) > BG_T) cols[x] += 1 / rows;
  const sm = new Float32Array(W);
  for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += cols[xx]; n++; } } sm[x] = s / n; }
  const T = 0.5;
  const runs = [];
  let start = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && sm[x] >= T;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { runs.push([start, x]); start = -1; }
  }
  if (!runs.length) return null;
  // close small gaps: a white shirt on a white wall splits the person into two runs
  for (let k = runs.length - 1; k > 0; k--) if (runs[k][0] - runs[k - 1][1] <= W * 0.12) { runs[k - 1][1] = runs[k][1]; runs.splice(k, 1); }
  let best = null, bd = Infinity;
  for (const r of runs) {
    const d = cx >= r[0] && cx < r[1] ? 0 : Math.min(Math.abs(cx - r[0]), Math.abs(cx - r[1]));
    if (d < bd || (d === bd && best && r[1] - r[0] > best[1] - best[0])) { bd = d; best = r; }
  }
  if (bd > W * 0.18) return null;
  let sum = 0;
  for (let x = best[0]; x < best[1]; x++) sum += cols[x];
  return { x0: best[0], x1: best[1], frac: sum / (best[1] - best[0]) };
}

// ---------- main ----------
export function analyzeWearing(imageData, opts = {}) {
  try {
    if (!validImage(imageData)) return fail('I couldn’t read that photo. Try another one.');
    if (imageData.width < 48 || imageData.height < 96) return fail('That photo is too small to read. Try a bigger one.');
    if (imageData.height < imageData.width * 0.9) return fail('That photo is sideways or too wide. Try a head-to-toe photo, standing up.');
    const im = shrink(imageData, 400);
    const W = im.width, H = im.height;
    const guide = normalizeGuide(opts && opts.guide);
    const P = labPlanes(im);

    // blank / flat photo
    let mean = 0, varr = 0;
    for (let i = 0; i < W * H; i += 7) mean += P.L[i];
    mean /= Math.ceil((W * H) / 7);
    for (let i = 0; i < W * H; i += 7) varr += (P.L[i] - mean) ** 2;
    if (Math.sqrt(varr / Math.ceil((W * H) / 7)) < 3) return fail('That photo looks blank. Try again with the camera pointed at you.');

    const row = (f) => clamp(Math.round(f * H), 0, H);
    const yNeck = row(guide.neck), yWaist = row(guide.waist), yHem = row(guide.hem), yAnkle = row(guide.ankle);

    // ----- skin sample above the neck + the person's center column -----
    let skin = null, cx = W * 0.5;
    {
      const ya = Math.max(0, yNeck - Math.round(H * 0.12)), yb = Math.max(ya + 1, yNeck - Math.round(H * 0.01));
      const xs = [], Ls = [], As = [], Bs = [];
      for (let y = ya; y < yb; y++) for (let x = Math.round(W * 0.25); x < Math.round(W * 0.75); x++) {
        const i = y * W + x;
        if (skinLike(P.L[i], P.A[i], P.B[i])) { xs.push(x); Ls.push(P.L[i]); As.push(P.A[i]); Bs.push(P.B[i]); }
      }
      if (xs.length >= 30) {
        // tighten onto the dominant skin cluster so skin-colored clutter in the background can't drag the center
        let m = [median(Ls), median(As), median(Bs)];
        const keep = [];
        for (let k = 0; k < xs.length; k++) if (dist76(Ls[k], As[k], Bs[k], m[0], m[1], m[2]) < 14) keep.push(k);
        if (keep.length >= 30) {
          m = [median(keep.map((k) => Ls[k])), median(keep.map((k) => As[k])), median(keep.map((k) => Bs[k]))];
          const mx = median(keep.map((k) => xs[k]));
          if (mx > W * 0.3 && mx < W * 0.7) cx = mx;
          skin = { L: m[0], a: m[1], b: m[2] };
        }
      }
    }
    const isSkin = (i) => !!skin && dist76(P.L[i], P.A[i], P.B[i], skin.L, skin.a, skin.b) < 13;

    // ----- white balance (only when the background looks like a neutral wall, not a colorful one) -----
    let whitePoint = null;
    {
      const bgAll = bgModel(P, W, 0, H);
      const chroma = (s) => Math.hypot(s.l[1], s.l[2]);
      const wallish = bgAll.slabs.every((s) => chroma(s) < 30 && chroma({ l: s.r }) < 30);
      if (bgAll.reliable && wallish) whitePoint = estimateWhitePoint(im);
    }

    // ----- band geometry -----
    const bgTop = bgModel(P, W, yNeck, Math.max(yNeck + 1, yWaist));
    const bgBot = bgModel(P, W, yWaist, Math.max(yWaist + 1, yHem));
    const bgShoe = bgModel(P, W, yAnkle, H);
    // a cluttered background makes "differs from the edges" meaningless, so then only the head position and defaults are used
    const runTop = bgTop.reliable ? fgRun(P, W, bgTop, yNeck, yWaist, cx) : null;
    const runBot = bgBot.reliable ? fgRun(P, W, bgBot, yWaist, yHem, cx) : null;
    const runShoe = bgShoe.reliable ? fgRun(P, W, bgShoe, yAnkle, H, cx) : null;

    const presence = (run, bg) => (!bg.reliable ? 1 : run ? run.frac : 0);
    if (bgTop.reliable && bgBot.reliable && presence(runTop, bgTop) < 0.15 && presence(runBot, bgBot) < 0.15) {
      return fail('I can’t spot you in this photo. Try standing in front of a plain wall, head to toe.');
    }
    if (!runTop && !runBot && (bgTop.reliable || bgBot.reliable)) return fail('I can’t spot you in this photo. Try standing in front of a plain wall, head to toe.');

    const widthOf = (run, lo, hi, dflt) => { const w = run ? (run.x1 - run.x0) / W : 0; return w >= lo && w <= hi ? w : dflt; };
    const rTop = widthOf(runTop, 0.18, 0.7, 0.36);
    const rBot = widthOf(runBot, 0.15, 0.7, 0.34);
    const rShoe = widthOf(runShoe, 0.08, 0.6, 0.36);
    const centerOf = (run, dflt) => (run && widthOf(run, 0.08, 0.7, 0) > 0 ? (run.x0 + run.x1) / 2 : dflt);
    const cTop = clamp(centerOf(runTop, cx), W * 0.25, W * 0.75);
    const cBot = clamp(centerOf(runBot, cTop), W * 0.25, W * 0.75);
    const cShoe = clamp(centerOf(runShoe, cBot), W * 0.2, W * 0.8);

    // read pixels of a window; returns { crop, mask, frac }
    const readWindow = (xa, xb, ya, yb, bg, { useSkin = true, extraMask = null } = {}) => {
      xa = clamp(Math.round(xa), 0, W - 2); xb = clamp(Math.round(xb), xa + 2, W);
      ya = clamp(Math.round(ya), 0, H - 2); yb = clamp(Math.round(yb), ya + 2, H);
      const crop = cropImage(im, xa, ya, xb, yb);
      const cw = crop.width, ch = crop.height;
      const base = new Uint8Array(cw * ch), noBg = new Uint8Array(cw * ch), noSkin = new Uint8Array(cw * ch);
      let nBase = 0, nBg = 0, nBoth = 0;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const k = y * cw + x, i = (ya + y) * W + xa + x;
        if (extraMask && !extraMask(x + xa, y + ya)) continue;
        base[k] = 1; nBase++;
        const notBg = !bg.reliable || bgDist(bg, P, i, ya + y) > BG_T;
        const notSkin = !useSkin || !isSkin(i);
        if (notBg) { noBg[k] = 1; nBg++; }
        if (notBg && notSkin) { noSkin[k] = 1; nBoth++; }
      }
      let nSk = 0;
      const pm = new Uint8Array(cw * ch);
      for (let k = 0; k < cw * ch; k++) if (base[k] && (!useSkin || !isSkin((ya + ((k / cw) | 0)) * W + xa + (k % cw)))) { pm[k] = 1; nSk++; }
      let mask = base, kept = nBase;
      if (nBoth >= Math.max(120, nBase * 0.35)) { mask = noSkin; kept = nBoth; }
      else if (nBg >= Math.max(120, nBase * 0.2)) { mask = noBg; kept = nBg; }
      return { crop, mask, pmask: nSk >= nBase * 0.5 ? pm : base, frac: nBase ? kept / nBase : 0, box: { x: xa / W, y: ya / H, w: (xb - xa) / W, h: (yb - ya) / H } };
    };
    const describe = (r, noPattern = false) => {
      const colors = extractColors(r.crop, { mask: r.mask, maxColors: 3, whitePoint: whitePoint || undefined });
      const pattern = noPattern ? 'solid' : guessPattern(r.crop, { mask: r.pmask });
      return { box: r.box, colors, pattern, confidence: Math.round(clamp(r.frac, 0, 1) * 100) / 100 };
    };

    // ----- top (+ layer) -----
    const spanTop = yWaist - yNeck;
    const tya = yNeck + spanTop * 0.1, tyb = yWaist - spanTop * 0.12;
    const hw = 0.28 * rTop * W;
    const bands = {};
    let layer = null;
    {
      // open-layer test: outer strips agree with each other but differ from the middle strip
      const ra = Math.round(tya), rb = Math.round(tyb);
      const rW = rTop * W;
      const strip = (xa, xb) => {
        const Ls = [], As = [], Bs = [];
        for (let y = ra; y < rb; y++) for (let x = Math.round(xa); x < Math.round(xb); x++) {
          if (x < 0 || x >= W) continue;
          const i = y * W + x; Ls.push(P.L[i]); As.push(P.A[i]); Bs.push(P.B[i]);
        }
        return { L: median(Ls), a: median(As), b: median(Bs), n: Ls.length };
      };
      if (rb - ra >= 6 && rW >= W * 0.15) {
        const mid = strip(cTop - 0.07 * rW, cTop + 0.07 * rW);
        const left = strip(cTop - 0.42 * rW, cTop - 0.2 * rW);
        const right = strip(cTop + 0.2 * rW, cTop + 0.42 * rW);
        if (mid.n > 20 && left.n > 20 && right.n > 20) {
          const dm = (s) => dist76(mid.L, mid.a, mid.b, s.L, s.a, s.b);
          const lr = dist76(left.L, left.a, left.b, right.L, right.a, right.b);
          if (dm(left) > 20 && dm(right) > 20 && lr < 16) {
            let rowsDiff = 0, rowsAll = 0;
            const lo = [(left.L + right.L) / 2, (left.a + right.a) / 2, (left.b + right.b) / 2];
            for (let y = ra; y < rb; y++) {
              const ml = [], ma = [], mb = [];
              for (let x = Math.round(cTop - 0.07 * rW); x < Math.round(cTop + 0.07 * rW); x++) { const i = y * W + x; ml.push(P.L[i]); ma.push(P.A[i]); mb.push(P.B[i]); }
              rowsAll++;
              if (dist76(median(ml), median(ma), median(mb), lo[0], lo[1], lo[2]) > 14) rowsDiff++;
            }
            if (rowsAll && rowsDiff / rowsAll >= 0.7) {
              const inMid = (x) => Math.abs(x - cTop) <= 0.09 * rW;
              const inOuter = (x) => Math.abs(x - cTop) >= 0.2 * rW && Math.abs(x - cTop) <= 0.46 * rW;
              layer = describe(readWindow(cTop - 0.46 * rW, cTop + 0.46 * rW, tya, tyb, bgTop, { extraMask: (x) => inOuter(x) }));
              bands.top = describe(readWindow(cTop - 0.09 * rW, cTop + 0.09 * rW, tya, tyb, bgTop, { extraMask: (x) => inMid(x) }));
            }
          }
        }
      }
      if (!bands.top) bands.top = describe(readWindow(cTop - hw, cTop + hw, tya, tyb, bgTop));
    }

    // ----- bottom -----
    {
      const span = yHem - yWaist;
      // two strips, one per leg, so the gap between the legs (and whatever is behind it) never counts
      const bw = 0.45 * rBot * W, gap = 0.1 * rBot * W;
      bands.bottom = describe(readWindow(cBot - bw, cBot + bw, yWaist + span * 0.12, yHem - span * 0.06, bgBot, { extraMask: (x) => Math.abs(x - cBot) >= gap }));
    }
    // ----- shoes -----
    {
      const rs = rShoe;
      const shw = 0.5 * rs * W;
      bands.shoes = describe(readWindow(cShoe - shw, cShoe + shw, yAnkle, Math.min(H, yAnkle + 0.09 * H), bgShoe), true);
    }
    if (layer) bands.layer = layer;

    const px0 = Math.min(...[runTop, runBot, runShoe].filter(Boolean).map((r) => r.x0 / W), cTop / W - 0.15);
    const px1 = Math.max(...[runTop, runBot, runShoe].filter(Boolean).map((r) => r.x1 / W), cTop / W + 0.15);
    const person = { x: clamp(px0, 0, 1), y: Math.max(0, guide.neck - 0.14), w: clamp(px1 - px0, 0.05, 1), h: 0.98 - Math.max(0, guide.neck - 0.14) };
    person.w = Math.min(person.w, 1 - person.x);
    return { ok: true, person, bands, skin: skin ? { L: Math.round(skin.L), a: Math.round(skin.a), b: Math.round(skin.b) } : null, guide, whitePoint };
  } catch (e) {
    return fail('Something went wrong reading that photo. Try another one.');
  }
}
