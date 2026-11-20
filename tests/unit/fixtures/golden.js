// Fashion golden set, authored independently of the engine's rule weights.
// Each case is a pair of outfits where a reasonable stylist would clearly prefer `better` over `worse`.
// The engine must rank them correctly: scoreOutfit(better, ctx).score > scoreOutfit(worse, ctx).score.
// Cases intentionally change as little as possible between the two outfits, so each one isolates a single idea.

import { makeItem } from '../../../src/model.js';

const C = {
  navy: '#1f2a44', white: '#f5f5f2', grey: '#8e9196', charcoal: '#3a3d42', black: '#1c1c1e',
  beige: '#d8c3a0', brown: '#6b4a2f', olive: '#5d6136', denim: '#4a6286', 'light-blue': '#9cc3e6',
  burgundy: '#6d1f2f', red: '#d13b3b', green: '#2e8b4a', orange: '#e8742a', purple: '#6c4ab6',
  yellow: '#f2c94c', pink: '#f2a7bb', cream: '#efe6d2', rust: '#a4502a', mustard: '#c99a2e',
};
const col = (family) => [{ hex: C[family], family, weight: 1 }];
let n = 0;
const it = (slot, kind, family, extra = {}) =>
  makeItem({ id: `g${++n}`, slot, kind, colors: col(family), ...extra });

// Reusable pieces
const whiteOxford = it('top', 'oxford', 'white');
const lbOxford = it('top', 'oxford', 'light-blue');
const navyTee = it('top', 't-shirt', 'navy');
const whiteTee = it('top', 't-shirt', 'white');
const greyTee = it('top', 't-shirt', 'grey');
const blackTee = it('top', 't-shirt', 'black');
const redTee = it('top', 't-shirt', 'red');
const orangeTee = it('top', 't-shirt', 'orange');
const plaidFlannel = it('top', 'flannel', 'red', { pattern: 'plaid' });
const stripeShirt = it('top', 'button-down', 'light-blue', { pattern: 'stripe' });
const floralShirt = it('top', 'button-down', 'pink', { pattern: 'floral' });
const dressShirt = it('top', 'dress shirt', 'white');
const navySweater = it('top', 'sweater', 'navy');
const graphicTee = it('top', 'graphic tee', 'black', { pattern: 'graphic' });

const beigeChinos = it('bottom', 'chinos', 'beige');
const navyChinos = it('bottom', 'chinos', 'navy');
const greenChinos = it('bottom', 'chinos', 'green');
const purpleChinos = it('bottom', 'chinos', 'purple');
const darkJeans = it('bottom', 'jeans', 'denim');
const blackJeans = it('bottom', 'jeans', 'black');
const greyTrousers = it('bottom', 'dress pants', 'grey');
const charcoalTrousers = it('bottom', 'dress pants', 'charcoal');
const camoCargo = it('bottom', 'cargo pants', 'olive', { pattern: 'camo' });
const navyJoggers = it('bottom', 'joggers', 'navy');
const beigeShorts = it('bottom', 'shorts', 'beige');

const brownBelt = it('belt', 'leather belt', 'brown', { leather: 'brown' });
const blackBelt = it('belt', 'leather belt', 'black', { leather: 'black' });
const blackDressBelt = it('belt', 'dress belt', 'black', { leather: 'black' });
const canvasBelt = it('belt', 'canvas belt', 'navy');

const brownBoots = it('shoes', 'boots', 'brown', { leather: 'brown' });
const brownLoafers = it('shoes', 'loafers', 'brown', { leather: 'brown' });
const blackDerbies = it('shoes', 'derbies', 'black', { leather: 'black' });
const blackOxfords = it('shoes', 'oxfords', 'black', { leather: 'black' });
const whiteSneakers = it('shoes', 'sneakers', 'white');
const runners = it('shoes', 'running shoes', 'grey');
const sandals = it('shoes', 'sandals', 'brown');
const suedeBoots = it('shoes', 'chelsea boots', 'beige', { material: 'suede', leather: 'tan' });

const navyBlazer = it('layer', 'blazer', 'navy');
const denimJacket = it('layer', 'denim jacket', 'denim');
const puffer = it('layer', 'puffer', 'black');
const rainJacket = it('layer', 'rain jacket', 'olive');
const overcoat = it('layer', 'overcoat', 'charcoal');

