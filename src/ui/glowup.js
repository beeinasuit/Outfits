// Outfit glow-up ("Improve this look"): finds the single best swap across every slot and shows it before/after.
//
//   openGlowUp(outfitItems, ctx, onApply) -> { close }
//     outfitItems  Object<slot, Item>
//     ctx          engine context (data.getContext())
//     onApply      ({ items, score, reasons, delta, slot, item, via:'glowup' }) => void   when "Apply" is pressed
//   findGlowUp(outfitItems, ctx) -> best row ({ slot, item, items, score, delta, reasons }) | null   (pure-ish helper)
//
// Loops rankForSlot over every slot present plus the addable optional slots and takes the biggest positive delta.
// Below +3 it shows the cheerful "Already peak" state instead.
import { SLOT_LABELS } from '../model.js';
import { rankForSlot } from '../engine/build.js';
import { scoreOutfit } from '../engine/score.js';
import { h } from './dom.js';
import { sheet } from './overlay.js';
import { renderBoard } from './board.js';
import { mascot } from './illustrations.js';
import { data } from './data.js';
import { buzz, confetti, reduced, verdict } from './fx.js';
import { announce } from './overlay.js';

export const GLOWUP_MIN = 3;

export function findGlowUp(outfitItems, ctx) {
  const slots = ['top', 'bottom', 'shoes', 'layer', 'neckwear', 'headwear', 'belt'].filter((s) => {
    if (outfitItems[s]) return true;
    if (s === 'neckwear') return !!(outfitItems.top && outfitItems.top.collared);
    if (s === 'belt') return !!(outfitItems.bottom && outfitItems.bottom.beltLoops === true);
    return s === 'layer' || s === 'headwear';
  });
  let best = null;
  for (const slot of slots) {
    const cur = outfitItems[slot] || null;
    if (!cur && !data.items.some((i) => i.slot === slot && i.available)) continue;
    for (const r of rankForSlot(data.items, outfitItems, slot, ctx)) {
      if ((r.item ? r.item.id : null) === (cur ? cur.id : null)) continue;
      if (!best || r.delta > best.delta) best = { ...r, slot };
    }
  }
  return best;
}

function describe(best, outfitItems) {
  const label = (SLOT_LABELS[best.slot] || best.slot).toLowerCase();
  const old = outfitItems[best.slot];
  if (!best.item) return `Drop the ${old ? old.name.toLowerCase() : label}`;
  if (!old) return `Add ${best.item.name.toLowerCase()}`;
  return `Swap ${old.name.toLowerCase()} for ${best.item.name.toLowerCase()}`;
}

/** What the swap itself changes: reasons gained/lost (diffed against the "before" reasons) plus belt-rule side effects. */
function changeNotes(best, outfitItems, beforeReasons) {
  const had = new Map((beforeReasons || []).map((r) => [r.text, r]));
  const now = new Map((best.reasons || []).map((r) => [r.text, r]));
  const notes = [];
  const oldBelt = outfitItems.belt, newBelt = best.items.belt;
  if (best.slot === 'bottom' && best.item) {
    if (!oldBelt && newBelt) notes.push({ text: `${best.item.name} has belt loops, so your ${newBelt.name.toLowerCase()} joins in`, delta: 0 });
    else if (oldBelt && !newBelt) notes.push({ text: `${best.item.name} has no belt loops, so the belt comes off`, delta: 0 });
    else if (oldBelt && newBelt && oldBelt.id !== newBelt.id) notes.push({ text: `The belt switches to ${newBelt.name.toLowerCase()}`, delta: 0 });
  }
  const gained = [...now.values()].filter((r) => !had.has(r.text) && r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2);
  const lost = [...had.values()].filter((r) => !now.has(r.text) && r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 1);
  for (const r of gained) notes.push({ text: r.text.replace(/[.!]$/, ''), delta: Math.round(r.delta) });
  for (const r of lost) notes.push({ text: `Fixes: ${r.text.replace(/[.!]$/, '')}`, delta: Math.round(-r.delta) });
  if (!gained.length && !lost.length) {
    const top = [...now.values()].filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    if (top) notes.push({ text: top.text.replace(/[.!]$/, ''), delta: Math.round(top.delta) });
  }
  return notes;
}

