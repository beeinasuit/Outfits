// TODAY screen: the outfit slot machine.
import { SLOTS, SLOT_LABELS, OCCASIONS, WEATHER, todayISO } from '../model.js';
import { buildOutfits } from '../engine/build.js';
import { h, clear, html, shuffle, rand, sleep, drag, cap } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz, confetti, countUp, reduced, verdict, startShake, shakeSupported, requestShakePermission, shakeNeedsPermission } from './fx.js';
import { toast, announce, sheet } from './overlay.js';
import { data, getContext, setFeedback, logWorn, wornToday, setSetting, demoCount, removeDemo, loadDemo, emit } from './data.js';

const REELS = SLOTS.filter((s) => s !== 'extra');
const S = { locks: {}, current: null, seen: new Set(), pool: [], sig: '', spinning: false, autoSpun: false, stopShake: null };

export function mount(root, { navigate }) {
  let alive = true;
  const reels = {};
  let els = {};

  const ready = () => data.items.some((i) => i.available && i.slot === 'top') && data.items.some((i) => i.available && i.slot === 'bottom');
  const itemOk = (it) => { const cur = data.items.find((x) => x.id === it.id); return !!cur && cur.available; };
  const currentValid = () => S.current && Object.values(S.current.items).every((it) => !it || itemOk(it));

  // ---------- reel DOM ----------
  function cellFor(item, slot) {
    if (!item) return h('div', { class: 'cell cell-q' }, h('span', { class: 'art tile q' }, '?'), h('span', { class: 'cell-text' }, h('b', {}, '?'), h('small', {}, SLOT_LABELS[slot])));
    const sub = [item.kind, item.pattern !== 'solid' ? item.pattern : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'cell' }, itemArt(item, { cls: 'tile', title: false }), h('span', { class: 'cell-text' }, h('b', {}, item.name), h('small', {}, sub)));
  }

  function buildReel(slot) {
    const strip = h('span', { class: 'reel-strip' });
    const lockMark = h('span', { class: 'lockmark', html: icon('unlock', { size: 18 }) });
    const note = h('span', { class: 'reel-note' });
    const btn = h('button', { class: 'reel', type: 'button', 'data-slot': slot, 'data-state': 'empty', 'aria-pressed': 'false', onclick: () => onReel(slot) },
      h('span', { class: 'reel-tag' }, SLOT_LABELS[slot]),
      h('span', { class: 'reel-win' }, strip),
      note, lockMark);
    reels[slot] = { btn, strip, lockMark, note, item: null };
    return btn;
  }

  function emptyNote(slot, outfit) {
    if (slot === 'belt' && outfit && outfit.items.bottom && outfit.items.bottom.beltLoops === false) return 'no loops, no belt';
    const has = data.items.some((i) => i.slot === slot && i.available);
    if (slot === 'belt') return has ? 'no belt needed' : 'no belt in closet';
    return has ? `skipping ${SLOT_LABELS[slot].toLowerCase()} today` : `no ${SLOT_LABELS[slot].toLowerCase()} yet — tap to add`;
  }

  function setReelStatic(slot, item, outfit) {
    const r = reels[slot];
    r.item = item;
    clear(r.strip);
    if (item) { r.strip.append(cellFor(item, slot)); r.btn.dataset.state = 'filled'; }
    else { r.btn.dataset.state = 'empty'; r.note.textContent = emptyNote(slot, outfit); }
    syncLock(slot);
  }

  function syncLock(slot) {
    const r = reels[slot];
    const locked = !!(S.locks[slot] && r.item && S.locks[slot] === r.item.id);
    r.btn.classList.toggle('locked', locked);
    r.btn.setAttribute('aria-pressed', String(locked));
    r.lockMark.innerHTML = icon(locked ? 'lock' : 'unlock', { size: 18 });
    r.btn.disabled = false;
    const label = SLOT_LABELS[slot];
    r.btn.setAttribute('aria-label', r.item
      ? `${label}: ${r.item.name}. ${locked ? 'Locked. Tap to unlock.' : 'Tap to lock it for the next spin.'}`
      : `${label}: none. ${data.items.some((i) => i.slot === slot && i.available) ? 'Tap to pick one.' : 'Tap to add one.'}`);
  }

  async function landReel(slot, item, i, outfitPrev) {
    const r = reels[slot];
    const prev = r.item;
    const keep = S.locks[slot] && prev && item && prev.id === item.id && S.locks[slot] === item.id;
    if (!item) { setReelStatic(slot, null, S.current); return; }
    if (keep || reduced()) { setReelStatic(slot, item, S.current); return; }
    r.item = item;
    r.btn.dataset.state = 'filled';
    const pool = shuffle(data.items.filter((x) => x.slot === slot && x.available && x.id !== item.id));
    const fillers = [];
    const n = 7 + Math.min(i, 3);
    for (let k = 0; k < n; k++) fillers.push(pool.length ? pool[k % pool.length] : (k % 2 ? item : null));
    const seq = [prev, ...fillers, item];
    clear(r.strip);
    seq.forEach((it) => r.strip.append(cellFor(it, slot)));
    const total = seq.length;
    r.btn.classList.add('spinning');
    r.btn.classList.remove('locked');
    const dur = 900 + i * 210;
    const delay = i * 110;
    const anim = r.strip.animate([
      { transform: 'translateY(0)', filter: 'blur(0)' },
      { filter: 'blur(2.2px)', offset: 0.2 },
      { filter: 'blur(2.2px)', offset: 0.72 },
      { transform: `translateY(${-((total - 1) * 100) / total}%)`, filter: 'blur(0)' },
    ], { duration: dur, delay, easing: 'cubic-bezier(.2,.85,.25,1.12)', fill: 'both' });
    await anim.finished.catch(() => {});
    anim.cancel();
    clear(r.strip); r.strip.append(cellFor(item, slot));
    r.btn.classList.remove('spinning');
    r.btn.classList.remove('thunk'); void r.btn.offsetWidth; r.btn.classList.add('thunk');
    syncLock(slot);
    buzz(12);
  }

  // ---------- result UI ----------
  function resetResult() {
    els.stamp.className = 'stamp';
    els.stamp.textContent = '';
    els.meterFill.style.setProperty('--fill', '0');
    els.meterNum.textContent = '0';
    clear(els.stickers);
    els.stickers.append(h('p', { class: 'hint pending' }, 'Spinning…'));
    els.machine.classList.remove('shake');
  }

  function renderResult(outfit, { instant = false } = {}) {
    const v = verdict(outfit.score);
    els.meter.setAttribute('aria-valuenow', String(outfit.score));
    els.meterFill.style.setProperty('--fill', String(outfit.score));
    els.meter.dataset.tone = v.tone;
    if (instant) els.meterNum.textContent = String(outfit.score); else countUp(els.meterNum, outfit.score, 800);
    els.stamp.textContent = v.label;
    els.stamp.className = `stamp tone-${v.tone} ${instant ? 'show instant' : ''}`;
    if (!instant) {
      void els.stamp.offsetWidth;
      setTimeout(() => {
        if (!alive) return;
        els.stamp.classList.add('show');
        buzz(v.confetti ? [30, 40, 30, 40, 60] : 35);
        if (!reduced()) { els.machine.classList.remove('shake'); void els.machine.offsetWidth; els.machine.classList.add('shake'); }
        if (v.confetti) { const b = els.stamp.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + b.height / 2, 46); }
      }, reduced() ? 0 : 750);
    }
    clear(els.stickers);
    const rs = (outfit.reasons || []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
    if (!rs.length) els.stickers.append(h('p', { class: 'hint' }, 'Nothing to report. A quiet, sensible outfit.'));
    rs.forEach((r, i) => {
      const pos = r.delta > 0, neg = r.delta < 0;
      const rot = (Math.random() * 6 - 3).toFixed(1);
      els.stickers.append(h('span', { class: `sticker ${pos ? 'pos' : neg ? 'neg' : 'neu'}`, style: { '--rot': `${rot}deg`, '--d': `${(instant ? 0 : 900 + i * 130)}ms` } },
        h('span', { class: 'sticker-ico', html: icon(pos ? 'check' : neg ? 'alert' : 'info', { size: 15, sw: 3 }) }),
        h('span', { class: 'sticker-text' }, r.text),
        r.delta ? h('b', { class: 'sticker-delta' }, `${r.delta > 0 ? '+' : '−'}${Math.abs(Math.round(r.delta))}`) : null));
    });
    syncActions();
    const names = REELS.map((s) => outfit.items[s]?.name).filter(Boolean).join(', ');
    announce(`New outfit: ${names}. Fit score ${outfit.score}: ${v.short}.`);
  }

  function syncActions() {
    const o = S.current;
    const fb = o ? data.feedback[o.key] : null;
    els.like.setAttribute('aria-pressed', String(fb === 'like'));
    els.dislike.setAttribute('aria-pressed', String(fb === 'dislike'));
    const worn = o && wornToday(o);
    els.wear.classList.toggle('done', !!worn);
    els.wear.innerHTML = worn ? `${icon('check', { size: 20, sw: 3 })} Worn today` : `${icon('hanger', { size: 20 })} Wearing it!`;
    els.wear.setAttribute('aria-disabled', String(!o));
  }

  // ---------- spin ----------
  async function spin({ auto = false } = {}) {
    if (S.spinning || !alive) return;
    if (!ready()) return;
    for (const [slot, id] of Object.entries(S.locks)) if (!data.items.some((i) => i.id === id && i.available)) delete S.locks[slot];
    const ctx = await getContext();
    if (!alive) return;
    updateCtxNote(ctx);
    const sig = JSON.stringify([S.locks, ctx.occasion, ctx.weather, ctx.rain, data.items.map((i) => i.id + (i.available ? 1 : 0)).join()]);
    if (sig !== S.sig) {
      if (S.current) S.seen.add(S.current.key);
      S.pool = buildOutfits(data.items, { ...ctx, locks: { ...S.locks }, limit: 24, today: todayISO() });
      S.sig = sig;
    }
    const curKey = S.current && S.current.key;
    let next = S.pool.find((o) => !S.seen.has(o.key) && o.key !== curKey);
    if (!next) { S.seen = new Set(); next = S.pool.find((o) => o.key !== curKey) || S.pool[0]; }
    if (!next) {
      toast(Object.keys(S.locks).length ? 'Nothing works around those locks. Try unlocking one.' : 'Couldn’t build an outfit from what’s clean right now.', { tone: 'warn' });
      return;
    }
    S.seen.add(next.key);
    S.spinning = true;
    root.classList.add('spinning');
    els.spin.disabled = true;
    buzz([18, 30, 18]);
    resetResult();
    const prev = S.current;
    S.current = next;
    await Promise.all(REELS.map((slot, i) => landReel(slot, next.items[slot] || null, i, prev)));
    if (!alive) { S.spinning = false; return; }
    S.spinning = false;
    root.classList.remove('spinning');
    els.spin.disabled = false;
    renderResult(next);
    if (auto) S.autoSpun = true;
  }

  function showStatic() {
    const o = S.current;
    for (const slot of REELS) setReelStatic(slot, o.items[slot] || null, o);
    renderResult(o, { instant: true });
  }

  // ---------- interactions ----------
  function onReel(slot) {
    if (S.spinning) return;
    const r = reels[slot];
    if (r.item) {
      const locked = S.locks[slot] === r.item.id;
      if (locked) delete S.locks[slot]; else S.locks[slot] = r.item.id;
      syncLock(slot);
      r.btn.classList.remove('snap'); void r.btn.offsetWidth; r.btn.classList.add('snap');
      buzz(locked ? 8 : [14, 20, 22]);
      announce(`${SLOT_LABELS[slot]} ${locked ? 'unlocked' : 'locked'}`);
      els.lockHint.hidden = Object.keys(S.locks).length > 0;
      return;
    }
    const opts = data.items.filter((i) => i.slot === slot && i.available);
    if (!opts.length) { toast(`No ${SLOT_LABELS[slot].toLowerCase()} in the closet yet.`, { action: 'Add one', onAction: () => navigate('snap') }); return; }
    const grid = h('div', { class: 'pick-grid' }, opts.map((it) => h('button', { class: 'pick-item', type: 'button', onclick: () => { s.close(); S.locks[slot] = it.id; spin(); } }, itemArt(it, { cls: 'tile' }), h('span', {}, it.name))));
    const s = sheet({ title: `Add a ${SLOT_LABELS[slot].toLowerCase()}?`, content: grid });
  }

  function like(val) {
    const o = S.current; if (!o) return;
    const cur = data.feedback[o.key];
    const v = cur === val ? null : val;
    setFeedback(o, v).then(() => { if (alive) syncActions(); });
    buzz(v ? 14 : 6);
    if (v === 'like') { toast('Noted. More like this, please.'); const b = els.like.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top, 14); }
    if (v === 'dislike') { toast('Got it. That’s going on the naughty list.'); setTimeout(() => alive && spin(), 450); }
  }

  async function wear() {
    const o = S.current; if (!o) return;
    if (wornToday(o)) { toast('Already logged for today.'); return; }
    await logWorn(o);
    syncActions();
    els.wear.classList.remove('pop'); void els.wear.offsetWidth; els.wear.classList.add('pop');
    buzz([20, 30, 20, 30, 40]);
    const b = els.wear.getBoundingClientRect();
    confetti(b.left + b.width / 2, b.top + b.height / 2, 30);
    toast('Logged! Go be fabulous.');
    announce('Outfit logged as worn today.');
  }

  function updateCtxNote(ctx) { els.ctxNote.textContent = ctx.note || ''; }

  // ---------- build ----------
  function render() {
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Today’s outfit'));
    if (!ready()) { root.append(emptyState()); return; }
    const occ = h('select', { 'aria-label': 'Occasion', onchange: (e) => { setSetting({ occasion: e.target.value }); spin(); } },
      Object.entries(OCCASIONS).map(([k, v]) => h('option', { value: k, selected: (data.settings.occasion || 'any') === k }, v.label)));
    const wx = h('select', { 'aria-label': 'Weather', onchange: (e) => { setSetting({ weather: e.target.value }); spin(); } },
      [['none', 'Any weather'], ['auto', 'Auto (location)'], ...Object.entries(WEATHER).map(([k, v]) => [k, v.label])].map(([k, l]) => h('option', { value: k, selected: (data.settings.weather || 'none') === k }, l)));
    const ctxNote = h('span', { class: 'ctx-note', 'aria-live': 'polite' });
    const machineEl = h('div', { class: 'machine' });
    const reelsEl = h('div', { class: 'reels', role: 'group', 'aria-label': 'Outfit reels' }, REELS.map(buildReel));

    const knob = h('span', { class: 'lever-knob' });
    const lever = h('button', { class: 'lever', type: 'button', 'aria-label': 'Pull the lever to spin' },
      h('span', { class: 'lever-track', 'aria-hidden': 'true' }), knob, h('span', { class: 'lever-label', 'aria-hidden': 'true' }, 'PULL'));
    const maxTravel = () => Math.max(40, lever.clientHeight - 60);
    drag(lever, {
      start: () => { if (S.spinning) return false; knob.style.transition = 'none'; },
      move: (dx, dy) => { knob.style.transform = `translateY(${Math.max(0, Math.min(maxTravel(), dy))}px)`; },
      end: (dx, dy, e, moved) => {
        knob.style.transition = ''; knob.style.transform = '';
        if (!moved || dy > maxTravel() * 0.45) { buzz(20); spin(); }
      },
      threshold: 4,
    });
    lever.addEventListener('click', (e) => { if (e.detail === 0) spin(); }); // keyboard activation

    const meterFill = h('span', { class: 'meter-fill' });
    const meterNum = h('span', { class: 'meter-num-v' }, '0');
    const meter = h('div', { class: 'meter', role: 'meter', 'aria-label': 'Fit score', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
      h('span', { class: 'meter-title' }, 'FIT METER'),
      h('span', { class: 'meter-track' }, meterFill, h('span', { class: 'meter-ticks', 'aria-hidden': 'true' })),
      h('span', { class: 'meter-num' }, meterNum, h('small', {}, '/100')));
    const like_ = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Thumbs down: not for me', 'aria-pressed': 'false', html: icon('down', { size: 26 }), onclick: () => like('dislike') });
    const likeUp = h('button', { class: 'round-btn up', type: 'button', 'aria-label': 'Thumbs up: love it', 'aria-pressed': 'false', html: icon('up', { size: 26 }), onclick: () => like('like') });
    const spinBtn = h('button', { class: 'btn btn-big btn-tomato spin-btn', type: 'button', onclick: () => spin() }, h('span', { html: icon('spin', { size: 26, sw: 3 }) }), 'SPIN');
    const wearBtn = h('button', { class: 'btn btn-mint wear-btn', type: 'button', onclick: wear });
    const lockHint = h('p', { class: 'hint lock-hint', hidden: Object.keys(S.locks).length > 0 }, 'Tap a reel to lock it. Spins will build around it.');
    machineEl.append(
      h('div', { class: 'marquee', 'aria-hidden': 'true' }, h('span', { class: 'bulbs' }), h('span', { class: 'marquee-title' }, 'FIT MACHINE'), h('span', { class: 'bulbs' })),
      meter,
      h('div', { class: 'machine-body' }, reelsEl, lever),
      h('div', { class: 'machine-foot' }, spinBtn));

    const stamp = h('div', { class: 'stamp', 'aria-hidden': 'true' });
    const stickers = h('div', { class: 'stickers' });
    const card = h('div', { class: 'result-card' }, stamp,
      h('h2', { class: 'card-title' }, 'Why it works'), stickers,
      h('div', { class: 'card-foot' }, h('div', { class: 'feel-row' }, like_, wearBtn, likeUp), h('span', { class: 'swipe-hint', 'aria-hidden': 'true' }, 'or swipe this card: right = love, left = nope')));
    swipe(card, { right: () => like('like'), left: () => like('dislike') });

    const shakeChip = shakeSupported() && matchMedia('(pointer: coarse)').matches
      ? h('button', { class: 'chip shake-chip', type: 'button', 'aria-pressed': String(!!data.settings.shake), onclick: toggleShake }, h('span', { html: icon('vibrate', { size: 16 }) }), 'Shake to spin') : null;

    root.append(
      demoBanner(),
      h('div', { class: 'ctxbar' }, h('label', { class: 'pill-select' }, h('span', { html: icon('target', { size: 16 }) }), occ), h('label', { class: 'pill-select' }, h('span', { html: icon('sun', { size: 16 }) }), wx), ctxNote),
      machineEl, lockHint, card,
      shakeChip ? h('div', { class: 'center' }, shakeChip) : null);
    els = { machine: machineEl, meter, meterFill, meterNum, stamp, stickers, like: like_, dislike: like_, spin: spinBtn, wear: wearBtn, ctxNote, lockHint };
    els.like = likeUp; els.dislike = like_;

    if (currentValid()) showStatic();
    else { S.current = null; resetResult(); REELS.forEach((s) => setReelStatic(s, null, null)); setTimeout(() => alive && spin({ auto: true }), S.autoSpun ? 150 : 450); }
    if (S.current) getContext().then((c) => alive && updateCtxNote(c));
  }

  function demoBanner() {
    const n = demoCount();
    if (!n) return null;
    return h('div', { class: 'demo-banner' }, h('span', {}, h('b', {}, 'Sample closet'), ' — not your clothes'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: async () => { const k = await removeDemo(); toast(`Removed ${k} sample items.`); } }, 'Remove'));
  }

  function emptyState() {
    const hasAny = data.items.length > 0;
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art', html: mascot('sleepy', { size: 150 }) }),
      h('h2', {}, hasAny ? 'The machine needs a top and a bottom' : 'Your closet is a blank page'),
      h('p', {}, hasAny ? 'Add at least one clean top and one pair of bottoms, then pull the lever. Shoes and belts make it smarter.' : 'Snap a few of your clothes, or try the machine with a sample closet. It takes one tap and you can delete it just as fast.'),
      h('div', { class: 'row gap center wrap' },
        h('button', { class: 'btn btn-tomato', type: 'button', onclick: () => navigate('snap') }, 'Add clothes'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Try a sample closet')));
  }

  async function toggleShake() {
    const on = !data.settings.shake;
    if (on) { const ok = await requestShakePermission(); if (!ok) { toast('Motion access was declined, so shake is off.'); return; } }
    await setSetting({ shake: on });
    startStopShake();
    const chip = root.querySelector('.shake-chip'); if (chip) chip.setAttribute('aria-pressed', String(on));
    toast(on ? 'Shake your phone to spin.' : 'Shake to spin is off.');
  }
  function startStopShake() {
    if (S.stopShake) { S.stopShake(); S.stopShake = null; }
    if (data.settings.shake && shakeSupported()) S.stopShake = startShake(() => { if (alive && location.hash.startsWith('#/spin') || location.hash === '' ) spin(); });
  }

  render();
  startStopShake();

  return {
    update(what) { if (what === 'items' && !S.spinning) { S.sig = ''; render(); } if (what === 'worn') syncActions && els.wear && syncActions(); },
    destroy() { alive = false; if (S.stopShake) { S.stopShake(); S.stopShake = null; } },
  };
}

/** Horizontal swipe on a card: right = like, left = dislike. */
function swipe(el, { right, left }) {
  drag(el, {
    start: (e) => !e.target.closest('button'),
    move: (dx, dy) => { if (Math.abs(dx) > 8) { el.style.transition = 'none'; el.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`; el.dataset.dir = dx > 0 ? 'right' : 'left'; } },
    end: (dx) => {
      el.style.transition = ''; el.style.transform = ''; delete el.dataset.dir;
      if (dx > 90) right(); else if (dx < -90) left();
    },
    threshold: 6,
  });
}
