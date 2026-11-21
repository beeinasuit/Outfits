// Roast mode (pure, templated, on-device; no AI). Turns the REAL problems found by scoreOutfit into sharp but clean jokes
// about the clothes (never the person). Every line is keyed off a reason's stable `tag`, so nothing is invented:
// no problem reason, no joke about it. Deterministic for a given seed (use the check id).
//
//   roastOutfit(items, { score, reasons, swap }, ctx, { seed }) -> { level, headline, lines, fix, groups, text }
//     level: 'none' (>= ROAST_LIGHT_BELOW) | 'light' (ROAST_FULL_BELOW..) | 'full' (< ROAST_FULL_BELOW)
//     swap:  best single swap { slot, cur, delta, row:{ item, score } } (or { item, delta }); drives the closing "rescue" line.
export const ROAST_FULL_BELOW = 55;
export const ROAST_LIGHT_BELOW = 70;

// tag -> problem group
const GROUP_OF = {
  'color-clash': 'colorClash', 'color-risky': 'colorClash', 'color-clash-mild': 'colorClash',
  'contrast-muddy': 'muddy', 'contrast-denim': 'muddy',
  'pattern-busy': 'pattern', 'pattern-risky': 'pattern', 'statement-many': 'pattern', 'pattern-graphic': 'graphic',
  'formality-clash': 'formality', 'formality-gap': 'formality', 'formality-shoes': 'formality', 'shoes-sporty': 'formality', 'shoes-oxford-jeans': 'formality',
  'shoes-sandals-formal': 'formality', 'shorts-dressy': 'formality',
  'weather-cold': 'cold', 'weather-shorts-cold': 'cold', 'weather-footwear': 'cold', 'weather-nolayer': 'cold',
  'weather-hot': 'hot', 'weather-accessory-hot': 'hot',
  'rain-none': 'rain', 'rain-suede': 'rain',
  'shoes-heavy-sandals': 'mixedSeason', 'shorts-heavy': 'mixedSeason', 'shorts-boots': 'mixedSeason',
  'occasion-avoid': 'occasion', 'occasion-off': 'occasion', 'occasion-avoid-color': 'occasion', 'occasion-muted': 'occasion', 'occasion-layer': 'occasion', 'occasion-hat': 'occasion',
  'leather-clash': 'leather', 'leather-near': 'leather', 'belt-formality': 'beltFormality', 'belt-casual': 'beltFormality', 'belt-no-loops': 'beltLoops', 'belt-missing': 'beltMissing',
  'tie-no-collar': 'neck', 'bowtie-informal': 'neck', 'tie-too-casual': 'neck', 'hat-mismatch': 'neck', 'hat-casual': 'neck',
  'complexion-off': 'complexion',
  'recently-worn': 'repeat',
  'feedback-disliked': 'disliked', 'feedback-pair-disliked': 'disliked',
};

