// OUTFIT BATTLE (#/battle): two outfits, "Which would you wear?". The vote is recorded as a `battle` taste event, then
// both scores and the deciding reasons are revealed. Sources rotate: two strong builds with different tops and bottoms,
// the app's best pick vs a random-but-reasonable build, and two liked looks (when >= 2 exist). A pairing never repeats
// within a session.
import { outfitKey, todayISO } from '../model.js';
import { buildOutfits } from '../engine/build.js';
import { scoreOutfit } from '../engine/score.js';
import { h, clear, shuffle } from './dom.js';
import { mascot } from './illustrations.js';
import { renderBoard } from './board.js';
import { buzz, confetti, countUp, reduced, verdict } from './fx.js';
import { announce, toast } from './overlay.js';
import { data, getContext, recordEvent, loadDemo } from './data.js';

const seen = new Set();   // pairing keys judged this session
const S = { n: 0, rot: 0 };
const pairKey = (a, b) => [a.key, b.key].sort().join('~');
const distinct = (a, b) => a.items.top.id !== b.items.top.id && a.items.bottom.id !== b.items.bottom.id;
const differs = (a, b) => a.key !== b.key && (a.items.top.id !== b.items.top.id || a.items.bottom.id !== b.items.bottom.id);
const free = (a, b) => !seen.has(pairKey(a, b));

function likedOutfits(ctx) {
  const out = [];
  for (const r of data.records || []) {
    if (r.value !== 'like' || r.kind !== 'outfit' || !r.slots) continue;
    const items = {};
    let ok = true;
    for (const [slot, id] of Object.entries(r.slots)) {
      const it = data.items.find((x) => x.id === id);
      if (!it || !it.available) { ok = false; break; }
      items[slot] = it;
    }
    if (!ok || !items.top || !items.bottom) continue;
    const res = scoreOutfit(items, ctx);
    out.push({ items, score: res.score, reasons: res.reasons, key: outfitKey(items) });
  }
  return out;
}

/** Choose the next pairing, or null when the closet can't make a fresh one. Returns { a, b, source }. */
function nextPair(ctx) {
  const base = { ...ctx, today: todayISO() };
  const pool = buildOutfits(data.items, { ...base, limit: 40 });
  const wide = buildOutfits(data.items, { ...base, limit: 60, diversity: false, recentDays: 0 });
  if (pool.length < 2 && wide.length < 2) return { empty: 'tiny' };
  const sources = {
    top() {
      const ix = shuffle(pool.slice(0, 14).map((_, i) => i));
      for (const i of ix) for (const j of shuffle(ix)) if (i < j && distinct(pool[i], pool[j]) && free(pool[i], pool[j])) return [pool[i], pool[j]];
      return null;
    },
    app() {
      if (!pool.length) return null;
      const top = pool[0];
      const reasonable = shuffle(wide.filter((o) => o.score >= Math.max(45, top.score - 35) && distinct(top, o) && free(top, o)));
      return reasonable.length ? [top, reasonable[0]] : null;
    },
    liked() {
      const likes = shuffle(likedOutfits(ctx));
      for (let i = 0; i < likes.length; i++) for (let j = i + 1; j < likes.length; j++) if (differs(likes[i], likes[j]) && free(likes[i], likes[j])) return [likes[i], likes[j]];
      return null;
    },
    any() {
      const all = shuffle(wide.slice(0, 40));
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (differs(all[i], all[j]) && free(all[i], all[j])) return [all[i], all[j]];
      return null;
    },
  };
  const hasLikes = likedOutfits(ctx).length >= 2;
  const order = hasLikes ? ['top', 'app', 'liked'] : ['top', 'app'];
  for (let k = 0; k < order.length; k++) {
    const src = order[(S.rot + k) % order.length];
    const p = sources[src]();
    if (p) { S.rot = (S.rot + k + 1) % order.length; const [a, b] = Math.random() < 0.5 ? p : [p[1], p[0]]; return { a, b, source: src }; }
  }
  const p = sources.any();
  if (p) { const [a, b] = Math.random() < 0.5 ? p : [p[1], p[0]]; return { a, b, source: 'any' }; }
  return { empty: 'done' };
}

const SOURCE_NOTE = {
  top: 'Two strong looks with different tops and bottoms.',
  app: 'My top pick against a wildcard.',
  liked: 'Two looks you already liked. Time to pick a favourite.',
  any: 'A fresh pairing.',
};

/** The 1-2 reasons that actually separate this outfit from its rival. */
function deciding(mine, other) {
  const theirs = new Set((other.reasons || []).map((r) => r.text));
  let own = (mine.reasons || []).filter((r) => !theirs.has(r.text));
  if (!own.length) own = mine.reasons || [];
  return own.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2);
}

const names = (o) => ['layer', 'top', 'bottom', 'shoes'].map((s) => o.items[s] && o.items[s].name).filter(Boolean).join(', ');

