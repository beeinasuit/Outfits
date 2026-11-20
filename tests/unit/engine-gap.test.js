import test from 'node:test';
import assert from 'node:assert/strict';
import { gapAnalysis, buildOutfits } from '../../src/engine/build.js';
import { wardrobe, mk } from './fixtures/wardrobe.js';

const TODAY = '2026-11-20';

test('gapAnalysis returns 3-5 friendly, well-formed suggestions', () => {
  const items = wardrobe().filter((i) => !['navy-chinos', 'white-sneakers'].includes(i.id));
  const gaps = gapAnalysis(items, { today: TODAY });
  assert.ok(gaps.length >= 3 && gaps.length <= 5, `got ${gaps.length}`);
  for (const g of gaps) {
    assert.ok(g.slot && g.kind && g.family);
    assert.ok(Number.isInteger(g.unlocks) && g.unlocks >= 0);
    assert.match(g.text, /\.$/);
    assert.match(g.text, /\b(would|Adding)\b/);
  }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i - 1].unlocks >= gaps[i].unlocks || gaps[i - 1].leather);
});

test('only black belts but brown shoes: suggests a brown leather belt first', () => {
  const items = wardrobe().filter((i) => i.id !== 'brown-belt' && i.id !== 'black-oxfords');
  assert.ok(items.some((i) => i.id === 'black-belt') && items.some((i) => i.id === 'brown-boots'));
  const gaps = gapAnalysis(items, { today: TODAY });
  assert.equal(gaps[0].slot, 'belt');
  assert.equal(gaps[0].leather, 'brown');
  assert.ok(gaps[0].unlocks > 0);
  assert.match(gaps[0].text, /brown leather belt would complete \d+ outfits?/i);
});

test('only brown belt but black shoes: suggests a black belt', () => {
  const items = wardrobe().filter((i) => i.id !== 'black-belt' && i.id !== 'brown-boots');
  const gaps = gapAnalysis(items, { today: TODAY });
  const belt = gaps.find((g) => g.slot === 'belt');
  assert.ok(belt && belt.leather === 'black');
});

test('no suggestion duplicates something already owned, and no belt advice without belt-loop bottoms', () => {
  const gaps = gapAnalysis(wardrobe(), { today: TODAY });
  assert.ok(!gaps.some((g) => g.slot === 'belt' && g.leather === 'brown'));
  const joggersOnly = wardrobe().filter((i) => i.slot !== 'bottom' || i.beltLoops === false).filter((i) => i.slot !== 'belt');
  assert.ok(!gapAnalysis(joggersOnly, { today: TODAY }).some((g) => g.slot === 'belt'));
});

test('empty and degenerate wardrobes do not throw', () => {
  assert.deepEqual(gapAnalysis([], {}), []);
  assert.deepEqual(gapAnalysis(undefined), []);
  const tops = wardrobe().filter((i) => i.slot === 'top');
  const g = gapAnalysis(tops, { today: TODAY });
  assert.ok(Array.isArray(g));
  assert.ok(g.every((x) => x.slot === 'bottom'));
  const one = gapAnalysis([mk('only-bottom', 'bottom', 'jeans', 'denim')], { today: TODAY });
  assert.ok(one.every((x) => x.slot === 'top'));
});

test('suggestions really unlock outfits: buying the top suggestion lifts good outfit count', () => {
  const items = wardrobe().filter((i) => i.id !== 'brown-belt' && i.id !== 'black-oxfords');
  const good = (list) => buildOutfits(list, { today: TODAY, limit: 300, diversity: false }).filter((o) => o.score >= 75).length;
  const before = good(items);
  const bought = mk('new-belt', 'belt', 'leather belt', 'brown', { leather: 'brown' });
  assert.ok(good([...items, bought]) > before);
});