// Tokens: {a} {b} colors, {top} {bottom} {shoes} item names (lowercase), {X}/{x} the piece a reason is about, {fam} its color,
// {hi}/{lo} dressiest / most casual piece, {p1}/{p2} patterned pieces, {occ} occasion, {w} weather, {P1}/{A}/... capitalized forms.
export const GROUP_TAGS = GROUP_OF;
export const TEMPLATES = {
  colorClash: [
    '{A} and {b} in one outfit? That’s not a color story, that’s a custody battle.',
    '{A} next to {b}: your clothes are fighting and nobody’s refereeing.',
    'A traffic accident between {a} and {b}, and you wore it on purpose.',
    '{A} and {b} are shouting over each other. Pick a lane.',
    '{A} and {b} have never met before, and it shows.',
    'Somewhere a color wheel is filing a complaint about {a} plus {b}.',
    '{A} with {b}: bold, sure. Good, no.',
  ],
  muddy: [
    '{Top} and {bottom} are the same shade of nothing. It’s an outfit-shaped blur.',
    '{Top} and {bottom} blend together like they’re trying to avoid being noticed.',
    '{Top} over {bottom}: so little contrast I assumed it was one very long garment.',
    'Matching {top} to {bottom} this closely isn’t style, it’s camouflage.',
    '{Top} and {bottom} melted into one puddle of sameness.',
    'Contrast called in sick today. {Top} and {bottom} never showed up as two things.',
  ],
  pattern: [
    '{P1} and {p2} are both screaming for attention. Neither is winning.',
    'Two patterns, zero chill: {p1} versus {p2}.',
    '{P1} plus {p2} looks like a wallpaper store had a minor accident.',
    'Your eyes called. They’d like a break from {p1} and {p2}.',
    'Pattern on pattern, and not the cool way. {P1}, meet {p2}, please stop.',
    '{P1} with {p2}: that’s not mixing patterns, that’s a hostage situation.',
  ],
  graphic: [
    '{X} is a casual-hour piece and the rest of this outfit is not.',
    '{X} is doing a lot of talking in an outfit that didn’t ask.',
    'Nobody asked {x} to join the dressier half of this outfit. It came anyway.',
    '{X} is the loudest thing in the room, and the room is trying to be classy.',
    'The graphic on {x} is fighting everything around it.',
    '{X} walked into the wrong dress code and stayed for the whole night.',
  ],
  formality: [
    '{Hi} with {lo}? You dressed for two different events and attended both.',
    '{Hi} and {lo} don’t belong at the same party, let alone in the same outfit.',
    '{Hi} and {lo} walked in together and the whole room felt the tension.',
    '{Hi} is dressed for a wedding and {lo} is dressed for a nap.',
    '{Hi} with {lo}: the outfit equivalent of a tuxedo T-shirt.',
    'Somewhere between {hi} and {lo}, the plan fell apart.',
  ],
  cold: [
    'The forecast says {w} and you dressed like it’s a rumor.',
    'Dressed for {w} weather? Bold. This outfit has clearly never been outside.',
    'This outfit is brave and the weather is going to make you pay for it.',
    '{W} weather will find every gap in this outfit. Enjoy.',
    'This is an outfit for a warm room that doesn’t exist today.',
    'Your sweater drawer is filing a missing-persons report on today’s outfit.',
  ],
  hot: [
    'It’s {w} out and this outfit is a slow-cooker with sleeves.',
    '{W} weather and you chose heat retention. Respect the commitment, question the plan.',
    'This outfit looks great for a sauna. You are not going to a sauna.',
    'Wearing this in {w} weather is a cry for shade.',
    'This outfit forgot to check the temperature. It’ll find out by lunch.',
    'The sun is looking at this outfit like it’s dinner.',
  ],
  rain: [
    'Wet day, no rain jacket. Optimism is a look, I guess.',
    'The sky has plans and this outfit did not read them.',
    'This outfit will not survive a drizzle, and neither will your mood.',
    'Dry-clean-only energy on a rainy day. Brave.',
    'Puddles are going to have opinions about this outfit.',
    'You and an umbrella: a story you hope not to tell today.',
  ],
  mixedSeason: [
    'Pick a season. This outfit is wearing all of them at once.',
    'Half of this outfit is packed for the beach and half for a blizzard.',
    'This outfit has a split personality and the forecast doesn’t know which half to believe.',
    'This is what happens when you get dressed in the dark in four different months.',
    'Mixed signals, and they’re all coming from your wardrobe.',
    'The pieces in this outfit come from different calendars.',
  ],
  occasion: [
    '{X} for {occ}? Bold of you.',
    'Nobody has ever shown up for {occ} in {x} and thought “nailed it.”',
    'I’ve seen the dress code for {occ}. {X} didn’t get the memo.',
    'For {occ}, {x} is a lovely surprise. Nobody wanted that surprise.',
    '{X} is a lot of look for {occ}, and not the good kind of lot.',
    'If {occ} had a bouncer, {x} would be waiting outside.',
  ],
  leather: [
    'Belt and shoes are both leather and they disagree about the shade.',
    'Your belt and shoes are so close and yet so wrong. Almost-matching is worse than not matching.',
    'Somewhere a leather-matching rule is weeping softly over your belt and shoes.',
    'Belt and shoes: two kinds of leather having an argument at your feet and waist.',
    'Those two leathers look like cousins who don’t speak at family dinners.',
    'Your belt and shoes are doing their own thing, and it isn’t working.',
  ],
  beltMissing: [
    'Belt loops with no belt. Those loops are just decorative at this point.',
    'You own a belt and those pants have loops. The belt is waiting by the door.',
    'The loops on {bottom} are begging for a belt. They’re loops with no purpose.',
    'A belt would finish this. Instead, your loops are unemployed.',
    'Belt loops, no belt: the outfit equivalent of a sentence with no period.',
    'Your belt feels left out, and so do your loops.',
  ],
  beltLoops: [
    'A belt with pants that have no belt loops. That belt has nothing to hold on to.',
    'That belt is performing a job that doesn’t exist on those pants.',
    'No loops, yet a belt. Bold form of accessorizing.',
    'The belt is a nice touch, if the pants had anywhere to put it.',
    'A belt on loopless pants is just a very optimistic strap.',
    'Those pants never asked for a belt, and the belt knows it.',
  ],
  beltFormality: [
    'That belt is from a different dress code than the rest of the outfit.',
    'Your belt and the rest of the outfit aren’t dressed for the same day.',
    'The belt thinks it’s at one event and everything else thinks it’s at another.',
    'That belt is either too fancy or too casual, and both are wrong.',
    'Belt formality mismatch: small accessory, big announcement.',
    'Your belt didn’t get the memo about today’s dress level.',
  ],
  neck: [
    '{X} and this outfit are not on speaking terms.',
    'Somebody told {x} it was invited. It was not.',
    '{X} is trying very hard in an outfit that stopped trying.',
    'The mismatch between {x} and everything else is, frankly, a lot.',
    'You added {x} like it was going to help. It had other plans.',
    '{X} is the one guest who showed up to the wrong party.',
  ],
  complexion: [
    'That {fam} is draining you like a vampire with a coupon.',
    '{X} is a lovely {fam}. On a hanger. Far from you.',
    '{Fam} is not your color today, and {x} knows it. So does the mirror.',
    'Of all the colors on the wheel, you picked the {fam} that makes your whole look go quiet.',
    'Your palette filed a formal complaint about {x}.',
    '{X} in {fam}: bold choice, if the goal was to disappear into the background.',
  ],
  repeat: [
    'You’ve worn some of this lately. Your clothes called a union meeting.',
    'Rotation matters. Some of this outfit is on its third lap.',
    'The pieces here are asking for a day off.',
    'I recognize this outfit from somewhere. Probably the last few days.',
    'Outfit repeats: a bold form of commitment, and a bad one.',
    'Some of this is wearing out its welcome in your lineup.',
  ],
  disliked: [
    'You already voted this combo down once. Past you had taste.',
    'You said no to this combo before. Present you has amnesia.',
    'This pairing is on your own naughty list. You wore it anyway.',
    'Your own taste notes warned you about this one.',
    'You’ve rejected this exact vibe before. Rebel behavior, wrong rebellion.',
    'Past you gave this combo a thumbs down. Past you was right.',
  ],
  generic: [
    '“{R}” Noted. Loudly.',
    'The scorecard says: {r}. I’m just the messenger.',
    'Item on the report card: {r}. Not great.',
    'Here’s what lost you points: {r}.',
    'I’d dodge the point, but: {r}.',
    'Filed under “could be better”: {r}.',
  ],
};

