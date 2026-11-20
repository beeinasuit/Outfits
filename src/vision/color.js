// Colour naming, dominant-colour extraction and pattern guessing. Pure (no DOM): Node 22 + browsers.
import { COLOR_FAMILIES } from '../model.js';

// ---------- colour science ----------
const SRGB_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB (0..255) -> [L, a, b] (D65). */
export function rgbToLab(r, g, b) {
  const R = SRGB_LIN[r < 0 ? 0 : r > 255 ? 255 : r | 0];
  const G = SRGB_LIN[g < 0 ? 0 : g > 255 ? 255 : g | 0];
  const B = SRGB_LIN[b < 0 ? 0 : b > 255 ? 255 : b | 0];
  const x = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = fLab(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = fLab((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 between two Lab triples. */
export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const Cm7 = Math.pow(Cm, 7);
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 6103515625)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  let h1p = Math.atan2(b1, a1p) / rad; if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) / rad; if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const a = dLp / Sl, b = dCp / Sc, c = dHp / Sh;
  return Math.sqrt(a * a + b * b + c * c + Rt * b * c);
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const rgbToHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------- reference swatches (several per family) ----------
const SWATCH_HEX = {
  black: ['#1c1c1e', '#111111', '#232325', '#0b0b0d', '#1a1a1a', '#262626', '#16181c'],
  charcoal: ['#3a3d42', '#444444', '#4a4a4a', '#36454f', '#3d3d3d', '#2f3236', '#50525a'],
  grey: ['#8e9196', '#9a9a9a', '#808080', '#b0b0b0', '#a8aaad', '#6f7378', '#c4c5c7', '#74777c'],
  white: ['#f5f5f2', '#ffffff', '#fafafa', '#ececec', '#f0efe9', '#e6e6e6'],
  cream: ['#efe6d2', '#f3ecd8', '#f5efe0', '#ebe0c8', '#f0e9d6', '#fffff0', '#e9dfc7'],
  beige: ['#d8c3a0', '#c3b091', '#c9b99a', '#b8a88a', '#e0cfae', '#c8a97e', '#a89878', '#d2b48c', '#c19a6b', '#bcae92'],
  brown: ['#6b4a2f', '#5a3d28', '#7a5230', '#4a3222', '#3b2a1e', '#8b5a2b', '#5b4030', '#7a5a3c', '#654321'],
  navy: ['#1f2a44', '#22304f', '#2b3a5c', '#1a2238', '#14213d', '#1c2541', '#263248', '#2c3e66', '#1b2a49', '#27324d', '#202a3e'],
  denim: ['#4a6286', '#5b7597', '#3d5272', '#34496b', '#6b86a8', '#3a4f70', '#55729a', '#7f9cc0', '#8ba6c8', '#9fb6d0', '#5f7a9f'],
  olive: ['#5d6136', '#6b6b3a', '#4b5320', '#78783c', '#556b2f', '#6c7048', '#5a5a3c', '#6b6e3f', '#4f5232'],
  'light-blue': ['#9cc3e6', '#a6c8e8', '#b5d3ee', '#87ceeb', '#cfe3f5', '#8fbbe0', '#a9cdea'],
  blue: ['#2f6fd0', '#1e5bb8', '#3b82f6', '#0066cc', '#1f4fa8', '#2a64c5', '#4169e1', '#1f55b5'],
  teal: ['#1f8a8a', '#0f7173', '#2a9d9d', '#1f6f78', '#008080', '#1d7a80'],
  green: ['#2e8b4a', '#3a9d5d', '#4caf50', '#228b22', '#50a35a', '#6bbf59', '#3d9a40'],
  forest: ['#234d36', '#1e4d2b', '#2d4a35', '#1b3a2a', '#0b3d2e', '#355e3b', '#2a4a30'],
  yellow: ['#f2c94c', '#ffe135', '#f7dc6f', '#fcd34d', '#f5d742', '#f5dd5a'],
  mustard: ['#c99a2e', '#d4a017', '#b8860b', '#c8962a', '#bf8f1f', '#d9a441', '#d1a23a'],
  orange: ['#e8742a', '#f28c28', '#ff7f27', '#e67e22', '#f59e42', '#ea6a1f'],
  rust: ['#a4502a', '#b7410e', '#9c4a2a', '#8a3f20', '#b5532c', '#a0522d'],
  red: ['#d13b3b', '#c8102e', '#b22222', '#e03c31', '#a61c1c', '#b8242a', '#cc2f2f'],
  burgundy: ['#6d1f2f', '#5a1a28', '#7b1e34', '#4e1622', '#800020', '#722f37', '#5e1a2b', '#7a2335'],
  pink: ['#f2a7bb', '#f4b6c2', '#e88fa8', '#f8c8d4', '#ee82a0', '#ff69b4', '#f4b8c8'],
  purple: ['#6c4ab6', '#5b3a8c', '#7a3f9d', '#4b2e83', '#8e44ad', '#5a3a8a'],
  lavender: ['#b9a7e0', '#c8b8e8', '#a99bd1', '#d8cdee', '#c5b5e6'],
};
const SWATCHES = [];
for (const fam of Object.keys(COLOR_FAMILIES)) {
  const list = new Set([COLOR_FAMILIES[fam].hex, ...(SWATCH_HEX[fam] || [])]);
  for (const h of list) { const [r, g, b] = hexToRgb(h); SWATCHES.push({ fam, lab: rgbToLab(r, g, b) }); }
}
const NEUTRAL_LADDER = ['black', 'charcoal', 'grey', 'white'];
const LOUD = new Set(Object.keys(COLOR_FAMILIES).filter((k) => !COLOR_FAMILIES[k].neutral));

function familyOfLab(lab) {
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  if (C < 5.5) {                       // essentially achromatic: grey ladder by lightness
    return L < 19 ? 'black' : L < 43 ? 'charcoal' : L < 88 ? 'grey' : 'white';
  }
  // shadow tolerance: a dimmer cloth keeps its hue, so also test a lightened version of dark inputs
  let best = null, bestD = Infinity;
  const loudOk = C >= 11;              // pale/desaturated colours never become "loud" families
  for (const s of SWATCHES) {
    if (!loudOk && LOUD.has(s.fam)) continue;
    const d = deltaE2000(lab, s.lab);
    if (d < bestD) { bestD = d; best = s.fam; }
  }
  return best || 'grey';
}

/** Map one sRGB colour to the closest COLOR_FAMILIES key. */
export function nameColor(rgb) {
  if (!Array.isArray(rgb) && !ArrayBuffer.isView(rgb)) return 'grey';
  const [r, g, b] = rgb;
  if (!Number.isFinite(+r) && !Number.isFinite(+g) && !Number.isFinite(+b)) return 'grey';
  return familyOfLab(rgbToLab(+r || 0, +g || 0, +b || 0));
}

// ---------- helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GREY = () => [{ hex: COLOR_FAMILIES.grey.hex, family: 'grey', weight: 1 }];
const validImage = (im) => im && im.width > 0 && im.height > 0 && im.data && im.data.length >= im.width * im.height * 4;

/** Collect sample pixels (downsampled), optionally filtered by mask. Returns arrays of rgb + coords. */
function samplePixels(im, mask, maxSamples = 12000) {
  const { width: w, height: h, data } = im;
  const total = w * h;
  const step = Math.max(1, Math.floor(Math.sqrt(total / maxSamples)));
  const xs = [], ys = [], rgb = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      if (data[i * 4 + 3] < 128) continue;
      xs.push(x); ys.push(y);
      rgb.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    }
  }
  return { xs, ys, rgb, n: xs.length, step };
}

