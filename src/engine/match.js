// Closet matching for the fit check (pure): which of the user's pieces is this photo band most likely to be?
//   matchBand(band, items, slot, { today?, limit? }) -> [{ item, dist, confidence, good }] best first
// `dist` is a color distance (lower = closer); `confidence` 0..1; `good` is true when it is close enough to say
// "looks like" out loud. Considers primary + secondary colors, pattern agreement and recency (people re-wear).
import { rgbToLab, deltaE2000 } from '../vision/color.js';
import { todayISO } from '../model.js';

const hexRgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const labOf = (hex) => rgbToLab(...hexRgb(hex));
const BUSY = new Set(['plaid', 'floral', 'graphic', 'print', 'camo', 'houndstooth', 'polka', 'check', 'stripe']);

/** Color distance between two Lab triples, tolerant of exposure: mostly hue/chroma, partly lightness. */
export function colorDist(a, b) {
  const full = deltaE2000(a, b);
  const noL = deltaE2000([b[0], a[1], a[2]], b);
  return 0.6 * full + 0.4 * noL;
}

/** Distance between two color lists ([{hex,weight}]); weighted two-way nearest-color average. */
export function colorsDist(ca, cb) {
  if (!ca || !ca.length || !cb || !cb.length) return 60;
  const la = ca.map((c) => ({ lab: labOf(c.hex), w: c.weight || 0.01 }));
  const lb = cb.map((c) => ({ lab: labOf(c.hex), w: c.weight || 0.01 }));
  const oneWay = (xs, ys) => {
    let tw = 0, s = 0;
    for (const x of xs) { let m = Infinity; for (const y of ys) m = Math.min(m, colorDist(x.lab, y.lab)); s += m * x.w; tw += x.w; }
    return s / (tw || 1);
  };
  const prim = colorDist(la[0].lab, lb[0].lab);
  return 0.55 * prim + 0.45 * (oneWay(la, lb) + oneWay(lb, la)) / 2;
}

export function matchBand(band, items, slot, opts = {}) {
  try {
    if (!band || !Array.isArray(band.colors) || !band.colors.length || !Array.isArray(items)) return [];
    const limit = Number.isFinite(opts.limit) ? opts.limit : 3;
    const today = opts.today || todayISO();
    const y = new Date(`${today}T12:00:00`); y.setDate(y.getDate() - 1);
    const yesterday = todayISO(y);
    const rows = [];
    for (const item of items) {
      if (!item || (slot && item.slot !== slot) || !Array.isArray(item.colors) || !item.colors.length) continue;
      let d = colorsDist(band.colors, item.colors);
      const bp = band.pattern || 'solid', ip = item.pattern || 'solid';
      if (bp !== ip) {
        const bBusy = BUSY.has(bp), iBusy = BUSY.has(ip);
        // photos mislabel textures often: only a solid-vs-patterned mismatch is worth a nudge
        if (bBusy !== iBusy) d += 4;
        else if (bBusy && iBusy) d += 1;
      } else if (BUSY.has(ip)) d -= 2;
      const worn = item.worn || [];
      if (worn.includes(today)) d -= 3; else if (worn.includes(yesterday)) d -= 1.5;
      if (item.available === false) d += 2;
      rows.push({ item, dist: d });
    }
    rows.sort((a, b) => a.dist - b.dist || (a.item.id < b.item.id ? -1 : 1));
    return rows.slice(0, limit).map((r) => ({ item: r.item, dist: Math.max(0, Math.round(r.dist * 10) / 10), confidence: Math.max(0, Math.min(1, 1 - r.dist / 40)), good: r.dist < 18 }));
  } catch {
    return [];
  }
}
