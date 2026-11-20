// LOOKBOOK screen: best outfits for an occasion + weather, liked outfits, wardrobe gaps.
import { SLOTS, SLOT_LABELS, WEATHER, COLOR_FAMILIES, todayISO, makeProfile } from '../model.js';
import { buildOutfits, gapAnalysis } from '../engine/build.js';
import { scoreOutfit } from '../engine/score.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot, illustrate } from './illustrations.js';
import { itemArt } from './itemart.js';
import { buzz, verdict, confetti } from './fx.js';
import { toast, sheet } from './overlay.js';
import { loadA, boardNode } from './lazyboard.js';
import { data, getContext, setSetting, setFeedback, logWorn, wornToday, loadDemo } from './data.js';

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
    return (COLOR_FAMILIES[g.family] || COLOR_FAMILIES.grey).hex;
  }

  render();
  return { update(what) { if (what === 'items' || what === 'settings') render(); }, destroy() { alive = false; token++; } };
}
