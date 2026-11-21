// FIT CHECK ("Rate what I'm wearing"): photo -> line up -> which pieces -> score -> log it to the diary.
// Everything happens on the phone: the photo is read by src/vision/wearing.js, pieces are matched with
// src/engine/match.js, the score comes from the same engine as Today. No network.
import { SLOTS, SLOT_LABELS, KINDS, COLOR_FAMILIES, NEAR_FACE, makeItem, makeCheck, outfitKey, todayISO, newId } from '../model.js';
import { roastOutfit } from '../engine/roast.js';
import { scoreOutfit } from '../engine/score.js';
import { rankForSlot } from '../engine/build.js';
import { matchBand } from '../engine/match.js';
import { h, clear, cap, nextFrame } from './dom.js';
import { icon } from './icons.js';
import { mascot, illustrate } from './illustrations.js';
import { buzz, confetti, countUp, reduced, verdict } from './fx.js';
import { toast, announce, sheet } from './overlay.js';
import { occasionPicker } from './occasions.js';
import { getPhotoURL } from '../store.js';
import { data, getContext, allOccasions, saveCheck, saveItem, logWorn, setFeedback, setSetting } from './data.js';

const BAND_SLOTS = ['top', 'bottom', 'shoes'];
const OPTIONAL = ['layer', 'belt', 'neckwear', 'headwear'];
const OPT_LABEL = { layer: 'Jacket or layer', belt: 'Belt', neckwear: 'Tie or scarf', headwear: 'Hat' };
const GUIDE_DEFS = [
  { key: 'neck', label: 'Neck', side: 'l', min: 0.05, aria: 'Neck line' },
  { key: 'waist', label: 'Waist', side: 'r', aria: 'Waist line' },
  { key: 'hem', label: 'Pant hem', side: 'l', aria: 'Pant hem line' },
  { key: 'ankle', label: 'Ankles', side: 'r', max: 0.97, aria: 'Ankle line' },
];
const GAPS = { neck: [0, 0.06], waist: [0.06, 0.08], hem: [0.08, 0], ankle: [0, 0] }; // min distance to the line above / below
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
const famName = (f) => String(f || '').replace('-', ' ');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const inCloset = (it) => !!it && data.items.some((x) => x.id === it.id);

// Flow state survives tab switches (like the Add-clothes screen) until the user starts over or saves.
const S = {
  step: 'start', error: '', busyMsg: '', photo: null, guide: null, analysis: null, matches: {},
  sel: {}, skipped: {}, occasion: null, mood: null, note: '', result: null, saved: null, saving: false, seed: newId(),
};
let mods = null;
async function vision() {
  if (!mods) {
    const [img, wear] = await Promise.all([import('../vision/image.js'), import('../vision/wearing.js')]);
    mods = { ...img, ...wear };
  }
  return mods;
}

function resetFlow() {
  if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
  Object.assign(S, { step: 'start', error: '', busyMsg: '', photo: null, guide: null, analysis: null, matches: {}, sel: {}, skipped: {},
    occasion: null, mood: null, note: '', result: null, saved: null, saving: false, seed: newId() });
}

/** Item picture: cutout when there is one, then the photo, then the drawn illustration. */
function thumb(item, cls = 'tile') {
  const el = h('span', { class: `art ${cls}`, html: illustrate(item, { title: '' }) });
  const id = item.cutoutId || item.photoId;
  if (id) {
    getPhotoURL(id).then((url) => {
      if (!url) return;
      const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
      img.addEventListener('load', () => { el.classList.add('has-photo'); if (item.cutoutId) el.classList.add('is-cutout'); el.replaceChildren(img); });
    }).catch(() => {});
  }
  if (item.available === false) el.classList.add('is-wash');
  return el;
}

function leatherFor(family) {
  return ({ black: 'black', brown: 'brown', beige: 'tan', cream: 'tan', burgundy: 'burgundy', white: 'white' })[family] || 'brown';
}

