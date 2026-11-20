// First-run onboarding: 3 skippable playful screens + sample closet shortcut.
import { h, clear } from './dom.js';
import { mascot, illustrate } from './illustrations.js';
import { buzz } from './fx.js';

const floaty = (item, style) => h('span', { class: 'float', style, html: illustrate(item) });

const SLIDES = [
  { mood: 'happy', title: 'Meet the Fit Machine', text: 'A slot machine for your wardrobe. It picks outfits that actually look good together, so you don’t have to stand there in a towel.',
    art: () => [floaty({ slot: 'top', kind: 't-shirt', colors: [{ hex: '#2f4bff' }] }, 'left:-6px;top:6px;animation-delay:-.4s'), floaty({ slot: 'shoes', kind: 'sneakers', colors: [{ hex: '#f5f5f2' }] }, 'right:-8px;bottom:8px;animation-delay:-1.2s')] },
  { mood: 'wink', title: 'Snap a pile, skip the typing', text: 'Photograph clothes laid out flat. I’ll box each piece, read the colours and ask you to confirm. Or add things by colour in seconds.',
    art: () => [floaty({ slot: 'bottom', kind: 'jeans', colors: [{ hex: '#4a6286' }] }, 'right:-6px;top:4px;animation-delay:-.8s'), floaty({ slot: 'belt', kind: 'leather belt', colors: [{ hex: '#6b4a2f' }] }, 'left:-10px;bottom:10px;animation-delay:-1.6s')] },
  { mood: 'wow', title: 'Pull the lever', text: 'Lock the pieces you love and spin for the rest. Everything stays on your phone. No account, no uploads.',
    art: () => [floaty({ slot: 'layer', kind: 'blazer', colors: [{ hex: '#1f2a44' }] }, 'left:-6px;top:0;animation-delay:-.2s'), floaty({ slot: 'headwear', kind: 'beanie', colors: [{ hex: '#ff5a3c' }] }, 'right:-4px;top:14px;animation-delay:-1.4s')] },
];

export function showOnboarding({ onDone, onSample }) {
  let i = 0;
  const el = h('div', { class: 'onboard', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Fit Machine' });
  document.body.append(el);
  document.documentElement.classList.add('lock-scroll');
  const finish = (sample) => { el.remove(); document.documentElement.classList.remove('lock-scroll'); onDone(); if (sample) onSample(); };
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
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => finish(true) }, 'Try with a sample closet')));
    const primary = el.querySelector('.btn-big'); primary && primary.focus({ preventScroll: true });
  }
  render();
}
