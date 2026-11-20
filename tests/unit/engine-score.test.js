import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOutfit } from '../../src/engine/score.js';
import { WEIGHTS } from '../../src/engine/rules.js';
import { makeItem } from '../../src/model.js';
import { W, mk, outfit } from './fixtures/wardrobe.js';

const full = { maxReasons: 50 };
const sc = (items, ctx = {}) => scoreOutfit(items, { ...full, ...ctx });
const tags = (r) => r.reasons.map((x) => x.tag);

test('known-good outfit scores high and explains itself', () => {
  const r = sc(outfit('white-oxford', 'navy-chinos', 'brown-boots', 'brown-belt'));
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.ok(r.reasons.some((x) => x.text === 'Brown belt matches your brown boots.'));
  assert.ok(r.reasons.some((x) => /White and navy: a classic pairing/.test(x.text)));
});

test('plain-but-fine neutral outfit lands in the 72-82 band', () => {
  const r = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers'));
  assert.ok(r.score >= 72 && r.score <= 82, `score ${r.score}`);
});

test('score is an integer in 0..100 and weights table exists', () => {
  const r = scoreOutfit(outfit('white-oxford', 'navy-chinos'));
  assert.ok(Number.isInteger(r.score));
  assert.equal(typeof WEIGHTS.base, 'number');
});

test('reasons: at most 6 by default, sorted by |delta|, unique, friendly sentences', () => {
  const r = scoreOutfit(outfit('white-oxford', 'navy-chinos', 'brown-boots', 'brown-belt', 'navy-blazer'));
  assert.ok(r.reasons.length <= 6);
  for (let i = 1; i < r.reasons.length; i++) assert.ok(Math.abs(r.reasons[i - 1].delta) >= Math.abs(r.reasons[i].delta));
  assert.equal(new Set(r.reasons.map((x) => x.text)).size, r.reasons.length);
  for (const x of r.reasons) {
    assert.ok(x.text.length > 8 && x.text.length < 130, x.text);
    assert.match(x.text, /[.!]$/);
    assert.ok(x.tag && Number.isFinite(x.delta));
  }
});

test('black belt with brown boots is penalised vs matching belt', () => {
  const good = sc(outfit('white-oxford', 'navy-chinos', 'brown-boots', 'brown-belt'));
  const bad = sc(outfit('white-oxford', 'navy-chinos', 'brown-boots', 'black-belt'));
  assert.ok(good.score - bad.score >= 15);
  assert.ok(tags(bad).includes('leather-clash'));
  assert.ok(bad.reasons.find((x) => x.tag === 'leather-clash').delta <= -15);
});

test('brown belt with black oxfords is also a leather clash', () => {
  const bad = sc(outfit('white-oxford', 'grey-dress-pants', 'black-oxfords', 'brown-belt'));
  assert.ok(tags(bad).includes('leather-clash'));
});

test('near-brown leathers get a mild penalty, not a clash', () => {
  const tan = makeItem({ id: 'tan-belt', slot: 'belt', kind: 'leather belt', leather: 'tan', colors: [{ hex: '#b08d57', family: 'beige', weight: 1 }] });
  const r = sc({ ...outfit('white-oxford', 'navy-chinos', 'brown-boots'), belt: tan });
  assert.ok(tags(r).includes('leather-near'));
  assert.ok(!tags(r).includes('leather-clash'));
});

test('canvas belt suits sneakers but is penalised in a dressy outfit', () => {
  const canvas = makeItem({ id: 'cb', slot: 'belt', kind: 'canvas belt', colors: [{ hex: '#5d6136', family: 'olive', weight: 1 }] });
  const casual = sc({ ...outfit('grey-tee', 'beige-chinos', 'white-sneakers'), belt: canvas });
  assert.ok(tags(casual).includes('belt-casual-ok'));
  const dressy = sc({ ...outfit('white-dress-shirt', 'grey-dress-pants', 'black-oxfords', 'navy-blazer'), belt: canvas });
  assert.ok(tags(dressy).includes('belt-casual'));
});