export const HEADLINES = {
  low: [ // < 25
    'Fashion emergency. Please step away from the mirror.',
    'This isn’t an outfit, it’s a cry for help.',
    'Call a stylist. Call two.',
    'Someone dressed you from a lost-and-found bin and I think it was you.',
  ],
  mid: [ // 25-39
    'Bless your heart. And your closet.',
    'That’s a lot of effort for this result.',
    'The mirror is being very polite right now.',
    'Bold. Brave. Wrong, but brave.',
  ],
  high: [ // 40-54
    'Not your finest hour. Let’s talk.',
    'We’ve seen better. We’ve seen you do better.',
    'Almost an outfit. Almost.',
    'You tried. The result is a conversation starter, and not a nice one.',
  ],
  light: [ // 55-69
    'Not bad. Not good either.',
    'So close and yet so… medium.',
    'A solid “fine.” Barely.',
    'Passable. Your closet can do better.',
  ],
};
export const LIGHT_PREFIX = ['Tiny roast:', 'Gentle jab:', 'One small thing:', 'Okay, I have to say it:', 'Friendly heads-up:', 'Respectfully:'];
export const FIX_TEMPLATES = [
  'Salvation exists: {action}. +{d}.',
  'Rescue mission: {action} and watch the score climb +{d}.',
  'Your closet has the fix: {action}. That’s +{d} points.',
  'Plot twist: {action}. +{d} and suddenly we’re friends.',
  'Emergency repair: {action}. +{d}.',
  'Fine, there’s a way out: {action} (+{d}). You’re welcome.',
];
export const NO_FIX_TEMPLATES = [
  'I checked every swap in your closet and none of them rescues this one. Tomorrow’s a new day.',
  'Even your closet can’t fix this piece by piece. Start fresh tomorrow.',
  'No single swap saves it. Burn it down and rebuild tomorrow.',
];

