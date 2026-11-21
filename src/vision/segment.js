// Flat-lay segmentation: split a photo of several clothes on a plain background into item boxes.
// Pure (no DOM). Works on {width,height,data: Uint8ClampedArray RGBA}.
//
// Pipeline (all at a working resolution of <= ~512px on the long edge, then scaled back up):
//   1. area-average downsample, convert to CIELAB
//   2. model the background from the border ring: robust plane (or quadratic, for vignettes) fit per Lab channel
//   3. foreground = far from the model in chroma, or lighter, or much darker. Mild darkening with the same hue is
//      treated as a shadow and stays background.
//   4. morphology: open 3x3 (kills speckle, keeps thin belts), close 5x5, fill enclosed holes
//   5. iterative connected components, merge overlapping boxes and tiny fragments next to big items
//   5b. busy prints (plaid, flannel): holes in a dense foreground patch are reclaimed before labeling, and carved groups are
//       consolidated (big closing, hole fill). A garment touching the frame can pollute the border model: when nothing solid
//       comes out, the ring arcs that share the center's colors are dropped and the pipeline runs again; a busy frame with
//       no solid result becomes one whole-frame item.
//   6. pad, clamp, sort row-major, cap, build per-box masks at full resolution
//
// Also exported: maskQuality (is a cutout mask trustworthy?) and segmentCrop (mask for one user-drawn box).
//
// Known limitations: items that touch each other merge into one box; an item whose color is within a few
// delta-E of the sheet (white shirt on a white sheet) is only partly found; strongly textured/patterned
// backgrounds raise the tolerance and can swallow low-contrast items.
import { rgbToLab } from './color.js';

const WORK_MAX = 512;

function solveLinear(A, b, n) { // gaussian elimination with partial pivoting; A is n*n row-major (mutated)
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-12) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = s / A[r * n + r];
  }
  return x;
}

const basisPlane = (u, v) => [1, u, v];
const basisQuad = (u, v) => [1, u, v, u * u, u * v, v * v];

/** Robust fit of value ~ basis(u,v) on border samples. Returns {coef, sigma, basis}. */
function robustFit(us, vs, vals, basis, init, startInl) {
  const n = vals.length, m = basis(0, 0).length;
  let coef = null, sigma = 1;
  let res = new Float64Array(n);
  for (let k = 0; k < n; k++) res[k] = vals[k] - init;
  // start from points close to the median (and to the caller's inliers): border-touching items are outliers
  const a0 = Array.from(res, Math.abs).sort((a, b) => a - b);
  const s0 = Math.max(1, 1.4826 * a0[a0.length >> 1]);
  let inl = new Uint8Array(n);
  for (let k = 0; k < n; k++) inl[k] = Math.abs(res[k]) < 3 * s0 + 2 && (!startInl || startInl[k]) ? 1 : 0;
  for (let iter = 0; iter < 4; iter++) {
    const A = new Float64Array(m * m), bb = new Float64Array(m);
    let cnt = 0;
    for (let k = 0; k < n; k++) {
      if (!inl[k]) continue;
      cnt++;
      const bs = basis(us[k], vs[k]);
      for (let i = 0; i < m; i++) { bb[i] += bs[i] * vals[k]; for (let j = 0; j < m; j++) A[i * m + j] += bs[i] * bs[j]; }
    }
    if (cnt < m * 4) break;
    const sol = solveLinear(A, bb, m);
    if (!sol) break;
    coef = sol;
    const absr = [];
    for (let k = 0; k < n; k++) {
      const bs = basis(us[k], vs[k]);
      let p = 0; for (let i = 0; i < m; i++) p += coef[i] * bs[i];
      res[k] = vals[k] - p;
      if (inl[k]) absr.push(Math.abs(res[k]));
    }
    absr.sort((a, b) => a - b);
    const mad = absr[absr.length >> 1] || 0;
    sigma = Math.max(0.5, 1.4826 * mad);
    for (let k = 0; k < n; k++) inl[k] = Math.abs(res[k]) < 3 * sigma + 1 ? 1 : 0;
  }
  if (!coef) { coef = new Array(m).fill(0); coef[0] = init; }
  return { coef, sigma, basis };
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  return s[s.length >> 1];
}

function erode(src, w, h, r, tmp, out) { // out-of-bounds counts as foreground (do not eat frame-touching items)
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let v = 1;
      const a = x - r < 0 ? 0 : x - r, b = x + r >= w ? w - 1 : x + r;
      for (let k = a; k <= b; k++) if (!src[o + k]) { v = 0; break; }
      tmp[o + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r, b = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let k = a; k <= b; k++) if (!tmp[k * w + x]) { v = 0; break; }
      out[y * w + x] = v;
    }
  }
}
function dilate(src, w, h, r, tmp, out) {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const a = x - r < 0 ? 0 : x - r, b = x + r >= w ? w - 1 : x + r;
      for (let k = a; k <= b; k++) if (src[o + k]) { v = 1; break; }
      tmp[o + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r, b = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = a; k <= b; k++) if (tmp[k * w + x]) { v = 1; break; }
      out[y * w + x] = v;
    }
  }
}