test('missing belt is not penalised for belt-less bottoms (joggers)', () => {
  const joggers = sc({ ...outfit('grey-tee', 'white-sneakers'), bottom: mk('nj', 'bottom', 'joggers', 'navy') }, { beltAvailable: true });
  assert.ok(!tags(joggers).some((t) => t.startsWith('belt')));
  assert.ok(joggers.score >= 72);
  const noBeltJeans = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers'), { beltAvailable: true });
  assert.ok(tags(noBeltJeans).includes('belt-missing'));
  const sameNoCtx = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers'));
  assert.ok(!tags(sameNoCtx).includes('belt-missing'));
});

test('tie with a t-shirt is a hard penalty; tie with oxford is fine', () => {
  const bad = sc(outfit('white-tee', 'dark-jeans', 'white-sneakers', 'navy-tie'));
  assert.ok(tags(bad).includes('tie-no-collar'));
  assert.ok(bad.score < 62);
  const ok = sc(outfit('white-oxford', 'grey-dress-pants', 'black-oxfords', 'navy-tie'));
  assert.ok(!tags(ok).includes('tie-no-collar'));
  assert.ok(ok.score >= 78 && ok.score > bad.score + 25);
});

test('bow tie only at formality 5', () => {
  const bow = makeItem({ id: 'bow', slot: 'neckwear', kind: 'bow tie', colors: [{ hex: '#1c1c1e', family: 'black', weight: 1 }] });
  const casual = sc({ ...outfit('white-oxford', 'navy-chinos', 'brown-boots'), neckwear: bow });
  assert.ok(tags(casual).includes('bowtie-informal'));
});

test('colour clashes score low', () => {
  const red = mk('r', 'top', 'graphic tee', 'red', { pattern: 'graphic' });
  const green = mk('g', 'bottom', 'cargo pants', 'green', { pattern: 'camo' });
  const r = sc({ top: red, bottom: green, shoes: W['white-sneakers'] });
  assert.ok(r.score < 40, `score ${r.score}`);
  assert.ok(tags(r).includes('color-clash'));
});

test('red + green alone is a clear clash; three accents is a clash', () => {
  const a = sc({ top: mk('r', 'top', 't-shirt', 'red'), bottom: mk('g', 'bottom', 'chinos', 'green') });
  assert.ok(tags(a).includes('color-clash'));
  const b = sc({ top: mk('y', 'top', 't-shirt', 'yellow'), bottom: mk('p', 'bottom', 'chinos', 'teal'), layer: mk('o', 'layer', 'bomber', 'orange') });
  assert.ok(tags(b).includes('color-clash'));
});

test('one accent colour with neutrals is rewarded', () => {
  const r = sc({ top: mk('b', 'top', 't-shirt', 'burgundy'), bottom: W['grey-dress-pants'] });
  assert.ok(tags(r).includes('color-accent'));
  assert.ok(sc({ top: mk('b', 'top', 't-shirt', 'burgundy'), bottom: mk('g', 'bottom', 'chinos', 'grey') }).reasons.some((x) => /Burgundy and grey/.test(x.text)));
});

test('two non-neutral accents without a known pairing is risky', () => {
  const r = sc({ top: mk('m', 'top', 't-shirt', 'mustard'), bottom: mk('t', 'bottom', 'chinos', 'teal') });
  assert.ok(tags(r).includes('color-risky'));
});

test('brown and black clothes clash; navy and black is only mild', () => {
  const bb = sc({ top: mk('br', 'top', 'sweater', 'brown'), bottom: W['black-jeans'] });
  const nb = sc({ top: mk('nv', 'top', 'sweater', 'navy'), bottom: W['black-jeans'] });
  assert.ok(tags(bb).includes('color-clash'));
  assert.ok(tags(nb).includes('color-clash-mild'));
  assert.ok(nb.score > bb.score);
});

