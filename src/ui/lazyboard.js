// Loads agent A's board.js / occasions.js lazily, with plain fallbacks so Looks and Plan still work if a module is
// missing or throws while loading. Contract: renderBoard(items, { profile, interactive, size, onSwap, onRemove, onAdd })
// and occasionPicker({ value, onChange }).
import { SLOTS } from '../model.js';
import { h } from './dom.js';
import { itemArt } from './itemart.js';
import { allOccasions } from './data.js';

const SHOWN = SLOTS.filter((s) => s !== 'extra');

function fallbackBoard(items, { size = 'card' } = {}) {
  return h('div', { class: `board-fallback mini size-${size}`, 'aria-hidden': 'true' },
    SHOWN.map((s) => items[s]).filter(Boolean).map((it) => itemArt(it, { cls: 'tile', title: false })));
}

function fallbackPicker({ value, onChange }) {
  const occs = allOccasions();
  const wrap = h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Occasion' });
  const paint = (v) => {
    wrap.replaceChildren(...Object.entries(occs).map(([k, o]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(v === k),
      onclick: () => { paint(k); onChange && onChange(k); } }, `${o.emoji} ${o.label}`)));
  };
  paint(value);
  return wrap;
}

let cached = null;
export async function loadA() {
  if (cached) return cached;
  let renderBoard = fallbackBoard, occasionPicker = fallbackPicker, real = { board: false, occasions: false };
  try { const m = await import('./board.js'); if (typeof m.renderBoard === 'function') { renderBoard = m.renderBoard; real.board = true; } } catch (e) { console.warn('board.js unavailable', e.message); }
  try { const m = await import('./occasions.js'); if (typeof m.occasionPicker === 'function') { occasionPicker = m.occasionPicker; real.occasions = true; } } catch (e) { console.warn('occasions.js unavailable', e.message); }
  cached = { renderBoard, occasionPicker, real };
  return cached;
}

/** Call renderBoard and cope with a sync node or a promise of one. */
export function boardNode(renderBoard, items, opts) {
  const holder = h('div', { class: `board-holder size-${opts.size || 'card'}` });
  try {
    const r = renderBoard(items, opts);
    if (r && typeof r.then === 'function') r.then((n) => n && holder.append(n)).catch((e) => console.warn(e)); else if (r) holder.append(r);
  } catch (e) { console.warn('renderBoard failed', e); holder.append(fallbackBoard(items, opts)); }
  return holder;
}
