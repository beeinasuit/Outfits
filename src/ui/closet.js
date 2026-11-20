// CLOSET screen: hangers on rails, one rail per slot.
import { SLOTS, SLOT_LABELS, FORMALITY, wearsSinceWash, newId } from '../model.js';
import { h, clear, cap, sleep } from './dom.js';
import { icon } from './icons.js';
import { mascot, illustrate } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz, reduced, confetti } from './fx.js';
import { toast, sheet, confirmDialog } from './overlay.js';
import { buildItemForm, itemToDraft, draftToItem } from './itemform.js';
import { data, saveItem, removeItem, removeDemo, loadDemo, demoCount, laundryDay, setClean, isDemo } from './data.js';

const RAIL_SLOTS = SLOTS.filter((s) => s !== 'extra');
let filter = 'all';

const HANGER = `<svg class="hanger-svg" viewBox="0 0 60 30" aria-hidden="true" focusable="false"><path d="M30 14 V10 C30 6 36 6 36 2.5 C36 -0.5 31 -1 29 1.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M30 14 L5 27 H55 Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>`;

const HAMPER = `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" focusable="false"><path d="M8 18h32l-3 22a3 3 0 0 1-3 2.6H14a3 3 0 0 1-3-2.6L8 18Z" fill="#ffc933" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M6 18h36M16 24v12M24 24v12M32 24v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M14 18c1-6 5-9 10-9s9 3 10 9" fill="#3fd6a0" stroke="currentColor" stroke-width="2.6"/></svg>`;
const safeHex = (x) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : '#8e9196');

