// Shared vocabulary for the whole app. Every module imports from here.
// This file is the CONTRACT between the engine, vision and UI modules.
// Pure data + tiny helpers only: must run in both the browser and Node (no DOM).

/** Outfit slots, in the order they are drawn top-to-bottom on screen. */
export const SLOTS = ['headwear', 'layer', 'top', 'neckwear', 'belt', 'bottom', 'shoes', 'extra'];

/**
 * How each slot participates in an outfit.
 *  required: every outfit has exactly one.
 *  conditional: belt — included iff the bottom has beltLoops === true (and a belt is available).
 *  optional: added only when it improves the outfit or the context calls for it (weather/occasion).
 */
export const SLOT_RULES = {
  top: 'required',
  bottom: 'required',
  shoes: 'required', // if the user owns zero shoes, outfits are still built without them
  belt: 'conditional',
  layer: 'optional',
  neckwear: 'optional',
  headwear: 'optional',
  extra: 'optional',
};

export const SLOT_LABELS = {
  headwear: 'Hat', layer: 'Layer', top: 'Top', neckwear: 'Neckwear',
  belt: 'Belt', bottom: 'Bottom', shoes: 'Shoes', extra: 'Extra',
};

/** Kinds per slot, with defaults used when the user picks a kind. */
export const KINDS = {
  top: {
    't-shirt':     { formality: 2, collared: false, warmth: 0 },
    'graphic tee': { formality: 1, collared: false, warmth: 0 },
    'tank top':    { formality: 1, collared: false, warmth: 0 },
    'polo':        { formality: 2, collared: true,  warmth: 0 },
    'henley':      { formality: 2, collared: false, warmth: 1 },
    'button-down': { formality: 3, collared: true,  warmth: 1 },
    'oxford':      { formality: 3, collared: true,  warmth: 1 },
    'flannel':     { formality: 2, collared: true,  warmth: 1 },
    'dress shirt': { formality: 4, collared: true,  warmth: 1 },
    'sweater':     { formality: 3, collared: false, warmth: 2 },
    'hoodie':      { formality: 1, collared: false, warmth: 2 },
    'sweatshirt':  { formality: 1, collared: false, warmth: 2 },
    'turtleneck':  { formality: 3, collared: false, warmth: 2 },
  },
  bottom: {
    'jeans':        { formality: 2, beltLoops: true },
    'chinos':       { formality: 3, beltLoops: true },
    'dress pants':  { formality: 4, beltLoops: true },
    'suit trousers':{ formality: 5, beltLoops: true },
    'corduroys':    { formality: 3, beltLoops: true },
    'cargo pants':  { formality: 2, beltLoops: true },
    'shorts':       { formality: 2, beltLoops: true },
    'joggers':      { formality: 1, beltLoops: false },
    'sweatpants':   { formality: 1, beltLoops: false },
    'athletic shorts': { formality: 1, beltLoops: false },
  },
  shoes: {
    'sneakers':     { formality: 2, material: 'canvas' },
    'running shoes':{ formality: 1, material: 'synthetic' },
    'boots':        { formality: 3, material: 'leather' },
    'chelsea boots':{ formality: 3, material: 'leather' },
    'loafers':      { formality: 4, material: 'leather' },
    'derbies':      { formality: 4, material: 'leather' },
    'oxfords':      { formality: 5, material: 'leather' },
    'sandals':      { formality: 1, material: 'synthetic' },
  },
  belt: {
    'leather belt': { formality: 3, material: 'leather' },
    'dress belt':   { formality: 5, material: 'leather' },
    'canvas belt':  { formality: 2, material: 'canvas' },
    'braided belt': { formality: 2, material: 'fabric' },
  },
  layer: {
    'blazer':        { formality: 4, warmth: 1 },
    'suit jacket':   { formality: 5, warmth: 1 },
    'cardigan':      { formality: 3, warmth: 1 },
    'denim jacket':  { formality: 2, warmth: 1 },
    'bomber':        { formality: 2, warmth: 2 },
    'leather jacket':{ formality: 2, warmth: 2 },
    'overshirt':     { formality: 2, warmth: 1 },
    'rain jacket':   { formality: 1, warmth: 1, rain: true },
    'puffer':        { formality: 1, warmth: 3 },
    'overcoat':      { formality: 4, warmth: 3 },
    'peacoat':       { formality: 3, warmth: 3 },
    'vest':          { formality: 3, warmth: 1 },
  },
  neckwear: {
    'tie':      { formality: 4 },
    'knit tie': { formality: 3 },
    'bow tie':  { formality: 5 },
    'scarf':    { formality: 2, warmth: 1 },
  },
  headwear: {
    'baseball cap': { formality: 1 },
    'beanie':       { formality: 1, warmth: 1 },
    'bucket hat':   { formality: 1 },
    'flat cap':     { formality: 3 },
    'fedora':       { formality: 4 },
  },
  extra: {
    'watch':        { formality: 3 },
    'socks':        { formality: 2 },
    'pocket square':{ formality: 4 },
    'bag':          { formality: 2 },
    'sunglasses':   { formality: 2 },
  },
};