function medianOf(arr) {
  if (!arr.length) return 0;
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[s.length >> 1];
}

function borderMedianRGB(im) {
  const { width: w, height: h, data } = im;
  const t = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const R = [], G = [], B = [];
  const stepB = Math.max(1, Math.floor((w + h) / 200));
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    R.push(data[i]); G.push(data[i + 1]); B.push(data[i + 2]);
  };
  for (let y = 0; y < h; y += stepB) {
    for (let x = 0; x < w; x += stepB) {
      if (x < t || y < t || x >= w - t || y >= h - t) push(x, y);
    }
  }
  if (!R.length) return null;
  return [medianOf(R), medianOf(G), medianOf(B)];
}

/** Fraction of border-ring samples within dE ~9 of the border median (1 = perfectly uniform background). */
function borderUniformity(im, bg) {
  const { width: w, height: h, data } = im;
  const t = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  const stepB = Math.max(1, Math.floor((w + h) / 200));
  const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
  let n = 0, near = 0;
  for (let y = 0; y < h; y += stepB) {
    for (let x = 0; x < w; x += stepB) {
      if (!(x < t || y < t || x >= w - t || y >= h - t)) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      n++;
      if (deltaE2000(rgbToLab(data[i], data[i + 1], data[i + 2]), bgLab) < 9) near++;
    }
  }
  return n ? near / n : 0;
}

