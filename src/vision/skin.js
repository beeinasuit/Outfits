// Skin-tone sampling and portrait cut-out. Pure (no DOM): Node 22 + browsers.
// The result is only a STARTING GUESS for the UI's drape test: real selfies have mixed lighting, make-up, filters and
// auto white balance that shift hue by more than the warm/cool difference we try to read. Depth (lightness) is the most
// reliable output, undertone the least; `confidence` reflects that.
import { rgbToLab, rgbToHex, whiteGains } from './color.js';
import { segmentItems } from './segment.js';

const valid = (im) => im && im.width > 0 && im.height > 0 && im.data && im.data.length >= im.width * im.height * 4;
const num = (v, d) => (Number.isFinite(v) ? v : d);
const hueDeg = (a, b) => { let h = Math.atan2(b, a) * 180 / Math.PI; if (h < 0) h += 360; return h; };

function ellipseOf(im, e) {
  const o = e || {};
  const rx = num(o.rx, im.width * 0.3), ry = num(o.ry, im.height * 0.4);
  return { cx: num(o.cx, im.width / 2), cy: num(o.cy, im.height / 2), rx: Math.max(2, rx), ry: Math.max(2, ry) };
}

/** Is this Lab color plausibly skin? (pink-red .. yellow-olive hue, modest chroma, not black/white). */
function skinLike(L, a, b) {
  if (L < 12 || L > 96) return false;
  const C = Math.hypot(a, b);
  if (C < 3.5 || C > 48) return false;
  const h = hueDeg(a, b);
  if (h < 15 || h > 100) return false;
  return true;
}

/**
 * Sample skin inside an ellipse (the oval guide, in image coords). Ignores the top ~30% of the ellipse (hair, forehead
 * shadow), the bottom ~12% (neck/collar) and the central column (nose shadow, mouth), keeps skin-like pixels (Lab hue and
 * chroma window) and takes a trimmed mean in Lab.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {{cx?:number,cy?:number,rx?:number,ry?:number,whitePoint?:number[]}} [opts]  whitePoint: RGB believed neutral
 *   (e.g. estimateWhitePoint of the same photo); channels are rescaled so it becomes gray.
 * @returns {{hex:string,lab:number[],depth:'light'|'medium'|'deep',undertoneGuess:'warm'|'cool'|'neutral',confidence:number}|null}
 *   null when fewer than ~40 skin-like pixels (or < 20% of the sampled region) are found.
 */
export function analyzeSkin(imageData, opts = {}) {
  try {
    if (!valid(imageData)) return null;
    const { width: W, height: H, data } = imageData;
    const e = ellipseOf(imageData, opts);
    const gains = opts && opts.whitePoint ? whiteGains(opts.whitePoint) : null;
    const step = Math.max(1, Math.floor(Math.sqrt((Math.PI * e.rx * e.ry) / 6000)));
    const x0 = Math.max(0, Math.floor(e.cx - e.rx)), x1 = Math.min(W - 1, Math.ceil(e.cx + e.rx));
    const y0 = Math.max(0, Math.floor(e.cy - e.ry)), y1 = Math.min(H - 1, Math.ceil(e.cy + e.ry));
    const pts = [];
    let region = 0;
    for (let y = y0; y <= y1; y += step) {
      const ny = (y - e.cy) / e.ry;
      if (ny < -0.4 || ny > 0.76) continue;                       // top 30% and bottom ~12% of the oval
      for (let x = x0; x <= x1; x += step) {
        const nx = (x - e.cx) / e.rx;
        if (nx * nx + ny * ny > 0.8) continue;                    // inner ellipse only
        if (Math.abs(nx) < 0.2 && ny > -0.3) continue;            // nose / mouth column
        const i = (y * W + x) * 4;
        if (data[i + 3] < 128) continue;
        region++;
        let r = data[i], g = data[i + 1], b = data[i + 2];
        if (gains) { r = Math.min(255, r * gains[0]); g = Math.min(255, g * gains[1]); b = Math.min(255, b * gains[2]); }
        const lab = rgbToLab(r, g, b);
        if (skinLike(lab[0], lab[1], lab[2])) pts.push(lab);
      }
    }
    if (region < 30 || pts.length < 40 || pts.length < 0.2 * region) return null;
    pts.sort((p, q) => p[0] - q[0]);
    const lo = Math.floor(pts.length * 0.15), hi = Math.ceil(pts.length * 0.85);
    const core = pts.slice(lo, hi);
    let L = 0, A = 0, B = 0;
    for (const p of core) { L += p[0]; A += p[1]; B += p[2]; }
    L /= core.length; A /= core.length; B /= core.length;
    // spread of hue among the core pixels (consistent lighting -> small)
    let hs = 0; const hm = hueDeg(A, B);
    for (const p of core) { let d = Math.abs(hueDeg(p[1], p[2]) - hm); if (d > 180) d = 360 - d; hs += d * d; }
    const hueSd = Math.sqrt(hs / core.length);
    const h = hm;
    const depth = L >= 62 ? 'light' : L >= 38 ? 'medium' : 'deep';
    // undertone from hue: pinker/redder = cool, yellower = warm, band between = neutral
    const COOL = 48, WARM = 62;
    const undertoneGuess = h < COOL ? 'cool' : h > WARM ? 'warm' : 'neutral';
    // confidence: enough skin, consistent hue, not extremely dark/bright, a white point known, away from the thresholds
    const frac = pts.length / region;
    let conf = 0.9;
    conf *= Math.min(1, frac / 0.6) ** 0.5;
    conf *= Math.min(1, pts.length / 400) ** 0.3;
    conf *= hueSd > 14 ? 0.5 : hueSd > 9 ? 0.75 : 1;
    if (L < 22 || L > 90) conf *= 0.7;
    if (!gains) conf *= 0.8;
    const margin = undertoneGuess === 'neutral' ? 0.6 : Math.min(1, (h < COOL ? COOL - h : h - WARM) / 6 + 0.5);
    conf *= 0.6 + 0.4 * margin;
    conf = Math.max(0.05, Math.min(0.95, conf));
    // hex of the (corrected) mean via the sRGB round trip of the mean Lab is overkill; average the RGB of core pixels instead
    const rgb = labToRgb(L, A, B);
    return { hex: rgbToHex(rgb[0], rgb[1], rgb[2]), lab: [L, A, B], depth, undertoneGuess, confidence: conf };
  } catch (e) {
    return null;
  }
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
  const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz);
  const lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  return lin.map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055));
}

