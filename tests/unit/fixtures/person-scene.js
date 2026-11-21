// Synthetic "person standing in a room" images for the fit-check vision tests (no DOM, seeded).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * @param {object} o  bg '#hex' | 'clutter', top, pants, shoes, layer (open jacket color, optional), skin, cast [r,g,b] gains,
 *   W,H, seed, shorts (bool), vignette (bool)
 * Geometry (fractions of H): head .05-.17, neck line .2, torso .2-.47, pants .47-.88, shoes .9-.97.
 */
export function makeScene(o = {}) {
  const W = o.W || 240, H = o.H || 400, R = rng(o.seed || 1);
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, c) => { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  const skin = hex(o.skin || '#d9a07c');
  const bgc = o.bg && o.bg !== 'clutter' ? hex(o.bg) : hex('#e9e4da');
  // background
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = bgc;
    if (o.vignette) { const k = 1 - 0.18 * Math.pow(Math.abs(x / W - 0.5) * 2, 2); c = c.map((v) => v * k); }
    put(x, y, c);
  }
  if (o.bg === 'clutter') {
    const cols = ['#8a3b2f', '#2f5d8a', '#c9a227', '#3d7a4a', '#6b4c8a', '#d9d9d9', '#4a3b2a', '#b8601f'];
    for (let n = 0; n < 46; n++) {
      const w = 14 + Math.floor(R() * 50), h = 20 + Math.floor(R() * 90), x0 = Math.floor(R() * (W - w)), y0 = Math.floor(R() * (H - h)), c = hex(cols[Math.floor(R() * cols.length)]);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
    }
    // clutter near the borders too, like shelves and a door frame
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x < 10 && (y >> 4) % 2) || (x > W - 10 && (y >> 5) % 2)) put(x, y, hex('#5b3b22'));
  }
  const ell = (cx, cy, rx, ry, c) => { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (y >= 0 && y < H && x >= 0 && x < W && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(x, y, c); };
  const rect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) put(x, y, c); };
  const cx = W / 2;
  if (!o.empty) {
  const top = hex(o.top || '#1f2a44'), pants = hex(o.pants || '#3b3b3f'), shoes = hex(o.shoes || '#f2f2f0');
  const tw = W * 0.17; // torso half width
  // legs / pants (gap between legs), hands at sides
  const pTop = H * 0.47, pBot = H * (o.shorts ? 0.66 : 0.88);
  rect(cx - tw, pTop, cx - 4, pBot, pants); rect(cx + 4, pTop, cx + tw, pBot, pants);
  if (o.shorts) { rect(cx - tw * 0.8, pBot, cx - 8, H * 0.9, skin); rect(cx + 8, pBot, cx + tw * 0.8, H * 0.9, skin); }
  // shoes
  rect(cx - tw - 8, H * 0.9, cx - 3, H * 0.97, shoes); rect(cx + 3, H * 0.9, cx + tw + 8, H * 0.97, shoes);
  // arms (sleeves = top or layer color) + hands
  const sleeve = hex(o.layer || o.top || '#1f2a44');
  rect(cx - tw - 22, H * 0.215, cx - tw, H * 0.4, sleeve); rect(cx + tw, H * 0.215, cx + tw + 22, H * 0.4, sleeve);
  rect(cx - tw - 22, H * 0.4, cx - tw - 4, H * 0.46, skin); rect(cx + tw + 4, H * 0.4, cx + tw + 22, H * 0.46, skin);
  // torso
  if (o.layer) {
    rect(cx - tw, H * 0.2, cx + tw, H * 0.48, sleeve);
    rect(cx - tw * 0.3, H * 0.2, cx + tw * 0.3, H * 0.48, top); // shirt visible between the open fronts
  } else rect(cx - tw, H * 0.2, cx + tw, H * 0.48, top);
  if (o.stripes) { for (let y = Math.round(H * 0.2); y < H * 0.48; y += 8) rect(cx - tw, y, cx + tw, y + 3, hex(o.stripes)); }
  // neck + head
  rect(cx - 9, H * 0.17, cx + 9, H * 0.21, skin);
  ell(cx, H * 0.11, 20, 27, skin);
  ell(cx, H * 0.075, 21, 14, hex('#2a1d14')); // hair
  }
  // lighting, shading, noise
  const cast = o.cast || [1, 1, 1];
  for (let i = 0; i < W * H; i++) {
    const n = (R() - 0.5) * 12, y = Math.floor(i / W), shade = 1 - 0.12 * (y / H);
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, data[i * 4 + c] * cast[c] * shade + n));
  }
  return { width: W, height: H, data };
}
export const WARM = [1.14, 1.0, 0.8];
