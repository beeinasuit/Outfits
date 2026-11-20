// Helpers shared by Snap and Your colours: turn a small-resolution segmentation mask into a full-resolution one
// and build transparent cutouts. Browser-only (uses canvas helpers via dynamic import by callers).

/**
 * Nearest-neighbour upscale of a box-sized mask.
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
