import test from 'node:test';
import assert from 'node:assert/strict';
import { roastOutfit, roastLevel, problemGroups, fill, TEMPLATES, HEADLINES, LIGHT_PREFIX, FIX_TEMPLATES, NO_FIX_TEMPLATES, ROAST_FULL_BELOW, ROAST_LIGHT_BELOW } from '../../src/engine/roast.js';
import { scoreOutfit } from '../../src/engine/score.js';
import { makeItem, COLOR_FAMILIES } from '../../src/model.js';

const C = (f) => [{ hex: COLOR_FAMILIES[f].hex, family: f, weight: 1 }];
const mk = (slot, kind, name, fam, extra = {}) => makeItem({ id: name, slot, kind, name, colors: C(fam), ...extra });
const R = (tag, delta, text = 'x') => ({ tag, delta, text });

const everyString = () => [...Object.values(TEMPLATES).flat(), ...Object.values(HEADLINES).flat(), ...LIGHT_PREFIX, ...FIX_TEMPLATES, ...NO_FIX_TEMPLATES];
const BANNED = ['fuck', 'shit', 'damn', 'bitch', 'bastard', 'crap', 'ass', 'hell', 'piss', 'dick', 'slut', 'whore', 'retard', 'idiot', 'stupid', 'moron', 'hate yourself', 'kill', 'die', 'worthless', 'loser', 'nazi'];
const BODY = ['fat', 'thin', 'skinny', 'weight', 'chubby', 'ugly', 'face', 'skin', 'hair', 'nose', 'belly', 'butt', 'legs', 'arms', 'torso', 'body', 'old', 'age', 'gender', 'race', 'bald', 'tall', 'short', 'height', 'curv', 'figure', 'waistline'];
const words = (s) => s.toLowerCase().replace(/[^a-z\s’']/g, ' ').split(/\s+/);

test('thresholds and levels', () => {
  assert.equal(ROAST_FULL_BELOW, 55); assert.equal(ROAST_LIGHT_BELOW, 70);
  assert.equal(roastLevel(54), 'full'); assert.equal(roastLevel(55), 'light'); assert.equal(roastLevel(69), 'light'); assert.equal(roastLevel(70), 'none'); assert.equal(roastLevel(NaN), 'none');
});

test('templates: no profanity, slurs or self-hate, no body/weight/appearance terms', () => {
  for (const s of everyString()) {
    const w = new Set(words(s));
    for (const b of BANNED) assert.ok(b.includes(' ') ? !s.toLowerCase().includes(b) : !w.has(b), `banned "${b}" in: ${s}`);
    for (const b of BODY) assert.ok(!w.has(b) && !words(s).some((x) => x.startsWith(b) && b.length > 4), `body term "${b}" in: ${s}`);
  }
});

test('variety: at least 6 templates per problem group, 4 headlines per band, 6 fix lines', () => {
  for (const [g, list] of Object.entries(TEMPLATES)) { assert.ok(list.length >= 6, `${g} has ${list.length}`); assert.equal(new Set(list).size, list.length); }
  for (const l of Object.values(HEADLINES)) assert.ok(l.length >= 4);
  assert.ok(FIX_TEMPLATES.length >= 6);
});

const clashItems = () => ({ top: mk('top', 't-shirt', 'Mustard tee', 'mustard'), bottom: mk('bottom', 'jeans', 'Red jeans', 'red'), shoes: mk('shoes', 'oxfords', 'Black oxfords', 'black') });
const swap = (cur, to, delta) => ({ slot: cur.slot, cur, delta, row: { item: to, score: 70 } });

test('no roast at 70 or above, even with problems', () => {
  const r = roastOutfit(clashItems(), { score: 80, reasons: [R('color-clash', -5)] }, {}, { seed: 'a' });
  assert.equal(r.level, 'none'); assert.deepEqual(r.lines, []);
});

test('full roast: headline, 2-3 problem lines, ends with the rescue swap, names real items', () => {
  const items = clashItems();
  const to = mk('bottom', 'chinos', 'Navy chinos', 'navy');
  const res = { score: 38, reasons: [R('color-clash', -9, 'x'), R('formality-shoes', -6), R('contrast-muddy', -3), R('color-good-pair', 4)], swap: swap(items.bottom, to, 14) };
  const r = roastOutfit(items, res, {}, { seed: 'chk1' });
  assert.equal(r.level, 'full');
  assert.ok(r.headline.length > 10);
  assert.equal(r.lines.length, 4); // 3 problems + rescue
  assert.match(r.lines[r.lines.length - 1], /navy chinos/);
  assert.match(r.lines[r.lines.length - 1], /\+14/);
  assert.deepEqual(r.groups, ['colorClash', 'formality', 'muddy']);
  assert.ok(r.text.length <= 400);
});

test('honest: only problems that are in the reasons get roasted', () => {
  const items = clashItems();
  const r = roastOutfit(items, { score: 40, reasons: [R('weather-cold', -8), R('color-good-pair', 5), R('formality-ok', 2)], swap: null }, { weather: 'cold' }, { seed: 's' });
  assert.deepEqual(r.groups, ['cold']);
  const all = r.lines.join(' ').toLowerCase();
  assert.ok(!/pattern|clash|belt|formal/.test(all.replace(/not formal/, '')), all);
  assert.match(r.lines[r.lines.length - 1], /swap|closet|tomorrow|burn/i);
});

test('positive-only reasons at a low score still never invent a flaw', () => {
  const r = roastOutfit(clashItems(), { score: 50, reasons: [R('color-good-pair', 4)] }, {}, { seed: 'z' });
  assert.equal(r.level, 'full');
  assert.deepEqual(r.groups, []);
  assert.ok(r.lines[0].includes('can’t point at one disaster'));
});

test('light jab: exactly one line, no rescue forced into the lines', () => {
  const items = clashItems();
  const r = roastOutfit(items, { score: 62, reasons: [R('pattern-busy', -4), R('color-clash', -3)], swap: swap(items.top, mk('top', 't-shirt', 'White tee', 'white'), 6) }, {}, { seed: 'q' });
  assert.equal(r.level, 'light');
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.groups, ['pattern']);
  assert.match(r.fix, /white tee/);
});

test('deterministic per seed, varies across seeds, no template repeats within a roast', () => {
  const items = clashItems();
  const res = { score: 30, reasons: [R('color-clash', -9), R('formality-shoes', -6), R('contrast-muddy', -3), R('pattern-busy', -2)], swap: null };
  const a1 = roastOutfit(items, res, {}, { seed: 'same' }), a2 = roastOutfit(items, res, {}, { seed: 'same' });
  assert.deepEqual(a1, a2);
  const texts = new Set();
  for (let i = 0; i < 40; i++) texts.add(roastOutfit(items, res, {}, { seed: 'id' + i }).text);
  assert.ok(texts.size >= 30, `only ${texts.size} distinct roasts in 40 seeds`);
  for (let i = 0; i < 40; i++) { const r = roastOutfit(items, res, {}, { seed: 'u' + i }); assert.equal(new Set(r.lines).size, r.lines.length); }
});

test('every problem tag maps to a group and fills with no leftover {tokens}', () => {
  const items = { ...clashItems(), layer: mk('layer', 'blazer', 'Navy blazer', 'navy'), belt: mk('belt', 'leather belt', 'Brown belt', 'brown') };
  const tags = ['color-clash', 'color-risky', 'contrast-muddy', 'pattern-busy', 'pattern-graphic', 'formality-clash', 'shoes-sporty', 'weather-cold', 'weather-hot', 'rain-none', 'shorts-boots',
    'occasion-avoid', 'occasion-off', 'leather-clash', 'belt-missing', 'tie-no-collar', 'hat-mismatch', 'complexion-off', 'recently-worn', 'feedback-pair-disliked', 'unknown-new-tag'];
  for (const tag of tags) for (let i = 0; i < 6; i++) {
    const r = roastOutfit(items, { score: 20, reasons: [R(tag, -8, 'Mustard tee is not right for work.')], swap: swap(items.top, mk('top', 't-shirt', 'White tee', 'white'), 9) }, { occasionDef: { label: 'Work' }, weather: 'cold' }, { seed: tag + i });
    assert.equal(r.groups.length, 1, tag);
    assert.ok(!/[{}]/.test(r.text), `${tag}: ${r.text}`);
  }
  assert.equal(problemGroups([R('x-unknown', -2)])[0].group, 'generic');
});

test('complexion roast is about the color choice and uses the real piece', () => {
  const items = { top: mk('top', 'sweater', 'Olive sweater', 'olive'), bottom: mk('bottom', 'jeans', 'Jeans', 'denim') };
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(roastOutfit(items, { score: 40, reasons: [R('complexion-off', -6, 'Olive sweater can look a little flat against your cool undertone.')], swap: null }, {}, { seed: 'c' + i }).lines[0]);
  assert.ok([...seen].some((l) => /olive/i.test(l)));
});

test('integrates with the real engine: dress shoes + a graphic tee + shorts get a grounded roast', () => {
  const items = { top: mk('top', 'graphic tee', 'Band tee', 'black', { pattern: 'graphic' }), bottom: mk('bottom', 'athletic shorts', 'Gym shorts', 'red'), shoes: mk('shoes', 'oxfords', 'Black oxfords', 'black') };
  const res = scoreOutfit(items, { occasion: 'work', maxReasons: 20 });
  const r = roastOutfit(items, res, { occasion: 'work', occasionDef: { label: 'Work' } }, { seed: 'real' });
  assert.ok(res.score < 70);
  assert.notEqual(r.level, 'none');
  for (const g of r.groups) assert.ok(problemGroups(res.reasons).some((p) => p.group === g), g);
});

test('fill handles capitalized tokens', () => {
  assert.equal(fill('{A} and {b}', { a: 'red', b: 'blue' }), 'Red and blue');
});
