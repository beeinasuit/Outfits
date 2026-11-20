import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutfits } from '../../src/engine/build.js';
import { scoreOutfit } from '../../src/engine/score.js';
import { makeItem, COLOR_FAMILIES, SLOTS } from '../../src/model.js';
import { wardrobe, mk, W } from './fixtures/wardrobe.js';

const TODAY = '2026-11-20';
const ids = (o) => Object.values(o.items).map((i) => i.id);

test('outfits are well-formed, unique, best first, within limit', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, diversity: false, limit: 15 });
  assert.equal(out.length, 15);
  assert.equal(new Set(out.map((o) => o.key)).size, out.length);
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    assert.ok(o.items.top && o.items.bottom);
    assert.ok(Number.isInteger(o.score) && o.score >= 0 && o.score <= 100);
    assert.ok(o.reasons.length > 0 && o.reasons.length <= 6);
    assert.equal(o.key, Object.values(o.items).map((x) => x.id).sort().join('|'));
    for (const [slot, it] of Object.entries(o.items)) assert.equal(it.slot, slot);
    if (i) assert.ok(out[i - 1].score >= o.score);
  }
});

test('reported score equals scoreOutfit when nothing was recently worn', () => {
  const [o] = buildOutfits(wardrobe(), { today: TODAY });
  assert.equal(o.score, scoreOutfit(o.items, { beltAvailable: true }).score);
});

test('a belt is ALWAYS present with belt-loop bottoms when a belt is owned, never with joggers/shorts without loops', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, limit: 200, diversity: false });
  assert.ok(out.length > 30);
  let loops = 0; let loopless = 0;
  for (const o of out) {
    if (o.items.bottom.beltLoops) { loops++; assert.ok(o.items.belt, `no belt for ${ids(o)}`); } else { loopless++; assert.equal(o.items.belt, undefined); }
  }
  assert.ok(loops > 0);
  const joggers = buildOutfits(wardrobe(), { today: TODAY, locks: { bottom: 'gray-joggers' }, limit: 10 });
  assert.ok(joggers.length > 3 && loopless >= 0);
  for (const o of joggers) assert.equal(o.items.belt, undefined);
});

test('belt matches shoe leather when it can', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, locks: { shoes: 'brown-boots', bottom: 'dark-jeans' }, limit: 5 });
  for (const o of out) assert.equal(o.items.belt.id, 'brown-belt');
  const out2 = buildOutfits(wardrobe(), { today: TODAY, locks: { shoes: 'black-oxfords', bottom: 'gray-dress-pants' }, limit: 5 });
  for (const o of out2) assert.equal(o.items.belt.id, 'black-belt');
});

test('no belts owned: outfits are built without one and are not penalized', () => {
  const items = wardrobe().filter((i) => i.slot !== 'belt');
  const out = buildOutfits(items, { today: TODAY, limit: 20 });
  assert.ok(out.length);
  for (const o of out) {
    assert.equal(o.items.belt, undefined);
    assert.ok(!o.reasons.some((r) => r.tag === 'belt-missing'));
  }
  const withBelt = buildOutfits(wardrobe(), { today: TODAY, limit: 1 })[0];
  assert.ok(out[0].score >= withBelt.score - 8);
});

test('locked belt only considers bottoms with loops', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, locks: { belt: 'black-belt' }, limit: 30 });
  assert.ok(out.length);
  for (const o of out) { assert.equal(o.items.belt.id, 'black-belt'); assert.equal(o.items.bottom.beltLoops, true); }
  assert.deepEqual(buildOutfits(wardrobe(), { today: TODAY, locks: { belt: 'black-belt', bottom: 'gray-joggers' } }), []);
});

test('locks are honored, even for slots outside the search', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, locks: { top: 'gray-hoodie', layer: 'navy-blazer', headwear: 'navy-cap', neckwear: 'gray-scarf' }, limit: 10 });
  assert.ok(out.length);
  for (const o of out) {
    assert.equal(o.items.top.id, 'gray-hoodie');
    assert.equal(o.items.layer.id, 'navy-blazer');
    assert.equal(o.items.headwear.id, 'navy-cap');
    assert.equal(o.items.neckwear.id, 'gray-scarf');
  }
});

test('locks that point at unknown, unavailable or wrong-slot ids are ignored', () => {
  const items = wardrobe();
  items.find((i) => i.id === 'white-oxford').available = false;
  const base = buildOutfits(items, { today: TODAY });
  const a = buildOutfits(items, { today: TODAY, locks: { top: 'nope', bottom: 'white-oxford', shoes: 'brown-belt' } });
  assert.deepEqual(a.map((o) => o.key), base.map((o) => o.key));
  assert.ok(a.length > 0);
});

