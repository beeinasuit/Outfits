// Taste learning (see ARCHITECTURE.md "Taste learning"). Pure, deterministic, no deps; Node + browser.
// Learns per-feature weights from battles / likes / dislikes / wears. Items are snapshots, so features are
// derived from attributes only (never ids).
import { SLOTS, COLOR_FAMILIES, FORMALITY, BUSY_PATTERNS, canonFamily } from '../model.js';

const PRIOR_K = 4;          // Bayesian shrinkage: weight = sum / (mass + k)
const MIN_EVIDENCE = 5;     // total events before taste influences anything
const MIN_FEATURE_N = 3;    // events a feature needs before it contributes
const MAX_DELTA = 8;
const EVENT_WEIGHT = { battle: 1, like: 1, dislike: -1, wear: 0.4 };
const DAY = 86400000;
const NEAR_FACE = ['top', 'layer', 'neckwear', 'headwear'];
const LOWER = ['bottom', 'belt'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexLightness(hex) {
  if (typeof hex !== 'string' || hex.length !== 7 || hex.charCodeAt(0) !== 35) return null;
  const v = parseInt(hex.slice(1), 16);
  if (!(v >= 0)) return null;
  return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}
function lightnessOf(item) {
  const c = item?.colors?.[0];
  const l = hexLightness(c?.hex);
  if (l != null) return l;
  return hexLightness(COLOR_FAMILIES[canonFamily(c?.family)]?.hex);
}
function familyOf(item) {
  const f = canonFamily(item?.colors?.[0]?.family);
  return typeof f === 'string' && COLOR_FAMILIES[f] ? f : null;
}

/** Binary feature set (array of unique keys) for an outfit. Exported for tests only via learnTaste/tasteDelta. */
function extractFeatures(items) {
  if (!items || typeof items !== 'object') return [];
  const o = items;
  const slots = [];
  for (let i = 0; i < SLOTS.length; i++) { const it = o[SLOTS[i]]; if (it && typeof it === 'object') slots.push(SLOTS[i]); }
  if (!slots.length) return [];
  const f = new Set();
  for (const s of slots) {
    const it = o[s];
    const fam = familyOf(it);
    if (fam) {
      if (NEAR_FACE.includes(s)) f.add(`face:${fam}`);
      else if (LOWER.includes(s) && s === 'bottom') f.add(`lower:${fam}`);
      else if (s === 'shoes') f.add(`feet:${fam}`);
    }
    if (s !== 'extra' && typeof it.kind === 'string' && it.kind) f.add(`kind:${it.kind.toLowerCase().slice(0, 30)}`);
  }
  // pattern
  const main = ['top', 'bottom', 'layer'].filter((s) => o[s]);
  let busy = false, anyPattern = false;
  for (const s of main) {
    const p = o[s].pattern;
    if (typeof p === 'string' && p && p !== 'solid') { anyPattern = true; f.add(`pattern:${p}`); if (BUSY_PATTERNS.includes(p)) busy = true; }
  }
  if (busy) f.add('pattern:busy');
  else if (main.length && !anyPattern) f.add('pattern:solid');
  // formality level + spread
  const fs = slots.filter((s) => s !== 'extra').map((s) => num(o[s].formality)).filter((v) => v != null && v >= 1 && v <= 5);
  if (fs.length) {
    const avg = fs.reduce((a, b) => a + b, 0) / fs.length;
    f.add(`formal:${clamp(Math.round(avg), 1, 5)}`);
    if (fs.length >= 2) f.add(Math.max(...fs) - Math.min(...fs) >= 2 ? 'spread:mixed' : 'spread:matched');
  }
  if (o.layer) f.add('layer:yes');
  // contrast between top and bottom lightness
  const lt = o.top ? lightnessOf(o.top) : null, lb = o.bottom ? lightnessOf(o.bottom) : null;
  if (lt != null && lb != null) {
    const d = lt - lb;
    if (Math.abs(d) < 0.12) f.add('contrast:tonal');
    else if (d >= 0.25) f.add('contrast:light-over-dark');
    else if (d <= -0.25) f.add('contrast:dark-over-light');
  }
  // accessories
  if (o.neckwear && /tie/i.test(String(o.neckwear.kind))) f.add('acc:tie');
  if (o.headwear) f.add('acc:hat');
  return [...f];
}

/**
 * @returns {{features:Object<string,{w:number,n:number}>, evidence:number}}
 */
export function learnTaste(events, opts = {}) {
  const now = num(opts?.now) ?? Date.now();
  const hl = num(opts?.halfLifeDays) > 0 ? opts.halfLifeDays : 60;
  const acc = new Map(); // key -> {sum, mass, n}
  let evidence = 0;
  const bump = (key, v, decay) => {
    let a = acc.get(key);
    if (!a) { a = { sum: 0, mass: 0, n: 0 }; acc.set(key, a); }
    a.sum += v * decay; a.mass += decay; a.n += 1;
  };
  const list = Array.isArray(events) ? events : [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const sign = EVENT_WEIGHT[e.type];
    if (sign === undefined) continue;
    const at = num(e.at);
    const age = at == null ? 0 : Math.max(0, now - at) / DAY;
    const decay = Math.exp(-0.6931471805599453 * age / hl);
    if (e.type === 'battle') {
      const w = new Set(extractFeatures(e.winner)), l = new Set(extractFeatures(e.loser));
      if (!w.size || !l.size) continue;
      evidence++;
      for (const k of w) if (!l.has(k)) bump(k, 1, decay);
      for (const k of l) if (!w.has(k)) bump(k, -1, decay);
    } else {
      const fs = extractFeatures(e.items);
      if (!fs.length) continue;
      evidence++;
      for (const k of fs) bump(k, sign, decay * Math.abs(sign));
    }
  }
  const features = {};
  for (const [k, a] of acc) {
    const w = clamp(a.sum / (a.mass + PRIOR_K), -1, 1);
    features[k] = { w: Math.round(w * 1000) / 1000, n: a.n };
  }
  return { features, evidence };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pretty = (s) => String(s).replace(/-/g, ' ');
function plural(kind) {
  if (/s$/.test(kind)) return kind;
  if (/(ch|sh|x)$/.test(kind)) return `${kind}es`;
  return `${kind}s`;
}
/** Lower-case noun phrase for a feature key, or null when it is not worth naming. */
function phrase(key) {
  const i = key.indexOf(':');
  const group = i < 0 ? key : key.slice(0, i), val = i < 0 ? '' : key.slice(i + 1);
  switch (group) {
    case 'face': return `${pretty(val)} near your face`;
    case 'lower': return `${pretty(val)} bottoms`;
    case 'feet': return `${pretty(val)} shoes`;
    case 'kind': return plural(pretty(val));
    case 'pattern':
      if (val === 'busy') return 'bold patterns';
      if (val === 'solid') return 'plain solid outfits';
      return val === 'stripe' ? 'stripes' : val === 'check' ? 'checks' : val === 'print' ? 'prints' : val === 'polka' ? 'polka dots' : val === 'camo' ? 'camo' : val === 'graphic' ? 'graphic pieces' : plural(val);
    case 'formal': return FORMALITY[val] ? `${FORMALITY[val].toLowerCase()} outfits` : null;
    case 'spread': return val === 'mixed' ? 'mixing dressy and casual pieces' : 'outfits that match in formality';
    case 'layer': return 'adding a layer';
    case 'contrast':
      return val === 'tonal' ? 'tonal outfits' : val === 'light-over-dark' ? 'a lighter top over darker bottoms' : 'a darker top over lighter bottoms';
    case 'acc': return val === 'tie' ? 'wearing a tie' : 'wearing a hat';
    default: return null;
  }
}

function validFeatures(taste) {
  const fs = taste && typeof taste === 'object' ? taste.features : null;
  return fs && typeof fs === 'object' ? fs : {};
}
const okEntry = (e) => e && Number.isFinite(e.w) && Number.isFinite(e.n);

/** @returns {{delta:number, reasons:Array<{text:string,delta:number,tag:string}>}} */
export function tasteDelta(items, taste) {
  const none = { delta: 0, reasons: [] };
  if (!taste || typeof taste !== 'object' || !(num(taste.evidence) >= MIN_EVIDENCE)) return none;
  const fs = validFeatures(taste);
  const contribs = [];
  let sum = 0;
  for (const k of extractFeatures(items)) {
    const e = fs[k];
    if (!okEntry(e) || e.n < MIN_FEATURE_N) continue;
    const w = clamp(e.w, -1, 1);
    sum += w;
    contribs.push({ k, w, n: e.n });
  }
  const total = MAX_DELTA * Math.tanh(sum / 1.5);
  const delta = Number.isFinite(total) ? Math.round(clamp(total, -MAX_DELTA, MAX_DELTA) * 10) / 10 : 0;
  const reasons = [];
  const strong = contribs.filter((c) => Math.abs(c.w) >= 0.35 && c.n >= 4 && phrase(c.k))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w) || (a.k < b.k ? -1 : 1));
  for (const c of strong.slice(0, 2)) {
    const p = phrase(c.k);
    const d = Math.round(clamp(c.w * 3, -MAX_DELTA, MAX_DELTA) * 10) / 10;
    reasons.push(c.w > 0
      ? { text: `You tend to pick ${p} — it's a favorite`, delta: d, tag: 'taste-like' }
      : { text: `You usually skip ${p}`, delta: d, tag: 'taste-dislike' });
  }
  return { delta, reasons };
}

/** @returns {{likes:Array<{label:string,strength:number,evidence:number}>, dislikes:Array<...>}} */
export function describeTaste(taste) {
  const out = { likes: [], dislikes: [] };
  if (!taste || typeof taste !== 'object' || !(num(taste.evidence) >= MIN_EVIDENCE)) return out;
  const rows = [];
  for (const [k, e] of Object.entries(validFeatures(taste))) {
    if (!okEntry(e) || e.n < MIN_FEATURE_N || Math.abs(e.w) < 0.15) continue;
    const p = phrase(k);
    if (!p) continue;
    rows.push({ k, label: cap(p), strength: Math.round(clamp(Math.abs(e.w), 0, 1) * 100) / 100, evidence: e.n, w: e.w });
  }
  rows.sort((a, b) => b.strength - a.strength || b.evidence - a.evidence || (a.k < b.k ? -1 : 1));
  for (const r of rows) {
    const row = { label: r.label, strength: r.strength, evidence: r.evidence };
    if (r.w > 0 && out.likes.length < 5) out.likes.push(row);
    else if (r.w < 0 && out.dislikes.length < 5) out.dislikes.push(row);
  }
  return out;
}