export const PATTERNS = ['solid', 'stripe', 'check', 'plaid', 'houndstooth', 'floral', 'graphic', 'print', 'polka', 'camo', 'textured'];
/** "Busy" patterns: two of these in one outfit usually clash. */
export const BUSY_PATTERNS = ['plaid', 'floral', 'graphic', 'print', 'camo', 'houndstooth'];

/**
 * Wears before an item goes to the hamper automatically (when auto-hamper is on).
 * 0 = never needs washing (belts, shoes, hats, ties...). Per-kind overrides beat per-slot defaults.
 */
export const WEARS_BEFORE_WASH = {
  slot: { top: 2, bottom: 4, layer: 10, shoes: 0, belt: 0, neckwear: 0, headwear: 0, extra: 0 },
  kind: {
    't-shirt': 1, 'graphic tee': 1, 'tank top': 1, 'polo': 1,
    'dress shirt': 1, 'button-down': 2, 'oxford': 2, 'flannel': 3, 'henley': 2,
    'sweater': 3, 'hoodie': 3, 'sweatshirt': 3, 'turtleneck': 2,
    'shorts': 2, 'athletic shorts': 1, 'joggers': 3, 'sweatpants': 3,
    'socks': 1, 'scarf': 0,
  },
};

export function defaultWearsBeforeWash(slot, kind) {
  if (kind in WEARS_BEFORE_WASH.kind) return WEARS_BEFORE_WASH.kind[kind];
  return WEARS_BEFORE_WASH.slot[slot] ?? 0;
}

/** Wears since the item was last washed (counts worn[] dates after lastWashed). */
export function wearsSinceWash(item) {
  const since = item?.lastWashed || '';
  return (item?.worn || []).filter((d) => d > since).length;
}

/** True when auto-hamper should send this item to the wash. */
export function needsWash(item) {
  const limit = item?.wearsBeforeWash ?? 0;
  return limit > 0 && wearsSinceWash(item) >= limit;
}

/**
 * Personal coloring profile (optional). Stored in settings.profile.
 * Drives the complexion rules: colors worn near the face (top, layer, neckwear, headwear) are
 * checked against undertone / depth / contrast. Treated as a nudge, never a veto.
 * @typedef {Object} Profile
 * @property {boolean} enabled
 * @property {'warm'|'cool'|'neutral'|null} undertone
 * @property {'light'|'medium'|'deep'|null}  depth     skin depth
 * @property {'low'|'medium'|'high'|null}    contrast  difference between hair/skin/eyes
 * @property {string|null} skinHex   sampled skin color (white-balance corrected), informational
 * @property {string|null} selfieId  photo store key of the selfie
 * @property {string|null} cutoutId  photo store key of the head-and-shoulders cutout
 * @property {boolean} includeSelfieInBackup  default false
 */
export const UNDERTONES = ['warm', 'cool', 'neutral'];
export const DEPTHS = ['light', 'medium', 'deep'];
export const CONTRASTS = ['low', 'medium', 'high'];
/** Slots whose color sits next to the face, with how much they count for complexion. */
export const NEAR_FACE = { top: 1, layer: 0.8, neckwear: 0.7, headwear: 0.9 };

