import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { makeItem } from '../../src/model.js';
import { learnTaste, tasteDelta, describeTaste } from '../../src/engine/taste.js';

const NOW = Date.UTC(2026, 10, 20);
const DAY = 86400000;
const fam = (slot, kind, family, extra = {}) => makeItem({ slot, kind, colors: [{ hex: undefined, family, weight: 1 }], ...extra });
const outfit = (topFam, botFam = 'navy', shoeFam = 'brown', topKind = 't-shirt') => ({
  top: fam('top', topKind, topFam), bottom: fam('bottom', 'chinos', botFam), shoes: fam('shoes', 'sneakers', shoeFam),
});
const earth = ['olive', 'brown', 'beige', 'rust'];
const bright = ['red', 'orange', 'yellow', 'pink'];
const battles = (n, at = NOW) => Array.from({ length: n }, (_, i) => ({
  type: 'battle', at, winner: outfit(earth[i % 4]), loser: outfit(bright[i % 4]),
}));

test('earth tones beat brights: positive and negative deltas with reasons', () => {
  const t = learnTaste(battles(16), { now: NOW });
  const good = tasteDelta(outfit('olive'), t), bad = tasteDelta(outfit('red'), t);
  assert.ok(good.delta > 2, `good ${good.delta}`);
  assert.ok(bad.delta < -2, `bad ${bad.delta}`);
  assert.ok(good.reasons.length <= 2 && good.reasons.every((r) => r.tag === 'taste-like'));
  assert.ok(bad.reasons.every((r) => r.tag === 'taste-dislike'));
  for (const r of [...good.reasons, ...bad.reasons]) assert.ok(!/undefined|NaN|id/i.test(r.text.replace(/\bidea\b/, '')), r.text);
});

test('thin evidence gives zero', () => {
  const t = learnTaste(battles(4), { now: NOW });
  assert.deepEqual(tasteDelta(outfit('olive'), t), { delta: 0, reasons: [] });
  assert.deepEqual(tasteDelta(outfit('olive'), null), { delta: 0, reasons: [] });
});

test('delta always within +-8 (fuzz)', () => {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const fams = [...earth, ...bright, 'navy', 'black'];
  for (let round = 0; round < 20; round++) {
    const ev = Array.from({ length: 10 + Math.floor(rnd() * 200) }, () => ({
      type: ['battle', 'like', 'dislike', 'wear'][Math.floor(rnd() * 4)], at: NOW - rnd() * 300 * DAY,
      winner: outfit(fams[Math.floor(rnd() * fams.length)]), loser: outfit(fams[Math.floor(rnd() * fams.length)]),
      items: outfit(fams[Math.floor(rnd() * fams.length)]),
    }));
    const t = learnTaste(ev, { now: NOW });
    for (const [k, f] of Object.entries(t.features)) assert.ok(f.w >= -1 && f.w <= 1, k);
    for (let j = 0; j < 20; j++) {
      const d = tasteDelta(outfit(fams[Math.floor(rnd() * fams.length)]), t);
      assert.ok(d.delta >= -8 && d.delta <= 8 && Number.isFinite(d.delta));
      assert.ok(d.reasons.length <= 2);
    }
  }
});

test('features shared by both outfits cancel in battles', () => {
  const ev = Array.from({ length: 10 }, () => ({ type: 'battle', at: NOW, winner: outfit('olive', 'navy', 'brown'), loser: outfit('red', 'navy', 'brown') }));
  const t = learnTaste(ev, { now: NOW });
  assert.equal(t.features['lower:navy'], undefined);
  assert.equal(t.features['feet:brown'], undefined);
  assert.ok(t.features['face:olive'].w > 0 && t.features['face:red'].w < 0);
});

test('recency: old votes count less', () => {
  const fresh = learnTaste(battles(12, NOW), { now: NOW });
  const old = learnTaste(battles(12, NOW - 300 * DAY), { now: NOW, halfLifeDays: 60 });
  assert.ok(Math.abs(old.features['face:olive'].w) < Math.abs(fresh.features['face:olive'].w) * 0.6);
});

test('like / dislike / wear weights and shrinkage', () => {
  const one = learnTaste([{ type: 'like', at: NOW, items: outfit('olive') }], { now: NOW });
  assert.ok(one.features['face:olive'].w < 0.3, 'one vote is not a strong opinion');
  const wear = learnTaste(Array.from({ length: 6 }, () => ({ type: 'wear', at: NOW, items: outfit('olive') })), { now: NOW });
  const like = learnTaste(Array.from({ length: 6 }, () => ({ type: 'like', at: NOW, items: outfit('olive') })), { now: NOW });
  const dis = learnTaste(Array.from({ length: 6 }, () => ({ type: 'dislike', at: NOW, items: outfit('olive') })), { now: NOW });
  assert.ok(wear.features['face:olive'].w < like.features['face:olive'].w);
  assert.ok(dis.features['face:olive'].w < 0);
});

test('describeTaste lists the learned favorite', () => {
  const d = describeTaste(learnTaste(battles(16), { now: NOW }));
  assert.ok(d.likes.length <= 5 && d.dislikes.length <= 5);
  assert.ok(d.likes.some((l) => /Olive near your face/.test(l.label)), JSON.stringify(d.likes));
  assert.ok(d.dislikes.some((l) => /Red near your face/.test(l.label)));
  for (const r of [...d.likes, ...d.dislikes]) assert.ok(r.strength >= 0 && r.strength <= 1 && r.evidence > 0 && !/undefined|NaN/.test(r.label));
  assert.deepEqual(describeTaste(null), { likes: [], dislikes: [] });
});

test('deterministic', () => {
  const ev = battles(20);
  assert.deepEqual(learnTaste(ev, { now: NOW }), learnTaste(ev, { now: NOW }));
  const t = learnTaste(ev, { now: NOW });
  assert.deepEqual(tasteDelta(outfit('olive'), t), tasteDelta(outfit('olive'), t));
});

test('garbage tolerant', () => {
  const junk = [null, undefined, 5, 'x', [], {}, { type: 'battle' }, { type: 'battle', winner: null, loser: {} },
    { type: 'like', items: { bogus: { kind: 'x' }, top: null, bottom: 7 } }, { type: 'wear', at: 'soon', items: { top: {} } },
    { type: 'like', at: NaN, items: { top: { colors: 'red', formality: 'hi', pattern: 3 } } }, { type: 'nope', items: outfit('red') }];
  const t = learnTaste(junk, { now: NaN, halfLifeDays: -3 });
  assert.ok(Number.isFinite(t.evidence));
  for (const bad of [undefined, null, 'x', {}, { features: null, evidence: 9 }, { features: { 'face:red': { w: NaN, n: 'a' } }, evidence: 9 }]) {
    const r = tasteDelta({ top: null, zzz: {} }, bad); assert.equal(r.delta, 0);
    assert.doesNotThrow(() => describeTaste(bad));
    assert.doesNotThrow(() => tasteDelta(outfit('red'), bad));
  }
  assert.doesNotThrow(() => learnTaste(undefined));
  const big = Array.from({ length: 10000 }, (_, i) => (i % 3 ? { type: 'like', at: NOW, items: outfit('olive') } : junk[i % junk.length]));
  assert.doesNotThrow(() => learnTaste(big, { now: NOW }));
});

test('perf: 5000 events under 150ms (cold JIT + loaded CI)', () => {
  const ev = battles(5000);
  learnTaste(ev.slice(0, 200), { now: NOW });
  const t0 = performance.now(); learnTaste(ev, { now: NOW }); const dt = performance.now() - t0;
  assert.ok(dt < 150, `${dt}ms`);
});
