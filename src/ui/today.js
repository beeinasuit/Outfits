// TODAY: the outfit appears as a flat-lay board of your real clothes. Shuffle for a new one, change any single piece
// (app-suggested or self-picked, then rescored), lock what you love, improve the look, battle outfits.
import { SLOT_LABELS, WEATHER, outfitKey, todayISO } from '../model.js';
import { buildOutfits, rankForSlot } from '../engine/build.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { buzz, confetti, countUp, reduced, verdict, startShake, shakeSupported, requestShakePermission } from './fx.js';
import { toast, announce, sheet } from './overlay.js';
import { data, getContext, setFeedback, logWorn, wornToday, setSetting, allOccasions, demoCount, removeDemo, loadDemo, laundryDay } from './data.js';
import { renderBoard, ADDABLE } from './board.js';
import { openSwap } from './swap.js';
import { openGlowUp } from './glowup.js';
import { occasionPicker } from './occasions.js';

const S = { hintDone: false, locks: {}, current: null, seen: new Set(), pool: [], sig: '', stopShake: null, ctx: null };
const WX = [['none', '—', 'Any weather'], ['auto', '📍', 'Auto (location)'], ['hot', '🔥', 'Hot'], ['warm', '☀️', 'Warm'], ['mild', '🍃', 'Mild'], ['cold', '🧣', 'Cold'], ['freezing', '🥶', 'Freezing']];
const SLOT_ORDER = ['headwear', 'layer', 'top', 'neckwear', 'belt', 'bottom', 'shoes', 'extra'];
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');

