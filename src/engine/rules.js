// Style rules. Every rule returns Reason objects { text, delta, tag }.
// All tunable weights live in WEIGHTS below. Pure, DOM-free, deterministic.

import { COLOR_FAMILIES, BUSY_PATTERNS, OCCASIONS, WEATHER, outfitKey } from '../model.js';

export const WEIGHTS = {
  base: 70,
  color: {
    neutralSafe: 6, onePop: 10, goodPair: 5, goodPairMax: 2,
    twoAccents: -5, manyAccents: -16,
    brownBlack: -10, navyBlack: -3, redGreen: -22, orangePurple: -20, redPink: -6, loudPair: -9,
    clashCap: -30,
  },
  contrast: { muddy: -8, denimDenim: -2, tonal: 2, lightOverDark: 3, similarDL: 12, lightDL: 15 },
  pattern: { twoBusy: -14, extraBusy: -6, busyPlusLines: -5, linesClash: -6, single: 2, graphicFormal: -8 },
  statement: { each: -6 },
  formality: { close: 4, spread2: -5, spread3: -18, shoes2: -5, shoes3: -10 },
  occasion: { perLevel: -4, cap: -16, fits: 4 },
  neckwear: { tieNoCollar: -28, tieTooCasual: -10, bowTieNotFormal: -10, bowTieCasual: -14, tieOk: 3 },
  headwear: { casualHatDressy: -6, casualHatFormal: -10, fedoraSneakers: -6 },
  shoes: { sportyWithDress: -14, oxfordJeansTee: -6, oxfordJeansBlazer: 3, shortsDressy: -8, shortsBoots: -5 },
  leather: { match: 10, clash: -20, near: -4, nearBurgundy: -3, nearOther: -2, casualBeltCasualShoes: 4,
    casualBeltDressy: -8, beltFormalityPerLevel: -4, beltFormalityCap: -10, missingBelt: -6, beltNoLoops: -6 },
  weather: { fits: 5, perLevel: -6, cap: -18, hotNoLayer: 3, hotShorts: 4, coldNoLayer: -10, coldLayer: 4,
    coldAccessory: 3, hotAccessory: -5, coldShorts: -10, rainLayer: 10, noRainLayer: -4, rainSuede: -8 },
  feedback: { likedOutfit: 20, dislikedOutfit: -30, likedPair: 4, dislikedPair: -6, pairCap: 12 },
};
const W = WEIGHTS;

// ---------- small helpers ----------
const num = (v, d) => (Number.isFinite(v) ? v : d);
const R = (text, delta, tag) => ({ text, delta: Math.round(delta * 10) / 10, tag });
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pretty = (s) => String(s).replace(/-/g, ' ');
const nm = (i) => { const n = String(i?.name || i?.kind || 'item'); return n.length > 1 && n[1] === n[1].toLowerCase() ? n[0].toLowerCase() + n.slice(1) : n; };
const kindOf = (i) => String(i?.kind || 'item');
const fm = (i) => Math.min(5, Math.max(1, Math.round(num(i?.formality, 2))));
const wm = (i) => Math.min(3, Math.max(0, num(i?.warmth, 0)));
const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const LOUD = new Set(['yellow', 'orange', 'red', 'pink', 'purple', 'green', 'blue']);
const TONAL_OK = new Set(['black', 'white', 'cream', 'beige', 'grey', 'charcoal']);
const MID_PATTERNS = new Set(['stripe', 'check', 'polka']);
const BUSY = new Set(BUSY_PATTERNS);
const BROWNS = new Set(['brown', 'dark-brown', 'tan']);
const TIES = new Set(['tie', 'knit tie', 'bow tie']);
const CASUAL_HATS = new Set(['baseball cap', 'beanie', 'bucket hat']);
const DRESSY_LAYERS = new Set(['blazer', 'suit jacket']);
const OCC_PHRASE = { lounge: 'lounging', weekend: 'the weekend', date: 'date night', work: 'work', formal: 'a formal event' };

