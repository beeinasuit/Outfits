// Flat SVG illustrations for every KIND, filled with an item's colors + pattern.
// illustrate(item) -> svg markup string (viewBox 0 0 100 100). Pure: no DOM needed.
import { COLOR_FAMILIES } from '../model.js';

const INK = '#17141f';
let uid = 0;

function escAttr(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x888888;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export function shade(hex, amt) {
  const [r, g, b] = hexRgb(hex).map((v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

const S = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;
const T = `stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
const path = (d, fill = 'none', st = S) => `<path d="${d}" fill="${fill}" ${st}/>`;
const circ = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${T}/>`;
const btn = (x, y) => `<circle cx="${x}" cy="${y}" r="1.7" fill="#fffaf0" stroke="${INK}" stroke-width="1.2"/>`;

const SHORT = 'M33 15 L18 22 L7 40 L21 48 L28 41 L28 86 Q28 88 30 88 L70 88 Q72 88 72 86 L72 41 L79 48 L93 40 L82 22 L67 15 Q59 23 50 23 Q41 23 33 15 Z';
const LONG = 'M33 15 L17 22 L6 72 L19 76 L28 46 L28 86 Q28 88 30 88 L70 88 Q72 88 72 86 L72 46 L81 76 L94 72 L83 22 L67 15 Q59 23 50 23 Q41 23 33 15 Z';
const TANK = 'M34 12 Q50 38 66 12 L72 14 L72 86 Q72 88 70 88 L30 88 Q28 88 28 86 L28 14 Z';
const JACKET = 'M33 13 L17 21 L6 74 L19 78 L28 46 L28 90 L72 90 L72 46 L81 78 L94 74 L83 21 L67 13 Q59 20 50 20 Q41 20 33 13 Z';
const COAT = 'M33 12 L17 20 L6 78 L19 82 L28 48 L28 97 L72 97 L72 48 L81 82 L94 78 L83 20 L67 12 Q59 19 50 19 Q41 19 33 12 Z';
const PANTS = 'M29 8 L71 8 L75 92 L55 92 L50 36 L45 92 L25 92 Z';
const SHORTS = 'M29 10 L71 10 L77 62 L54 62 L50 34 L46 62 L23 62 Z';
const TEE_RING = 'M34 16 Q41 29 50 29 Q59 29 66 16';

function collars(c) {
  const f = shade(c.p, c.dark ? 0.25 : -0.08);
  return path('M33 15 L45 14 L50 31 L39 25 Z', f, T) + path('M67 15 L55 14 L50 31 L61 25 Z', f, T);
}
const placket = (c, n = 3) => path('M50 31 V80', 'none', T) + [0, 1, 2, 3].slice(0, n).map((i) => btn(50, 40 + i * 13)).join('');

function top(kind, c) {
  switch (kind) {
    case 'tank top': return { body: [TANK], det: path('M34 12 Q50 38 66 12', 'none', T) };
    case 'polo': return { body: [SHORT], det: collars(c) + placket(c, 2) };
    case 'henley': return { body: [LONG], det: path(TEE_RING, 'none', T) + placket(c, 3).replace('V80', 'V56') };
    case 'button-down': case 'oxford': case 'dress shirt':
      return { body: [kind === 'dress shirt' ? LONG : SHORT], det: collars(c) + placket(c, 4) + (kind === 'oxford' ? path('M33 48 H44 V58 H33 Z', 'none', T) : '') };
    case 'flannel': return { body: [LONG], det: collars(c) + placket(c, 4) };
    case 'sweater': return { body: [LONG], det: path(TEE_RING, 'none', T) + path('M28 80 H72', 'none', T) + path('M9 66 L21 70', 'none', T) + path('M91 66 L79 70', 'none', T) };
    case 'turtleneck': return { body: [LONG], det: path('M39 6 H61 V22 H39 Z', shade(c.p, c.dark ? 0.2 : -0.1), S) + path('M28 80 H72', 'none', T) };
    case 'hoodie': case 'sweatshirt':
      return { body: [LONG], det: kind === 'hoodie'
        ? path('M35 15 Q50 0 65 15 Q50 36 35 15 Z', shade(c.p, c.dark ? 0.2 : -0.12), S) + path('M45 28 L44 44 M55 28 L56 44', 'none', T) + path('M36 66 H64 L68 82 H32 Z', 'none', T)
        : path(TEE_RING, 'none', T) + path('M28 80 H72', 'none', T) };
    case 'graphic tee': return { body: [SHORT], det: path(TEE_RING, 'none', T) + path('M50 42 L53 50 L61 50 L55 55 L57 63 L50 58 L43 63 L45 55 L39 50 L47 50 Z', c.s, T) };
    default: return { body: [SHORT], det: path(TEE_RING, 'none', T) };
  }
}

function bottom(kind, c) {
  const loops = c.loops ? [37, 50, 63].map((x) => `<rect x="${x - 1.5}" y="5.5" width="3" height="11" rx="1" fill="${c.p}" ${T}/>`).join('') : '';
  if (/shorts/.test(kind)) {
    return { body: [SHORTS], det: path('M29 10 V17 H71 V10', 'none', T) + path('M50 17 V34', 'none', T) + loops + (kind === 'athletic shorts' ? path('M23 56 L77 56', 'none', T) : '') };
  }
  let det = path('M29 16 H71', 'none', T) + path('M50 16 V36', 'none', T) + path('M30 17 Q38 22 40 31', 'none', T) + path('M70 17 Q62 22 60 31', 'none', T);
  if (kind === 'joggers' || kind === 'sweatpants') det += path('M25 82 H45 M55 82 H75', 'none', S) + path('M44 12 L42 26 M56 12 L58 26', 'none', T);
  if (kind === 'cargo pants') det += path('M26.5 50 H38 V66 H26.5 Z M62 50 H73.5 V66 H62 Z', 'none', T);
  if (kind === 'dress pants' || kind === 'suit trousers') det += path('M37 22 L34 90 M63 22 L66 90', 'none', { toString: () => `stroke="${INK}" stroke-width="1" opacity=".45"` }.toString());
  if (kind === 'jeans') det += path('M32 18 L35 20 M68 18 L65 20', 'none', T);
  return { body: [PANTS], det: det + loops };
}

function shoes(kind, c) {
  const sole = '#fffaf0';
  const lace = path('M33 44 L43 40 M38 49 L48 45 M44 53 L54 49', 'none', T);
  switch (kind) {
    case 'boots': case 'chelsea boots':
      return { body: ['M20 14 H48 V50 Q56 54 76 56 Q93 58 93 70 V76 H20 Z'],
        det: path('M18 72 H94 V82 H18 Z', INK, S) + path('M20 62 H93', 'none', T) +
          (kind === 'chelsea boots' ? path('M27 30 L27 44 M41 30 L41 44', 'none', { toString: () => `stroke="${c.s}" stroke-width="3.5" stroke-linecap="round"` }.toString()) + path('M20 18 H48', 'none', T)
            : path('M25 28 L44 24 M25 36 L44 32 M25 44 L44 40', 'none', T)) };
    case 'loafers': return { body: ['M8 66 Q8 50 20 50 L36 52 Q52 52 72 57 Q93 60 93 70 V74 H8 Z'],
      det: path('M7 72 H94 V79 H7 Z', INK, S) + path('M38 54 Q52 55 62 60 Q50 62 38 54 Z', c.s, T) };
    case 'derbies': case 'oxfords': return { body: ['M8 64 L8 38 Q8 36 12 36 L28 36 Q32 50 46 52 L72 55 Q93 58 93 70 L93 74 H8 Z'],
      det: path('M7 72 H94 V80 H7 Z', INK, S) + lace + path('M70 56 Q64 62 62 70', 'none', T) };
    case 'sandals': return { body: ['M8 72 Q8 66 14 66 H84 Q94 66 94 74 H8 Z'],
      det: path('M30 66 L40 44 L52 66 M58 66 L66 46 L76 66', 'none', { toString: () => `stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"` }.toString()) };
    case 'running shoes': return { body: ['M8 62 L8 38 Q8 34 14 34 L28 36 Q34 50 46 52 L70 52 Q92 54 93 68 L93 74 H8 Z'],
      det: path('M6 68 H95 V82 Q95 84 92 84 H9 Q6 84 6 82 Z', sole, S) + path('M20 58 Q50 44 80 58', 'none', { toString: () => `stroke="${c.s}" stroke-width="4" stroke-linecap="round"` }.toString()) + lace };
    default: return { body: ['M8 64 L8 40 Q8 36 12 36 L28 36 Q32 50 46 52 L70 54 Q92 56 93 70 L93 74 H8 Z'],
      det: path('M7 70 H94 V80 Q94 82 92 82 H9 Q7 82 7 80 Z', sole, S) + lace + path('M70 55 Q78 60 80 70', 'none', T) };
  }
}

function belt(kind, c) {
  const band = 'M6 40 H94 Q97 40 97 43 V57 Q97 60 94 60 H6 Q3 60 3 57 V43 Q3 40 6 40 Z';
  const holes = [16, 26, 36, 46].map((x) => `<circle cx="${x}" cy="50" r="2" fill="${INK}"/>`).join('');
  const buckle = `<rect x="62" y="33" width="24" height="34" rx="5" fill="none" stroke="${INK}" stroke-width="2.6"/><rect x="62" y="33" width="24" height="34" rx="5" fill="none" stroke="${kind === 'dress belt' ? '#ffc933' : '#cfd3da'}" stroke-width="1" transform="translate(-.8 -.8)"/><path d="M74 33 V67" stroke="${INK}" stroke-width="3"/>`;
  const stitch = `<path d="M6 44 H60 M6 56 H60" stroke="${shade(c.p, c.dark ? 0.4 : -0.4)}" stroke-width="1.2" stroke-dasharray="3 2.4" fill="none"/>`;
  return { body: [band], det: stitch + holes + buckle };
}

function neck(kind, c) {
  if (kind === 'bow tie') {
    return { body: ['M12 30 L46 47 L12 70 Z', 'M88 30 L54 47 L88 70 Z'], det: path('M44 38 H56 V58 H44 Z', shade(c.p, c.dark ? 0.2 : -0.15), S) };
  }
  if (kind === 'scarf') {
    return { body: ['M12 20 Q50 6 88 20 L88 38 Q50 26 12 38 Z', 'M60 34 L82 38 L88 88 L64 92 Z'], det: path('M66 88 V96 M72 88 V96 M78 87 V95 M84 86 V94', 'none', T) };
  }
  const blade = kind === 'knit tie' ? 'M40 22 H60 L67 88 H33 Z' : 'M40 22 H60 L68 84 L50 96 L32 84 Z';
  return { body: [blade, 'M43 6 H57 L61 22 H39 Z'], det: path('M43 6 H57 L61 22 H39 Z', shade(c.p, c.dark ? 0.2 : -0.15), S) + (kind === 'knit tie' ? path('M33 88 V92 M67 88 V92', 'none', T) : '') };
}

function head(kind, c) {
  const sh = shade(c.p, c.dark ? 0.22 : -0.14);
  switch (kind) {
    case 'beanie': return { body: ['M22 64 Q20 26 50 24 Q80 26 78 64 Z'], det: path('M17 60 H83 V78 H17 Z', sh, S) + path('M28 60 V78 M38 60 V78 M48 60 V78 M58 60 V78 M68 60 V78', 'none', T) + circ(50, 19, 8, c.s) };
    case 'bucket hat': return { body: ['M28 24 H72 L78 56 H22 Z'], det: path('M10 58 Q50 80 90 58 Q92 66 84 70 Q50 86 16 70 Q8 66 10 58 Z', sh, S) + path('M23 48 H77', 'none', T) };
    case 'flat cap': return { body: ['M12 64 Q16 36 50 32 Q84 34 92 62 Q60 56 12 64 Z'], det: path('M12 64 Q40 58 70 62 L66 70 Q40 68 12 64 Z', sh, S) + circ(50, 33, 2.4, sh) };
    case 'fedora': return { body: ['M30 56 Q28 22 50 22 Q72 22 70 56 Z'], det: path('M8 62 Q50 50 92 62 Q92 72 50 74 Q8 72 8 62 Z', sh, S) + path('M30 49 H70 V57 H30 Z', c.s, T) + path('M40 24 Q50 32 60 24', 'none', T) };
    default: return { body: ['M20 62 Q20 26 52 26 Q82 26 82 62 Z'], det: path('M58 60 Q96 56 97 70 Q80 66 58 66 Z', sh, S) + path('M52 26 Q40 44 40 62 M52 26 Q64 44 66 62', 'none', T) + circ(51, 26, 2.6, sh) };
  }
}

function layer(kind, c) {
  const sh = shade(c.p, c.dark ? 0.22 : -0.14);
  const lap = path('M36 14 L50 48 L40 50 L28 30 Z', sh, T) + path('M64 14 L50 48 L60 50 L72 30 Z', sh, T);
  const front = path('M50 22 V90', 'none', T);
  switch (kind) {
    case 'blazer': case 'suit jacket': return { body: [JACKET], det: front + lap + btn(50, 64) + btn(50, 76) + path('M31 72 H43 M57 72 H69', 'none', T) };
    case 'cardigan': return { body: [JACKET], det: path('M38 14 L50 44 L62 14', 'none', T) + front + [34, 46, 58, 70, 82].map((y) => btn(50, y)).join('') + path('M28 84 H72', 'none', T) };
    case 'denim jacket': return { body: [JACKET], det: front + path('M38 15 L50 26 L62 15 L58 12 L50 20 L42 12 Z', sh, T) + path('M32 44 H44 V56 H32 Z M56 44 H68 V56 H56 Z', 'none', T) + btn(50, 36) + btn(50, 52) + btn(50, 68) };
    case 'bomber': return { body: ['M33 13 L17 21 L6 70 L19 74 L28 44 L28 82 H72 L72 44 L81 74 L94 70 L83 21 L67 13 Q59 20 50 20 Q41 20 33 13 Z'], det: path('M28 80 V90 H72 V80', sh, S) + path('M34 14 Q42 26 50 26 Q58 26 66 14', 'none', S) + path('M50 26 V80', 'none', T) };
    case 'leather jacket': return { body: [JACKET], det: lap + path('M45 22 L56 90', 'none', S) + path('M30 48 H42', 'none', T) };
    case 'overshirt': return { body: [JACKET], det: collars(c) + front + path('M31 46 H44 V58 H31 Z M56 46 H69 V58 H56 Z', 'none', T) + btn(50, 40) + btn(50, 58) + btn(50, 76) };
    case 'rain jacket': return { body: [JACKET], det: path('M33 14 Q50 -4 67 14 Q50 30 33 14 Z', sh, S) + path('M50 28 V90', 'none', S) + path('M44 26 L43 40 M56 26 L57 40', 'none', T) };
    case 'puffer': return { body: [JACKET], det: path('M28 38 H72 M28 54 H72 M28 70 H72', 'none', T) + path('M10 52 L24 56 M8 64 L22 68 M90 52 L76 56 M92 64 L78 68', 'none', T) + front + path('M36 14 Q50 30 64 14 V10 H36 Z', sh, S) };
    case 'overcoat': case 'peacoat': return { body: [COAT], det: lap + path('M50 48 V97', 'none', T) + [58, 72, 86].map((y) => btn(44, y) + btn(56, y)).join('') };
    case 'vest': return { body: ['M30 12 L42 12 L50 32 L58 12 L70 12 L74 32 L72 90 L28 90 L26 32 Z'], det: front.replace('V90', 'V90') + [46, 58, 70, 82].map((y) => btn(50, y)).join('') };
    default: return { body: [JACKET], det: front };
  }
}

function extra(kind, c) {
  switch (kind) {
    case 'watch': return { body: ['M40 4 H60 V96 H40 Z'], det: circ(50, 50, 20, c.s) + path('M50 50 V38 M50 50 L58 54', 'none', T) };
    case 'socks': return { body: ['M38 8 H62 V54 Q62 62 70 66 Q86 72 86 84 Q86 92 76 92 H54 Q38 92 38 78 Z'], det: path('M38 18 H62', 'none', T) };
    case 'pocket square': return { body: ['M50 14 L86 50 L50 86 L14 50 Z'], det: path('M32 32 L68 68 M68 32 L32 68', 'none', T) };
    case 'bag': return { body: ['M22 38 H78 L84 92 H16 Z'], det: path('M36 38 V28 Q36 14 50 14 Q64 14 64 28 V38', 'none', S) + path('M34 56 H66', 'none', T) };
    case 'sunglasses': return { body: ['M8 36 H46 V54 Q46 70 28 70 Q8 70 8 54 Z', 'M54 36 H92 V54 Q92 70 72 70 Q54 70 54 54 Z'], det: path('M46 42 Q50 38 54 42', 'none', S) };
    default: return { body: ['M20 20 H80 V80 H20 Z'], det: '' };
  }
}

const MAKERS = { top, bottom, shoes, belt, neckwear: neck, headwear: head, layer, extra };

function patternDefs(id, pattern, pc, p) {
  const f = `fill="${pc}"`;
  switch (pattern) {
    case 'stripe': return `<pattern id="${id}" width="11" height="11" patternUnits="userSpaceOnUse"><rect x="0" width="4.6" height="11" ${f} opacity=".9"/></pattern>`;
    case 'check': return `<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" ${f} opacity=".6"/><rect x="8" y="8" width="8" height="8" ${f} opacity=".6"/></pattern>`;
    case 'plaid': return `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse"><rect y="5" width="20" height="5" ${f} opacity=".5"/><rect x="5" width="5" height="20" ${f} opacity=".5"/><rect y="15" width="20" height="1.4" ${f}/><rect x="15" width="1.4" height="20" ${f}/></pattern>`;
    case 'houndstooth': return `<pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0 H6 L12 6 V12 H6 L0 6 Z" ${f} opacity=".75"/></pattern>`;
    case 'floral': return `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse"><g ${f} opacity=".85"><circle cx="5" cy="5" r="2.6"/><circle cx="5" cy="1.6" r="1.6"/><circle cx="5" cy="8.4" r="1.6"/><circle cx="1.6" cy="5" r="1.6"/><circle cx="8.4" cy="5" r="1.6"/><circle cx="15" cy="15" r="3"/></g></pattern>`;
    case 'graphic': return `<pattern id="${id}" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="50" cy="52" r="15" ${f} opacity=".85"/></pattern>`;
    case 'print': return `<pattern id="${id}" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M3 3 L10 6 L5 12Z M14 12 L20 15 L13 20Z" ${f} opacity=".8"/></pattern>`;
    case 'polka': return `<pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2.1" ${f}/><circle cx="9" cy="9" r="2.1" ${f}/></pattern>`;
    case 'camo': return `<pattern id="${id}" width="44" height="44" patternUnits="userSpaceOnUse"><ellipse cx="10" cy="12" rx="10" ry="6" ${f} opacity=".8"/><ellipse cx="32" cy="30" rx="9" ry="7" fill="${shade(p, -0.4)}" opacity=".8"/><ellipse cx="34" cy="8" rx="6" ry="4" ${f} opacity=".6"/></pattern>`;
    case 'textured': return `<pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".8" ${f} opacity=".5"/><circle cx="3.7" cy="3.7" r=".8" ${f} opacity=".5"/></pattern>`;
    default: return '';
  }
}

/**
 * @param {{slot:string, kind:string, colors?:Array<{hex:string,family?:string}>, pattern?:string, beltLoops?:boolean}} item
 */
export function illustrate(item, { title = '' } = {}) {
  const slot = MAKERS[item.slot] ? item.slot : 'top';
  const safe = (c) => ({ ...c, hex: /^#[0-9a-f]{6}$/i.test(c?.hex || '') ? c.hex : COLOR_FAMILIES.gray.hex });
  const colors = (Array.isArray(item.colors) && item.colors.length ? item.colors.filter(Boolean).map(safe) : [{ hex: COLOR_FAMILIES.gray.hex }]);
  if (!colors.length) colors.push({ hex: COLOR_FAMILIES.gray.hex });
  const p = colors[0].hex;
  const dark = lum(p) < 0.35;
  const s = colors[1]?.hex || shade(p, lum(p) > 0.55 ? -0.3 : 0.35);
  const c = { p, s, dark, loops: item.beltLoops };
  const { body, det } = MAKERS[slot](item.kind, c);
  const id = `p${++uid}`;
  const pat = item.pattern && item.pattern !== 'solid';
  const pc = colors[1]?.hex || (lum(p) > 0.55 ? shade(p, -0.45) : shade(p, 0.5));
  const patFill = pat && patternDefs(`${id}f`, item.pattern, pc, p);
  const clip = pat ? `<clipPath id="${id}c">${body.map((d) => `<path d="${d}"/>`).join('')}</clipPath>` : '';
  const bodies = body.map((d) => path(d, p, S)).join('');
  const overlay = pat ? `<g clip-path="url(#${id}c)"><rect width="100" height="100" fill="url(#${id}f)"/></g>${body.map((d) => path(d, 'none', S)).join('')}` : '';
  const hi = `<path d="${body[0]}" fill="none" stroke="#fff" stroke-opacity=".0"/>`;
  return `<svg class="illo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escAttr(title)}" preserveAspectRatio="xMidYMid meet"><defs>${patFill || ''}${clip}</defs>${bodies}${overlay}${det}${hi}</svg>`;
}

/** Default picker icon per slot (neutral color). */
const SLOT_ICON_KIND = { headwear: 'baseball cap', layer: 'blazer', top: 't-shirt', neckwear: 'tie', belt: 'leather belt', bottom: 'jeans', shoes: 'sneakers', extra: 'watch' };
export function slotIllustration(slot, hex = '#ffc933') {
  return illustrate({ slot, kind: SLOT_ICON_KIND[slot], colors: [{ hex }], pattern: 'solid', beltLoops: true });
}

/** Smiling hanger mascot. mood: happy | wow | sleepy | sad | wink */
export function mascot(mood = 'happy', { size = 120 } = {}) {
  const eyes = {
    happy: `<circle cx="42" cy="64" r="4.2" fill="${INK}"/><circle cx="68" cy="64" r="4.2" fill="${INK}"/>`,
    wow: `<ellipse cx="42" cy="64" rx="4.6" ry="6" fill="${INK}"/><ellipse cx="68" cy="64" rx="4.6" ry="6" fill="${INK}"/>`,
    sleepy: `<path d="M37 65 Q42 69 47 65 M63 65 Q68 69 73 65" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    sad: `<circle cx="42" cy="65" r="4" fill="${INK}"/><circle cx="68" cy="65" r="4" fill="${INK}"/><path d="M35 57 L47 60 M75 57 L63 60" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    wink: `<circle cx="42" cy="64" r="4.2" fill="${INK}"/><path d="M63 65 Q68 60 73 65" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  }[mood] || '';
  const mouth = {
    happy: 'M44 74 Q55 86 66 74', wink: 'M44 74 Q55 86 66 74', wow: 'M50 77 Q55 84 60 77 Q55 72 50 77',
    sleepy: 'M48 77 Q55 80 62 77', sad: 'M45 80 Q55 70 65 80',
  }[mood];
  return `<svg class="mascot" width="${size}" height="${size}" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M55 46 V38 C55 30 66 28 66 19 C66 11 56 7 49 13" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <path d="M60 51 L100 87 Q105 96 94 99 H21 Q10 96 15 87 L55 51 Z" fill="${INK}" transform="translate(4 4)"/>
  <path d="M55 46 L98 84 Q103 93 92 96 H18 Q7 93 12 84 Z" fill="#ffc933" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  ${eyes}<path d="${mouth}" fill="${mood === 'wow' ? INK : 'none'}" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="32" cy="76" rx="5" ry="3.2" fill="#ff5a3c" opacity=".55"/><ellipse cx="78" cy="76" rx="5" ry="3.2" fill="#ff5a3c" opacity=".55"/></svg>`;
}
