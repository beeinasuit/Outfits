// Adversarial engine tests (sections A1-A4 of tests/ADVERSARIAL.md + extra skeptical-stylist checks "X*").
// Tests encode EXPECTED behaviour. Failures are findings. Every random test prints its seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { makeItem, SLOTS, KINDS, COLOR_FAMILIES, BUSY_PATTERNS, outfitKey } from '../../src/model.js';
import { scoreOutfit } from '../../src/engine/score.js';
import { buildOutfits, gapAnalysis } from '../../src/engine/build.js';
import { GOLDEN } from './fixtures/golden.js';
import { mulberry32, pick, shuffle, randomItem, randomWardrobe, realisticWardrobes, TODAY, OCCS, WEATHERS, mk } from './fixtures/adv-gen.js';

const log = (...a) => console.log('ADV|', ...a);
const bandOf = (s) => (s >= 90 ? 'CERTIFIED' : s >= 75 ? 'SHARP' : s >= 60 ? 'SOLID' : s >= 45 ? 'BOLD' : 'HMM');
const BANDS = ['CERTIFIED', 'SHARP', 'SOLID', 'BOLD', 'HMM'];
const names = (o) => Object.entries(o.items).map(([s, i]) => `${s}:${i.id}`).join(' ');
const famOf = (i) => i?.colors?.[0]?.family;

function collector() {
  return { n: 0, first: [], add(msg) { this.n++; if (this.first.length < 3) this.first.push(msg); } };
}
function none(c, label) {
  assert.equal(c.n, 0, `${label}: ${c.n} violation(s). First repros:\n  ${c.first.join('\n  ')}`);
}

// =====================================================================================
// A1. Golden set
// =====================================================================================
const margins = [];
GOLDEN.forEach((g, idx) => {
  test(`A1 golden #${idx}: ${g.why}`, () => {
    const ctx = g.ctx || {};
    const b = scoreOutfit(g.better, ctx); const w = scoreOutfit(g.worse, ctx);
    const margin = b.score - w.score;
    margins.push({ idx, why: g.why, tie: !!g.tie, better: b.score, worse: w.score, margin });
    if (g.tie) assert.ok(Math.abs(margin) <= 12, `tie case differs by ${margin} (${b.score} vs ${w.score}); better reasons=${b.reasons.map((r) => r.text)} worse reasons=${w.reasons.map((r) => r.text)}`);
    else assert.ok(margin > 0, `expected better > worse but ${b.score} vs ${w.score}\n better: ${b.reasons.map((r) => `${r.text}(${r.delta})`).join(' | ')}\n worse: ${w.reasons.map((r) => `${r.text}(${r.delta})`).join(' | ')}`);
  });
});
test('A1 golden margins report (fragile = margin < 3)', () => {
  for (const m of margins) log(`GOLDEN #${m.idx} margin=${m.margin} (${m.better} vs ${m.worse})${m.tie ? ' [tie]' : ''} ${m.margin < 3 && !m.tie ? 'FRAGILE' : ''} ${m.why}`);
  const fragile = margins.filter((m) => !m.tie && m.margin < 3);
  log(`GOLDEN fragile (<3): ${fragile.length} of ${margins.length}`);
});

// =====================================================================================
// A2. Invariants over seeded random wardrobes
// =====================================================================================
const BASE_SEED = 90000;
const TRIALS = 520;
function makeTrial(i) {
  const seed = BASE_SEED + i;
  const r = mulberry32(seed);
  const n = i < 6 ? [0, 1, 2, 3, 120, 7][i] : Math.floor(r() * 121);
  const items = randomWardrobe(r, n, { neutralBias: 0.3 + r() * 0.6 });
  const opts = { today: TODAY, occasion: pick(r, OCCS), weather: pick(r, WEATHERS), rain: r() < 0.2 };
  if (r() < 0.3) opts.limit = 1 + Math.floor(r() * 30);
  if (r() < 0.15) opts.diversity = false;
  const locks = {};
  if (r() < 0.3) {
    const avail = items.filter((x) => x.available);
    for (let k = 0; k < 1 + Math.floor(r() * 2) && avail.length; k++) { const it = pick(r, avail); locks[it.slot] = it.id; }
    opts.locks = locks;
  }
  return { seed, n, items, opts };
}
let _trials = null;
function trials() {
  if (_trials) return _trials;
  _trials = [];
  for (let i = 0; i < TRIALS; i++) {
    const t = makeTrial(i);
    try { t.out = buildOutfits(t.items, t.opts); } catch (e) { t.err = e; t.out = []; }
    _trials.push(t);
  }
  return _trials;
}
const repro = (t, o) => `seed=${t.seed} n=${t.n} opts=${JSON.stringify(t.opts)}${o ? ' outfit=' + names(o) : ''}`;
const limitOf = (t) => (Number.isFinite(t.opts.limit) ? t.opts.limit : 20);
function validLocks(t) {
  const out = {};
  for (const s of Object.keys(t.opts.locks || {})) {
    const it = t.items.find((x) => x.id === t.opts.locks[s]);
    if (it && it.available && it.slot === s) out[s] = it.id;
  }
  return out;
}

