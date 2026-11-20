// YOUR COLOURS: selfie (optional) + drape test + manual pickers. Writes settings.profile (see makeProfile in model.js).
// The selfie never leaves the device and is left out of backups unless the user opts in.
import { COLOR_FAMILIES, UNDERTONES, DEPTHS, CONTRASTS, makeProfile } from '../model.js';
import { h, clear, cap, html, nextFrame, shuffle, drag } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { buzz, confetti, reduced } from './fx.js';
import { toast, confirmDialog } from './overlay.js';
import { data, setSetting } from './data.js';
import * as store from '../store.js';
import { upscaleMask } from './maskutil.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const OVAL_RATIO = 1.3; // oval height / width

let visionMods = null;
async function vision() {
  if (!visionMods) {
    const [img, col, skin] = await Promise.all([import('../vision/image.js'), import('../vision/color.js'), import('../vision/skin.js')]);
    visionMods = { ...img, ...col, ...skin };
  }
  return visionMods;
}

/** The six drape rounds. vote = which undertone the colour belongs to; con = contrast nudge (+ = high). */
export const ROUNDS = [
  { a: { name: 'Gold', hex: '#d6a62b', vote: 'warm' }, b: { name: 'Silver', hex: '#bfc4cd', vote: 'cool' } },
  { a: { name: 'Rust', hex: '#a4502a', vote: 'warm' }, b: { name: 'Burgundy', hex: '#6d1f2f', vote: 'cool' } },
  { a: { name: 'Cream', hex: '#efe2c2', vote: 'warm', con: -0.5 }, b: { name: 'Pure white', hex: '#ffffff', vote: 'cool', con: 0.5 } },
  { a: { name: 'Black', hex: '#1c1c1e', vote: null, con: 1 }, b: { name: 'Charcoal', hex: '#3d4046', vote: null, con: -1 } },
  { a: { name: 'Camel', hex: '#c19a6b', vote: 'warm' }, b: { name: 'Grey', hex: '#8e9196', vote: 'cool' } },
  { a: { name: 'Coral', hex: '#ff7f6b', vote: 'warm' }, b: { name: 'Fuchsia pink', hex: '#d8318f', vote: 'cool' } },
];

/** Tally the picks. picks: array of 0 (first option) / 1 (second) per round, in ROUNDS order. Pure. */
export function tallyDrape(picks, { contrastGuess = null } = {}) {
  let warm = 0, cool = 0, con = 0;
  ROUNDS.forEach((r, i) => {
    const o = picks[i] === 1 ? r.b : r.a;
    if (o.vote === 'warm') warm++; else if (o.vote === 'cool') cool++;
    if (o.con) con += o.con;
  });
  if (contrastGuess === 'high') con += 0.5; else if (contrastGuess === 'low') con -= 0.5;
  const undertone = warm >= 4 ? 'warm' : cool >= 4 ? 'cool' : 'neutral';
  const contrast = con >= 1 ? 'high' : con <= -1 ? 'low' : 'medium';
  return { undertone, contrast, warm, cool };
}

const FLATTER = {
  warm: ['olive', 'rust', 'beige', 'cream', 'mustard', 'brown', 'forest', 'orange'],
  cool: ['navy', 'burgundy', 'white', 'grey', 'blue', 'pink', 'lavender', 'teal'],
  neutral: ['navy', 'olive', 'cream', 'charcoal', 'denim', 'burgundy', 'teal', 'beige'],
};
const FRIENDS = {
  warm: 'olive, rust, camel and cream',
  cool: 'navy, burgundy, crisp white and teal',
  neutral: 'navy, olive, cream and burgundy',
};
const famLabel = (f) => (f === 'beige' ? 'Camel / khaki' : cap(f.replace('-', ' ')));

