// PLAN THE WEEK: seven day cards, each with an occasion and a built outfit. Saved in settings.plan:
// { 'YYYY-MM-DD': { occasion, slots: { slot: itemId } } }. Past days drop away automatically.
import { SLOTS, SLOT_LABELS, todayISO, makeProfile, wearsSinceWash } from '../model.js';
import { buildOutfits } from '../engine/build.js';
import { scoreOutfit } from '../engine/score.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { buzz, verdict, confetti } from './fx.js';
import { toast } from './overlay.js';
import { loadA, boardNode } from './lazyboard.js';
import { data, getContext, setSetting, allOccasions, loadDemo } from './data.js';

const SHOWN = SLOTS.filter((s) => s !== 'extra');
const DAYS = 7;

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return todayISO(d); };
export const weekDates = (from = todayISO()) => Array.from({ length: DAYS }, (_, i) => addDays(from, i));

function dayLabel(iso, i) {
  const d = parse(iso);
  const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' });
  return { name, date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
}

/** Drop days before today and anything malformed. */
export function cleanPlan(plan, today = todayISO()) {
  const out = {};
  if (plan && typeof plan === 'object') {
    for (const [k, v] of Object.entries(plan)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k < today || !v || typeof v !== 'object') continue;
      const slots = {};
      if (v.slots && typeof v.slots === 'object') for (const [s, id] of Object.entries(v.slots)) if (SLOTS.includes(s) && typeof id === 'string') slots[s] = id;
      out[k] = { occasion: typeof v.occasion === 'string' ? v.occasion : 'any', slots };
    }
  }
  return out;
}

/**
 * Build the outfit for one day. Planned tops/bottoms on other days are excluded (relaxing step by step if the closet is too
 * small), and items that earlier planned days would push into the hamper are unavailable.
 * @returns {{outfit: object|null, repeated: boolean}}
 */
export function buildDay(date, plan, ctx) {
  const occs = allOccasions();
  const occasion = plan[date]?.occasion && occs[plan[date].occasion] ? plan[date].occasion : (ctx.occasion || 'any');
  const base = { ...ctx, occasion, occasionDef: occs[occasion], limit: 8, today: date };
  const counts = {}, earlier = {};
  const otherTops = new Set(), otherBottoms = new Set();
  for (const [d, p] of Object.entries(plan)) {
    if (d === date) continue;
    const ids = Object.values(p.slots || {});
    if (d < date) for (const id of ids) { counts[id] = (counts[id] || 0) + 1; (earlier[id] = earlier[id] || []).push(d); }
    if (p.slots?.top) otherTops.add(p.slots.top);
    if (p.slots?.bottom) otherBottoms.add(p.slots.bottom);
  }
  const auto = data.settings.autoHamper !== false;
  const items = data.items.map((it) => {
    const c = counts[it.id] || 0;
    if (!c) return it;
    const limit = it.wearsBeforeWash || 0;
    const hampered = auto && limit > 0 && wearsSinceWash(it) + c >= limit;
    return { ...it, available: hampered ? false : it.available, worn: [...it.worn, ...earlier[it.id]] };
  });
  const T = [...otherTops], B = [...otherBottoms];
  const tiers = [{ top: T, bottom: B }, { top: T }, { bottom: B }, {}];
  for (let i = 0; i < tiers.length; i++) {
    let outfits = [];
    try { outfits = buildOutfits(items, { ...base, exclude: tiers[i] }); } catch (e) { console.warn(e); }
    if (outfits.length) return { outfit: outfits[0], repeated: i > 0, occasion };
  }
  return { outfit: null, repeated: false, occasion };
}