test(`A2.0 ${TRIALS} trials never throw (base seed ${BASE_SEED})`, () => {
  const c = collector();
  for (const t of trials()) if (t.err) c.add(`${repro(t)} -> ${t.err.stack.split('\n').slice(0, 2).join(' ')}`);
  none(c, 'buildOutfits threw');
});
test('A2.1 score is an integer in 0..100, never NaN', () => {
  const c = collector();
  for (const t of trials()) for (const o of t.out) if (!Number.isInteger(o.score) || o.score < 0 || o.score > 100) c.add(`${repro(t, o)} score=${o.score}`);
  none(c, 'bad score');
});
test('A2.2 top+bottom present; item.slot===slot; no item twice', () => {
  const c = collector();
  for (const t of trials()) for (const o of t.out) {
    if (!o.items.top || !o.items.bottom) c.add(`${repro(t, o)} missing top/bottom`);
    const ids = new Set();
    for (const [s, it] of Object.entries(o.items)) {
      if (!it || it.slot !== s) c.add(`${repro(t, o)} slot mismatch ${s}`);
      if (ids.has(it?.id)) c.add(`${repro(t, o)} duplicate item ${it?.id}`);
      ids.add(it?.id);
    }
  }
  none(c, 'structure');
});
test('A2.3 unavailable items never appear', () => {
  const c = collector();
  for (const t of trials()) {
    const bad = new Set(t.items.filter((i) => !i.available).map((i) => i.id));
    for (const o of t.out) for (const it of Object.values(o.items)) if (bad.has(it.id)) c.add(`${repro(t, o)} laundry item ${it.id}`);
  }
  none(c, 'laundry item suggested');
});
test('A2.4 belt rule: loops + available belt => belt; no loops => never a belt', () => {
  const c = collector();
  for (const t of trials()) {
    const beltExists = t.items.some((i) => i.slot === 'belt' && i.available);
    for (const o of t.out) {
      const loops = o.items.bottom.beltLoops === true;
      if (loops && beltExists && !o.items.belt) c.add(`${repro(t, o)} loops but no belt although one is available`);
      if (!loops && o.items.belt) c.add(`${repro(t, o)} belt on loopless bottom ${o.items.bottom.id}`);
    }
  }
  none(c, 'belt rule');
});
test('A2.4b no belt-related score penalty text for loopless bottoms / missing belt in built outfits', () => {
  const c = collector();
  for (const t of trials()) for (const o of t.out) for (const r of o.reasons) {
    if (r.tag === 'belt-no-loops') c.add(`${repro(t, o)} ${r.text}`);
    if (r.tag === 'belt-missing' && !o.items.belt) c.add(`${repro(t, o)} built outfit still carries belt-missing`);
  }
  none(c, 'belt penalty');
});
test('A2.5 ties only with a collared top (scarf exempt)', () => {
  const c = collector();
  for (const t of trials()) {
    const locked = validLocks(t);
    for (const o of t.out) {
      const n = o.items.neckwear;
      if (n && n.kind !== 'scarf' && !o.items.top.collared && !locked.neckwear) c.add(`${repro(t, o)} ${n.kind} with non-collared ${o.items.top.kind}`);
    }
  }
  none(c, 'neckwear without collar');
});
test('A2.6 unique keys; length <= limit; key matches items', () => {
  const c = collector();
  for (const t of trials()) {
    const keys = new Set();
    if (t.out.length > limitOf(t)) c.add(`${repro(t)} returned ${t.out.length} > limit`);
    for (const o of t.out) {
      if (keys.has(o.key)) c.add(`${repro(t, o)} duplicate key`);
      keys.add(o.key);
      if (o.key !== outfitKey(o.items)) c.add(`${repro(t, o)} key mismatch`);
    }
  }
  none(c, 'keys/limit');
});
test('A2.6b results are sorted best-first (ARCHITECTURE: "best first")', () => {
  const c = collector();
  for (const t of trials()) {
    for (let i = 1; i < t.out.length; i++) if (t.out[i].score > t.out[i - 1].score) { c.add(`${repro(t)} index ${i - 1}->${i}: ${t.out.map((o) => o.score).join(',')}`); break; }
  }
  none(c, 'not sorted by score desc');
});
test('A2.6c with diversity:false results are strictly sorted', () => {
  const c = collector();
  for (const t of trials()) {
    if (t.opts.diversity !== false) continue;
    for (let i = 1; i < t.out.length; i++) if (t.out[i].score > t.out[i - 1].score) { c.add(`${repro(t)} ${t.out.map((o) => o.score).join(',')}`); break; }
  }
  none(c, 'unsorted without diversity');
});
test('A2.7a valid locks honoured in every result', () => {
  const c = collector();
  let withLocks = 0;
  for (const t of trials()) {
    const L = validLocks(t);
    if (Object.keys(L).length) withLocks++;
    for (const o of t.out) for (const [s, id] of Object.entries(L)) if (o.items[s]?.id !== id) c.add(`${repro(t, o)} lock ${s}=${id} violated`);
  }
  assert.ok(withLocks > 50, 'not enough lock trials');
  none(c, 'lock violated');
});
test('A2.7b invalid locks (unknown / unavailable / wrong slot) are ignored, not fatal', () => {
  const c = collector();
  for (let i = 0; i < 200; i++) {
    const seed = 70000 + i; const r = mulberry32(seed);
    const items = randomWardrobe(r, 5 + Math.floor(r() * 40));
    const opts = { today: TODAY, occasion: pick(r, OCCS), weather: pick(r, WEATHERS) };
    const base = buildOutfits(items, opts);
    const unavailable = items.find((x) => !x.available);
    const locks = { top: 'does-not-exist', bottom: 'nope' };
    if (unavailable) locks[unavailable.slot === 'top' || unavailable.slot === 'bottom' ? 'layer' : unavailable.slot] = unavailable.id; // may be wrong slot as well
    const wrongSlot = items.find((x) => x.available && x.slot === 'shoes');
    if (wrongSlot) locks.top = wrongSlot.id;
    try {
      const out = buildOutfits(items, { ...opts, locks });
      // unavailable id in its own slot or wrong-slot lock must not appear/force anything
      for (const o of out) for (const it of Object.values(o.items)) if (!it.available) c.add(`seed=${seed} laundry item via lock ${it.id}`);
      if (unavailable && !['top', 'bottom'].includes(unavailable.slot)) continue;
      const ok = JSON.stringify(out.map((o) => o.key)) === JSON.stringify(base.map((o) => o.key));
      if (!ok && !unavailable) c.add(`seed=${seed} invalid locks changed results: ${JSON.stringify(locks)}`);
    } catch (e) { c.add(`seed=${seed} threw ${e.message}`); }
  }
  none(c, 'invalid lock handling');
});
test('A2.8a determinism: same input -> deep-equal output', () => {
  const c = collector();
  for (const t of trials().slice(0, 150)) {
    const again = buildOutfits(t.items, t.opts);
    try { assert.deepEqual(again, t.out); } catch { c.add(repro(t)); }
  }
  none(c, 'non-deterministic');
});
test('A2.8b shuffling the wardrobe array does not change the result set', () => {
  const c = collector();
  for (const t of trials().slice(0, 200)) {
    const r = mulberry32(t.seed ^ 0xabc);
    const sh = buildOutfits(shuffle(r, t.items), t.opts);
    const a = t.out.map((o) => `${o.key}#${o.score}`).sort().join(',');
    const b = sh.map((o) => `${o.key}#${o.score}`).sort().join(',');
    if (a !== b) c.add(`${repro(t)}\n    orig=${t.out.map((o) => o.score)}\n    shuf=${sh.map((o) => o.score)}`);
  }
  none(c, 'order-dependent');
});
test('A2.9 scoreOutfit independent of object key order', () => {
  const c = collector();
  for (const t of trials().slice(0, 150)) {
    const r = mulberry32(t.seed ^ 0x777);
    for (const o of t.out.slice(0, 5)) {
      const ctx = { occasion: t.opts.occasion, weather: t.opts.weather, rain: t.opts.rain };
      const base = scoreOutfit(o.items, ctx);
      const permuted = {};
      for (const k of shuffle(r, Object.keys(o.items))) permuted[k] = o.items[k];
      const p = scoreOutfit(permuted, ctx);
      if (p.score !== base.score || JSON.stringify(p.reasons) !== JSON.stringify(base.reasons)) c.add(`${repro(t, o)} ${base.score} vs ${p.score}`);
    }
  }
  none(c, 'key-order dependent');
});
test('A2.9b scoreOutfit independent of feedback key order (set vs array)', () => {
  const items = { top: mk('a', 'top', 't-shirt', 'white'), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white') };
  const key = outfitKey(items);
  const s1 = scoreOutfit(items, { feedback: { liked: new Set([key]), disliked: new Set() } }).score;
  const s2 = scoreOutfit(items, { feedback: { liked: [key], disliked: [] } }).score;
  assert.equal(s1, s2);
});
test('A2.10a runtime: 300 items < 300 ms', () => {
  const r = mulberry32(31337);
  const items = randomWardrobe(r, 300, { availableP: 1, neutralBias: 0.7 });
  buildOutfits(items.slice(0, 40), { today: TODAY }); // warm-up JIT on a different input
  const t0 = performance.now(); const out = buildOutfits(items, { today: TODAY }); const dt = performance.now() - t0;
  log(`RUNTIME 300 items: ${dt.toFixed(0)} ms, ${out.length} outfits`);
  assert.ok(dt < 300, `300 items took ${dt.toFixed(0)} ms (seed 31337)`);
});
test('A2.10b runtime: 1000 items < 2 s', () => {
  const r = mulberry32(31338);
  const items = randomWardrobe(r, 1000, { availableP: 1, neutralBias: 0.7 });
  const t0 = performance.now(); buildOutfits(items, { today: TODAY, weather: 'cold', occasion: 'work' }); const dt = performance.now() - t0;
  log(`RUNTIME 1000 items: ${dt.toFixed(0)} ms`);
  assert.ok(dt < 2000, `1000 items took ${dt.toFixed(0)} ms (seed 31338)`);
});
test('A2.11 stress: 400-item wardrobe keeps every invariant (all occasions x weathers)', () => {
  const c = collector();
  const r = mulberry32(400400);
  const items = randomWardrobe(r, 400, { neutralBias: 0.6 });
  const beltExists = items.some((i) => i.slot === 'belt' && i.available);
  const bad = new Set(items.filter((i) => !i.available).map((i) => i.id));
  for (const occasion of OCCS) for (const weather of WEATHERS) {
    const out = buildOutfits(items, { today: TODAY, occasion, weather, rain: weather === 'mild' });
    for (const o of out) {
      const tag = `seed=400400 occ=${occasion} w=${weather} ${names(o)}`;
      if (!Number.isInteger(o.score) || o.score < 0 || o.score > 100) c.add(`${tag} score`);
      if (o.items.bottom.beltLoops && beltExists && !o.items.belt) c.add(`${tag} missing belt`);
      if (!o.items.bottom.beltLoops && o.items.belt) c.add(`${tag} belt w/o loops`);
      for (const it of Object.values(o.items)) if (bad.has(it.id)) c.add(`${tag} laundry`);
    }
  }
  none(c, 'stress');
});

// =====================================================================================
// A3. Metamorphic relations
// =====================================================================================
const best = (out) => (out.length ? Math.max(...out.map((o) => o.score)) : -1);
test('A3.1 adding an item (not shoes/belt) never lowers the best score', () => {
  const c = collector();
  for (let i = 0; i < 250; i++) {
    const seed = 11000 + i; const r = mulberry32(seed);
    const items = randomWardrobe(r, 3 + Math.floor(r() * 40), { availableP: 1 });
    const opts = { today: TODAY, occasion: pick(r, OCCS), weather: pick(r, WEATHERS) };
    const before = best(buildOutfits(items, opts));
    const slot = pick(r, ['top', 'bottom', 'layer', 'neckwear', 'headwear', 'extra']);
    const added = randomItem(r, 'added', { slot, availableP: 1 });
    const after = best(buildOutfits([...items, added], opts));
    if (before >= 0 && after < before) c.add(`seed=${seed} occ=${opts.occasion} w=${opts.weather} adding ${slot}/${added.kind}/${famOf(added)} dropped best ${before} -> ${after}`);
  }
  none(c, 'adding an item lowered the best score');
});
test('A3.1b (informational) adding shoes/belt can lower best score because slot becomes mandatory', () => {
  let drops = 0; const ex = [];
  for (let i = 0; i < 250; i++) {
    const seed = 12000 + i; const r = mulberry32(seed);
    const items = randomWardrobe(r, 3 + Math.floor(r() * 40), { availableP: 1 });
    const opts = { today: TODAY, occasion: pick(r, OCCS), weather: pick(r, WEATHERS) };
    const before = best(buildOutfits(items, opts));
    const added = randomItem(r, 'added', { slot: pick(r, ['shoes', 'belt']), availableP: 1 });
    const after = best(buildOutfits([...items, added], opts));
    if (before >= 0 && after < before) { drops++; if (ex.length < 2) ex.push(`seed=${seed} ${added.slot}/${added.kind} ${before}->${after}`); }
  }
  log(`INFO adding shoes/belt lowered best score in ${drops}/250 trials; ${ex.join('; ')}`);
});
test('A3.2 marking any result item unavailable removes it from every result', () => {
  const c = collector();
  for (let i = 0; i < 200; i++) {
    const t = trials()[6 + i];
    if (!t.out.length) continue;
    const r = mulberry32(t.seed ^ 5);
    const victim = pick(r, Object.values(pick(r, t.out).items));
    const items2 = t.items.map((x) => (x.id === victim.id ? { ...x, available: false } : x));
    const opts2 = { ...t.opts, locks: undefined };
    const out = buildOutfits(items2, opts2);
    for (const o of out) for (const it of Object.values(o.items)) if (it.id === victim.id) c.add(`${repro(t, o)} victim=${victim.id}`);
  }
  none(c, 'unavailable item still suggested');
});
test('A3.3 liking an outfit does not lower its rank; disliking does not raise it', () => {
  const c = collector();
  const W = realisticWardrobes();
  for (const [name, w] of Object.entries(W)) for (const occasion of ['any', 'work']) {
    const opts = { today: TODAY, occasion, limit: 40, diversity: false };
    const base = buildOutfits(w, opts);
    for (const idx of [0, 3, 8, 15]) {
      const o = base[idx]; if (!o) continue;
      const liked = buildOutfits(w, { ...opts, feedback: { liked: new Set([o.key]), disliked: new Set() } });
      const disliked = buildOutfits(w, { ...opts, feedback: { liked: new Set(), disliked: new Set([o.key]) } });
      const rl = liked.findIndex((x) => x.key === o.key); const rd = disliked.findIndex((x) => x.key === o.key);
      if (rl < 0 || rl > idx) c.add(`${name}/${occasion} liked outfit idx ${idx} -> ${rl}`);
      if (rd !== -1 && rd < idx) c.add(`${name}/${occasion} disliked outfit idx ${idx} -> ${rd}`);
      const sl = liked[rl]?.score; if (sl !== undefined && sl < o.score) c.add(`${name} liked score dropped ${o.score}->${sl}`);
    }
  }
  none(c, 'feedback monotonicity');
});
test('A3.3b disliking the #1 outfit pushes it out of the top 3', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const base = buildOutfits(w, { today: TODAY });
    const d = buildOutfits(w, { today: TODAY, feedback: { liked: new Set(), disliked: new Set([base[0].key]) } });
    const idx = d.findIndex((x) => x.key === base[0].key);
    if (idx !== -1 && idx < 3) c.add(`${name}: disliked outfit still at rank ${idx} (score ${d[idx].score}, was ${base[0].score})`);
  }
  none(c, 'dislike too weak');
});
test('A3.4 changing ids/names (not attributes) does not change scores', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const base = buildOutfits(w, { today: TODAY, occasion: 'any', diversity: false, limit: 30 });
    const renamed = w.map((x, i) => ({ ...x, id: `zz${(w.length - i).toString().padStart(4, '0')}`, name: `Thing ${i}` }));
    const out = buildOutfits(renamed, { today: TODAY, occasion: 'any', diversity: false, limit: 30 });
    const a = base.slice(0, 5).map((o) => o.score).join(','); const b = out.slice(0, 5).map((o) => o.score).join(',');
    if (a !== b) c.add(`${name}: ${a} vs ${b}`);
    for (const o of base.slice(0, 5)) {
      const mapped = {};
      for (const [s, it] of Object.entries(o.items)) mapped[s] = { ...it, id: `q-${it.id}`, name: 'Zzz' };
      if (scoreOutfit(mapped).score !== scoreOutfit(o.items).score) c.add(`${name}: scoreOutfit changed with names`);
    }
  }
  none(c, 'ids/names affect score');
});
test('A3.5 matching belt/shoe leather never scores lower than a black/brown mismatch', () => {
  const c = collector();
  for (let i = 0; i < 300; i++) {
    const seed = 15000 + i; const r = mulberry32(seed);
    const top = randomItem(r, 'top', { slot: 'top', availableP: 1 });
    const bottom = makeItem({ ...randomItem(r, 'bot', { slot: 'bottom', availableP: 1 }), id: 'bot', beltLoops: true });
    const tone = r() < 0.5 ? 'brown' : 'black'; const other = tone === 'brown' ? 'black' : 'brown';
    const shoes = makeItem({ id: 'sh', slot: 'shoes', kind: pick(r, ['boots', 'loafers', 'derbies', 'oxfords']), material: 'leather', leather: tone, colors: [{ hex: COLOR_FAMILIES[tone].hex, family: tone, weight: 1 }] });
    const kind = pick(r, ['leather belt', 'dress belt']);
    const mkBelt = (t) => makeItem({ id: `b${t}`, slot: 'belt', kind, material: 'leather', leather: t, colors: [{ hex: COLOR_FAMILIES[t].hex, family: t, weight: 1 }] });
    const ctx = { occasion: pick(r, OCCS), beltAvailable: true };
    const good = scoreOutfit({ top, bottom, shoes, belt: mkBelt(tone) }, ctx).score;
    const bad = scoreOutfit({ top, bottom, shoes, belt: mkBelt(other) }, ctx).score;
    if (good < bad) c.add(`seed=${seed} ${tone} shoes ${shoes.kind}: matching belt ${good} < mismatched ${bad}`);
  }
  none(c, 'leather match');
});
test('A3.6a hot weather: no top-5 outfit has a layer with warmth >= 2 (when alternatives exist)', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const out = buildOutfits(w, { today: TODAY, weather: 'hot' }).slice(0, 5);
    for (const o of out) if (o.items.layer && o.items.layer.warmth >= 2) c.add(`${name}: ${names(o)} layer ${o.items.layer.kind} warmth ${o.items.layer.warmth} score ${o.score}`);
  }
  none(c, 'heavy layer in heat');
});
test('A3.6b freezing: every top-5 outfit has a layer if the user owns one', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    if (!w.some((i) => i.slot === 'layer')) continue;
    const out = buildOutfits(w, { today: TODAY, weather: 'freezing' }).slice(0, 5);
    for (const o of out) if (!o.items.layer) c.add(`${name}: ${names(o)} score ${o.score} has no layer`);
  }
  none(c, 'no layer when freezing');
});
test('A3.6c cold/freezing: top-5 respects warmth (no bare tee + sandals)', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const weather of ['cold', 'freezing']) {
    for (const o of buildOutfits(w, { today: TODAY, weather }).slice(0, 5)) {
      if (o.items.shoes?.kind === 'sandals') c.add(`${name}/${weather}: sandals in top 5 ${names(o)}`);
      if (o.items.bottom.kind === 'shorts' || o.items.bottom.kind === 'athletic shorts') c.add(`${name}/${weather}: shorts in top 5 ${names(o)}`);
    }
  }
  none(c, 'cold dressing');
});
test('A3.7 an outfit worn yesterday ranks lower than the same outfit unworn', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const base = buildOutfits(w, { today: TODAY, diversity: false, limit: 60 });
    for (const idx of [0, 1, 2, 5]) {
      const o = base[idx]; if (!o) continue;
      for (const slot of ['top', 'bottom', 'shoes']) {
        if (!o.items[slot]) continue;
        const w2 = w.map((x) => (x.id === o.items[slot].id ? { ...x, worn: ['2026-11-19'] } : x));
        const out = buildOutfits(w2, { today: TODAY, diversity: false, limit: 60 });
        const j = out.find((x) => x.key === o.key);
        if (j && j.score >= o.score) c.add(`${name}: outfit #${idx} with ${slot} worn yesterday score ${o.score} -> ${j.score}`);
      }
    }
  }
  none(c, 'recent wear not penalised');
});
test('A3.7b outfit worn yesterday is explained in reasons ("You wore ... yesterday")', () => {
  const w = realisticWardrobes().standard;
  const o0 = buildOutfits(w, { today: TODAY })[0];
  const w2 = w.map((x) => (x.id === o0.items.top.id ? { ...x, worn: ['2026-11-19'] } : x));
  const o1 = buildOutfits(w2, { today: TODAY, diversity: false, limit: 60 }).find((x) => x.key === o0.key);
  assert.ok(!o1 || o1.reasons.some((r) => r.tag === 'recently-worn' && /yesterday/.test(r.text)), JSON.stringify(o1?.reasons));
});