const GOOD_PAIRS = new Set([
  'navy|beige', 'navy|white', 'navy|grey', 'white|denim', 'olive|white', 'olive|beige', 'olive|navy',
  'grey|black', 'light-blue|navy', 'light-blue|beige', 'burgundy|grey', 'burgundy|navy', 'rust|denim',
  'mustard|navy', 'pink|navy', 'pink|grey', 'cream|brown', 'forest|beige', 'lavender|grey', 'teal|beige',
].map((k) => { const [a, b] = k.split('|'); return pairKey(a, b); }));

/** Colour families that matter on one item: the primary plus any colour with >= 25% weight. */
export function significantFamilies(item) {
  const out = [];
  const cs = Array.isArray(item?.colors) ? item.colors : [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c || !COLOR_FAMILIES[c.family]) continue;
    if (out.length === 0 || num(c.weight, 0) >= 0.25) if (!out.includes(c.family)) out.push(c.family);
  }
  if (!out.length) out.push('grey');
  return out;
}
export const familyOf = (item) => significantFamilies(item)[0];

// CIELAB lightness of a hex colour (cached).
const lCache = new Map();
function hexL(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const y = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16;
}
export function lightnessOf(item) {
  const hex = String(item?.colors?.[0]?.hex || '').toLowerCase();
  let l = lCache.get(hex);
  if (l === undefined) { l = hexL(hex); lCache.set(hex, l); }
  if (l === null) l = hexL(COLOR_FAMILIES[familyOf(item)]?.hex) ?? 50;
  return l;
}

export const leatherTone = (i) => (i && (i.material === 'leather' || i.material === 'suede') ? (i.leather || 'brown') : null);
const isShorts = (i) => i?.kind === 'shorts';
const patternOf = (i) => String(i?.pattern || 'solid');

// ---------- context preparation ----------
export function prepare(items, ctx) {
  const it = items && typeof items === 'object' ? items : {};
  const g = (s) => (it[s] && typeof it[s] === 'object' ? it[s] : null);
  const P = { top: g('top'), bottom: g('bottom'), layer: g('layer'), neckwear: g('neckwear'), headwear: g('headwear'),
    shoes: g('shoes'), belt: g('belt'), extra: g('extra'), items: it, ctx: ctx || {} };
  const occKey = OCCASIONS[P.ctx.occasion] ? P.ctx.occasion : 'any';
  P.occKey = occKey;
  P.occ = OCCASIONS[occKey];
  const core = [P.top, P.bottom, P.layer, P.shoes].filter(Boolean);
  P.core = core;
  P.of = core.length ? Math.round(core.reduce((s, i) => s + fm(i), 0) / core.length) : 2;
  P.pieces = [P.top, P.bottom, P.layer, P.neckwear, P.headwear].filter(Boolean);
  return P;
}

