// LOOKBOOK screen: best outfits for an occasion + weather, liked outfits, wardrobe gaps.
import { SLOTS, SLOT_LABELS, WEATHER, COLOR_FAMILIES, todayISO, makeProfile } from '../model.js';
import { buildOutfits, gapAnalysis } from '../engine/build.js';
import { scoreOutfit } from '../engine/score.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot, illustrate } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz, verdict, confetti } from './fx.js';
import { toast, sheet, confirmDialog } from './overlay.js';
import { getPhotoURL, getPhotoBlob } from '../store.js';
import { loadA, boardNode } from './lazyboard.js';
import { data, getContext, setSetting, setFeedback, logWorn, wornToday, loadDemo, checkItems, removeCheck, saveCheck, allOccasions } from './data.js';

const SHOWN = SLOTS.filter((s) => s !== 'extra');

export function mount(root, { navigate }) {
  let alive = true;
  let token = 0;
  let A = null; // { renderBoard, occasionPicker }
  let profile = null;

  function mini(outfit) {
    return boardNode(A.renderBoard, outfit.items, { size: 'card', interactive: false, profile });
  }

  function card(outfit, i) {
    const v = verdict(outfit.score);
    const top = (outfit.reasons || []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const names = SHOWN.map((s) => outfit.items[s]?.name).filter(Boolean).join(', ');
    return h('button', { class: `look-card tone-${v.tone}`, type: 'button', style: { '--i': i }, 'aria-label': `Outfit: ${names}. Score ${outfit.score}, ${v.short}. Open details.`, onclick: () => detail(outfit) },
      h('span', { class: 'look-score' }, h('b', {}, String(outfit.score)), h('small', {}, v.short)),
      mini(outfit),
      h('span', { class: 'look-names' }, names),
      top ? h('span', { class: `look-why ${top.delta >= 0 ? 'pos' : 'neg'}` }, h('span', { html: icon(top.delta >= 0 ? 'check' : 'alert', { size: 14, sw: 3 }) }), top.text) : null,
      data.feedback[outfit.key] === 'like' ? h('span', { class: 'look-heart', 'aria-label': 'Liked', html: icon('heart', { size: 16 }) }) : null);
  }

  function detail(outfit) {
    const v = verdict(outfit.score);
    const list = h('ul', { class: 'detail-list' }, SHOWN.filter((s) => outfit.items[s]).map((s) => {
      const it = outfit.items[s];
      return h('li', {}, itemArt(it, { cls: 'tile', title: false }), h('span', {}, h('small', {}, SLOT_LABELS[s]), h('b', {}, it.name)));
    }));
    const stickers = h('div', { class: 'stickers static' }, (outfit.reasons || []).slice(0, 8).map((r, i) => {
      const pos = r.delta > 0, neg = r.delta < 0;
      return h('span', { class: `sticker ${pos ? 'pos' : neg ? 'neg' : 'neu'}`, style: { '--rot': `${((i * 37) % 9) - 4}deg`, '--d': '0ms' } },
        h('span', { class: 'sticker-ico', html: icon(pos ? 'check' : neg ? 'alert' : 'info', { size: 15, sw: 3 }) }), h('span', { class: 'sticker-text' }, r.text));
    }));
    const like = h('button', { class: 'round-btn up', type: 'button', 'aria-label': 'Love it', html: icon('up', { size: 24 }), 'aria-pressed': String(data.feedback[outfit.key] === 'like') });
    const dis = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Not for me', html: icon('down', { size: 24 }), 'aria-pressed': String(data.feedback[outfit.key] === 'dislike') });
    const wear = h('button', { class: 'btn btn-mint', type: 'button' }, wornToday(outfit) ? 'Worn today' : 'Wearing it!');
    const content = h('div', { class: 'detail' },
      h('div', { class: 'detail-board' }, boardNode(A.renderBoard, outfit.items, { size: 'full', interactive: false, profile })),
      h('div', { class: 'detail-head' }, h('div', { class: 'stamp show instant static tone-' + v.tone }, v.label), h('span', { class: 'detail-score' }, h('b', {}, String(outfit.score)), '/100')),
      list, stickers,
      h('div', { class: 'row gap between' }, dis, wear, like));
    const s = sheet({ title: 'Outfit', content });
    const fb = async (val) => { const cur = data.feedback[outfit.key]; await setFeedback(outfit, cur === val ? null : val); like.setAttribute('aria-pressed', String(data.feedback[outfit.key] === 'like')); dis.setAttribute('aria-pressed', String(data.feedback[outfit.key] === 'dislike')); buzz(10); toast(data.feedback[outfit.key] ? (val === 'like' ? 'Saved to your liked looks.' : 'Noted. Less of that.') : 'Feedback cleared.'); };
    like.addEventListener('click', () => fb('like'));
    dis.addEventListener('click', () => fb('dislike'));
    wear.addEventListener('click', async () => { if (wornToday(outfit)) return; await logWorn(outfit); wear.textContent = 'Worn today'; const b = wear.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top, 26); buzz([20, 30, 30]); toast('Logged! Go be fabulous.'); });
  }

  // ---------- fit-check diary ----------
  let diaryEl = null;
  const MOODS = { love: ['😍', 'Loved it'], ok: ['🙂', 'Fine'], meh: ['😕', 'Meh'] };
  const dayLabel = (iso) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

  function diaryCard(c) {
    const v = verdict(c.score ?? 0);
    const photo = h('span', { class: 'ck-diary-ph', 'aria-hidden': 'true' }, '📸');
    const card = h('button', { class: 'ck-diary-card', type: 'button', 'data-check': c.id, 'aria-label': `Fit check from ${dayLabel(c.date)}, score ${c.score ?? 'unknown'}. Open details.`, onclick: () => checkDetail(c.id) },
      photo, c.score != null ? h('span', { class: `ck-diary-score tone-${v.tone}` }, String(c.score)) : null,
      c.mood ? h('span', { class: 'ck-diary-mood', 'aria-hidden': 'true' }, MOODS[c.mood][0]) : null,
      h('span', { class: 'ck-diary-date' }, dayLabel(c.date)));
    if (c.photoId) getPhotoURL(c.photoId).then((url) => { if (!url) return; const img = h('img', { class: 'ck-diary-photo', src: url, alt: '', decoding: 'async', draggable: 'false' }); img.addEventListener('load', () => photo.replaceWith(img)); }).catch(() => {});
    return card;
  }

  function paintDiary(wrap) {
    const list = data.checks || [];
    wrap.replaceChildren(
      h('div', { class: 'ck-diary-head' }, h('h2', { class: 'sec-title' }, h('span', { 'aria-hidden': 'true' }, '📸'), 'Fit checks'),
        list.length ? h('a', { class: 'btn btn-small btn-ghost', href: '#/check', 'data-goto': 'check' }, '+ New') : null),
      list.length ? h('div', { class: 'ck-strip' }, list.slice(0, 30).map(diaryCard))
        : h('div', { class: 'ck-diary-empty' }, h('span', {}, 'Snap what you’re wearing and I’ll score it. Your diary lives here.'), h('a', { class: 'btn btn-small btn-sun', href: '#/check', 'data-goto': 'check' }, 'Rate my fit')));
  }
  function diaryNode() { const wrap = h('div', { class: 'ck-diary' }); diaryEl = wrap; paintDiary(wrap); return wrap; }

  async function checkDetail(id) {
    const c = data.checks.find((x) => x.id === id);
    if (!c) return;
    const items = checkItems(c);
    const v = verdict(c.score ?? 0);
    const photo = c.photoId ? h('img', { class: 'ck-detail-photo', alt: `Your fit check from ${dayLabel(c.date)}`, draggable: 'false' }) : null;
    if (photo) getPhotoURL(c.photoId).then((url) => { if (url) photo.src = url; }).catch(() => {});
    const occ = allOccasions()[c.occasion];
    const why = h('div', { class: 'stickers static' });
    const list = h('ul', { class: 'detail-list' }, SLOTS.filter((s) => items[s]).map((s) => h('li', {}, itemArt(items[s], { cls: 'tile', title: false }),
      h('span', {}, h('small', {}, SLOT_LABELS[s]), h('b', {}, items[s].name), data.items.some((x) => x.id === items[s].id) ? null : h('small', {}, 'Not in closet')))));
    const del = h('button', { class: 'btn btn-danger-ghost', type: 'button', 'data-act': 'delete-check' }, h('span', { html: icon('trash', { size: 18 }) }), 'Delete');
    const content = h('div', { class: 'detail ck-detail' },
      photo,
      h('div', { class: 'detail-head' }, c.score != null ? h('div', { class: 'stamp show instant static tone-' + v.tone }, v.label) : null, c.score != null ? h('span', { class: 'detail-score' }, h('b', {}, String(c.score)), '/100') : null),
      h('div', { class: 'ck-detail-meta' }, h('span', {}, dayLabel(c.date)), occ ? h('span', {}, `${occ.emoji} ${occ.label}`) : null, c.mood ? h('span', {}, `${MOODS[c.mood][0]} ${MOODS[c.mood][1]}`) : null),
      c.note ? h('p', { class: 'ck-detail-note' }, c.note) : null,
      c.roast ? h('p', { class: 'ck-detail-roast' }, '🔥 ', c.roast) : null,
      list, why,
      h('div', { class: 'row end' }, del));
    const sh = sheet({ title: 'Fit check', content });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete this fit check?', body: 'The photo and score go away. The pieces stay in your closet. You can undo right after.', confirmText: 'Delete', danger: true, mood: 'sleepy' });
      if (!ok) return;
      sh.close();
      const blob = c.photoId ? await getPhotoBlob(c.photoId) : null;
      await removeCheck(c.id);
      toast('Fit check deleted.', { action: 'Undo', ms: 7000, onAction: async () => { await saveCheck(c, blob); toast('Brought it back.'); } });
    });
    try {
      if (items.top && items.bottom) {
        const base = await getContext();
        const { score, reasons } = scoreOutfit(items, { ...base, occasion: allOccasions()[c.occasion] ? c.occasion : 'any', occasionDef: allOccasions()[c.occasion], maxReasons: 8 });
        void score;
        for (const [i, r] of reasons.slice(0, 6).entries()) {
          const pos = r.delta > 0, neg = r.delta < 0;
          why.append(h('span', { class: `sticker ${pos ? 'pos' : neg ? 'neg' : 'neu'}`, style: { '--rot': `${((i * 37) % 9) - 4}deg`, '--d': '0ms' } }, h('span', { class: 'sticker-ico', html: icon(pos ? 'check' : neg ? 'alert' : 'info', { size: 15, sw: 3 }) }), h('span', { class: 'sticker-text' }, r.text)));
        }
      }
    } catch (e) { console.warn(e); }
  }

  async function render() {
    const my = ++token;
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Lookbook'));
    const hasBase = data.items.some((i) => i.available && i.slot === 'top') && data.items.some((i) => i.available && i.slot === 'bottom');
    if (!hasBase) {
      root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art', html: mascot('wink', { size: 150 }) }),
        h('h2', {}, 'No looks to book yet'), h('p', {}, 'Once the closet has a top and a bottom, the best combinations land here, scored and stickered.'),
        h('div', { class: 'row gap center wrap' }, h('button', { class: 'btn btn-tomato', type: 'button', onclick: () => navigate('snap') }, 'Add clothes'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Try a sample closet'))));
      root.append(diaryNode());
      return;
    }
    A = await loadA();
    if (my !== token || !alive) return;
    const occ = data.settings.occasion || 'any';
    profile = makeProfile(data.settings.profile || {}); if (!profile.enabled && !profile.cutoutId) profile = null;
    const wx = data.settings.weather || 'none';
    const chip = (label, on, fn, ico) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: () => { buzz(5); fn(); } }, ico ? h('span', { html: icon(ico, { size: 15 }) }) : null, label);
    const note = h('span', { class: 'ctx-note', 'aria-live': 'polite' });
    root.append(h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'The Lookbook'), h('span', { class: 'page-sub' }, 'Your best combinations')));
    root.append(h('div', { class: 'look-entries' },
      h('a', { class: 'entry-card battle', href: '#/battle', 'data-goto': 'battle' }, h('span', { class: 'entry-emoji', 'aria-hidden': 'true' }, '🥊'), h('span', {}, h('b', {}, 'Outfit battle'), h('small', {}, 'Pick winners, teach the machine'))),
      h('a', { class: 'entry-card plan', href: '#/plan', 'data-goto': 'plan' }, h('span', { class: 'entry-emoji', 'aria-hidden': 'true' }, '🗓️'), h('span', {}, h('b', {}, 'Plan the week'), h('small', {}, 'Seven days, no repeats')))));
    root.append(diaryNode());
    root.append(h('fieldset', { class: 'fld' }, h('legend', {}, 'Occasion'), A.occasionPicker({ value: occ, onChange: (k) => setSetting({ occasion: k }) })));
    root.append(h('fieldset', { class: 'fld' }, h('legend', {}, 'Weather'), h('div', { class: 'chips scroll' },
      chip('Any', wx === 'none', () => setSetting({ weather: 'none' })), chip('Auto', wx === 'auto', () => setSetting({ weather: 'auto' }), 'target'),
      Object.entries(WEATHER).map(([k, w]) => chip(w.label, wx === k, () => setSetting({ weather: k })))), note));
    const grid = h('div', { class: 'look-grid' }, h('p', { class: 'hint' }, 'Mixing and matching…'));
    const liked = h('div', {}); const gaps = h('div', {});
    root.append(grid, liked, gaps);

    const ctx = await getContext();
    if (my !== token || !alive) return;
    note.textContent = ctx.note || '';
    let outfits = [];
    try { outfits = buildOutfits(data.items, { ...ctx, limit: 12, today: todayISO() }); } catch (e) { console.error(e); }
    clear(grid);
    if (!outfits.length) grid.append(h('p', { class: 'hint' }, 'Nothing fits that combo. Try another occasion or weather.'));
    outfits.forEach((o, i) => grid.append(card(o, i)));

    // liked
    const likedOutfits = [];
    for (const r of data.records) {
      if (r.kind !== 'outfit' || r.value !== 'like' || !r.slots) continue;
      const items = {}; let ok = true;
      for (const [s, id] of Object.entries(r.slots)) { const it = data.items.find((x) => x.id === id); if (!it) { ok = false; break; } items[s] = it; }
      if (!ok || !items.top || !items.bottom) continue;
      let sc = { score: 0, reasons: [] };
      try { sc = scoreOutfit(items, { ...ctx, occasion: 'any', weather: null }); } catch { /* ignore */ }
      likedOutfits.push({ items, key: r.key, score: sc.score, reasons: sc.reasons });
    }
    if (likedOutfits.length) {
      liked.append(h('section', { class: 'sec' }, h('h2', { class: 'sec-title' }, h('span', { html: icon('heart', { size: 20 }) }), 'Liked looks'), h('div', { class: 'look-grid' }, likedOutfits.map((o, i) => card(o, i)))));
    }

    // gaps
    let gp = [];
    try { gp = gapAnalysis(data.items, { ...ctx }) || []; } catch (e) { console.error(e); }
    if (gp.length) {
      gaps.append(h('section', { class: 'gap-card' }, h('h2', { class: 'sec-title' }, h('span', { html: icon('sparkle', { size: 20 }) }), 'Wardrobe gaps'),
        h('ul', {}, gp.slice(0, 3).map((g) => h('li', {},
          h('span', { class: 'art tile', html: illustrate({ slot: g.slot, kind: g.kind, colors: [{ hex: hexFor(g) }], pattern: 'solid', beltLoops: true }) }),
          h('span', {}, g.text || `A ${g.family} ${g.kind} would unlock ${g.unlocks} outfits`))))));
    }
  }

  function hexFor(g) {
    const LEATH = { black: '#1c1c1e', 'dark-brown': '#4a3322', brown: '#6b4a2f', tan: '#b98a55', burgundy: '#6d1f2f', white: '#f5f5f2' };
    if (g.leather && LEATH[g.leather]) return LEATH[g.leather];
    return (COLOR_FAMILIES[g.family] || COLOR_FAMILIES.gray).hex;
  }

  render();
  return { update(what) { if (what === 'items' || what === 'settings') render(); else if (what === 'checks' && diaryEl && diaryEl.isConnected) paintDiary(diaryEl); }, destroy() { alive = false; token++; } };
}
