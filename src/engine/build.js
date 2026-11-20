// Staged outfit search + gap analysis. Never a full cartesian product.

import { SLOTS, COLOR_FAMILIES, makeItem, outfitKey, todayISO } from '../model.js';
import { rawScore, squash, finalizeReasons } from './score.js';
import { leatherTone, familyOf } from './rules.js';

const PAIR_KEEP = 40;      // top+bottom pairs kept after stage 1
const SHOE_KEEP = 3;       // shoe options kept per pair
const CAND_KEEP = 60;      // candidates that get layer/neckwear/headwear tried
const MIN_GAIN = 2;        // an optional item must raise the raw score by this much
const DAY = 864e5;

const cmpId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dayMs(s) {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : NaN;
}

function prepareWardrobe(items, opts) {
  const byId = new Map();
  const bySlot = {};
  for (const s of SLOTS) bySlot[s] = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object' || !it.id || !bySlot[it.slot] || it.available === false || byId.has(it.id)) continue;
    byId.set(it.id, it);
    bySlot[it.slot].push(it);
  }
  const locked = {};
  const locks = opts.locks && typeof opts.locks === 'object' ? opts.locks : {};
  for (const s of SLOTS) {
    const it = byId.get(locks[s]);
    if (it && it.slot === s) locked[s] = it;
  }
  const exclude = opts.exclude && typeof opts.exclude === 'object' ? opts.exclude : {};
  const pools = {};
  for (const s of SLOTS) {
    if (locked[s]) { pools[s] = [locked[s]]; continue; }
    const ex = new Set(Array.isArray(exclude[s]) ? exclude[s] : []);
    pools[s] = bySlot[s].filter((i) => !ex.has(i.id)).sort(cmpId);
  }
  if (locked.belt) pools.bottom = pools.bottom.filter((b) => b.beltLoops === true);
  return { pools, locked };
}