test('unavailable items are never returned, even when locked', () => {
  const items = wardrobe();
  for (const id of ['brown-boots', 'brown-belt', 'navy-blazer', 'dark-jeans']) items.find((i) => i.id === id).available = false;
  const out = buildOutfits(items, { today: TODAY, limit: 100, locks: { shoes: 'brown-boots' } });
  assert.ok(out.length);
  for (const o of out) for (const it of Object.values(o.items)) assert.notEqual(it.available, false);
  for (const o of out) assert.ok(!ids(o).some((i) => ['brown-boots', 'brown-belt', 'navy-blazer', 'dark-jeans'].includes(i)));
});

test('exclude removes items (reshuffle)', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, limit: 50, exclude: { top: ['white-oxford', 'white-tee'], shoes: ['white-sneakers'] } });
  for (const o of out) { assert.ok(!['white-oxford', 'white-tee'].includes(o.items.top.id)); assert.notEqual(o.items.shoes?.id, 'white-sneakers'); }
});

test('empty, tops-only, bottoms-only and all-unavailable wardrobes return []', () => {
  assert.deepEqual(buildOutfits([], {}), []);
  assert.deepEqual(buildOutfits(undefined), []);
  assert.deepEqual(buildOutfits(wardrobe().filter((i) => i.slot === 'top')), []);
  assert.deepEqual(buildOutfits(wardrobe().filter((i) => i.slot === 'bottom')), []);
  assert.deepEqual(buildOutfits(wardrobe().map((i) => ({ ...i, available: false }))), []);
  assert.deepEqual(buildOutfits([null, undefined, {}, { id: 'x', slot: 'nope' }]), []);
});

test('one top and one bottom: a single outfit, no shoes needed', () => {
  const out = buildOutfits([W['gray-tee'], W['gray-joggers']], { today: TODAY });
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0].items).sort(), ['bottom', 'top']);
  const loops = buildOutfits([W['gray-tee'], W['dark-jeans'], W['brown-belt']], { today: TODAY });
  assert.equal(loops.length, 1);
  assert.equal(loops[0].items.belt.id, 'brown-belt');
});

test('duplicate ids do not produce duplicate outfits', () => {
  const items = [...wardrobe(), ...wardrobe()];
  const out = buildOutfits(items, { today: TODAY, limit: 50, diversity: false });
  assert.equal(new Set(out.map((o) => o.key)).size, out.length);
});

test('recently worn items are penalized', () => {
  const items = wardrobe();
  const [fresh] = buildOutfits(items, { today: TODAY, limit: 1, diversity: false });
  const worn = items.map((i) => (ids(fresh).includes(i.id) && ['top', 'bottom', 'shoes', 'layer'].includes(i.slot) ? { ...i, worn: ['2026-11-19'] } : i));
  const again = buildOutfits(worn, { today: TODAY, limit: 30, diversity: false });
  const same = again.find((o) => o.key === fresh.key);
  assert.ok(!same || same.score < fresh.score);
  assert.notEqual(again[0].key, fresh.key);
  const noPenalty = buildOutfits(worn, { today: TODAY, limit: 1, recentDays: 0, diversity: false });
  assert.equal(noPenalty[0].key, fresh.key);
  const old = items.map((i) => ({ ...i, worn: ['2026-11-01'] }));
  assert.equal(buildOutfits(old, { today: TODAY, limit: 1, diversity: false })[0].key, fresh.key);
  const penalized = again.find((o) => o.reasons.some((r) => r.tag === 'recently-worn'));
  assert.ok(penalized || again.length);
});

test('diversity: top 10 never repeat a top+bottom pair more than twice, and items stay spread', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY, limit: 20 });
  const top10 = out.slice(0, 10);
  const pairs = new Map();
  const counts = new Map();
  for (const o of top10) {
    const k = `${o.items.top.id}|${o.items.bottom.id}`;
    pairs.set(k, (pairs.get(k) || 0) + 1);
    for (const s of ['top', 'bottom']) counts.set(o.items[s].id, (counts.get(o.items[s].id) || 0) + 1);
  }
  assert.ok(Math.max(...pairs.values()) <= 2);
  assert.ok(Math.max(...counts.values()) <= 3);
  assert.ok(new Set(top10.map((o) => o.items.top.id)).size >= 4);
  const plain = buildOutfits(wardrobe(), { today: TODAY, limit: 10, diversity: false });
  assert.ok(new Set(plain.map((o) => o.items.top.id)).size <= new Set(top10.map((o) => o.items.top.id)).size);
});