export function makeProfile(p = {}) {
  return {
    enabled: p.enabled !== false && !!(p.undertone || p.depth || p.contrast),
    undertone: UNDERTONES.includes(p.undertone) ? p.undertone : null,
    depth: DEPTHS.includes(p.depth) ? p.depth : null,
    contrast: CONTRASTS.includes(p.contrast) ? p.contrast : null,
    skinHex: typeof p.skinHex === 'string' && /^#[0-9a-f]{6}$/i.test(p.skinHex) ? p.skinHex.toLowerCase() : null,
    selfieId: p.selfieId || null,
    cutoutId: p.cutoutId || null,
    includeSelfieInBackup: p.includeSelfieInBackup === true,
  };
}

/** Dress level scale used everywhere. */
export const FORMALITY = { 1: 'Lounge', 2: 'Casual', 3: 'Smart casual', 4: 'Business', 5: 'Formal' };

/**
 * Occasions: what the user is dressing for. Data-driven so the engine applies them generically.
 * min/max: acceptable formality window. Optional:
 *  preferFamilies / avoidFamilies: color families nudged up / down (any slot, primary color)
 *  wantKinds: kinds that fit the occasion (+); avoidKinds: kinds that are wrong for it (−−)
 *  wantLayer: a layer (blazer/jacket) is expected; muted: loud colors & busy patterns penalized
 *  noHeadwear: hats are out (indoors / ceremony)
 */
export const OCCASIONS = {
  any:       { label: 'Anything', emoji: '✨', min: 1, max: 5 },
  lounge:    { label: 'Lounging', emoji: '🛋️', min: 1, max: 2 },
  casual:    { label: 'Casual', emoji: '😎', min: 1, max: 3 },
  weekend:   { label: 'Weekend', emoji: '☀️', min: 1, max: 3 },
  errands:   { label: 'Errands', emoji: '🛒', min: 1, max: 3 },
  outdoors:  { label: 'Outdoors', emoji: '🌲', min: 1, max: 3,
               wantKinds: ['boots', 'flannel', 'overshirt', 'rain jacket', 'jeans', 'cargo pants', 'beanie', 'baseball cap'],
               avoidKinds: ['loafers', 'oxfords', 'derbies', 'dress pants', 'suit trousers', 'dress shirt', 'blazer', 'suit jacket'] },
  travel:    { label: 'Travel day', emoji: '✈️', min: 1, max: 3,
               avoidKinds: ['suit trousers', 'oxfords', 'dress shirt'] },
  party:     { label: 'Party / night out', emoji: '🎉', min: 2, max: 4,
               preferFamilies: ['black', 'burgundy', 'navy', 'forest', 'rust'], avoidKinds: ['running shoes', 'sweatpants', 'hoodie'] },
  date:      { label: 'Date night', emoji: '🌹', min: 3, max: 4,
               avoidKinds: ['graphic tee', 'hoodie', 'sweatpants', 'joggers', 'running shoes', 'baseball cap', 'cargo pants'] },
  work:      { label: 'Work', emoji: '💼', min: 3, max: 4,
               avoidKinds: ['graphic tee', 'tank top', 'hoodie', 'sweatpants', 'joggers', 'athletic shorts', 'running shoes', 'sandals'] },
  interview: { label: 'Job interview', emoji: '🤝', min: 4, max: 5, muted: true, wantLayer: true, noHeadwear: true,
               preferFamilies: ['navy', 'charcoal', 'gray', 'white', 'light-blue'] },
  church:    { label: 'Church', emoji: '⛪', min: 3, max: 5, muted: true, noHeadwear: true,
               avoidKinds: ['graphic tee', 'tank top', 'shorts', 'athletic shorts', 'hoodie', 'sweatpants', 'joggers', 'running shoes', 'sandals'] },
  wedding:   { label: 'Wedding guest', emoji: '💒', min: 4, max: 5, wantLayer: true, noHeadwear: true,
               avoidFamilies: ['white', 'cream'], avoidKinds: ['jeans', 'sneakers', 'running shoes', 'graphic tee'] },
  funeral:   { label: 'Funeral', emoji: '🕊️', min: 4, max: 5, muted: true, wantLayer: true, noHeadwear: true,
               preferFamilies: ['black', 'charcoal', 'navy', 'gray'],
               avoidFamilies: ['red', 'orange', 'yellow', 'pink', 'purple', 'lavender', 'light-blue', 'mustard', 'green', 'teal'] },
  formal:    { label: 'Formal / black tie', emoji: '🎩', min: 5, max: 5, muted: true, wantLayer: true, noHeadwear: true,
               preferFamilies: ['black', 'navy', 'charcoal', 'white'] },
};

