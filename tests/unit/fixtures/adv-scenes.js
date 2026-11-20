// Scene renderer for the adversarial vision tests: rotated items, patterned backgrounds, white-balance, JPEG-ish blocks.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function itemGeom(it) {
  const a = ((it.angle || 0) * Math.PI) / 180; const cx = it.x + it.w / 2; const cy = it.y + it.h / 2;
  const cos = Math.cos(a); const sin = Math.sin(a);
  const hw = it.w / 2; const hh = it.h / 2;
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => [cx + px * cos - py * sin, cy + px * sin + py * cos]);
  const xs = corners.map((c) => c[0]); const ys = corners.map((c) => c[1]);
  return { cx, cy, cos, sin, hw, hh, bb: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
}
function inside(it, g, x, y) {
  const dx = x - g.cx; const dy = y - g.cy;
  const u = dx * g.cos + dy * g.sin; const v = -dx * g.sin + dy * g.cos; // rotate into item frame
  if (Math.abs(u) > g.hw || Math.abs(v) > g.hh) return false;
  if (it.shape === 'ellipse') return (u / g.hw) ** 2 + (v / g.hh) ** 2 <= 1;
  if (it.shape === 'shirt') { const bx = (u + g.hw) / it.w; const by = (v + g.hh) / it.h; return by < 0.35 || (bx > 0.2 && bx < 0.8); }
  return true;
}

/**
 * @param {{width,height,bg,items,noise,gradient,vignette,side,shadow,shadowOffset,jpeg,wb,seed,itemPattern}} o
 * bg: [r,g,b] or (x,y,W,H)=>[r,g,b]; side: 0..1 one-sided window light (left bright -> right dark)
 * wb: [kr,kg,kb] multiplicative white-balance; jpeg: 8x8 block offset amplitude
 */
export function render(o) {
  const { width: W, height: H, items = [], noise = 0, gradient = 0, vignette = 0, side = 0, shadow = 0, shadowOffset = [10, 14], jpeg = 0, wb = [1, 1, 1], seed = 11 } = o;
  const bg = o.bg || [225, 222, 215];
  const data = new Uint8ClampedArray(W * H * 4);
  const geoms = items.map(itemGeom);
  const R = rng(seed);
  const blk = jpeg ? new Float32Array(Math.ceil(W / 8) * Math.ceil(H / 8) * 3) : null;
  if (blk) for (let i = 0; i < blk.length; i++) blk[i] = (R() - 0.5) * 2 * jpeg;
  const bw = Math.ceil(W / 8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let k = -1;
      for (let j = items.length - 1; j >= 0; j--) {
        const b = geoms[j].bb;
        if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
        if (inside(items[j], geoms[j], x, y)) { k = j; break; }
      }
      let c;
      if (k >= 0) c = typeof items[k].color === 'function' ? items[k].color(x, y) : items[k].color;
      else c = typeof bg === 'function' ? bg(x, y, W, H) : bg;
      let m = 1 + gradient * ((x / W - 0.5) * 0.8 + (y / H - 0.5) * 0.6);
      if (side) m *= 1 + side * (0.5 - x / W);
      if (vignette) m *= 1 - vignette * (((x / W - 0.5) ** 2 + (y / H - 0.5) ** 2) * 2);
      if (shadow && k < 0) {
        const sx = x - shadowOffset[0]; const sy = y - shadowOffset[1];
        for (let j = 0; j < items.length; j++) { const b = geoms[j].bb; if (sx >= b.x && sy >= b.y && sx <= b.x + b.w && sy <= b.y + b.h && inside(items[j], geoms[j], sx, sy)) { m *= 1 - shadow; break; } }
      }
      const n = noise ? (R() + R() + R() - 1.5) * 2 * noise : 0;
      const i = (y * W + x) * 4;
      let r = c[0] * m + n; let g = c[1] * m + n * 0.9; let b2 = c[2] * m + n * 1.1;
      if (blk) { const bi = ((y >> 3) * bw + (x >> 3)) * 3; r += blk[bi]; g += blk[bi + 1]; b2 += blk[bi + 2]; }
      data[i] = clamp(r * wb[0]); data[i + 1] = clamp(g * wb[1]); data[i + 2] = clamp(b2 * wb[2]); data[i + 3] = 255;
    }
  }
  const clip = (b) => { const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(W, b.x + b.w), y1 = Math.min(H, b.y + b.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  return { width: W, height: H, data, truth: geoms.map((g) => clip(g.bb)), colors: items.map((it) => it.color) };
}

export function iou(a, b) {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y); const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}
/** For each truth box, best IoU among detected boxes (0 if none). */
export function bestIous(truth, boxes) { return truth.map((t) => boxes.reduce((m, b) => Math.max(m, iou(t, b)), 0)); }

export const PALETTE = [[31, 42, 68], [196, 60, 50], [60, 90, 60], [200, 160, 60], [90, 70, 120], [40, 40, 44], [150, 150, 155], [160, 100, 60]];

/** Layout of n items in a W x H frame on a grid, each cell with margin. */
export function gridItems(n, W = 1024, H = 768, { colors = PALETTE, fill = 0.7, shape = ['rect', 'ellipse', 'shirt'] } = {}) {
  const cols = Math.ceil(Math.sqrt(n * W / H)); const rows = Math.ceil(n / cols);
  const cw = W / cols; const ch = H / rows;
  const out = [];
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) * cw; const cy = Math.floor(i / cols) * ch;
    out.push({ shape: shape[i % shape.length], x: cx + cw * (1 - fill) / 2, y: cy + ch * (1 - fill) / 2, w: cw * fill, h: ch * fill, color: colors[i % colors.length] });
  }
  return out;
}

export const woodGrain = ([r, g, b] = [150, 105, 65]) => (x, y, W, H) => {
  const ring = Math.sin((y / H) * 90 + Math.sin(x / 55) * 2.2) * 0.5 + 0.5;
  const fine = Math.sin(y * 0.9 + Math.sin(x / 9)) * 0.04;
  const m = 0.72 + 0.28 * ring + fine;
  return [r * m, g * m, b * m];
};
export const stripedSheet = (c1 = [230, 228, 220], c2 = [196, 214, 232], period = 70) => (x, y) => (Math.floor(x / (period / 2)) % 2 ? c2 : c1);
export const checkedSheet = (c1 = [235, 232, 225], c2 = [200, 190, 175], size = 48) => (x, y) => ((Math.floor(x / size) + Math.floor(y / size)) % 2 ? c2 : c1);