export function mount(root, { navigate }) {
  let alive = true;
  let first = true;

  const camInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', capture: 'user', 'aria-label': 'Take a photo of your outfit', tabindex: '-1', onchange: (e) => onFiles(e.target.files) });
  const libInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', 'aria-label': 'Choose an outfit photo from your library', tabindex: '-1', onchange: (e) => onFiles(e.target.files) });

  function go(step, { focus = true } = {}) { S.step = step; render(focus); }

  // ---------- shared chrome ----------
  function stepper(n) {
    const names = ['Photo', 'Line up', 'Pieces', 'Score'];
    return h('ol', { class: 'ck-steps', 'aria-label': `Step ${n} of 4: ${names[n - 1]}` }, names.map((t, i) =>
      h('li', { class: i + 1 === n ? 'now' : i + 1 < n ? 'done' : '', 'aria-current': i + 1 === n ? 'step' : null }, h('span', { class: 'ck-dot', 'aria-hidden': 'true' }, i + 1 < n ? '✓' : String(i + 1)), h('span', { class: 'ck-step-name' }, t))));
  }
  const title = (text, sub) => h('div', { class: 'page-head' }, h('h2', { class: 'page-title', id: 'screen-title', tabindex: '-1' }, text), sub ? h('span', { class: 'page-sub' }, sub) : null);

  // ---------- 1. capture ----------
  function startView() {
    const art = h('span', { class: 'ck-tip-art', 'aria-hidden': 'true', html: `<svg viewBox="0 0 80 120" width="64" height="96"><circle cx="40" cy="14" r="10" fill="#f1c9a5" stroke="#17141f" stroke-width="2.5"/><path d="M22 30h36l6 34-9 3-3-16v32H28V51l-3 16-9-3 6-34Z" fill="#2f4bff" stroke="#17141f" stroke-width="2.5" stroke-linejoin="round"/><path d="M28 83h11v28H28zM41 83h11v28H41z" fill="#ffc933" stroke="#17141f" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 111h16v6H24zM40 111h16v6H40z" fill="#3fd6a0" stroke="#17141f" stroke-width="2.5" stroke-linejoin="round"/></svg>` });
    const small = data.items.length < 4;
    return h('div', { class: 'ck-start' },
      stepper(1),
      title('Rate my fit', 'How do you look today?'),
      h('div', { class: 'snap-actions' },
        h('button', { class: 'big-tile tomato', type: 'button', 'data-act': 'camera', onclick: () => camInput.click() }, h('span', { html: icon('camera', { size: 38, sw: 2.2 }) }), h('b', {}, 'Take a photo'), h('small', {}, 'Mirror selfie works')),
        h('button', { class: 'big-tile cobalt', type: 'button', 'data-act': 'library', onclick: () => libInput.click() }, h('span', { html: icon('image', { size: 38, sw: 2.2 }) }), h('b', {}, 'From library'), h('small', {}, 'Pick a photo'))),
      camInput, libInput,
      h('aside', { class: 'tip-card ck-tip' }, art,
        h('div', {}, h('h3', {}, 'For the best read'),
          h('ul', {}, h('li', {}, 'Stand in front of a mirror, head to toe'), h('li', {}, 'Good light, plain wall behind you if you can'), h('li', {}, 'Arms relaxed, jacket open or closed is fine')))),
      small ? h('p', { class: 'hint ck-small-note' }, 'Your closet is still small, so I’ll ask you to describe a few pieces. Add more clothes any time for sharper matches.') : null,
      S.error ? h('p', { class: 'error-note', role: 'alert' }, S.error) : null);
  }

  async function onFiles(list) {
    const picked = list ? [...list] : [];
    const file = picked.find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    camInput.value = ''; libInput.value = ''; // the FileList is live: copy first, then clear
    if (!picked.length) return;
    if (!file) { toast('That doesn’t look like a photo.'); return; }
    busy('Getting a good look at you…');
    try {
      const v = await vision();
      await nextFrame();
      const bitmap = await v.fileToBitmap(file);
      const canvas = v.bitmapToCanvas(bitmap, 1024);
      try { bitmap.close && bitmap.close(); } catch { /* ignore */ }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('encode');
      const keep = S.photo;
      resetFlow();
      if (keep && keep.url) URL.revokeObjectURL(keep.url);
      S.photo = { canvas, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height };
      S.guide = { ...v.DEFAULT_GUIDE };
      if (alive) go('align');
    } catch (e) {
      console.warn(e);
      S.error = 'Couldn’t read that photo. Try another one.';
      if (alive) go('start');
    }
  }

  function busy(msg) { S.step = 'busy'; S.busyMsg = msg; render(false); }
  function busyView() {
    return h('div', { class: 'busy', role: 'status' }, h('div', { class: 'busy-art', html: mascot('wow', { size: 140 }) }), h('h2', {}, S.busyMsg || 'One sec…'), h('div', { class: 'loader', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  }

  // ---------- 2. line it up ----------
  function alignView() {
    const P = S.photo;
    const g = S.guide;
    const stage = h('div', { class: 'ck-stage', style: { '--ar': String(P.w / P.h) } });
    const img = h('img', { src: P.url, alt: 'Your photo, with lines to drag onto your neck, waist, pant hem and ankles', draggable: 'false' });
    const zones = h('div', { class: 'ck-zones', 'aria-hidden': 'true' },
      h('span', { class: 'ck-zone z-top' }, h('i', {}, 'TOP')), h('span', { class: 'ck-zone z-bottom' }, h('i', {}, 'BOTTOM')), h('span', { class: 'ck-zone z-shoes' }, h('i', {}, 'SHOES')));
    stage.append(img, zones);
    const paint = () => { for (const d of GUIDE_DEFS) stage.style.setProperty(`--${d.key}`, String(g[d.key])); };
    const handles = GUIDE_DEFS.map((d, idx) => {
      const order = GUIDE_DEFS.map((x) => x.key);
      const bounds = () => {
        const above = idx > 0 ? g[order[idx - 1]] + GAPS[order[idx - 1]][1] : 0.04;
        const below = idx < order.length - 1 ? g[order[idx + 1]] - GAPS[d.key][1] : 0.97;
        return [Math.max(d.min || 0, above), Math.min(d.max || 1, below, 0.97)];
      };
      const el = h('div', { class: `ck-handle side-${d.side}`, role: 'slider', tabindex: '0', 'data-key': d.key, 'aria-label': d.aria, 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('span', { class: 'ck-hline', 'aria-hidden': 'true' }), h('span', { class: 'ck-grip' }, h('span', { class: 'ck-grip-ico', 'aria-hidden': 'true' }, '↕'), d.label));
      const set = (v) => {
        const [lo, hi] = bounds();
        g[d.key] = clamp(v, lo, Math.max(lo, hi));
        el.setAttribute('aria-valuenow', String(Math.round(g[d.key] * 100)));
        el.setAttribute('aria-valuetext', `${d.label} at ${Math.round(g[d.key] * 100)} percent from the top of the photo`);
        paint();
      };
      el.style.setProperty('--y', 'var(--' + d.key + ')');
      let grab = 0, active = false;
      el.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        const r = stage.getBoundingClientRect();
        grab = e.clientY - (r.top + g[d.key] * r.height);
        active = true; el.classList.add('drag');
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!active) return;
        const r = stage.getBoundingClientRect();
        set((e.clientY - grab - r.top) / r.height);
      });
      const end = () => { active = false; el.classList.remove('drag'); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', (e) => {
        const big = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown';
        const step = big ? 0.05 : 0.01;
        let v = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') v = g[d.key] - step;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') v = g[d.key] + step;
        else if (e.key === 'Home') v = 0; else if (e.key === 'End') v = 1;
        if (v == null) return;
        e.preventDefault(); set(v); buzz(4);
      });
      set(g[d.key]);
      return el;
    });
    stage.append(...handles);

    return h('div', { class: 'ck-align' },
      stepper(2),
      title('Line it up', 'Four quick drags'),
      h('p', { class: 'hint ck-lead' }, 'Slide each tag onto your neck, waist, pant hem and ankles so I know where your top, bottoms and shoes are. Arrow keys work too.'),
      h('div', { class: 'stage-wrap' }, stage),
      S.error ? h('div', { class: 'ck-problem', role: 'alert' }, h('p', {}, S.error), h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'data-act': 'manual', onclick: manualPick }, 'Choose my pieces by hand')) : null,
      h('div', { class: 'ck-nav' },
        h('button', { class: 'btn btn-cobalt btn-big ck-go', type: 'button', 'data-act': 'read', onclick: analyze }, h('span', { html: icon('sparkle', { size: 22, sw: 2.6 }) }), 'Read my outfit'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { resetFlow(); go('start'); } }, 'Different photo')));
  }

  async function analyze() {
    S.error = '';
    busy('Reading your outfit…');
    try {
      const v = await vision();
      await nextFrame();
      const im = v.canvasImageData(S.photo.canvas, 480);
      await nextFrame();
      const res = v.analyzeWearing(im, { guide: S.guide });
      if (!alive) return;
      if (!res.ok) { S.error = res.reason; go('align', { focus: false }); return; }
      S.analysis = res;
      afterAnalysis();
    } catch (e) {
      console.warn(e);
      S.error = 'I couldn’t read that photo. Try nudging the lines, or choose your pieces by hand.';
      if (alive) go('align', { focus: false });
    }
  }

  function manualPick() {
    S.analysis = { ok: true, manual: true, bands: {} };
    afterAnalysis();
  }

  function afterAnalysis() {
    S.sel = {}; S.skipped = {}; S.matches = {}; S.result = null; S.mood = null; S.note = ''; S.saved = null;
    const bands = S.analysis.bands;
    for (const slot of [...BAND_SLOTS, 'layer']) if (bands[slot]) S.matches[slot] = matchBand(bands[slot], data.items, slot, { limit: 3 });
    go('what');
  }

  // ---------- 3. what are you wearing ----------
  const bandSlots = () => [...BAND_SLOTS, ...(S.analysis && S.analysis.bands.layer ? ['layer'] : [])];
  const chosen = (slot) => (S.sel[slot] && S.sel[slot].item) || null;

  function swatches(band) {
    if (!band || !band.colors || !band.colors.length) return null;
    const cs = band.colors.filter((c, i) => i === 0 || c.weight >= 0.18).slice(0, 3);
    return h('span', { class: 'ck-saw' }, h('span', { class: 'ck-saw-label' }, 'I see'),
      cs.map((c) => h('span', { class: 'ck-saw-chip' }, h('span', { class: 'ck-swatch', style: { background: c.hex }, 'aria-hidden': 'true' }), famName(c.family))),
      band.pattern && band.pattern !== 'solid' ? h('span', { class: 'ck-saw-chip pat' }, `${band.pattern}-ish`) : null);
  }

  function selectItem(slot, item, { extra = false } = {}) {
    S.sel[slot] = { item, extra }; delete S.skipped[slot];
    if (slot === 'bottom' && item.beltLoops !== true) delete S.sel.belt;
    buzz(10);
  }

  function matchTile(slot, m, i) {
    const on = chosen(slot) && chosen(slot).id === m.item.id;
    const tag = i === 0 && m.good ? 'Best guess' : m.good ? 'Close' : 'Maybe';
    return h('button', { class: `ck-match${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-item': m.item.id, 'data-focus': m.item.id,
      onclick: () => { selectItem(slot, m.item); paintBand(slot, m.item.id); refreshRest(); } },
    thumb(m.item, 'tile ck-thumb'), h('b', {}, m.item.name), h('small', { class: m.good ? 'good' : '' }, tag));
  }

  function bandCard(slot) {
    const band = S.analysis.bands[slot];
    const ms = S.matches[slot] || [];
    const cur = chosen(slot);
    const label = slot === 'layer' ? 'Layer' : SLOT_LABELS[slot];
    const tiles = ms.map((m, i) => matchTile(slot, m, i));
    const curKnown = cur && ms.some((m) => m.item.id === cur.id);
    if (cur && !curKnown) {
      tiles.push(h('button', { class: 'ck-match on pick', type: 'button', 'aria-pressed': 'true', 'data-item': cur.id, 'data-focus': cur.id, 'aria-label': `${cur.name}, your pick. Tap to open the picker`, onclick: () => openPicker(slot) },
        thumb(cur, 'tile ck-thumb'), h('b', {}, cur.name), h('small', {}, S.sel[slot].extra ? 'Not in closet' : 'Your pick')));
    }
    const skipped = !!S.skipped[slot];
    const optionalSlot = slot === 'shoes' || slot === 'layer';
    return h('article', { class: `ck-band${cur ? ' done' : ''}${skipped ? ' skipped' : ''}`, 'data-slot': slot, 'aria-label': label },
      h('header', { class: 'ck-band-head' },
        h('h3', {}, label, cur ? h('span', { class: 'ck-ok', 'aria-label': 'chosen' }, '✓') : null),
        swatches(band)),
      skipped ? h('p', { class: 'hint ck-skipnote' }, slot === 'layer' ? 'No layer. Got it.' : 'Skipping the shoes. Got it.')
        : tiles.length ? h('div', { class: 'ck-matches', role: 'group', 'aria-label': `Closet pieces that look like your ${label.toLowerCase()}` }, tiles)
          : h('p', { class: 'hint ck-nomatch' }, `Nothing like this ${label.toLowerCase()} in your closet yet. Pick one by hand, or add it as a one-off.`),
      h('div', { class: 'ck-band-actions' },
        h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'data-act': 'else', onclick: () => openPicker(slot) }, 'Something else…'),
        h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'data-act': 'extra', onclick: () => openExtra(slot) }, 'Not in my closet'),
        optionalSlot ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'aria-pressed': String(skipped), 'data-act': 'skip',
          onclick: () => { if (skipped) delete S.skipped[slot]; else { S.skipped[slot] = true; delete S.sel[slot]; } paintBand(slot); refreshRest(); } }, skipped ? 'Add it back' : 'Skip') : null));
  }

  function paintBand(slot, focusId) {
    const old = root.querySelector(`.ck-band[data-slot="${slot}"]`);
    if (!old) return;
    const nu = bandCard(slot);
    old.replaceWith(nu);
    if (focusId) { const f = nu.querySelector(`[data-focus="${CSS.escape(focusId)}"]`); if (f) f.focus({ preventScroll: true }); }
  }

  function openPicker(slot, { optional = false } = {}) {
    const label = (optional ? OPT_LABEL[slot] : SLOT_LABELS[slot]).toLowerCase();
    const items = data.items.filter((i) => i.slot === slot).sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name));
    const cur = chosen(slot);
    const s = { sh: null };
    const pick = (it) => { selectItem(slot, it); s.sh.close(); afterPick(slot, optional, it.id); };
    const grid = h('div', { class: 'sw-grid' });
    if (optional) grid.append(h('button', { class: 'sw-tile', type: 'button', 'data-item': 'none', onclick: () => { delete S.sel[slot]; if (slot === 'layer') S.skipped.layer = true; s.sh.close(); afterPick(slot, optional); } },
      h('span', { class: 'art tile sw-big sw-none', 'aria-hidden': 'true' }, '∅'), h('b', {}, `No ${label}`)));
    for (const it of items) {
      const on = cur && cur.id === it.id;
      grid.append(h('button', { class: `sw-tile${on ? ' is-current' : ''}`, type: 'button', 'data-item': it.id, 'aria-pressed': String(!!on), onclick: () => pick(it) },
        thumb(it, 'tile sw-big'), h('b', {}, it.name), it.available === false ? h('small', {}, 'in the wash') : on ? h('small', {}, 'chosen') : null));
    }
    if (!items.length) grid.append(h('p', { class: 'hint' }, `No ${label} in your closet yet.`));
    s.sh = sheet({ title: optional ? `Wearing a ${label}?` : `Which ${label}?`, content: h('div', { class: 'ck-picker' }, grid,
      !optional ? h('div', { class: 'row gap center' }, h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => { s.sh.close(); openExtra(slot); } }, 'Not in my closet')) : null) });
  }

  function afterPick(slot, optional, focusId) {
    if (BAND_SLOTS.includes(slot) || slot === 'layer' && S.analysis.bands.layer) paintBand(slot, focusId);
    refreshRest();
  }

  function openExtra(slot) {
    const band = S.analysis.bands[slot];
    const kinds = Object.keys(KINDS[slot] || {});
    let kind = kinds[0];
    let fam = band && band.colors && band.colors[0] ? band.colors[0].family : 'gray';
    const detected = band && band.colors && band.colors[0] ? band.colors[0].family : null;
    const kindRow = h('div', { class: 'chips ck-kinds', role: 'group', 'aria-label': 'What kind of piece is it?' });
    const colorRow = h('div', { class: 'chips ck-colors', role: 'group', 'aria-label': 'Its main color' });
    const paint = () => {
      kindRow.replaceChildren(...kinds.map((k) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === kind), 'data-kind': k, onclick: () => { kind = k; paint(); } }, k)));
      colorRow.replaceChildren(...Object.keys(COLOR_FAMILIES).map((f) => h('button', { class: 'chip ck-color-chip', type: 'button', 'aria-pressed': String(f === fam), 'data-family': f, onclick: () => { fam = f; paint(); } },
        h('span', { class: 'ck-swatch', style: { background: COLOR_FAMILIES[f].hex }, 'aria-hidden': 'true' }), famName(f))));
    };
    paint();
    const s = { sh: null };
    const done = h('button', { class: 'btn btn-mint', type: 'button', 'data-act': 'use-extra', onclick: () => {
      const colors = band && band.colors && band.colors.length && fam === detected ? band.colors : [{ hex: COLOR_FAMILIES[fam].hex, family: fam, weight: 1 }];
      const d = KINDS[slot][kind] || {};
      const material = d.material;
      const it = makeItem({ slot, kind, colors, pattern: band ? band.pattern : 'solid', ...(material === 'leather' ? { leather: leatherFor(fam) } : {}) });
      selectItem(slot, it, { extra: true });
      s.sh.close();
      afterPick(slot, false, it.id);
      toast(`Got it: ${it.name}. It won’t be added to your closet unless you say so.`);
    } }, 'Use this');
    s.sh = sheet({ title: `What are you wearing as your ${(SLOT_LABELS[slot] || slot).toLowerCase()}?`, content: h('div', { class: 'ck-extra' },
      h('p', { class: 'hint' }, 'A one-off for today. I’ll score it with the rest.'),
      h('h3', { class: 'ck-mini-title' }, 'What is it?'), kindRow,
      h('h3', { class: 'ck-mini-title' }, 'Main color'), colorRow,
      h('div', { class: 'row gap end' }, done)) });
  }

  function optionalRows() {
    const rows = [];
    const bottom = chosen('bottom');
    for (const slot of OPTIONAL) {
      if (slot === 'layer' && S.analysis.bands.layer) continue;
      const has = data.items.some((i) => i.slot === slot);
      if (!has) continue;
      if (slot === 'belt' && !(bottom && bottom.beltLoops === true)) continue; // no belt loops, no belt
      const cur = chosen(slot);
      rows.push(h('button', { class: `ck-opt${cur ? ' on' : ''}`, type: 'button', 'data-slot': slot, onclick: () => openPicker(slot, { optional: true }) },
        cur ? thumb(cur, 'tile ck-opt-thumb') : h('span', { class: 'ck-opt-plus', 'aria-hidden': 'true' }, '＋'),
        h('span', { class: 'ck-opt-text' }, h('small', {}, OPT_LABEL[slot]), h('b', {}, cur ? cur.name : slot === 'belt' ? 'Wearing a belt?' : 'Add one (optional)')),
        h('span', { class: 'ck-opt-caret', 'aria-hidden': 'true' }, '▸')));
    }
    return rows;
  }

  let whatEls = null;
  function refreshRest() {
    if (!whatEls) return;
    const rows = optionalRows();
    whatEls.opts.replaceChildren(...rows);
    whatEls.optsWrap.hidden = !rows.length;
    const ready = !!chosen('top') && !!chosen('bottom');
    whatEls.go.disabled = !ready;
    whatEls.need.textContent = ready ? '' : `Pick your ${!chosen('top') && !chosen('bottom') ? 'top and bottom' : !chosen('top') ? 'top' : 'bottom'} to continue.`;
  }

  function whatView() {
    const cards = h('div', { class: 'ck-bands' }, bandSlots().map(bandCard));
    const opts = h('div', { class: 'ck-opts' });
    const optsWrap = h('section', { class: 'ck-finish' }, h('h3', { class: 'ck-mini-title' }, 'Finishing touches'), h('p', { class: 'hint' }, 'The camera can’t see these well, so tell me if you’re wearing them.'), opts);
    const go_ = h('button', { class: 'btn btn-mint btn-big ck-continue', type: 'button', 'data-act': 'score', onclick: () => scoreIt() }, 'Score my fit');
    const need = h('p', { class: 'hint ck-need', 'aria-live': 'polite' });
    whatEls = { opts, optsWrap, go: go_, need };
    const view = h('div', { class: 'ck-what' },
      stepper(3),
      title('What are you wearing?', 'One tap each'),
      h('p', { class: 'hint ck-lead' }, S.analysis.manual ? 'Pick the pieces you have on.' : 'I matched what I saw to your closet. Tap the right piece, or tell me something else.'),
      cards, optsWrap,
      h('div', { class: 'ck-nav' }, need, go_, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('align') }, 'Adjust the lines')));
    queueMicrotask(refreshRest);
    return view;
  }

  // ---------- 4. score ----------
  function currentItems() {
    const out = {};
    for (const slot of SLOTS) { const it = chosen(slot); if (it && !S.skipped[slot]) out[slot] = it; }
    if (out.bottom && out.bottom.beltLoops !== true) delete out.belt;
    return out;
  }

  async function engineCtx() {
    const base = await getContext();
    const occs = allOccasions();
    const occ = occs[S.occasion] ? S.occasion : base.occasion;
    S.occasion = occ;
    return { ...base, occasion: occ, occasionDef: occs[occ], beltAvailable: data.items.some((i) => i.slot === 'belt' && i.available !== false), maxReasons: 24 };
  }

  function bestSwap(items, ctx) {
    let best = null;
    for (const slot of ['top', 'bottom', 'shoes', 'layer', 'belt', 'neckwear', 'headwear']) {
      if (slot === 'belt' && !(items.bottom && items.bottom.beltLoops === true)) continue;
      const cur = items[slot] || null;
      let rows;
      try { rows = rankForSlot(data.items, items, slot, ctx); } catch { continue; }
      for (const r of rows) {
        if (cur && r.item && r.item.id === cur.id) continue;
        if (!cur && !r.item) continue;
        if (r.delta >= 3 && (!best || r.delta > best.delta)) best = { slot, cur, row: r, delta: r.delta };
      }
    }
    return best;
  }

  async function computeResult() {
    const items = currentItems();
    const ctx = await engineCtx();
    const res = scoreOutfit(items, ctx);
    let swap = null;
    try { swap = bestSwap(items, { ...ctx, maxReasons: 6 }); } catch (e) { console.warn(e); }
    const roast = roastOutfit(items, { score: res.score, reasons: res.reasons, swap }, ctx, { seed: S.seed });
    S.result = { items, score: res.score, reasons: res.reasons, swap, roast, profile: !!ctx.profile };
  }

  async function scoreIt() {
    const items = currentItems();
    if (!items.top || !items.bottom) return;
    S.occasion = S.occasion || data.settings.occasion || 'any';
    await computeResult();
    go('score');
  }

  async function rescore() {
    const prev = S.result ? S.result.score : 0;
    await computeResult();
    if (alive && S.step === 'score') { scoreEls.fillAll(prev); }
  }

  let scoreEls = null;

  function complexionCard(res) {
    const near = Object.keys(NEAR_FACE).filter((s) => res.items[s]).map((s) => res.items[s]);
    const chips = h('div', { class: 'ck-near' }, near.map((it) => h('span', { class: 'ck-near-chip' }, h('span', { class: 'ck-swatch', style: { background: it.colors[0].hex }, 'aria-hidden': 'true' }), `${SLOT_LABELS[it.slot]}: ${famName(it.colors[0].family)}`)));
    if (!res.profile) {
      return h('section', { class: 'ck-card ck-you nudge' }, h('h3', {}, 'How it looks on you'),
        h('p', {}, 'I can tell you whether these colors flatter your skin tone, hair and eyes. It takes about two minutes, all on your phone.'),
        chips, h('a', { class: 'btn btn-small btn-sun', href: '#/profile', 'data-goto': 'profile' }, '🎨 Set up Your colors'));
    }
    const rs = res.reasons.filter((r) => r.tag && r.tag.startsWith('complexion'));
    const total = Math.round(rs.reduce((a, r) => a + r.delta, 0));
    const tone = total >= 3 ? 'good' : total <= -3 ? 'off' : 'ok';
    const head = tone === 'good' ? 'Flattering on you' : tone === 'off' ? 'Not your best shade' : 'Easy on your coloring';
    const emoji = tone === 'good' ? '✨' : tone === 'off' ? '🤔' : '🙂';
    return h('section', { class: `ck-card ck-you ${tone}` }, h('h3', {}, 'How it looks on you'),
      h('p', { class: 'ck-you-head' }, h('span', { 'aria-hidden': 'true' }, emoji), ` ${head}`),
      chips,
      rs.length ? h('ul', { class: 'ck-you-list' }, rs.map((r) => h('li', { class: r.delta >= 0 ? 'pos' : 'neg' }, h('span', { 'aria-hidden': 'true', html: icon(r.delta >= 0 ? 'check' : 'alert', { size: 15, sw: 3 }) }), h('span', {}, r.text))))
        : h('p', { class: 'hint' }, 'Nothing near your face fights your coloring. Neutral and easy.'));
  }

  function swapCard(res) {
    const sw = res.swap;
    if (!sw) return h('div', { class: 'ck-swap peak' }, h('span', { class: 'ck-swap-emoji', 'aria-hidden': 'true' }, '🏆'), h('div', {}, h('b', {}, 'Already peak'), h('small', {}, 'Nothing in your closet beats this, piece for piece.')));
    const label = (SLOT_LABELS[sw.slot] || sw.slot).toLowerCase();
    const to = sw.row.item;
    const text = !to ? `Skip the ${sw.cur.name.toLowerCase()}` : sw.cur ? `Swap ${sw.cur.name} for ${to.name}` : `Add ${to.name}`;
    return h('div', { class: 'ck-swap', 'data-slot': sw.slot }, to ? thumb(to, 'tile ck-swap-thumb') : h('span', { class: 'art tile ck-swap-thumb sw-none', 'aria-hidden': 'true' }, '∅'),
      h('div', { class: 'ck-swap-text' }, h('small', {}, `Best ${label} move`), h('b', {}, text), h('small', {}, `${res.score} → ${sw.row.score}`)),
      h('span', { class: 'ck-swap-gain', 'aria-label': `${sw.delta} points better` }, signed(sw.delta)));
  }

  function stickers(list, kind) {
    return h('div', { class: 't-stickers ck-stickers' }, list.map((r, i) => h('span', { class: `t-sticker ${kind}`, style: { '--rot': `${((i * 37) % 7) - 3}deg`, '--d': `${500 + i * 110}ms` } },
      h('span', { class: 't-sticker-ico', html: icon(kind === 'pos' ? 'check' : 'alert', { size: 14, sw: 3 }) }), h('span', {}, r.text), h('b', { class: 't-sticker-delta' }, signed(Math.round(r.delta))))));
  }

  function scoreView() {
    const res = S.result;
    const num = h('b', { class: 't-num' }, '0');
    const numwrap = h('span', { class: 't-numwrap' }, num, h('small', {}, '/100'));
    const fill = h('span', { class: 't-fill' });
    const meter = h('div', { class: 't-meter', role: 'meter', 'aria-label': 'Fit score', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
      h('span', { class: 't-meter-top' }, h('span', { class: 't-meter-label' }, 'FIT SCORE'), numwrap),
      h('span', { class: 't-track' }, fill, h('span', { class: 't-ticks', 'aria-hidden': 'true' })));
    const stamp = h('div', { class: 't-stamp', 'aria-hidden': 'true' });
    const score = h('div', { class: 't-score ck-score' }, meter, stamp);
    const polaroid = h('figure', { class: 'ck-polaroid' }, h('img', { src: S.photo.url, alt: 'You, in today’s outfit', draggable: 'false' }), h('figcaption', {}, 'Today'));
    const body = h('div', { class: 'ck-body' });
    const occ = occasionPicker({ value: S.occasion || 'any', onChange: (k) => { S.occasion = k; rescore(); } });

    function fillAll(from = 0, instant = false) {
      const r = S.result, v = verdict(r.score);
      score.dataset.tone = v.tone;
      meter.setAttribute('aria-valuenow', String(r.score));
      meter.setAttribute('aria-valuetext', `${r.score} out of 100, ${v.short}`);
      requestAnimationFrame(() => fill.style.setProperty('--fill', String(r.score)));
      if (instant) num.textContent = String(r.score); else countUp(num, r.score, 800, from);
      stamp.textContent = v.label; stamp.className = `t-stamp tone-${v.tone}`; void stamp.offsetWidth; stamp.classList.add(instant ? 'shown' : 'slam');
      if (!instant) setTimeout(() => { if (!alive) return; buzz(v.confetti ? [30, 40, 30, 40, 60] : 30); if (v.confetti && from === 0) { const b = stamp.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + b.height / 2, 40); } }, reduced() ? 0 : 420);
      if (from && from !== r.score) {
        const d = r.score - from;
        const pop = h('span', { class: `t-delta-pop ${d > 0 ? 'up' : 'down'}`, 'aria-hidden': 'true' }, signed(d)); numwrap.append(pop); setTimeout(() => pop.remove(), 2600);
      }
      announce(`Fit score ${r.score}: ${v.short}.`);
      paintBody();
      paintRoast(!instant);
    }

    const roastBox = h('section', { class: 'ck-roast', 'aria-live': 'polite' });
    function paintRoast(reveal) {
      const r = S.result.roast;
      const on = data.settings.roast !== false;
      roastBox.hidden = !r || r.level === 'none';
      if (roastBox.hidden) return;
      roastBox.classList.toggle('muted', !on);
      roastBox.classList.remove('reveal'); if (reveal && on && !reduced()) { void roastBox.offsetWidth; roastBox.classList.add('reveal'); }
      const toggle = h('button', { class: 'btn btn-small btn-ghost ck-easy', type: 'button', 'aria-pressed': String(!on), 'data-act': 'go-easy',
        onclick: async () => { await setSetting({ roast: !on }); paintRoast(!on); } }, on ? 'Go easy on me' : 'Roast me again 🔥');
      if (!on) { roastBox.replaceChildren(h('p', { class: 'ck-roast-off' }, 'Roast is off. Gentle mode.'), toggle); return; }
      roastBox.replaceChildren(
        h('h3', { class: 'ck-roast-title' }, h('span', { 'aria-hidden': 'true' }, '🔥'), r.level === 'full' ? ' The roast' : ' A little jab'),
        r.headline ? h('p', { class: 'ck-roast-head' }, r.headline) : null,
        h('ul', { class: 'ck-roast-lines' }, r.lines.map((l, i) => h('li', { class: i === r.lines.length - 1 && r.level === 'full' ? 'fix' : '' }, l))),
        toggle);
    }

    function pieces() {
      const items = S.result.items;
      return h('section', { class: 'ck-card ck-pieces' }, h('h3', {}, 'What you’re wearing'),
        h('ul', { class: 'ck-piece-list' }, SLOTS.filter((s) => items[s]).map((s) => {
          const it = items[s], extra = !inCloset(it);
          return h('li', { 'data-slot': s }, thumb(it, 'tile ck-piece-thumb'),
            h('span', { class: 'ck-piece-text' }, h('small', {}, SLOT_LABELS[s]), h('b', {}, it.name), extra ? h('em', {}, 'Not in your closet') : null),
            extra ? h('button', { class: 'btn btn-small btn-ghost ck-add', type: 'button', 'data-act': 'add-closet', 'data-slot': s, onclick: () => addToCloset(s) }, 'Add to closet') : null);
        })));
    }

    function paintBody() {
      const r = S.result;
      const good = r.reasons.filter((x) => x.delta > 0 && !x.tag.startsWith('complexion')).slice(0, 5);
      const bad = r.reasons.filter((x) => x.delta < 0 && !x.tag.startsWith('complexion')).slice(0, 4);
      body.replaceChildren(
        complexionCard(r),
        h('section', { class: 'ck-card' }, h('h3', {}, 'What’s working'), good.length ? stickers(good, 'pos') : h('p', { class: 'hint' }, 'A quiet, sensible outfit. Nothing stands out either way.')),
        h('section', { class: 'ck-card' }, h('h3', {}, 'Easy fixes'), bad.length ? stickers(bad, 'neg') : h('p', { class: 'hint' }, 'Nothing to fix. Wear it with confidence.'), swapCard(r)),
        pieces());
    }

    scoreEls = { fillAll, paintBody };
    const logBox = logSection();
    const view = h('div', { class: 'ck-scoreview' },
      stepper(4),
      h('h2', { class: 'sr-only', id: 'screen-title', tabindex: '-1' }, 'Your fit check score'),
      h('div', { class: 'ck-hero' }, polaroid, score), roastBox,
      h('fieldset', { class: 'fld ck-occ' }, h('legend', {}, 'Dressing for'), occ),
      body, logBox,
      h('div', { class: 'ck-nav' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('what') }, 'Change pieces'), h('button', { class: 'btn btn-ghost', type: 'button', 'data-act': 'again', onclick: () => { resetFlow(); go('start'); } }, 'Start over')));
    queueMicrotask(() => fillAll(0, false));
    return view;
  }

  // ---------- 5. log it ----------
  function logSection() {
    const box = h('section', { class: 'ck-card ck-log' });
    const paint = () => {
      if (S.saved) {
        box.replaceChildren(
          h('h3', {}, 'Saved to your diary ✓'),
          h('p', { class: 'ck-saved-msg' }, 'Nice. It’s in your Lookbook under Fit checks, and the pieces you wore are logged.'),
          h('div', { class: 'row gap center wrap' },
            h('a', { class: 'btn btn-cobalt', href: '#/looks', 'data-goto': 'looks' }, 'See my diary'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { resetFlow(); go('start'); } }, 'Rate another')));
        return;
      }
      const moods = [['love', '😍', 'Loved it'], ['ok', '🙂', 'Fine'], ['meh', '😕', 'Meh']];
      const note = h('input', { class: 'text-input ck-note', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Anything to remember? (optional)', 'aria-label': 'Note about today’s outfit', value: S.note,
        oninput: () => { S.note = note.value; } });
      const save = h('button', { class: 'btn btn-mint btn-big ck-save', type: 'button', 'data-act': 'save', onclick: saveIt }, h('span', { html: icon('book', { size: 22, sw: 2.6 }) }), 'Save to my diary');
      box.replaceChildren(
        h('h3', {}, 'How did it feel?'),
        h('div', { class: 'ck-moods', role: 'group', 'aria-label': 'How did it feel?' }, moods.map(([k, e, t]) =>
          h('button', { class: 'ck-mood', type: 'button', 'data-mood': k, 'aria-pressed': String(S.mood === k), onclick: (ev) => {
            S.mood = S.mood === k ? null : k; buzz(10);
            for (const b of box.querySelectorAll('.ck-mood')) b.setAttribute('aria-pressed', String(b.dataset.mood === S.mood));
            if (S.mood === 'love') { const b = ev.currentTarget.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top, 16); }
          } }, h('span', { class: 'ck-mood-emoji', 'aria-hidden': 'true' }, e), h('span', {}, t)))),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note'), note),
        save,
        h('p', { class: 'hint ck-log-hint' }, 'Saves the photo to this phone only, and counts the pieces as worn today.'));
    };
    paint();
    box.repaint = paint;
    logRef = box;
    return box;
  }
  let logRef = null;

  async function saveIt() {
    if (S.saving || S.saved || !S.result) return;
    S.saving = true;
    const btn = root.querySelector('.ck-save');
    if (btn) btn.disabled = true;
    try {
      const v = await vision();
      let blob = null;
      try { blob = await v.canvasToBlob(S.photo.canvas, { maxDim: 900, type: 'image/webp', quality: 0.8 }); } catch (e) { console.warn('photo not saved', e); }
      const items = S.result.items;
      const itemIds = {}, extras = {}, closetOnly = {};
      for (const [slot, it] of Object.entries(items)) { if (inCloset(it)) { itemIds[slot] = it.id; closetOnly[slot] = it; } else extras[slot] = it; }
      const check = makeCheck({ date: todayISO(), itemIds, extras, score: S.result.score, occasion: S.occasion || 'any', mood: S.mood, note: S.note, roast: S.result.roast && S.result.roast.level !== 'none' && data.settings.roast !== false ? S.result.roast.text : '' });
      const rec = await saveCheck(check, blob);
      S.saved = rec;
      let hampered = 0;
      if (Object.keys(closetOnly).length) { const w = await logWorn({ items: closetOnly }); hampered = (w && w.hampered) || 0; }
      if (Object.keys(closetOnly).length >= 2 && (S.mood === 'love' || S.mood === 'meh')) await setFeedback({ items: closetOnly, key: outfitKey(closetOnly) }, S.mood === 'love' ? 'like' : 'dislike');
      buzz([20, 30, 20, 30, 40]);
      if (alive) {
        const b = btn && btn.getBoundingClientRect();
        if (b) confetti(b.left + b.width / 2, b.top + b.height / 2, 30);
        toast(hampered > 0 ? `Saved! ${hampered} piece${hampered === 1 ? '' : 's'} went to the hamper 🧺` : 'Saved to your diary. Go be fabulous.');
        announce('Fit check saved to your diary.');
        if (logRef && logRef.isConnected) logRef.repaint();
      }
    } catch (e) {
      console.warn(e);
      toast('Couldn’t save that. Try again?', { tone: 'bad' });
      if (btn) btn.disabled = false;
    } finally {
      S.saving = false;
    }
  }

  async function addToCloset(slot) {
    const sel = S.sel[slot];
    if (!sel || inCloset(sel.item)) return;
    const saved = await saveItem({ ...sel.item, worn: S.saved ? [todayISO()] : sel.item.worn });
    S.sel[slot] = { item: saved, extra: false };
    if (S.result && S.result.items[slot]) S.result.items[slot] = saved;
    if (S.saved) {
      const itemIds = { ...S.saved.itemIds, [slot]: saved.id };
      const extras = { ...S.saved.extras }; delete extras[slot];
      S.saved = await saveCheck(makeCheck({ ...S.saved, itemIds, extras }), null);
    }
    toast(`${saved.name} is in your closet now.`);
    buzz(12);
    if (scoreEls) scoreEls.paintBody();
  }

  // ---------- render ----------
  function render(focus = true) {
    clear(root);
    whatEls = null; scoreEls = null; logRef = null;
    const step = S.step;
    const view = step === 'busy' ? busyView() : step === 'align' && S.photo ? alignView() : step === 'what' && S.analysis ? whatView() : step === 'score' && S.result ? scoreView() : (S.step = 'start', startView());
    if (!view.querySelector('#screen-title') && !view.matches('#screen-title')) {
      root.append(h('h1', { class: 'sr-only', id: 'screen-title', tabindex: '-1' }, 'Rate my fit'));
    }
    root.append(view);
    if (focus && !first) { const t = root.querySelector('#screen-title'); if (t) { window.scrollTo(0, 0); t.focus({ preventScroll: true }); } }
    first = false;
  }

  if (S.step === 'busy') S.step = S.analysis ? 'what' : S.photo ? 'align' : 'start';
  render(false);

  return {
    update(what) {
      if (!alive) return;
      if (what === 'items' && S.step === 'what' && whatEls) refreshRest();
    },
    destroy() { alive = false; },
  };
}
