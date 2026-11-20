// A realistic ~30-item wardrobe for engine tests. Ids are readable on purpose.
import { makeItem, COLOR_FAMILIES } from '../../../src/model.js';

/** mk(id, slot, kind, family|[families], extra) -> Item (hex taken from the family) */
export function mk(id, slot, kind, family, extra = {}) {
  const fams = Array.isArray(family) ? family : [family];
  const colors = fams.map((f, i) => ({ hex: COLOR_FAMILIES[f].hex, family: f, weight: i === 0 ? (fams.length === 1 ? 1 : 0.65) : 0.35 / (fams.length - 1) }));
  return makeItem({ id, slot, kind, colors, ...extra, name: extra.name || id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) });
}

export function wardrobe() {
  return [
    // tops
    mk('white-oxford', 'top', 'oxford', 'white'),
    mk('lightblue-shirt', 'top', 'button-down', 'light-blue'),
    mk('navy-polo', 'top', 'polo', 'navy'),
    mk('grey-tee', 'top', 't-shirt', 'grey'),
    mk('white-tee', 'top', 't-shirt', 'white'),
    mk('black-tee', 'top', 't-shirt', 'black'),
    mk('graphic-tee', 'top', 'graphic tee', 'black', { pattern: 'graphic' }),
    mk('burgundy-sweater', 'top', 'sweater', 'burgundy'),
    mk('grey-hoodie', 'top', 'hoodie', 'grey'),
    mk('plaid-flannel', 'top', 'flannel', ['red', 'navy'], { pattern: 'plaid' }),
    mk('breton-tee', 'top', 't-shirt', ['navy', 'white'], { pattern: 'stripe' }),
    mk('white-dress-shirt', 'top', 'dress shirt', 'white'),
    // bottoms
    mk('dark-jeans', 'bottom', 'jeans', 'denim'),
    mk('black-jeans', 'bottom', 'jeans', 'black'),
    mk('beige-chinos', 'bottom', 'chinos', 'beige'),
    mk('navy-chinos', 'bottom', 'chinos', 'navy'),
    mk('grey-dress-pants', 'bottom', 'dress pants', 'charcoal'),
    mk('grey-joggers', 'bottom', 'joggers', 'grey'),
    mk('beige-shorts', 'bottom', 'shorts', 'beige'),
    // shoes
    mk('white-sneakers', 'shoes', 'sneakers', 'white'),
    mk('brown-boots', 'shoes', 'boots', 'brown', { leather: 'brown' }),
    mk('black-oxfords', 'shoes', 'oxfords', 'black', { leather: 'black' }),
    mk('running-shoes', 'shoes', 'running shoes', 'grey'),
    // belts
    mk('brown-belt', 'belt', 'leather belt', 'brown', { leather: 'brown' }),
    mk('black-belt', 'belt', 'leather belt', 'black', { leather: 'black' }),
    // layers
    mk('navy-blazer', 'layer', 'blazer', 'navy'),
    mk('denim-jacket', 'layer', 'denim jacket', 'denim'),
    mk('black-puffer', 'layer', 'puffer', 'black'),
    mk('rain-jacket', 'layer', 'rain jacket', 'olive'),
    // neckwear / headwear
    mk('navy-tie', 'neckwear', 'tie', 'navy'),
    mk('grey-scarf', 'neckwear', 'scarf', 'grey'),
    mk('black-beanie', 'headwear', 'beanie', 'black'),
    mk('navy-cap', 'headwear', 'baseball cap', 'navy'),
  ];
}

export const byId = (list) => Object.fromEntries(list.map((i) => [i.id, i]));
export const W = byId(wardrobe());

/** Build a slot -> item map from ids in the standard wardrobe. */
export function outfit(...ids) {
  const out = {};
  for (const id of ids) out[W[id].slot] = W[id];
  return out;
}