/**
 * Estimate the colour cast of a photo from its border ring (the sheet/floor the clothes lie on) and return an RGB
 * the caller can pass as `opts.whitePoint` to extractColors. Call once per PHOTO (full frame), not per crop.
 * Grey-world on the border, deliberately gentle: the per-channel cast is clamped to +-25% and a +-4% dead band is
 * ignored so a legitimately cream/coloured sheet is not "corrected" away. Returns null when there is no usable border.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @returns {[number,number,number]|null}
 */
export function estimateWhitePoint(imageData) {
  try {
    if (!validImage(imageData)) return null;
    const bg = borderMedianRGB(imageData);
    if (!bg) return null;
    const Y = (bg[0] + bg[1] + bg[2]) / 3;
    if (Y < 40) return null;
    const dead = (v) => { const d = v - 1; const a = Math.max(0, Math.abs(d) - 0.04); return 1 + Math.sign(d) * Math.min(0.25, a); };
    return [Y * dead(bg[0] / Y), Y * dead(bg[1] / Y), Y * dead(bg[2] / Y)];
  } catch (e) {
    return null;
  }
}

/** Per-channel gains that map `wp` to neutral grey of the same mean level; clamped to [0.6, 1.7]; null = no correction. */
export function whiteGains(wp) {
  if (!Array.isArray(wp) && !ArrayBuffer.isView(wp)) return null;
  const v = [+wp[0], +wp[1], +wp[2]];
  if (!v.every((x) => Number.isFinite(x) && x > 5)) return null;
  const Y = (v[0] + v[1] + v[2]) / 3;
  const g = v.map((x) => Math.max(0.6, Math.min(1.7, Y / x)));
  return g.every((x) => Math.abs(x - 1) < 0.005) ? null : g;
}

// ---------- extractColors ----------
/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {object} [opts]
 * @param {Uint8Array} [opts.mask]  per-pixel 0/1 mask of the item (preferred)
 * @param {number} [opts.maxColors=3]  1..4; NaN/0/negative fall back to 3, larger values are capped at 4
 * @param {boolean} [opts.ignoreBackground=true]  without a mask: drop pixels close to a UNIFORM border colour
 * @param {number[]} [opts.whitePoint]  RGB the caller believes is neutral (e.g. estimateWhitePoint(fullPhoto) or the
 *   sheet median); channels are rescaled so it becomes grey (gains clamped to 0.6..1.7). Output hex values are corrected.
 * @param {boolean} [opts.autoWhiteBalance=false]  shorthand for whitePoint = estimateWhitePoint(imageData); only
 *   meaningful when imageData is a full photo with a visible background, not a tight crop.
 * @returns {{hex:string,family:string,weight:number}[]}
 */
