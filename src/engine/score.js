// scoreOutfit: base score + rule deltas, squashed smoothly into 0..100.

import { WEIGHTS, prepare, evaluateRules } from './rules.js';

/** Identity on 20..80, soft exponential edges toward 0 and 100. Monotonic, smooth. */
export function squash(x) {
  if (!Number.isFinite(x)) return 50;
  const LO = 20; const HI = 80;
  let y;
  if (x >= HI) y = HI + (100 - HI) * (1 - Math.exp(-(x - HI) / (100 - HI)));
  else if (x <= LO) y = LO * Math.exp((x - LO) / LO);
  else y = x;
  return Math.max(0, Math.min(100, Math.round(y)));
}

/** Dedupe by text, sort by |delta| desc (ties by text), keep at most `max`. */
export function finalizeReasons(reasons, max = 6) {
  const seen = new Set();
  const out = [];
  for (const r of reasons) {
    if (!r || !Number.isFinite(r.delta) || typeof r.text !== 'string' || seen.has(r.text)) continue;
    seen.add(r.text);
    out.push(r);
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return out.slice(0, Math.max(0, max));
}

/** Unsquashed score and all reasons (used by the builder to add its own deltas). */
export function rawScore(items, ctx = {}) {
  const P = prepare(items, ctx);
  const reasons = evaluateRules(P);
  let raw = WEIGHTS.base;
  for (const r of reasons) if (Number.isFinite(r.delta)) raw += r.delta;
  return { raw, reasons };
}

/**
 * @param {Object<string, Object>} items slot -> item
 * @param {Object} ctx { occasion, weather, rain, feedback, maxReasons }
 * @returns {{score:number, reasons:Array<{text:string,delta:number,tag:string}>}}
 */
export function scoreOutfit(items, ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  let res;
  try {
    res = rawScore(items, c);
  } catch (e) {
    return { score: 50, reasons: [] };
  }
  return { score: squash(res.raw), reasons: finalizeReasons(res.reasons, Number.isFinite(c.maxReasons) ? c.maxReasons : 6) };
}
