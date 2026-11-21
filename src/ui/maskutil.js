// Helpers shared by Snap and Your colors: turn a small-resolution segmentation mask into a full-resolution one
// and build transparent cutouts. Browser-only (uses canvas helpers via dynamic import by callers).

/**
 * Nearest-neighbor upscale of a box-sized mask.
 * @param {{x:number,y:number,w:number,h:number,mask:Uint8Array}} det  detection in small-image coords
 * @param {number} kx  canvas.width / smallImage.width
 * @param {number} ky  canvas.height / smallImage.height
 * @param {{x:number,y:number,w:number,h:number}} box  target box in canvas px
 * @returns {Uint8Array|null} box.w*box.h mask (null if it covers almost nothing)
 */
export function upscaleMask(det, kx, ky, box) {
  if (!det || !det.mask) return null;
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
  const out = new Uint8Array(w * h);
  let on = 0;
  for (let j = 0; j < h; j++) {
    const sy = Math.floor((box.y + j) / ky - det.y);
    if (sy < 0 || sy >= det.h) continue;
    for (let i = 0; i < w; i++) {
      const sx = Math.floor((box.x + i) / kx - det.x);
      if (sx < 0 || sx >= det.w) continue;
      if (det.mask[sy * det.w + sx]) { out[j * w + i] = 1; on++; }
    }
  }
  return on > w * h * 0.03 ? out : null;
}

/** Resample a box-sized mask (w0*h0) to w1*h1 (nearest). */
export function resampleMask(mask, w0, h0, w1, h1) {
  const out = new Uint8Array(w1 * h1);
  for (let j = 0; j < h1; j++) {
    const sy = Math.min(h0 - 1, Math.floor((j + 0.5) * h0 / h1));
    for (let i = 0; i < w1; i++) out[j * w1 + i] = mask[sy * w0 + Math.min(w0 - 1, Math.floor((i + 0.5) * w0 / w1))];
  }
  return out;
}

/** Same-size sanity check: an "everything" mask means segmentation found nothing useful. */
export function maskIsUseful(mask) {
  if (!mask) return false;
  let on = 0;
  for (let i = 0; i < mask.length; i++) on += mask[i] ? 1 : 0;
  const f = on / mask.length;
  return f > 0.04 && f < 0.985;
}

/**
 * Background removal for one standalone crop (a canvas): segments it as a single item and cuts it out.
 * `v` is the loaded vision module ({canvasImageData, segmentCrop, cutoutCanvas}).
 * @returns {{cutout:(HTMLCanvasElement|OffscreenCanvas|null), quality:(object|null), confident:boolean}}
 *   cutout is null when no clean outline was found (the whole crop is the item).
 */
export function cutoutFromCrop(v, canvas) {
  const none = { cutout: null, quality: null, confident: false };
  try {
    const id = v.canvasImageData(canvas, 200);
    const r = v.segmentCrop(id);
    if (!r || r.full || !r.mask) return { ...none, quality: r ? r.quality : null };
    const w = canvas.width, h = canvas.height;
    const mask = resampleMask(r.mask, id.width, id.height, w, h);
    if (!maskIsUseful(mask)) return { ...none, quality: r.quality };
    const cutout = v.cutoutCanvas(canvas, { x: 0, y: 0, w, h }, mask);
    return { cutout, quality: r.quality, confident: !!(r.quality && r.quality.ok && r.quality.fill >= 0.3) };
  } catch (e) {
    return none;
  }
}