export function extractColors(imageData, opts = {}) {
  const { mask = null, ignoreBackground = true } = opts || {};
  const mcRaw = opts && Number.isFinite(opts.maxColors) && opts.maxColors >= 1 ? Math.floor(opts.maxColors) : 3;
  const maxColors = Math.min(4, mcRaw);
  try {
    if (!validImage(imageData)) return GREY();
    const useMask = mask && mask.length >= imageData.width * imageData.height ? mask : null;
    const smp = samplePixels(imageData, useMask);
    if (smp.n === 0) return GREY();
    let wp = opts && opts.whitePoint ? opts.whitePoint : (opts && opts.autoWhiteBalance ? estimateWhitePoint(imageData) : null);
    const gains = wp ? whiteGains(wp) : null;
    if (gains) for (let i = 0; i < smp.rgb.length; i += 3) {
      smp.rgb[i] = Math.min(255, smp.rgb[i] * gains[0]); smp.rgb[i + 1] = Math.min(255, smp.rgb[i + 1] * gains[1]); smp.rgb[i + 2] = Math.min(255, smp.rgb[i + 2] * gains[2]);
    }
    let idx = Array.from({ length: smp.n }, (_, i) => i);

    if (!useMask && ignoreBackground) {
      let bg = borderMedianRGB(imageData);
      const uniform = bg ? borderUniformity(imageData, bg) : 0;
      if (bg && gains) bg = bg.map((v, i) => Math.min(255, v * gains[i]));
      if (bg && uniform >= 0.8) {
        const bgLab = rgbToLab(bg[0], bg[1], bg[2]);
        const keep = idx.filter((i) => {
          const lab = rgbToLab(smp.rgb[i * 3], smp.rgb[i * 3 + 1], smp.rgb[i * 3 + 2]);
          return deltaE2000(lab, bgLab) > 9;
        });
        if (keep.length >= Math.max(8, smp.n * 0.02)) idx = keep;
      }
    }

    // Lab points
    const n = idx.length;
    const P = new Float64Array(n * 3);
    const labs = new Array(n);
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const lab = rgbToLab(smp.rgb[i * 3], smp.rgb[i * 3 + 1], smp.rgb[i * 3 + 2]);
      P[k * 3] = lab[0]; P[k * 3 + 1] = lab[1]; P[k * 3 + 2] = lab[2];
      labs[k] = lab;
    }
    const K = Math.min(6, n);
    const rnd = mulberry32(0x9e3779b1);
    // k-means++ init
    const cent = [];
    const first = Math.floor(rnd() * n);
    cent.push([P[first * 3], P[first * 3 + 1], P[first * 3 + 2]]);
    const dist = new Float64Array(n).fill(Infinity);
    while (cent.length < K) {
      const c = cent[cent.length - 1];
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const d = (P[k * 3] - c[0]) ** 2 + (P[k * 3 + 1] - c[1]) ** 2 + (P[k * 3 + 2] - c[2]) ** 2;
        if (d < dist[k]) dist[k] = d;
        sum += dist[k];
      }
      if (sum <= 1e-9) break;
      let r = rnd() * sum, pick = n - 1;
      for (let k = 0; k < n; k++) { r -= dist[k]; if (r <= 0) { pick = k; break; } }
      cent.push([P[pick * 3], P[pick * 3 + 1], P[pick * 3 + 2]]);
    }
    const kc = cent.length;
    const assign = new Int32Array(n);
    for (let iter = 0; iter < 12; iter++) {
      let moved = 0;
      for (let k = 0; k < n; k++) {
        let bi = 0, bd = Infinity;
        for (let c = 0; c < kc; c++) {
          const d = (P[k * 3] - cent[c][0]) ** 2 + (P[k * 3 + 1] - cent[c][1]) ** 2 + (P[k * 3 + 2] - cent[c][2]) ** 2;
          if (d < bd) { bd = d; bi = c; }
        }
        if (assign[k] !== bi) { assign[k] = bi; moved++; }
      }
      const sums = Array.from({ length: kc }, () => [0, 0, 0, 0]);
      for (let k = 0; k < n; k++) {
        const s = sums[assign[k]];
        s[0] += P[k * 3]; s[1] += P[k * 3 + 1]; s[2] += P[k * 3 + 2]; s[3]++;
      }
      for (let c = 0; c < kc; c++) if (sums[c][3]) cent[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      if (!moved) break;
    }
    // mean RGB per cluster (linear-ish average in sRGB space is fine for display)
    let clusters = Array.from({ length: kc }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let k = 0; k < n; k++) {
      const i = idx[k], c = clusters[assign[k]];
      c.r += smp.rgb[i * 3]; c.g += smp.rgb[i * 3 + 1]; c.b += smp.rgb[i * 3 + 2]; c.n++;
    }
    clusters = clusters.filter((c) => c.n > 0).map((c) => {
      const rgb = [c.r / c.n, c.g / c.n, c.b / c.n];
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      return { rgb, lab, n: c.n, family: familyOfLab(lab) };
    });
    // merge same family / near clusters (largest first)
    clusters.sort((a, b) => b.n - a.n);
    const merged = [];
    for (const c of clusters) {
      const m = merged.find((o) => o.family === c.family || deltaE2000(o.lab, c.lab) < 10);
      if (m) {
        const t = m.n + c.n;
        m.rgb = m.rgb.map((v, i) => (v * m.n + c.rgb[i] * c.n) / t);
        m.n = t;
      } else merged.push({ ...c });
    }
    const totalN = merged.reduce((s, c) => s + c.n, 0);
    let out = merged.filter((c) => c.n / totalN >= 0.06);
    if (!out.length) out = [merged[0]];
    out.sort((a, b) => b.n - a.n);
    out = out.slice(0, Math.max(1, maxColors));
    const sumN = out.reduce((s, c) => s + c.n, 0);
    return out.map((c) => ({
      hex: rgbToHex(c.rgb[0], c.rgb[1], c.rgb[2]),
      family: nameColor(c.rgb),
      weight: c.n / sumN,
    }));
  } catch (e) {
    return GREY();
  }
}