// ---------- helpers ----------
function seedRng(seed) {
  let h = 1779033703 ^ String(seed ?? 'roast').length;
  for (const c of String(seed ?? 'roast')) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lc = (s) => String(s || '').toLowerCase();
const capIt = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pretty = (f) => String(f || '').replace('-', ' ');

/** Sentence-ready occasion phrases ("for a wedding", "for work"). Custom occasions become "your <label>". */
export const OCC_PHRASE = {
  lounge: 'a lazy day at home', casual: 'a casual day', weekend: 'the weekend', errands: 'errands', outdoors: 'a day outdoors', travel: 'a travel day',
  party: 'a night out', date: 'date night', work: 'work', interview: 'a job interview', church: 'church', wedding: 'a wedding', funeral: 'a funeral', formal: 'a black-tie event',
};
export function occasionPhrase(ctx) {
  const key = ctx && ctx.occasion;
  if (key && OCC_PHRASE[key]) return OCC_PHRASE[key];
  const label = ctx && ctx.occasionDef && ctx.occasionDef.label;
  if (key && key !== 'any' && label) return `your ${lc(label)}`;
  return 'the occasion';
}
const WEATHER_WORD = { hot: 'hot', warm: 'warm', mild: 'mild', cold: 'cold', freezing: 'freezing' };
const yours = (it, dflt) => (it && it.name ? `your ${lc(it.name)}` : dflt);

function culprit(reason, items) {
  const t = lc(reason.text);
  const list = Object.values(items || {}).filter(Boolean).sort((x, y) => String(y.name).length - String(x.name).length);
  return list.find((it) => it.name && t.includes(lc(it.name))) || null;
}

function buildVars(items, reason, ctx, group) {
  const all = Object.values(items || {}).filter(Boolean);
  const top = items.top, bottom = items.bottom;
  const loud = all.map((i) => i.colors && i.colors[0] && i.colors[0].family).filter((f, k, arr) => f && arr.indexOf(f) === k);
  const accents = loud.filter((f) => !['black', 'charcoal', 'gray', 'white', 'cream', 'beige', 'brown', 'navy', 'denim', 'olive'].includes(f));
  const colorsPool = accents.length >= 2 ? accents : loud;
  const a = pretty(colorsPool[0] || (top && top.colors[0].family) || 'color'), b = pretty(colorsPool[1] || (bottom && bottom.colors[0].family) || 'another color');
  const byF = all.filter((i) => Number.isFinite(i.formality)).sort((x, y) => y.formality - x.formality);
  let hi = byF[0], lo = byF.slice().reverse().find((i) => i !== hi) || byF[byF.length - 1];
  if (reason && /^(formality-shoes|shoes-)/.test(reason.tag) && items.shoes) {
    // a shoe problem is about the shoes versus whatever they clash with most
    const others = [items.top, items.bottom, items.layer].filter((i) => i && Number.isFinite(i.formality));
    const far = others.sort((p, q) => Math.abs(q.formality - items.shoes.formality) - Math.abs(p.formality - items.shoes.formality))[0];
    if (far) [hi, lo] = items.shoes.formality >= far.formality ? [items.shoes, far] : [far, items.shoes];
  }
  const pat = all.filter((i) => i.pattern && i.pattern !== 'solid');
  const p1 = pat[0] || top, p2 = pat[1] || (p1 === top ? bottom : top);
  let x = group === 'neck' ? (items.neckwear || items.headwear || null) : (reason && culprit(reason, items)) || null;
  if (!x && group === 'complexion') x = items.layer || top || null;
  if (!x && group === 'graphic') x = pat.find((i) => i.pattern === 'graphic') || top || null;
  const wk = ctx && WEATHER_WORD[ctx.weather];
  const w = wk || (group === 'hot' ? 'hot' : 'cold');
  return {
    a, b, top: yours(top, 'your top'), bottom: yours(bottom, 'your pants'), shoes: yours(items.shoes, 'your shoes'),
    x: yours(x, group === 'neck' ? 'that accessory' : 'this outfit'), fam: pretty(x && x.colors && x.colors[0] ? x.colors[0].family : 'color'),
    hi: yours(hi, 'your dressiest piece'), lo: yours(lo, 'your most casual piece'),
    p1: yours(p1, 'your top'), p2: yours(p2, 'your bottoms'),
    occ: occasionPhrase(ctx), w,
    r: reason ? String(reason.text || '').replace(/[.!]+$/, '') : 'something', R: reason ? String(reason.text || '') : '',
  };
}
export function fill(tpl, v) {
  return String(tpl).replace(/\{([A-Za-z0-9]+)\}/g, (m, k) => {
    if (k in v) return v[k];
    const low = k[0].toLowerCase() + k.slice(1);
    if (low in v && k[0] !== k[0].toLowerCase()) return capIt(v[low]);
    return m;
  }).replace(/\s+/g, ' ').trim();
}

function pickTemplate(group, rng, used) {
  const list = TEMPLATES[group];
  const order = list.map((_, i) => i).sort(() => rng() - 0.5);
  const i = order.find((k) => !used.has(`${group}:${k}`));
  used.add(`${group}:${i}`);
  return list[i];
}

function fixLine(swap, rng, v) {
  if (!swap) return fill(NO_FIX_TEMPLATES[Math.floor(rng() * NO_FIX_TEMPLATES.length)], v);
  const to = swap.row ? swap.row.item : swap.item;
  const cur = swap.cur || null;
  const d = Math.round(swap.delta || (swap.row && swap.row.delta) || 0);
  const action = !to ? `ditch ${yours(cur, 'the extra piece')}` : cur ? `swap ${yours(cur, 'that piece')} for ${yours(to, 'something else')}` : `add ${yours(to, 'something')}`;
  const tpl = FIX_TEMPLATES[Math.floor(rng() * FIX_TEMPLATES.length)];
  return fill(tpl, { ...v, action, d: String(d) }).replace(/\{action\}/g, action);
}

/** Groups of real problems in a reason list, most damaging first. */
export function problemGroups(reasons) {
  const seen = new Map();
  for (const r of (reasons || []).filter((x) => x && x.delta < 0 && typeof x.tag === 'string').sort((p, q) => p.delta - q.delta)) {
    const g = GROUP_OF[r.tag] || 'generic';
    if (!seen.has(g)) seen.set(g, r);
  }
  return [...seen.entries()].map(([group, reason]) => ({ group, reason }));
}

export function roastLevel(score) {
  if (!Number.isFinite(score)) return 'none';
  return score < ROAST_FULL_BELOW ? 'full' : score < ROAST_LIGHT_BELOW ? 'light' : 'none';
}

export function roastOutfit(items, result, ctx = {}, { seed = 'roast' } = {}) {
  const none = { level: 'none', headline: '', lines: [], fix: '', groups: [], text: '' };
  try {
    const score = result && result.score;
    const level = roastLevel(score);
    if (level === 'none' || !items || typeof items !== 'object') return none;
    const rng = seedRng(seed);
    const used = new Set();
    const probs = problemGroups(result.reasons);
    const base = buildVars(items, null, ctx, '');
    const head = level === 'full' ? (score < 25 ? HEADLINES.low : score < 40 ? HEADLINES.mid : HEADLINES.high) : HEADLINES.light;
    const headline = head[Math.floor(rng() * head.length)];
    const take = level === 'full' ? Math.min(3, Math.max(2, probs.length)) : 1;
    const lines = [], groups = [];
    for (const p of probs.slice(0, take)) {
      const v = buildVars(items, p.reason, ctx, p.group);
      let line = fill(pickTemplate(p.group, rng, used), v);
      if (level === 'light') line = `${LIGHT_PREFIX[Math.floor(rng() * LIGHT_PREFIX.length)]} ${line}`;
      lines.push(line); groups.push(p.group);
    }
    if (!lines.length) lines.push('I can’t point at one disaster. It’s more a lack of spark than a mistake.');
    let fix = '';
    if (level === 'full') { fix = fixLine(result.swap, rng, base); lines.push(fix); }
    else if (result.swap) fix = fixLine(result.swap, rng, base);
    const text = [headline, ...lines].join(' ').slice(0, 400);
    return { level, headline, lines, fix, groups, text };
  } catch {
    return none;
  }
}