test('same-shade top and bottom looks muddy; head-to-toe black is fine', () => {
  const muddy = sc({ top: mk('n1', 'top', 'polo', 'navy'), bottom: W['navy-chinos'] });
  assert.ok(tags(muddy).includes('contrast-muddy'));
  const black = sc({ top: W['black-tee'], bottom: W['black-jeans'] });
  assert.ok(!tags(black).includes('contrast-muddy'));
  assert.ok(tags(black).includes('contrast-tonal'));
  const white = sc({ top: W['white-tee'], bottom: mk('wj', 'bottom', 'jeans', 'white') });
  assert.ok(!tags(white).includes('contrast-muddy'));
});

test('denim on denim: same wash is muddy, different wash is only mildly penalised', () => {
  const light = makeItem({ id: 'lj', slot: 'top', kind: 'button-down', colors: [{ hex: '#8fa8c8', family: 'denim', weight: 1 }] });
  const dark = makeItem({ id: 'dj', slot: 'bottom', kind: 'jeans', colors: [{ hex: '#27354f', family: 'denim', weight: 1 }] });
  const same = makeItem({ id: 'sj', slot: 'top', kind: 'button-down', colors: [{ hex: '#4a6286', family: 'denim', weight: 1 }] });
  const diff = sc({ top: light, bottom: dark });
  const flat = sc({ top: same, bottom: W['dark-jeans'] });
  assert.ok(tags(diff).includes('contrast-denim'));
  assert.ok(tags(flat).includes('contrast-muddy'));
  assert.ok(diff.score > flat.score);
});

test('two busy patterns clash; one pattern is fine; stripe + stripe is risky', () => {
  const plaid = W['plaid-flannel'];
  const floral = mk('fl', 'bottom', 'chinos', 'beige', { pattern: 'floral' });
  assert.ok(tags(sc({ top: plaid, bottom: floral })).includes('pattern-busy'));
  assert.ok(!tags(sc({ top: plaid, bottom: W['dark-jeans'] })).includes('pattern-busy'));
  const stripedPants = mk('sp', 'bottom', 'chinos', 'grey', { pattern: 'stripe' });
  assert.ok(tags(sc({ top: W['breton-tee'], bottom: stripedPants })).includes('pattern-risky'));
});

test('a patterned tie is fine against a striped shirt', () => {
  const tie = mk('pt', 'neckwear', 'tie', 'burgundy', { pattern: 'stripe' });
  const shirt = mk('ss', 'top', 'dress shirt', 'white', { pattern: 'stripe' });
  const r = sc({ top: shirt, bottom: W['grey-dress-pants'], shoes: W['black-oxfords'], neckwear: tie });
  assert.ok(!tags(r).includes('pattern-risky'));
});

test('more than one statement piece is penalised', () => {
  const r = sc({ top: W['plaid-flannel'], bottom: mk('y', 'bottom', 'chinos', 'yellow') });
  assert.ok(tags(r).includes('statement-many'));
});

test('graphic tee only works casually', () => {
  const casual = sc(outfit('graphic-tee', 'dark-jeans', 'white-sneakers'));
  const dressy = sc(outfit('graphic-tee', 'grey-dress-pants', 'black-oxfords'));
  assert.ok(!tags(casual).includes('pattern-graphic'));
  assert.ok(tags(dressy).includes('pattern-graphic'));
});

test('formality: dress shirt with joggers and puffer over a tie are heavily penalised', () => {
  const a = sc(outfit('white-dress-shirt', 'grey-joggers', 'white-sneakers'));
  assert.ok(tags(a).includes('formality-clash'));
  assert.ok(a.reasons.find((x) => x.tag === 'formality-clash').delta <= -15);
  const b = sc(outfit('white-dress-shirt', 'grey-dress-pants', 'black-oxfords', 'navy-tie', 'black-puffer'));
  assert.ok(tags(b).includes('formality-clash'));
  assert.ok(a.score < 65);
});

