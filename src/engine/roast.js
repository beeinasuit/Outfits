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
  'pattern-busy': 'pattern', 'pattern-risky': 'pattern', 'statement-many': 'pattern', 'pattern-graphic': 'pattern', 'occasion-muted-pattern': 'pattern',
  'formality-clash': 'formality', 'formality-gap': 'formality', 'formality-shoes': 'formality', 'shoes-sporty': 'formality', 'shoes-oxford-jeans': 'formality',
  'shoes-sandals-formal': 'formality', 'shorts-dressy': 'formality',
  'weather-cold': 'cold', 'weather-shorts-cold': 'cold', 'weather-footwear': 'cold', 'weather-nolayer': 'cold',
  'weather-hot': 'hot', 'weather-accessory-hot': 'hot',
  'rain-none': 'rain', 'rain-suede': 'rain',
  'shoes-heavy-sandals': 'mixedSeason', 'shorts-heavy': 'mixedSeason', 'shorts-boots': 'mixedSeason',
  'occasion-avoid': 'occasion', 'occasion-off': 'occasion', 'occasion-avoid-color': 'occasion', 'occasion-muted': 'occasion', 'occasion-layer': 'occasion', 'occasion-hat': 'occasion',
  'leather-clash': 'leather', 'leather-near': 'leather', 'belt-formality': 'leather', 'belt-casual': 'leather', 'belt-no-loops': 'leather', 'belt-missing': 'leather',
  'tie-no-collar': 'neck', 'bowtie-informal': 'neck', 'tie-too-casual': 'neck', 'hat-mismatch': 'neck', 'hat-casual': 'neck',
  'complexion-off': 'complexion',
  'recently-worn': 'repeat',
  'feedback-disliked': 'disliked', 'feedback-pair-disliked': 'disliked',
};

