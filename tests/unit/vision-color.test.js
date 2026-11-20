import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameColor, extractColors, guessPattern, estimateWhitePoint } from '../../src/vision/color.js';
import { COLOR_FAMILIES } from '../../src/model.js';
import { solid, noise, stripes, checks, print, polka, addNoise, blank } from './fixtures/synth.js';

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dim = (rgb, k) => rgb.map((v) => Math.round(v * k));

// [hex, expected family, label]
const TABLE = [
  ['#1f2a44', 'navy', 'navy chinos'], ['#27324d', 'navy', 'navy tee'], ['#1b2a49', 'navy', 'classic navy blazer'], ['#2c3e5e', 'navy', 'navy sweater'],
  ['#1f2023', 'black', 'black jeans'], ['#26272a', 'black', 'washed black jeans'], ['#161616', 'black', 'black tee'], ['#2b2b2d', 'black', 'faded black hoodie'],
  ['#3a3d42', 'charcoal', 'charcoal suit'], ['#404449', 'charcoal', 'charcoal trousers'], ['#4b4d52', 'charcoal', 'charcoal sweater'], ['#36393f', 'charcoal', 'dark charcoal'],
  ['#3b5072', 'denim', 'dark denim'], ['#34496a', 'denim', 'dark wash jeans'], ['#4a6286', 'denim', 'mid denim'], ['#5a779c', 'denim', 'mid denim 2'],
  ['#7f9cc0', 'denim', 'light denim'], ['#8ba6c8', 'denim', 'light wash jeans'],
  ['#c3b091', 'beige', 'khaki chinos'], ['#bfae88', 'beige', 'khaki 2'], ['#c9bfae', 'beige', 'stone chinos'], ['#d9c7a3', 'beige', 'sand'], ['#c19a6b', 'beige', 'camel'],
  ['#5d6136', 'olive', 'olive overshirt'], ['#6b6e3f', 'olive', 'olive chinos'], ['#4b5320', 'olive', 'army green'],
  ['#234d36', 'forest', 'forest green'], ['#1e4d2b', 'forest', 'hunter green'],
  ['#2e8b4a', 'green', 'green polo'], ['#3a9d5d', 'green', 'kelly green'],
  ['#1f8a8a', 'teal', 'teal tee'], ['#1d7a80', 'teal', 'dark teal'],
  ['#6d1f2f', 'burgundy', 'burgundy sweater'], ['#5e1a2b', 'burgundy', 'oxblood'], ['#7a2335', 'burgundy', 'wine'],
  ['#d13b3b', 'red', 'red tee'], ['#b8242a', 'red', 'brick red'],
  ['#a4502a', 'rust', 'rust sweater'], ['#b5532c', 'rust', 'terracotta'],
  ['#e8742a', 'orange', 'orange tee'], ['#c99a2e', 'mustard', 'mustard sweater'], ['#d1a23a', 'mustard', 'mustard 2'],
  ['#f2c94c', 'yellow', 'yellow tee'], ['#f5dd5a', 'yellow', 'lemon'],
  ['#6b4a2f', 'brown', 'brown corduroys'], ['#5b4030', 'brown', 'coffee'], ['#7a5a3c', 'brown', 'tobacco'], ['#4a3426', 'brown', 'chocolate'],
  ['#f5f5f2', 'white', 'white tee'], ['#fbfbfb', 'white', 'bright white'], ['#ececec', 'white', 'off-white shirt'],
  ['#efe6d2', 'cream', 'cream sweater'], ['#f2ead8', 'cream', 'ivory'],
  ['#8e9196', 'gray', 'heather gray'], ['#9b9b9b', 'gray', 'mid gray'], ['#a6a8ab', 'gray', 'light heather'], ['#c9cacc', 'gray', 'light gray'],
  ['#f2a7bb', 'pink', 'pink shirt'], ['#f4b8c8', 'pink', 'light pink'],
  ['#b9a7e0', 'lavender', 'lavender'], ['#c5b5e6', 'lavender', 'pale lavender'],
  ['#6c4ab6', 'purple', 'purple'], ['#5a3a8a', 'purple', 'deep purple'],
  ['#2f6fd0', 'blue', 'royal blue'], ['#1f55b5', 'blue', 'cobalt'],
  ['#9cc3e6', 'light-blue', 'sky blue shirt'], ['#a9cdea', 'light-blue', 'pale blue oxford'],
];

