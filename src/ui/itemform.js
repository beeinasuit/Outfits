// Shared item editor form: used by the Snap review cards, the closet edit sheet and "add without photo".
import { SLOTS, SLOT_LABELS, KINDS, PATTERNS, FORMALITY, LEATHER_TONES, COLOR_FAMILIES, makeItem, defaultWearsBeforeWash } from '../model.js';
import { h, clear, cap } from './dom.js';
import { icon } from './icons.js';
import { slotIllustration } from './illustrations.js';
import { buzz } from './fx.js';
import * as store from '../store.js';

export const PICKER_SLOTS = SLOTS.filter((s) => s !== 'extra');
const WARM_SLOTS = ['top', 'layer', 'neckwear', 'headwear'];
const WARMTH = ['Airy', 'Light', 'Cosy', 'Toasty'];
const SHOE_MATERIALS = ['leather', 'suede', 'canvas', 'synthetic', 'fabric'];
const BELT_MATERIALS = ['leather', 'suede', 'canvas', 'fabric'];

export function applyKindDefaults(d) {
  const defs = KINDS[d.slot][d.kind] || {};
  d.formality = defs.formality ?? 2;
  d.warmth = defs.warmth ?? 0;
  d.collared = d.slot === 'top' ? !!defs.collared : false;
  d.beltLoops = d.slot === 'bottom' ? !!defs.beltLoops : false;
  d.material = defs.material || 'fabric';
  d.leather = d.material === 'leather' || d.material === 'suede' ? (d.leather || 'brown') : null;
  d.rain = !!defs.rain;
  if (!d._wwCustom) d.wearsBeforeWash = defaultWearsBeforeWash(d.slot, d.kind);
  return d;
}

export function newDraft(over = {}) {
  const slot = over.slot || 'top';
  const d = { slot, kind: over.kind || Object.keys(KINDS[slot])[0], name: '', colors: [], pattern: 'solid', leather: null };
  applyKindDefaults(d);
  return Object.assign(d, over);
}

export function itemToDraft(it) {
  return { id: it.id, slot: it.slot, kind: it.kind, name: it.name, colors: it.colors.map((c) => ({ ...c })), pattern: it.pattern, formality: it.formality, warmth: it.warmth,
    beltLoops: it.beltLoops, collared: it.collared, material: it.material, leather: it.leather, rain: it.rain,
    wearsBeforeWash: it.wearsBeforeWash, _wwCustom: it.wearsBeforeWash !== defaultWearsBeforeWash(it.slot, it.kind) };
}

export const draftToItem = (d, extra = {}) => makeItem({ ...d, ...extra });

const famLabel = (f) => cap(f.replace('-', ' '));
const lumOf = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

function normalizeWeights(colors) {
  const sum = colors.reduce((a, c) => a + (c.weight || 0), 0) || 1;
  colors.forEach((c) => { c.weight = Math.round((c.weight / sum) * 100) / 100; });
}

