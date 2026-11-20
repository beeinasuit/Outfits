// OUTFIT BOARD: a flat-lay of the outfit's real photos on a tactile surface.
//
// renderBoard(items, opts) -> HTMLElement (.fm-board)
//   items  Object<slot, Item>   slot -> item (top + bottom normally present; everything else optional)
//   opts   {
//     profile?:     Profile | null   when profile.cutoutId is set, the user's head-and-shoulders cutout sits at the top
//                                    so colors are seen next to their own face (pass ctx.profile; null = no face)
//     interactive?: boolean = true   swap / remove / lock controls + ghost "+ layer" chips (only honored for size 'full')
//     size?:        'full' | 'card' | 'mini' = 'full'   card/mini are static thumbnails sized by their parent's width
//     animate?:     boolean = (size === 'full')        pieces drop onto the surface on first render
//     locks?:       Object<slot, itemId>               pieces whose id matches show a pressed lock toggle
//     onSelect?(slot|null) pieces are buttons; tapping selects one (lifted + outlined) and the caller shows a toolbar. el.select(slot|null)
//     onSwap?(slot)  fallback when onSelect is absent: tapping a piece calls this directly
//     onAdd?(slot)   add an optional piece (ghost chips)
//     locks          locked pieces get a tiny lock badge (no per-piece buttons)
//     addable?:     string[]   which optional slots may show a ghost "+" chip (default layer/headwear/neckwear/belt)
//   }
//
// The element is self-contained: it sizes to its parent's width (aspect ratio follows the pieces present), uses
// container-query units for shadows, honors prefers-reduced-motion, and needs only styles/today.css.
// Extra methods on the returned element:
//   el.update(items, { animate = true })  diff by slot: unchanged pieces stay, new ones land, gone ones leave
//   el.flyOut({ keep = [] }) -> Promise   pieces (except `keep` slots) fly off the surface
//   el.setOptions(partial)                replace callbacks / locks / addable; re-renders controls
//   el.pieceEl(slot) -> HTMLElement|null
//   el.items                              current items
//
// Image priority per piece: cutoutId (transparent, no frame) > photoId (framed tile) > generated illustration.
import { SLOT_LABELS } from '../model.js';
import { h } from './dom.js';
import { illustrate } from './illustrations.js';
import { getPhotoURL } from '../store.js';
import { reduced } from './fx.js';

const OPTIONAL = new Set(['layer', 'neckwear', 'headwear', 'extra']);
const ADDABLE = ['layer', 'headwear', 'neckwear', 'belt'];
const ADD_LABEL = { layer: 'layer', headwear: 'hat', neckwear: 'tie', belt: 'belt' };
// Landing order (body first) so the pieces drop like an outfit being laid out.
const ORDER = ['top', 'bottom', 'shoes', 'layer', 'belt', 'neckwear', 'headwear', 'extra'];

// Boxes in board-width units (100 = full width). x,y top-left; r = resting rotation in degrees; z = stacking.
const BOX = {
  face: { x: 30, y: 0, w: 40, h: 29, r: 0, z: 1 },
  top: { x: 21, y: 23, w: 58, h: 46, r: 1.5, z: 3 },
  layer: { x: -1, y: 24, w: 56, h: 50, r: -5, z: 2 },
  neckwear: { x: 42, y: 25, w: 16, h: 30, r: 0, z: 6 },
  belt: { x: 22, y: 62, w: 56, h: 13, r: -1, z: 7 },
  bottom: { x: 24, y: 70, w: 52, h: 40, r: 0.6, z: 4 },
  shoes: { x: 18, y: 109, w: 64, h: 20, r: -1.2, z: 5 },
  headwear: { x: 66, y: 1, w: 31, h: 20, r: 9, z: 4 },
};
const EXTRA = { x: 80, w: 19, h: 19, y0: 44, step: 21 };

const swapSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5"/></svg>';
const lockSvg = (on) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2.5"/>${on ? '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<path d="M8 11V8a4 4 0 0 1 7.5-2"/>'}</svg>`;
const xSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const plusSvg = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';