test('nameColor: real-world clothing table >= 90% and exact families printed on miss', () => {
  assert.ok(TABLE.length >= 40);
  const misses = [];
  for (const [hex, fam, label] of TABLE) {
    assert.ok(COLOR_FAMILIES[fam], fam);
    const got = nameColor(hexRgb(hex));
    if (got !== fam) misses.push(`${label} ${hex}: expected ${fam}, got ${got}`);
  }
  const acc = 1 - misses.length / TABLE.length;
  if (misses.length) console.log(`nameColor accuracy ${(acc * 100).toFixed(1)}% (${TABLE.length} samples)\n  ${misses.join('\n  ')}`);
  assert.ok(acc >= 0.9, `accuracy ${acc}`);
});

test('nameColor: jittered (held-out) variants of the table stay >= 88%', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let ok = 0, n = 0;
  const bad = [];
  for (const [hex, fam, label] of TABLE) {
    for (let k = 0; k < 6; k++) {
      const rgb = hexRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 14))));
      n++;
      const got = nameColor(rgb);
      if (got === fam) ok++; else bad.push(`${label} ${rgb} -> ${got}`);
    }
  }
  console.log(`jittered accuracy ${(100 * ok / n).toFixed(1)}% (${n})`, bad.slice(0, 12));
  assert.ok(ok / n >= 0.88);
});

test('nameColor: no neutral gray/black/white is ever named a loud color', () => {
  for (let v = 0; v <= 255; v += 5) {
    for (const tint of [[0, 0, 0], [3, 0, -3], [-3, 0, 3], [4, 2, -2], [2, 2, -4]]) {
      const rgb = [v + tint[0], v + tint[1], v + tint[2]].map((c) => Math.max(0, Math.min(255, c)));
      const fam = nameColor(rgb);
      assert.ok(COLOR_FAMILIES[fam].neutral, `rgb ${rgb} -> ${fam}`);
    }
  }
  // grays must stay in the gray ladder
  for (const [rgb, want] of [[[10, 10, 10], 'black'], [[60, 60, 60], 'charcoal'], [[130, 130, 130], 'gray'], [[250, 250, 250], 'white']]) {
    assert.equal(nameColor(rgb), want);
  }
});

test('nameColor: shadowed variants keep their family', () => {
  const base = TABLE.filter(([, fam]) => !['black', 'charcoal', 'white', 'cream', 'gray', 'yellow', 'light-blue', 'pink', 'lavender', 'orange'].includes(fam));
  const bad = [];
  let n = 0;
  for (const [hex, fam, label] of base) {
    n++;
    const got = nameColor(dim(hexRgb(hex), 0.85));
    if (got !== fam) bad.push(`${label} @0.85: ${fam} -> ${got}`);
  }
  if (bad.length) console.log('shadow variants:\n  ' + bad.join('\n  '));
  assert.ok(1 - bad.length / n >= 0.85, `${bad.length}/${n} shadowed variants changed family`);
  // light colors dimmed a bit
  for (const [hex, fam] of [['#f5f5f2', 'white'], ['#efe6d2', 'cream'], ['#c3b091', 'beige'], ['#8e9196', 'gray'], ['#f2c94c', 'yellow'], ['#9cc3e6', 'light-blue']]) {
    assert.equal(nameColor(dim(hexRgb(hex), 0.92)), fam, `${hex} @0.92`);
  }
});

test('nameColor: never throws on odd input', () => {
  for (const c of [[0, 0, 0], [255, 255, 255], [NaN, 1, 2], [300, -4, 9], [1.5, 2.5, 3.5]]) {
    assert.ok(COLOR_FAMILIES[nameColor(c)]);
  }
});