// ---------- guessPattern ----------
/** @returns {'solid'|'stripe'|'check'|'polka'|'textured'|'print'} */
export function guessPattern(imageData, opts = {}) {
  try {
    if (!validImage(imageData)) return 'solid';
    const { width: W, height: H, data } = imageData;
    const mask = opts.mask && opts.mask.length >= W * H ? opts.mask : null;
    // box-downsample to ~96px on the long edge
    const f = Math.max(1, Math.floor(Math.max(W, H) / 96));
    const w = Math.floor(W / f), h = Math.floor(H / f);
    if (w < 6 || h < 6) return 'solid';
    const lum = new Float32Array(w * h), ok = new Uint8Array(w * h);
    const cols = new Map();
    let nOk = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0, rs = 0, gs = 0, bs = 0;
        for (let yy = 0; yy < f; yy++) {
          for (let xx = 0; xx < f; xx++) {
            const i = (y * f + yy) * W + (x * f + xx);
            if (mask && !mask[i]) continue;
            if (data[i * 4 + 3] < 128) continue;
            rs += data[i * 4]; gs += data[i * 4 + 1]; bs += data[i * 4 + 2]; c++;
          }
        }
        if (c < f * f * 0.75) continue;
        const r = rs / c, g = gs / c, b = bs / c;
        lum[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
        ok[y * w + x] = 1; nOk++;
        const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
        cols.set(key, (cols.get(key) || 0) + 1);
      }
    }
    if (nOk < 100) return 'solid';
    let mean = 0;
    for (let i = 0; i < w * h; i++) if (ok[i]) mean += lum[i];
    mean /= nOk;
    let varr = 0;
    for (let i = 0; i < w * h; i++) if (ok[i]) varr += (lum[i] - mean) ** 2;
    const std = Math.sqrt(varr / nOk);
    // Sobel on interior valid pixels
    const BINS = 8, hist = new Float64Array(BINS);
    let strong = 0, valid = 0, Jxx = 0, Jyy = 0, Jxy = 0, eTot = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!ok[i] || !ok[i - 1] || !ok[i + 1] || !ok[i - w] || !ok[i + w]) continue;
        valid++;
        const gx = (lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - 1] + lum[i + w - 1]);
        const gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1]);
        const mag = Math.hypot(gx, gy) / 4;
        if (mag < 12) continue;
        strong++;
        let ang = Math.atan2(gy, gx); if (ang < 0) ang += Math.PI;
        const e = mag * mag;
        hist[Math.min(BINS - 1, Math.floor((ang / Math.PI) * BINS + 0.5) % BINS)] += e;
        eTot += e; Jxx += gx * gx; Jyy += gy * gy; Jxy += gx * gy;
      }
    }
    if (!valid || std < 14 || strong / valid < 0.03) return 'solid';
    // orientation concentration: energy in best bin (+/- neighbour)
    let top = 0, topBin = 0;
    for (let b = 0; b < BINS; b++) {
      const e = hist[b] + 0.5 * (hist[(b + 1) % BINS] + hist[(b + BINS - 1) % BINS]);
      if (e > top) { top = e; topBin = b; }
    }
    const share1 = (hist[topBin] + hist[(topBin + 1) % BINS] + hist[(topBin + BINS - 1) % BINS]) / eTot;
    const ortho = (topBin + BINS / 2) % BINS;
    const share2 = (hist[ortho] + hist[(ortho + 1) % BINS] + hist[(ortho + BINS - 1) % BINS]) / eTot;
    const coherence = Math.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy * Jxy) / (Jxx + Jyy + 1e-9);
    let bigCols = 0;
    for (const c of cols.values()) if (c / nOk > 0.04) bigCols++;
    const edgeFrac = strong / valid;
    let topColFrac = 0;
    for (const c of cols.values()) topColFrac = Math.max(topColFrac, c / nOk);
    const pure = (hist[topBin] + hist[ortho]) / eTot;   // energy in exactly two orthogonal orientation bins
    if (share1 > 0.78 && coherence > 0.6 && edgeFrac > 0.05) return 'stripe';
    if (share1 + share2 > 0.7 && share2 > 0.22 && edgeFrac > 0.08 && pure > 0.6) return 'check';   // straight orthogonal lines
    if (bigCols >= 5 && edgeFrac > 0.2) return 'print';
    // isotropic blobs (edges in all directions) in <= 3 colours with strong contrast: polka dots
    if (bigCols <= 3 && pure < 0.6 && std > 40 && edgeFrac > 0.12 && edgeFrac < 0.45 && topColFrac > 0.4) return 'polka';
    if (std > 22 && edgeFrac > 0.15) return 'textured';
    return 'solid';
  } catch (e) {
    return 'solid';
  }
}