/** Normalize a user-defined occasion into the OCCASIONS shape. */
export function makeOccasion(o = {}) {
  const clamp = (v, d) => (Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : d);
  const min = clamp(o.min, 1), max = Math.max(min, clamp(o.max, 5));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined);
  const fams = (v) => list(v)?.map(canonFamily);
  return {
    label: String(o.label || 'My occasion').slice(0, 40), emoji: String(o.emoji || '📍').slice(0, 4), min, max,
    preferFamilies: fams(o.preferFamilies), avoidFamilies: fams(o.avoidFamilies),
    wantKinds: list(o.wantKinds), avoidKinds: list(o.avoidKinds),
    wantLayer: !!o.wantLayer, muted: !!o.muted, noHeadwear: !!o.noHeadwear, custom: true,
  };
}

/** Weather buckets. 'auto' is resolved by the UI into one of the others. */
export const WEATHER = {
  hot:  { label: 'Hot',  minWarmth: 0, maxWarmth: 0 },
  warm: { label: 'Warm', minWarmth: 0, maxWarmth: 1 },
  mild: { label: 'Mild', minWarmth: 1, maxWarmth: 2 },
  cold: { label: 'Cold', minWarmth: 2, maxWarmth: 4 },
  freezing: { label: 'Freezing', minWarmth: 3, maxWarmth: 5 },
};

/** Leather colors. Belt and shoe leather should match when both are leather. */
export const LEATHER_TONES = ['black', 'dark-brown', 'brown', 'tan', 'burgundy', 'white', 'other'];
export const MATERIALS = ['leather', 'suede', 'canvas', 'fabric', 'synthetic', 'knit', 'denim', 'other'];

/**
 * Color families. Vision maps any RGB to one of these; scoring reasons about families.
 * `neutral: true` families go with almost anything.
 */
export const COLOR_FAMILIES = {
  black:      { neutral: true,  hex: '#1c1c1e' },
  charcoal:   { neutral: true,  hex: '#3a3d42' },
  gray:       { neutral: true,  hex: '#8e9196' },
  white:      { neutral: true,  hex: '#f5f5f2' },
  cream:      { neutral: true,  hex: '#efe6d2' },
  beige:      { neutral: true,  hex: '#d8c3a0' }, // khaki / stone / tan cloth
  brown:      { neutral: true,  hex: '#6b4a2f' },
  navy:       { neutral: true,  hex: '#1f2a44' },
  denim:      { neutral: true,  hex: '#4a6286' },
  olive:      { neutral: true,  hex: '#5d6136' },
  'light-blue': { neutral: false, hex: '#9cc3e6' },
  blue:       { neutral: false, hex: '#2f6fd0' },
  teal:       { neutral: false, hex: '#1f8a8a' },
  green:      { neutral: false, hex: '#2e8b4a' },
  'forest':   { neutral: false, hex: '#234d36' },
  yellow:     { neutral: false, hex: '#f2c94c' },
  mustard:    { neutral: false, hex: '#c99a2e' },
  orange:     { neutral: false, hex: '#e8742a' },
  rust:       { neutral: false, hex: '#a4502a' },
  red:        { neutral: false, hex: '#d13b3b' },
  burgundy:   { neutral: false, hex: '#6d1f2f' },
  pink:       { neutral: false, hex: '#f2a7bb' },
  purple:     { neutral: false, hex: '#6c4ab6' },
  lavender:   { neutral: false, hex: '#b9a7e0' },
};