const weightOf = (cols, fam) => cols.filter((c) => c.family === fam).reduce((s, c) => s + c.weight, 0);

test('extractColors: two-color image gives both with right weights', () => {
  const im = solid(100, 100, [31, 42, 68]);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 30; x++) { const i = (y * 100 + x) * 4; im.data[i] = 196; im.data[i + 1] = 60; im.data[i + 2] = 50; }
  addNoise(im, 4);
  const cols = extractColors(im, { ignoreBackground: false });
  assert.equal(cols.length, 2);
  assert.equal(cols[0].family, 'navy');
  assert.ok(Math.abs(cols[0].weight - 0.7) < 0.1, `w0 ${cols[0].weight}`);
  assert.ok(Math.abs(weightOf(cols, 'red') + weightOf(cols, 'rust') - 0.3) < 0.1);
  assert.ok(Math.abs(cols.reduce((s, c) => s + c.weight, 0) - 1) < 1e-6);
  assert.match(cols[0].hex, /^#[0-9a-f]{6}$/);
});

test('extractColors: 50/50 split and mask', () => {
  const im = solid(80, 80, [240, 240, 238]);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 40; x++) { const i = (y * 80 + x) * 4; im.data[i] = 30; im.data[i + 1] = 30; im.data[i + 2] = 32; }
  const cols = extractColors(im, { ignoreBackground: false });
  assert.equal(cols.length, 2);
  for (const c of cols) assert.ok(Math.abs(c.weight - 0.5) < 0.1);
  // mask selects only the dark half
  const mask = new Uint8Array(80 * 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 40; x++) mask[y * 80 + x] = 1;
  const m = extractColors(im, { mask });
  assert.equal(m.length, 1);
  assert.equal(m[0].family, 'black');
});

test('extractColors: ignores plain background around the item, keeps close-ups', () => {
  const im = solid(120, 120, [235, 235, 235]);
  for (let y = 30; y < 90; y++) for (let x = 30; x < 90; x++) { const i = (y * 120 + x) * 4; im.data[i] = 109; im.data[i + 1] = 31; im.data[i + 2] = 47; }
  const cols = extractColors(im);
  assert.equal(cols[0].family, 'burgundy');
  assert.ok(cols[0].weight > 0.9);
  // close-up: whole frame is the item, same as border -> must not be dropped
  const close = extractColors(solid(50, 50, [93, 97, 54]));
  assert.equal(close.length, 1);
  assert.equal(close[0].family, 'olive');
});

test('extractColors: deterministic', () => {
  const im = print(96, 96);
  const a = JSON.stringify(extractColors(im, { ignoreBackground: false, maxColors: 4 }));
  const b = JSON.stringify(extractColors(im, { ignoreBackground: false, maxColors: 4 }));
  assert.equal(a, b);
  assert.ok(extractColors(im, { maxColors: 4, ignoreBackground: false }).length <= 4);
});

test('extractColors: degenerate inputs never throw and never return empty', () => {
  const imgs = [
    { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    { width: 1, height: 1, data: new Uint8ClampedArray([200, 10, 10, 255]) },
    { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) },
    blank(40, 40), // fully transparent
    solid(10, 10, [0, 0, 0]), solid(10, 10, [255, 255, 255]), noise(30, 30),
    null, undefined, { width: 5, height: 5 }, { width: 5, height: 5, data: new Uint8ClampedArray(4) },
  ];
  for (const im of imgs) {
    const c = extractColors(im);
    assert.ok(c.length >= 1);
    assert.ok(COLOR_FAMILIES[c[0].family]);
    assert.ok(Math.abs(c.reduce((s, x) => s + x.weight, 0) - 1) < 1e-6);
    assert.ok(['solid', 'stripe', 'check', 'textured', 'print', 'polka'].includes(guessPattern(im)));
  }
  assert.equal(extractColors(blank(40, 40))[0].family, 'gray');
  // mask that selects nothing
  assert.equal(extractColors(solid(10, 10, [200, 0, 0]), { mask: new Uint8Array(100) })[0].family, 'gray');
});