/** Box-filter density of a 0/1 mask (radius r), as Float32 0..1. */
function density(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s;
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  const win = (2 * r + 1) * (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / win;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function reclaimHoles(M, w, h, T1, T2, dev) {
  const N = w * h, m = Math.min(w, h);
  const r = Math.max(3, Math.round(0.035 * m)), rc = Math.max(3, Math.round(0.05 * m));
  const D = density(M, w, h, r);
  const K = new Uint8Array(N);
  dilate(M, w, h, rc, T1, T2); erode(T2, w, h, rc, T1, K);
  let add = 0;
  for (let p = 0; p < N; p++) if (K[p] && !M[p] && D[p] >= 0.35 && dev[p] >= 0.5) { T1[p] = 1; add++; } else T1[p] = 0;
  if (add) for (let p = 0; p < N; p++) if (T1[p]) M[p] = 1;
}

/**
 * Background as a mixture of color clusters (k-means, k<=4, on border-ring Lab samples).
 * Returns {cl, isBg(L,a,b)}; a pixel is background when it is inside any cluster's radius, on the line between two
 * clusters (anti-aliased stripe edge), or a darker same-hue version of a cluster (shadow).
 */
function fitMixture(us, vs, lv, av, bv, tolL) {
  const n = lv.length;
  const pts = (k) => [lv[k], av[k], bv[k]];
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  // farthest-first init from the median-closest sample
  const mL = median(lv), mA = median(av), mB = median(bv);
  let first = 0, bd = Infinity;
  for (let k = 0; k < n; k++) { const d = d2(pts(k), [mL, mA, mB]); if (d < bd) { bd = d; first = k; } }
  const cent = [pts(first)];
  const K = 4;
  while (cent.length < K) {
    let far = -1, fd = 0;
    for (let k = 0; k < n; k++) {
      let m = Infinity; for (const c of cent) m = Math.min(m, d2(pts(k), c));
      if (m > fd) { fd = m; far = k; }
    }
    if (far < 0 || fd < 15 * 15) break;
    cent.push(pts(far));
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < 10; it++) {
    for (let k = 0; k < n; k++) {
      let bi = 0, b2 = Infinity; const p = pts(k);
      for (let c = 0; c < cent.length; c++) { const d = d2(p, cent[c]); if (d < b2) { b2 = d; bi = c; } }
      asg[k] = bi;
    }
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let k = 0; k < n; k++) { const s = sum[asg[k]]; s[0] += lv[k]; s[1] += av[k]; s[2] += bv[k]; s[3]++; }
    for (let c = 0; c < cent.length; c++) if (sum[c][3]) cent[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const cl = [];
  for (let c = 0; c < cent.length; c++) {
    let cnt = 0, ss = 0;
    for (let k = 0; k < n; k++) if (asg[k] === c) { cnt++; ss += d2(pts(k), cent[c]); }
    if (cnt / n < 0.08) continue;                 // sparse clusters: items touching the frame, not background
    cl.push({ c: cent[c], w: cnt / n, rad: Math.max(7, 3 * Math.sqrt(ss / cnt / 3) * 1.2) });
  }
  if (!cl.length) cl.push({ c: [mL, mA, mB], w: 1, rad: Math.max(7, tolL) });
  const seg = (p, a, b) => {            // distance from p to segment a-b
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const den = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / den));
    return Math.sqrt(d2(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]));
  };
  const isBg = (L, a, b) => {
    const p = [L, a, b];
    for (const k of cl) {
      if (Math.sqrt(d2(p, k.c)) <= k.rad) return true;
      if (L < k.c[0] && k.c[0] > 1) {   // shadow: darker, same hue
        const r = Math.max(0, L / k.c[0]);
        if (Math.hypot(a - k.c[1] * r, b - k.c[2] * r) <= 5 && L > k.c[0] * 0.55) return true;
      }
    }
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) if (seg(p, cl[i].c, cl[j].c) <= 6) return true;
    return false;
  };
  return { cl, isBg };
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {{minAreaFrac?:number,maxItems?:number,padding?:number}} opts
 * @returns {Array<{x:number,y:number,w:number,h:number,area:number,mask:Uint8Array}>}
 */
export function segmentItems(imageData, opts = {}) {
  try {
    return segment(imageData, opts);
  } catch (e) {
    return [];
  }
}

