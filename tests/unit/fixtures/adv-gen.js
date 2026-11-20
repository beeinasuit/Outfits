// Adversarial-test helpers: seeded PRNG, random item/wardrobe generators, realistic wardrobes.
import { makeItem, SLOTS, KINDS, COLOR_FAMILIES, PATTERNS, LEATHER_TONES, MATERIALS } from '../../../src/model.js';
import { wardrobe as stdWardrobe, mk } from './wardrobe.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, a) => a[Math.floor(r() * a.length)];
export function shuffle(r, a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
export function pickWeighted(r, pairs) {
  const tot = pairs.reduce((s, p) => s + p[1], 0);
  let x = r() * tot;
  for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

const FAMS = Object.keys(COLOR_FAMILIES);
const NEUTRALS = FAMS.filter((f) => COLOR_FAMILIES[f].neutral);
const BRIGHTS = FAMS.filter((f) => !COLOR_FAMILIES[f].neutral);
export const SLOT_MIX = [['top', 30], ['bottom', 20], ['shoes', 12], ['belt', 6], ['layer', 14], ['neckwear', 6], ['headwear', 5], ['extra', 7]];

/** Fully random but VALID item (built through makeItem). */
export function randomItem(r, id, { slot, neutralBias = 0.5, availableP = 0.9 } = {}) {
  const s = slot || pickWeighted(r, SLOT_MIX);
  const kind = pick(r, Object.keys(KINDS[s]));
  const nCol = r() < 0.7 ? 1 : r() < 0.7 ? 2 : 3;
  const colors = [];
  for (let i = 0; i < nCol; i++) {
    const f = r() < neutralBias ? pick(r, NEUTRALS) : pick(r, FAMS);
    colors.push({ hex: COLOR_FAMILIES[f].hex, family: f, weight: i === 0 ? 0.6 : 0.4 / Math.max(1, nCol - 1) });
  }
  const pattern = r() < 0.75 ? 'solid' : pick(r, PATTERNS);
  const extra = { id, slot: s, kind, colors, pattern, available: r() < availableP, name: `${kind} ${id}` };
  if (r() < 0.3) extra.formality = 1 + Math.floor(r() * 5);
  if (s === 'bottom' && r() < 0.15) extra.beltLoops = r() < 0.5;
  if (s === 'top' && r() < 0.1) extra.collared = r() < 0.5;
  if (s === 'shoes' || s === 'belt') { extra.material = r() < 0.7 ? 'leather' : pick(r, MATERIALS); if (r() < 0.8) extra.leather = pick(r, LEATHER_TONES); }
  if (r() < 0.15) extra.warmth = Math.floor(r() * 4);
  if (s === 'layer' && r() < 0.1) extra.rain = true;
  if (r() < 0.15) extra.worn = [`2026-11-${String(10 + Math.floor(r() * 10)).padStart(2, '0')}`];
  return makeItem(extra);
}

export function randomWardrobe(r, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(randomItem(r, `i${i}`, opts));
  return out;
}

export const TODAY = '2026-11-20';
export const OCCS = ['any', 'lounge', 'weekend', 'date', 'work', 'formal'];
export const WEATHERS = [null, 'hot', 'warm', 'mild', 'cold', 'freezing'];

// ---- realistic wardrobes (what a normal person owns) ----
const m = (id, slot, kind, fam, extra) => mk(id, slot, kind, fam, extra);
export function realisticWardrobes() {
  const caps = [
    m('c-white-tee', 'top', 't-shirt', 'white'), m('c-grey-tee', 'top', 't-shirt', 'grey'), m('c-navy-polo', 'top', 'polo', 'navy'),
    m('c-lb-shirt', 'top', 'button-down', 'light-blue'),
    m('c-jeans', 'bottom', 'jeans', 'denim'), m('c-chinos', 'bottom', 'chinos', 'beige'),
    m('c-sneak', 'shoes', 'sneakers', 'white'), m('c-boots', 'shoes', 'boots', 'brown', { leather: 'brown' }),
    m('c-belt', 'belt', 'leather belt', 'brown', { leather: 'brown' }),
    m('c-denimj', 'layer', 'denim jacket', 'denim'),
  ];
  const work = [
    m('w-wo', 'top', 'oxford', 'white'), m('w-lb', 'top', 'button-down', 'light-blue'), m('w-ds', 'top', 'dress shirt', 'white'),
    m('w-pink', 'top', 'button-down', 'pink'), m('w-sw', 'top', 'sweater', 'navy'), m('w-polo', 'top', 'polo', 'grey'),
    m('w-ch', 'bottom', 'dress pants', 'charcoal'), m('w-gr', 'bottom', 'dress pants', 'grey'), m('w-nc', 'bottom', 'chinos', 'navy'), m('w-bc', 'bottom', 'chinos', 'beige'),
    m('w-ox', 'shoes', 'oxfords', 'black', { leather: 'black' }), m('w-lo', 'shoes', 'loafers', 'brown', { leather: 'brown' }), m('w-de', 'shoes', 'derbies', 'brown', { leather: 'dark-brown' }),
    m('w-bb', 'belt', 'dress belt', 'black', { leather: 'black' }), m('w-bbr', 'belt', 'leather belt', 'brown', { leather: 'brown' }),
    m('w-bl', 'layer', 'blazer', 'navy'), m('w-bl2', 'layer', 'blazer', 'charcoal'), m('w-oc', 'layer', 'overcoat', 'charcoal'),
    m('w-t1', 'neckwear', 'tie', 'burgundy'), m('w-t2', 'neckwear', 'tie', 'navy'), m('w-sc', 'neckwear', 'scarf', 'grey'),
  ];
  const street = [
    m('s-blk', 'top', 't-shirt', 'black'), m('s-wh', 'top', 't-shirt', 'white'), m('s-g', 'top', 'graphic tee', 'black', { pattern: 'graphic' }),
    m('s-hd', 'top', 'hoodie', 'grey'), m('s-hd2', 'top', 'hoodie', 'black'), m('s-red', 'top', 't-shirt', 'red'), m('s-sw', 'top', 'sweatshirt', 'olive'),
    m('s-bj', 'bottom', 'jeans', 'black'), m('s-jg', 'bottom', 'joggers', 'grey'), m('s-jg2', 'bottom', 'joggers', 'black'), m('s-cg', 'bottom', 'cargo pants', 'olive'), m('s-sh', 'bottom', 'shorts', 'beige'),
    m('s-sn', 'shoes', 'sneakers', 'white'), m('s-sn2', 'shoes', 'sneakers', 'black'), m('s-rs', 'shoes', 'running shoes', 'grey'),
    m('s-bo', 'layer', 'bomber', 'black'), m('s-pf', 'layer', 'puffer', 'black'),
    m('s-cap', 'headwear', 'baseball cap', 'black'), m('s-bn', 'headwear', 'beanie', 'grey'),
  ];
  const bright = [
    m('b-yl', 'top', 't-shirt', 'yellow'), m('b-gr', 'top', 't-shirt', 'green'), m('b-pk', 'top', 'polo', 'pink'), m('b-or', 'top', 't-shirt', 'orange'),
    m('b-pu', 'top', 'sweater', 'purple'), m('b-rd', 'top', 'button-down', 'red'), m('b-wh', 'top', 't-shirt', 'white'),
    m('b-jn', 'bottom', 'jeans', 'denim'), m('b-bj', 'bottom', 'jeans', 'black'), m('b-ch', 'bottom', 'chinos', 'green'), m('b-ch2', 'bottom', 'chinos', 'beige'),
    m('b-sn', 'shoes', 'sneakers', 'white'), m('b-bt', 'shoes', 'boots', 'brown', { leather: 'brown' }),
    m('b-bl', 'belt', 'leather belt', 'brown', { leather: 'brown' }),
  ];
  const std = stdWardrobe();
  const r = mulberry32(2026);
  const big = [];
  const mix = [['top', 30], ['bottom', 18], ['shoes', 10], ['belt', 4], ['layer', 10], ['neckwear', 3], ['headwear', 3]];
  for (let i = 0; i < 80; i++) big.push(randomItem(r, `big${i}`, { slot: pickWeighted(r, mix), neutralBias: 0.8, availableP: 1 }));
  return { capsule: caps, work, streetwear: street, brights: bright, standard: std, big80: big };
}

export { stdWardrobe, mk };