// ---------- colour ----------
export function colorRules(P) {
  const out = [];
  const pieces = P.pieces;
  if (!pieces.length) return out;
  const all = [];
  const accents = [];
  for (const p of pieces) {
    for (const f of significantFamilies(p)) {
      if (!all.includes(f)) all.push(f);
      if (!COLOR_FAMILIES[f].neutral && !accents.includes(f)) accents.push(f);
    }
  }
  if (accents.length === 0) {
    out.push(R(`${cap(list(all.slice(0, 3).map(pretty)))}: easy neutral colours that always go together.`, W.color.neutralSafe, 'color-neutral'));
  } else if (accents.length === 1) {
    out.push(R(`${cap(pretty(accents[0]))} is your one pop of colour, balanced by neutrals.`, W.color.onePop, 'color-accent'));
  } else if (accents.length === 2) {
    if (!GOOD_PAIRS.has(pairKey(accents[0], accents[1]))) {
      out.push(R(`${cap(pretty(accents[0]))} and ${pretty(accents[1])} are two bold colours competing for attention.`, W.color.twoAccents, 'color-risky'));
    }
  } else {
    out.push(R(`${accents.length} different bright colours (${list(accents.map(pretty))}) fight each other.`, W.color.manyAccents, 'color-clash'));
  }

  let good = 0;
  let clash = 0;
  const loud = all.filter((f) => LOUD.has(f));
  const has = (f) => all.includes(f);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]; const b = all[j];
      if (GOOD_PAIRS.has(pairKey(a, b)) && good < W.color.goodPairMax) {
        good++;
        out.push(R(`${cap(pretty(a))} and ${pretty(b)}: a classic pairing.`, W.color.goodPair, 'color-good-pair'));
      }
    }
  }
  const addClash = (text, d, tag) => { if (clash > W.color.clashCap) { clash += d; out.push(R(text, d, tag)); } };
  if (has('brown') && has('black')) addClash('Brown and black together can look like a mistake.', W.color.brownBlack, 'color-clash');
  if (has('navy') && has('black')) addClash('Navy and black are close; it can look like a mismatch.', W.color.navyBlack, 'color-clash-mild');
  if (has('red') && has('green')) addClash('Red and green together look like Christmas.', W.color.redGreen, 'color-clash');
  if (has('orange') && has('purple')) addClash('Orange and purple fight each other.', W.color.orangePurple, 'color-clash');
  if (has('red') && has('pink')) addClash('Red and pink are too close to look intentional.', W.color.redPink, 'color-clash-mild');
  const special = (a, b) => (has('red') && has('green') && ((a === 'red' && b === 'green') || (a === 'green' && b === 'red')))
    || (has('orange') && has('purple') && ((a === 'orange' && b === 'purple') || (a === 'purple' && b === 'orange')))
    || ((a === 'red' && b === 'pink') || (a === 'pink' && b === 'red'));
  let loudPairs = 0;
  for (let i = 0; i < loud.length && loudPairs < 1; i++) {
    for (let j = i + 1; j < loud.length && loudPairs < 1; j++) {
      if (special(loud[i], loud[j])) continue;
      loudPairs++;
      addClash(`${cap(pretty(loud[i]))} and ${pretty(loud[j])} are both loud; together they shout.`, W.color.loudPair, 'color-clash');
    }
  }
  return out;
}

// ---------- contrast ----------
export function contrastRules(P) {
  const { top, bottom } = P;
  if (!top || !bottom) return [];
  const ft = familyOf(top); const fb = familyOf(bottom);
  const lt = lightnessOf(top); const lb = lightnessOf(bottom);
  const dl = Math.abs(lt - lb);
  if (ft === fb) {
    if (ft === 'denim') {
      return dl >= W.contrast.similarDL
        ? [R('Two different denim washes: fine, but a bit much.', W.contrast.denimDenim, 'contrast-denim')]
        : [R('Denim on denim in the same wash looks flat.', W.contrast.muddy, 'contrast-muddy')];
    }
    if (TONAL_OK.has(ft)) return [R(`Head-to-toe ${pretty(ft)}: a clean, tonal look.`, W.contrast.tonal, 'contrast-tonal')];
    if (dl < W.contrast.similarDL) {
      return [R(`${cap(nm(top))} and ${nm(bottom)} are almost the same shade, so they blur together.`, W.contrast.muddy, 'contrast-muddy')];
    }
    return [];
  }
  if (lt - lb >= W.contrast.lightDL) {
    return [R(`A lighter top over darker ${kindOf(bottom)} is a safe classic.`, W.contrast.lightOverDark, 'contrast-good')];
  }
  return [];
}