function segment(im, opts) {
  const minAreaFrac = Number.isFinite(opts.minAreaFrac) ? opts.minAreaFrac : 0.01;
  const maxItems = Number.isFinite(opts.maxItems) ? Math.max(1, opts.maxItems) : 12;
  const padding = Number.isFinite(opts.padding) ? Math.max(0, opts.padding) : 0.03;
  if (!im || !(im.width > 0) || !(im.height > 0) || !im.data || im.data.length < im.width * im.height * 4) return [];
  const W = im.width, H = im.height, data = im.data;
  const f = Math.max(1, Math.ceil(Math.max(W, H) / WORK_MAX));
  const w = Math.floor(W / f), h = Math.floor(H / f);
  if (w < 8 || h < 8) return [];
  const N = w * h;

  // 1. downsample + Lab
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), solidPx = new Uint8Array(N);
  const area = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = 0; yy < f; yy++) {
        let i = ((y * f + yy) * W + x * f) * 4;
        for (let xx = 0; xx < f; xx++, i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
        }
      }
      const p = y * w + x;
      if (c < area / 2) { solidPx[p] = 0; L[p] = 100; continue; }  // transparent -> treated as background-ish later
      solidPx[p] = 1;
      const lab = rgbToLab(r / c, g / c, b / c);
      L[p] = lab[0]; A[p] = lab[1]; B[p] = lab[2];
    }
  }

  // 2. background model from the border ring (samples in `skip` arcs are left out)
  const pipeline = (skip) => {
  const t = Math.max(2, Math.round(0.015 * Math.min(w, h)));
  const us = [], vs = [], lv = [], av = [], bv = [];
  const stepB = 1;
  const addB = (x, y) => {
    const p = y * w + x;
    if (!solidPx[p] || (skip && skip(x, y))) return;
    us.push(x / w - 0.5); vs.push(y / h - 0.5); lv.push(L[p]); av.push(A[p]); bv.push(B[p]);
  };
  for (let y = 0; y < h; y += stepB) {
    for (let x = 0; x < w; x++) {
      if (y < t || y >= h - t || x < t || x >= w - t) addB(x, y);
    }
  }
  if (us.length < 24) return [];
  if (us.length > 1500) {   // the fits only need a few hundred samples; decimate to keep it fast
    const st = Math.ceil(us.length / 1500), keep = (arr) => arr.filter((_, i) => i % st === 0);
    us.splice(0, us.length, ...keep(us)); vs.splice(0, vs.length, ...keep(vs)); lv.splice(0, lv.length, ...keep(lv)); av.splice(0, av.length, ...keep(av)); bv.splice(0, bv.length, ...keep(bv));
  }
  const mL = median(lv), mA = median(av), mB = median(bv);
  const fit = (vals, init, start) => {
    const pl = robustFit(us, vs, vals, basisPlane, init, start);
    const q = robustFit(us, vs, vals, basisQuad, init, start);
    return q.sigma < 0.7 * pl.sigma ? q : pl;
  };
  const fL = fit(lv, mL);
  const startInl = new Uint8Array(lv.length);
  for (let k = 0; k < lv.length; k++) {
    const bs = fL.basis(us[k], vs[k]); let p = 0;
    for (let i = 0; i < bs.length; i++) p += fL.coef[i] * bs[i];
    startInl[k] = Math.abs(lv[k] - p) < 3 * fL.sigma + 2 ? 1 : 0;
  }
  const fA = fit(av, mA, startInl), fB = fit(bv, mB, startInl);
  const evalF = (ft, u, v) => {
    const bs = ft.basis(u, v); let s = 0;
    for (let i = 0; i < bs.length; i++) s += ft.coef[i] * bs[i];
    return s;
  };
  const tolL = Math.max(6, 3.5 * fL.sigma);
  const tolC = Math.max(5, 3.5 * Math.max(fA.sigma, fB.sigma));

  // 2b. periodic / patterned backgrounds (striped sheet, checks, wood): the plane model leaves many border outliers in
  //     several separate runs along the ring. Then model the background as a mixture of color clusters instead.
  let mixture = null;
  {
    const ring = [];                       // outer line of the frame in walk order
    for (let x = 0; x < w; x++) ring.push(x);
    for (let y = 1; y < h; y++) ring.push(y * w + w - 1);
    for (let x = w - 2; x >= 0; x--) ring.push((h - 1) * w + x);
    for (let y = h - 2; y > 0; y--) ring.push(y * w);
    let out = 0, runs = 0, prev = false, gap = 99, n = 0;
    for (const p of ring) {
      if (!solidPx[p]) continue;
      const x = p % w, y = (p - x) / w;
      if (skip && skip(x, y)) continue;
      n++;
      const u = x / w - 0.5, v = y / h - 0.5;
      const dl = L[p] - evalF(fL, u, v);
      const cd = Math.hypot(A[p] - evalF(fA, u, v), B[p] - evalF(fB, u, v));
      const bad = Math.abs(dl) > tolL || cd > tolC;
      if (bad) { out++; if (!prev && gap > 2) runs++; prev = true; gap = 0; } else { prev = false; gap++; }
    }
    if (n > 40 && ((out / n > 0.12 && runs >= 4) || tolL > 30 || tolC > 30)) mixture = fitMixture(us, vs, lv, av, bv, tolL);
  }

  // 3. classify
  let M = new Uint8Array(N);
  const dev = new Float32Array(N).fill(9);   // how far each pixel is from the background model, in tolerance units
  let patterned = false;
  if (mixture) {
    patterned = mixture.cl.length >= 2;
    for (let p = 0; p < N; p++) {
      if (!solidPx[p]) continue;
      if (!mixture.isBg(L[p], A[p], B[p])) M[p] = 1;
    }
  } else {
    for (let y = 0; y < h; y++) {
      const v = y / h - 0.5;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!solidPx[p]) continue;
        const u = x / w - 0.5;
        const bl = evalF(fL, u, v);
        let ba = evalF(fA, u, v), bb = evalF(fB, u, v);
        const dL = L[p] - bl;
        if (dL < 0 && bl > 1) { const ratio = Math.max(0, L[p] / bl); ba *= ratio; bb *= ratio; }
        const cd = Math.hypot(A[p] - ba, B[p] - bb);
        dev[p] = Math.max(Math.abs(dL) / tolL, cd / tolC);
        if (cd > tolC || dL > tolL || dL < -(tolL + 0.2 * Math.max(bl, 0))) M[p] = 1;
      }
    }
    // 3b. hard shadows: dark, same-hue regions that touch an item (the caster) are background even when much darker
    //     than the sheet. Components of such "shadow candidates" are dropped when their darkness is uniform and a
    //     good share of their perimeter touches non-candidate foreground.
    const cand = new Uint8Array(N);
    let nc = 0;
    for (let y = 0; y < h; y++) {
      const v = y / h - 0.5;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!M[p]) continue;
        const bl = evalF(fL, x / w - 0.5, v);
        if (bl < 30) continue;
        const ratio = L[p] / bl;
        if (ratio < 0.3 || ratio > 0.95) continue;
        const cd = Math.hypot(A[p] - evalF(fA, x / w - 0.5, v) * ratio, B[p] - evalF(fB, x / w - 0.5, v) * ratio);
        if (cd <= tolC + 3) { cand[p] = 1; nc++; }
      }
    }
    if (nc > 20) {
      const lab = new Int32Array(N), stk = new Int32Array(N);
      for (let s0 = 0; s0 < N; s0++) {
        if (!cand[s0] || lab[s0]) continue;
        let sp = 0; const cells = [];
        stk[sp++] = s0; lab[s0] = 1;
        while (sp) {
          const p = stk[--sp]; cells.push(p);
          const x = p % w;
          if (x > 0 && cand[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stk[sp++] = p - 1; }
          if (x < w - 1 && cand[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stk[sp++] = p + 1; }
          if (p >= w && cand[p - w] && !lab[p - w]) { lab[p - w] = 1; stk[sp++] = p - w; }
          if (p + w < N && cand[p + w] && !lab[p + w]) { lab[p + w] = 1; stk[sp++] = p + w; }
        }
        if (cells.length < 12) continue;
        let sr = 0, sr2 = 0, casters = 0, bgN = 0;
        for (const p of cells) {
          const x = p % w, y = (p - x) / w;
          const r = L[p] / Math.max(1, evalF(fL, x / w - 0.5, y / h - 0.5));
          sr += r; sr2 += r * r;
          const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
          for (const q of nb) { if (q < 0) continue; if (!M[q]) bgN++; else if (!cand[q]) casters++; }
        }
        const mean = sr / cells.length, sd = Math.sqrt(Math.max(0, sr2 / cells.length - mean * mean));
        if (sd < 0.12 && mean > 0.3 && mean < 0.9 && casters / (casters + bgN + 1) >= 0.25) for (const p of cells) M[p] = 0;
      }
    }
  }

  // 3c. carved items: a plaid/flannel whose colors the background model also contains (brown stripes on a wood floor, gray
  //     checks on gray carpet) is classified stripe by stripe. Where the foreground is a dense-but-holey patch, bridge
  //     the holes: close with a large window, but only take back pixels that sit in a locally dense foreground.
  const T1 = new Uint8Array(N), T2 = new Uint8Array(N);
  reclaimHoles(M, w, h, T1, T2, dev);

  // 4. morphology
  erode(M, w, h, 1, T1, T2); dilate(T2, w, h, 1, T1, M);           // open 3x3
  // close 5x5, but only across pixels that deviate somewhat from the background model: a gap that is clearly
  // sheet-colored (two items laid a few px apart) stays open, a faint stripe inside a striped shirt is bridged.
  {
    const Mo = M.slice();
    dilate(M, w, h, 2, T1, T2); erode(T2, w, h, 2, T1, M);
    if (!mixture) for (let p = 0; p < N; p++) if (M[p] && !Mo[p] && dev[p] < 0.5) M[p] = 0;
  }
  // fill enclosed holes: flood the background from the frame
  {
    const seen = new Uint8Array(N), q = new Int32Array(N);
    let qh = 0, qt = 0;
    const seed = (p) => { if (!M[p] && !seen[p]) { seen[p] = 1; q[qt++] = p; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (qh < qt) {
      const p = q[qh++], x = p % w, y = (p - x) / w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (y > 0) seed(p - w);
      if (y < h - 1) seed(p + w);
    }
    for (let p = 0; p < N; p++) if (!M[p] && !seen[p]) M[p] = 1;
  }
  let fg = 0;
  for (let p = 0; p < N; p++) fg += M[p];
  // The border ring is not a plain sheet (several colors, or a wide spread): when nothing solid is found, the likely story
  // is a garment that fills the frame and polluted the background model. Boxing the whole photo beats finding nothing.
  const busyFrame = (mixture && mixture.cl.length >= 2) || tolL > 12 || tolC > 12;
  const wholeFrame = () => [{ x: 0, y: 0, w: W, h: H, area: W * H, mask: new Uint8Array(W * H).fill(1) }];
  if (fg === 0) return patterned || busyFrame ? wholeFrame() : [];
  if (fg / N > 0.85) {
    return [{ x: 0, y: 0, w: W, h: H, area: W * H, mask: new Uint8Array(W * H).fill(1) }];
  }

  // 5. connected components (8-connected, iterative)
  const labels = new Int32Array(N);
  const comps = [];
  const stack = new Int32Array(N);
  const tinyArea = Math.max(8, Math.floor(0.0008 * N));
  for (let s = 0; s < N; s++) {
    if (!M[s] || labels[s]) continue;
    const id = comps.length + 1;
    let sp = 0, cnt = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = s; labels[s] = id;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const pp = yy * w + xx;
          if (M[pp] && !labels[pp]) { labels[pp] = id; stack[sp++] = pp; }
        }
      }
    }
    comps.push({ id, area: cnt, x0, y0, x1, y1 });
  }
  // a busy print filling the frame (close-up of a garment): dozens of small scattered fragments spread over the frame
  if (comps.length >= 40) {
    let ux0 = w, uy0 = h, ux1 = 0, uy1 = 0, bigN = 0;
    for (const c of comps) { ux0 = Math.min(ux0, c.x0); uy0 = Math.min(uy0, c.y0); ux1 = Math.max(ux1, c.x1); uy1 = Math.max(uy1, c.y1); if (c.area >= 0.02 * N) bigN++; }
    if (bigN === 0 && (ux1 - ux0 + 1) * (uy1 - uy0 + 1) >= 0.8 * N) return [{ x: 0, y: 0, w: W, h: H, area: W * H, mask: new Uint8Array(W * H).fill(1) }];
  }
  let live = comps.filter((c) => c.area >= tinyArea);
  live.sort((a, b) => b.area - a.area);
  live = live.slice(0, 80);
  if (!live.length) return busyFrame ? wholeFrame() : [];

  const parent = live.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const grp = live.map((c) => ({ ...c }));      // group stats, indexed by root
  const minArea = minAreaFrac * N;
  const gapMax = 0.04 * Math.max(w, h);
  let changed = true;
  if (opts.single) {      // the caller says "this crop is ONE item": every piece belongs to the biggest one
    for (let j = 1; j < grp.length; j++) {
      const a = grp[0], b = grp[j];
      parent[j] = 0; a.area += b.area;
      a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
    }
    changed = false;
  }
  while (changed) {
    changed = false;
    for (let i = 0; i < grp.length; i++) {
      if (find(i) !== i) continue;
      for (let j = 0; j < grp.length; j++) {
        if (i === j || find(j) !== j || find(i) !== i) continue;
        const a = grp[i], b = grp[j];
        if (a.area < b.area || (a.area === b.area && i > j)) continue; // a is the bigger
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
        const boxB = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
        let merge = false;
        if (ix > 0 && iy > 0 && (ix * iy) / boxB > 0.6) merge = true;
        else if (b.area < Math.max(minArea * 0.6, 0.06 * a.area)) {
          const gx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1);
          const gy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1);
          if (Math.hypot(gx, gy) <= gapMax) merge = true;
        }
        if (merge) {
          parent[j] = i;
          a.area += b.area;
          a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
          changed = true;
        }
      }
    }
  }
  let groups = [];
  const groupOfComp = new Int32Array(comps.length + 2).fill(-1);
  for (let i = 0; i < grp.length; i++) {
    if (find(i) !== i || grp[i].area < minArea) continue;
    groups.push({ ...grp[i], root: i });
  }
  groups.sort((a, b) => b.area - a.area);
  groups = groups.slice(0, maxItems);
  if (!groups.length) return busyFrame ? wholeFrame() : [];
  const rootToGroup = new Map(groups.map((g, k) => [g.root, k]));
  live.forEach((c, i) => { const k = rootToGroup.get(find(i)); if (k !== undefined) groupOfComp[c.id] = k; });

  // 5b. carved groups (stripey outline, holes, several pieces): bridge them with a big closing, trim spikes, fill holes.
  //     Only inside the group's own area, so neighbors are never swallowed.
  const own = new Int16Array(N);                       // group index + 1
  for (let p = 0; p < N; p++) if (labels[p] && groupOfComp[labels[p]] >= 0) own[p] = groupOfComp[labels[p]] + 1;
  groups.forEach((g, k) => consolidate(own, k + 1, g, w, h, mixture ? 2 : tolL > 12 || tolC > 10 ? 1 : 0));
  groups.forEach((g, k) => {                           // boxes may have grown a little
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) if (own[y * w + x] === k + 1) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) { g.x0 = x0; g.y0 = y0; g.x1 = x1; g.y1 = y1; }
  });

  // 6. boxes at full resolution + masks
  const out = groups.map((g, k) => {
    const bx0 = g.x0 * f, by0 = g.y0 * f;
    const bx1 = Math.min(W, (g.x1 + 1) * f), by1 = Math.min(H, (g.y1 + 1) * f);
    const pad = Math.round(padding * Math.max(bx1 - bx0, by1 - by0));
    const X0 = Math.max(0, bx0 - pad), Y0 = Math.max(0, by0 - pad);
    const X1 = Math.min(W, bx1 + pad), Y1 = Math.min(H, by1 + pad);
    const bw = X1 - X0, bh = Y1 - Y0;
    const mask = new Uint8Array(bw * bh);
    let cnt = 0;
    for (let y = 0; y < bh; y++) {
      const wy = Math.min(h - 1, Math.floor((Y0 + y) / f));
      for (let x = 0; x < bw; x++) {
        const wx = Math.min(w - 1, Math.floor((X0 + x) / f));
        if (own[wy * w + wx] === k + 1) { mask[y * bw + x] = 1; cnt++; }
      }
    }
    return { x: X0, y: Y0, w: bw, h: bh, area: cnt, mask };
  });

  // sort top-left -> bottom-right: rows by center-y with tolerance, then by x
  out.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  for (const it of out) {
    const cy = it.y + it.h / 2;
    const row = rows.find((r) => Math.abs(cy - r.cy) < 0.5 * Math.min(it.h, r.minH));
    if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; row.minH = Math.min(row.minH, it.h); }
    else rows.push({ cy, minH: it.h, items: [it] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
  };

  // 7. attempt 1 trusts the whole border ring. When that yields nothing solid (a garment touching the frame polluted the
  //    background model), attempt 2 drops the ring arcs whose colors are the center's colors and tries again.
  const solidValue = (res) => {
    let v = 0;
    for (const it of res) {
      if (it.w >= W && it.h >= H) continue;
      if (qualityOf(it).ok) v += it.area;
    }
    return v;
  };
  const first = pipeline(null);
  const wholeOnly = first.length === 0 || (first.length === 1 && first[0].w >= W && first[0].h >= H);
  if (!wholeOnly && solidValue(first) >= 0.6 * first.reduce((s2, it) => s2 + it.area, 0)) return first;
  const skip = pollutedArcs(w, h, L, A, B, solidPx);
  if (!skip) return first;
  const second = pipeline(skip);
  return solidValue(second) > solidValue(first) * 1.15 ? second : first;
}

