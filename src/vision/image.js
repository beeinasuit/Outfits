// Browser-only image helpers (canvas / createImageBitmap). Never import this from Node tests.
import { refineMaskAlpha } from './segment.js';

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

function makeCanvas(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (typeof document === 'undefined' && hasOffscreen) return new OffscreenCanvas(w, h); // worker context
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function loadImgElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try { if (img.decode) await img.decode(); } catch (_) { /* already loaded */ }
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported-image')); };
    img.src = url;
  });
}

/** Decode a File/Blob to an ImageBitmap-like object (EXIF orientation respected). Throws Error('unsupported-image'). */
export async function fileToBitmap(file) {
  if (!file || !(file instanceof Blob) || file.size === 0) throw new Error('unsupported-image');
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) {
      try { return await createImageBitmap(file); } catch (__) { /* fall through to <img> */ }
    }
  }
  // Fallback: <img> decodes with EXIF orientation in all modern browsers (image-orientation: from-image is the default).
  const img = await loadImgElement(file);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('unsupported-image');
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0);
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(c); } catch (_) { /* use canvas below */ }
  }
  return c; // a canvas is a valid drawImage source with width/height, so callers keep working
}

/** Draw a bitmap (or canvas/img) onto a new canvas scaled so the long edge is <= maxDim. */
export function bitmapToCanvas(bitmap, maxDim = 1024) {
  const sw = bitmap.width, sh = bitmap.height;
  const k = Math.min(1, maxDim / Math.max(sw, sh));
  const c = makeCanvas(sw * k, sh * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

/** Crop a canvas to box {x,y,w,h} (clamped to bounds). Returns a new canvas. */
export function cropCanvas(canvas, box) {
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(box.x)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(box.y)));
  const w = Math.max(1, Math.min(canvas.width - x, Math.round(box.w)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.round(box.h)));
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c;
}

function toBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), type, quality); } catch (_) { resolve(null); }
  });
}

/**
 * Encode to a Blob, long edge <= maxDim. Tries WebP, falls back to JPEG when the browser
 * silently returns PNG (older Safari) or null.
 * `alpha: true` (cutouts): the fallback is PNG instead of JPEG so transparency survives.
 */
export async function canvasToBlob(canvas, { maxDim = 600, type = 'image/webp', quality = 0.8, alpha = false } = {}) {
  let src = canvas;
  const k = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  if (k < 1) {
    src = makeCanvas(canvas.width * k, canvas.height * k);
    const ctx = src.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, src.width, src.height);
  }
  let blob = await toBlob(src, type, quality);
  if (alpha && (!blob || (blob.type && blob.type !== type))) {
    // keep transparency: PNG fallback (never JPEG)
    blob = await toBlob(src, 'image/png');
  } else if (!blob || (blob.type && blob.type !== type)) {
    // unsupported type -> browser falls back to PNG; use JPEG for size (flatten any transparency on white)
    const flat = makeCanvas(src.width, src.height);
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(src, 0, 0);
    blob = await toBlob(flat, 'image/jpeg', quality);
    if (!blob) blob = await toBlob(src, 'image/png');
  }
  if (!blob) throw new Error('encode-failed');
  return blob;
}

/**
 * Transparent cutout of one segmented item: pixels outside `mask` become transparent, edge feathered ~`feather` px
 * (mask smoothed by refineMaskAlpha), result trimmed to the item's opaque bounds. `box` is {x,y,w,h} in source px and
 * `mask` is the box-sized w*h mask from segmentItems. Encode with canvasToBlob(c, { alpha: true }).
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function cutoutCanvas(sourceCanvas, box, mask, { feather = 2 } = {}) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(sourceCanvas.width - x, Math.round(box.w)));
  const h = Math.max(1, Math.min(sourceCanvas.height - y, Math.round(box.h)));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  let m = mask;
  if (!m || m.length < w * h) m = new Uint8Array(w * h).fill(1);
  const alpha = refineMaskAlpha(img, m, { feather });
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = alpha[j * w + i];
    img.data[(j * w + i) * 4 + 3] = a;
    if (a > 8) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  ctx.putImageData(img, 0, 0);
  if (x1 < 0) return c;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  if (tw === w && th === h) return c;
  const t = makeCanvas(tw, th);
  t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
  return t;
}

/** Small RGBA ImageData for analysis (long edge <= maxDim). */
export function canvasImageData(canvas, maxDim = 256) {
  const k = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
  let src = canvas;
  if (k < 1) {
    src = makeCanvas(w, h);
    const ctx = src.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
  }
  return src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
}

export const _internal = { hasOffscreen };