const SILHOUETTE = (skin = '#d8b394') => `<svg class="silhouette" viewBox="0 0 120 150" aria-hidden="true" focusable="false"><path d="M8 150c2-34 20-48 52-52 32 4 50 18 52 52Z" fill="${skin}" stroke="#17141f" stroke-width="3"/><rect x="50" y="78" width="20" height="24" rx="8" fill="${skin}" stroke="#17141f" stroke-width="3"/><ellipse cx="60" cy="52" rx="27" ry="34" fill="${skin}" stroke="#17141f" stroke-width="3"/><path d="M33 50c-2-24 12-36 28-36s30 12 26 36c-6-12-14-18-26-18S39 38 33 50Z" fill="#3b2a22" stroke="#17141f" stroke-width="3"/><circle cx="50" cy="56" r="2.6" fill="#17141f"/><circle cx="70" cy="56" r="2.6" fill="#17141f"/><path d="M52 70q8 6 16 0" fill="none" stroke="#17141f" stroke-width="2.6" stroke-linecap="round"/></svg>`;

export function mount(root, { navigate }) {
  let alive = true;
  const S = { view: 'home', fit: null, busyMsg: '', picks: [], round: 0, order: [], cutoutUrl: null, reveal: null, analysis: null, error: '' };

  const profile = () => makeProfile(data.settings.profile || {});
  const save = (patch) => setSetting({ profile: makeProfile({ ...profile(), ...patch }) });

  async function loadCutoutUrl() {
    const p = profile();
    S.cutoutUrl = null;
    if (p.cutoutId) { try { S.cutoutUrl = await store.getPhotoURL(p.cutoutId); } catch { S.cutoutUrl = null; } }
  }

  const camInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', capture: 'user', 'aria-label': 'Take a selfie', tabindex: '-1', onchange: (e) => pickFile(e.target.files) });
  const libInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'image/*', 'aria-label': 'Choose a selfie from your library', tabindex: '-1', onchange: (e) => pickFile(e.target.files) });

  // ---------- selfie: fit the oval ----------
  async function pickFile(list) {
    const file = [...(list || [])][0];
    camInput.value = ''; libInput.value = '';
    if (!file) return;
    S.view = 'busy'; S.busyMsg = 'Opening your photo…'; render();
    try {
      const v = await vision();
      await nextFrame();
      const bitmap = await v.fileToBitmap(file);
      const canvas = v.bitmapToCanvas(bitmap, 900);
      try { bitmap.close && bitmap.close(); } catch { /* ignore */ }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (S.fit && S.fit.url) URL.revokeObjectURL(S.fit.url);
      S.fit = { canvas, url: URL.createObjectURL(blob), oval: { cx: 0.5, cy: 0.42, rx: 0.2 } };
      S.view = 'fit';
    } catch (e) {
      console.warn(e); S.error = 'Couldn’t read that photo. Try another one.'; S.view = 'home';
    }
    if (alive) render();
  }

  function fitView() {
    const F = S.fit;
    const ar = F.canvas.width / F.canvas.height;
    const o = F.oval;
    const oval = h('div', { class: 'oval-guide', tabindex: '0', role: 'slider', 'aria-label': 'Face guide. Drag, or use arrow keys, to move it over your face.', 'aria-valuemin': '10', 'aria-valuemax': '40', 'aria-valuenow': String(Math.round(o.rx * 100)) },
      h('span', { class: 'oval-tip' }, 'Fit your face'));
    const stage = h('div', { class: 'oval-stage', style: { '--ar': String(ar) } }, h('img', { src: F.url, alt: 'Your selfie', draggable: 'false' }), oval);
    const range = h('input', { class: 'range', type: 'range', min: 10, max: 40, step: 1, value: Math.round(o.rx * 100), 'aria-label': 'Oval size' });
    const place = () => {
      const ryf = (o.rx * F.canvas.width * OVAL_RATIO) / F.canvas.height;
      o.cx = clamp(o.cx, 0.05, 0.95); o.cy = clamp(o.cy, 0.05, 0.95);
      oval.style.cssText = `left:${(o.cx - o.rx) * 100}%;top:${(o.cy - ryf) * 100}%;width:${o.rx * 200}%;height:${ryf * 200}%`;
      oval.setAttribute('aria-valuenow', String(Math.round(o.rx * 100)));
    };
    place();
    range.addEventListener('input', () => { o.rx = Number(range.value) / 100; place(); });
    let st = null;
    drag(oval, {
      start: () => { st = { cx: o.cx, cy: o.cy }; },
      move: (dx, dy) => { const r = stage.getBoundingClientRect(); o.cx = st.cx + dx / r.width; o.cy = st.cy + dy / r.height; place(); },
    });
    oval.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k) return;
      e.preventDefault(); o.cx += k[0] * 0.015; o.cy += k[1] * 0.015; place();
    });
    const step = (d) => { range.value = String(clamp(Number(range.value) + d, 10, 40)); range.dispatchEvent(new Event('input')); };
    return h('div', { class: 'fit-view' },
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Frame your face'), h('span', { class: 'page-sub' }, 'Drag the oval, then size it')),
      h('div', { class: 'stage-wrap' }, stage),
      h('div', { class: 'oval-size' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Smaller oval', html: icon('minus'), onclick: () => step(-2) }), range,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bigger oval', html: icon('plus'), onclick: () => step(2) })),
      h('p', { class: 'hint' }, 'Daylight, no filters, no heavy shadows. The oval should sit over forehead, cheeks and chin. Hair and background are fine, I only sample skin.'),
      h('div', { class: 'row gap between wrap' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { URL.revokeObjectURL(F.url); S.fit = null; S.view = 'home'; render(); } }, 'Cancel'),
        h('button', { class: 'btn btn-cobalt analyse-btn', type: 'button', onclick: analyse }, 'Looks good, read my colours')));
  }

  async function analyse() {
    const F = S.fit, o = F.oval;
    S.view = 'busy'; S.busyMsg = 'Reading your skin tone…'; render();
    try {
      const v = await vision();
      await nextFrame();
      const id = v.canvasImageData(F.canvas, 320);
      const rxPx = o.rx * id.width, ryPx = rxPx * OVAL_RATIO;
      const ell = { cx: o.cx * id.width, cy: o.cy * id.height, rx: rxPx, ry: ryPx };
      let wp = null;
      try { wp = v.estimateWhitePoint(id) || null; } catch { wp = null; }
      const skin = v.analyzeSkin(id, { ...ell, whitePoint: wp });
      const contrastGuess = v.guessContrast(id, ell, skin ? skin.lab : undefined);
      S.busyMsg = 'Cutting you out…'; render(); await nextFrame();
      const kx = F.canvas.width / id.width, ky = F.canvas.height / id.height;
      let cutout = null;
      try {
        const seg = v.segmentPortrait(id, ell);
        if (seg) {
          const box = { x: Math.round(seg.x * kx), y: Math.round(seg.y * ky), w: Math.round(seg.w * kx), h: Math.round(seg.h * ky) };
          const mask = upscaleMask({ x: seg.x, y: seg.y, w: seg.w, h: seg.h, mask: seg.mask }, kx, ky, box);
          if (mask) cutout = v.cutoutCanvas(F.canvas, box, mask, { feather: 3 });
        }
      } catch (e) { console.warn('portrait cutout failed', e); }
      if (!cutout) { // fall back to a plain crop around the head and shoulders
        const w = ell.rx * 2.8 * kx, hh = ell.ry * 3.4 * ky;
        cutout = v.cropCanvas(F.canvas, { x: (ell.cx * kx) - w / 2, y: (ell.cy - ell.ry * 1.1) * ky, w, h: hh });
      }
      const sBlob = await v.canvasToBlob(F.canvas, { maxDim: 800, type: 'image/webp', quality: 0.8 });
      const cBlob = await v.canvasToBlob(cutout, { maxDim: 700, type: 'image/webp', quality: 0.85, alpha: true });
      const prev = profile();
      const selfieId = await store.putPhoto(sBlob);
      const cutoutId = await store.putPhoto(cBlob);
      for (const old of [prev.selfieId, prev.cutoutId]) if (old) { try { await store.deletePhoto(old); } catch { /* ignore */ } }
      const patch = { selfieId, cutoutId };
      if (skin) {
        patch.skinHex = skin.hex; patch.depth = skin.depth; patch.contrast = contrastGuess;
        if (skin.confidence >= 0.45 && !prev.undertone) patch.undertone = skin.undertoneGuess;
      }
      S.analysis = skin ? { undertone: skin.undertoneGuess, confidence: skin.confidence, depth: skin.depth, contrast: contrastGuess } : { none: true };
      await save(patch);
      URL.revokeObjectURL(F.url); S.fit = null;
      await loadCutoutUrl();
      S.view = 'home';
      buzz([10, 20, 10]);
      toast(skin ? 'Got it. Now the drape test decides the undertone.' : 'Saved your photo, but I couldn’t read skin. Pick by hand or try the drape test.', { ms: 5500 });
    } catch (e) {
      console.warn(e); S.error = 'Something went wrong reading that photo. Try again in better light.'; S.view = 'fit'; toast('That didn’t work. Try again.', { tone: 'warn' });
    }
    if (alive) render();
  }

  // ---------- drape test ----------
  function figure() {
    if (S.cutoutUrl) return h('img', { class: 'drape-img', src: S.cutoutUrl, alt: '', draggable: 'false' });
    return h('span', { class: 'drape-sil', html: SILHOUETTE(profile().skinHex || undefined) });
  }
  function startDrape() {
    S.picks = []; S.round = 0; S.order = ROUNDS.map(() => Math.random() < 0.5); S.view = 'drape'; render();
  }
  function drapeView() {
    const r = ROUNDS[S.round];
    const flip = S.order[S.round];
    const opts = flip ? [[r.b, 1], [r.a, 0]] : [[r.a, 0], [r.b, 1]];
    const pick = (idx, el) => {
      if (S.locked) return;
      S.locked = true; el.classList.add('chosen'); buzz(12);
      S.picks[S.round] = idx;
      setTimeout(() => {
        S.locked = false;
        if (!alive) return;
        if (S.round < ROUNDS.length - 1) { S.round++; render(); } else finishDrape();
      }, reduced() ? 80 : 340);
    };
    const panel = ([o, idx]) => {
      const el = h('button', { class: 'drape-opt', type: 'button', 'data-name': o.name, 'data-pick': String(idx), 'data-vote': o.vote || '', 'aria-label': `${o.name}: this one makes me glow`, style: { '--cape': o.hex } },
        h('span', { class: 'drape-stage' }, figure(), h('span', { class: 'drape-cape' })), h('span', { class: 'drape-name' }, o.name));
      el.addEventListener('click', () => pick(idx, el));
      return el;
    };
    return h('div', { class: 'drape' },
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Drape test'), h('span', { class: 'page-sub', 'aria-live': 'polite' }, `Round ${S.round + 1} of ${ROUNDS.length}`)),
      h('div', { class: 'drape-dots', 'aria-hidden': 'true' }, ROUNDS.map((_, i) => h('i', { class: i < S.round ? 'done' : i === S.round ? 'now' : '' }))),
      h('h3', { class: 'drape-q' }, 'Which one makes you glow?'),
      h('div', { class: 'drape-pair', key: S.round }, opts.map(panel)),
      h('p', { class: 'hint' }, 'Look at your face and skin, not the cloth. Which colour makes you look brighter and healthier? Gut feeling wins.'),
      h('div', { class: 'row gap between' },
        S.round > 0 ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => { S.round--; render(); } }, 'Back') : h('span'),
        h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => { S.view = 'home'; render(); } }, 'Quit test')));
  }
  async function finishDrape() {
    const res = tallyDrape(S.picks, { contrastGuess: S.analysis && S.analysis.contrast ? S.analysis.contrast : null });
    S.reveal = res;
    S.view = 'home';
    await save({ undertone: res.undertone, contrast: res.contrast, enabled: true });
    buzz([20, 30, 40]);
    render();
    const card = root.querySelector('.reveal');
    if (card) { const b = card.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + 40, 34); card.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); }
  }

  // ---------- home sections ----------
  function revealCard() {
    const p = profile();
    const u = (S.reveal && S.reveal.undertone) || p.undertone;
    if (!S.reveal || !u) return null;
    const c = S.reveal.contrast || p.contrast || 'medium';
    const extra = c === 'high' ? 'Bold pairings like black and white work for you.' : c === 'low' ? 'Soft, tonal outfits flatter you more than stark contrast.' : 'You can go bold or soft, both land.';
    return h('section', { class: 'reveal', 'aria-live': 'polite' },
      h('div', { class: 'reveal-stamp' }, 'YOUR COLOURS'),
      h('h2', { class: 'reveal-title' }, `You’re ${u}-toned with ${c} contrast`),
      h('p', {}, `${cap(FRIENDS[u])} are your friends. ${extra}`),
      h('ul', { class: 'swatches', 'aria-label': 'Colours that flatter you' }, FLATTER[u].map((f) => h('li', {}, h('i', { class: 'sw', style: { background: COLOR_FAMILIES[f].hex } }), h('span', {}, famLabel(f))))),
      h('p', { class: 'hint' }, 'Saved. Outfit scores now give these colours a small nudge near your face. It never vetoes anything.'));
  }

  function selfieCard() {
    const p = profile();
    const has = !!(p.cutoutId || p.selfieId);
    const conf = S.analysis && !S.analysis.none ? (S.analysis.confidence < 0.4 ? 'a rough guess' : S.analysis.confidence < 0.7 ? 'a fair guess' : 'a fairly confident guess') : null;
    const dTxt = p.depth ? `${cap(p.depth)} depth` : null;
    return h('section', { class: 'set-card selfie-card' },
      h('h2', {}, h('span', { html: icon('camera') }), 'Your selfie'),
      h('div', { class: 'selfie-row' },
        h('div', { class: 'selfie-view' + (S.cutoutUrl ? ' has' : ''), 'aria-label': S.cutoutUrl ? 'Your head-and-shoulders cutout' : 'No selfie yet' }, S.cutoutUrl ? h('img', { src: S.cutoutUrl, alt: 'Your head-and-shoulders cutout' }) : h('span', { html: SILHOUETTE() })),
        h('div', { class: 'selfie-info' },
          has ? h('p', {}, 'This is the cutout the outfit board shows at the top, so you see colours next to your own face.') : h('p', {}, 'Optional, but the board gets personal: your face sits above the outfit, and colours are matched to you.'),
          p.skinHex ? h('div', { class: 'skin-read' }, h('i', { class: 'sw skin-sw', style: { background: p.skinHex }, role: 'img', 'aria-label': `Sampled skin colour ${p.skinHex}` }),
            h('span', {}, [dTxt, S.analysis && S.analysis.undertone ? `${S.analysis.undertone} undertone` : null].filter(Boolean).join(', '))) : null,
          conf ? h('p', { class: 'hint' }, `Undertone from a photo is ${conf}. Lighting can fool cameras, so the drape test below decides.`) : (p.skinHex ? h('p', { class: 'hint' }, 'Depth from a photo is fairly reliable. Undertone is not: lighting can fool cameras, so the drape test decides.') : null))),
      S.error ? h('p', { class: 'error-note', role: 'alert' }, S.error) : null,
      h('div', { class: 'row gap wrap selfie-btns' },
        h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => camInput.click(), html: `${icon('camera', { size: 20 })} ${has ? 'Retake' : 'Take a selfie'}` }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => libInput.click(), html: `${icon('image', { size: 20 })} From library` })),
      has ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: deleteSelfie, html: `${icon('trash', { size: 18 })} Delete selfie` }) : null,
      camInput, libInput);
  }

  async function deleteSelfie() {
    const ok = await confirmDialog({ title: 'Delete your selfie?', body: 'The photo and cutout are removed from this phone. Your colour settings stay.', confirmText: 'Delete selfie', danger: true });
    if (!ok) return;
    const p = profile();
    for (const id of [p.selfieId, p.cutoutId]) if (id) { try { await store.deletePhoto(id); } catch { /* ignore */ } }
    await save({ selfieId: null, cutoutId: null, includeSelfieInBackup: false });
    S.cutoutUrl = null; S.analysis = null;
    toast('Selfie deleted.');
    render();
  }

  function drapeCard() {
    const p = profile();
    return h('section', { class: 'set-card' },
      h('h2', {}, h('span', { html: icon('sparkle') }), 'The drape test'),
      h('p', {}, 'Stylists hold colours under your chin and watch your face. Six quick rounds, gold against silver, rust against burgundy, and so on. Pick the one that makes you glow.'),
      h('button', { class: 'btn btn-tomato drape-start', type: 'button', onclick: startDrape }, p.undertone ? 'Take the test again' : 'Start the drape test'),
      !S.cutoutUrl ? h('p', { class: 'hint' }, 'No selfie? No problem: you’ll see a friendly silhouette instead.') : null);
  }

  function manualCard() {
    const p = profile();
    const group = (key, label, vals, hint) => h('fieldset', { class: 'fld manual-fld', 'data-key': key },
      h('legend', {}, label), h('div', { class: 'chips' },
        vals.map((v) => h('button', { class: 'chip', type: 'button', 'data-val': v, 'aria-pressed': String(p[key] === v), onclick: () => { buzz(6); save({ [key]: v }); } }, cap(v))),
        h('button', { class: 'chip', type: 'button', 'data-val': '', 'aria-pressed': String(!p[key]), onclick: () => { buzz(6); save({ [key]: null }); } }, 'Not sure')),
      h('small', { class: 'hint' }, hint));
    return h('section', { class: 'set-card' },
      h('h2', {}, h('span', { html: icon('pencil') }), 'Set by hand'),
      group('undertone', 'Undertone', UNDERTONES, 'Warm leans golden, cool leans pink or blue. Gold jewellery flattering you means warm.'),
      group('depth', 'Skin depth', DEPTHS, 'How light or deep your skin is overall.'),
      group('contrast', 'Contrast', CONTRASTS, 'The gap between your skin, hair and eyes. Dark hair on pale skin is high. Soft hair on skin of similar depth is low.'));
  }

  function enableCard() {
    const p = profile();
    const any = p.undertone || p.depth || p.contrast;
    const on = p.enabled;
    return h('section', { class: 'set-card' },
      h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(!!on), disabled: !any, 'data-key': 'complexion',
        onclick: () => { buzz(8); save({ enabled: !on }); } },
        h('span', { class: 'toggle-text' }, h('b', {}, 'Match colours to my complexion'), h('small', {}, any ? 'A small nudge for colours worn near your face' : 'Set something above to switch this on')),
        h('span', { class: 'switch' + (on ? ' on' : ''), 'aria-hidden': 'true' }, h('i'), h('em', {}, on ? 'On' : 'Off'))));
  }

  function homeView() {
    return h('div', { class: 'profile' },
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Your colours'), h('a', { class: 'page-sub link', href: '#/settings' }, 'Settings')),
      h('section', { class: 'colours-intro' },
        h('div', { class: 'intro-art', html: mascot('wink', { size: 84 }) }),
        h('div', {}, h('p', {}, 'The board shows you next to your outfit, and the machine checks colours against your complexion: undertone, depth and contrast.'),
          h('p', { class: 'privacy' }, h('span', { html: icon('lock', { size: 16 }) }), ' Your selfie never leaves this phone, and it’s left out of backups unless you switch that on in Settings.'))),
      revealCard(),
      selfieCard(), drapeCard(), manualCard(), enableCard());
  }

  function busyView() {
    return h('div', { class: 'busy', role: 'status' }, h('div', { class: 'busy-art', html: mascot('wow', { size: 130 }) }), h('h2', {}, S.busyMsg), h('div', { class: 'loader', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  }

  function render() {
    if (!alive) return;
    const y = window.scrollY;
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Your colours'));
    root.append(({ home: homeView, fit: fitView, drape: drapeView, busy: busyView }[S.view] || homeView)());
    if (S.view === 'home') window.scrollTo(0, y);
  }

  loadCutoutUrl().then(() => { render(); });
  render();
  return {
    update(what) {
      if (S.view !== 'home') return;
      if (what === 'settings') loadCutoutUrl().then(render);
    },
    destroy() { alive = false; if (S.fit && S.fit.url) URL.revokeObjectURL(S.fit.url); },
  };
}