/**
 * @typedef {Object} Color
 * @property {string} hex     '#rrggbb' lowercase
 * @property {string} family  key of COLOR_FAMILIES
 * @property {number} weight  0..1 share of the item's pixels (colors of one item sum to ~1)
 */

/**
 * @typedef {Object} Item
 * @property {string}  id
 * @property {string}  slot        one of SLOTS
 * @property {string}  kind        key of KINDS[slot]
 * @property {string}  name        user-facing label, e.g. "Navy oxford"
 * @property {Color[]} colors      dominant first; 1..4 entries; never empty
 * @property {string}  pattern     one of PATTERNS
 * @property {number}  formality   1..5
 * @property {number}  warmth      0..3 (meaningful for top/layer/neckwear/headwear; 0 otherwise)
 * @property {boolean} beltLoops   bottoms only; false for every other slot
 * @property {boolean} collared    tops only; false otherwise
 * @property {string}  material    one of MATERIALS
 * @property {string|null} leather one of LEATHER_TONES when material is 'leather' or 'suede'; else null
 * @property {boolean} rain        true for rain-suitable layers
 * @property {boolean} available   false = in the laundry / unavailable; never suggested
 * @property {string|null} photoId key of the photo blob in storage (null for photo-less items)
 * @property {string|null} cutoutId key of a transparent-background cutout blob (null if none)
 * @property {string[]} worn       ISO dates (YYYY-MM-DD) the item was worn, newest last
 * @property {string|null} lastWashed  ISO date of the last wash/laundry day; wears after it count toward the hamper
 * @property {number}  wearsBeforeWash 0 = never auto-hamper; else wears until it goes to the hamper
 * @property {number}  createdAt   epoch ms
 */

/**
 * @typedef {Object} Outfit
 * @property {Object<string, Item>} items  slot -> item. Always has top + bottom.
 * @property {number}   score     0..100
 * @property {Reason[]} reasons   sorted by |delta| desc
 * @property {string}   key       stable signature: item ids sorted & joined with '|'
 */

/**
 * @typedef {Object} Reason
 * @property {string} text   short, friendly, specific ("Brown belt matches brown boots")
 * @property {number} delta  signed contribution to the score
 * @property {string} tag    machine tag, e.g. 'color-clash', 'leather-match', 'pattern-busy'
 */

