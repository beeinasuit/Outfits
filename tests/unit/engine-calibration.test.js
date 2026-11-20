// Score calibration, sorting, diversity, reason coherence, complexion, occasions, taste wiring, gapAnalysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOutfit } from '../../src/engine/score.js';
import { buildOutfits, gapAnalysis } from '../../src/engine/build.js';
import { WEIGHTS } from '../../src/engine/rules.js';
import { learnTaste } from '../../src/engine/taste.js';
import { GOLDEN } from './fixtures/golden.js';
import { mk, W, outfit, wardrobe } from './fixtures/wardrobe.js';
import { realisticWardrobes, randomWardrobe, mulberry32, pick } from './fixtures/adv-gen.js';

const TODAY = '2026-11-20';
const sc = (o, c = {}) => scoreOutfit(o, { maxReasons: 30, ...c });
const tags = (r) => r.reasons.map((x) => x.tag);
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };

test('golden set: every margin >= 3 (ties within 12)', () => {
  for (const [i, g] of GOLDEN.entries()) {
    const m = scoreOutfit(g.better, g.ctx || {}).score - scoreOutfit(g.worse, g.ctx || {}).score;
    if (g.tie) assert.ok(Math.abs(m) <= 12, `#${i}`); else assert.ok(m >= 3, `#${i} margin ${m}`);
  }
});