export function buildItemForm(draft, { onChange = () => {}, idPrefix = 'f' + Math.random().toString(36).slice(2, 6) } = {}) {
  const d = draft;
  const root = h('div', { class: 'itemform' });
  const changed = () => onChange(d);

  const chip = (label, on, fn, extra = {}) => h('button', { class: 'chip' + (extra.cls ? ' ' + extra.cls : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: () => { buzz(6); fn(); } }, label);
  const fieldset = (legend, ...kids) => h('fieldset', { class: 'fld' }, h('legend', {}, legend), ...kids);

  // --- slot
  const slotBox = h('div', { class: 'slot-grid' });
  const renderSlot = () => {
    clear(slotBox);
    for (const s of PICKER_SLOTS) {
      slotBox.append(h('button', { class: 'slot-btn', type: 'button', 'aria-pressed': String(d.slot === s), onclick: () => {
        if (d.slot === s) return;
        buzz(8); d.slot = s; d.kind = Object.keys(KINDS[s])[0]; applyKindDefaults(d); renderKinds(); renderExtras(); syncAll(); renderSlot(); changed();
      } }, h('span', { class: 'slot-ico', html: slotIllustration(s) }), h('span', { class: 'slot-name' }, SLOT_LABELS[s])));
    }
  };

  // --- kind
  const kindBox = h('div', { class: 'chips' });
  const renderKinds = () => {
    clear(kindBox);
    for (const k of Object.keys(KINDS[d.slot])) {
      kindBox.append(chip(cap(k), d.kind === k, () => { d.kind = k; applyKindDefaults(d); renderKinds(); renderExtras(); syncAll(); changed(); }));
    }
  };

  // --- colors
  const selBox = h('div', { class: 'sel-colors' });
  const palBox = h('div', { class: 'palette', role: 'group', 'aria-label': 'Color palette' });
  const colorHint = h('p', { class: 'hint' });
  const renderColors = () => {
    clear(selBox); clear(palBox);
    d.colors.forEach((c, i) => {
      selBox.append(h('span', { class: 'sel-chip' },
        h('button', { class: 'sel-main', type: 'button', 'aria-label': `${famLabel(c.family)}${i === 0 ? ' (main color)' : ': make main color'}`, onclick: () => { if (i === 0) return; d.colors.unshift(d.colors.splice(i, 1)[0]); renderColors(); changed(); } },
          h('i', { class: 'dot', style: { background: c.hex } }), famLabel(c.family), i === 0 ? h('b', { class: 'main-tag' }, 'main') : null),
        h('button', { class: 'sel-x', type: 'button', 'aria-label': `Remove ${famLabel(c.family)}`, html: icon('x', { size: 14 }), onclick: () => { d.colors.splice(i, 1); normalizeWeights(d.colors); renderColors(); changed(); } })));
    });
    if (!d.colors.length) selBox.append(h('span', { class: 'hint' }, 'Tap a color below'));
    colorHint.textContent = d.colors.length > 1 ? 'Tap a chip to make it the main color.' : 'Add a second color for stripes, trims or two-tone pieces.';
    for (const [fam, info] of Object.entries(COLOR_FAMILIES)) {
      const on = d.colors.some((c) => c.family === fam);
      palBox.append(h('button', { class: 'swatch' + (lumOf(info.hex) > 0.6 ? ' light' : ''), type: 'button', style: { background: info.hex }, title: famLabel(fam), 'aria-label': famLabel(fam), 'aria-pressed': String(on),
        onclick: () => {
          buzz(6);
          const idx = d.colors.findIndex((c) => c.family === fam);
          if (idx >= 0) d.colors.splice(idx, 1);
          else { if (d.colors.length >= 3) d.colors.pop(); d.colors.push({ hex: info.hex, family: fam, weight: 0.25 }); }
          normalizeWeights(d.colors); renderColors(); changed();
        } }, on ? h('span', { html: icon('check', { size: 16, sw: 3.4 }) }) : null));
    }
  };

  // --- pattern
  const patBox = h('div', { class: 'chips' });
  const renderPattern = () => { clear(patBox); for (const p of PATTERNS) patBox.append(chip(cap(p), d.pattern === p, () => { d.pattern = p; renderPattern(); changed(); })); };

  // --- formality
  const fid = `${idPrefix}-form`;
  const fLabel = h('output', { class: 'range-val', for: fid });
  const fRange = h('input', { class: 'range', id: fid, type: 'range', min: 1, max: 5, step: 1, value: d.formality, 'aria-valuetext': FORMALITY[d.formality] });
  const syncFormality = () => { fRange.value = d.formality; fLabel.textContent = `${d.formality} · ${FORMALITY[d.formality]}`; fRange.setAttribute('aria-valuetext', FORMALITY[d.formality]); };
  fRange.addEventListener('input', () => { d.formality = Number(fRange.value); syncFormality(); changed(); });
  syncFormality();

  // --- extras (slot dependent)
  const extras = h('div', { class: 'extras' });
  const toggle = (label, hint, get, set) => {
    const on = get();
    return h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(on), onclick: () => { buzz(8); set(!get()); renderExtras(); changed(); } },
      h('span', { class: 'toggle-text' }, h('b', {}, label), h('small', {}, hint)),
      h('span', { class: 'switch' + (on ? ' on' : ''), 'aria-hidden': 'true' }, h('i', {}), h('em', {}, on ? 'Yes' : 'No')));
  };
  const renderExtras = () => {
    clear(extras);
    if (WARM_SLOTS.includes(d.slot)) {
      extras.append(fieldset('Warmth', h('div', { class: 'chips' }, WARMTH.map((w, i) => chip(w, d.warmth === i, () => { d.warmth = i; renderExtras(); changed(); })))));
    }
    if (d.slot === 'bottom') extras.append(toggle('Belt loops', d.beltLoops ? 'A belt goes with these' : 'No loops, no belt', () => d.beltLoops, (v) => { d.beltLoops = v; }));
    if (d.slot === 'top') extras.append(toggle('Collared', 'Needed for ties and scarves', () => d.collared, (v) => { d.collared = v; }));
    if (d.slot === 'layer') extras.append(toggle('Rain-proof', 'Counts when it’s wet out', () => d.rain, (v) => { d.rain = v; }));
    if (d.slot === 'shoes' || d.slot === 'belt') {
      const mats = d.slot === 'shoes' ? SHOE_MATERIALS : BELT_MATERIALS;
      extras.append(fieldset('Material', h('div', { class: 'chips' }, mats.map((m) => chip(cap(m), d.material === m, () => {
        d.material = m; d.leather = m === 'leather' || m === 'suede' ? (d.leather || 'brown') : null; renderExtras(); changed();
      })))));
      if (d.material === 'leather' || d.material === 'suede') {
        extras.append(fieldset('Leather tone', h('div', { class: 'chips' }, LEATHER_TONES.map((t) => chip(cap(t.replace('-', ' ')), d.leather === t, () => { d.leather = t; renderExtras(); changed(); })))));
      }
    }
  };

  // --- wears before wash (laundry)
  const wwBox = h('div', { class: 'ww' });
  const wwVal = h('output', { class: 'ww-val', 'aria-live': 'polite' });
  const wwHint = h('small', { class: 'hint ww-hint' });
  const syncWW = () => {
    const def = defaultWearsBeforeWash(d.slot, d.kind);
    const v = d.wearsBeforeWash ?? def;
    wwVal.textContent = v === 0 ? 'Never' : `${v} wear${v === 1 ? '' : 's'}`;
    wwHint.textContent = `0 = never goes to the hamper on its own. Usual for ${d.kind === 'socks' ? 'socks' : d.kind}: ${def === 0 ? 'never' : def}.`;
    wwDec.disabled = v <= 0; wwInc.disabled = v >= 30;
  };
  const stepWW = (k) => { d.wearsBeforeWash = Math.max(0, Math.min(30, (d.wearsBeforeWash ?? defaultWearsBeforeWash(d.slot, d.kind)) + k)); d._wwCustom = true; buzz(6); syncWW(); changed(); };
  const wwDec = h('button', { class: 'icon-btn ww-btn', type: 'button', 'aria-label': 'One fewer wear before wash', html: icon('minus'), onclick: () => stepWW(-1) });
  const wwInc = h('button', { class: 'icon-btn ww-btn', type: 'button', 'aria-label': 'One more wear before wash', html: icon('plus'), onclick: () => stepWW(1) });
  wwBox.append(wwDec, wwVal, wwInc);
  const baseApply = syncFormality;
  const syncAll = () => { baseApply(); syncWW(); };
  syncWW();

  // --- name
  const nameId = `${idPrefix}-name`;
  const nameInput = h('input', { class: 'text-input', id: nameId, type: 'text', maxlength: 40, autocomplete: 'off', value: d.name || '' });
  const syncPlaceholder = () => { nameInput.placeholder = makeItem({ ...d, name: '' }).name; };
  nameInput.addEventListener('input', () => { d.name = nameInput.value; });
  const origChanged = onChange;
  onChange = (x) => { syncPlaceholder(); origChanged(x); }; // eslint-disable-line no-param-reassign

  renderSlot(); renderKinds(); renderColors(); renderPattern(); renderExtras(); syncPlaceholder();

  root.append(
    fieldset('What is it?', slotBox),
    fieldset('Kind', kindBox),
    fieldset('Colors', selBox, palBox, colorHint),
    fieldset('Pattern', patBox),
    h('div', { class: 'fld' }, h('label', { class: 'legend', for: fid }, 'Dress level'), fRange, fLabel,
      h('div', { class: 'range-ticks', 'aria-hidden': 'true' }, Object.values(FORMALITY).map((t) => h('span', {}, t)))),
    extras,
    h('fieldset', { class: 'fld' }, h('legend', {}, 'Wears before wash'), wwBox, wwHint),
    h('div', { class: 'fld' }, h('label', { class: 'legend', for: nameId }, 'Name'), nameInput),
  );
  root.refreshColors = renderColors;
  return root;
}