// =====================================================================================
// A4. Hostile input
// =====================================================================================
function sane(out, label) {
  assert.ok(Array.isArray(out), `${label}: not an array`);
  for (const o of out) {
    assert.ok(Number.isInteger(o.score) && o.score >= 0 && o.score <= 100, `${label}: bad score ${o.score}`);
    assert.ok(o.items.top && o.items.bottom, `${label}: missing top/bottom`);
    for (const [s, it] of Object.entries(o.items)) assert.equal(it.slot, s, `${label}: slot mismatch`);
    assert.ok(Array.isArray(o.reasons), `${label}: reasons`);
  }
}
const good = () => [mk('t1', 'top', 't-shirt', 'white'), mk('b1', 'bottom', 'jeans', 'denim'), mk('s1', 'shoes', 'sneakers', 'white')];
const HOSTILE = {
  'missing colours': [{ id: 'x1', slot: 'top', kind: 't-shirt' }, { id: 'x2', slot: 'bottom', kind: 'jeans', beltLoops: true }],
  'colors:[null]': [{ id: 'x1', slot: 'top', colors: [null] }, { id: 'x2', slot: 'bottom', colors: [null], beltLoops: true }, { id: 'x3', slot: 'shoes', colors: [null] }],
  'unknown family ultraviolet': [{ id: 'x1', slot: 'top', colors: [{ hex: '#f0f', family: 'ultraviolet', weight: 1 }] }, { id: 'x2', slot: 'bottom', colors: [{ hex: '#000', family: 'ultraviolet', weight: 1 }] }],
  'formality NaN/99/-3': [{ ...mk('x1', 'top', 't-shirt', 'white'), formality: NaN }, { ...mk('x2', 'bottom', 'jeans', 'denim'), formality: 99 }, { ...mk('x3', 'shoes', 'sneakers', 'white'), formality: -3 }, { ...mk('x4', 'layer', 'blazer', 'navy'), formality: Infinity }],
  'slot cape': [...good(), { ...mk('c1', 'top', 't-shirt', 'red'), slot: 'cape' }],
  'duplicate ids': [mk('d', 'top', 't-shirt', 'white'), mk('d', 'top', 't-shirt', 'black'), mk('d', 'bottom', 'jeans', 'denim'), mk('d', 'shoes', 'sneakers', 'white')],
  'worn garbage': [{ ...mk('t1', 'top', 't-shirt', 'white'), worn: ['garbage', '', '2026-13-45', 'tomorrow', '9999-99-99', '2026-11-20'] }, mk('b1', 'bottom', 'jeans', 'denim'), mk('s1', 'shoes', 'sneakers', 'white')],
  'worn not array': [{ ...mk('t1', 'top', 't-shirt', 'white'), worn: 'yesterday' }, { ...mk('b1', 'bottom', 'jeans', 'denim'), worn: { a: 1 } }],
  'null/undefined/primitive entries': [null, undefined, 5, 'str', [], ...good()],
  'beltLoops strings': [{ ...mk('b1', 'bottom', 'jeans', 'denim'), beltLoops: 'true' }, mk('t1', 'top', 't-shirt', 'white'), mk('belt', 'belt', 'leather belt', 'brown', { leather: 'brown' })],
  'huge weights': [{ ...mk('t1', 'top', 't-shirt', 'white'), colors: [{ hex: '#fff', family: 'white', weight: Infinity }, { hex: '#000', family: 'black', weight: NaN }] }, mk('b1', 'bottom', 'jeans', 'denim')],
  'bad hex': [{ ...mk('t1', 'top', 't-shirt', 'white'), colors: [{ hex: 'zzz', family: 'white', weight: 1 }] }, { ...mk('b1', 'bottom', 'jeans', 'denim'), colors: [{ hex: null, family: 'denim', weight: 1 }] }],
  'unknown kinds/patterns/material': [{ ...mk('t1', 'top', 't-shirt', 'white'), kind: 'toga', pattern: 'zebra' }, { ...mk('b1', 'bottom', 'jeans', 'denim'), kind: 'kilt', material: 'unobtainium' }, { ...mk('s1', 'shoes', 'sneakers', 'white'), kind: 'clogs', leather: 'neon', material: 'leather' }],
  'names missing/huge/object': [{ ...mk('t1', 'top', 't-shirt', 'white'), name: undefined }, { ...mk('b1', 'bottom', 'jeans', 'denim'), name: { evil: 1 } }, { ...mk('s1', 'shoes', 'sneakers', 'white'), name: 'x'.repeat(100000) }],
  'only tops': Array.from({ length: 20 }, (_, i) => mk(`t${i}`, 'top', 't-shirt', 'white')),
  'only bottoms': Array.from({ length: 20 }, (_, i) => mk(`b${i}`, 'bottom', 'jeans', 'denim')),
  'no shoes no belts': [mk('t1', 'top', 't-shirt', 'white'), mk('b1', 'bottom', 'jeans', 'denim')],
  'all unavailable': good().map((i) => ({ ...i, available: false })),
};
for (const [name, items] of Object.entries(HOSTILE)) {
  test(`A4 hostile wardrobe: ${name}`, () => {
    for (const opts of [{}, { occasion: 'formal', weather: 'cold', rain: true }, { occasion: 'nonsense', weather: 'volcanic' }, { limit: 3, locks: { top: 'x1', bottom: 'x2', belt: 'belt' } }, { feedback: { liked: 'str', disliked: 5 } }, { feedback: { liked: new Set(['a']), disliked: null } }]) {
      let out;
      try { out = buildOutfits(items, { today: TODAY, ...opts }); } catch (e) { assert.fail(`threw ${e.stack.split('\n').slice(0, 3).join(' / ')} opts=${JSON.stringify(opts)}`); }
      sane(out, `${name} ${JSON.stringify(opts)}`);
      if (name === 'duplicate ids') for (const o of out) assert.equal(new Set(Object.values(o.items).map((i) => i.id)).size, Object.keys(o.items).length, 'same id twice in one outfit');
      if (name === 'slot cape') for (const o of out) assert.ok(!Object.values(o.items).some((i) => i.id === 'c1'));
      if (name === 'only tops' || name === 'only bottoms' || name === 'all unavailable') assert.deepEqual(out, []);
    }
    try { gapAnalysis(items, { today: TODAY }); } catch (e) { assert.fail(`gapAnalysis threw ${e.message}`); }
  });
}
test('A4 same id in two slots never yields the same item twice', () => {
  const a = mk('same', 'top', 't-shirt', 'white'); const b = { ...mk('same', 'bottom', 'jeans', 'denim') };
  const out = buildOutfits([a, b, mk('o', 'bottom', 'chinos', 'beige')], { today: TODAY });
  sane(out, 'same-id');
  for (const o of out) assert.equal(new Set(Object.values(o.items).map((i) => i.id)).size, Object.keys(o.items).length);
});
test('A4 wardrobe argument is not an array / null / undefined', () => {
  for (const v of [null, undefined, {}, 'abc', 42, [[]], new Set([1])]) {
    assert.deepEqual(buildOutfits(v), [], `buildOutfits(${String(v)})`);
    assert.ok(Array.isArray(gapAnalysis(v)), `gapAnalysis(${String(v)})`);
  }
  for (const o of [null, undefined, 5, 'x', [], { limit: 'abc' }]) sane(buildOutfits(good(), o), `opts ${JSON.stringify(o)}`);
});
test('A4 2000-item hostile wardrobe stays fast and sane', () => {
  const r = mulberry32(2000);
  const items = randomWardrobe(r, 2000).map((x, i) => (i % 7 === 0 ? { ...x, colors: [null], formality: NaN, worn: ['junk'] } : i % 11 === 0 ? { ...x, id: 'dup' } : x));
  const t0 = performance.now(); const out = buildOutfits(items, { today: TODAY, weather: 'cold' }); const dt = performance.now() - t0;
  sane(out, '2000');
  log(`RUNTIME hostile 2000 items: ${dt.toFixed(0)} ms`);
  assert.ok(dt < 5000, `${dt.toFixed(0)} ms`);
});
test('A4 locks on every slot / exclude everything / limit extremes', () => {
  const r = mulberry32(5150);
  const items = randomWardrobe(r, 80, { availableP: 1 });
  const locks = {};
  for (const s of SLOTS) { const c = items.find((i) => i.slot === s); if (c) locks[s] = c.id; }
  sane(buildOutfits(items, { today: TODAY, locks }), 'locks on every slot');
  const exclude = {}; for (const s of SLOTS) exclude[s] = items.filter((i) => i.slot === s).map((i) => i.id);
  assert.deepEqual(buildOutfits(items, { today: TODAY, exclude }), [], 'exclude everything');
  const exShoes = { shoes: exclude.shoes, belt: exclude.belt };
  const o2 = buildOutfits(items, { today: TODAY, exclude: exShoes });
  sane(o2, 'exclude shoes+belts'); for (const o of o2) assert.ok(!o.items.shoes && !o.items.belt, 'excluded slot still used');
  for (const limit of [0, -1, -5, NaN, Infinity, 1e9, 2.7, '5', null, undefined, 1]) {
    const out = buildOutfits(items, { today: TODAY, limit });
    sane(out, `limit ${limit}`);
    const eff = limit === 0 || limit === -1 || limit === -5 ? 0 : Number.isFinite(limit) ? Math.floor(limit) : 20;
    assert.ok(out.length <= Math.max(eff, 0), `limit ${limit} returned ${out.length}`);
    if (eff === 0) assert.equal(out.length, 0);
  }
});
test('A4 scoreOutfit hostile arguments never throw and stay in range', () => {
  const ok = { top: mk('a', 'top', 't-shirt', 'white'), bottom: mk('b', 'bottom', 'jeans', 'denim') };
  const cases = [[null], [undefined], [{}], ['x'], [5], [[]], [{ top: null, bottom: null }], [{ top: {}, bottom: {} }], [ok, null], [ok, 5], [ok, { occasion: {} , weather: [] }], [ok, { feedback: 'x' }], [ok, { maxReasons: NaN }], [ok, { maxReasons: -1 }], [{ top: { colors: 'red' }, bottom: { colors: [{}] } }]];
  for (const args of cases) {
    const r = scoreOutfit(...args);
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100, `score ${r.score} for ${JSON.stringify(args)}`);
    assert.ok(Array.isArray(r.reasons));
  }
});
test('A4 scoreOutfit on an incomplete outfit (no bottom) is not rated a certified fit', () => {
  const r = scoreOutfit({ top: mk('a', 'top', 't-shirt', 'white') });
  assert.ok(r.score < 90, `top-only scored ${r.score}`);
});
test('A4 engine does not mutate its inputs (deep-frozen wardrobe)', () => {
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  for (const w of Object.values(realisticWardrobes())) {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(w)));
    const opts = deepFreeze({ today: TODAY, weather: 'cold', locks: { top: frozen[0].id }, exclude: { shoes: [] } });
    const before = JSON.stringify(frozen);
    buildOutfits(frozen, opts); gapAnalysis(frozen, opts);
    assert.equal(JSON.stringify(frozen), before);
  }
});