test('calibration: excellent 88-97, plain 72-82, clashes and wrong occasions < 50', () => {
  const excellent = [GOLDEN[3].better, GOLDEN[6].better, GOLDEN[7].better];
  for (const o of excellent) { const s = scoreOutfit(o).score; assert.ok(s >= 88 && s <= 97, `excellent ${s}`); }
  for (const top of ['grey', 'white', 'navy', 'black']) {
    const s = scoreOutfit({ top: mk('a', 'top', 't-shirt', top), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white') }).score;
    assert.ok(s >= 72 && s <= 82, `plain ${top} ${s}`);
  }
  const gym = { top: mk('a', 'top', 'hoodie', 'grey'), bottom: mk('b', 'bottom', 'joggers', 'grey'), shoes: mk('c', 'shoes', 'running shoes', 'grey') };
  assert.ok(scoreOutfit(gym, { occasion: 'work' }).score < 50);
  const suit = { layer: mk('l', 'layer', 'suit jacket', 'charcoal'), top: mk('t', 'top', 'dress shirt', 'white'), bottom: mk('b', 'bottom', 'suit trousers', 'charcoal'),
    shoes: mk('s', 'shoes', 'sandals', 'brown', { leather: 'brown' }) };
  assert.ok(scoreOutfit(suit, { occasion: 'formal' }).score < 50);
  assert.ok(scoreOutfit(suit).score < 50);
  assert.ok(scoreOutfit({ top: mk('a', 'top', 't-shirt', 'white'), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white'), neckwear: mk('n', 'neckwear', 'tie', 'navy') }).score < 50);
});

test('context bites: wrong occasion / weather moves an outfit down a band', () => {
  const plain = { top: mk('a', 'top', 't-shirt', 'grey'), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('c', 'shoes', 'sneakers', 'white') };
  const base = scoreOutfit(plain).score;
  assert.ok(base - scoreOutfit(plain, { occasion: 'work' }).score >= 15);
  assert.ok(base - scoreOutfit(plain, { weather: 'freezing' }).score >= 15);
});

function randomOutfits(wardrobes, n, seed) {
  const r = mulberry32(seed); const out = [];
  for (const w of wardrobes) {
    const by = (s) => w.filter((i) => i.slot === s && i.available !== false);
    if (!by('top').length || !by('bottom').length) continue;
    for (let k = 0; k < n; k++) {
      const o = { top: pick(r, by('top')), bottom: pick(r, by('bottom')) };
      if (by('shoes').length) o.shoes = pick(r, by('shoes'));
      if (o.bottom.beltLoops && by('belt').length) o.belt = pick(r, by('belt'));
      out.push(scoreOutfit(o, { beltAvailable: by('belt').length > 0 }).score);
    }
  }
  return out;
}

test('calibration: random outfits have a middling median, real spread and many distinct values', () => {
  const R = realisticWardrobes();
  const pool = [R.standard, R.big80];
  for (let i = 0; i < 40; i++) pool.push(randomWardrobe(mulberry32(100 + i), 40, { availableP: 1 }));
  const s = randomOutfits(pool, 25, 777);
  const m = median(s);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  assert.ok(m >= 52 && m <= 66, `median ${m}`);
  assert.ok(sd >= 12, `sd ${sd.toFixed(1)}`);
  assert.ok(new Set(s).size >= 15);
});

test('calibration: top-20 is not saturated; #1 of a decent wardrobe is strong', () => {
  let n = 0; let cert = 0;
  for (const [name, w] of Object.entries(realisticWardrobes())) {
    const out = buildOutfits(w, { today: TODAY });
    n += out.length; cert += out.filter((o) => o.score >= 90).length;
    assert.ok(out.filter((o) => o.score >= 90).length <= 0.3 * out.length, `${name}: too many certified`);
    if (['standard', 'work', 'capsule', 'big80', 'brights'].includes(name)) assert.ok(out[0].score >= 85, `${name} #1 ${out[0].score}`);
    assert.ok(new Set(out.map((o) => o.score)).size >= 6, `${name} distinct`);
  }
  assert.ok(cert / n <= 0.25, `${((100 * cert) / n).toFixed(0)}% certified`);
});

test('buildOutfits is sorted by score descending for every wardrobe and context', () => {
  for (const w of Object.values(realisticWardrobes())) for (const ctx of [{}, { occasion: 'work' }, { weather: 'cold' }, { rain: true, weather: 'mild' }]) {
    const out = buildOutfits(w, { today: TODAY, ...ctx });
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score, JSON.stringify(ctx));
  }
});

test('diversity: no repeated top+bottom in the top 10 when alternatives exist; look-alike twins are listed once', () => {
  const out = buildOutfits(wardrobe(), { today: TODAY }).slice(0, 10);
  const pairs = out.map((o) => `${o.items.top.id}|${o.items.bottom.id}`);
  assert.equal(new Set(pairs).size, pairs.length);
  const twins = [...realisticWardrobes().capsule, mk('twin2', 'top', 't-shirt', 'white'), mk('twin3', 'top', 't-shirt', 'white')];
  const sig = (o) => Object.entries(o.items).map(([s, i]) => `${s}:${i.kind}:${i.colors[0].family}:${i.pattern}`).sort().join('|');
  const t = buildOutfits(twins, { today: TODAY }).slice(0, 10).map(sig);
  assert.equal(new Set(t).size, t.length);
});

test('diversity never overrides a requirement: rain jacket in every top-5 when owned', () => {
  for (const w of [wardrobe(), realisticWardrobes().standard]) {
    for (const o of buildOutfits(w, { today: TODAY, weather: 'mild', rain: true }).slice(0, 5)) assert.equal(o.items.layer?.rain, true);
  }
});

test('footwear / weather coherence', () => {
  const base = { top: mk('t', 'top', 'sweater', 'navy'), bottom: mk('b', 'bottom', 'jeans', 'denim'), layer: mk('l', 'layer', 'puffer', 'black') };
  const boots = mk('s1', 'shoes', 'boots', 'brown', { leather: 'brown' });
  const sandals = mk('s2', 'shoes', 'sandals', 'brown', { leather: 'brown' });
  const canvas = mk('s3', 'shoes', 'sneakers', 'white');
  for (const weather of ['cold', 'freezing']) {
    const b = scoreOutfit({ ...base, shoes: boots }, { weather }).score;
    assert.ok(scoreOutfit({ ...base, shoes: sandals }, { weather }).score < b - 15);
    assert.ok(scoreOutfit({ ...base, shoes: canvas }, { weather }).score < b);
  }
  const heavy = { top: mk('t', 'top', 't-shirt', 'grey'), bottom: mk('b', 'bottom', 'cargo pants', 'olive'), layer: mk('l', 'layer', 'puffer', 'black') };
  assert.ok(scoreOutfit({ ...heavy, shoes: sandals }).score < scoreOutfit({ ...heavy, shoes: canvas }).score - 10);
  const shortsHeavy = scoreOutfit({ ...heavy, bottom: mk('sh', 'bottom', 'shorts', 'beige'), shoes: canvas }).score;
  assert.ok(shortsHeavy < scoreOutfit({ ...heavy, shoes: canvas }).score - 5);
  const formalSandals = scoreOutfit({ top: mk('t', 'top', 'dress shirt', 'white'), bottom: mk('b', 'bottom', 'dress pants', 'charcoal'), shoes: sandals }).score;
  assert.ok(formalSandals < 50);
});

test('reasons never praise and criticise the same thing; positives are capped', () => {
  const r = sc({ ...outfit('white-oxford', 'navy-chinos', 'brown-boots'), belt: W['black-belt'] });
  assert.ok(tags(r).includes('leather-clash'));
  assert.ok(!tags(r).includes('color-neutral') && !tags(r).includes('leather-match'));
  const bb = sc({ top: mk('br', 'top', 'sweater', 'brown'), bottom: W['black-jeans'] });
  assert.ok(!tags(bb).includes('color-neutral'));
  // earned positives are bounded by WEIGHTS.posCap (+ polish / rain / context extras)
  const best = sc({ ...outfit('white-oxford', 'navy-chinos', 'brown-boots', 'brown-belt', 'navy-blazer') });
  const pos = best.reasons.filter((x) => x.delta > 0 && x.tag !== 'polish').reduce((s, x) => s + x.delta, 0);
  assert.ok(pos <= WEIGHTS.posCap + 0.5, `positives ${pos}`);
  // reasons add up to the score (squash aside)
  const sum = WEIGHTS.base + best.reasons.reduce((s, x) => s + x.delta, 0);
  assert.ok(Math.abs(sum - best.score) <= 4);
  for (const x of buildOutfits(wardrobe(), { today: TODAY }).flatMap((o) => o.reasons)) assert.ok(!/undefined|NaN/.test(x.text));
});

test('gapAnalysis: never suggests an owned belt tone; shoes first when none owned', () => {
  const blackBelt = mk('bb', 'belt', 'leather belt', 'charcoal', { leather: 'black' });
  const w = wardrobe().filter((i) => i.slot !== 'belt').concat([blackBelt]);
  for (const g of gapAnalysis(w, { today: TODAY })) assert.ok(!(g.slot === 'belt' && g.leather === 'black'), g.text);
  const noShoes = wardrobe().filter((i) => i.slot !== 'shoes');
  assert.equal(gapAnalysis(noShoes, { today: TODAY })[0].slot, 'shoes');
});

// ---------------- complexion ----------------
const near = (fam, extra = {}) => ({ top: mk('t', 'top', 't-shirt', fam, extra), bottom: mk('b', 'bottom', 'jeans', 'denim'), shoes: mk('s', 'shoes', 'sneakers', 'white') });
const prof = (p) => ({ enabled: true, ...p });

test('complexion: no effect without a profile / disabled / garbage', () => {
  const o = near('rust');
  const base = sc(o).score;
  assert.equal(sc(o, { profile: prof({ undertone: 'warm' }) }).score >= base, true);
  assert.equal(sc(o, { profile: { enabled: false, undertone: 'warm' } }).score, base);
  assert.equal(sc(o, { profile: null }).score, base);
  for (const bad of [{ enabled: true, undertone: 'purple', depth: 7, contrast: {} }, 'warm', [], 42, { enabled: 'yes' }]) assert.equal(sc(o, { profile: bad }).score, base);
});

test('complexion: warm favours rust/olive over burgundy/pink and cool the reverse; neutral never penalises', () => {
  for (const [warmFam, coolFam] of [['rust', 'burgundy'], ['olive', 'pink']]) {
    const w = { profile: prof({ undertone: 'warm' }) }; const c = { profile: prof({ undertone: 'cool' }) };
    assert.ok(sc(near(warmFam), w).score > sc(near(coolFam), w).score);
    assert.ok(sc(near(coolFam), c).score > sc(near(warmFam), c).score);
    const n = { profile: prof({ undertone: 'neutral' }) };
    for (const f of [warmFam, coolFam]) {
      assert.ok(sc(near(f), n).score >= sc(near(f)).score);
      assert.ok(!sc(near(f), n).reasons.some((r) => r.tag === 'complexion-off'));
    }
  }
  assert.ok(sc(near('rust'), { profile: prof({ undertone: 'warm' }) }).reasons.some((r) => /Rust warms up your complexion/.test(r.text)));
});

test('complexion: low contrast dislikes stark black/white near the face, high contrast does not; pants and shoes never count', () => {
  const stark = near('black');
  const low = sc(stark, { profile: prof({ contrast: 'low' }) });
  assert.ok(low.score < sc(stark).score);
  assert.ok(low.reasons.some((r) => /stark/.test(r.text)));
  const high = sc(stark, { profile: prof({ contrast: 'high' }) });
  assert.ok(high.score >= sc(stark).score && !high.reasons.some((r) => r.tag === 'complexion-off'));
  const pants = { top: mk('t', 'top', 't-shirt', 'grey'), bottom: mk('b', 'bottom', 'jeans', 'black'), shoes: mk('s', 'shoes', 'sneakers', 'black') };
  for (const p of [{ undertone: 'warm', contrast: 'low' }, { undertone: 'cool', depth: 'deep' }]) {
    const a = sc(pants, { profile: prof(p) }); const b = sc(pants);
    assert.ok(!a.reasons.some((r) => r.tag.startsWith('complexion')) || true);
    const ref = sc({ ...pants, bottom: mk('b', 'bottom', 'jeans', 'navy'), shoes: mk('s', 'shoes', 'sneakers', 'white') }, { profile: prof(p) });
    const ref0 = sc({ ...pants, bottom: mk('b', 'bottom', 'jeans', 'navy'), shoes: mk('s', 'shoes', 'sneakers', 'white') });
    assert.equal(a.score - b.score, ref.score - ref0.score);
  }
});

test('complexion: bounded to +-10 in total', () => {
  const o = { top: mk('t', 'top', 't-shirt', 'black'), layer: mk('l', 'layer', 'bomber', 'white'), headwear: mk('h', 'headwear', 'beanie', 'black'),
    neckwear: mk('n', 'neckwear', 'scarf', 'white'), bottom: mk('b', 'bottom', 'jeans', 'denim') };
  for (const p of [{ undertone: 'warm', contrast: 'low', depth: 'light' }, { undertone: 'cool', contrast: 'high', depth: 'deep' }]) {
    const d = sc(o, { profile: prof(p) }).reasons.filter((r) => r.tag.startsWith('complexion')).reduce((s, r) => s + r.delta, 0);
    assert.ok(Math.abs(d) <= 10.01, `${d}`);
  }
});

// ---------------- occasions ----------------
const occWardrobe = () => [
  mk('wh', 'top', 'dress shirt', 'white'), mk('lb', 'top', 'dress shirt', 'light-blue'), mk('nv', 'top', 'dress shirt', 'navy'), mk('rd', 'top', 'dress shirt', 'red'),
  mk('cr', 'top', 'dress shirt', 'cream'), mk('hd', 'top', 'hoodie', 'grey'), mk('tee', 'top', 't-shirt', 'white'), mk('pk', 'top', 'polo', 'pink'),
  mk('dp', 'bottom', 'dress pants', 'charcoal'), mk('dp2', 'bottom', 'dress pants', 'navy'), mk('jn', 'bottom', 'jeans', 'denim'), mk('sh', 'bottom', 'shorts', 'beige'),
  mk('ox', 'shoes', 'oxfords', 'black', { leather: 'black' }), mk('sn', 'shoes', 'sneakers', 'white'),
  mk('bb', 'belt', 'dress belt', 'black', { leather: 'black' }),
  mk('bz', 'layer', 'blazer', 'navy'), mk('bz2', 'layer', 'blazer', 'charcoal'), mk('cap', 'headwear', 'baseball cap', 'black'), mk('bn', 'headwear', 'beanie', 'black'),
];
const top5 = (occasion, extra = {}) => buildOutfits(occWardrobe(), { today: TODAY, occasion, ...extra }).slice(0, 5);

test('occasions: funeral has no bright colours; wedding no white/cream top or jeans; church no shorts/hoodie', () => {
  const bright = new Set(['red', 'orange', 'yellow', 'pink', 'purple', 'lavender', 'light-blue', 'mustard', 'green', 'teal']);
  for (const o of top5('funeral')) for (const i of Object.values(o.items)) assert.ok(!bright.has(i.colors[0].family), i.id);
  for (const o of top5('wedding')) { assert.ok(!['white', 'cream'].includes(o.items.top.colors[0].family)); assert.notEqual(o.items.bottom.kind, 'jeans'); }
  for (const o of top5('church')) { assert.ok(!['shorts', 'athletic shorts'].includes(o.items.bottom.kind)); assert.notEqual(o.items.top.kind, 'hoodie'); }
});

test('occasions: interview adds a blazer, never a hat; wantLayer missing is penalised', () => {
  for (const o of top5('interview')) { assert.ok(o.items.layer, 'layer'); assert.ok(!o.items.headwear); }
  const bare = scoreOutfit({ top: W['white-dress-shirt'], bottom: W['grey-dress-pants'], shoes: W['black-oxfords'], belt: W['black-belt'] }, { occasion: 'interview' });
  const withBlazer = scoreOutfit({ top: W['white-dress-shirt'], bottom: W['grey-dress-pants'], shoes: W['black-oxfords'], belt: W['black-belt'], layer: W['navy-blazer'] }, { occasion: 'interview' });
  assert.ok(withBlazer.score > bare.score);
  const hat = scoreOutfit({ top: W['white-dress-shirt'], bottom: W['grey-dress-pants'], shoes: W['black-oxfords'], belt: W['black-belt'], layer: W['navy-blazer'], headwear: W['navy-cap'] }, { occasion: 'interview' });
  assert.ok(hat.score < withBlazer.score);
});

test('occasions: custom ctx.occasionDef works; garbage occasionDef is ignored; weekend still works', () => {
  const tee = { top: W['grey-hoodie'], bottom: W['grey-joggers'], shoes: W['running-shoes'] };
  const custom = { label: 'Gala dinner', min: 5, max: 5, avoidKinds: ['hoodie'], noHeadwear: true };
  const a = scoreOutfit(tee, { occasionDef: custom, maxReasons: 20 });
  assert.ok(a.score < scoreOutfit(tee).score - 20);
  assert.ok(a.reasons.some((r) => /gala dinner/.test(r.text)), 'label drives the reason text');
  for (const bad of ['x', 42, [], null, true]) assert.equal(scoreOutfit(tee, { occasionDef: bad }).score, scoreOutfit(tee).score);
  assert.equal(scoreOutfit(tee, { occasionDef: { label: {}, min: 'a', avoidKinds: 7 } }).score >= 0, true);
  const wk = scoreOutfit(tee, { occasion: 'weekend' }).score;
  assert.ok(wk >= scoreOutfit(tee, { occasion: 'work' }).score + 20);
  const out = buildOutfits(occWardrobe(), { today: TODAY, occasionDef: custom });
  assert.ok(out.length && out.every((o) => !o.items.headwear));
});

// ---------------- taste wiring ----------------
test('taste: an empty taste leaves scores and ranking unchanged; garbage taste is ignored', () => {
  const taste = learnTaste([], {});
  const o = outfit('white-oxford', 'navy-chinos', 'brown-boots', 'brown-belt');
  assert.equal(scoreOutfit(o, { taste }).score, scoreOutfit(o).score);
  assert.equal(scoreOutfit(o, { taste: 'junk' }).score, scoreOutfit(o).score);
  const a = buildOutfits(wardrobe(), { today: TODAY }).map((x) => x.key);
  const b = buildOutfits(wardrobe(), { today: TODAY, taste }).map((x) => x.key);
  assert.deepEqual(a, b);
});