// ---------- pattern & statement pieces ----------
export function patternRules(P) {
  const out = [];
  const pieces = P.pieces;
  const patterned = pieces.filter((p) => patternOf(p) !== 'solid' && patternOf(p) !== 'textured');
  const busy = patterned.filter((p) => BUSY.has(patternOf(p)));
  const linesNonNeck = patterned.filter((p) => MID_PATTERNS.has(patternOf(p)) && p !== P.neckwear);
  if (busy.length >= 2) {
    out.push(R(`${cap(nm(busy[0]))} and ${nm(busy[1])} are both busy patterns, so pick one to be the star.`, W.pattern.twoBusy, 'pattern-busy'));
    if (busy.length > 2) out.push(R('Three busy patterns is way too much.', W.pattern.extraBusy * (busy.length - 2), 'pattern-busy'));
  } else if (busy.length === 1 && busy[0] !== P.neckwear && linesNonNeck.length >= 1) {
    out.push(R(`${cap(nm(busy[0]))} with ${nm(linesNonNeck[0])}: too many patterns at once.`, W.pattern.busyPlusLines, 'pattern-risky'));
  }
  if (linesNonNeck.length >= 2) {
    out.push(R(`${cap(nm(linesNonNeck[0]))} and ${nm(linesNonNeck[1])}: two sets of lines are risky together.`, W.pattern.linesClash, 'pattern-risky'));
  }
  if (patterned.length === 1) {
    out.push(R(`Just one pattern (${nm(patterned[0])}), so the outfit stays easy on the eye.`, W.pattern.single, 'pattern-ok'));
  }
  // statement pieces: busy pattern or loud primary colour
  const statements = pieces.filter((p) => BUSY.has(patternOf(p)) || LOUD.has(familyOf(p)));
  if (statements.length >= 2) {
    out.push(R(`${statements.length} eye-catching pieces (${list(statements.map(nm))}): let just one be the star.`,
      W.statement.each * (statements.length - 1), 'statement-many'));
  }
  // graphic tee only casual
  const { top } = P;
  if (top && (top.kind === 'graphic tee' || patternOf(top) === 'graphic')) {
    const dressy = [P.bottom, P.layer, P.shoes, P.neckwear].filter((i) => i && fm(i) >= 3);
    if (dressy.length) out.push(R(`A graphic tee is casual; it looks out of place with ${nm(dressy[0])}.`, W.pattern.graphicFormal, 'pattern-graphic'));
  }
  return out;
}

// ---------- formality ----------
export function formalityRules(P) {
  const out = [];
  const gs = [P.top, P.bottom, P.layer, P.neckwear && TIES.has(P.neckwear.kind) ? P.neckwear : null].filter(Boolean);
  if (gs.length >= 2) {
    let hi = gs[0]; let lo = gs[0];
    for (const g of gs) { if (fm(g) > fm(hi)) hi = g; if (fm(g) < fm(lo)) lo = g; }
    const spread = fm(hi) - fm(lo);
    if (spread <= 1) out.push(R('Everything sits at a similar dress level.', W.formality.close, 'formality-ok'));
    else if (spread === 2) out.push(R(`${cap(nm(hi))} is a notch dressier than ${nm(lo)}.`, W.formality.spread2, 'formality-gap'));
    else out.push(R(`${cap(nm(hi))} with ${nm(lo)}: way too dressy meets way too casual.`, W.formality.spread3, 'formality-clash'));
  }
  if (P.shoes && gs.length) {
    const mean = gs.reduce((s, i) => s + fm(i), 0) / gs.length;
    const d = fm(P.shoes) - mean;
    if (Math.abs(d) >= 3) out.push(R(`${cap(nm(P.shoes))} are far ${d > 0 ? 'dressier' : 'more casual'} than the rest of the outfit.`, W.formality.shoes3, 'formality-shoes'));
    else if (Math.abs(d) >= 2) out.push(R(`${cap(nm(P.shoes))} are ${d > 0 ? 'dressier' : 'more casual'} than the rest of the outfit.`, W.formality.shoes2, 'formality-shoes'));
  }
  return out;
}

export function occasionRules(P) {
  if (P.occKey === 'any') return [];
  const out = [];
  const { min, max } = P.occ;
  const phrase = OCC_PHRASE[P.occKey] || P.occ.label.toLowerCase();
  let total = 0;
  let allIn = true;
  const checked = [P.top, P.bottom, P.layer, P.shoes, P.neckwear && TIES.has(P.neckwear.kind) ? P.neckwear : null].filter(Boolean);
  for (const i of checked) {
    const f = fm(i);
    const d = f < min ? min - f : f > max ? f - max : 0;
    if (d > 0) {
      allIn = false;
      const delta = W.occasion.perLevel * d;
      if (total + delta < W.occasion.cap) continue;
      total += delta;
      out.push(R(`${cap(nm(i))} is too ${f < min ? 'casual' : 'dressy'} for ${phrase}.`, delta, 'occasion-off'));
    }
  }
  if (allIn && checked.length) out.push(R(`Dress level fits ${phrase} well.`, W.occasion.fits, 'occasion-ok'));
  return out;
}

