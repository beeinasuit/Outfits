// First-run onboarding: 4 skippable playful screens (board, snap, laundry, optional colours) + sample closet shortcut.
import { h, clear } from './dom.js';
import { mascot, illustrate } from './illustrations.js';
import { buzz } from './fx.js';

const floaty = (item, style) => h('span', { class: 'float', style, html: illustrate(item) });

const SLIDES = [
  { mood: 'happy', title: 'Meet the Fit Machine', text: 'It lays your real clothes out on an outfit board and picks looks that actually go together, so you don’t have to stand there in a towel.',
    art: () => [floaty({ slot: 'top', kind: 't-shirt', colors: [{ hex: '#2f4bff' }] }, 'left:-6px;top:6px;animation-delay:-.4s'), floaty({ slot: 'shoes', kind: 'sneakers', colors: [{ hex: '#f5f5f2' }] }, 'right:-8px;bottom:8px;animation-delay:-1.2s')] },
  { mood: 'wink', title: 'Snap a pile, skip the typing', text: 'Photograph clothes laid out flat with a little gap between them. I’ll cut each piece out, read the colours and ask you to confirm. Or add things by colour in seconds.',
    art: () => [floaty({ slot: 'bottom', kind: 'jeans', colors: [{ hex: '#4a6286' }] }, 'right:-6px;top:4px;animation-delay:-.8s'), floaty({ slot: 'belt', kind: 'leather belt', colors: [{ hex: '#6b4a2f' }] }, 'left:-10px;bottom:10px;animation-delay:-1.6s')] },
  { mood: 'wow', title: 'Shuffle, swap, wash', text: 'Shuffle for a new look, swap any single piece, and let worn clothes hop into the hamper. One tap on Laundry Day and everything is fresh again.',
    art: () => [floaty({ slot: 'layer', kind: 'blazer', colors: [{ hex: '#1f2a44' }] }, 'left:-6px;top:0;animation-delay:-.2s'), floaty({ slot: 'headwear', kind: 'beanie', colors: [{ hex: '#ff5a3c' }] }, 'right:-4px;top:14px;animation-delay:-1.4s')] },
  { mood: 'happy', title: 'Colours that suit you', text: 'Optional: a selfie and a six-round drape test teach the machine which colours flatter your skin. The selfie never leaves your phone.', colours: true,
    art: () => [floaty({ slot: 'top', kind: 'sweater', colors: [{ hex: '#a4502a' }] }, 'left:-8px;top:8px;animation-delay:-.6s'), floaty({ slot: 'neckwear', kind: 'scarf', colors: [{ hex: '#6d1f2f' }] }, 'right:-4px;bottom:10px;animation-delay:-1.1s')] },
];

export function showOnboarding({ onDone, onSample }) {
  let i = 0;
  const el = h('div', { class: 'onboard', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Fit Machine' });
  document.body.append(el);
  document.documentElement.classList.add('lock-scroll');
  const finish = (sample, colours) => { el.remove(); document.documentElement.classList.remove('lock-scroll'); onDone(); if (sample) onSample(); if (colours) location.hash = '#/profile'; };
  function render() {
    const s = SLIDES[i];
    const last = i === SLIDES.length - 1;
    clear(el);
    el.append(
      h('div', { class: 'onboard-top' }, h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => finish(false) }, 'Skip')),
      h('div', { class: 'onboard-slide', key: i },
        h('div', { class: 'onboard-art' }, h('span', { html: mascot(s.mood, { size: 170 }) }), ...s.art()),
        h('h1', {}, s.title), h('p', {}, s.text)),
      h('div', { class: 'onboard-foot' },
        h('div', { class: 'dots', 'aria-hidden': 'true' }, SLIDES.map((_, k) => h('span', { class: 'dot-btn', 'aria-selected': String(k === i), style: { pointerEvents: 'none' } }))),
        last ? h('button', { class: 'btn btn-big btn-tomato', type: 'button', onclick: () => finish(false) }, 'Let’s go')
          : h('button', { class: 'btn btn-big btn-tomato', type: 'button', onclick: () => { i++; buzz(8); render(); } }, 'Next'),
        s.colours ? h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => finish(false, true) }, 'Find my colours now') : null,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => finish(true) }, 'Try with a sample closet')));
    const primary = el.querySelector('.btn-big'); primary && primary.focus({ preventScroll: true });
  }
  render();
}
