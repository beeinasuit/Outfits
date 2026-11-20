// Flat-lay segmentation: split a photo of several clothes on a plain background into item boxes.
// Pure (no DOM). Works on {width,height,data: Uint8ClampedArray RGBA}.
//
// Pipeline (all at a working resolution of <= ~384px on the long edge, then scaled back up):
//   1. area-average downsample, convert to CIELAB
//   2. model the background from the border ring: robust plane (or quadratic, for vignettes) fit per Lab channel
//   3. foreground = far from the model in chroma, or lighter, or much darker. Mild darkening with the same hue is
//      treated as a shadow and stays background.
//   4. morphology: open 3x3 (kills speckle, keeps thin belts), close 5x5, fill enclosed holes
//   5. iterative connected components, merge overlapping boxes and tiny fragments next to big items
//   6. pad, clamp, sort row-major, cap, build per-box masks at full resolution
//
// Known limitations: items that touch each other merge into one box; an item whose colour is within a few
// delta-E of the sheet (white shirt on a white sheet) is only partly found; strongly textured/patterned
// backgrounds raise the tolerance and can swallow low-contrast items.
import { rgbToLab } from './color.js';

const WORK_MAX = 384;

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

  // 2. background model from the border ring
  const t = Math.max(2, Math.round(0.015 * Math.min(w, h)));
  const us = [], vs = [], lv = [], av = [], bv = [];
  const stepB = 1;
  const addB = (x, y) => {
    const p = y * w + x;
    if (!solidPx[p]) return;
    us.push(x / w - 0.5); vs.push(y / h - 0.5); lv.push(L[p]); av.push(A[p]); bv.push(B[p]);
  };
  for (let y = 0; y < h; y += stepB) {
    for (let x = 0; x < w; x++) {
      if (y < t || y >= h - t || x < t || x >= w - t) addB(x, y);
    }
  }
  if (us.length < 24) return [];
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

  // 3. classify
  let M = new Uint8Array(N);
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
      if (cd > tolC || dL > tolL || dL < -(tolL + 0.2 * Math.max(bl, 0))) M[p] = 1;
    }
  }

  // 4. morphology
  const T1 = new Uint8Array(N), T2 = new Uint8Array(N);
  erode(M, w, h, 1, T1, T2); dilate(T2, w, h, 1, T1, M);           // open 3x3
  dilate(M, w, h, 2, T1, T2); erode(T2, w, h, 2, T1, M);           // close 5x5
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
  if (fg === 0) return [];
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
  let live = comps.filter((c) => c.area >= tinyArea);
  live.sort((a, b) => b.area - a.area);
  live = live.slice(0, 80);
  if (!live.length) return [];

  const parent = live.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const grp = live.map((c) => ({ ...c }));      // group stats, indexed by root
  const minArea = minAreaFrac * N;
  const gapMax = 0.04 * Math.max(w, h);
  let changed = true;
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
  if (!groups.length) return [];
  const rootToGroup = new Map(groups.map((g, k) => [g.root, k]));
  live.forEach((c, i) => { const k = rootToGroup.get(find(i)); if (k !== undefined) groupOfComp[c.id] = k; });

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
        const lab = labels[wy * w + wx];
        if (lab && groupOfComp[lab] === k) { mask[y * bw + x] = 1; cnt++; }
      }
    }
    return { x: X0, y: Y0, w: bw, h: bh, area: cnt, mask };
  });

  // sort top-left -> bottom-right: rows by centre-y with tolerance, then by x
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
}

/**
 * Turn a blocky box-sized segmentation mask into a smooth alpha channel for a cutout.
 * Pure (Node-testable). Interior stays 255, exterior 0, the edge is a ~`feather` px ramp. Pixels in the edge band whose
 * colour is close to the background (median colour of the non-mask pixels in the crop) are made more transparent, which
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
  // background colour from pixels clearly outside the mask
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