/**
 * If group `id` in `own` (label image) looks carved up, replace its pixels with a closed, hole-free, spike-trimmed version.
 * The bounding box {x0,y0,x1,y1} is the group's current box (work-resolution pixels).
 */
function consolidate(own, id, g, w, h, grow) {
  const bw = g.x1 - g.x0 + 1, bh = g.y1 - g.y0 + 1;
  const m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (own[(g.y0 + y) * w + g.x0 + x] === id) m[y * bw + x] = 1;
  const q = maskQuality(m, bw, bh);
  if (q.fill >= 0.985) return;
  if (q.compact <= 1.45 && q.holes <= 0.02 && q.largest >= 0.95) {
    // solid group. On a patterned background the outermost band of a print that echoes the background is lost: give it back.
    if (!grow) return;
    const pw = bw + 2 * grow + 2, ph = bh + 2 * grow + 2, pad = grow + 1;
    const a = new Uint8Array(pw * ph), t1 = new Uint8Array(pw * ph), t2 = new Uint8Array(pw * ph);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) a[(y + pad) * pw + x + pad] = 1;
    dilate(a, pw, ph, grow, t1, t2);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      if (!t2[y * pw + x]) continue;
      const X = g.x0 + x - pad, Y = g.y0 + y - pad;
      if (X >= 0 && Y >= 0 && X < w && Y < h && !own[Y * w + X]) own[Y * w + X] = id;
    }
    return;
  }
  const R = Math.max(3, Math.round(0.09 * Math.min(w, h)));
  const pw = bw + 2 * R + 2, ph = bh + 2 * R + 2, pad = R + 1;
  const a = new Uint8Array(pw * ph), t1 = new Uint8Array(pw * ph), t2 = new Uint8Array(pw * ph);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) a[(y + pad) * pw + x + pad] = 1;
  // close (dilate then erode; the pad keeps the frame out of the picture) ...
  dilate(a, pw, ph, R, t1, t2); erode(t2, pw, ph, R, t1, a);
  // ... fill holes: flood the outside from the padded frame ...
  const seen = new Uint8Array(pw * ph), q2 = new Int32Array(pw * ph);
  let qh = 0, qt = 0;
  const seed = (p) => { if (!a[p] && !seen[p]) { seen[p] = 1; q2[qt++] = p; } };
  for (let x = 0; x < pw; x++) { seed(x); seed((ph - 1) * pw + x); }
  for (let y = 0; y < ph; y++) { seed(y * pw); seed(y * pw + pw - 1); }
  while (qh < qt) {
    const p = q2[qh++], x = p % pw;
    if (x > 0) seed(p - 1);
    if (x < pw - 1) seed(p + 1);
    if (p >= pw) seed(p - pw);
    if (p + pw < pw * ph) seed(p + pw);
  }
  for (let p = 0; p < pw * ph; p++) if (!a[p] && !seen[p]) a[p] = 1;
  // ... trim spikes (open) and write back, never over another group
  erode(a, pw, ph, 2, t1, t2); dilate(t2, pw, ph, 4, t1, a);   // opening by 2, plus 2px back for the porous edge band
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    if (!a[y * pw + x]) continue;
    const X = g.x0 + x - pad, Y = g.y0 + y - pad;
    if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
    if (!own[Y * w + X]) own[Y * w + X] = id;
  }
  // pixels trimmed by the opening stay with the group only if they were in the original (nothing removed otherwise)
}