export function mount(root, { navigate }) {
  let alive = true;
  let ctx = null;
  let voted = false;
  const wrap = h('div', { class: 'battle' });
  root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Outfit battle'), wrap);

  function head() {
    const evidence = data.taste && data.taste.evidence >= 5;
    return h('div', { class: 'bt-head' },
      h('a', { class: 'btn btn-ghost btn-small', href: '#/today' }, '← Today'),
      evidence ? h('a', { class: 'chip bt-taste', href: '#/settings', title: 'See what the battles have taught the app' }, '🧠 Your taste so far') : null);
  }

  function emptyState(kind) {
    clear(wrap);
    const none = data.items.length === 0;
    wrap.append(head(), h('div', { class: 'empty' },
      h('div', { class: 'empty-art', html: mascot(kind === 'done' ? 'wink' : 'sleepy', { size: 140 }) }),
      h('h2', {}, kind === 'done' ? 'You’ve judged every pairing I could think of' : none ? 'Battles need a closet' : 'Not enough outfits to battle yet'),
      h('p', {}, kind === 'done' ? 'Add a few more pieces for fresh matchups, or replay the old ones.' : 'Add a couple more tops, bottoms or shoes so I can build two different looks to compare.'),
      h('div', { class: 'row gap center wrap' },
        kind === 'done' ? h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => { seen.clear(); next(); } }, 'Replay old matchups') : null,
        h('button', { class: 'btn btn-tomato', type: 'button', onclick: () => navigate('snap') }, 'Add clothes'),
        none ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Try a sample closet') : null)));
  }

  let loading = false;
  async function next() {
    if (!alive || loading) return;
    loading = true;
    voted = true;
    try { ctx = await getContext(); } finally { loading = false; }
    if (!alive) return;
    voted = false;
    const pair = nextPair(ctx);
    if (pair.empty) { emptyState(pair.empty); return; }
    show(pair);
  }

  function show({ a, b, source }) {
    clear(wrap);
    S.n += 1;
    const cards = [a, b].map((o, i) => {
      const side = i === 0 ? 'a' : 'b';
      const board = renderBoard(o.items, { size: 'card', interactive: false, profile: ctx.profile, animate: !reduced() });
      const reveal = h('div', { class: 'bt-reveal', 'aria-live': 'polite' });
      const card = h('button', { class: 'bt-card', type: 'button', 'data-side': side, 'aria-label': `Choose outfit ${side.toUpperCase()}: ${names(o)}`, onclick: () => vote(i) },
        h('span', { class: 'bt-label', 'aria-hidden': 'true' }, side.toUpperCase()), board, reveal);
      return { o, card, reveal, board };
    });
    const vs = h('span', { class: 'bt-vs', 'aria-hidden': 'true' }, h('span', {}, 'VS'));
    const arena = h('div', { class: 'bt-arena' }, cards[0].card, vs, cards[1].card);
    const foot = h('div', { class: 'bt-foot' }, h('p', { class: 'hint', id: 'bt-hint' }, SOURCE_NOTE[source] || ''));
    wrap.append(head(), h('div', { class: 'bt-title' }, h('span', { class: 'bt-count' }, `Battle ${S.n}`), h('h2', {}, 'Which would you wear?')), arena, foot);
    announce('New battle. Which would you wear? Outfit A or outfit B.');

    async function vote(i) {
      if (voted) return;
      voted = true;
      const win = cards[i], lose = cards[1 - i];
      seen.add(pairKey(a, b));
      buzz([20, 30, 40]);
      recordEvent({ type: 'battle', winner: win.o.items, loser: lose.o.items }).catch((e) => console.warn(e));
      for (const c of cards) c.card.disabled = true;
      win.card.dataset.result = 'win'; lose.card.dataset.result = 'lose';
      vs.classList.add('boom');
      const fill = (c, other, isWin) => {
        const v = verdict(c.o.score);
        const why = deciding(c.o, other.o);
        c.reveal.append(
          isWin ? h('span', { class: 'bt-stamp' }, 'YOUR PICK') : null,
          h('span', { class: `bt-score tone-${v.tone}` }, h('b', {}, '0'), h('small', {}, '/100')),
          h('span', { class: 'bt-verdict' }, v.short),
          h('ul', { class: 'bt-why' }, why.map((r) => h('li', { class: r.delta >= 0 ? 'pos' : 'neg' }, h('b', {}, `${r.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(r.delta))}`), ' ', r.text))));
        countUp(c.reveal.querySelector('.bt-score b'), c.o.score, 700);
      };
      setTimeout(() => {
        if (!alive) return;
        fill(win, lose, true); fill(lose, win, false);
        const r = win.card.getBoundingClientRect();
        confetti(r.left + r.width / 2, r.top + r.height / 3, 26);
        const agree = win.o.score >= lose.o.score;
        const note = win.o.score === lose.o.score ? 'A tie on paper. Your pick breaks it.' : agree ? 'The scores agree with you.' : 'Plot twist: I scored the other one higher. Your taste counts, so I’m learning from it.';
        foot.replaceChildren(h('p', { class: 'bt-note', 'aria-live': 'polite' }, note),
          h('button', { class: 'btn btn-big btn-tomato', type: 'button', 'data-act': 'next', onclick: () => next() }, 'Next battle'));
        announce(`You picked outfit ${i === 0 ? 'A' : 'B'}, score ${win.o.score} against ${lose.o.score}. ${note}`);
        foot.querySelector('button').focus({ preventScroll: true });
      }, reduced() ? 0 : 520);
    }
  }

  next();
  const api = () => { alive = false; };
  api.destroy = () => { alive = false; };
  api.update = (what) => { if (what === 'taste' && !voted) { /* chip refresh is cosmetic */ } };
  return api;
}