export function buildOutfits(items, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const limit = Number.isFinite(o.limit) ? Math.max(0, Math.floor(o.limit)) : 20;
  const { pools, locked } = prepareWardrobe(items, o);
  if (!pools.top.length || !pools.bottom.length || limit === 0) return [];

  const ctx = { occasion: o.occasion || 'any', weather: o.weather || null, rain: !!o.rain, feedback: o.feedback,
    beltAvailable: pools.belt.length > 0 };
  const pairCtx = { ...ctx, weather: null, rain: false, beltAvailable: false };

  // recent-wear penalty per item
  const recentDays = Number.isFinite(o.recentDays) ? o.recentDays : 3;
  const todayMs = dayMs(o.today || todayISO());
  const penCache = new Map();
  const SLOT_W = { top: 1, bottom: 0.6, layer: 0.6, shoes: 0.6 };
  const diffOf = (it) => {
    let best = Infinity;
    for (const w of it.worn || []) {
      const d = (todayMs - dayMs(w)) / DAY;
      if (d >= 0 && d < best) best = d;
    }
    return best;
  };
  const penOf = (it) => {
    if (!(recentDays > 0) || !SLOT_W[it.slot] || !Array.isArray(it.worn) || !it.worn.length) return 0;
    let p = penCache.get(it.id);
    if (p === undefined) {
      const d = diffOf(it);
      p = d < recentDays ? Math.max(2, 12 * (1 - d / recentDays)) * SLOT_W[it.slot] : 0;
      penCache.set(it.id, p);
    }
    return p;
  };
  const penalty = (sel) => { let t = 0; for (const s in SLOT_W) if (sel[s]) t += penOf(sel[s]); return t; };
  const raw = (sel, c) => rawScore(sel, c).raw - penalty(sel);

  const lockedExtras = {};
  for (const s of ['layer', 'neckwear', 'headwear', 'extra']) if (locked[s]) lockedExtras[s] = locked[s];

  // stage 1: pairs
  const pairs = [];
  for (const t of pools.top) {
    for (const b of pools.bottom) pairs.push({ t, b, r: raw({ top: t, bottom: b }, pairCtx) });
  }
  const sortDesc = (a, b) => b.r - a.r || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
  for (const p of pairs) p.k = `${p.t.id}|${p.b.id}`;
  pairs.sort(sortDesc);
  const keepPairs = Math.max(PAIR_KEEP, ctx.weather ? 60 : 0, limit * 3);
  pairs.length = Math.min(pairs.length, Math.min(keepPairs, 150));

  // stage 2: shoes, then the belt
  const best = (base, slot, pool, c) => {
    let bi = null; let br = -Infinity;
    for (const it of pool) {
      const r = raw({ ...base, [slot]: it }, c);
      if (r > br || (r === br && bi && it.id < bi.id)) { br = r; bi = it; }
    }
    return { item: bi, r: br };
  };
  let cands = [];
  for (const p of pairs) {
    const base = { top: p.t, bottom: p.b, ...lockedExtras };
    let shoeOpts;
    if (!pools.shoes.length) shoeOpts = [null];
    else if (pools.shoes.length === 1) shoeOpts = pools.shoes;
    else {
      shoeOpts = pools.shoes.map((s) => ({ s, r: raw({ ...base, shoes: s }, ctx) }))
        .sort((a, b) => b.r - a.r || cmpId(a.s, b.s)).slice(0, SHOE_KEEP).map((x) => x.s);
    }
    for (const sh of shoeOpts) {
      const sel = { ...base };
      if (sh) sel.shoes = sh;
      if (p.b.beltLoops === true && pools.belt.length) {
        sel.belt = best(sel, 'belt', pools.belt, ctx).item;
      }
      cands.push({ sel, r: raw(sel, ctx) });
    }
  }
  const keyOf = (sel) => outfitKey(sel);
  for (const c of cands) c.k = keyOf(c.sel);
  cands.sort(sortDesc);
  cands = cands.slice(0, Math.max(CAND_KEEP, limit * 3));

  // stage 3: layer / neckwear / headwear
  const w = ctx.weather;
  const cold = w === 'cold' || w === 'freezing';
  const occ = ctx.occasion;
  const smart = occ === 'work' || occ === 'date' || occ === 'formal';
  for (const c of cands) {
    if (!locked.layer && pools.layer.length) tryAdd(c, 'layer', pools.layer);
    if (!locked.neckwear && pools.neckwear.length) {
      const pool = pools.neckwear.filter((n) => (n.kind === 'scarf' ? cold : smart && c.sel.top.collared === true));
      if (pool.length) tryAdd(c, 'neckwear', pool);
    }
    if (!locked.headwear && pools.headwear.length && cold) tryAdd(c, 'headwear', pools.headwear);
  }
  function tryAdd(c, slot, pool) {
    const b = best(c.sel, slot, pool, ctx);
    if (b.item && b.r - c.r >= MIN_GAIN) {
      c.sel = { ...c.sel, [slot]: b.item };
      c.r = raw(c.sel, ctx);
    }
  }

  // dedupe and rank
  const uniq = new Map();
  for (const c of cands) {
    c.k = keyOf(c.sel);
    if (!uniq.has(c.k) || uniq.get(c.k).r < c.r) uniq.set(c.k, c);
  }
  let ranked = [...uniq.values()].sort(sortDesc);
  ranked = o.diversity === false ? ranked.slice(0, limit) : diversify(ranked, limit, locked);

  return ranked.map((c) => {
    const res = rawScore(c.sel, ctx);
    const reasons = res.reasons.slice();
    let r = res.raw;
    for (const s in SLOT_W) {
      const it = c.sel[s];
      const p = it ? penOf(it) : 0;
      if (p > 0) {
        r -= p;
        const d = diffOf(it);
        const when = d < 0.5 ? 'today' : d < 1.5 ? 'yesterday' : `${Math.round(d)} days ago`;
        reasons.push({ text: `You wore your ${it.name || it.kind} ${when}.`, delta: -Math.round(p * 10) / 10, tag: 'recently-worn' });
      }
    }
    return { items: { ...c.sel }, score: squash(r), reasons: finalizeReasons(reasons, 6), key: c.k };
  });
}