/** Quality of a detection's mask, measured on a decimated copy so 12-megapixel boxes stay cheap. */
function qualityOf(it) {
  const k = Math.max(1, Math.ceil(Math.max(it.w, it.h) / 160));
  if (k === 1) return maskQuality(it.mask, it.w, it.h);
  const w = Math.max(1, Math.floor(it.w / k)), h = Math.max(1, Math.floor(it.h / k)), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = it.mask[(y * k + (k >> 1)) * it.w + x * k + (k >> 1)];
  return maskQuality(m, w, h);
}

/**
 * Ring arcs that look like the garment itself. When the center of the frame is multicolored (a print or plaid) and some
 * border arcs use exactly the center's colors while others do not, the matching arcs are the item touching the frame.
 * Returns skip(x,y) -> true for those arcs, or null when the ring is consistent (or the center is plain).
 */
function pollutedArcs(w, h, L, A, B, solidPx) {
  const NARC = 24, t = Math.max(2, Math.round(0.015 * Math.min(w, h)));
  const us = [], vs = [], lv = [], av = [], bv = [];
  for (let y = Math.floor(0.3 * h); y < 0.7 * h; y += 2) for (let x = Math.floor(0.3 * w); x < 0.7 * w; x += 2) {
    const p = y * w + x;
    if (solidPx[p]) { us.push(0); vs.push(0); lv.push(L[p]); av.push(A[p]); bv.push(B[p]); }
  }
  if (us.length < 40) return null;
  const mix = fitMixture(us, vs, lv, av, bv, 6);
  if (mix.cl.length < 2) return null;
  const P = 2 * (w + h);
  const arcOf = (x, y) => {
    const dl = x, dr = w - 1 - x, dt = y, db = h - 1 - y, m = Math.min(dl, dr, dt, db);
    const s = m === dt ? x : m === dr ? w + y : m === db ? w + h + (w - 1 - x) : 2 * w + h + (h - 1 - y);
    return Math.min(NARC - 1, Math.floor((s / P) * NARC));
  };
  const cnt = new Int32Array(NARC), hit = new Int32Array(NARC);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!(y < t || y >= h - t || x < t || x >= w - t)) continue;
    const p = y * w + x;
    if (!solidPx[p]) continue;
    const a = arcOf(x, y);
    cnt[a]++;
    if (mix.isBg(L[p], A[p], B[p])) hit[a]++;
  }
  const bad = new Uint8Array(NARC);
  let nBad = 0, nGood = 0, tot = 0;
  for (let a = 0; a < NARC; a++) { tot += cnt[a]; }
  for (let a = 0; a < NARC; a++) {
    if (!cnt[a]) continue;
    if (hit[a] / cnt[a] >= 0.7) { bad[a] = 1; nBad += cnt[a]; } else nGood += cnt[a];
  }
  if (nBad < 0.1 * tot || nGood < 0.1 * tot) return null;
  return (x, y) => bad[arcOf(x, y)] === 1;
}

