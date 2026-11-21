// Realistic plaid / flannel garments for segmentation tests. Pure; scenes are {width,height,data,truth:[{mask,box}]}.
import { rng } from './synth.js';
import { woodGrain, stripedSheet } from './adv-scenes.js';

const gauss = (r) => (r() + r() + r() + r() - 2) * 1.732;
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Plaid textures: (x,y) in garment px -> [r,g,b]. `p` is the repeat in px. */
export const PLAIDS = {
  buffalo: (p = 44) => (x, y) => {
    const a = Math.floor(x / p) % 2, b = Math.floor(y / p) % 2;
    const n = a + b;
    return n === 0 ? [188, 32, 38] : n === 1 ? [112, 22, 28] : [26, 24, 24];
  },
  tartan: (p = 96) => (x, y) => {
    const fx = ((x % p) + p) % p / p, fy = ((y % p) + p) % p / p;
    const band = (t) => (t < 0.36 ? 0 : t < 0.5 ? 1 : t < 0.54 ? 2 : t < 0.86 ? 3 : t < 0.9 ? 4 : 0); // navy, green, white line, navy, dark line
    const cols = [[28, 44, 104], [30, 104, 62], [236, 236, 228], [28, 44, 104], [18, 18, 26]];
    const a = cols[band(fx)], b = cols[band(fy)];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  },
  gingham: (p = 14) => (x, y) => {
    const a = Math.floor(x / p) % 2, b = Math.floor(y / p) % 2;
    const n = a + b;
    return n === 0 ? [232, 232, 230] : n === 1 ? [182, 182, 184] : [128, 128, 132];
  },
  flannel: (p = 70) => (x, y) => {
    const fx = ((x % p) + p) % p / p, fy = ((y % p) + p) % p / p;
    let c = [226, 210, 174];
    const bandx = fx > 0.3 && fx < 0.5, bandy = fy > 0.3 && fy < 0.5;
    if (bandx && bandy) c = [92, 58, 38]; else if (bandx || bandy) c = [150, 100, 66];
    if (Math.abs(fx - 0.85) < 0.015 || Math.abs(fy - 0.85) < 0.015) c = [176, 86, 52];
    return c;
  },
};

/** T-shirt style silhouette in unit coords (long-sleeve button shirt laid flat). */
const SHIRT = [[0.3, 0], [0.4, 0.045], [0.6, 0.045], [0.7, 0], [1, 0.2], [0.94, 0.62], [0.82, 0.58], [0.8, 1], [0.2, 1], [0.18, 0.58], [0.06, 0.62], [0, 0.2]];

function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export const BACKGROUNDS = {
  whiteSheet: () => [236, 236, 232],
  beigeCarpet: () => [200, 182, 152],
  woodFloor: woodGrain([176, 132, 84]),
  darkFloor: () => [58, 58, 62],
  grayFloor: () => [128, 128, 130],
  stripedSheet: stripedSheet([232, 230, 222], [186, 206, 228], 80),
};

/**
 * @param {{bg?:string, plaid?:string, scale?:number, cx?:number, cy?:number, size?:[number,number], rot?:number,
 *   others?:Array, noise?:number, seed?:number, W?:number, H?:number, pattern?:Function}} o
 * Returns {width,height,data,truth:[{box,mask}]}. truth[0] is the plaid shirt; `others` are solid rects
 * ({x,y,w,h,color}) drawn beside it.
 */
export function plaidScene({ bg = 'whiteSheet', plaid = 'buffalo', pattern, W = 1024, H = 768, cx = 512, cy = 384, size = [560, 520], rot = 6, others = [], noise = 4, seed = 21, bgFn } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const tex = pattern || PLAIDS[plaid]();
  const bgf = bgFn || BACKGROUNDS[bg];
  const r = rng(seed);
  const [sw, sh] = size, ang = (rot * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const masks = [new Uint8Array(W * H), ...others.map(() => new Uint8Array(W * H))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;          // garment frame
      const ux = u / sw + 0.5, uy = v / sh + 0.5;
      let c, id = -1;
      if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1 && inPoly(SHIRT, ux, uy)) {
        id = 0;
        c = tex(u + sw, v + sh);
        // soft fabric shading: slow folds + a seam down the placket
        const fold = 1 + 0.07 * Math.sin(u / 47 + 1) * Math.cos(v / 61) + 0.05 * Math.sin(v / 23 + u / 90);
        const k = fold * (Math.abs(u) < 3 ? 0.8 : 1);
        c = [c[0] * k, c[1] * k, c[2] * k];
      } else {
        for (let j = 0; j < others.length; j++) {
          const o = others[j];
          if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) { id = j + 1; c = o.color; }
        }
        if (id < 0) {
          c = bgf(x, y, W, H);
          // soft contact shadow at the shirt edge side (bottom-right)
        }
      }
      if (id >= 0) masks[id][y * W + x] = 1;
      const n = noise ? gauss(r) * noise : 0;
      const i = (y * W + x) * 4;
      data[i] = clamp(c[0] + n); data[i + 1] = clamp(c[1] + n * 0.9); data[i + 2] = clamp(c[2] + n * 1.1); data[i + 3] = 255;
    }
  }
  const truth = masks.map((m) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let p = 0; p < W * H; p++) if (m[p]) { const x = p % W, y = (p - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, mask: m };
  });
  return { width: W, height: H, data, truth };
}

/** Area-average downsample by integer factor (what the app does before segmenting: ~256px work image). */
export function downsample(im, f) {
  const w = Math.floor(im.width / f), h = Math.floor(im.height / f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = [0, 0, 0];
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) { const i = ((y * f + yy) * im.width + x * f + xx) * 4; s[0] += im.data[i]; s[1] += im.data[i + 1]; s[2] += im.data[i + 2]; }
    const o = (y * w + x) * 4, n = f * f;
    data[o] = s[0] / n; data[o + 1] = s[1] / n; data[o + 2] = s[2] / n; data[o + 3] = 255;
  }
  const truth = im.truth.map((t) => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = 0;
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) c += t.mask[(y * f + yy) * im.width + x * f + xx];
      m[y * w + x] = c * 2 >= f * f ? 1 : 0;
    }
    return { mask: m };
  });
  return { width: w, height: h, data, truth };
}

/** Best detection for a truth mask: max intersection. Returns {coverage, iou, boxes} in full-image mask space. */
export function score(im, truthMask, dets) {
  const W = im.width, H = im.height, N = W * H;
  let best = { coverage: 0, iou: 0 }, tArea = 0;
  for (let p = 0; p < N; p++) tArea += truthMask[p];
  for (const d of dets) {
    const full = new Uint8Array(N);
    let dArea = 0;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (d.mask[y * d.w + x]) { const X = d.x + x, Y = d.y + y; if (X < W && Y < H) { full[Y * W + X] = 1; dArea++; } }
    let inter = 0;
    for (let p = 0; p < N; p++) inter += full[p] & truthMask[p];
    const cov = inter / tArea, iou = inter / (tArea + dArea - inter);
    if (cov > best.coverage) best = { coverage: cov, iou };
  }
  return best;
}
