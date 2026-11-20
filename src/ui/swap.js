// Single-item swap sheet.
//
//   openSwap(slot, outfitItems, ctx, onApply) -> { close }
//     slot         which slot to change ('top', 'shoes', 'layer', ...)
//     outfitItems  Object<slot, Item> current outfit
//     ctx          engine context from data.getContext()
//     onApply      ({ items, score, reasons, delta, slot, item, via }) => void
//                  `items` is the full resulting outfit (belt rules applied by rankForSlot), `via` is 'suggest' | 'pick'
//
// Two tabs:
//   Suggest   rankForSlot results with score, coloured delta and the top reason. Hamper items are hidden.
//   I'll pick the closet's items for the slot with no scores or hints; hamper items are greyed and not selectable.
//             The caller shows the resulting score change ("you would then score").
import { SLOT_LABELS } from '../model.js';
import { rankForSlot } from '../engine/build.js';
import { h } from './dom.js';
import { sheet } from './overlay.js';
import { itemArt } from './itemart.js';
import { data } from './data.js';
import { buzz } from './fx.js';

const REQUIRED = new Set(['top', 'bottom', 'shoes']);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

export function openSwap(slot, outfitItems, ctx, onApply) {
  const label = (SLOT_LABELS[slot] || slot).toLowerCase();
  const cur = outfitItems[slot] || null;
  const rows = rankForSlot(data.items, outfitItems, slot, ctx);
  const rowFor = (item) => rows.find((r) => (r.item ? r.item.id : null) === (item ? item.id : null));
  let tab = 'suggest';
  let s;

  const apply = (row, via) => {
    if (!row) return;
    buzz(14);
    s.close();
    if ((row.item ? row.item.id : null) === (cur ? cur.id : null)) return; // same item: nothing changes
    onApply({ items: row.items, score: row.score, reasons: row.reasons, delta: row.delta, slot, item: row.item, via });
  };

  // ---------- Suggest ----------
  function suggestPanel() {
    const list = h('ul', { class: 'sw-list', role: 'list' });
    if (!rows.length || (rows.length === 1 && rows[0].item && cur && rows[0].item.id === cur.id)) {
      list.append(h('li', { class: 'sw-empty' }, h('p', {}, `No other ${label} in the closet that is clean right now.`)));
    }
    for (const r of rows) {
      const isCur = (r.item ? r.item.id : null) === (cur ? cur.id : null);
      if (!r.item && !cur) continue; // "none" while already none: pointless
      const reason = r.reasons && r.reasons[0];
      const name = r.item ? r.item.name : `No ${label}`;
      const sub = r.item ? (reason ? reason.text : 'Nothing notable either way.') : `Go without a ${label}`;
      const tone = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat';
      const art = r.item ? itemArt(r.item, { cls: 'tile sw-thumb', title: false }) : h('span', { class: 'art tile sw-thumb sw-none', 'aria-hidden': 'true' }, '∅');
      const btn = h('button', { class: `sw-row${isCur ? ' is-current' : ''}`, type: 'button', 'data-item': r.item ? r.item.id : 'none',
        'aria-label': `${name}. Score ${r.score}${isCur ? ', currently on' : `, ${signed(r.delta)}`}. ${sub}`,
        onclick: () => apply(r, 'suggest') },
      art,
      h('span', { class: 'sw-text' }, h('b', {}, name), h('small', {}, sub)),
      h('span', { class: 'sw-score' },
        h('span', { class: 'sw-num' }, String(r.score)),
        isCur ? h('span', { class: 'sw-tag' }, 'On now') : h('span', { class: `sw-delta ${tone}` }, signed(r.delta))));
      list.append(h('li', {}, btn));
    }
    return list;
  }

  // ---------- I'll pick ----------
  function pickPanel() {
    const all = data.items.filter((i) => i.slot === slot).sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));
    const grid = h('div', { class: 'sw-grid' });
    if (!REQUIRED.has(slot) && cur) {
      grid.append(h('button', { class: 'sw-tile sw-none-tile', type: 'button', onclick: () => apply(rowFor(null), 'pick') }, h('span', { class: 'art tile sw-big', 'aria-hidden': 'true' }, '∅'), h('b', {}, `No ${label}`)));
    }
    for (const it of all) {
      const isCur = cur && cur.id === it.id;
      const wash = it.available === false;
      grid.append(h('button', { class: `sw-tile${isCur ? ' is-current' : ''}${wash ? ' is-wash' : ''}`, type: 'button', 'data-item': it.id, disabled: wash,
        'aria-label': `${it.name}${wash ? ', in the wash' : ''}${isCur ? ', on now' : ''}`,
        onclick: () => apply(rowFor(it), 'pick') },
      itemArt(it, { cls: 'tile sw-big', title: false }),
      h('b', {}, it.name),
      wash ? h('small', {}, 'in the wash') : isCur ? h('small', {}, 'on now') : null));
    }
    if (!all.length) grid.append(h('p', { class: 'hint' }, `No ${label} in the closet yet.`));
    return grid;
  }

  const panel = h('div', { class: 'sw-panel', role: 'tabpanel' });
  const tabs = h('div', { class: 'sw-tabs', role: 'tablist', 'aria-label': `Change ${label}` });
  const defs = [['suggest', 'Suggest'], ['pick', 'I’ll pick']];
  function paint() {
    for (const b of tabs.children) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    panel.replaceChildren(tab === 'suggest' ? suggestPanel() : pickPanel());
    panel.setAttribute('aria-labelledby', `sw-tab-${tab}`);
    const c = panel.querySelector('.is-current');
    if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'center' }); } catch { /* ignore */ } }
  }
  for (const [k, t] of defs) {
    tabs.append(h('button', { class: 'sw-tab', type: 'button', role: 'tab', id: `sw-tab-${k}`, 'data-tab': k, onclick: () => { tab = k; paint(); } }, t));
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    tab = tab === 'suggest' ? 'pick' : 'suggest';
    paint();
    tabs.querySelector(`[data-tab="${tab}"]`).focus();
  });

  const intro = h('p', { class: 'sw-intro' }, cur ? h('span', {}, 'Now: ', h('b', {}, cur.name)) : `Nothing on as a ${label} yet.`);
  s = sheet({ title: `${cur ? 'Change' : 'Add'} ${label}`, content: h('div', { class: 'swap-root' }, intro, tabs, panel) });
  paint();
  return s;
}