// ---------- background removal on/off for an item that already has a photo (edit sheet) ----------
let visionLoad = null;
const loadVision = () => visionLoad || (visionLoad = Promise.all([import('../vision/image.js'), import('../vision/segment.js'), import('./maskutil.js')]).then(([img, seg, mu]) => ({ ...img, ...seg, ...mu })));

/**
 * "Background removed / Original photo" toggle with a live preview. Returns null for items without a photo.
 * Nothing is stored until Save: the choice lives in `draft._bg`, and `resolveCutoutId` applies it.
 * Turning it ON for an item without a cutout recomputes it from the stored photo.
 */
export function buildBackgroundControl(draft, item) {
  if (!item || !item.photoId) return null;
  const st = (draft._bg = { on: !!item.cutoutId, blob: null, busy: false });
  const img = h('img', { class: 'crop', alt: '' });
  const note = h('p', { class: 'cut-note', role: 'status', 'aria-live': 'polite' });
  const mk = (label, on) => h('button', { class: 'bg-opt', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => choose(on) },
    h('span', { class: 'bg-ico', 'aria-hidden': 'true', html: icon('check', { size: 16, sw: 3.4 }) }), label);
  const bOn = mk('Background removed', true), bOff = mk('Original photo', false);
  let blobUrl = null;
  const paint = async () => {
    bOn.setAttribute('aria-checked', String(st.on)); bOff.setAttribute('aria-checked', String(!st.on));
    bOn.disabled = bOff.disabled = st.busy;
    let url = null;
    try {
      if (st.on && st.blob) { if (!blobUrl) blobUrl = URL.createObjectURL(st.blob); url = blobUrl; }
      else url = await store.getPhotoURL(st.on && item.cutoutId ? item.cutoutId : item.photoId);
    } catch { url = null; }
    if (url) img.src = url;
    img.className = 'crop' + (st.on ? ' cut' : '');
    img.alt = st.on ? 'Cutout preview' : 'Original photo preview';
  };
  async function choose(on) {
    if (st.busy || st.on === on) return;
    buzz(8);
    note.textContent = '';
    if (on && !item.cutoutId && !st.blob) {
      st.busy = true; note.textContent = 'Finding the outline…'; await paint();
      try {
        const v = await loadVision();
        const photo = await store.getPhotoBlob(item.photoId);
        const bmp = await v.fileToBitmap(photo);
        const canvas = v.bitmapToCanvas(bmp, 800);
        const r = v.cutoutFromCrop(v, canvas);
        if (!r.cutout) note.textContent = 'I couldn’t find a clean outline, so the photo stays as it is.';
        else {
          st.blob = await v.canvasToBlob(r.cutout, { maxDim: 600, type: 'image/webp', quality: 0.85, alpha: true });
          st.on = true;
          note.textContent = r.confident ? '' : 'Not totally sure about the edges. Tap “Original photo” if they look off.';
        }
      } catch (e) { console.warn('cutout failed', e); note.textContent = 'That didn’t work, so the photo stays as it is.'; }
      st.busy = false;
    } else st.on = on;
    await paint();
  }
  paint();
  return h('div', { class: 'fld bg-edit-wrap' }, h('div', { class: 'legend' }, 'Photo'),
    h('div', { class: 'bg-edit' }, img, h('div', { class: 'bg-pick' }, h('div', { class: 'bg-seg', role: 'radiogroup', 'aria-label': 'Photo style' }, bOn, bOff), note)));
}

/** Apply the edit sheet's background choice on Save: returns the cutoutId to keep (null = none). */
export async function resolveCutoutId(draft, item) {
  const st = draft._bg;
  let id = item.cutoutId || null;
  if (!st) return id;
  if (!st.on) { if (id) { try { await store.deletePhoto(id); } catch { /* ignore */ } } return null; }
  if (!id && st.blob) id = await store.putPhoto(st.blob);
  return id;
}