// ---------- neckwear / headwear ----------
export function neckwearRules(P) {
  const { neckwear, top } = P;
  if (!neckwear || !TIES.has(neckwear.kind)) return [];
  const out = [];
  const collared = !!top && top.collared === true;
  if (!collared) {
    out.push(R(`A ${neckwear.kind} with ${top ? nm(top) : 'no shirt'}: ties belong with a collared shirt.`, W.neckwear.tieNoCollar, 'tie-no-collar'));
  } else if (neckwear.kind === 'bow tie') {
    if (P.of < 5) out.push(R('A bow tie only works for really formal outfits.', P.of === 4 ? W.neckwear.bowTieNotFormal : W.neckwear.bowTieCasual, 'bowtie-informal'));
    else out.push(R(`${cap(nm(neckwear))} suits this formal outfit.`, W.neckwear.tieOk, 'tie-ok'));
  } else if (P.of < 3) {
    out.push(R(`A ${neckwear.kind} is too dressy for such a casual outfit.`, W.neckwear.tieTooCasual, 'tie-too-casual'));
  } else {
    out.push(R(`${cap(nm(neckwear))} with ${nm(top)}: a smart pairing.`, W.neckwear.tieOk, 'tie-ok'));
  }
  return out;
}

export function headwearRules(P) {
  const { headwear } = P;
  if (!headwear) return [];
  const out = [];
  const maxF = Math.max(0, ...P.core.map(fm));
  if (CASUAL_HATS.has(headwear.kind) && maxF >= 4) {
    out.push(R(`A ${headwear.kind} is too casual for a dressy outfit.`, maxF === 5 ? W.headwear.casualHatFormal : W.headwear.casualHatDressy, 'hat-casual'));
  }
  if (headwear.kind === 'fedora' && P.shoes && ['sneakers', 'running shoes', 'sandals'].includes(P.shoes.kind)) {
    out.push(R(`A fedora with ${P.shoes.kind} looks mismatched.`, W.headwear.fedoraSneakers, 'hat-mismatch'));
  }
  return out;
}

// ---------- shoes ----------
export function shoeRules(P) {
  const out = [];
  const { shoes, bottom, top, layer, neckwear } = P;
  if (shoes) {
    const sporty = shoes.kind === 'running shoes' || shoes.kind === 'sandals';
    const dressBottom = bottom && (bottom.kind === 'dress pants' || bottom.kind === 'suit trousers' || fm(bottom) >= 4);
    const dressLayer = layer && DRESSY_LAYERS.has(layer.kind);
    if (sporty && (dressBottom || dressLayer)) {
      out.push(R(`${cap(nm(shoes))} with ${dressBottom ? nm(bottom) : nm(layer)} is too sporty a mix.`, W.shoes.sportyWithDress, 'shoes-sporty'));
    }
    if (shoes.kind === 'oxfords' && bottom && bottom.kind === 'jeans' && top) {
      const tee = ['t-shirt', 'graphic tee', 'tank top', 'henley'].includes(top.kind);
      if (dressLayer) out.push(R('Oxfords with jeans and a blazer: sharp smart-casual.', W.shoes.oxfordJeansBlazer, 'shoes-oxford-jeans-ok'));
      else if (tee) out.push(R('Formal oxfords with jeans and a tee are too dressy on the feet.', W.shoes.oxfordJeansTee, 'shoes-oxford-jeans'));
    }
  }
  if (bottom && isShorts(bottom)) {
    if (layer && DRESSY_LAYERS.has(layer.kind)) out.push(R(`Shorts with ${nm(layer)} look confused.`, W.shoes.shortsDressy, 'shorts-dressy'));
    if (neckwear && TIES.has(neckwear.kind)) out.push(R('Shorts with a tie look confused.', W.shoes.shortsDressy, 'shorts-dressy'));
    if (shoes && ['boots', 'chelsea boots', 'oxfords', 'derbies', 'loafers'].includes(shoes.kind) && shoes.kind.includes('boots')) {
      out.push(R(`Shorts with ${shoes.kind} are an awkward mix.`, W.shoes.shortsBoots, 'shorts-boots'));
    }
  }
  return out;
}

