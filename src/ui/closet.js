// CLOSET screen: hangers on rails, one rail per slot.
import { SLOTS, SLOT_LABELS, FORMALITY } from '../model.js';
import { h, clear, cap } from './dom.js';
import { icon } from './icons.js';
import { mascot, illustrate } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz } from './fx.js';
import { toast, sheet, confirmDialog } from './overlay.js';
import { buildItemForm, itemToDraft, draftToItem } from './itemform.js';
import { data, saveItem, removeItem, removeDemo, loadDemo, demoCount } from './data.js';

const RAIL_SLOTS = SLOTS.filter((s) => s !== 'extra');
let filter = 'all';

const HANGER = `<svg class="hanger-svg" viewBox="0 0 60 30" aria-hidden="true" focusable="false"><path d="M30 14 V10 C30 6 36 6 36 2.5 C36 -0.5 31 -1 29 1.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M30 14 L5 27 H55 Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>`;

export function mount(root, { navigate }) {
  function railFor(slot, items) {
    const list = h('div', { class: 'rail', tabindex: '0', role: 'list', 'aria-label': `${SLOT_LABELS[slot]} rail`, 'data-slot': slot });
    items.forEach((it, i) => list.append(hang(it, i)));
    if (!items.length) {
      list.append(h('button', { class: 'hang ghost', type: 'button', role: 'listitem', onclick: () => navigate('snap') },
        h('span', { class: 'hanger-wrap', html: HANGER }), h('span', { class: 'ghost-box' }, h('span', { html: icon('plus', { size: 28 }) })), h('span', { class: 'hang-name' }, `Add ${SLOT_LABELS[slot].toLowerCase()}`)));
    }
    return h('section', { class: 'rail-sec' },
      h('div', { class: 'rail-head' }, h('h2', {}, SLOT_LABELS[slot]), h('span', { class: 'count-badge', 'aria-label': `${items.length} items` }, String(items.length))),
      h('div', { class: 'rod' }, list));
  }

  function hang(it, i) {
    let timer = null, longPressed = false, sx = 0, sy = 0;
    const open = h('button', { class: 'hang-item', type: 'button', 'aria-label': `${it.name}${it.available ? '' : ', in the wash'}. Edit.`,
      onclick: () => { if (longPressed) { longPressed = false; return; } editItem(it.id); },
      onpointerdown: (e) => { longPressed = false; sx = e.clientX; sy = e.clientY; timer = setTimeout(() => { longPressed = true; buzz(30); quickDelete(it); }, 650); },
      onpointermove: (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = null; } },
      onpointerup: () => { clearTimeout(timer); timer = null; }, onpointercancel: () => { clearTimeout(timer); timer = null; },
      oncontextmenu: (e) => e.preventDefault() },
      itemArt(it, { cls: 'tile big', title: false }),
      h('span', { class: 'hang-name' }, it.name),
      it.available ? null : h('span', { class: 'wash-tag' }, 'In the wash'),
      it.available ? null : h('span', { class: 'bubbles', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')));
    const wash = h('button', { class: 'wash-btn', type: 'button', 'aria-pressed': String(!it.available), 'aria-label': it.available ? `Send ${it.name} to the wash` : `Bring ${it.name} back from the wash`, title: it.available ? 'Send to the wash' : 'Back in the closet',
      html: icon('droplet', { size: 20 }), onclick: (e) => { e.stopPropagation(); toggleWash(it); } });
    return h('div', { class: `hang ${it.available ? '' : 'washing'}`, role: 'listitem', style: { '--i': i } }, h('span', { class: 'hanger-wrap', html: HANGER }), open, wash);
  }

  async function toggleWash(it) {
    const cur = data.items.find((x) => x.id === it.id) || it;
    await saveItem({ ...cur, available: !cur.available });
    buzz(12);
    toast(cur.available ? `${cur.name} is in the wash. The machine won’t pick it.` : `${cur.name} is clean and back on the rail.`, { action: 'Undo', onAction: () => saveItem({ ...cur }) });
  }

  async function quickDelete(it) {
    const undo = await removeItem(it.id);
    if (undo) toast(`Deleted ${it.name}.`, { action: 'Undo', onAction: () => undo(), ms: 6500 });
  }

  function editItem(id) {
    const orig = data.items.find((x) => x.id === id);
    if (!orig) return;
    const d = itemToDraft(orig);
    const preview = h('div', { class: 'edit-preview' });
    const paintPreview = () => {
      clear(preview);
      preview.append(itemArt(orig.photoId ? orig : { ...draftToItem(d, { id: orig.id }) }, { cls: 'tile huge', title: false }),
        h('div', { class: 'edit-meta' }, h('b', {}, draftToItem(d).name),
          h('small', {}, `${FORMALITY[d.formality]} · worn ${orig.worn.length}×${orig.worn.length ? ` (last ${orig.worn[orig.worn.length - 1]})` : ''}`)));
    };
    paintPreview();
    const form = buildItemForm(d, { onChange: () => paintPreview() });
    const save = h('button', { class: 'btn btn-cobalt', type: 'button' }, 'Save changes');
    const washBtn = h('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('droplet', { size: 18 })} ${orig.available ? 'Send to wash' : 'Back from wash'}` });
    const del = h('button', { class: 'btn btn-danger-ghost', type: 'button', html: `${icon('trash', { size: 18 })} Delete` });
    const content = h('div', { class: 'edit' }, preview, form, h('div', { class: 'sheet-actions' }, save, washBtn, del));
    const s = sheet({ title: 'Edit item', content });
    save.addEventListener('click', async () => {
      await saveItem(draftToItem(d, { photoId: orig.photoId, worn: orig.worn, createdAt: orig.createdAt, available: orig.available }));
      s.close(); toast('Saved.');
    });
    washBtn.addEventListener('click', async () => { s.close(); toggleWash(orig); });
    del.addEventListener('click', async () => { s.close(); quickDelete(orig); });
  }

  function render() {
    const prevScroll = {};
    root.querySelectorAll('.rail').forEach((r) => { prevScroll[r.dataset.slot] = r.scrollLeft; });
    const y = window.scrollY;
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Closet'));
    const items = data.items;
    const laundry = items.filter((i) => !i.available).length;
    if (!items.length) {
      root.append(h('div', { class: 'empty' },
        h('div', { class: 'empty-art', html: mascot('sad', { size: 150 }) }),
        h('h2', {}, 'Nothing hanging here yet'),
        h('p', {}, 'The rails are bare and the hangers are bored. Add a few pieces and they’ll be swaying in no time.'),
        h('div', { class: 'row gap center wrap' },
          h('button', { class: 'btn btn-tomato', type: 'button', onclick: () => navigate('snap') }, 'Add clothes'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Try a sample closet'))));
      return;
    }
    const n = demoCount();
    if (n) root.append(h('div', { class: 'demo-banner' }, h('span', {}, h('b', {}, 'Sample closet'), ' — not your clothes'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: async () => { const k = await removeDemo(); toast(`Removed ${k} sample items.`); } }, 'Remove')));
    const counts = Object.fromEntries(RAIL_SLOTS.map((s) => [s, items.filter((i) => i.slot === s).length]));
    const chip = (key, label, count) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === key), onclick: () => { filter = key; buzz(5); render(); } }, label, count != null ? h('b', { class: 'chip-count' }, String(count)) : null);
    root.append(h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'The Closet'), h('span', { class: 'page-sub' }, `${items.length} pieces${laundry ? `, ${laundry} in the wash` : ''}`)));
    root.append(h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Filter closet' },
      chip('all', 'All', items.length), ...RAIL_SLOTS.filter((s) => counts[s]).map((s) => chip(s, SLOT_LABELS[s], counts[s])), laundry ? chip('wash', 'Laundry', laundry) : null));
    const list = filter === 'wash' ? RAIL_SLOTS : (filter === 'all' ? RAIL_SLOTS : [filter]);
    for (const slot of list) {
      let its = items.filter((i) => i.slot === slot);
      if (filter === 'wash') { its = its.filter((i) => !i.available); if (!its.length) continue; }
      root.append(railFor(slot, its));
    }
    requestAnimationFrame(() => {
      root.querySelectorAll('.rail').forEach((r) => { if (prevScroll[r.dataset.slot]) r.scrollLeft = prevScroll[r.dataset.slot]; });
      window.scrollTo(0, y);
    });
  }

  render();
  return { update(what) { if (what === 'items') render(); } };
}
