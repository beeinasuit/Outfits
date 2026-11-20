// Item visual: photo thumbnail when available, otherwise a generated flat illustration.
import { h } from './dom.js';
import { illustrate } from './illustrations.js';
import { getPhotoURL } from '../store.js';

export function itemArt(item, { cls = '', title = true } = {}) {
  const label = title ? `${item.name}` : '';
  const el = h('span', { class: `art ${cls}`, html: illustrate(item, { title: label }) });
  if (item.photoId) {
    getPhotoURL(item.photoId).then((url) => {
      if (!url) return;
      const img = h('img', { src: url, alt: label, decoding: 'async', draggable: 'false' });
      img.addEventListener('load', () => { el.classList.add('has-photo'); el.replaceChildren(img); });
    }).catch(() => {});
  }
  if (item.available === false) el.classList.add('is-wash');
  return el;
}
