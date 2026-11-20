// SNAP screen: photo -> detected boxes -> review cards -> closet. Also "add without a photo".
import { SLOT_LABELS } from '../model.js';
import { h, clear, html, nextFrame, sleep } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz, confetti } from './fx.js';
import { toast, sheet } from './overlay.js';
import { buildItemForm, newDraft, draftToItem } from './itemform.js';
import { data, saveItem, realCount, setSetting, emit } from './data.js';
import * as store from '../store.js';
import { upscaleMask, resampleMask, maskIsUseful } from './maskutil.js';

const MIN = 0.04;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Flow state survives tab switches.
const S = { step: 'start', files: [], fileIdx: 0, photo: null, drafts: [], cur: 0, busyMsg: '', error: '' };
let visionMods = null;

async function vision() {
  if (!visionMods) {
    const [img, seg, col] = await Promise.all([import('../vision/image.js'), import('../vision/segment.js'), import('../vision/color.js')]);
    visionMods = { ...img, ...seg, ...col };
  }
  return visionMods;
}

function cropMask(v, crop) {
  const id = v.canvasImageData(crop, 200);
  const bs = v.segmentItems(id, { padding: 0, maxItems: 6 }) || [];
  let best = null;
  for (const b of bs) if (b.mask && (!best || b.area > best.area)) best = b;
  if (!best) return null;
  return upscaleMask({ x: best.x, y: best.y, w: best.w, h: best.h, mask: best.mask }, crop.width / id.width, crop.height / id.height, { x: 0, y: 0, w: crop.width, h: crop.height });
}

function thumbOf(canvas, alpha) {
  const k = Math.min(1, 240 / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.7);
}

function resetFlow() {
  S.step = 'start'; S.files = []; S.fileIdx = 0;
  if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
  S.photo = null; S.drafts = []; S.cur = 0; S.error = '';
}