/**
 * Turn a blocky box-sized segmentation mask into a smooth alpha channel for a cutout.
 * Pure (Node-testable). Interior stays 255, exterior 0, the edge is a ~`feather` px ramp. Pixels in the edge band whose
 * color is close to the background (median color of the non-mask pixels in the crop) are made more transparent, which
 * trims the halo that low-resolution masks leave around the item.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData  RGBA crop, same size as the mask
 * @param {Uint8Array} mask  w*h 0/1
 * @param {{feather?:number}} [opts]  feather radius in px (default 2, 0 = hard edge)
 * @returns {Uint8ClampedArray} alpha, length w*h
 */
export function refineMaskAlpha(imageData, mask, opts = {}) {
  const w = imageData && imageData.width | 0, h = imageData && imageData.height | 0;
  const out = new Uint8ClampedArray(Math.max(0, w * h));
  if (!(w > 0 && h > 0) || !mask || mask.length < w * h) return out;
  const feather = Number.isFinite(opts.feather) ? Math.max(0, Math.min(12, Math.round(opts.feather))) : 2;
  if (feather === 0) { for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 255 : 0; return out; }
  const N = w * h;
  // mask -> float, box blur (separable, two passes ~ triangle kernel), edge handled by clamping
  let a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = mask[i] ? 1 : 0;
  const tmp = new Float32Array(N);
  const r = feather;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s / (2 * r + 1);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      a[y * w + x] = s / (2 * r + 1);
    }
  }
  // background color from pixels clearly outside the mask
  const d = imageData.data;
  const R = [], G = [], B = [];
  for (let i = 0; i < N; i += 1) {
    if (a[i] < 0.01 && d[i * 4 + 3] > 127 && (i & 3) === 0) { R.push(d[i * 4]); G.push(d[i * 4 + 1]); B.push(d[i * 4 + 2]); }
  }
  let bg = null;
  if (R.length >= 16) { const med = (v) => Float64Array.from(v).sort()[v.length >> 1]; bg = [med(R), med(G), med(B)]; }
  const bgLab = bg ? rgbToLab(bg[0], bg[1], bg[2]) : null;
  for (let i = 0; i < N; i++) {
    const v = a[i];
    if (v <= 0.02) { out[i] = 0; continue; }
    // sharpen the ramp a little: 0.2 -> 0, 0.8 -> 1 (the blur straddles the true edge)
    let t = Math.max(0, Math.min(1, (v - 0.2) / 0.6));
    t = t * t * (3 - 2 * t);
    if (bgLab && t < 0.98 && t > 0) {
      const lab = rgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      const dist = Math.hypot(lab[0] - bgLab[0], lab[1] - bgLab[1], lab[2] - bgLab[2]);
      if (dist < 8) t *= 0.5 + 0.5 * (dist / 8);
    }
    out[i] = Math.round(t * 255);
  }
  return out;
}