/** Joyful washing machine: spinning drum full of the actual colors, bubbles, FRESH! stamp. Resolves when it is gone. */
async function washAnimation(items) {
  const hexes = items.slice(0, 7).map((i) => safeHex(i.colors && i.colors[0] && i.colors[0].hex));
  while (hexes.length < 5) hexes.push(['#ff5a3c', '#2f4bff', '#ffc933', '#3fd6a0', '#ff8fb1'][hexes.length]);
  const spots = [[78, 118, 17, 11], [118, 104, 15, 20], [98, 142, 18, -14], [124, 136, 13, 40], [74, 144, 13, -30], [100, 112, 12, 5], [92, 96, 11, 60]];
  const clothes = hexes.map((hx, i) => { const [x, y, r, rot] = spots[i]; return `<rect x="${x - r}" y="${y - r * .8}" width="${r * 2}" height="${r * 1.6}" rx="${r * .4}" fill="${hx}" stroke="#17141f" stroke-width="3" transform="rotate(${rot} ${x} ${y})"/>`; }).join('');
  const svg = `<svg class="wash-machine" viewBox="0 0 200 220" role="img" aria-label="A washing machine spinning your clothes"><rect x="12" y="10" width="176" height="200" rx="22" fill="#2f4bff" stroke="#17141f" stroke-width="5"/><path d="M12 56h176" stroke="#17141f" stroke-width="4"/><circle cx="42" cy="33" r="9" fill="#ffc933" stroke="#17141f" stroke-width="3.5"/><circle cx="70" cy="33" r="9" fill="#ff5a3c" stroke="#17141f" stroke-width="3.5"/><rect x="108" y="23" width="62" height="20" rx="10" fill="#3fd6a0" stroke="#17141f" stroke-width="3.5"/><circle cx="100" cy="132" r="64" fill="#fffaf0" stroke="#17141f" stroke-width="5"/><circle cx="100" cy="132" r="52" fill="#bfe3ff" stroke="#17141f" stroke-width="4"/><g class="drum" style="transform-origin:100px 132px">${clothes}</g><path d="M62 108a46 46 0 0 1 28-22" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".8"/></svg>`;
  const bubbles = Array.from({ length: 14 }, (_, i) => h('i', { style: { '--x': `${6 + ((i * 37) % 88)}%`, '--s': `${10 + ((i * 7) % 18)}px`, '--d': `${(i % 7) * 0.22}s`, '--t': `${1.8 + (i % 4) * 0.35}s` } }));
  const stamp = h('div', { class: 'wash-stamp' }, 'FRESH!');
  const el = h('div', { class: 'wash-overlay' + (reduced() ? ' calm' : ''), role: 'status', 'aria-label': 'Laundry day: washing everything' },
    h('div', { class: 'wash-stage' }, h('span', { html: svg }), h('div', { class: 'wash-bubbles', 'aria-hidden': 'true' }, bubbles), stamp));
  document.body.append(el);
  if (!reduced()) { await sleep(2300); confetti(window.innerWidth / 2, window.innerHeight * 0.45, 36); await sleep(500); }
  else await sleep(900);
  el.classList.add('out');
  await sleep(reduced() ? 250 : 350);
  el.remove();
}

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
    const since = wearsSinceWash(it);
    const open = h('button', { class: 'hang-item', type: 'button', 'aria-label': `${it.name}${it.available ? '' : `, in the hamper, worn ${since} time${since === 1 ? '' : 's'}`}. Edit.`,
      onclick: () => { if (longPressed) { longPressed = false; return; } editItem(it.id); },
      onpointerdown: (e) => { longPressed = false; sx = e.clientX; sy = e.clientY; timer = setTimeout(() => { longPressed = true; buzz(30); quickDelete(it); }, 650); },
      onpointermove: (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); timer = null; } },
      onpointerup: () => { clearTimeout(timer); timer = null; }, onpointercancel: () => { clearTimeout(timer); timer = null; },
      oncontextmenu: (e) => e.preventDefault() },
      itemArt(it, { cls: 'tile big', title: false }),
      h('span', { class: 'hang-name' }, it.name),
      it.available ? null : h('span', { class: 'wash-tag' }, 'In the hamper'),
      it.available ? null : h('span', { class: 'worn-info' }, `worn ${since}×`),
      it.available ? null : h('span', { class: 'bubbles', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')));
    const wash = h('button', { class: 'wash-btn', type: 'button', 'aria-pressed': String(!it.available), 'aria-label': it.available ? `Send ${it.name} to the hamper` : `Mark ${it.name} clean`, title: it.available ? 'Send to the hamper' : 'Mark clean',
      html: icon('droplet', { size: 20 }), onclick: (e) => { e.stopPropagation(); toggleWash(it); } });
    return h('div', { class: `hang ${it.available ? '' : 'washing'}`, role: 'listitem', style: { '--i': i } }, h('span', { class: 'hanger-wrap', html: HANGER }), open, wash);
  }

  async function toggleWash(it) {
    const cur = data.items.find((x) => x.id === it.id) || it;
    await setClean(cur, !cur.available);
    buzz(12);
    toast(cur.available ? `${cur.name} is in the hamper. It won’t be suggested.` : `${cur.name} is clean and back on the rail.`, { action: 'Undo', onAction: () => saveItem({ ...cur }) });
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
          h('small', {}, `${FORMALITY[d.formality]} · worn ${orig.worn.length}×${orig.worn.length ? ` (last ${orig.worn[orig.worn.length - 1]})` : ''}`),
          h('small', {}, orig.available ? `${wearsSinceWash(orig)} wear${wearsSinceWash(orig) === 1 ? '' : 's'} since last wash` : 'In the hamper')));
    };
    paintPreview();
    const form = buildItemForm(d, { onChange: () => paintPreview() });
    const save = h('button', { class: 'btn btn-cobalt', type: 'button' }, 'Save changes');
    const washBtn = h('button', { class: 'btn btn-ghost', type: 'button', html: `${icon('droplet', { size: 18 })} ${orig.available ? 'Send to hamper' : 'Mark clean'}` });
    const del = h('button', { class: 'btn btn-danger-ghost', type: 'button', html: `${icon('trash', { size: 18 })} Delete` });
    const content = h('div', { class: 'edit' }, preview, form, h('div', { class: 'sheet-actions' }, save, washBtn, del));
    const s = sheet({ title: 'Edit item', content });
    save.addEventListener('click', async () => {
      // Editing a sample piece makes it the user's own: new id, so "Remove samples" / "Load samples" never touch it.
      const adopt = isDemo(orig);
      await saveItem(draftToItem(d, { id: adopt ? newId() : orig.id, photoId: orig.photoId, cutoutId: orig.cutoutId, worn: orig.worn, lastWashed: orig.lastWashed, createdAt: orig.createdAt, available: orig.available }));
      if (adopt) await removeItem(orig.id);
      s.close(); toast('Saved.');
    });
    washBtn.addEventListener('click', async () => { s.close(); toggleWash(orig); });
    del.addEventListener('click', async () => { s.close(); quickDelete(orig); });
  }

  let washing = false;
  async function runLaundry() {
    if (washing) return;
    washing = true;
    const hampered = data.items.filter((i) => !i.available);
    const total = data.items.length;
    buzz([20, 40, 20]);
    const anim = washAnimation(hampered.length ? hampered : data.items.slice(0, 6));
    let n = 0;
    try { n = await laundryDay(); } catch (e) { console.warn(e); }
    await anim;
    buzz([30, 40, 60]);
    washing = false;
    toast(n ? `${n} piece${n === 1 ? '' : 's'} fresh and ready` : `All ${total} pieces freshened up, wear counts reset`, { ms: 5000 });
  }

  function laundryBar(n) {
    return h('section', { class: 'laundry-bar', 'aria-label': 'Laundry' },
      h('div', { class: 'hamper' },
        h('span', { class: 'hamper-ico', 'aria-hidden': 'true', html: HAMPER }),
        h('div', {}, h('b', { class: 'hamper-count', 'aria-live': 'polite' }, n ? `${n} in the hamper` : 'Hamper’s empty'), h('small', {}, n ? 'Grayed out below and left out of outfits' : 'Everything is fresh'))),
      h('button', { class: 'laundry-btn', type: 'button', onclick: runLaundry },
        h('span', { class: 'laundry-btn-ico', 'aria-hidden': 'true', html: icon('droplet', { size: 24, sw: 2.6 }) }),
        h('span', { class: 'laundry-btn-txt' }, h('b', {}, 'Laundry Day'), h('small', {}, 'Wash everything, reset wears'))));
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
    if (filter === 'wash' && !laundry) filter = 'all';
    root.append(h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'The Closet'), h('span', { class: 'page-sub' }, `${items.length} pieces${laundry ? `, ${laundry} in the hamper` : ''}`)));
    root.append(laundryBar(laundry));
    root.append(h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Filter closet' },
      chip('all', 'All', items.length), ...RAIL_SLOTS.filter((s) => counts[s]).map((s) => chip(s, SLOT_LABELS[s], counts[s])), laundry ? chip('wash', 'Hamper', laundry) : null));
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