export function mount(root, { navigate }) {
  let alive = true;
  const go = (step) => { S.step = step; render(); };

  // ---------- start ----------
  const camInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': 'Take a photo', tabindex: '-1', onchange: (e) => onFiles(e.target.files) });
  const libInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Choose photos from your library', tabindex: '-1', onchange: (e) => onFiles(e.target.files) });

  function startView() {
    const tipArt = html(`<svg viewBox="0 0 120 80" class="tip-art" aria-hidden="true"><rect x="2" y="2" width="116" height="76" rx="8" fill="#fffaf0" stroke="#17141f" stroke-width="2.5"/><path d="M14 16 h18 l6 8 v22 h-30z" fill="#2f4bff" stroke="#17141f" stroke-width="2"/><path d="M50 16 h16 l5 62 h-26z" fill="#ffc933" stroke="#17141f" stroke-width="2" transform="translate(0 -4) scale(1 .85)"/><rect x="82" y="20" width="26" height="36" rx="4" fill="#3fd6a0" stroke="#17141f" stroke-width="2"/><path d="M14 64 h92" stroke="#17141f" stroke-width="2" stroke-dasharray="4 4"/></svg>`);
    return h('div', { class: 'snap-start' },
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Snap your clothes'), h('span', { class: 'page-sub' }, 'One photo can hold a whole outfit pile')),
      h('div', { class: 'snap-actions' },
        h('button', { class: 'big-tile tomato', type: 'button', onclick: () => camInput.click() }, h('span', { html: icon('camera', { size: 38, sw: 2.2 }) }), h('b', {}, 'Take a photo'), h('small', {}, 'Camera')),
        h('button', { class: 'big-tile cobalt', type: 'button', onclick: () => libInput.click() }, h('span', { html: icon('image', { size: 38, sw: 2.2 }) }), h('b', {}, 'From library'), h('small', {}, 'Pick one or many'))),
      camInput, libInput,
      h('aside', { class: 'tip-card' }, tipArt,
        h('div', {}, h('h3', {}, 'Flat-lay trick'),
          h('ul', {}, h('li', {}, 'Plain background (a bed sheet is perfect)'), h('li', {}, 'Leave a small gap between items: touching pieces merge into one'), h('li', {}, 'Shoot straight down from above'), h('li', {}, 'Daylight, no harsh shadows')))),
      h('div', { class: 'center' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => addNoPhoto(), html: `${icon('plus', { size: 18 })} No photo? Add by color` })),
      S.error ? h('p', { class: 'error-note', role: 'alert' }, S.error) : null);
  }

  // ---------- busy ----------
  function busyView() {
    return h('div', { class: 'busy', role: 'status' }, h('div', { class: 'busy-art', html: mascot('wow', { size: 140 }) }), h('h2', {}, S.busyMsg || 'Squinting at your clothes…'), h('div', { class: 'loader', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  }
  function busy(msg) { S.step = 'busy'; S.busyMsg = msg; render(); }

  // ---------- file handling ----------
  async function onFiles(list) {
    if (!list || !list.length) { camInput.value = ''; libInput.value = ''; return; } // canceled picker: do nothing
    const files = [...(list || [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    camInput.value = ''; libInput.value = '';
    if (!files.length) { toast('That doesn’t look like a photo.'); return; }
    S.files = files; S.fileIdx = 0; S.drafts = []; S.cur = 0; S.error = '';
    await processFile();
  }

  async function processFile() {
    const file = S.files[S.fileIdx];
    busy(S.files.length > 1 ? `Squinting at photo ${S.fileIdx + 1} of ${S.files.length}…` : 'Squinting at your clothes…');
    try {
      const v = await vision();
      await nextFrame();
      const bitmap = await v.fileToBitmap(file);
      const canvas = v.bitmapToCanvas(bitmap, 1024);
      try { bitmap.close && bitmap.close(); } catch { /* ignore */ }
      await nextFrame();
      const small = v.canvasImageData(canvas, 256);
      await sleep(30);
      let boxes = [];
      try { boxes = v.segmentItems(small, {}) || []; } catch (e) { console.warn('segment failed', e); }
      const note = boxes.length ? '' : 'I couldn’t spot separate items, so I boxed the whole photo. Drag the box or add more.';
      const norm = boxes.map((b, i) => {
        const n = { id: i + 1, x: clamp(b.x / small.width, 0, 1), y: clamp(b.y / small.height, 0, 1), w: clamp(b.w / small.width, MIN, 1), h: clamp(b.h / small.height, MIN, 1) };
        if (b.mask) { n._det = { x: b.x, y: b.y, w: b.w, h: b.h, mask: b.mask }; n._sig = { x: n.x, y: n.y, w: n.w, h: n.h }; }
        return n;
      });
      // white balance is estimated ONCE per photo (from the whole frame's border), then applied to every crop
      let whitePoint = null;
      try { whitePoint = v.estimateWhitePoint(small) || null; } catch (e) { console.warn('white point failed', e); }
      if (!norm.length) norm.push({ id: 1, x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
      S.photo = { canvas, url: URL.createObjectURL(blob), boxes: norm, note, nextId: norm.length + 1, whitePoint, sw: small.width, sh: small.height };
      if (!alive) return;
      go('boxes');
    } catch (e) {
      console.warn(e);
      S.error = 'Couldn’t read that photo. Try another, or add the item by color.';
      if (alive) go('start');
    }
  }

  // ---------- boxes editor ----------
  function boxesView() {
    const P = S.photo;
    const ar = P.canvas.width / P.canvas.height;
    let drawing = false;
    const overlay = h('div', { class: 'overlay' });
    const drawLayer = h('div', { class: 'draw-layer', hidden: true });
    const stage = h('div', { class: 'stage', style: { '--ar': String(ar) } }, h('img', { src: P.url, alt: 'Your photo', draggable: 'false' }), overlay, drawLayer);
    const count = h('span', { class: 'page-sub' });
    const next = h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => finishBoxes() });
    const addBtn = h('button', { class: 'btn btn-ghost', type: 'button', 'aria-pressed': 'false', html: `${icon('plus', { size: 18 })} Box`, onclick: () => setDraw(!drawing) });
    const hint = h('p', { class: 'hint' });

    const place = (el, b) => { el.style.cssText = `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`; };
    function renderBoxes() {
      clear(overlay);
      P.boxes.forEach((b, i) => {
        const el = h('div', { class: 'bbox', 'data-n': i + 1 },
          h('span', { class: 'bbox-n' }, String(i + 1)),
          h('button', { class: 'bbox-x', type: 'button', 'aria-label': `Delete box ${i + 1}`, html: icon('x', { size: 14, sw: 3.2 }), onclick: (e) => { e.stopPropagation(); P.boxes = P.boxes.filter((x) => x !== b); renderBoxes(); buzz(8); } }),
          ...['nw', 'ne', 'sw', 'se'].map((c) => h('span', { class: `handle h-${c}`, 'data-c': c })));
        place(el, b); bindBox(el, b, stage, place); overlay.append(el);
      });
      count.textContent = `${P.boxes.length} item${P.boxes.length === 1 ? '' : 's'} found`;
      next.textContent = S.files.length > 1 && S.fileIdx < S.files.length - 1 ? `Next photo (${P.boxes.length})` : `Review ${P.boxes.length} item${P.boxes.length === 1 ? '' : 's'}`;
      next.disabled = !P.boxes.length;
      hint.textContent = P.note || (drawing ? 'Drag on the photo to draw a box around an item.' : 'Drag boxes to move, drag corners to resize, tap × to remove.');
    }
    function setDraw(on) {
      drawing = on; drawLayer.hidden = !on; addBtn.setAttribute('aria-pressed', String(on)); stage.classList.toggle('drawing', on); renderBoxes();
    }
    // draw new box
    let d0 = null, tmp = null;
    drawLayer.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      d0 = { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
      tmp = h('div', { class: 'bbox temp' }); overlay.append(tmp); drawLayer.setPointerCapture(e.pointerId); e.preventDefault();
    });
    drawLayer.addEventListener('pointermove', (e) => {
      if (!d0) return;
      const r = stage.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      place(tmp, { x: Math.min(d0.x, x), y: Math.min(d0.y, y), w: Math.abs(x - d0.x), h: Math.abs(y - d0.y) });
      tmp._b = { x: Math.min(d0.x, x), y: Math.min(d0.y, y), w: Math.abs(x - d0.x), h: Math.abs(y - d0.y) };
    });
    const endDraw = () => {
      if (!d0) return;
      let b = tmp && tmp._b;
      if (!b || b.w < MIN || b.h < MIN) b = { x: clamp(d0.x - 0.15, 0, 0.7), y: clamp(d0.y - 0.15, 0, 0.7), w: 0.3, h: 0.3 };
      P.boxes.push({ id: P.nextId++, ...b });
      d0 = null; tmp = null; P.note = ''; buzz(12); setDraw(false);
    };
    drawLayer.addEventListener('pointerup', endDraw);
    drawLayer.addEventListener('pointercancel', endDraw);

    renderBoxes();
    const multi = S.files.length > 1 ? ` (photo ${S.fileIdx + 1}/${S.files.length})` : '';
    return h('div', { class: 'boxes' },
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Found these' + multi), count),
      h('div', { class: 'stage-wrap' }, stage),
      hint,
      h('div', { class: 'row gap between wrap' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { resetFlow(); go('start'); } }, 'Start over'), addBtn, next));
  }

  function bindBox(el, b, stage, place) {
    let mode = null, st = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.bbox-x')) return;
      const hnd = e.target.closest('.handle');
      mode = hnd ? hnd.dataset.c : 'move';
      st = { x: e.clientX, y: e.clientY, b: { ...b } };
      el.setPointerCapture(e.pointerId); e.preventDefault(); el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const r = stage.getBoundingClientRect();
      const dx = (e.clientX - st.x) / r.width, dy = (e.clientY - st.y) / r.height;
      let { x, y, w, h: hh } = st.b;
      if (mode === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - hh); }
      else {
        let x2 = x + w, y2 = y + hh;
        if (mode.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
        if (mode.includes('e')) x2 = clamp(x2 + dx, x + MIN, 1);
        if (mode.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
        if (mode.includes('s')) y2 = clamp(y2 + dy, y + MIN, 1);
        w = x2 - x; hh = y2 - y;
      }
      Object.assign(b, { x, y, w, h: hh }); place(el, b);
    });
    const end = () => { mode = null; el.classList.remove('active'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  async function finishBoxes() {
    const P = S.photo;
    busy('Measuring colors…');
    try {
      const v = await vision();
      for (const b of P.boxes) {
        await nextFrame();
        const px = { x: Math.round(b.x * P.canvas.width), y: Math.round(b.y * P.canvas.height), w: Math.max(8, Math.round(b.w * P.canvas.width)), h: Math.max(8, Math.round(b.h * P.canvas.height)) };
        const crop = v.cropCanvas(P.canvas, px);
        const id = v.canvasImageData(crop, 128);
        const cbox = { x: px.x, y: px.y, w: crop.width, h: crop.height };
        // mask: the photo-wide detection if the box is untouched, else re-segment the crop itself
        let maskPx = null;
        try {
          const same = b._sig && Math.abs(b._sig.x - b.x) < 1e-6 && Math.abs(b._sig.y - b.y) < 1e-6 && Math.abs(b._sig.w - b.w) < 1e-6 && Math.abs(b._sig.h - b.h) < 1e-6;
          if (same && b._det) maskPx = upscaleMask(b._det, P.canvas.width / P.sw, P.canvas.height / P.sh, cbox);
          if (!maskIsUseful(maskPx)) maskPx = cropMask(v, crop);
          if (!maskIsUseful(maskPx)) maskPx = null;
        } catch (e) { console.warn('mask failed', e); maskPx = null; }
        let colors = [], pattern = 'solid';
        const copts = { maxColors: 3 };
        if (P.whitePoint) copts.whitePoint = P.whitePoint;
        try {
          if (maskPx) copts.mask = resampleMask(maskPx, crop.width, crop.height, id.width, id.height);
          colors = (v.extractColors(id, copts) || []).slice(0, 3);
        } catch (e) { console.warn(e); }
        if (!colors.length) { try { colors = (v.extractColors(id, { maxColors: 3 }) || []).slice(0, 3); } catch (e) { console.warn(e); } }
        try { pattern = v.guessPattern(id) || 'solid'; } catch (e) { console.warn(e); }
        let cutout = null;
        if (maskPx) { try { cutout = v.cutoutCanvas(P.canvas, cbox, maskPx); } catch (e) { console.warn('cutout failed', e); } }
        const ratio = px.w / px.h;
        const slot = ratio > 2.6 ? 'belt' : ratio < 0.34 ? 'neckwear' : 'top';
        const d = newDraft({ slot, colors, pattern });
        d._crop = crop; d._cutout = cutout; d._thumb = thumbOf(cutout || crop, !!cutout);
        S.drafts.push(d);
      }
    } catch (e) {
      console.warn(e); S.error = 'Something went wrong while measuring colors.'; go('start'); return;
    }
    if (S.fileIdx < S.files.length - 1) { S.fileIdx++; await processFile(); return; }
    S.cur = 0;
    if (!S.drafts.length) { toast('No items to review.'); resetFlow(); go('start'); return; }
    go('review');
  }

  // ---------- review ----------
  function reviewView() {
    const total = S.drafts.length;
    S.cur = clamp(S.cur, 0, total - 1);
    const d = S.drafts[S.cur];
    const saveAll = h('button', { class: 'btn btn-big btn-tomato', type: 'button', onclick: () => saveDrafts() }, `Save all (${total})`);
    const form = buildItemForm(d, { idPrefix: `r${S.cur}` });
    const dots = h('div', { class: 'dots', role: 'tablist', 'aria-label': 'Items' }, S.drafts.map((x, i) => h('button', { class: 'dot-btn', type: 'button', role: 'tab', 'aria-selected': String(i === S.cur), 'aria-label': `Item ${i + 1}`, onclick: () => { S.cur = i; render(); } })));
    const card = h('article', { class: 'rcard', 'aria-label': `Item ${S.cur + 1} of ${total}` },
      h('div', { class: 'rcard-top' }, h('img', { class: 'crop' + (d._cutout ? ' cut' : ''), src: d._thumb, alt: d._cutout ? `Cutout of item ${S.cur + 1}` : `Cropped photo of item ${S.cur + 1}` }),
        h('div', {}, h('b', { class: 'rcard-n' }, `Item ${S.cur + 1} of ${total}`), h('small', {}, 'Check what I guessed, fix anything off.'),
          h('button', { class: 'btn btn-small btn-danger-ghost', type: 'button', onclick: () => { S.drafts.splice(S.cur, 1); if (!S.drafts.length) { resetFlow(); go('start'); } else render(); } }, 'Skip this one'))),
      form);
    return h('div', { class: 'review' },
      h('div', { class: 'stepper' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous item', disabled: S.cur === 0, html: icon('left'), onclick: () => { S.cur--; render(); window.scrollTo(0, 0); } }),
        dots,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next item', disabled: S.cur === total - 1, html: icon('right'), onclick: () => { S.cur++; render(); window.scrollTo(0, 0); } })),
      card,
      h('div', { class: 'sticky-save' }, saveAll));
  }

  async function saveDrafts() {
    const ds = S.drafts.slice();
    busy(`Hanging up ${ds.length} item${ds.length === 1 ? '' : 's'}…`);
    try {
      const v = await vision();
      for (const d of ds) {
        let photoId = null, cutoutId = null;
        try { const blob = await v.canvasToBlob(d._crop, { maxDim: 600, type: 'image/webp', quality: 0.8 }); photoId = await store.putPhoto(blob); } catch (e) { console.warn('photo save failed', e); }
        if (d._cutout) {
          try { const cb = await v.canvasToBlob(d._cutout, { maxDim: 600, type: 'image/webp', quality: 0.85, alpha: true }); cutoutId = await store.putPhoto(cb); } catch (e) { console.warn('cutout save failed', e); }
        }
        await saveItem(draftToItem(d, { photoId, cutoutId }), { silent: true });
      }
    } catch (e) {
      console.warn(e); S.error = 'Couldn’t save everything. Check your storage space and try again.'; go('review'); toast('Couldn’t save. Storage may be full.', { tone: 'warn' }); return;
    }
    const n = ds.length;
    resetFlow();
    toast(`Added ${n} item${n === 1 ? '' : 's'} to the closet.`);
    maybeRemind(navigate);
    emit('items');
    navigate('closet');
  }

  // ---------- add without photo ----------
  function addNoPhoto() {
    const make = () => newDraft({ slot: 'top' });
    let d = make();
    const holder = h('div', {});
    const save = h('button', { class: 'btn btn-cobalt', type: 'button', disabled: true }, 'Add to closet');
    const again = h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, 'Add + another');
    const paint = () => {
      clear(holder);
      holder.append(buildItemForm(d, { onChange: () => { const ok = d.colors.length > 0; save.disabled = !ok; again.disabled = !ok; } }));
      save.disabled = again.disabled = d.colors.length === 0;
    };
    paint();
    const s = sheet({ title: 'Add by color', content: h('div', { class: 'edit' }, holder, h('div', { class: 'sheet-actions' }, save, again)) });
    const commit = async () => { const it = await saveItem(draftToItem(d)); toast(`Added ${it.name}.`); buzz(14); return it; };
    save.addEventListener('click', async () => { await commit(); s.close(); maybeRemind(navigate); navigate('closet'); });
    again.addEventListener('click', async () => { await commit(); const keep = { slot: d.slot }; d = newDraft(keep); paint(); const sb = s.el.querySelector('.sheet-body'); if (sb) sb.scrollTop = 0; });
  }

  // ---------- render ----------
  function render() {
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Add clothes'));
    if (S.step === 'boxes' && !S.photo) S.step = 'start';
    if (S.step === 'review' && !S.drafts.length) S.step = 'start';
    if (S.step === 'busy' && !alive) return;
    const view = { start: startView, busy: busyView, boxes: boxesView, review: reviewView }[S.step] || startView;
    root.append(view());
  }
  if (S.step === 'busy') S.step = S.photo ? 'boxes' : 'start'; // stale busy state after leaving mid-way
  render();
  return { destroy() { alive = false; } };
}

/** Gentle backup reminder after adding lots of items. */
export function maybeRemind(navigate) {
  const n = realCount();
  const last = data.settings.remindedAt || 0;
  if (n >= 10 && n - last >= 10) {
    setSetting({ remindedAt: n });
    setTimeout(() => toast(`${n} items! Worth a backup. Your phone can forget things.`, { action: 'Back up', onAction: () => navigate('settings'), ms: 9000 }), 1800);
  }
}