export function mount(root, { navigate }) {
  let alive = true, token = 0, saving = false, busy = false;
  let plan = cleanPlan(data.settings.plan);
  let A = null, ctx = null;

  const persist = async () => { saving = true; try { await setSetting({ plan }); } finally { saving = false; } };

  function resolve(entry) {
    if (!entry || !entry.slots) return null;
    const items = {};
    for (const [s, id] of Object.entries(entry.slots)) { const it = data.items.find((x) => x.id === id); if (it) items[s] = it; }
    return items.top && items.bottom ? items : null;
  }

  function setOutfit(date, occasion, outfit) {
    const slots = {};
    for (const [s, it] of Object.entries(outfit.items)) if (it) slots[s] = it.id;
    plan[date] = { occasion, slots };
  }

  async function fill(date, { quiet = false } = {}) {
    const { outfit, repeated, occasion } = buildDay(date, plan, ctx);
    if (!outfit) { if (!quiet) toast('Couldn’t build an outfit for that day. Try another occasion or add more pieces.', { tone: 'warn' }); return { ok: false, repeated: false }; }
    setOutfit(date, occasion, outfit);
    return { ok: true, repeated };
  }

  async function fillOne(date) {
    if (busy) return;
    busy = true;
    const r = await fill(date);
    if (r.ok) { await persist(); buzz(12); if (r.repeated) toast('Your closet is small, so this day reuses a top or bottom.'); }
    busy = false; render();
  }

  async function fillAll() {
    if (busy) return;
    busy = true;
    const dates = weekDates();
    const old = plan;
    plan = {};
    for (const d of dates) plan[d] = { occasion: old[d]?.occasion || ctx.occasion || 'any', slots: {} };
    let ok = 0, reuse = 0;
    for (const d of dates) {
      const r = await fill(d, { quiet: true });
      if (r.ok) { ok++; if (r.repeated) reuse++; } else delete plan[d].slots.top;
    }
    for (const d of dates) if (!Object.keys(plan[d].slots).length) plan[d] = { occasion: plan[d].occasion, slots: {} };
    await persist();
    busy = false;
    buzz([15, 30, 15]);
    if (ok) { confetti(window.innerWidth / 2, window.innerHeight * 0.3, 28); toast(`${ok} day${ok === 1 ? '' : 's'} planned${reuse ? `. ${reuse} reuse${reuse === 1 ? 's' : ''} a piece, the closet is small.` : ', no repeated tops.'}`, { ms: 5200 }); }
    else toast('Nothing could be planned. Add a top and a bottom first.', { tone: 'warn' });
    render();
  }

  async function clearDay(date) { delete plan[date]; await persist(); buzz(8); render(); }
  async function clearWeek() { plan = {}; await persist(); buzz(8); toast('Week cleared.'); render(); }

  async function setOccasion(date, occasion) {
    const had = resolve(plan[date]);
    plan[date] = { occasion, slots: had ? plan[date].slots : {} };
    if (had) { busy = true; const r = await fill(date, { quiet: true }); busy = false; if (!r.ok) toast('That occasion has no matching outfit in your closet.', { tone: 'warn' }); }
    await persist();
    render();
  }

  function dayCard(date, i) {
    const lab = dayLabel(date, i);
    const entry = plan[date];
    const items = resolve(entry);
    const occasion = (entry && entry.occasion) || ctx.occasion || 'any';
    let score = null;
    if (items) { try { score = scoreOutfit(items, { ...ctx, occasion, occasionDef: allOccasions()[occasion] }); } catch { score = null; } }
    const v = score ? verdict(score.score) : null;
    const names = items ? SHOWN.map((s) => items[s]).filter(Boolean).map((it) => it.name).join(', ') : '';
    const stale = entry && Object.keys(entry.slots || {}).length && !items;
    return h('article', { class: `plan-day${items ? ' filled' : ''}${i === 0 ? ' today' : ''}`, 'data-date': date, 'aria-label': `${lab.name}, ${lab.date}` },
      h('header', { class: 'plan-head' },
        h('div', {}, h('h2', { class: 'plan-name' }, lab.name), h('small', { class: 'plan-date' }, lab.date)),
        v ? h('span', { class: `plan-score tone-${v.tone}`, 'aria-label': `Score ${score.score}, ${v.short}` }, h('b', {}, String(score.score)), h('small', {}, v.short)) : null),
      A.occasionPicker({ value: occasion, onChange: (k) => setOccasion(date, k) }),
      items
        ? h('div', { class: 'plan-body' },
          h('div', { class: 'plan-board' }, boardNode(A.renderBoard, items, { size: 'mini', interactive: false, profile: ctx.profile })),
          h('p', { class: 'plan-names' }, names))
        : h('div', { class: 'plan-empty' }, stale ? 'Some planned pieces are gone. Re-fill this day.' : 'Nothing planned yet'),
      h('div', { class: 'plan-actions' },
        h('button', { class: 'btn btn-small btn-cobalt plan-fill', type: 'button', disabled: busy, onclick: () => fillOne(date), html: `${icon('sparkle', { size: 16 })} ${items ? 'Re-fill' : 'Fill'}` }),
        entry && (items || stale) ? h('button', { class: 'btn btn-small btn-ghost plan-clear', type: 'button', onclick: () => clearDay(date) }, 'Clear') : null));
  }

  async function render() {
    const my = ++token;
    plan = cleanPlan(plan);
    clear(root);
    root.append(h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Plan the week'));
    const hasBase = data.items.some((i) => i.slot === 'top') && data.items.some((i) => i.slot === 'bottom');
    if (!hasBase) {
      root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art', html: mascot('wink', { size: 150 }) }),
        h('h2', {}, 'Nothing to plan with yet'), h('p', {}, 'Add at least one top and one bottom and I’ll lay out the week.'),
        h('div', { class: 'row gap center wrap' }, h('button', { class: 'btn btn-tomato', type: 'button', onclick: () => navigate('snap') }, 'Add clothes'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Try a sample closet'))));
      return;
    }
    [A, ctx] = await Promise.all([loadA(), getContext()]);
    if (my !== token || !alive) return;
    const dates = weekDates();
    const planned = dates.filter((d) => resolve(plan[d])).length;
    root.append(
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Plan the week'), h('a', { class: 'page-sub link', href: '#/looks' }, 'Back to Lookbook')),
      h('div', { class: 'plan-top' },
        h('button', { class: 'btn btn-tomato plan-all', type: 'button', disabled: busy, onclick: fillAll, html: `${icon('sparkle', { size: 20 })} Plan whole week` }),
        planned ? h('button', { class: 'btn btn-ghost plan-clear-all', type: 'button', onclick: clearWeek }, 'Clear week') : null),
      h('p', { class: 'hint' }, 'Each day gets its own occasion. Planned tops and bottoms aren’t reused, and anything that would hit the hamper by then is skipped.'),
      h('div', { class: 'plan-list' }, dates.map((d, i) => dayCard(d, i))));
  }

  // keep persisted cleanup (past days dropped) in step with storage
  const before = JSON.stringify(data.settings.plan || {});
  if (before !== JSON.stringify(plan) && Object.keys(data.settings.plan || {}).length) persist();
  render();
  return {
    update(what) {
      if (what === 'items' || (what === 'settings' && !saving)) { plan = cleanPlan(data.settings.plan); render(); }
    },
    destroy() { alive = false; token++; },
  };
}