export function openGlowUp(outfitItems, ctx, onApply) {
  const best = findGlowUp(outfitItems, ctx);
  let s;
  if (!best || best.delta < GLOWUP_MIN) {
    const gain = best && best.delta > 0 ? ` The best swap I could find would add only ${best.delta}.` : '';
    s = sheet({
      title: 'Improve this look',
      content: h('div', { class: 'gu-peak' },
        h('div', { class: 'gu-mascot', html: mascot('wink', { size: 110 }) }),
        h('h3', {}, 'Already peak. Nothing to improve!'),
        h('p', {}, `This one is dialled in.${gain} Go wear it with confidence.`),
        h('button', { class: 'btn btn-mint', type: 'button', onclick: () => s.close() }, 'Love that for me')),
    });
    buzz([20, 30, 20]);
    announce('Already peak. Nothing to improve.');
    return s;
  }

  // before / after boards in one frame with a draggable divider
  const after = { ...best.items };
  const before = renderBoard(outfitItems, { size: 'card', interactive: false, profile: ctx.profile, animate: false });
  const afterB = renderBoard(after, { size: 'card', interactive: false, profile: ctx.profile, animate: false });
  before.classList.add('gu-before'); afterB.classList.add('gu-after');
  const tagB = h('span', { class: 'gu-tag gu-tag-b' }, 'BEFORE');
  const tagA = h('span', { class: 'gu-tag gu-tag-a' }, 'AFTER');
  const line = h('span', { class: 'gu-line', 'aria-hidden': 'true' }, h('span', { class: 'gu-knob' }, '↔'));
  const frame = h('div', { class: 'gu-compare', role: 'slider', tabindex: '0', 'aria-label': 'Before and after. Drag, or use the left and right arrow keys', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50', 'aria-valuetext': 'Showing half before, half after' },
    h('div', { class: 'gu-layer gu-base' }, afterB), h('div', { class: 'gu-layer gu-top' }, before), tagB, tagA, line);
  let pos = 50;
  const setPos = (p) => {
    pos = Math.max(0, Math.min(100, p));
    frame.style.setProperty('--pos', `${pos}%`);
    frame.setAttribute('aria-valuenow', String(Math.round(pos)));
    frame.setAttribute('aria-valuetext', pos < 8 ? 'Showing the after look' : pos > 92 ? 'Showing the before look' : `${Math.round(pos)} percent before`);
  };
  setPos(50);
  let dragging = false;
  const fromEvent = (e) => { const r = frame.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
  frame.addEventListener('pointerdown', (e) => { dragging = true; try { frame.setPointerCapture(e.pointerId); } catch { /* ignore */ } fromEvent(e); });
  frame.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const stop = () => { dragging = false; };
  frame.addEventListener('pointerup', stop); frame.addEventListener('pointercancel', stop);
  frame.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft') { setPos(pos - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setPos(pos + step); e.preventDefault(); }
    else if (e.key === 'Home') { setPos(0); e.preventDefault(); }
    else if (e.key === 'End') { setPos(100); e.preventDefault(); }
  });
  // a little reveal wiggle so people notice it is draggable
  if (!reduced()) {
    setPos(92);
    setTimeout(() => { if (frame.isConnected && !dragging) { frame.classList.add('easing'); setPos(50); setTimeout(() => frame.classList.remove('easing'), 700); } }, 250);
  }

  const beforeScore = best.score - best.delta;
  const v = verdict(best.score);
  const content = h('div', { class: 'gu' },
    h('p', { class: 'gu-headline' }, describe(best, outfitItems)),
    frame,
    h('div', { class: 'gu-why' },
      h('span', { class: 'gu-scores', 'aria-label': `Score goes from ${beforeScore} to ${best.score}` }, h('s', {}, String(beforeScore)), h('span', { 'aria-hidden': 'true' }, '→'), h('b', {}, String(best.score)), h('em', {}, `+${best.delta}`)),
      h('ul', { class: 'gu-notes' }, changeNotes(best, outfitItems, scoreOutfit(outfitItems, ctx).reasons).map((n) => h('li', {}, n.delta ? h('b', {}, `+${n.delta}`) : null, n.delta ? ' ' : '', n.text)))),
    h('div', { class: 'gu-actions' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => s.close() }, 'Keep mine'),
      h('button', { class: 'btn btn-mint', type: 'button', 'data-act': 'apply', onclick: () => {
        const b = frame.getBoundingClientRect();
        s.close();
        if (v.confetti) confetti(b.left + b.width / 2, b.top + b.height / 3, 30);
        onApply({ items: best.items, score: best.score, reasons: best.reasons, delta: best.delta, slot: best.slot, item: best.item, via: 'glowup' });
      } }, 'Apply it')));
  s = sheet({ title: 'Glow-up found!', content });
  announce(`Glow-up: ${describe(best, outfitItems)}, plus ${best.delta} points.`);
  buzz([14, 30, 14]);
  return s;
}