export function mount(root, { navigate }) {
  let alive = true;
  let busy = false;
  let sheetOpen = false;
  let els = {};
  let board = null;
  let picker = null;
  let kind = '';

  const avail = (slot) => data.items.some((i) => i.available && i.slot === slot);
  const has = (slot) => data.items.some((i) => i.slot === slot);
  function stateKind() {
    if (!data.items.length) return 'none';
    if (avail('top') && avail('bottom')) return 'ok';
    if (has('top') && has('bottom')) return 'wash';
    return 'need';
  }
  const latest = (it) => data.items.find((x) => x.id === it.id);
  const currentValid = () => {
    const c = S.current;
    if (!c) return false;
    const its = Object.values(c.items).filter(Boolean);
    if (!its.every((it) => latest(it))) return false;
    return its.every((it) => latest(it).available) || wornToday(c);
  };
  const addableNow = () => ADDABLE.filter((s) => avail(s));

  // ---------- result header ----------
  function paintResult(outfit, { from = 0, instant = false, delta = null } = {}) {
    const v = verdict(outfit.score);
    els.score.dataset.tone = v.tone;
    els.meter.setAttribute('aria-valuenow', String(outfit.score));
    els.meter.setAttribute('aria-valuetext', `${outfit.score} out of 100, ${v.short}`);
    els.fill.style.setProperty('--fill', String(outfit.score));
    if (instant) els.num.textContent = String(outfit.score); else countUp(els.num, outfit.score, 650, from);
    els.stamp.textContent = v.label;
    els.stamp.className = `t-stamp tone-${v.tone}`;
    void els.stamp.offsetWidth;
    els.stamp.classList.add(instant ? 'shown' : 'slam');
    if (!instant) {
      setTimeout(() => {
        if (!alive) return;
        buzz(v.confetti ? [30, 40, 30, 40, 60] : 30);
        if (v.confetti && delta == null) { const b = els.stamp.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + b.height / 2, 40); }
      }, reduced() ? 0 : 420);
    }
    if (delta != null && delta !== 0) {
      const pop = h('span', { class: `t-delta-pop ${delta > 0 ? 'up' : 'down'}`, 'aria-hidden': 'true' }, signed(delta));
      els.numwrap.append(pop);
      setTimeout(() => pop.remove(), 2600);
    }
    paintStickers(outfit, instant);
    syncActions();
    const names = SLOT_ORDER.map((s) => outfit.items[s] && outfit.items[s].name).filter(Boolean).join(', ');
    announce(delta != null ? `Fit score ${outfit.score}, ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged'}${delta ? ` ${Math.abs(delta)}` : ''}: ${v.short}.` : `New outfit: ${names}. Fit score ${outfit.score}: ${v.short}.`);
  }

  function paintStickers(outfit, instant) {
    clear(els.stickers);
    const rs = (outfit.reasons || []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
    if (!rs.length) els.stickers.append(h('p', { class: 'hint' }, 'Nothing to report. A quiet, sensible outfit.'));
    rs.forEach((r, i) => {
      const pos = r.delta > 0, neg = r.delta < 0;
      els.stickers.append(h('span', { class: `t-sticker ${pos ? 'pos' : neg ? 'neg' : 'neu'}`, style: { '--rot': `${((i * 37) % 7) - 3}deg`, '--d': `${instant ? 0 : 500 + i * 110}ms` } },
        h('span', { class: 't-sticker-ico', html: icon(pos ? 'check' : neg ? 'alert' : 'info', { size: 14, sw: 3 }) }),
        h('span', {}, r.text),
        r.delta ? h('b', { class: 't-sticker-delta' }, signed(Math.round(r.delta))) : null));
    });
  }

  function resetResult() {
    els.stamp.className = 't-stamp';
    els.stamp.textContent = '';
    els.score.dataset.tone = '';
    els.fill.style.setProperty('--fill', '0');
    clear(els.stickers);
  }

  function syncActions() {
    const o = S.current;
    const fb = o ? data.feedback[o.key] : null;
    if (!els.like) return;
    els.like.setAttribute('aria-pressed', String(fb === 'like'));
    els.dislike.setAttribute('aria-pressed', String(fb === 'dislike'));
    const worn = !!o && wornToday(o);
    els.wear.classList.toggle('done', worn);
    els.wear.innerHTML = worn ? `${icon('check', { size: 20, sw: 3 })} Worn today` : `${icon('hanger', { size: 20 })} Wearing it!`;
    els.wear.disabled = !o;
    els.improve.disabled = !o; els.battle.disabled = false;
  }

  // ---------- choosing outfits ----------
  async function pickNext() {
    for (const [slot, id] of Object.entries(S.locks)) if (!data.items.some((i) => i.id === id && i.available)) delete S.locks[slot];
    const ctx = await getContext();
    S.ctx = ctx;
    els.note.textContent = ctx.note || '';
    paintPills();
    const sig = JSON.stringify([S.locks, ctx.occasion, ctx.weather, ctx.rain, data.items.map((i) => i.id + (i.available ? 1 : 0)).join()]);
    if (sig !== S.sig) {
      if (S.current) S.seen.add(S.current.key);
      S.pool = buildOutfits(data.items, { ...ctx, locks: { ...S.locks }, limit: 24, today: todayISO() });
      S.sig = sig;
    }
    const curKey = S.current && S.current.key;
    let next = S.pool.find((o) => !S.seen.has(o.key) && o.key !== curKey);
    if (!next) { S.seen = new Set(); next = S.pool.find((o) => o.key !== curKey) || S.pool[0]; }
    return next || null;
  }

  async function shuffle() {
    if (busy || !alive || stateKind() !== 'ok') return;
    busy = true;
    els.shuffle.disabled = true;
    try {
      const next = await pickNext();
      if (!alive) return;
      if (!next) {
        toast(Object.keys(S.locks).length ? 'Nothing works around those locks. Try unlocking one.' : 'Couldn’t build an outfit from what’s clean right now.', { tone: 'warn' });
        return;
      }
      S.seen.add(next.key);
      const from = S.current ? S.current.score : 0;
      buzz([18, 30, 18]);
      deselect();
      const keep = Object.keys(S.locks).filter((s) => next.items[s] && next.items[s].id === S.locks[s]);
      els.stage.classList.add('shuffling');
      if (S.current) { resetResult(); await board.flyOut({ keep }); }
      if (!alive) return;
      S.current = next;
      board.setOptions({ locks: S.locks, addable: addableNow(), profile: S.ctx.profile });
      board.update(next.items, { animate: true });
      fit();
      els.stage.classList.remove('shuffling');
      paintResult(next, { from });
    } finally {
      busy = false;
      if (els.shuffle) els.shuffle.disabled = false;
    }
  }

  // ---------- single-piece changes ----------
  async function ctxNow() { const c = await getContext(); S.ctx = c; return c; }

  function applyChange(res) {
    const old = S.current ? S.current.score : res.score;
    const items = res.items;
    for (const [slot, id] of Object.entries(S.locks)) if (!items[slot] || items[slot].id !== id) delete S.locks[slot];
    S.current = { items, score: res.score, reasons: res.reasons, key: outfitKey(items) };
    S.seen.add(S.current.key);
    board.setOptions({ locks: S.locks, addable: addableNow() });
    board.update(items, { animate: true });
    fit();
    buzz([12, 24, 12]);
    paintResult(S.current, { from: old, delta: res.score - old });
  }

  async function swapSlot(slot) {
    if (busy || sheetOpen || !S.current) return;
    sheetOpen = true;
    try {
      const ctx = await ctxNow();
      const sh = openSwap(slot, S.current.items, ctx, applyChange);
      const done = sh.el; new MutationObserver((_, ob) => { if (!done.isConnected) { sheetOpen = false; ob.disconnect(); } }).observe(document.body, { childList: true });
    } catch (e) { sheetOpen = false; throw e; }
  }
  async function removeSlot(slot) {
    if (busy || sheetOpen || !S.current) return;
    const ctx = await ctxNow();
    const row = rankForSlot(data.items, S.current.items, slot, ctx).find((r) => r.item === null);
    if (!row) return;
    applyChange({ items: row.items, score: row.score, reasons: row.reasons });
  }
  // ----- selection toolbar -----
  function onSelect(slot) {
    if (!els.bar) return;
    if (!slot) { els.bar.hidden = true; return; }
    S.hintDone = true; els.lockHint.hidden = true;
    paintBar(slot);
  }
  function paintBar(slot) {
    const it = S.current && S.current.items[slot];
    if (!it) { els.bar.hidden = true; return; }
    const locked = S.locks[slot] === it.id;
    const optional = ['layer', 'neckwear', 'headwear', 'extra', 'belt'].includes(slot);
    els.bar.replaceChildren(
      h('span', { class: 't-bar-name' }, `${SLOT_LABELS[slot]}: ${it.name}`),
      h('div', { class: 't-bar-row' },
        h('button', { class: 't-bar-btn primary', type: 'button', 'data-act': 'change', onclick: () => { deselect(); swapSlot(slot); } }, 'Change'),
        h('button', { class: 't-bar-btn', type: 'button', 'data-act': 'lock', 'aria-pressed': String(locked), onclick: () => { toggleLock(slot); paintBar(slot); } }, locked ? '🔒 Locked' : '🔓 Lock'),
        optional ? h('button', { class: 't-bar-btn danger', type: 'button', 'data-act': 'remove', onclick: () => { deselect(); removeSlot(slot); } }, 'Remove') : null));
    els.bar.hidden = false;
    const piece = board.pieceEl(slot);
    if (piece) {
      const st = els.stage.getBoundingClientRect(), pr = piece.getBoundingClientRect(), bh = els.bar.offsetHeight || 84;
      let top = pr.top - st.top - bh - 8;
      if (top < 0) top = pr.bottom - st.top + 8;
      els.bar.style.top = `${Math.max(0, Math.min(top, st.height - bh))}px`;
    }
  }
  function deselect() { if (board && board.selected()) board.select(null); else if (els.bar) els.bar.hidden = true; }

  function toggleLock(slot) {
    if (busy || !S.current) return;
    const it = S.current.items[slot];
    if (!it) return;
    const on = S.locks[slot] === it.id;
    if (on) delete S.locks[slot]; else S.locks[slot] = it.id;
    board.setOptions({ locks: S.locks });
    buzz(on ? 8 : [14, 20, 22]);
    announce(`${SLOT_LABELS[slot]} ${on ? 'unlocked' : 'locked'}`);
    S.sig = '';
  }

  async function improve() {
    if (busy || sheetOpen || !S.current) return;
    sheetOpen = true;
    try {
      const ctx = await ctxNow();
      const sh = openGlowUp(S.current.items, ctx, applyChange);
      const done = sh.el; new MutationObserver((_, ob) => { if (!done.isConnected) { sheetOpen = false; ob.disconnect(); } }).observe(document.body, { childList: true });
    } catch (e) { sheetOpen = false; throw e; }
  }

  function like(val) {
    const o = S.current; if (!o) return;
    const cur = data.feedback[o.key];
    const v = cur === val ? null : val;
    setFeedback(o, v).then(() => { if (alive) syncActions(); });
    buzz(v ? 14 : 6);
    if (v === 'like') { toast('Noted. More like this, please.'); const b = els.like.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top, 14); }
    if (v === 'dislike') { toast('Got it. That’s going on the naughty list.'); setTimeout(() => alive && shuffle(), 450); }
  }

  async function wear() {
    const o = S.current; if (!o) return;
    if (wornToday(o)) { toast('Already logged for today.'); return; }
    const res = await logWorn(o);
    syncActions();
    els.wear.classList.remove('pop'); void els.wear.offsetWidth; els.wear.classList.add('pop');
    buzz([20, 30, 20, 30, 40]);
    const b = els.wear.getBoundingClientRect();
    confetti(b.left + b.width / 2, b.top + b.height / 2, 30);
    const h_ = res && res.hampered;
    toast(h_ > 0 ? `Logged! ${h_} piece${h_ === 1 ? '' : 's'} went to the hamper 🧺` : 'Logged! Go be fabulous.');
    announce('Outfit logged as worn today.');
  }

  // ---------- build ----------
  function render() {
    clear(root);
    kind = stateKind();
    board = null; els = {}; picker = null;
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Today’s outfit'), demoBanner());
    if (kind !== 'ok') { root.append(emptyState(kind)); return; }

    const occPill = h('button', { class: 't-pill t-occ-pill', type: 'button', 'aria-haspopup': 'dialog', onclick: openOccasion });
    const wxPill = h('button', { class: 't-pill t-wx-pill', type: 'button', 'aria-haspopup': 'dialog', onclick: openWeather });
    const wxChips = null;

    const num = h('b', { class: 't-num' }, '0');
    const numwrap = h('span', { class: 't-numwrap' }, num, h('small', {}, '/100'));
    const fill = h('span', { class: 't-fill' });
    const meter = h('div', { class: 't-meter', role: 'meter', 'aria-label': 'Fit score', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
      h('span', { class: 't-meter-top' }, h('span', { class: 't-meter-label' }, 'FIT SCORE'), numwrap),
      h('span', { class: 't-track' }, fill, h('span', { class: 't-ticks', 'aria-hidden': 'true' })));
    const stamp = h('div', { class: 't-stamp', 'aria-hidden': 'true' });
    const score = h('div', { class: 't-score' }, meter, stamp);

    board = renderBoard(S.current && currentValid() ? S.current.items : {}, {
      profile: S.ctx && S.ctx.profile, interactive: true, size: 'full', locks: S.locks, animate: !S.current,
      onSelect: onSelect, onAdd: swapSlot, addable: addableNow(),
    });
    const note = h('span', { class: 't-note', 'aria-live': 'polite' });
    const bar = h('div', { class: 't-bar', role: 'toolbar', 'aria-label': 'Piece actions', hidden: true });
    const stage = h('div', { class: 't-stage' }, board, bar);
    swipeCard(stage, { right: () => like('like'), left: () => like('dislike') });

    const shuffleBtn = h('button', { class: 'btn btn-big btn-sun t-shuffle', type: 'button', onclick: () => shuffle() }, h('span', { class: 't-shuffle-ico', html: icon('spin', { size: 26, sw: 3 }) }), 'SHUFFLE');
    const dock = h('div', { class: 't-dock' }, shuffleBtn);
    const dislike = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Thumbs down: not for me', 'aria-pressed': 'false', html: icon('down', { size: 26 }), onclick: () => like('dislike') });
    const likeB = h('button', { class: 'round-btn up', type: 'button', 'aria-label': 'Thumbs up: love it', 'aria-pressed': 'false', html: icon('up', { size: 26 }), onclick: () => like('like') });
    const wear_ = h('button', { class: 'btn btn-mint t-wear', type: 'button', onclick: wear });
    const improveBtn = h('button', { class: 'btn btn-cobalt btn-small t-improve', type: 'button', onclick: improve }, h('span', { html: icon('sparkle', { size: 18 }) }), 'Improve this look');
    const battle = h('button', { class: 'btn btn-ghost btn-small t-battle', type: 'button', onclick: () => navigate('battle') }, '⚔️ Battle');
    const stickers = h('div', { class: 't-stickers' });
    const lockHint = h('p', { class: 'hint t-hint', hidden: S.hintDone }, 'Tap any piece to change, lock or remove it.');
    const shakeChip = shakeSupported() && matchMedia('(pointer: coarse)').matches
      ? h('button', { class: 'chip shake-chip', type: 'button', 'aria-pressed': String(!!data.settings.shake), onclick: toggleShake }, h('span', { html: icon('vibrate', { size: 16 }) }), 'Shake to shuffle') : null;

    root.append(
      h('div', { class: 't-ctx' }, occPill, wxPill),
      score, stage,
      dock,
      h('div', { class: 't-actions' }, h('div', { class: 'feel-row t-feel' }, dislike, wear_, likeB), h('div', { class: 't-extra' }, improveBtn, battle)),
      h('a', { class: 'ck-entry', href: '#/check', 'data-goto': 'check' }, h('span', { class: 'ck-entry-emoji', 'aria-hidden': 'true' }, '📸'), 'Rate what I’m wearing'),
      h('div', { class: 't-links' },
        !(data.settings.profile && data.settings.profile.cutoutId) ? h('a', { class: 'btn btn-ghost btn-small', href: '#/profile' }, '🎨 Find your colors') : null,
        h('a', { class: 'btn btn-ghost btn-small', href: '#/plan' }, '🗓️ Plan the week')),
      lockHint, h('h2', { class: 't-why-title' }, 'Why it works'), stickers,
      shakeChip ? h('div', { class: 'center' }, shakeChip) : null);
    els = { numwrap, bar, score, meter, num, fill, stamp, stickers, stage, shuffle: shuffleBtn, like: likeB, dislike, wear: wear_, improve: improveBtn, battle, note, lockHint, occPill, wxPill, dock };

    paintPills();
    fit();
    if (S.current && currentValid()) {
      // coming back to a screen: show the saved outfit instantly
      board.setOptions({ locks: S.locks, addable: addableNow() });
      fit();
      paintResult(S.current, { instant: true });
      getContext().then((c) => { if (alive) { S.ctx = c; els.note.textContent = c.note || ''; paintPills(); board.setOptions({ profile: c.profile }); fit(); } });
    } else {
      S.current = null;
      setTimeout(() => alive && shuffle(), 120);
    }
  }

  function paintPills() {
    if (!els.occPill) return;
    const occs = allOccasions();
    const key = occs[data.settings.occasion] ? data.settings.occasion : 'any';
    const o = occs[key];
    els.occPill.replaceChildren(h('span', { class: 't-pill-ico', 'aria-hidden': 'true' }, o.emoji), h('span', { class: 't-pill-txt' }, o.label), h('span', { class: 't-pill-caret', 'aria-hidden': 'true' }, '▾'));
    els.occPill.setAttribute('aria-label', `Occasion: ${o.label}. Change`);
    const wk = data.settings.weather || 'none';
    const w = WX.find((x) => x[0] === wk) || WX[0];
    const note = wk === 'auto' && els.note.textContent ? ` · ${els.note.textContent}` : '';
    els.wxPill.replaceChildren(h('span', { class: 't-pill-ico', 'aria-hidden': 'true' }, w[1]), h('span', { class: 't-pill-txt' }, `${w[2]}${note}`), h('span', { class: 't-pill-caret', 'aria-hidden': 'true' }, '▾'));
    els.wxPill.setAttribute('aria-label', `Weather: ${w[2]}${note}. Change`);
  }

  function openOccasion() {
    const sh = { s: null };
    const pk = occasionPicker({ value: data.settings.occasion || 'any', onChange: (k) => { sh.s.close(); setSetting({ occasion: k }); shuffle(); } });
    picker = pk;
    sh.s = sheet({ title: 'What are you dressing for?', content: h('div', { class: 'occ-sheet' }, pk), onClose: () => { if (picker === pk) picker = null; } });
  }
  function openWeather() {
    const s_ = sheet({ title: 'Weather', content: h('div', { class: 'chips t-wx', role: 'group', 'aria-label': 'Weather' },
      WX.map(([k, e, l]) => h('button', { class: 'chip t-wx-chip', type: 'button', 'data-wx': k, 'aria-pressed': String((data.settings.weather || 'none') === k),
        onclick: () => { s_.close(); setSetting({ weather: k }); shuffle(); } }, h('span', { 'aria-hidden': 'true' }, e), l))) });
  }

  /** Size the board so the whole outfit (face/hat to shoes + ghost chips) fits between the controls and the shuffle dock. */
  function fit() {
    if (!board || !els.dock || !alive) return;
    const vv = window.innerHeight;
    const top = board.getBoundingClientRect().top + window.scrollY;
    const tab = document.querySelector('.tabbar');
    const tabH = tab ? tab.getBoundingClientRect().height : 62;
    const dockH = els.dock.offsetHeight + 8;
    const ghosts = board.querySelector('.fm-ghosts');
    const ghostH = ghosts && !ghosts.hidden ? ghosts.offsetHeight : 0;
    const avail = vv - top - tabH - dockH - 6 - ghostH - 24;
    const ar = board.aspect || 0.8;
    const w = Math.max(190, Math.min(560, avail * ar + 24));
    board.style.maxWidth = `${Math.round(w)}px`;
    board.style.marginInline = 'auto';
  }

  function demoBanner() {
    const n = demoCount();
    if (!n) return null;
    return h('div', { class: 'demo-banner' }, h('span', {}, h('b', {}, 'Sample closet'), ' — not your clothes'),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: async () => { const k = await removeDemo(); toast(`Removed ${k} sample items.`); } }, 'Remove'));
  }

  function emptyState(k) {
    if (k === 'wash') {
      const n = data.items.filter((i) => !i.available).length;
      return h('div', { class: 'empty' },
        h('div', { class: 'empty-art', html: mascot('sleepy', { size: 150 }) }),
        h('h2', {}, 'Everything good is in the wash 🧺'),
        h('p', {}, `${n} piece${n === 1 ? ' is' : 's are'} in the hamper, and Today needs a clean top and a clean bottom. Is it laundry day?`),
        h('div', { class: 'row gap center wrap' },
          h('button', { class: 'btn btn-mint', type: 'button', 'data-act': 'laundry', onclick: async () => { const c = await laundryDay(); toast(`Laundry day! ${c} piece${c === 1 ? '' : 's'} back in rotation.`); } }, 'It’s laundry day'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigate('closet') }, 'Open the closet')));
    }
    const hasAny = data.items.length > 0;
    const needTop = !has('top'), needBottom = !has('bottom');
    const missing = needTop && needBottom ? 'a top and a bottom' : needTop ? 'a top' : 'a bottom';
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-art', html: mascot('sleepy', { size: 150 }) }),
      h('h2', {}, hasAny ? `Outfits need ${missing}` : 'Your closet is a blank page'),
      h('p', {}, hasAny ? `You have ${data.items.length} piece${data.items.length === 1 ? '' : 's'} so far. Add ${missing} and your first outfit will land on the board. Shoes and belts make it smarter.` : 'Snap a few of your clothes, or try it with a sample closet. It takes one tap and you can delete it just as fast.'),
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
    toast(on ? 'Shake your phone to shuffle.' : 'Shake to shuffle is off.');
  }
  function startStopShake() {
    if (S.stopShake) { S.stopShake(); S.stopShake = null; }
    if (data.settings.shake && shakeSupported()) S.stopShake = startShake(() => { if (alive && (location.hash.startsWith('#/today') || location.hash.startsWith('#/spin') || location.hash === '')) shuffle(); });
  }

  const onDocDown = (e) => { if (els.bar && !els.bar.hidden && !e.target.closest('.fm-piece, .t-bar, dialog')) deselect(); };
  const onKey = (e) => { if (e.key === 'Escape' && els.bar && !els.bar.hidden && !document.querySelector('dialog.sheet')) { const sl = board && board.selected(); deselect(); const p = sl && board.pieceEl(sl); if (p) p.focus({ preventScroll: true }); } };
  document.addEventListener('pointerdown', onDocDown); document.addEventListener('keydown', onKey);
  const onResize = () => { fit(); if (board && board.selected()) paintBar(board.selected()); };
  window.addEventListener('resize', onResize);
  render();
  startStopShake();

  const api = () => api.destroy();
  api.update = (what) => {
    if (!alive) return;
    if (what === 'items') {
      S.sig = '';
      if (stateKind() !== kind) { S.sig = ''; render(); return; }
      if (kind !== 'ok' || busy) return;
      if (!S.current) return;
      const its = Object.values(S.current.items).filter(Boolean);
      if (!its.every(latest)) { S.current = null; S.sig = ''; shuffle(); return; }
      const fresh = {};
      for (const [s, it] of Object.entries(S.current.items)) fresh[s] = latest(it) || it;
      S.current.items = fresh;
      board.setOptions({ addable: addableNow() });
      board.update(fresh, { animate: false });
      fit();
      syncActions();
    } else if (what === 'settings') {
      if (picker) picker.refresh();
      paintPills();
    } else if (what === 'worn' || what === 'feedback') syncActions();
  };
  api.destroy = () => { alive = false; window.removeEventListener('resize', onResize); document.removeEventListener('pointerdown', onDocDown); document.removeEventListener('keydown', onKey); if (S.stopShake) { S.stopShake(); S.stopShake = null; } };
  return api;
}

/** Horizontal swipe on the board card: right = like, left = dislike. Doesn't capture the pointer until it is a swipe, so taps reach the pieces. */
function swipeCard(el, { right, left }) {
  let sx = 0, sy = 0, id = null, active = false, swiping = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; id = e.pointerId; active = true; swiping = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!swiping) {
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiping = true; try { el.setPointerCapture(id); } catch { /* ignore */ } } else return;
    }
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px) rotate(${dx / 32}deg)`;
    el.dataset.dir = dx > 0 ? 'right' : 'left';
  });
  const end = (e) => {
    if (!active || e.pointerId !== id) return;
    active = false;
    if (!swiping) return;
    const dx = e.clientX - sx;
    el.style.transition = ''; el.style.transform = ''; delete el.dataset.dir;
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 80);
    if (dx > 90) right(); else if (dx < -90) left();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
