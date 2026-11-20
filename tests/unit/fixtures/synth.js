// Synthetic image generators for the vision tests. Pure; images are {width,height,data: Uint8ClampedArray RGBA}.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => (r() + r() + r() + r() - 2) * 1.732; // ~N(0,1)

export function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}
export function solid(width, height, [r, g, b], alpha = 255) {
  const im = blank(width, height);
  for (let i = 0; i < width * height; i++) {
    im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = alpha;
  }
  return im;
}
export function noise(width, height, seed = 1) {
  const r = rng(seed), im = blank(width, height);
  for (let i = 0; i < width * height; i++) {
    im.data[i * 4] = r() * 256; im.data[i * 4 + 1] = r() * 256; im.data[i * 4 + 2] = r() * 256; im.data[i * 4 + 3] = 255;
  }
  return im;
}
export function addNoise(im, sigma, seed = 7) {
  const r = rng(seed);
  for (let i = 0; i < im.width * im.height; i++) {
    const n = gauss(r) * sigma;
    im.data[i * 4] += n + gauss(r) * sigma * 0.3;
    im.data[i * 4 + 1] += n + gauss(r) * sigma * 0.3;
    im.data[i * 4 + 2] += n + gauss(r) * sigma * 0.3;
  }
  return im;
}
/** Stripes. orientation: 'h' | 'v' | 'd' (diagonal). */
export function stripes(width, height, { c1 = [20, 30, 70], c2 = [235, 235, 235], period = 12, orientation = 'v', noiseSigma = 0, seed = 3 } = {}) {
  const im = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = orientation === 'v' ? x : orientation === 'h' ? y : (x + y) / Math.SQRT2;
      const c = Math.floor(t / (period / 2)) % 2 ? c2 : c1;
      const i = (y * width + x) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
    }
  }
  return noiseSigma ? addNoise(im, noiseSigma, seed) : im;
}
export function checks(width, height, { c1 = [180, 30, 40], c2 = [235, 235, 235], size = 12, noiseSigma = 0, seed = 5 } = {}) {
  const im = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = (Math.floor(x / size) + Math.floor(y / size)) % 2 ? c2 : c1;
      const i = (y * width + x) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
    }
  }
  return noiseSigma ? addNoise(im, noiseSigma, seed) : im;
}
/** Multi-color irregular blobs, e.g. a floral/graphic print. */
export function print(width, height, { seed = 9, palette = [[200, 40, 60], [240, 200, 60], [40, 120, 200], [250, 250, 250], [30, 140, 80], [120, 40, 140]] } = {}) {
  const r = rng(seed), im = solid(width, height, palette[3]);
  for (let k = 0; k < 140; k++) {
    const cx = r() * width, cy = r() * height, rad = 2 + r() * 6, c = palette[Math.floor(r() * palette.length)];
    for (let y = Math.max(0, cy - rad | 0); y < Math.min(height, cy + rad + 1); y++) {
      for (let x = Math.max(0, cx - rad | 0); x < Math.min(width, cx + rad + 1); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) {
          const i = (y * width + x) * 4; im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2];
        }
      }
    }
  }
  return im;
}

function boxBlur(src, w, h, rad) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = 2 * rad + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -rad; x <= rad; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / win;
      s += src[y * w + Math.min(w - 1, x + rad + 1)] - src[y * w + Math.max(0, x - rad)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -rad; y <= rad; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / win;
      s += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x];
    }
  }
  return out;
}

/**
 * Flat-lay scene.
 * items: [{shape:'rect'|'ellipse'|'belt', x,y,w,h, color:[r,g,b]}]  (belt = thin rect + small buckle block)
 * opts: {bg, gradient (0..1 brightness slope across the frame), vignette (0..1), noise (sigma), shadow (0..1 strength),
 *        shadowOffset:[dx,dy], seed, border: draws item-free frame}
 * Returns image + `.truth` boxes ({x,y,w,h}) of the items.
 */