function diversify(ranked, limit, locked) {
  const PAIR_CAP = 2; const ITEM_CAP = 3; const TOP_N = 10;
  const picked = []; const skipped = [];
  const pairs = new Map(); const counts = new Map();
  const slots = ['top', 'bottom', 'shoes', 'layer'].filter((s) => !locked[s]);
  for (const c of ranked) {
    if (picked.length >= limit) break;
    const pk = `${c.sel.top.id}|${c.sel.bottom.id}`;
    let ok = (pairs.get(pk) || 0) < PAIR_CAP;
    if (ok && picked.length < TOP_N) {
      for (const s of slots) if (c.sel[s] && (counts.get(c.sel[s].id) || 0) >= ITEM_CAP) { ok = false; break; }
    }
    if (!ok) { skipped.push(c); continue; }
    picked.push(c);
    pairs.set(pk, (pairs.get(pk) || 0) + 1);
    for (const s of slots) if (c.sel[s]) counts.set(c.sel[s].id, (counts.get(c.sel[s].id) || 0) + 1);
  }
  if (picked.length < limit) {
    for (const c of skipped) { if (picked.length >= limit) break; picked.push(c); }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// gapAnalysis
// ---------------------------------------------------------------------------

const hexOf = (f) => COLOR_FAMILIES[f].hex;
const cand = (slot, kind, family, extra = {}) => ({ slot, kind, family, ...extra });

const CATALOGUE = [
  cand('top', 'oxford', 'white'), cand('top', 'button-down', 'light-blue'), cand('top', 't-shirt', 'grey'),
  cand('top', 't-shirt', 'white'), cand('top', 'polo', 'navy'), cand('top', 'sweater', 'cream'),
  cand('bottom', 'chinos', 'navy'), cand('bottom', 'chinos', 'beige'), cand('bottom', 'jeans', 'denim'),
  cand('bottom', 'jeans', 'black'), cand('bottom', 'chinos', 'olive'), cand('bottom', 'dress pants', 'grey'),
  cand('shoes', 'sneakers', 'white'), cand('shoes', 'boots', 'brown', { leather: 'brown' }),
  cand('shoes', 'loafers', 'brown', { leather: 'brown' }), cand('shoes', 'derbies', 'black', { leather: 'black' }),
  cand('belt', 'leather belt', 'brown', { leather: 'brown' }), cand('belt', 'leather belt', 'black', { leather: 'black' }),
  cand('belt', 'leather belt', 'tan', { leather: 'tan' }), cand('belt', 'leather belt', 'dark-brown', { leather: 'dark-brown' }),
  cand('layer', 'blazer', 'navy'), cand('layer', 'denim jacket', 'denim'), cand('layer', 'overshirt', 'olive'),
  cand('layer', 'cardigan', 'grey'), cand('layer', 'rain jacket', 'navy'), cand('layer', 'peacoat', 'charcoal'),
];

const LEATHER_FAMILY = { black: 'black', 'dark-brown': 'brown', brown: 'brown', tan: 'beige', burgundy: 'burgundy', white: 'white', other: 'brown' };
const GOOD = 75;

function toItem(c, idx) {
  const leather = c.leather;
  return makeItem({
    id: `__gap_${idx}`, slot: c.slot, kind: c.kind,
    name: `${c.leather ? `${c.leather.replace('-', ' ')} ` : `${c.family.replace('-', ' ')} `}${c.kind}`,
    colors: [{ hex: hexOf(leather ? (LEATHER_FAMILY[leather] || 'brown') : c.family), family: leather ? (LEATHER_FAMILY[leather] || 'brown') : c.family, weight: 1 }],
    material: leather ? 'leather' : undefined, leather,
  });
}

/**
 * "What one purchase would unlock the most good outfits?"
 * @returns {Array<{slot,kind,family,leather?,unlocks,text,name}>}
 */
export function gapAnalysis(items, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const avail = (Array.isArray(items) ? items : []).filter((i) => i && i.id && i.available !== false);
  const base = { occasion: o.occasion, weather: o.weather, rain: o.rain, feedback: o.feedback, today: o.today, recentDays: 0,
    diversity: false, limit: 400 };
  const tops = avail.filter((i) => i.slot === 'top');
  const bottoms = avail.filter((i) => i.slot === 'bottom');
  if (!tops.length && !bottoms.length) return [];

  const baseline = new Map(); // "top|bottom" -> { score, hasBelt }
  for (const out of buildOutfits(avail, base)) {
    const k = `${out.items.top.id}|${out.items.bottom.id}`;
    const cur = baseline.get(k);
    if (!cur || out.score > cur.score) baseline.set(k, { score: out.score, hasBelt: !!out.items.belt });
  }

  // leather mismatch: shoe leather tones with no belt of that tone
  const shoes = avail.filter((i) => i.slot === 'shoes' && leatherTone(i));
  const beltTones = new Set(avail.filter((i) => i.slot === 'belt').map(leatherTone).filter(Boolean));
  const shoeTones = [...new Set(shoes.map(leatherTone))].sort();
  const wantsBelt = bottoms.some((b) => b.beltLoops === true) || !bottoms.length;
  const missing = wantsBelt ? shoeTones.filter((t) => !beltTones.has(t)) : [];

  const catalogue = CATALOGUE.slice();
  for (const t of missing) {
    if (!catalogue.some((c) => c.slot === 'belt' && c.leather === t)) catalogue.push(cand('belt', 'leather belt', LEATHER_FAMILY[t] || 'brown', { leather: t }));
  }

  const owned = (c) => avail.some((i) => i.slot === c.slot && i.kind === c.kind && familyOf(i) === (c.leather ? (LEATHER_FAMILY[c.leather] || 'brown') : c.family)
    && (!c.leather || leatherTone(i) === c.leather));

  const results = [];
  catalogue.forEach((c, idx) => {
    if (owned(c)) return;
    if (c.slot === 'belt' && !wantsBelt) return;
    const it = toItem(c, idx);
    const outs = buildOutfits([...avail, it], { ...base, locks: { [c.slot]: it.id } });
    const pairsDone = new Set();
    for (const out of outs) {
      if (out.score < GOOD) continue;
      const k = `${out.items.top.id}|${out.items.bottom.id}`;
      const b = baseline.get(k);
      const isNew = !b || b.score < GOOD || (c.slot === 'belt' && !b.hasBelt && out.items.bottom.beltLoops === true);
      if (isNew) pairsDone.add(k);
    }
    const unlocks = pairsDone.size;
    const isMismatch = c.slot === 'belt' && missing.includes(c.leather);
    if (unlocks > 0 || isMismatch) results.push({ c, it, unlocks, isMismatch });
  });

  results.sort((a, b) => (b.isMismatch - a.isMismatch) || (b.unlocks - a.unlocks) || (a.it.name < b.it.name ? -1 : 1));
  return results.filter((r) => r.unlocks > 0 || r.isMismatch).slice(0, 5).map(({ c, it, unlocks, isMismatch }) => {
    const n = unlocks === 1 ? '1 outfit' : `${unlocks} outfits`;
    const plural = /s$/.test(c.kind);
    const a = plural ? 'Adding' : /^[aeiou]/i.test(it.name) ? 'An' : 'A';
        let text;
    if (c.slot === 'belt') {
      const owns = [...beltTones].map((t) => t.replace('-', ' '));
      const shoe = shoes.find((s) => leatherTone(s) === c.leather);
      const sh = shoe ? ` and match your ${c.leather.replace('-', ' ')} ${shoe.kind}` : '';
      const why = isMismatch && owns.length ? ` Your belts are ${owns.join('/')}, but you own ${c.leather.replace('-', ' ')} shoes.` : '';
      text = unlocks > 0 ? `${a} ${plural ? it.name : it.name} would complete ${n}${sh}.${why}` : `${a} ${it.name} would match your ${c.leather.replace('-', ' ')} shoes.${why}`;
    } else {
      text = `${a} ${it.name} would unlock ${n}.`;
    }
    const out = { slot: c.slot, kind: c.kind, family: c.family, unlocks, text, name: it.name };
    if (c.leather) out.leather = c.leather;
    return out;
  });
}
