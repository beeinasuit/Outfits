// Fit check screen: photo of what you're wearing -> matched to closet -> scored. Stub until built.
import { h } from './dom.js';
export function mount(root) {
  root.append(h('div', { class: 'empty' }, h('h2', { id: 'screen-title', tabindex: '-1' }, 'Rate my fit'), h('p', {}, 'Coming soon.')));
  return {};
}