test('diversity does not hide outfits when the wardrobe is tiny', () => {
  const items = [W['gray-tee'], W['dark-jeans'], W['white-sneakers'], W['brown-boots'], W['black-oxfords'], W['brown-belt']];
  assert.ok(buildOutfits(items, { today: TODAY, limit: 3 }).length >= 3);
});

test('occasion and weather steer the results', () => {
  const work = buildOutfits(wardrobe(), { today: TODAY, occasion: 'work', limit: 5 });
  for (const o of work) assert.ok(o.items.top.formality >= 3 && o.items.bottom.formality >= 3, ids(o).join());
  const freezing = buildOutfits(wardrobe(), { today: TODAY, weather: 'freezing', limit: 8 });
  for (const o of freezing) assert.ok(o.items.layer, `layer for ${ids(o)}`);
  const hot = buildOutfits(wardrobe(), { today: TODAY, weather: 'hot', limit: 8 });
  for (const o of hot) assert.ok(!o.items.layer && !o.items.headwear);
  const rain = buildOutfits(wardrobe(), { today: TODAY, rain: true, limit: 5 });
  assert.ok(rain.slice(0, 3).every((o) => o.items.layer?.rain === true));
});

test('neckwear is only suggested with a collared top at smart occasions', () => {
  const casual = buildOutfits(wardrobe(), { today: TODAY, limit: 40, diversity: false });
  assert.ok(casual.every((o) => !o.items.neckwear));
  const formal = buildOutfits(wardrobe(), { today: TODAY, occasion: 'formal', limit: 40, diversity: false });
  for (const o of formal) if (o.items.neckwear) assert.equal(o.items.top.collared, true);
});

test('feedback: a liked outfit rises, a disliked one disappears from the top', () => {
  const base = buildOutfits(wardrobe(), { today: TODAY, limit: 20 });
  const target = base[10];
  const liked = buildOutfits(wardrobe(), { today: TODAY, limit: 20, feedback: { liked: new Set([target.key]), disliked: new Set() } });
  assert.ok(liked.findIndex((o) => o.key === target.key) < 10);
  const disliked = buildOutfits(wardrobe(), { today: TODAY, limit: 20, feedback: { liked: new Set(), disliked: new Set([base[0].key]) } });
  assert.notEqual(disliked[0].key, base[0].key);
});

test('deterministic and independent of input order', () => {
  const a = buildOutfits(wardrobe(), { today: TODAY });
  const b = buildOutfits(wardrobe().reverse(), { today: TODAY });
  assert.deepEqual(a.map((o) => o.key), b.map((o) => o.key));
  assert.deepEqual(a.map((o) => o.score), b.map((o) => o.score));
});

test('garbage options do not crash', () => {
  assert.ok(Array.isArray(buildOutfits(wardrobe(), { limit: -5, locks: null, exclude: 7, weather: 'x', occasion: 'y', today: 'garbage', recentDays: NaN })));
  assert.equal(buildOutfits(wardrobe(), { limit: 0 }).length, 0);
  assert.ok(buildOutfits(wardrobe(), null).length > 0);
});

function bigWardrobe(n = 300) {
  const fams = Object.keys(COLOR_FAMILIES);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const kindsBySlot = { top: ['t-shirt', 'oxford', 'polo', 'sweater', 'hoodie'], bottom: ['jeans', 'chinos', 'joggers', 'dress pants', 'shorts'],
    shoes: ['sneakers', 'boots', 'loafers', 'oxfords'], belt: ['leather belt', 'canvas belt'], layer: ['blazer', 'denim jacket', 'puffer', 'rain jacket'],
    neckwear: ['tie', 'scarf'], headwear: ['beanie', 'baseball cap'] };
  const slots = ['top', 'top', 'top', 'top', 'bottom', 'bottom', 'bottom', 'shoes', 'shoes', 'belt', 'layer', 'layer', 'neckwear', 'headwear'];
  const items = [];
  for (let i = 0; i < n; i++) {
    const slot = pick(slots);
    const f = pick(fams);
    items.push(makeItem({ id: `big-${i}`, slot, kind: pick(kindsBySlot[slot]), colors: [{ hex: COLOR_FAMILIES[f].hex, family: f, weight: 1 }],
      leather: pick(['black', 'brown', 'tan']), pattern: rnd() < 0.15 ? 'stripe' : 'solid' }));
  }
  return items;
}