/**
 * Contrast guess from the oval: luminance spread between the skin and the darkest sizeable part of the oval
 * (hair, brows, glasses; 8th percentile of L*). Deep skin with black hair is genuinely low contrast.
 * @returns {'low'|'medium'|'high'}
 */
export function guessContrast(imageData, ellipse, skinLab) {
  try {
    if (!valid(imageData)) return 'medium';
    const { width: W, data } = imageData;
    const e = ellipseOf(imageData, ellipse);
    const step = Math.max(1, Math.floor(Math.sqrt((Math.PI * e.rx * e.ry) / 6000)));
    const Ls = [];
    for (let y = Math.max(0, Math.floor(e.cy - e.ry)); y <= Math.min(imageData.height - 1, Math.ceil(e.cy + e.ry)); y += step) {
      for (let x = Math.max(0, Math.floor(e.cx - e.rx)); x <= Math.min(W - 1, Math.ceil(e.cx + e.rx)); x += step) {
        const nx = (x - e.cx) / e.rx, ny = (y - e.cy) / e.ry;
        if (nx * nx + ny * ny > 1) continue;
        const i = (y * W + x) * 4;
        if (data[i + 3] < 128) continue;
        Ls.push(rgbToLab(data[i], data[i + 1], data[i + 2])[0]);
      }
    }
    if (Ls.length < 30) return 'medium';
    Ls.sort((a, b) => a - b);
    const dark = Ls[Math.floor(Ls.length * 0.08)];
    const skinL = skinLab && Number.isFinite(skinLab[0]) ? skinLab[0] : Ls[Math.floor(Ls.length * 0.6)];
    const spread = skinL - dark;
    return spread < 28 ? 'low' : spread < 50 ? 'medium' : 'high';
  } catch (err) {
    return 'medium';
  }
}

/**
 * Head-and-shoulders mask: models the background from the image border (same approach as segmentItems), keeps the
 * foreground component that overlaps the oval most, and always includes the inner oval so a face close to the wall color
 * is not cut out. Feed the result to refineMaskAlpha / cutoutCanvas.
 * @returns {{x:number,y:number,w:number,h:number,mask:Uint8Array,area:number}|null}  box-sized mask like segmentItems
 */
export function segmentPortrait(imageData, ellipse) {
  try {
    if (!valid(imageData)) return null;
    const { width: W, height: H } = imageData;
    const e = ellipseOf(imageData, ellipse);
    const boxes = segmentItems(imageData, { padding: 0, minAreaFrac: 0.01, maxItems: 12 });
    const full = new Uint8Array(W * H);
    let best = null, bestOv = 0;
    for (const b of boxes) {
      let ov = 0;
      for (let y = 0; y < b.h; y += 2) for (let x = 0; x < b.w; x += 2) {
        if (!b.mask[y * b.w + x]) continue;
        const nx = (b.x + x - e.cx) / e.rx, ny = (b.y + y - e.cy) / e.ry;
        if (nx * nx + ny * ny <= 1) ov++;
      }
      if (ov > bestOv) { bestOv = ov; best = b; }
    }
    if (best) for (let y = 0; y < best.h; y++) for (let x = 0; x < best.w; x++) if (best.mask[y * best.w + x]) full[(best.y + y) * W + best.x + x] = 1;
    // the inner oval is always part of the person
    for (let y = Math.max(0, Math.floor(e.cy - e.ry)); y <= Math.min(H - 1, Math.ceil(e.cy + e.ry)); y++) {
      for (let x = Math.max(0, Math.floor(e.cx - e.rx)); x <= Math.min(W - 1, Math.ceil(e.cx + e.rx)); x++) {
        const nx = (x - e.cx) / (e.rx * 0.8), ny = (y - e.cy) / (e.ry * 0.8);
        if (nx * nx + ny * ny <= 1) full[y * W + x] = 1;
      }
    }
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (full[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, mask = new Uint8Array(bw * bh);
    let area = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (full[(y0 + y) * W + x0 + x]) { mask[y * bw + x] = 1; area++; }
    return { x: x0, y: y0, w: bw, h: bh, mask, area };
  } catch (err) {
    return null;
  }
}