test('occasion window: sneakers + tee are off for work, fine for the weekend', () => {
  const o = outfit('grey-tee', 'dark-jeans', 'white-sneakers');
  const work = sc(o, { occasion: 'work' });
  const weekend = sc(o, { occasion: 'weekend' });
  assert.ok(tags(work).includes('occasion-off'));
  assert.ok(tags(weekend).includes('occasion-ok'));
  assert.ok(weekend.score > work.score + 10);
});

test('caps and beanies are penalised with business-level items', () => {
  const r = sc(outfit('white-dress-shirt', 'grey-dress-pants', 'black-oxfords', 'navy-cap'));
  assert.ok(tags(r).includes('hat-casual'));
  const fedora = mk('fed', 'headwear', 'fedora', 'brown');
  assert.ok(tags(sc({ ...outfit('grey-tee', 'dark-jeans', 'white-sneakers'), headwear: fedora })).includes('hat-mismatch'));
});

test('running shoes with dress pants or a blazer are penalised', () => {
  const r = sc(outfit('white-oxford', 'grey-dress-pants', 'running-shoes'));
  assert.ok(tags(r).includes('shoes-sporty'));
  const r2 = sc(outfit('white-tee', 'dark-jeans', 'running-shoes', 'navy-blazer'));
  assert.ok(tags(r2).includes('shoes-sporty'));
});

test('oxfords + jeans + tee is a small penalty; with a blazer it is good', () => {
  assert.ok(tags(sc(outfit('white-tee', 'dark-jeans', 'black-oxfords'))).includes('shoes-oxford-jeans'));
  assert.ok(tags(sc(outfit('white-tee', 'dark-jeans', 'black-oxfords', 'navy-blazer'))).includes('shoes-oxford-jeans-ok'));
});

test('shorts with a blazer or boots are penalised', () => {
  assert.ok(tags(sc(outfit('white-tee', 'beige-shorts', 'white-sneakers', 'navy-blazer'))).includes('shorts-dressy'));
  assert.ok(tags(sc(outfit('white-tee', 'beige-shorts', 'brown-boots'))).includes('shorts-boots'));
});

test('weather: cold wants a layer, hot likes shorts, mismatch is proportional', () => {
  const noLayer = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers'), { weather: 'freezing' });
  const puffer = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers', 'black-puffer'), { weather: 'freezing' });
  assert.ok(puffer.score > noLayer.score + 10);
  const cold = sc(outfit('grey-tee', 'dark-jeans', 'white-sneakers'), { weather: 'cold' });
  assert.ok(noLayer.score <= cold.score);
  const hotShorts = sc(outfit('white-tee', 'beige-shorts', 'white-sneakers'), { weather: 'hot' });
  const hotPuffer = sc(outfit('white-tee', 'dark-jeans', 'white-sneakers', 'black-puffer'), { weather: 'hot' });
  assert.ok(tags(hotShorts).includes('weather-shorts'));
  assert.ok(hotShorts.score > hotPuffer.score + 15);
  const scarfBeanie = sc(outfit('grey-hoodie', 'dark-jeans', 'white-sneakers', 'black-puffer', 'grey-scarf', 'black-beanie'), { weather: 'freezing' });
  assert.ok(tags(scarfBeanie).includes('weather-accessory'));
});

test('weather is ignored when not set', () => {
  const o = outfit('grey-tee', 'dark-jeans', 'white-sneakers');
  assert.equal(sc(o).score, sc(o, { weather: null }).score);
  assert.ok(!tags(sc(o)).some((t) => t.startsWith('weather')));
  assert.ok(!tags(sc(o, { weather: 'not-a-bucket' })).some((t) => t.startsWith('weather')));
});