/** Compute where every piece goes. Returns { H, boxes: Map<slotKey, box>, face, extras }. */
function layout(items, hasFace) {
  const hat = !!items.headwear;
  const off = hasFace ? 0 : hat ? 3 : 21; // without a face the body slides up
  const boxes = {};
  for (const s of ['top', 'layer', 'neckwear', 'belt', 'bottom', 'shoes']) {
    if (!items[s]) continue;
    const b = { ...BOX[s] };
    b.y -= off;
    boxes[s] = b;
  }
  if (items.layer && !items.top) boxes.layer.x = 20;
  if (items.headwear) {
    const b = { ...BOX.headwear };
    if (!hasFace) { b.x = 33; b.w = 34; b.h = 20; b.r = -3; }
    boxes.headwear = b;
  }
  if (hasFace) boxes.face = { ...BOX.face };
  const extras = [];
  if (items.extra) extras.push('extra');
  extras.forEach((s, i) => { boxes[s] = { x: EXTRA.x, y: EXTRA.y0 - off + i * EXTRA.step, w: EXTRA.w, h: EXTRA.h, r: 4, z: 3 }; });
  if (!items.top && !items.bottom) return { H: 126, boxes };
  let H = 40;
  for (const b of Object.values(boxes)) H = Math.max(H, b.y + b.h);
  return { H: H + 1.5, boxes };
}

const visKey = (it) => `${it.id}|${it.cutoutId || ''}|${it.photoId || ''}|${(it.colors || []).map((c) => c.hex).join(',')}|${it.pattern}`;

function stylePiece(el, box, H, order) {
  if (el.__ctl) stylePiece(el.__ctl, { ...box, r: 0 }, H, order);
  el.style.setProperty('--x', `${box.x}%`);
  el.style.setProperty('--y', `${(box.y / H) * 100}%`);
  el.style.setProperty('--w', `${box.w}%`);
  el.style.setProperty('--h', `${(box.h / H) * 100}%`);
  el.style.setProperty('--r', `${box.r}deg`);
  el.style.setProperty('--z', String(box.z));
  if (order != null) el.style.setProperty('--d', `${order * 85}ms`);
}

/** Put the best available image into `art`: cutout > photo > illustration (already there as placeholder). */
function loadImage(piece, art, item) {
  const tryId = (id, cls) => (id ? getPhotoURL(id).then((url) => new Promise((res) => {
    if (!url) return res(false);
    const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
    img.onload = () => { if (!piece.__alive) return res(false); art.replaceChildren(img); piece.classList.remove('is-illo'); piece.classList.add(cls); res(true); };
    img.onerror = () => res(false);
  })).catch(() => false) : Promise.resolve(false));
  tryId(item.cutoutId, 'is-cutout').then((ok) => { if (!ok) return tryId(item.photoId, 'is-photo'); return true; });
}

function makeFace(profile) {
  const art = h('span', { class: 'fm-art' });
  const piece = h('div', { class: 'fm-piece fm-face', 'data-slot': 'face', role: 'img', 'aria-label': 'You' }, h('span', { class: 'fm-spot', 'aria-hidden': 'true' }), art);
  piece.__alive = true;
  getPhotoURL(profile.cutoutId).then((url) => {
    if (!url) { piece.dispatchEvent(new CustomEvent('fm-noface', { bubbles: true })); return; }
    const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
    img.onerror = () => piece.dispatchEvent(new CustomEvent('fm-noface', { bubbles: true }));
    art.append(img);
  }).catch(() => piece.dispatchEvent(new CustomEvent('fm-noface', { bubbles: true })));
  return piece;
}