const navyTie = it('neckwear', 'tie', 'navy');
const burgundyTie = it('neckwear', 'tie', 'burgundy');
const plaidTie = it('neckwear', 'tie', 'green', { pattern: 'plaid' });
const cap = it('headwear', 'baseball cap', 'navy');
const beanie = it('headwear', 'beanie', 'grey');

export const GOLDEN = [
  // ---- Colour
  { why: 'navy + beige is a classic; navy + black reads as a mistake',
    better: { top: navyTee, bottom: beigeChinos, shoes: whiteSneakers },
    worse:  { top: navyTee, bottom: blackJeans, shoes: whiteSneakers } },
  { why: 'one accent colour beats two loud brights',
    better: { top: redTee, bottom: darkJeans, shoes: whiteSneakers },
    worse:  { top: redTee, bottom: greenChinos, shoes: whiteSneakers } },
  { why: 'orange + purple clashes; orange + denim works',
    better: { top: orangeTee, bottom: darkJeans, shoes: whiteSneakers },
    worse:  { top: orangeTee, bottom: purpleChinos, shoes: whiteSneakers } },
  { why: 'light top over dark bottom is the safe classic vs muddy same-tone',
    better: { top: whiteOxford, bottom: navyChinos, belt: brownBelt, shoes: brownLoafers },
    worse:  { top: it('top', 'oxford', 'navy'), bottom: navyChinos, belt: brownBelt, shoes: brownLoafers } },
  { why: 'grey tee + jeans beats grey tee + grey chino-ish trousers of the same tone',
    better: { top: greyTee, bottom: darkJeans, belt: brownBelt, shoes: whiteSneakers },
    worse:  { top: greyTee, bottom: it('bottom', 'chinos', 'grey'), belt: brownBelt, shoes: whiteSneakers } },
  { why: 'all-black tonal outfit is a legit look, better than black + brown leathers',
    better: { top: blackTee, bottom: blackJeans, belt: blackBelt, shoes: blackDerbies },
    worse:  { top: blackTee, bottom: blackJeans, belt: brownBelt, shoes: blackDerbies } },

  // ---- Leather
  { why: 'belt should match shoe leather (brown/brown)',
    better: { top: whiteOxford, bottom: beigeChinos, belt: brownBelt, shoes: brownBoots },
    worse:  { top: whiteOxford, bottom: beigeChinos, belt: blackBelt, shoes: brownBoots } },
  { why: 'belt should match shoe leather (black/black)',
    better: { top: dressShirt, bottom: charcoalTrousers, belt: blackDressBelt, shoes: blackOxfords },
    worse:  { top: dressShirt, bottom: charcoalTrousers, belt: brownBelt, shoes: blackOxfords } },
  { why: 'canvas belt suits sneakers + shorts better than a formal dress belt',
    better: { top: navyTee, bottom: beigeShorts, belt: canvasBelt, shoes: whiteSneakers },
    worse:  { top: navyTee, bottom: beigeShorts, belt: blackDressBelt, shoes: whiteSneakers } },

  // ---- Belt rules (user requirement): no loops => no belt, and no penalty for lacking one
  { why: 'joggers without a belt must not be penalised vs jeans without a belt (same everything else)',
    tie: true, // scores should be close: |diff| <= 12
    better: { top: greyTee, bottom: navyJoggers, shoes: whiteSneakers },
    worse:  { top: greyTee, bottom: darkJeans, shoes: whiteSneakers } },

  // ---- Pattern
  { why: 'one pattern + solids beats two busy patterns',
    better: { top: plaidFlannel, bottom: darkJeans, belt: brownBelt, shoes: brownBoots },
    worse:  { top: plaidFlannel, bottom: camoCargo, belt: brownBelt, shoes: brownBoots } },
  { why: 'floral shirt is a statement; pair it with solids, not a plaid tie',
    better: { top: floralShirt, bottom: beigeChinos, belt: brownBelt, shoes: brownLoafers },
    worse:  { top: floralShirt, bottom: beigeChinos, belt: brownBelt, shoes: brownLoafers, neckwear: plaidTie } },
  { why: 'striped shirt with a solid tie beats a striped shirt with a plaid tie',
    better: { top: stripeShirt, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies, neckwear: navyTie },
    worse:  { top: stripeShirt, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies, neckwear: plaidTie } },

  // ---- Formality
  { why: 'dress shirt + tie with trousers, not with joggers',
    better: { top: dressShirt, neckwear: burgundyTie, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies },
    worse:  { top: dressShirt, neckwear: burgundyTie, bottom: navyJoggers, shoes: blackDerbies } },
  { why: 'a tie with a t-shirt is wrong; skip the tie',
    better: { top: whiteTee, bottom: darkJeans, belt: brownBelt, shoes: whiteSneakers },
    worse:  { top: whiteTee, bottom: darkJeans, belt: brownBelt, shoes: whiteSneakers, neckwear: navyTie } },
  { why: 'blazer over oxford + chinos beats blazer over joggers',
    better: { layer: navyBlazer, top: whiteOxford, bottom: beigeChinos, belt: brownBelt, shoes: brownLoafers },
    worse:  { layer: navyBlazer, top: whiteOxford, bottom: navyJoggers, shoes: brownLoafers } },
  { why: 'running shoes ruin dress trousers; derbies fit',
    better: { top: lbOxford, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies },
    worse:  { top: lbOxford, bottom: greyTrousers, belt: blackBelt, shoes: runners } },
  { why: 'baseball cap does not go with blazer + tie',
    better: { layer: navyBlazer, top: dressShirt, neckwear: burgundyTie, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies },
    worse:  { layer: navyBlazer, top: dressShirt, neckwear: burgundyTie, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies, headwear: cap } },
  { why: 'puffer over a suit-and-tie look is worse than an overcoat (cold)',
    ctx: { weather: 'cold' },
    better: { layer: overcoat, top: dressShirt, neckwear: navyTie, bottom: charcoalTrousers, belt: blackBelt, shoes: blackOxfords },
    worse:  { layer: puffer, top: dressShirt, neckwear: navyTie, bottom: charcoalTrousers, belt: blackBelt, shoes: blackOxfords } },
  { why: 'shorts + boots + blazer is a mess; shorts + sneakers is summer',
    better: { top: navyTee, bottom: beigeShorts, belt: canvasBelt, shoes: whiteSneakers },
    worse:  { layer: navyBlazer, top: navyTee, bottom: beigeShorts, belt: canvasBelt, shoes: brownBoots } },
  { why: 'graphic tee is casual: works with jeans, not with dress trousers + oxfords',
    better: { top: graphicTee, bottom: darkJeans, belt: blackBelt, shoes: whiteSneakers },
    worse:  { top: graphicTee, bottom: charcoalTrousers, belt: blackDressBelt, shoes: blackOxfords } },

  // ---- Occasion
  { why: 'at work, oxford + chinos beats tee + jeans',
    ctx: { occasion: 'work' },
    better: { top: lbOxford, bottom: navyChinos, belt: brownBelt, shoes: brownLoafers },
    worse:  { top: graphicTee, bottom: darkJeans, belt: brownBelt, shoes: whiteSneakers } },
  { why: 'lounging: joggers + tee beats a suit',
    ctx: { occasion: 'lounge' },
    better: { top: greyTee, bottom: navyJoggers, shoes: whiteSneakers },
    worse:  { layer: navyBlazer, top: dressShirt, neckwear: navyTie, bottom: charcoalTrousers, belt: blackDressBelt, shoes: blackOxfords } },

  // ---- Weather
  { why: 'freezing: a layer + beanie beats a bare tee',
    ctx: { weather: 'freezing' },
    better: { layer: puffer, top: navySweater, bottom: darkJeans, belt: brownBelt, shoes: brownBoots, headwear: beanie },
    worse:  { top: whiteTee, bottom: darkJeans, belt: brownBelt, shoes: brownBoots } },
  { why: 'hot: shorts + tee beats sweater + puffer',
    ctx: { weather: 'hot' },
    better: { top: whiteTee, bottom: beigeShorts, belt: canvasBelt, shoes: whiteSneakers },
    worse:  { layer: puffer, top: navySweater, bottom: darkJeans, belt: brownBelt, shoes: brownBoots } },
  { why: 'rain: rain jacket + leather boots beats suede boots and no jacket',
    ctx: { weather: 'mild', rain: true },
    better: { layer: rainJacket, top: greyTee, bottom: darkJeans, belt: brownBelt, shoes: brownBoots },
    worse:  { top: greyTee, bottom: darkJeans, belt: brownBelt, shoes: suedeBoots } },
  { why: 'sandals with dress trousers in the cold is wrong',
    ctx: { weather: 'cold' },
    better: { layer: overcoat, top: navySweater, bottom: greyTrousers, belt: blackBelt, shoes: blackDerbies },
    worse:  { layer: overcoat, top: navySweater, bottom: greyTrousers, belt: blackBelt, shoes: sandals } },
];