// ---------- belt & leather ----------
export function beltRules(P) {
  const out = [];
  const { belt, shoes, bottom } = P;
  if (!belt) {
    if (bottom && bottom.beltLoops === true && P.ctx.beltAvailable === true) {
      out.push(R(`${cap(nm(bottom))} have belt loops, so add a belt to finish the look.`, W.leather.missingBelt, 'belt-missing'));
    }
    return out;
  }
  if (bottom && bottom.beltLoops !== true) {
    out.push(R(`${cap(nm(bottom))} have no belt loops, so skip the belt.`, W.leather.beltNoLoops, 'belt-no-loops'));
  }
  const bt = leatherTone(belt);
  const st = leatherTone(shoes);
  if (bt && st) {
    const shoeWord = `${pretty(st)} ${kindOf(shoes)}`;
    if (bt === st) {
      out.push(R(`${cap(pretty(bt))} belt matches your ${shoeWord}.`, W.leather.match, 'leather-match'));
    } else if ((bt === 'black' && BROWNS.has(st)) || (st === 'black' && BROWNS.has(bt))) {
      out.push(R(`${cap(pretty(bt))} belt with ${shoeWord}: black and brown leather don't mix.`, W.leather.clash, 'leather-clash'));
    } else if (BROWNS.has(bt) && BROWNS.has(st)) {
      out.push(R(`${cap(pretty(bt))} belt and ${shoeWord} are close but not an exact match.`, W.leather.near, 'leather-near'));
    } else if ((bt === 'burgundy' && BROWNS.has(st)) || (st === 'burgundy' && BROWNS.has(bt))) {
      out.push(R(`${cap(pretty(bt))} belt and ${shoeWord} are close but not an exact match.`, W.leather.nearBurgundy, 'leather-near'));
    } else if ((bt === 'burgundy' && st === 'black') || (st === 'burgundy' && bt === 'black')) {
      out.push(R(`${cap(pretty(bt))} belt with ${shoeWord} is a slightly odd mix.`, W.leather.nearOther, 'leather-near'));
    }
  }
  const fabricBelt = ['canvas', 'fabric', 'synthetic'].includes(belt.material) || !bt;
  if (fabricBelt) {
    const casualShoes = shoes && (['canvas', 'synthetic'].includes(shoes.material) || fm(shoes) <= 2);
    if (P.of >= 4 || (bottom && fm(bottom) >= 4)) {
      out.push(R(`${cap(nm(belt))} is too casual for a dressy outfit.`, W.leather.casualBeltDressy, 'belt-casual'));
    } else if (casualShoes) {
      out.push(R(`${cap(nm(belt))} suits your ${kindOf(shoes)}: relaxed and matching.`, W.leather.casualBeltCasualShoes, 'belt-casual-ok'));
    }
  }
  if (bottom) {
    const d = fm(belt) - fm(bottom);
    if (Math.abs(d) >= 2) {
      out.push(R(`${cap(nm(belt))} is too ${d > 0 ? 'dressy' : 'casual'} for ${nm(bottom)}.`,
        Math.max(W.leather.beltFormalityCap, W.leather.beltFormalityPerLevel * (Math.abs(d) - 1)), 'belt-formality'));
    }
  }
  return out;
}