export function flatLay({ width = 1024, height = 768, bg = [225, 222, 215], items = [], gradient = 0, vignette = 0, noise: sigma = 0, shadow = 0, shadowOffset = [10, 14], seed = 11 } = {}) {
  const im = blank(width, height), N = width * height;
  const id = new Int16Array(N).fill(-1);
  items.forEach((it, k) => {
    const x0 = Math.max(0, it.x | 0), y0 = Math.max(0, it.y | 0), x1 = Math.min(width, (it.x + it.w) | 0), y1 = Math.min(height, (it.y + it.h) | 0);
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let inside = true;
        if (it.shape === 'ellipse') inside = ((x - cx) / (it.w / 2)) ** 2 + ((y - cy) / (it.h / 2)) ** 2 <= 1;
        else if (it.shape === 'shirt') { // body + two sleeves, a rough T shape
          const bx = (x - it.x) / it.w, by = (y - it.y) / it.h;
          inside = by < 0.35 || (bx > 0.2 && bx < 0.8);
        }
        if (inside) id[y * width + x] = k;
      }
    }
  });
  const itemMask = new Float32Array(N);
  for (let i = 0; i < N; i++) if (id[i] >= 0) itemMask[i] = 1;
  let shade = null;
  if (shadow > 0) {
    const sh = new Float32Array(N), [dx, dy] = shadowOffset;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) sh[y * width + x] = itemMask[sy * width + sx];
    }
    shade = boxBlur(boxBlur(sh, width, height, 6), width, height, 6);
  }
  const r = rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const k = id[i];
      const c = k >= 0 ? items[k].color : bg;
      let m = 1 + gradient * ((x / width - 0.5) * 0.8 + (y / height - 0.5) * 0.6);
      if (vignette) m *= 1 - vignette * (((x / width - 0.5) ** 2 + (y / height - 0.5) ** 2) * 2);
      if (shade && k < 0) m *= 1 - shadow * shade[i];
      const n = sigma ? gauss(r) * sigma : 0;
      im.data[i * 4] = c[0] * m + n;
      im.data[i * 4 + 1] = c[1] * m + n * 0.9;
      im.data[i * 4 + 2] = c[2] * m + n * 1.1;
      im.data[i * 4 + 3] = 255;
    }
  }
  im.truth = items.map((it) => ({ x: it.x, y: it.y, w: it.w, h: it.h }));
  return im;
}

/** Standard layouts (1024x768) with distinct clothing colors. n = 3, 5 or 6. */
export function standardItems(n, { belt = false } = {}) {
  const cols = [[31, 42, 68], [196, 60, 50], [60, 90, 60], [200, 160, 60], [90, 70, 120], [40, 40, 44]];
  const spots = n <= 3
    ? [[80, 80, 260, 280], [400, 60, 240, 260], [700, 120, 250, 300]]
    : n === 5
      ? [[60, 50, 250, 260], [380, 50, 250, 240], [700, 60, 260, 280], [120, 420, 300, 280], [560, 440, 330, 260]]
      : [[50, 40, 240, 250], [380, 40, 250, 230], [720, 50, 250, 260], [60, 420, 260, 280], [390, 440, 250, 280], [720, 430, 260, 280]];
  const shapes = ['rect', 'ellipse', 'shirt', 'rect', 'ellipse', 'shirt'];
  const items = spots.slice(0, n).map(([x, y, w, h], i) => ({ shape: shapes[i], x, y, w, h, color: cols[i] }));
  if (belt) items.push({ shape: 'rect', x: 150, y: 620, w: 700, h: 36, color: [110, 70, 40] });
  return items;
}

/** Regular polka dots: `dot` circles of radius `rad` on a `step` grid (half-step offset on alternate rows). */
export function polka(width, height, { bg = [240, 236, 228], dot = [31, 42, 68], rad = 4, step = 18, noiseSigma = 0, seed = 4 } = {}) {
  const im = solid(width, height, bg);
  for (let row = 0; row * step < height + step; row++) {
    for (let col = 0; col * step < width + step; col++) {
      const cx = col * step + (row % 2 ? step / 2 : 0), cy = row * step;
      for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(height - 1, Math.ceil(cy + rad)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(width - 1, Math.ceil(cx + rad)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) { const i = (y * width + x) * 4; im.data[i] = dot[0]; im.data[i + 1] = dot[1]; im.data[i + 2] = dot[2]; }
        }
      }
    }
  }
  return noiseSigma ? addNoise(im, noiseSigma, seed) : im;
}