/**
 * How trustworthy is a cutout mask? Looks at the mask only (box-sized, w*h).
 *   fill     share of the box that is "item"
 *   largest  share of item pixels in the biggest connected piece (1 = one solid piece)
 *   holes    share of the filled silhouette that is enclosed background (see-through holes)
 *   compact  edge length relative to a plain blob of the same area (carved/striped masks are >> 1)
 *   full     the mask covers (nearly) the whole box: "keep it all", not a real cutout
 * `ok` is false when the cutout would likely look chewed up, so callers should keep the plain photo.
 * @returns {{ok:boolean,score:number,fill:number,largest:number,holes:number,compact:number,full:boolean}}
 */
export function maskQuality(mask, w, h) {
  const N = w * h;
  const bad = { ok: false, score: 0, fill: 0, largest: 0, holes: 0, compact: 0, full: false };
  if (!mask || !(N > 0) || mask.length < N) return bad;
  let on = 0;
  for (let i = 0; i < N; i++) if (mask[i]) on++;
  if (!on) return bad;
  const fill = on / N;
  if (fill >= 0.985) return { ok: true, score: 1, fill, largest: 1, holes: 0, compact: 1, full: true };
  // 4-connected components of the item
  const lab = new Int32Array(N), stk = new Int32Array(N);
  let largest = 0, edge = 0;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || lab[s]) continue;
    let sp = 0, cnt = 0; stk[sp++] = s; lab[s] = 1;
    while (sp) {
      const p = stk[--sp]; cnt++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stk[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stk[sp++] = p + 1; }
      if (p >= w && mask[p - w] && !lab[p - w]) { lab[p - w] = 1; stk[sp++] = p - w; }
      if (p + w < N && mask[p + w] && !lab[p + w]) { lab[p + w] = 1; stk[sp++] = p + w; }
    }
    if (cnt > largest) largest = cnt;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!mask[p]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - w] || !mask[p + w]) edge++;
  }
  // enclosed background: flood the off-pixels from the frame
  const seen = new Uint8Array(N); let qt = 0;
  const seed = (p) => { if (!mask[p] && !seen[p]) { seen[p] = 1; stk[qt++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qt) {
    const p = stk[--qt], x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p + w < N) seed(p + w);
  }
  let enclosed = 0;
  for (let p = 0; p < N; p++) if (!mask[p] && !seen[p]) enclosed++;
  const holes = enclosed / (on + enclosed);
  const largestShare = largest / on;
  const compact = edge / (4 * Math.sqrt(on));
  const ok = fill >= 0.2 && largestShare >= 0.85 && holes <= 0.06 && compact <= 2.2;
  const score = Math.max(0, Math.min(1, Math.min(largestShare, 1 - holes * 4, 1.6 - compact * 0.5, fill * 3)));
  return { ok, score, fill, largest: largestShare, holes, compact, full: false };
}

/**
 * Mask for one user-chosen crop (review step, after the box was edited): the biggest item in the crop. When the
 * crop holds nothing separable (the garment fills it, or it is carved up) the answer is the whole crop.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData  small RGBA crop (<= ~256px)
 * @returns {{mask:Uint8Array,quality:object,full:boolean}} mask is imageData-sized
 */
export function segmentCrop(imageData) {
  const w = imageData.width, h = imageData.height;
  let best = null;
  try {
    for (const b of segmentItems(imageData, { padding: 0, maxItems: 6, single: true }) || []) if (b.mask && (!best || b.area > best.area)) best = b;
  } catch (e) { best = null; }
  let mask = null;
  if (best) {
    mask = new Uint8Array(w * h);
    for (let y = 0; y < best.h; y++) for (let x = 0; x < best.w; x++) if (best.mask[y * best.w + x] && best.y + y < h && best.x + x < w) mask[(best.y + y) * w + best.x + x] = 1;
  }
  const q = mask ? maskQuality(mask, w, h) : null;
  if (!mask || !q.ok) { mask = new Uint8Array(w * h).fill(1); return { mask, quality: maskQuality(mask, w, h), full: true }; }
  return { mask, quality: q, full: q.full };
}