test('rain: rain jacket is rewarded, suede shoes penalised', () => {
  const o = outfit('grey-tee', 'dark-jeans', 'white-sneakers');
  const dry = sc(o);
  const wet = sc(o, { rain: true });
  const wetJacket = sc({ ...o, layer: W['rain-jacket'] }, { rain: true });
  assert.ok(wetJacket.score > wet.score + 8);
  assert.ok(wet.score <= dry.score);
  const suede = mk('sue', 'shoes', 'boots', 'brown', { material: 'suede', leather: 'tan' });
  assert.ok(tags(sc({ ...o, shoes: suede }, { rain: true })).includes('rain-suede'));
  assert.ok(!tags(sc({ ...o, shoes: suede })).includes('rain-suede'));
});

test('feedback: liked / disliked outfits and pairs move the score', () => {
  const o = outfit('grey-tee', 'dark-jeans', 'white-sneakers');
  const key = Object.values(o).map((i) => i.id).sort().join('|');
  const base = sc(o).score;
  const liked = sc(o, { feedback: { liked: new Set([key]), disliked: new Set() } });
  const disliked = sc(o, { feedback: { liked: new Set(), disliked: new Set([key]) } });
  assert.ok(liked.score > base);
  assert.ok(disliked.score < base - 15);
  const pk = ['dark-jeans', 'grey-tee'].sort().join('|');
  const likedPair = sc(o, { feedback: { liked: new Set([pk]), disliked: new Set() } });
  const dislikedPair = sc(o, { feedback: { liked: new Set(), disliked: new Set([pk]) } });
  assert.ok(likedPair.score >= base && dislikedPair.score < base);
  assert.ok(disliked.score < dislikedPair.score);
  assert.ok(tags(likedPair).includes('feedback-pair-liked'));
});

test('order independence: slot insertion order and feedback order do not matter', () => {
  const a = { top: W['white-oxford'], bottom: W['navy-chinos'], shoes: W['brown-boots'], belt: W['brown-belt'], layer: W['navy-blazer'] };
  const b = { layer: W['navy-blazer'], belt: W['brown-belt'], shoes: W['brown-boots'], bottom: W['navy-chinos'], top: W['white-oxford'] };
  assert.deepEqual(sc(a), sc(b));
  assert.deepEqual(sc(a, { weather: 'mild', occasion: 'work' }), sc(b, { weather: 'mild', occasion: 'work' }));
});

test('garbage input never throws, never NaN, always 0..100', () => {
  const weird = [
    {}, null, undefined, { top: null }, { top: {}, bottom: {} }, { top: { colors: [] }, bottom: { colors: null } },
    { top: { formality: 99, warmth: -4, colors: [{ family: 'plaid-purple', hex: 'zzz', weight: NaN }], pattern: 42 }, bottom: { formality: NaN, kind: 5, name: null } },
    { top: W['white-oxford'], bottom: W['navy-chinos'], belt: { kind: 'x' }, shoes: { material: 'leather' }, layer: { formality: 99 }, neckwear: { kind: 'tie' } },
    { top: 'nope', bottom: 7 },
  ];
  for (const w of weird) {
    for (const ctx of [undefined, null, {}, { weather: 'hot', rain: true, occasion: 'work', feedback: { liked: [], disliked: new Set() } }, { occasion: 'bogus', weather: 'bogus' }]) {
      const r = scoreOutfit(w, ctx);
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100, JSON.stringify(r.score));
      for (const x of r.reasons) assert.ok(Number.isFinite(x.delta) && typeof x.text === 'string');
    }
  }
});

test('extreme stacks of penalties stay inside 0..100', () => {
  const r = sc({ top: mk('r', 'top', 'graphic tee', 'red', { pattern: 'graphic' }), bottom: mk('g', 'bottom', 'joggers', 'green', { pattern: 'camo' }),
    layer: mk('o', 'layer', 'suit jacket', 'orange', { pattern: 'plaid' }), neckwear: mk('t', 'neckwear', 'bow tie', 'purple', { pattern: 'floral' }),
    headwear: W['black-beanie'], shoes: W['running-shoes'], belt: W['black-belt'] }, { weather: 'hot', rain: true, occasion: 'formal' });
  assert.ok(r.score >= 0 && r.score < 10, `score ${r.score}`);
});