test('guessPattern', () => {
  assert.equal(guessPattern(solid(128, 128, [30, 50, 90])), 'solid');
  assert.equal(guessPattern(addNoise(solid(128, 128, [30, 50, 90]), 5)), 'solid');
  for (const o of ['v', 'h', 'd']) {
    assert.equal(guessPattern(stripes(128, 128, { orientation: o, period: 14, noiseSigma: 4 })), 'stripe', `stripes ${o}`);
  }
  assert.equal(guessPattern(stripes(128, 128, { orientation: 'v', period: 10, c1: [30, 40, 90], c2: [42, 54, 104] })), 'solid'); // too subtle -> conservative
  assert.equal(guessPattern(checks(128, 128, { size: 14, noiseSigma: 4 })), 'check');
  assert.equal(guessPattern(print(128, 128)), 'print');
  // a mask restricts the analysis: stripes only in the left half
  const im = solid(128, 128, [200, 200, 200]);
  const st = stripes(64, 128, { period: 10 });
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) { const s = (y * 64 + x) * 4, d = (y * 128 + x) * 4; im.data.set(st.data.subarray(s, s + 4), d); }
  const mask = new Uint8Array(128 * 128);
  for (let y = 0; y < 128; y++) for (let x = 64; x < 128; x++) mask[y * 128 + x] = 1;
  assert.equal(guessPattern(im, { mask }), 'solid');
});

// ---- white balance, robustness, polka (added with the adversarial fixes) ----
const tintRgb = (rgb, k) => rgb.map((v, i) => Math.min(255, Math.round(v * k[i])));
test('extractColors with whitePoint recovers >= 85% of the table under strong warm/cool tints, neutral unchanged', () => {
  for (const [label, k] of [['warm', [1.15, 1, 0.85]], ['cool', [0.85, 1, 1.15]], ['neutral', [1, 1, 1]]]) {
    let ok = 0;
    for (const [hex, fam] of TABLE) {
      const im = addNoise(solid(40, 40, tintRgb(hexRgb(hex), k)), 3, 5);
      const wp = tintRgb([205, 205, 205], k);
      if (extractColors(im, { whitePoint: wp })[0].family === fam) ok++;
    }
    assert.ok(ok / TABLE.length >= (label === 'neutral' ? 0.9 : 0.85), `${label}: ${ok}/${TABLE.length}`);
  }
});
test('estimateWhitePoint: neutral sheet -> ~neutral, tinted sheet -> pulled toward neutral, never throws', () => {
  const n = estimateWhitePoint(solid(100, 80, [220, 220, 220]));
  assert.ok(n.every((v) => Math.abs(v - 220) < 3));
  const w = estimateWhitePoint(solid(100, 80, [253, 220, 187]));
  assert.ok(w[0] > w[1] && w[1] > w[2]);
  assert.equal(estimateWhitePoint(null), null);
  const cs = extractColors(solid(40, 40, [247, 205, 160]), { autoWhiteBalance: true });
  assert.ok(cs.length >= 1);
});
test('robust input: nameColor(null/undefined/NaN) -> gray; maxColors NaN/0/negative never returns []', () => {
  for (const v of [null, undefined, [NaN, NaN, NaN], 'x']) assert.equal(nameColor(v), 'gray');
  for (const mc of [NaN, 0, -3, 50]) { const c = extractColors(print(60, 60), { maxColors: mc }); assert.ok(c.length >= 1 && c.length <= 4); }
});
test('guessPattern: regular polka dots -> polka, not check', () => {
  assert.equal(guessPattern(polka(160, 160, { noiseSigma: 3 })), 'polka');
  assert.equal(guessPattern(checks(160, 160, { size: 12, noiseSigma: 3 })), 'check');
});