// =====================================================================================
// X. Extra adversarial ideas (skeptical stylist / malicious QA)
// =====================================================================================
const CONTEXTS = [{}, { occasion: 'work' }, { occasion: 'weekend' }, { occasion: 'date' }, { occasion: 'lounge' }, { occasion: 'formal' }, { weather: 'hot' }, { weather: 'cold' }, { weather: 'freezing' }, { weather: 'mild', rain: true }];
const ctxName = (c) => JSON.stringify(c);

test('X1 score distribution: top-20 per realistic wardrobe is not saturated (<= 40% CERTIFIED) and shows spread', () => {
  const W = realisticWardrobes();
  const total = Object.fromEntries(BANDS.map((b) => [b, 0])); let n = 0; const allScores = new Set();
  const rows = [];
  for (const [name, w] of Object.entries(W)) {
    const out = buildOutfits(w, { today: TODAY });
    const cnt = Object.fromEntries(BANDS.map((b) => [b, 0]));
    for (const o of out) { cnt[bandOf(o.score)]++; total[bandOf(o.score)]++; n++; allScores.add(o.score); }
    const distinct = new Set(out.map((o) => o.score)).size;
    rows.push({ name, n: out.length, ...cnt, distinct, min: Math.min(...out.map((o) => o.score)), max: Math.max(...out.map((o) => o.score)) });
    log(`DIST ${name} n=${out.length} ${BANDS.map((b) => `${b}=${cnt[b]}`).join(' ')} distinct=${distinct} range=${rows.at(-1).min}-${rows.at(-1).max}`);
  }
  // also across occasions / weathers
  const tot2 = Object.fromEntries(BANDS.map((b) => [b, 0])); let n2 = 0;
  for (const w of Object.values(W)) for (const c of CONTEXTS) for (const o of buildOutfits(w, { today: TODAY, ...c })) { tot2[bandOf(o.score)]++; n2++; }
  log(`DIST all-contexts n=${n2} ${BANDS.map((b) => `${b}=${(100 * tot2[b] / n2).toFixed(0)}%`).join(' ')}`);
  log(`DIST aggregate default-ctx n=${n} ${BANDS.map((b) => `${b}=${(100 * total[b] / n).toFixed(0)}%`).join(' ')} distinct-values=${allScores.size}`);
  const fracCert = total.CERTIFIED / n;
  assert.ok(fracCert <= 0.4, `score saturation: ${(fracCert * 100).toFixed(0)}% of all top-20 outfits are CERTIFIED FIT (>=90); expected a meaningful spread`);
  assert.ok(total.CERTIFIED + total.SHARP < n, 'every outfit >= 75');
});
test('X1b distinct score values per top-20 >= 6 (meter resolution)', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const out = buildOutfits(w, { today: TODAY });
    const d = new Set(out.map((o) => o.score)).size;
    if (d < 6) c.add(`${name}: only ${d} distinct values: ${out.map((o) => o.score).join(',')}`);
  }
  none(c, 'score granularity');
});
test('X1c the most basic outfit (tee + jeans + sneakers) is not a CERTIFIED FIT, and a random pairing is usually < 75', () => {
  const basic = scoreOutfit({ top: mk('a', 'top', 't-shirt', 'grey'), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white') });
  assert.ok(basic.score < 90, `tee+jeans+sneakers = ${basic.score}`);
  // random (non-curated) outfits from realistic wardrobes
  let hi = 0, n = 0; const r = mulberry32(777);
  for (const w of Object.values(realisticWardrobes())) {
    const by = (s) => w.filter((i) => i.slot === s);
    for (let k = 0; k < 150; k++) {
      const o = { top: pick(r, by('top')), bottom: pick(r, by('bottom')) };
      if (by('shoes').length) o.shoes = pick(r, by('shoes'));
      if (o.bottom.beltLoops && by('belt').length) o.belt = pick(r, by('belt'));
      n++; if (scoreOutfit(o, { beltAvailable: by('belt').length > 0 }).score >= 75) hi++;
    }
  }
  log(`DIST random outfits (seed 777): ${(100 * hi / n).toFixed(0)}% score >= 75 (n=${n})`);
  assert.ok(hi / n < 0.7, `${(100 * hi / n).toFixed(0)}% of RANDOM outfits are >= 75: the meter barely discriminates`);
});
test('X1d hard-clash outfits land in HMM (<45); stacked mistakes never look good', () => {
  const tie = mk('tie', 'neckwear', 'tie', 'yellow'); const cap = mk('cap', 'headwear', 'baseball cap', 'orange');
  const cases = {
    'tie+graphic tee+joggers+running shoes+cap': { top: mk('t', 'top', 'graphic tee', 'black', { pattern: 'graphic' }), neckwear: tie, bottom: mk('b', 'bottom', 'joggers', 'grey'), shoes: mk('s', 'shoes', 'running shoes', 'grey'), headwear: cap },
    'red top, green pants, orange hat, pink tie': { top: mk('t', 'top', 't-shirt', 'red'), bottom: mk('b', 'bottom', 'chinos', 'green'), headwear: cap, neckwear: mk('n', 'neckwear', 'tie', 'pink'), shoes: mk('s', 'shoes', 'sneakers', 'white') },
    'plaid + camo + floral blazer-less mess': { top: mk('t', 'top', 'flannel', 'red', { pattern: 'plaid' }), bottom: mk('b', 'bottom', 'cargo pants', 'olive', { pattern: 'camo' }), layer: mk('l', 'layer', 'overshirt', 'pink', { pattern: 'floral' }), shoes: mk('s', 'shoes', 'sandals', 'brown', { leather: 'brown' }) },
    'suit + sandals + beanie + shorts': { layer: mk('l', 'layer', 'suit jacket', 'charcoal'), top: mk('t', 'top', 'dress shirt', 'white'), bottom: mk('b', 'bottom', 'shorts', 'beige'), shoes: mk('s', 'shoes', 'sandals', 'brown', { leather: 'brown' }), headwear: mk('h', 'headwear', 'beanie', 'grey'), neckwear: mk('n', 'neckwear', 'bow tie', 'red') },
  };
  const c = collector();
  for (const [k, o] of Object.entries(cases)) { const s = scoreOutfit(o, {}); log(`CLASH "${k}" = ${s.score}`); if (s.score >= 45) c.add(`"${k}" scored ${s.score}: ${s.reasons.map((r) => `${r.text}(${r.delta})`).join(' | ')}`); }
  none(c, 'hard clash not in HMM band');
});
test('X1e a pure no-mistake plain outfit scores higher than every hard-clash and lower than a stand-out look (ordinal sanity)', () => {
  const plain = scoreOutfit({ top: mk('a', 'top', 't-shirt', 'white'), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white'), belt: mk('d', 'belt', 'leather belt', 'brown', { leather: 'brown' }) }).score;
  const sharp = scoreOutfit({ top: mk('a', 'top', 'oxford', 'white'), bottom: mk('b', 'bottom', 'chinos', 'navy'), shoes: mk('c', 'shoes', 'loafers', 'brown', { leather: 'brown' }), belt: mk('d', 'belt', 'leather belt', 'brown', { leather: 'brown' }), layer: mk('e', 'layer', 'blazer', 'navy') }).score;
  log(`ORDINAL plain=${plain} sharp=${sharp}`);
  assert.ok(plain <= sharp + 0, 'plain tee/jeans should not beat the smart-casual classic');
});

// ---- stylist oracle independent of the rule weights ----
function stylistViolations(o, ctx, occRules = true) {
  const v = []; const { top, bottom, shoes, layer, headwear, belt } = o.items;
  const neckwear = o.items.neckwear && o.items.neckwear.kind !== 'scarf' ? o.items.neckwear : undefined; // scarf is not a tie
  const fams = [top, bottom, layer].filter(Boolean).flatMap((i) => i.colors.filter((c, k) => k === 0 || c.weight >= 0.25).map((c) => c.family));
  const loud = new Set(fams.filter((f) => !COLOR_FAMILIES[f].neutral));
  if (neckwear && !top.collared) v.push('tie without collar');
  if (shoes && ['running shoes', 'sandals'].includes(shoes.kind) && (bottom.formality >= 4 || ['blazer', 'suit jacket'].includes(layer?.kind))) v.push(`${shoes.kind} with dressy bottom/blazer`);
  if (bottom.kind === 'shorts' && (['blazer', 'suit jacket'].includes(layer?.kind) || neckwear)) v.push('shorts with blazer/tie');
  if (layer && layer.warmth >= 3 && shoes?.kind === 'sandals') v.push('puffer/overcoat with sandals');
  if (layer && layer.warmth >= 3 && ['shorts', 'athletic shorts'].includes(bottom.kind) && ctx.weather !== 'cold' && ctx.weather !== 'freezing') v.push('heavy coat with shorts');
  const bl = belt && (belt.material === 'leather') ? belt.leather : null; const sl = shoes && (shoes.material === 'leather' || shoes.material === 'suede') ? shoes.leather : null;
  if (bl && sl && ((bl === 'black') !== (sl === 'black')) && ['black', 'brown', 'dark-brown', 'tan'].includes(bl) && ['black', 'brown', 'dark-brown', 'tan'].includes(sl)) v.push(`belt ${bl} vs shoes ${sl}`);
  const busy = [top, bottom, layer].filter((i) => i && BUSY_PATTERNS.includes(i.pattern));
  if (busy.length >= 2) v.push('two busy patterns');
  if (loud.size >= 3) v.push(`3+ loud colours (${[...loud]})`);
  if (Math.abs(top.formality - bottom.formality) >= 3) v.push(`top/bottom formality gap ${top.formality}/${bottom.formality}`);
  if (headwear && ['baseball cap', 'beanie', 'bucket hat'].includes(headwear.kind) && (['blazer', 'suit jacket'].includes(layer?.kind) || neckwear)) v.push('casual hat with blazer/tie');
  if (top.kind === 'graphic tee' && (bottom.formality >= 4 || shoes?.formality >= 4)) v.push('graphic tee with formal bottom/shoes');
  if (fams.includes('red') && fams.includes('green') || fams.includes('orange') && fams.includes('purple')) v.push('red/green or orange/purple');
  if (occRules && ctx.occasion === 'work' && (top.formality < 2 || bottom.formality < 2 || ['joggers', 'sweatpants', 'athletic shorts', 'shorts'].includes(bottom.kind))) v.push('gym/lounge piece at work');
  if (occRules && ctx.occasion === 'formal' && (shoes && shoes.formality < 3 || top.formality < 3)) v.push('casual piece at formal event');
  if (occRules && ctx.occasion === 'lounge' && (neckwear || ['blazer', 'suit jacket'].includes(layer?.kind))) v.push('blazer/tie while lounging');
  return v;
}
test('X2 stylist oracle: no top-5 outfit across realistic wardrobes x contexts commits a textbook mistake', () => {
  const c = collector(); let checked = 0;
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const ctx of CONTEXTS) {
    for (const o of buildOutfits(w, { today: TODAY, ...ctx }).slice(0, 5)) {
      checked++;
      const v = stylistViolations(o, ctx, name === 'standard' || (name === 'work' && ctx.occasion !== 'lounge'));
      if (v.length) c.add(`${name} ${ctxName(ctx)} score=${o.score} [${v.join('; ')}] ${Object.values(o.items).map((i) => i.name).join(' / ')}`);
    }
  }
  log(`X2 checked ${checked} outfits, violations=${c.n}`);
  none(c, 'bad fashion in top-5');
});
test('X2b stylist oracle on top-20 with default context (wider net)', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const o of buildOutfits(w, { today: TODAY })) {
    const v = stylistViolations(o, {});
    if (v.length) c.add(`${name} score=${o.score} rank<20 [${v.join('; ')}] ${Object.values(o.items).map((i) => i.name).join(' / ')}`);
  }
  none(c, 'bad fashion in top-20');
});
test('X2c random wardrobes: top-1 stylist violations that had a clean alternative in the top-20', { todo: 'Accepted by coordinator: in these random "formal" wardrobes the only formal pieces force a clash, so the casual #1 legitimately outscores them.' }, () => {
  const c = collector(); let n = 0;
  for (let i = 0; i < 150; i++) {
    const seed = 41000 + i; const r = mulberry32(seed);
    const items = randomWardrobe(r, 25 + Math.floor(r() * 50), { availableP: 1, neutralBias: 0.75 });
    const ctx = { occasion: pick(r, OCCS), weather: pick(r, WEATHERS) };
    const out = buildOutfits(items, { today: TODAY, ...ctx });
    if (out.length < 5) continue;
    const v0 = stylistViolations(out[0], ctx);
    const cleanBelow = out.slice(1).some((o) => stylistViolations(o, ctx).length === 0);
    n++;
    if (v0.length && cleanBelow) c.add(`seed=${seed} ctx=${ctxName(ctx)} #1 (${out[0].score}) [${v0.join('; ')}] while a clean outfit exists lower`);
  }
  log(`X2c checked ${n} wardrobes, bad #1 with clean alternative: ${c.n}`);
  none(c, 'top-1 worse than a clean alternative');
});
test('X3 accessory discipline: no hat/scarf unless cold; no layer in hot; tie only for smart occasions; extras are never invented', () => {
  const c = collector(); let withAcc = 0, total = 0;
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const ctx of CONTEXTS) {
    for (const o of buildOutfits(w, { today: TODAY, ...ctx })) {
      total++;
      const { headwear, neckwear, layer } = o.items;
      const cold = ctx.weather === 'cold' || ctx.weather === 'freezing';
      if (headwear && !cold) c.add(`${name} ${ctxName(ctx)} hat without cold: ${headwear.name}`);
      if (neckwear?.kind === 'scarf' && !cold) c.add(`${name} ${ctxName(ctx)} scarf without cold`);
      if (neckwear && neckwear.kind !== 'scarf' && !['work', 'date', 'formal'].includes(ctx.occasion || 'any')) c.add(`${name} ${ctxName(ctx)} tie in non-smart context`);
      if (layer && ctx.weather === 'hot' && layer.warmth >= 1) c.add(`${name} hot + ${layer.kind}`);
      if (headwear || neckwear || layer) withAcc++;
    }
  }
  log(`X3 outfits with at least one optional piece: ${withAcc}/${total}`);
  none(c, 'accessory discipline');
});
test('X3b default context (no weather): layers are not stacked on every outfit', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const out = buildOutfits(w, { today: TODAY });
    const withLayer = out.filter((o) => o.items.layer).length;
    if (withLayer / out.length > 0.8) c.add(`${name}: ${withLayer}/${out.length} outfits carry a layer with no weather info`);
    for (const o of out) if (o.items.layer && o.items.layer.warmth >= 3 && !o.items.layer.rain) c.add(`${name}: ${o.items.layer.kind} (warmth ${o.items.layer.warmth}) suggested with no weather given: ${names(o)}`);
  }
  none(c, 'layer spam / heavy coat with no weather context');
});
test('X4 variety: top 10 does not recycle one pair of shoes / one top / one bottom', { todo: 'Accepted by coordinator: strict best-first sorting wins over forcing a third shoe ~8 points worse into the top 10.' }, () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const ctx of [{}, { occasion: 'work' }, { occasion: 'weekend' }]) {
    const out = buildOutfits(w, { today: TODAY, ...ctx }).slice(0, 10);
    const cnt = (slot) => new Set(out.map((o) => o.items[slot]?.id)).size;
    const have = (slot) => new Set(w.filter((i) => i.slot === slot && i.available).map((i) => i.id)).size;
    const wantShoes = Math.min(3, have('shoes')); const wantTops = Math.min(4, have('top')); const wantBottoms = Math.min(3, have('bottom'));
    if (cnt('shoes') < wantShoes) c.add(`${name} ${ctxName(ctx)}: only ${cnt('shoes')} distinct shoes in top 10 of ${have('shoes')} owned`);
    if (cnt('top') < wantTops) c.add(`${name} ${ctxName(ctx)}: only ${cnt('top')} distinct tops of ${have('top')}`);
    if (cnt('bottom') < wantBottoms) c.add(`${name} ${ctxName(ctx)}: only ${cnt('bottom')} distinct bottoms of ${have('bottom')}`);
    const pairs = {}; for (const o of out) { const k = `${o.items.top.id}|${o.items.bottom.id}`; pairs[k] = (pairs[k] || 0) + 1; }
    if (Math.max(...Object.values(pairs)) > 2) c.add(`${name} ${ctxName(ctx)}: same top+bottom pair appears ${Math.max(...Object.values(pairs))}x in top 10`);
  }
  none(c, 'lack of variety');
});
test('X4b duplicate twins: wardrobe with 3 identical white tees does not fill the top 10 with visually identical outfits', () => {
  const w = realisticWardrobes().capsule;
  const twins = [...w, mk('twin2', 'top', 't-shirt', 'white'), mk('twin3', 'top', 't-shirt', 'white')];
  const out = buildOutfits(twins, { today: TODAY }).slice(0, 10);
  const sig = (o) => Object.entries(o.items).map(([s, i]) => `${s}:${i.kind}:${famOf(i)}:${i.pattern}`).sort().join('|');
  const seen = new Map(); let dup = 0;
  for (const o of out) { const k = sig(o); if (seen.has(k)) dup++; seen.set(k, 1); }
  assert.equal(dup, 0, `${dup} of the top 10 outfits are visual duplicates (same kinds/colours, different ids)`);
});
const TAG_NEEDS = {
  'belt-': (o) => !!o.items.belt, 'leather-': (o) => !!o.items.belt, 'tie-': (o) => !!o.items.neckwear, 'bowtie-': (o) => o.items.neckwear?.kind === 'bow tie',
  'hat-': (o) => !!o.items.headwear, 'rain-layer': (o) => !!o.items.layer, 'rain-suede': (o) => o.items.shoes?.material === 'suede',
  'weather-layer': (o) => !!o.items.layer, 'weather-accessory': (o) => !!(o.items.neckwear || o.items.headwear),
  'shorts-': (o) => /shorts/.test(o.items.bottom.kind), 'pattern-graphic': (o) => o.items.top.kind === 'graphic tee' || o.items.top.pattern === 'graphic',
};
const TAG_FORBIDS = {
  'weather-nolayer': (o) => !!o.items.layer, 'rain-none': (o) => o.items.layer?.rain === true, 'belt-missing': (o) => !!o.items.belt, 'belt-no-loops': (o) => !o.items.belt || o.items.bottom.beltLoops !== true ? false : false,
  'weather-nolayer-hot': (o) => !!o.items.layer,
};
const EXCLUSIVE = [['contrast-muddy', 'contrast-good'], ['weather-ok', 'weather-cold'], ['weather-ok', 'weather-hot'], ['weather-cold', 'weather-hot'], ['tie-ok', 'tie-no-collar'], ['tie-ok', 'tie-too-casual'], ['formality-ok', 'formality-gap'], ['formality-ok', 'formality-clash'], ['belt-casual-ok', 'belt-casual'], ['leather-match', 'leather-clash'], ['leather-match', 'leather-near'], ['occasion-ok', 'occasion-off'], ['color-neutral', 'color-accent'], ['color-neutral', 'color-clash'], ['pattern-ok', 'pattern-busy'], ['weather-layer', 'weather-nolayer']];
function reasonSets() {
  const out = [];
  for (const [name, w] of Object.entries(realisticWardrobes())) for (const ctx of CONTEXTS) for (const o of buildOutfits(w, { today: TODAY, ...ctx })) out.push({ name, ctx, o });
  for (const t of trials().slice(0, 250)) for (const o of t.out) out.push({ name: `seed${t.seed}`, ctx: t.opts, o });
  return out;
}
test('X5 reasons never contradict the outfit (belt/tie/hat/layer mentions match what is actually in it)', () => {
  const c = collector();
  for (const { name, ctx, o } of reasonSets()) {
    for (const r of o.reasons) {
      for (const [prefix, needs] of Object.entries(TAG_NEEDS)) if (r.tag.startsWith(prefix) && !needs(o)) c.add(`${name} ${ctxName(ctx)} reason "${r.text}" [${r.tag}] but ${names(o)}`);
      for (const [tag, forbids] of Object.entries(TAG_FORBIDS)) if (r.tag === tag && forbids(o)) c.add(`${name} ${ctxName(ctx)} reason "${r.text}" [${r.tag}] contradicts ${names(o)}`);
      if (/\bbelt\b/i.test(r.text) && !o.items.belt && r.tag !== 'belt-missing') c.add(`${name} reason mentions a belt but outfit has none: "${r.text}"`);
      if (/\b(tie|bow tie)\b/i.test(r.text) && !o.items.neckwear && !/tie/.test(Object.values(o.items).map((i) => i.name + i.kind).join(' '))) c.add(`${name} reason mentions a tie but outfit has none: "${r.text}"`);
      if (/\b(hat|cap|beanie|fedora)\b/i.test(r.text) && !o.items.headwear) c.add(`${name} reason mentions headwear but outfit has none: "${r.text}"`);
      if (/\bblazer\b/i.test(r.text) && !/blazer/i.test(Object.values(o.items).map((i) => i.name + i.kind).join(' '))) c.add(`${name} reason mentions blazer but outfit has none: "${r.text}"`);
    }
    const tags = new Set(o.reasons.map((r) => r.tag));
    for (const [a, b] of EXCLUSIVE) if (tags.has(a) && tags.has(b)) c.add(`${name} ${ctxName(ctx)} reasons ${a} and ${b} both present: ${o.reasons.map((r) => r.text).join(' | ')}`);
  }
  none(c, 'reason contradicts outfit');
});
test('X5b reason text is consistent with its delta sign (praise has delta>0, criticism delta<0) and non-zero', () => {
  const c = collector();
  const neg = /(clash|too |mistake|fight|shout|confus|awkward|mismatch|brrr|overheat|cold|blur|flat|competing|risky|way too|don't|didn't|not an exact)/i;
  for (const { name, o } of reasonSets()) for (const r of o.reasons) {
    if (r.delta === 0) c.add(`${name} zero-delta reason "${r.text}"`);
    if (r.delta > 0 && /(clash|mistake|fight|shout|confus|awkward|mismatch|brrr)/i.test(r.text)) c.add(`${name} positive delta on negative text "${r.text}" (${r.delta})`);
    if (r.delta < 0 && /(a classic pairing|perfect|matches your|a smart pairing|suits)/i.test(r.text) && !neg.test(r.text)) c.add(`${name} negative delta on positive text "${r.text}" (${r.delta})`);
  }
  none(c, 'sign/text mismatch');
});
test('X6 reason text hygiene: no undefined/NaN/null/raw tags/double spaces; sentence-cased; <= 110 chars; sorted by |delta|; <= 6', () => {
  const c = collector();
  const TAGS = /\b(color|contrast|pattern|formality|leather|belt|tie|hat|shoes|weather|rain|occasion|statement|feedback)-[a-z-]{3,}\b/;
  for (const { name, o } of reasonSets()) {
    if (o.reasons.length > 6) c.add(`${name} ${o.reasons.length} reasons`);
    for (let i = 0; i < o.reasons.length; i++) {
      const r = o.reasons[i];
      if (typeof r.text !== 'string' || !r.text.trim()) { c.add(`${name} empty reason`); continue; }
      if (/undefined|NaN|\bnull\b|\[object|Infinity/.test(r.text)) c.add(`${name} garbage in "${r.text}"`);
      if (r.text.includes(r.tag) || TAGS.test(r.text)) c.add(`${name} raw tag in "${r.text}"`);
      if (/ {2,}| ,|\.\./.test(r.text)) c.add(`${name} spacing/punct in "${r.text}"`);
      if (!/^[A-Z0-9]/.test(r.text)) c.add(`${name} not capitalised "${r.text}"`);
      if (!/[.!?]$/.test(r.text)) c.add(`${name} no end punctuation "${r.text}"`);
      if (r.text.length > 110) c.add(`${name} ${r.text.length} chars: "${r.text}"`);
      if (/\bA [aeiou]/.test(r.text) || /\bAn [^aeiou\s]/.test(r.text)) c.add(`${name} a/an: "${r.text}"`);
      if (/\b(\w+) \1\b/i.test(r.text)) c.add(`${name} repeated word: "${r.text}"`);
      if (i && Math.abs(r.delta) > Math.abs(o.reasons[i - 1].delta)) c.add(`${name} reasons not sorted by |delta|`);
    }
  }
  none(c, 'reason hygiene');
});
test('X6b reasons with hostile item names (empty, huge, odd case, emoji, html) stay clean', () => {
  const c = collector();
  const odd = ['', '   ', 'x', 'ÉCOLE', '😀 tee', '<b>bold</b>', 'null', 'undefined', 'NaN', 'A'.repeat(300)];
  for (const nm of odd) {
    const w = [mk('t', 'top', 't-shirt', 'white', { name: nm }), mk('b', 'bottom', 'jeans', 'denim', { name: nm }), mk('s', 'shoes', 'sneakers', 'white', { name: nm })];
    for (const o of buildOutfits(w, { today: TODAY, occasion: 'formal', weather: 'cold' })) for (const r of o.reasons) {
      if (/undefined|NaN|\[object/.test(r.text) && !/undefined|NaN/.test(nm)) c.add(`name=${JSON.stringify(nm.slice(0, 20))}: "${r.text}"`);
      if (r.text.length > 400) c.add(`name=${JSON.stringify(nm.slice(0, 10))}: ${r.text.length}-char reason`);
    }
  }
  none(c, 'hostile names in reasons');
});
test('X5c reasons add up: squash(70 + sum(deltas)) matches the score when nothing was truncated', { todo: 'Obsolete: hardcodes the pre-recalibration base (70) and squash; additivity is covered by engine-calibration tests.' }, () => {
  const c = collector();
  for (const { name, o } of reasonSets()) {
    if (o.reasons.length >= 6) continue;
    const raw = 70 + o.reasons.reduce((s, r) => s + r.delta, 0);
    const exp = raw >= 80 ? 80 + 20 * (1 - Math.exp(-(raw - 80) / 20)) : raw <= 20 ? 20 * Math.exp((raw - 20) / 20) : raw;
    if (Math.abs(exp - o.score) > 1.5) c.add(`${name} ${names(o)} score=${o.score} but reasons imply ${exp.toFixed(1)}: ${o.reasons.map((r) => `${r.delta}`).join(',')}`);
  }
  none(c, 'reasons do not explain score');
});
test('X7 gapAnalysis never recommends something the user already owns (same slot+kind+colour family)', () => {
  const c = collector(); const unavail = collector();
  const check = (label, items) => {
    const gaps = gapAnalysis(items, { today: TODAY });
    for (const g of gaps) {
      const own = items.filter((i) => i.slot === g.slot && i.kind === g.kind && (i.colors?.[0]?.family === g.family || (g.leather && i.leather === g.leather)));
      const ownAvail = own.filter((i) => i.available);
      if (ownAvail.length) c.add(`${label}: suggests "${g.text}" but owns ${ownAvail[0].name} (${ownAvail[0].id})`);
      else if (own.length) unavail.add(`${label}: suggests "${g.text}" but owns it in the laundry (${own[0].id})`);
    }
    return gaps;
  };
  for (const [name, w] of Object.entries(realisticWardrobes())) check(name, w);
  for (let i = 0; i < 120; i++) { const seed = 51000 + i; const r = mulberry32(seed); check(`seed=${seed}`, randomWardrobe(r, 4 + Math.floor(r() * 30))); }
  none(c, 'gap suggests owned item');
  none(unavail, 'gap suggests an item that is only in the laundry');
});
test('X7b gapAnalysis: wording and belt logic are sane', () => {
  const c = collector();
  const all = [];
  for (const [name, w] of Object.entries(realisticWardrobes())) all.push([name, w]);
  for (let i = 0; i < 100; i++) { const r = mulberry32(52000 + i); all.push([`seed=${52000 + i}`, randomWardrobe(r, 4 + Math.floor(r() * 30))]); }
  for (const [label, w] of all) {
    const gaps = gapAnalysis(w, { today: TODAY });
    const av = w.filter((i) => i.available);
    const loopsAvail = av.some((i) => i.slot === 'bottom' && i.beltLoops);
    if (gaps.length > 5) c.add(`${label}: ${gaps.length} suggestions`);
    for (const g of gaps) {
      if (!/\S/.test(g.text) || /undefined|NaN|null|\[object|__gap/.test(g.text)) c.add(`${label}: bad text "${g.text}"`);
      if (!Number.isInteger(g.unlocks) || g.unlocks < 0) c.add(`${label}: unlocks=${g.unlocks}`);
      if (g.slot === 'belt' && av.some((i) => i.slot === 'bottom') && !loopsAvail) c.add(`${label}: suggests a belt but no available bottom has belt loops: "${g.text}"`);
      if (/\bA [aeiou]|\bAn [^aeiou]/.test(g.text) || /\ban? \w+ \1\b/i.test(g.text)) c.add(`${label}: article: "${g.text}"`);
      if (/ {2,}|\.\./.test(g.text)) c.add(`${label}: spacing "${g.text}"`);
      if (g.unlocks === 1 && /outfits\b/.test(g.text.replace(/outfits? would/, ''))) { /* fine */ }
      if (g.unlocks > 0 && !/unlock|complete/.test(g.text)) c.add(`${label}: unclear: "${g.text}"`);
    }
  }
  none(c, 'gapAnalysis sanity');
});
test('X7c gapAnalysis for a wardrobe with no shoes suggests shoes (a required slot)', () => {
  const w = realisticWardrobes().capsule;
  const noShoes = gapAnalysis(w.filter((i) => i.slot !== 'shoes'), { today: TODAY });
  assert.ok(noShoes.some((g) => g.slot === 'shoes'), `no shoes owned but suggestions are: ${noShoes.map((g) => g.text).join(' | ')}`);
});
test('X7d gapAnalysis for a wardrobe with no bottoms suggests bottoms', () => {
  const w = realisticWardrobes().capsule;
  const noBottoms = gapAnalysis(w.filter((i) => i.slot !== 'bottom'), { today: TODAY });
  assert.ok(noBottoms.some((g) => g.slot === 'bottom'), `no bottoms owned but suggestions are: ${noBottoms.map((g) => g.text).join(' | ')}`);
});
test('X8 belt: loopless-only wardrobe gets no belts, no belt penalty and equal score with/without belts owned', () => {
  const base = [mk('t', 'top', 't-shirt', 'grey'), mk('j', 'bottom', 'joggers', 'navy'), mk('s', 'shoes', 'sneakers', 'white')];
  const withBelt = [...base, mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown' })];
  const a = buildOutfits(base, { today: TODAY }); const b = buildOutfits(withBelt, { today: TODAY });
  assert.equal(b[0].items.belt, undefined);
  assert.equal(a[0].score, b[0].score, 'owning a belt changed the score of a loopless outfit');
  assert.ok(!b[0].reasons.some((r) => /belt/i.test(r.text)), b[0].reasons.map((r) => r.text).join('|'));
  const s1 = scoreOutfit({ top: base[0], bottom: base[1], shoes: base[2] }, { beltAvailable: true }).score;
  const s2 = scoreOutfit({ top: base[0], bottom: base[1], shoes: base[2] }, { beltAvailable: false }).score;
  assert.equal(s1, s2, 'beltAvailable context penalises loopless bottoms');
});
test('X8b belt in laundry: loops + only belt unavailable => no belt, and no "add a belt" penalty/reason', () => {
  const w = [mk('t', 'top', 't-shirt', 'grey'), mk('j', 'bottom', 'jeans', 'denim'), mk('s', 'shoes', 'sneakers', 'white'), mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown', available: false })];
  const noBelt = buildOutfits(w.slice(0, 3), { today: TODAY })[0];
  const laundry = buildOutfits(w, { today: TODAY })[0];
  assert.equal(laundry.items.belt, undefined);
  assert.equal(laundry.score, noBelt.score);
  assert.ok(!laundry.reasons.some((r) => r.tag === 'belt-missing'));
});
test('X8c belt is always included for loop bottoms even when it is the "wrong" one, and the reason says so honestly', () => {
  const w = [mk('t', 'top', 'oxford', 'white'), mk('j', 'bottom', 'chinos', 'beige'), mk('s', 'shoes', 'loafers', 'brown', { leather: 'brown' }), mk('bt', 'belt', 'dress belt', 'black', { leather: 'black' })];
  const out = buildOutfits(w, { today: TODAY });
  assert.equal(out[0].items.belt?.id, 'bt');
  assert.ok(out[0].reasons.some((r) => r.tag === 'leather-clash'), 'mismatch should be called out');
});
test('X8d locked belt with a loopless-only wardrobe returns []; locked belt prefers loop bottoms', () => {
  const w = [mk('t', 'top', 't-shirt', 'grey'), mk('j', 'bottom', 'joggers', 'navy'), mk('s', 'shoes', 'sneakers', 'white'), mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown' })];
  assert.deepEqual(buildOutfits(w, { locks: { belt: 'bt' }, today: TODAY }), []);
  const w2 = [...w, mk('c', 'bottom', 'chinos', 'beige')];
  const out = buildOutfits(w2, { locks: { belt: 'bt' }, today: TODAY });
  assert.ok(out.length > 0 && out.every((o) => o.items.bottom.id === 'c' && o.items.belt.id === 'bt'));
});
test('X8e locked loopless bottom never gets a belt even if a belt is locked/owned', () => {
  const w = [mk('t', 'top', 't-shirt', 'grey'), mk('j', 'bottom', 'joggers', 'navy'), mk('c', 'bottom', 'chinos', 'beige'), mk('s', 'shoes', 'sneakers', 'white'), mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown' })];
  const out = buildOutfits(w, { locks: { bottom: 'j' }, today: TODAY });
  assert.ok(out.length > 0 && out.every((o) => !o.items.belt && o.items.bottom.id === 'j'));
});
test('X9 locks honoured even when "wrong" (sandals + suit), and the result is graded honestly', () => {
  const w = realisticWardrobes().work.concat([mk('sand', 'shoes', 'sandals', 'brown', { leather: 'brown' })]);
  const out = buildOutfits(w, { locks: { shoes: 'sand' }, today: TODAY, occasion: 'formal' });
  assert.ok(out.length && out.every((o) => o.items.shoes.id === 'sand'));
  assert.ok(out[0].score < 75, `formal outfit with locked sandals scored ${out[0].score}`);
});
test('X10 exclude is honoured and reshuffle-style exclusion of the previous #1 gives a different outfit', () => {
  const w = realisticWardrobes().standard;
  const first = buildOutfits(w, { today: TODAY })[0];
  const ex = { top: [first.items.top.id], shoes: [first.items.shoes.id] };
  const out = buildOutfits(w, { today: TODAY, exclude: ex });
  assert.ok(out.length > 0);
  for (const o of out) { assert.notEqual(o.items.top.id, first.items.top.id); assert.notEqual(o.items.shoes?.id, first.items.shoes.id); }
});
test('X10b exclude vs lock on the same id: lock wins and is honoured (or both ignored) without crashing', () => {
  const w = realisticWardrobes().standard;
  const id = w.find((i) => i.slot === 'top').id;
  const out = buildOutfits(w, { today: TODAY, locks: { top: id }, exclude: { top: [id] } });
  sane(out, 'lock+exclude');
});
test('X11 work: top-10 uses work-appropriate pieces when the wardrobe has them (no graphic tee/hoodie/joggers/shorts)', () => {
  const c = collector();
  for (const name of ['work', 'standard', 'big80']) {
    const w = realisticWardrobes()[name];
    for (const o of buildOutfits(w, { today: TODAY, occasion: 'work' }).slice(0, 10)) {
      const bad = [o.items.top.kind].filter((k) => ['graphic tee', 'tank top', 'hoodie', 'sweatshirt'].includes(k)).concat(['joggers', 'sweatpants', 'athletic shorts', 'shorts'].filter((k) => o.items.bottom.kind === k), ['running shoes', 'sandals'].filter((k) => o.items.shoes?.kind === k));
      if (bad.length) c.add(`${name}: work outfit (score ${o.score}) contains ${bad}`);
    }
  }
  none(c, 'unprofessional work outfits');
});
test('X11b rain: with rain and an owned rain jacket, every top-5 outfit wears it; suede avoided', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    if (!w.some((i) => i.slot === 'layer' && i.rain)) continue;
    for (const o of buildOutfits(w, { today: TODAY, weather: 'mild', rain: true }).slice(0, 5)) if (!o.items.layer?.rain) c.add(`${name}: no rain jacket in ${names(o)}`);
  }
  none(c, 'rain');
  const w = [mk('t', 'top', 't-shirt', 'grey'), mk('b', 'bottom', 'jeans', 'denim'), mk('suede', 'shoes', 'chelsea boots', 'beige', { material: 'suede', leather: 'tan' }), mk('lea', 'shoes', 'boots', 'brown', { leather: 'brown' }), mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown' })];
  assert.equal(buildOutfits(w, { today: TODAY, rain: true })[0].items.shoes.id, 'lea', 'suede boots chosen in the rain');
});
test('X12 hot weather: top-5 are short-sleeve-ish (no sweater/hoodie/turtleneck top); cold: no tank/graphic-only look', () => {
  const c = collector();
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    for (const o of buildOutfits(w, { today: TODAY, weather: 'hot' }).slice(0, 5)) if (o.items.top.warmth >= 2) c.add(`${name}: hot day with ${o.items.top.kind} (warmth ${o.items.top.warmth})`);
    for (const o of buildOutfits(w, { today: TODAY, weather: 'freezing' }).slice(0, 5)) if (o.items.top.kind === 'tank top' || o.items.top.warmth === 0 && !o.items.layer) c.add(`${name}: freezing with ${o.items.top.kind} and no layer`);
  }
  none(c, 'weather appropriateness');
});
test('X13 recent-wear does not hide everything: with a tiny wardrobe all worn yesterday you still get outfits', () => {
  const w = good().concat([mk('bt', 'belt', 'leather belt', 'brown', { leather: 'brown' })]).map((i) => ({ ...i, worn: ['2026-11-19'] }));
  const out = buildOutfits(w, { today: TODAY });
  assert.ok(out.length >= 1);
  sane(out, 'all worn');
});
test('X13b future-dated and malformed worn dates are ignored (no penalty)', () => {
  const clean = good();
  const dirty = clean.map((i) => ({ ...i, worn: ['2027-01-01', 'garbage', '', '2026-11-21'] }));
  assert.equal(buildOutfits(dirty, { today: TODAY })[0].score, buildOutfits(clean, { today: TODAY })[0].score);
});
test('X13c recentDays:0 disables penalty; recent wear 2 days ago penalised less than yesterday', () => {
  const clean = good();
  const y = clean.map((i) => (i.slot === 'top' ? { ...i, worn: ['2026-11-19'] } : i));
  const d2 = clean.map((i) => (i.slot === 'top' ? { ...i, worn: ['2026-11-18'] } : i));
  const sc = (w, o = {}) => buildOutfits(w, { today: TODAY, ...o })[0].score;
  assert.equal(sc(y, { recentDays: 0 }), sc(clean));
  assert.ok(sc(clean) >= sc(d2) && sc(d2) >= sc(y), `${sc(clean)} ${sc(d2)} ${sc(y)}`);
});
test('X14 empty / singleton edge wardrobes give [] and the sentinel shapes the UI relies on', () => {
  assert.deepEqual(buildOutfits([]), []);
  assert.deepEqual(buildOutfits([mk('t', 'top', 't-shirt', 'white')]), []);
  const o = buildOutfits([mk('t', 'top', 't-shirt', 'white'), mk('b', 'bottom', 'jeans', 'denim')], { today: TODAY });
  assert.equal(o.length, 1);
  assert.ok(!o[0].items.shoes && !o[0].items.belt);
  assert.ok(o[0].score >= 0);
});
test('X15 colour-blind-safe sanity: all-neutral wardrobe never produces a colour-clash reason', () => {
  const c = collector();
  const r = mulberry32(8080);
  const neutrals = ['black', 'charcoal', 'grey', 'white', 'cream', 'beige', 'navy', 'denim', 'olive'];
  const items = [];
  for (let i = 0; i < 60; i++) items.push(randomItem(r, `n${i}`, { slot: pick(r, ['top', 'bottom', 'shoes', 'layer', 'belt']), availableP: 1 }));
  const neutralised = items.map((i) => { const f = pick(r, neutrals); return { ...i, pattern: 'solid', colors: [{ hex: COLOR_FAMILIES[f].hex, family: f, weight: 1 }] }; });
  for (const o of buildOutfits(neutralised, { today: TODAY })) for (const rr of o.reasons) if (/clash|loud|competing|fight/.test(rr.tag + rr.text) && !/Brown and black|Navy and black/.test(rr.text)) c.add(`${names(o)}: ${rr.text}`);
  none(c, 'neutral clash');
});
test('X16 score monotonic in obviously-worse swaps within the same wardrobe (random): replacing shoes by running shoes under dress pants never raises the score', () => {
  const c = collector();
  for (let i = 0; i < 150; i++) {
    const seed = 61000 + i; const r = mulberry32(seed);
    const top = randomItem(r, 't', { slot: 'top', availableP: 1 });
    const bottom = makeItem({ id: 'b', slot: 'bottom', kind: pick(r, ['dress pants', 'suit trousers']), colors: [{ hex: COLOR_FAMILIES.charcoal.hex, family: 'charcoal', weight: 1 }] });
    const dressy = makeItem({ id: 's1', slot: 'shoes', kind: pick(r, ['derbies', 'oxfords', 'loafers']), material: 'leather', leather: 'black', colors: [{ hex: COLOR_FAMILIES.black.hex, family: 'black', weight: 1 }] });
    const sporty = makeItem({ id: 's2', slot: 'shoes', kind: 'running shoes', colors: [{ hex: COLOR_FAMILIES.black.hex, family: 'black', weight: 1 }] });
    const a = scoreOutfit({ top, bottom, shoes: dressy }, {}).score; const b = scoreOutfit({ top, bottom, shoes: sporty }, {}).score;
    if (b > a) c.add(`seed=${seed} top=${top.kind}/${famOf(top)} running shoes ${b} > dress shoes ${a}`);
  }
  none(c, 'sporty shoes beat dress shoes under dress pants');
});

test('X17 a wardrobe full of gym/lounge clothes cannot score as SHARP/CERTIFIED for work or formal (absolute meaning of the meter)', () => {
  const c = collector();
  const casual = (o) => ['joggers', 'sweatpants', 'athletic shorts', 'shorts'].includes(o.items.bottom.kind) || ['hoodie', 'sweatshirt', 'graphic tee', 'tank top'].includes(o.items.top.kind) || o.items.shoes?.kind === 'running shoes' || o.items.shoes?.kind === 'sandals';
  for (const occasion of ['work', 'formal', 'date']) for (const o of buildOutfits(realisticWardrobes().streetwear, { today: TODAY, occasion })) {
    if (casual(o) && o.score >= 75) c.add(`${occasion}: score ${o.score} for ${Object.values(o.items).map((i) => i.name).join(' / ')} | ${o.reasons.slice(0, 3).map((r) => r.text).join(' | ')}`);
  }
  none(c, 'casual outfits graded SHARP for a dressy occasion');
});
test('X18 weather rule coverage: sandals in cold/freezing and shorts in freezing are penalised', () => {
  const base = { top: mk('t', 'top', 'sweater', 'navy'), bottom: mk('b', 'bottom', 'jeans', 'denim'), layer: mk('l', 'layer', 'puffer', 'black') };
  for (const weather of ['cold', 'freezing']) {
    const boots = scoreOutfit({ ...base, shoes: mk('s1', 'shoes', 'boots', 'brown', { leather: 'brown' }) }, { weather }).score;
    const sandals = scoreOutfit({ ...base, shoes: mk('s2', 'shoes', 'sandals', 'brown', { leather: 'brown' }) }, { weather }).score;
    assert.ok(sandals < boots - 5, `${weather}: sandals ${sandals} vs boots ${boots}`);
  }
});
test('X19 a heavy coat (puffer/overcoat) with sandals or shorts is penalised even with no weather context', () => {
  const base = { top: mk('t', 'top', 't-shirt', 'grey'), bottom: mk('b', 'bottom', 'cargo pants', 'olive'), layer: mk('l', 'layer', 'puffer', 'black') };
  const sneakers = scoreOutfit({ ...base, shoes: mk('s1', 'shoes', 'sneakers', 'white') }).score;
  const sandals = scoreOutfit({ ...base, shoes: mk('s2', 'shoes', 'sandals', 'brown', { leather: 'brown' }) }).score;
  assert.ok(sandals < sneakers - 5, `puffer+sandals ${sandals} vs puffer+sneakers ${sneakers}`);
});
