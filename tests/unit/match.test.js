import test from 'node:test';
import assert from 'node:assert/strict';
import { matchBand, colorsDist } from '../../src/engine/match.js';
import { makeItem, COLOR_FAMILIES, todayISO } from '../../src/model.js';
import { analyzeWearing } from '../../src/vision/wearing.js';
import { makeScene, WARM } from './fixtures/person-scene.js';
import { demoItems } from '../../src/ui/data.js';

const C = (fam, hex, w = 1) => ({ hex: hex || COLOR_FAMILIES[fam].hex, family: fam, weight: w });
const band = (colors, pattern = 'solid') => ({ colors, pattern, box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1 });
const top = (id, fam, extra = {}) => makeItem({ id, slot: 'top', kind: 't-shirt', name: id, colors: [C(fam)], ...extra });

test('closest color wins and results are limited to the slot', () => {
  const items = [top('navy', 'navy'), top('red', 'red'), top('white', 'white'),
    makeItem({ id: 'navy-pants', slot: 'bottom', kind: 'chinos', colors: [C('navy')] })];
  const r = matchBand(band([C('navy', '#202c48')]), items, 'top');
  assert.equal(r[0].item.id, 'navy');
  assert.ok(r[0].good && r[0].confidence > 0.7);
  assert.ok(r.every((x) => x.item.slot === 'top'));
  assert.equal(r.length, 3);
});

test('limit, empty closet, bad input', () => {
  assert.deepEqual(matchBand(band([C('navy')]), [], 'top'), []);
  assert.deepEqual(matchBand(null, [top('a', 'navy')], 'top'), []);
  assert.deepEqual(matchBand({ colors: [] }, [top('a', 'navy')], 'top'), []);
  assert.deepEqual(matchBand(band([C('navy')]), null, 'top'), []);
  assert.equal(matchBand(band([C('navy')]), [top('a', 'navy'), top('b', 'red')], 'top', { limit: 1 }).length, 1);
});

test('a far-off color is not "good"', () => {
  const r = matchBand(band([C('red')]), [top('navy', 'navy')], 'top');
  assert.equal(r[0].good, false);
});

test('secondary colors break ties: striped shirt matches the striped item', () => {
  const striped = top('striped', 'light-blue', { colors: [C('light-blue', null, 0.6), C('white', null, 0.4)], pattern: 'stripe' });
  const plain = top('plain', 'light-blue');
  const r = matchBand(band([C('light-blue', null, 0.58), C('white', null, 0.42)], 'stripe'), [plain, striped], 'top');
  assert.equal(r[0].item.id, 'striped');
});

test('worn today / yesterday nudges ties toward what people actually re-wear', () => {
  const t = todayISO();
  const a = top('a', 'gray'), b = top('b', 'gray', { worn: [t] });
  const r = matchBand(band([C('gray')]), [a, b], 'top', { today: t });
  assert.equal(r[0].item.id, 'b');
});

test('a hamper item can still match (you might be wearing it), but a clean twin edges ahead', () => {
  const a = top('a', 'olive', { available: false }), b = top('b', 'olive');
  const r = matchBand(band([C('olive')]), [a, b], 'top');
  assert.equal(r[0].item.id, 'b');
  assert.equal(r.length, 2);
});

test('colorsDist is symmetric-ish and tolerant of exposure', () => {
  assert.ok(colorsDist([C('navy')], [C('navy')]) < 1);
  const dark = [C('navy', '#161f33')], mid = [C('navy', '#1f2a44')];
  assert.ok(colorsDist(dark, mid) < 8);
  assert.ok(colorsDist([C('navy')], [C('orange')]) > 30);
});

test('end to end: photo -> bands -> sample closet picks the right pieces', () => {
  const items = demoItems();
  const byName = (n) => items.find((i) => i.name === n);
  const scenes = [
    { o: { top: COLOR_FAMILIES.navy.hex, pants: COLOR_FAMILIES.beige.hex, shoes: COLOR_FAMILIES.brown.hex }, want: ['Navy oxford', 'Khaki chinos', 'Brown boots'] },
    { o: { top: COLOR_FAMILIES.olive.hex, pants: COLOR_FAMILIES.denim.hex, shoes: COLOR_FAMILIES.black.hex }, want: ['Olive henley', 'Dark denim jeans', 'Black derbies'] },
    { o: { bg: 'clutter', top: COLOR_FAMILIES.gray.hex, pants: COLOR_FAMILIES.black.hex, shoes: COLOR_FAMILIES.black.hex }, want: [null, 'Black joggers', 'Black derbies'] },
    { o: { cast: WARM, bg: '#f1efe9', top: COLOR_FAMILIES.white.hex, pants: COLOR_FAMILIES.navy.hex, shoes: COLOR_FAMILIES.white.hex }, want: [null, 'Navy chinos', 'White sneakers'] },
  ];
  let total = 0, right = 0;
  scenes.forEach((s, i) => {
    const r = analyzeWearing(makeScene({ seed: 40 + i, ...s.o }));
    assert.equal(r.ok, true);
    ['top', 'bottom', 'shoes'].forEach((slot, k) => {
      if (!s.want[k]) return;
      const m = matchBand(r.bands[slot], items, slot, { limit: 3 });
      total++;
      if (m[0] && m[0].item.name === s.want[k]) right++;
      assert.ok(m.slice(0, 3).some((x) => x.item.name === s.want[k]), `scene ${i} ${slot}: wanted ${s.want[k]}, got ${m.map((x) => x.item.name).join(', ')}`);
    });
  });
  assert.ok(right / total >= 0.7, `top-1 ${right}/${total}`);
  void byName;
});