export function renderBoard(items, opts = {}) {
  const o = { profile: null, interactive: true, size: 'full', locks: {}, addable: ADDABLE, ...opts };
  if (o.animate === undefined) o.animate = o.size === 'full';
  const full = () => o.size === 'full' && o.interactive;
  const el = h('div', { class: `fm-board fm-${o.size}`, role: 'group', 'aria-label': 'Outfit board' });
  const stage = h('div', { class: 'fm-stage' });
  const ghosts = h('div', { class: 'fm-ghosts' });
  el.append(stage, ghosts);
  const pieces = new Map(); // key -> { el, item }
  let faceOff = false;
  let cur = {};
  let selected = null;
  function setSelected(slot) {
    if (slot && !pieces.get(slot)) slot = null;
    selected = slot;
    for (const [k, rec] of pieces) {
      const on = k === slot;
      rec.el.classList.toggle('is-selected', on);
      if (rec.el.tagName === 'BUTTON' && o.onSelect) rec.el.setAttribute('aria-pressed', String(on));
    }
  }
  const hasFace = () => !!(o.profile && o.profile.cutoutId) && !faceOff;

  /** Default state is clean: only a tiny lock badge on locked pieces. Actions live in the caller's toolbar (see onSelect). */
  function controls(slot, item, piece) {
    const c = piece.__ctl;
    if (!c) return;
    c.replaceChildren();
    if (o.locks && item && o.locks[slot] === item.id) c.append(h('span', { class: 'fm-lockbadge', 'aria-hidden': 'true', html: lockSvg(true) }));
  }

  function makePiece(slot, item) {
    const label = SLOT_LABELS[slot] || slot;
    const art = h('span', { class: 'fm-art', html: illustrate(item, { title: '' }) });
    if (slot === 'belt') { const svg = art.querySelector('svg'); if (svg) svg.setAttribute('preserveAspectRatio', 'none'); }
    const tappable = full() && (o.onSelect || o.onSwap);
    const piece = h(tappable ? 'button' : 'div', { class: 'fm-piece is-illo', 'data-slot': slot, 'data-item': item.id, type: tappable ? 'button' : null, role: tappable ? null : 'group',
      'aria-pressed': tappable && o.onSelect ? 'false' : null, 'aria-label': tappable ? `${item.name} (${label.toLowerCase()}), tap to change` : `${label}: ${item.name}` }, art);
    piece.__alive = true;
    if (tappable) {
      piece.classList.add('tappable');
      piece.addEventListener('click', () => { if (o.onSelect) el.select(selected === slot ? null : slot); else o.onSwap(slot); });
    }
    if (full()) { piece.__ctl = h('div', { class: 'fm-ctl', 'data-slot': slot }); controls(slot, item, piece); }
    loadImage(piece, art, item);
    return piece;
  }

  function syncGhosts(items_) {
    ghosts.replaceChildren();
    if (!full() || !o.onAdd) { ghosts.hidden = true; return; }
    const want = (o.addable || ADDABLE).filter((s) => {
      if (items_[s]) return false;
      if (s === 'neckwear' && !(items_.top && items_.top.collared)) return false;
      if (s === 'belt' && !(items_.bottom && items_.bottom.beltLoops === true)) return false;
      return true;
    });
    ghosts.hidden = !want.length;
    for (const s of want) {
      ghosts.append(h('button', { class: 'fm-ghost', type: 'button', 'data-slot': s, 'aria-label': `Add a ${ADD_LABEL[s]}`, onclick: () => o.onAdd(s) },
        h('span', { html: plusSvg }), ADD_LABEL[s]));
    }
  }

  function leave(p, animate) {
    p.__alive = false;
    if (p.__ctl) p.__ctl.remove();
    if (p.dataset.flown || !animate || reduced() || !p.animate) { p.remove(); return; }
    const a = p.animate([{ opacity: 1, transform: `rotate(${p.style.getPropertyValue('--r') || '0deg'}) scale(1)` }, { opacity: 0, transform: `translateY(-14%) rotate(${p.style.getPropertyValue('--r') || '0deg'}) scale(.86)` }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => p.remove(); a.oncancel = () => p.remove();
    p.style.pointerEvents = 'none';
  }

  function render(next, { animate = true, first = false } = {}) {
    cur = { ...next };
    const lay = layout(cur, hasFace());
    el.style.setProperty('--ar', `${100} / ${lay.H}`);
    stage.style.aspectRatio = `100 / ${lay.H}`;
    el.aspect = 100 / lay.H;
    // face
    if (hasFace()) {
      let f = pieces.get('face');
      if (!f || f.id !== o.profile.cutoutId) {
        if (f) leave(f.el, false);
        const fe = makeFace(o.profile);
        fe.addEventListener('fm-noface', () => { faceOff = true; leave(fe, false); pieces.delete('face'); render(cur, { animate: false }); }, { once: true });
        stage.append(fe);
        f = { el: fe, id: o.profile.cutoutId };
        pieces.set('face', f);
        if (animate) { fe.classList.add('fm-land'); fe.addEventListener('animationend', () => fe.classList.remove('fm-land'), { once: true }); }
      }
      stylePiece(f.el, lay.boxes.face, lay.H, 0);
    } else if (pieces.has('face')) { leave(pieces.get('face').el, false); pieces.delete('face'); }
    // items
    for (const [slot, rec] of [...pieces]) {
      if (slot === 'face') continue;
      if (!cur[slot]) { leave(rec.el, animate); pieces.delete(slot); }
    }
    ORDER.forEach((slot, idx) => {
      const item = cur[slot];
      if (!item) return;
      const box = lay.boxes[slot];
      let rec = pieces.get(slot);
      if (rec && !rec.el.dataset.flown && visKey(rec.item) === visKey(item)) {
        rec.item = item;
        stylePiece(rec.el, box, lay.H);
        // refresh control state (locks) in place
        if (rec.el.__ctl) { rec.el.__ctl.replaceChildren(); controls(slot, item, rec.el); }
        return;
      }
      const sameItem = !!rec && rec.item.id === item.id && !rec.el.dataset.flown;
      if (rec) leave(rec.el, animate && !sameItem);
      const pe = makePiece(slot, item);
      const doAnim = animate && !sameItem;
      stylePiece(pe, box, lay.H, idx);
      pe.style.setProperty('--fx', `${((slot.charCodeAt(0) % 7) - 3) * 3}%`);
      stage.append(pe);
      if (pe.__ctl) { stylePiece(pe, box, lay.H, idx); stage.append(pe.__ctl); if (doAnim && !reduced()) pe.__ctl.classList.add('fm-ctl-in'); }
      if (doAnim && !reduced()) { pe.classList.add('fm-land'); pe.addEventListener('animationend', () => pe.classList.remove('fm-land'), { once: true }); }
      pieces.set(slot, { el: pe, item });
    });
    el.classList.toggle('has-face', hasFace());
    if (selected && !pieces.get(selected)) { setSelected(null); o.onSelect && o.onSelect(null); } else setSelected(selected);
    syncGhosts(cur);
  }

  el.update = (next, { animate = true } = {}) => { el.items = next; render(next, { animate }); };
  el.setOptions = (partial) => { Object.assign(o, partial); if ('profile' in partial) faceOff = false; render(cur, { animate: false }); };
  el.select = (slot) => { setSelected(slot); if (o.onSelect) o.onSelect(selected); };
  el.selected = () => selected;
  stage.addEventListener('click', (e) => { if (selected && !e.target.closest('.fm-piece')) el.select(null); });
  el.pieceEl = (slot) => (pieces.get(slot) ? pieces.get(slot).el : null);
  el.flyOut = ({ keep = [] } = {}) => {
    const keepSet = new Set(keep);
    const jobs = [];
    let i = 0;
    for (const [slot, rec] of pieces) {
      if (slot === 'face') continue;
      if (keepSet.has(slot)) continue;
      const p = rec.el;
      if (reduced() || !p.animate) { continue; }
      p.dataset.flown = '1';
      if (p.__ctl) p.__ctl.style.opacity = '0';
      const dir = i++ % 2 ? 1 : -1;
      const r = p.style.getPropertyValue('--r') || '0deg';
      const a = p.animate([
        { transform: `translate(0,0) rotate(${r})`, opacity: 1 },
        { transform: `translate(${dir * 130}%, ${-40 - (i % 3) * 25}%) rotate(${dir * 38}deg) scale(.8)`, opacity: 0 },
      ], { duration: 340, delay: i * 30, easing: 'cubic-bezier(.5,0,.9,.4)', fill: 'forwards' });
      jobs.push(a.finished.catch(() => {}));
    }
    return Promise.all(jobs).then(() => {});
  };
  el.items = items;
  render(items, { animate: o.animate, first: true });
  return el;
}

export { ADDABLE, ADD_LABEL };