// ---------- weather ----------
export function weatherRules(P) {
  const out = [];
  const { ctx, layer, bottom, neckwear, headwear } = P;
  const wk = ctx.weather;
  const w = wk && WEATHER[wk];
  if (w) {
    const warmth = (P.top ? wm(P.top) : 0) + [layer, neckwear, headwear].reduce((s, i) => s + (i ? wm(i) : 0), 0);
    const label = w.label.toLowerCase();
    if (warmth < w.minWarmth) {
      out.push(R(`Too light for ${label} weather: you'd feel cold.`, Math.max(W.weather.cap, W.weather.perLevel * (w.minWarmth - warmth)), 'weather-cold'));
    } else if (warmth > w.maxWarmth) {
      out.push(R(`Too warm for ${label} weather: you'd overheat.`, Math.max(W.weather.cap, W.weather.perLevel * (warmth - w.maxWarmth)), 'weather-hot'));
    } else {
      out.push(R(`Just the right warmth for ${label} weather.`, W.weather.fits, 'weather-ok'));
    }
    const shortsBottom = bottom && (bottom.kind === 'shorts' || bottom.kind === 'athletic shorts');
    if (wk === 'hot') {
      if (!layer) out.push(R('No extra layer: good for the heat.', W.weather.hotNoLayer, 'weather-nolayer-hot'));
      if (shortsBottom) out.push(R('Shorts are welcome in the heat.', W.weather.hotShorts, 'weather-shorts'));
    }
    if (wk === 'cold' || wk === 'freezing') {
      if (layer) out.push(R(`${cap(nm(layer))} keeps you warm.`, W.weather.coldLayer, 'weather-layer'));
      else out.push(R("No jacket or layer: you'll want one in this cold.", W.weather.coldNoLayer, 'weather-nolayer'));
      for (const a of [neckwear, headwear]) {
        if (a && wm(a) > 0) out.push(R(`${cap(nm(a))} adds welcome warmth.`, W.weather.coldAccessory, 'weather-accessory'));
      }
      if (shortsBottom) out.push(R('Shorts in the cold: brrr.', W.weather.coldShorts, 'weather-shorts-cold'));
    }
    if (wk === 'hot' || wk === 'warm') {
      for (const a of [neckwear, headwear]) {
        if (a && wm(a) > 0) out.push(R(`${cap(nm(a))} is too warm for today.`, W.weather.hotAccessory, 'weather-accessory-hot'));
      }
    }
  }
  if (ctx.rain) {
    if (layer && layer.rain === true) out.push(R(`${cap(nm(layer))} keeps the rain off.`, W.weather.rainLayer, 'rain-layer'));
    else out.push(R('No rain jacket for a wet day.', W.weather.noRainLayer, 'rain-none'));
    if (P.shoes && P.shoes.material === 'suede') out.push(R("Suede shoes don't like the rain.", W.weather.rainSuede, 'rain-suede'));
  }
  return out;
}

// ---------- feedback ----------
const hasKey = (set, k) => (set instanceof Set ? set.has(k) : Array.isArray(set) ? set.includes(k) : false);
const sizeOf = (set) => (set instanceof Set ? set.size : Array.isArray(set) ? set.length : 0);

export function feedbackRules(P) {
  const fb = P.ctx.feedback;
  if (!fb) return [];
  const out = [];
  const likedN = sizeOf(fb.liked); const dislikedN = sizeOf(fb.disliked);
  if (!likedN && !dislikedN) return out;
  const key = outfitKey(P.items);
  if (hasKey(fb.liked, key)) out.push(R('You liked this exact outfit before.', W.feedback.likedOutfit, 'feedback-liked'));
  if (hasKey(fb.disliked, key)) out.push(R("You didn't like this exact outfit before.", W.feedback.dislikedOutfit, 'feedback-disliked'));
  const present = Object.keys(P.items).sort().map((s) => P.items[s]).filter((i) => i && i.id);
  let total = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const k = pairKey(String(present[i].id), String(present[j].id));
      if (hasKey(fb.liked, k) && total < W.feedback.pairCap) {
        total += W.feedback.likedPair;
        out.push(R(`You liked ${nm(present[i])} with ${nm(present[j])} before.`, W.feedback.likedPair, 'feedback-pair-liked'));
      }
      if (hasKey(fb.disliked, k) && total > -W.feedback.pairCap) {
        total += W.feedback.dislikedPair;
        out.push(R(`You didn't like ${nm(present[i])} with ${nm(present[j])} before.`, W.feedback.dislikedPair, 'feedback-pair-disliked'));
      }
    }
  }
  return out;
}

/** Run every rule. Returns the unsorted list of Reasons. */
export function evaluateRules(P) {
  return [].concat(
    colorRules(P), contrastRules(P), patternRules(P), formalityRules(P), occasionRules(P),
    neckwearRules(P), headwearRules(P), shoeRules(P), beltRules(P), weatherRules(P), feedbackRules(P),
  );
}