let _idCounter = 0;
export function newId() {
  _idCounter += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${_idCounter.toString(36)}`;
}

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build a fully-populated Item from a partial one, applying KINDS defaults.
 * Unknown/missing fields get safe defaults. Never throws on odd input; clamps numbers.
 */
/**
 * A fit check: a photo of what the user actually wore, matched to closet items and scored.
 * itemIds: { slot: closetItemId } for pieces matched to the closet.
 * extras:  { slot: item } for pieces NOT in the closet (made with makeItem; never saved to the closet).
 * mood: how the user felt in it ('love' | 'ok' | 'meh' | null).
 * roast: the roast text shown for a low score (saved so the diary shows the same one).
 */
export function makeCheck(c) {
  if (!c || typeof c !== 'object') return null;
  const id = typeof c.id === 'string' && /^[\w.-]{1,64}$/.test(c.id) ? c.id : newId();
  const date = typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date : todayISO();
  const itemIds = {}, extras = {};
  for (const slot of SLOTS) {
    const v = c.itemIds?.[slot];
    if (typeof v === 'string' && /^[\w.-]{1,64}$/.test(v)) itemIds[slot] = v;
    else if (c.extras?.[slot] && typeof c.extras[slot] === 'object') extras[slot] = makeItem({ ...c.extras[slot], slot });
  }
  const score = Number.isFinite(c.score) ? Math.max(0, Math.min(100, Math.round(c.score))) : null;
  return {
    id, date, createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
    photoId: typeof c.photoId === 'string' ? c.photoId : null,
    itemIds, extras, score,
    occasion: typeof c.occasion === 'string' ? c.occasion.slice(0, 40) : 'any',
    mood: ['love', 'ok', 'meh'].includes(c.mood) ? c.mood : null,
    note: typeof c.note === 'string' ? c.note.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) : '',
    roast: typeof c.roast === 'string' ? c.roast.replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').slice(0, 400) : '',
  };
}

/** Older saves used the British key 'grey'; map it to the current 'gray'. */
export const canonFamily = (f) => (f === 'grey' ? 'gray' : f);

export function makeItem(partial = {}) {
  if (!partial || typeof partial !== 'object') partial = {};
  const slot = SLOTS.includes(partial.slot) ? partial.slot : 'top';
  const kinds = KINDS[slot];
  const kind = typeof partial.kind === 'string' && Object.hasOwn(kinds, partial.kind) ? partial.kind : Object.keys(kinds)[0];
  const d = kinds[kind];
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
  const material = MATERIALS.includes(partial.material) ? partial.material : (d.material || 'fabric');
  const isLeather = material === 'leather' || material === 'suede';
  const colors = Array.isArray(partial.colors) && partial.colors.length
    ? partial.colors
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({ ...c, family: canonFamily(c.family) }))
        .filter((c) => Object.hasOwn(COLOR_FAMILIES, c.family))
        .map((c) => ({
          hex: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex.toLowerCase() : COLOR_FAMILIES[c.family].hex,
          family: c.family,
          weight: Number.isFinite(c.weight) ? Math.min(1, Math.max(0, c.weight)) : 1,
        }))
        .slice(0, 4)
    : [];
  return {
    id: typeof partial.id === 'string' && /^[\w.-]{1,64}$/.test(partial.id) ? partial.id : newId(),
    slot,
    kind,
    name: (typeof partial.name === 'string' || typeof partial.name === 'number' ? String(partial.name) : '')
      .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || defaultName(kind, colors),
    colors: colors.length ? colors : [{ hex: COLOR_FAMILIES.gray.hex, family: 'gray', weight: 1 }],
    pattern: PATTERNS.includes(partial.pattern) ? partial.pattern : 'solid',
    formality: clamp(partial.formality, 1, 5, d.formality ?? 2),
    warmth: clamp(partial.warmth, 0, 3, d.warmth ?? 0),
    beltLoops: slot === 'bottom' ? (typeof partial.beltLoops === 'boolean' ? partial.beltLoops : !!d.beltLoops) : false,
    collared: slot === 'top' ? (typeof partial.collared === 'boolean' ? partial.collared : !!d.collared) : false,
    material,
    leather: isLeather ? (LEATHER_TONES.includes(partial.leather) ? partial.leather : 'brown') : null,
    rain: typeof partial.rain === 'boolean' ? partial.rain : !!d.rain,
    available: partial.available !== false,
    photoId: typeof partial.photoId === 'string' ? partial.photoId : null,
    cutoutId: typeof partial.cutoutId === 'string' ? partial.cutoutId : null,
    worn: Array.isArray(partial.worn) ? [...new Set(partial.worn.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [],
    lastWashed: typeof partial.lastWashed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(partial.lastWashed) ? partial.lastWashed : null,
    wearsBeforeWash: clamp(partial.wearsBeforeWash, 0, 30, defaultWearsBeforeWash(slot, kind)),
    createdAt: Number.isFinite(partial.createdAt) ? partial.createdAt : Date.now(),
  };
}

function defaultName(kind, colors) {
  const fam = colors[0]?.family;
  const pretty = fam ? fam.replace('-', ' ') : '';
  const label = pretty ? `${pretty[0].toUpperCase()}${pretty.slice(1)} ${kind}` : kind[0].toUpperCase() + kind.slice(1);
  return label;
}

export function primaryFamily(item) {
  return item?.colors?.[0]?.family || 'gray';
}

export function isNeutralFamily(family) {
  return !!COLOR_FAMILIES[family]?.neutral;
}

export function outfitKey(items) {
  return Object.values(items).filter(Boolean).map((i) => i.id).sort().join('|');
}