// Tokens: {a} {b} colors, {top} {bottom} {shoes} item names (lowercase), {X}/{x} the piece a reason is about, {fam} its color,
// {hi}/{lo} dressiest / most casual piece, {p1}/{p2} patterned pieces, {occ} occasion, {w} weather, {P1}/{A}/... capitalized forms.
export const TEMPLATES = {
  colorClash: [
    '{A} and {b} in one outfit? That’s not a color story, that’s a custody battle.',
    '{A} next to {b}: your clothes are fighting and nobody’s refereeing.',
    'A traffic accident between {a} and {b}, and you wore it on purpose.',
    '{A} and {b} are shouting over each other. Pick a lane.',
    'The {a} and the {b} have never met before, and it shows.',
    'Somewhere a color wheel is filing a complaint about {a} plus {b}.',
    '{A} with {b}: bold, sure. Good, no.',
  ],
  muddy: [
    '{Top} and {bottom} are the same shade of nothing. It’s an outfit-shaped blur.',
    'Your {top} and {bottom} blend together like they’re trying to avoid being noticed.',
    '{Top} over {bottom}: so little contrast I assumed it was one very long garment.',
    'Matching the {top} to the {bottom} this closely isn’t style, it’s camouflage.',
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
  formality: [
    '{Hi} with {lo}? You dressed for two different events and attended both.',
    '{Hi} and {lo} don’t belong at the same party, let alone in the same outfit.',
    '{Hi} and {lo} walked in together and the whole room felt the tension.',
    'Your {hi} is dressed for a wedding and your {lo} is dressed for a nap.',
    '{Hi} with {lo}: the outfit equivalent of a tuxedo T-shirt.',
    'Somewhere between the {hi} and the {lo}, the plan fell apart.',
  ],
  cold: [
    'The forecast says {w} and you dressed like it’s a rumor.',
    'Dressed for {w} weather? Bold. Your outfit has clearly never been outside.',
    'That outfit is brave and the weather is going to make you pay for it.',
    '{W} weather will find every gap in this outfit. Enjoy.',
    'This is an outfit for a warm room that doesn’t exist today.',
    'Your sweater drawer is filing a missing-persons report on today’s outfit.',
  ],
  hot: [
    'It’s {w} out and this outfit is a slow-cooker with sleeves.',
    '{W} weather and you chose heat retention. Respect the commitment, question the plan.',
    'This outfit looks great for a sauna. You are not going to a sauna.',
    'Wearing that in {w} weather is a cry for shade.',
    'Your outfit forgot to check the temperature. It’ll find out by lunch.',
    'The sun is looking at this outfit like it’s dinner.',
  ],
  rain: [
    'Wet day, no rain jacket. Optimism is a look, I guess.',
    'The sky has plans and your outfit did not read them.',
    'This outfit will not survive a drizzle, and neither will your mood.',
    'Dry-clean-only energy on a rainy day. Brave.',
    'Puddles are going to have opinions about this outfit.',
    'You and an umbrella: a story you hope not to tell today.',
  ],
  mixedSeason: [
    'Pick a season. This outfit is wearing all of them at once.',
    'Half of this outfit is packed for the beach and half for a blizzard.',
    'Your outfit has a split personality and the weather forecast doesn’t know which to believe.',
    'This is what happens when you get dressed in the dark in four different months.',
    'Mixed signals, and they’re all coming from your wardrobe.',
    'The pieces in this outfit come from different calendars.',
  ],
  occasion: [
    '{X} for {occ}? Bold of you.',
    'Nobody has ever been to {occ} in {x} and thought “nailed it.”',
    'I’ve seen the dress code for {occ}. {X} didn’t get the memo.',
    'For {occ}, {x} is a lovely surprise. Nobody wanted that surprise.',
    '{X} is a lot of look for {occ}, and not a good kind of lot.',
    'If {occ} had a bouncer, {x} would be waiting outside.',
  ],
  leather: [
    'Belt and shoes are both leather and both disagree about the shade.',
    'Your belt and shoes are so close and yet so wrong. Almost-matching is worse than not matching.',
    'The belt situation is a mystery wrapped in a buckle. Fix the belt.',
    'Somewhere a leather-matching rule is weeping softly over your belt.',
    'Belt trouble: the kind you can see from across the street.',
    'That belt is doing its own thing, and its own thing isn’t working.',
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
    'Of the colors on the wheel, {x} picked the one that makes your whole look go quiet.',
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
const nameOf = (it, dflt) => (it && it.name ? lc(it.name) : dflt);

function culprit(reason, items) {
  const t = lc(reason.text);
  const list = Object.values(items || {}).filter(Boolean).sort((x, y) => String(y.name).length - String(x.name).length);
  return list.find((it) => it.name && t.includes(lc(it.name))) || null;
}

function buildVars(items, reason, ctx) {
  const all = Object.values(items || {}).filter(Boolean);
  const top = items.top, bottom = items.bottom;
  const loud = all.map((i) => i.colors && i.colors[0] && i.colors[0].family).filter((f, k, arr) => f && arr.indexOf(f) === k);
  const accents = loud.filter((f) => !['black', 'charcoal', 'gray', 'white', 'cream', 'beige', 'brown', 'navy', 'denim', 'olive'].includes(f));
  const colorsPool = accents.length >= 2 ? accents : loud;
  const a = pretty(colorsPool[0] || (top && top.colors[0].family) || 'color'), b = pretty(colorsPool[1] || (bottom && bottom.colors[0].family) || 'another color');
  const byF = all.filter((i) => Number.isFinite(i.formality)).sort((x, y) => y.formality - x.formality);
  const hi = byF[0], lo = byF[byF.length - 1];
  const pat = all.filter((i) => i.pattern && i.pattern !== 'solid');
  const x = (reason && culprit(reason, items)) || null;
  const near = x || items.layer || top;
  const occDef = ctx && ctx.occasionDef;
  const occ = occDef && occDef.label ? lc(occDef.label) : (ctx && ctx.occasion && ctx.occasion !== 'any' ? lc(ctx.occasion) : 'this occasion');
  const w = ctx && ctx.weather ? lc(ctx.weather) : 'today’s';
  const v = {
    a, b, top: nameOf(top, 'top'), bottom: nameOf(bottom, 'pants'), shoes: nameOf(items.shoes, 'shoes'),
    x: x ? nameOf(x, 'this outfit') : 'this outfit', fam: pretty(near && near.colors && near.colors[0] ? near.colors[0].family : 'color'),
    hi: nameOf(hi, 'dressy piece'), lo: nameOf(lo, 'casual piece'),
    p1: nameOf(pat[0] || top, 'top'), p2: nameOf(pat[1] || bottom, 'bottom'),
    occ, w, r: reason ? String(reason.text || '').replace(/[.!]+$/, '') : 'something', R: reason ? String(reason.text || '') : '',
  };
  if (!x && near && ['complexion'].length) v.x = nameOf(near, 'this outfit');
  return v;
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
  const action = !to ? `ditch the ${nameOf(cur, 'extra')}` : cur ? `swap ${nameOf(cur, 'that piece')} for ${nameOf(to, 'something else')}` : `add ${nameOf(to, 'something')}`;
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
    const base = buildVars(items, null, ctx);
    const head = level === 'full' ? (score < 25 ? HEADLINES.low : score < 40 ? HEADLINES.mid : HEADLINES.high) : HEADLINES.light;
    const headline = head[Math.floor(rng() * head.length)];
    const take = level === 'full' ? Math.min(3, Math.max(2, probs.length)) : 1;
    const lines = [], groups = [];
    for (const p of probs.slice(0, take)) {
      const v = buildVars(items, p.reason, ctx);
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