test('300 items build in well under 300ms', () => {
  const items = bigWardrobe(300);
  assert.equal(items.length, 300);
  buildOutfits(items, { today: TODAY }); // warm-up
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const out = buildOutfits(items, { today: TODAY, weather: 'cold', occasion: 'any' });
    best = Math.min(best, performance.now() - t);
    assert.ok(out.length > 0);
  }
  assert.ok(best < 150, `took ${best.toFixed(1)}ms`);
  const t2 = performance.now();
  buildOutfits(bigWardrobe(600), { today: TODAY });
  assert.ok(performance.now() - t2 < 300);
});

test('big wardrobe results keep the belt rule', () => {
  const out = buildOutfits(bigWardrobe(300), { today: TODAY, limit: 20 });
  const hasBelts = bigWardrobe(300).some((i) => i.slot === 'belt');
  assert.ok(hasBelts);
  for (const o of out) assert.equal(!!o.items.belt, o.items.bottom.beltLoops === true);
});

// ---------------------------------------------------------------------------
// rankForSlot (swap one item)
// ---------------------------------------------------------------------------
import { rankForSlot } from '../../src/engine/build.js';

test('rankForSlot: sorted best first, current item has delta 0, items form full outfits', () => {
  const w = wardrobe();
  const o = buildOutfits(w, { today: TODAY })[0];
  for (const slot of ['top', 'bottom', 'shoes', 'layer']) {
    const r = rankForSlot(w, o.items, slot, { today: TODAY });
    assert.ok(r.length > 0, slot);
    for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score, `${slot} sorted`);
    const cur = o.items[slot];
    if (cur) assert.equal(r.find((x) => x.item && x.item.id === cur.id).delta, 0);
    for (const x of r) {
      assert.ok(x.items.top && x.items.bottom);
      assert.equal(x.delta, x.score - scoreOutfit(o.items, { beltAvailable: true }).score);
      assert.ok(Array.isArray(x.reasons));
      if (x.item) assert.equal(x.items[slot].id, x.item.id); else assert.equal(x.items[slot], undefined);
    }
  }
});

test('rankForSlot: optional slots offer a null "none" option; required slots do not', () => {
  const w = wardrobe();
  const o = buildOutfits(w, { today: TODAY, weather: 'cold' })[0];
  assert.ok(rankForSlot(w, o.items, 'layer', {}).some((x) => x.item === null));
  assert.ok(rankForSlot(w, o.items, 'headwear', {}).some((x) => x.item === null));
  assert.ok(!rankForSlot(w, o.items, 'top', {}).some((x) => x.item === null));
});

test('rankForSlot: swapping the bottom to joggers removes the belt; swapping back adds one', () => {
  const w = wardrobe();
  const base = { top: W['gray-tee'], bottom: W['dark-jeans'], shoes: W['white-sneakers'], belt: W['brown-belt'] };
  const r = rankForSlot(w, base, 'bottom', {});
  const jog = r.find((x) => x.item && x.item.id === 'gray-joggers');
  assert.equal(jog.items.belt, undefined);
  const noBelt = { top: W['gray-tee'], bottom: W['gray-joggers'], shoes: W['white-sneakers'] };
  const back = rankForSlot(w, noBelt, 'bottom', {}).find((x) => x.item && x.item.id === 'dark-jeans');
  assert.ok(back.items.belt, 'a bottom with loops gets the best belt');
});

test('rankForSlot: unavailable items are excluded; garbage input is safe', () => {
  const w = wardrobe().map((i) => (i.id === 'white-sneakers' ? { ...i, available: false } : i));
  const base = { top: W['gray-tee'], bottom: W['dark-jeans'], shoes: W['brown-boots'] };
  assert.ok(!rankForSlot(w, base, 'shoes', {}).some((x) => x.item && x.item.id === 'white-sneakers'));
  assert.deepEqual(rankForSlot(null, null, 'nope'), []);
  assert.doesNotThrow(() => rankForSlot([], {}, 'top', null));
});

test('rankForSlot: respects context (rain prefers the rain jacket) and passes it through', () => {
  const w = wardrobe();
  const base = { top: W['gray-tee'], bottom: W['dark-jeans'], shoes: W['brown-boots'], belt: W['brown-belt'], layer: W['denim-jacket'] };
  const r = rankForSlot(w, base, 'layer', { rain: true, weather: 'mild' });
  assert.equal(r[0].item.id, 'rain-jacket');
});

test('rankForSlot: fast with 300 items', () => {
  const items = bigWardrobe(300);
  const o = buildOutfits(items, { today: TODAY })[0];
  rankForSlot(items, o.items, 'top', {});
  const t = performance.now();
  for (const slot of ['top', 'bottom', 'shoes', 'layer']) rankForSlot(items, o.items, slot, { today: TODAY });
  assert.ok(performance.now() - t < 300, `${(performance.now() - t).toFixed(0)}ms`);
});
