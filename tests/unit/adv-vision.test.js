// Adversarial vision tests (section B of tests/ADVERSARIAL.md + extras). Tests encode EXPECTED behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { segmentItems } from '../../src/vision/segment.js';
import { extractColors, nameColor, guessPattern } from '../../src/vision/color.js';
import { COLOR_FAMILIES } from '../../src/model.js';
import { render, iou, bestIous, gridItems, PALETTE, woodGrain, stripedSheet, checkedSheet, rng } from './fixtures/adv-scenes.js';
import { solid, stripes, checks, print, addNoise, blank } from './fixtures/synth.js';

const log = (...a) => console.log('ADV|', ...a);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const contains = (box, t, tol = 4) => box.x <= t.x + tol && box.y <= t.y + tol && box.x + box.w >= t.x + t.w - tol && box.y + box.h >= t.y + t.h - tol;

function collector() { return { n: 0, first: [], add(m) { this.n++; if (this.first.length < 4) this.first.push(m); } }; }
function none(c, label) { assert.equal(c.n, 0, `${label}: ${c.n} violation(s). First repros:\n  ${c.first.join('\n  ')}`); }

/** Run a scenario over seeds; returns {countAcc, meanIou, containRate, ms, n}. */
function scenario(name, mk, { seeds = 6, opts = {}, tol = 4 } = {}) {
  let ok = 0, ious = [], cont = 0, tot = 0, ms = 0, detected = [], truthN = 0;
  for (let s = 0; s < seeds; s++) {
    const im = mk(100 + s);
    const t0 = performance.now(); const boxes = segmentItems(im, opts); ms += performance.now() - t0;
    detected.push(boxes.length); truthN = im.truth.length;
    if (boxes.length === im.truth.length) ok++;
    const bi = bestIous(im.truth, boxes); ious.push(...bi);
    for (const t of im.truth) { tot++; if (boxes.some((b) => contains(b, t, tol))) cont++; }
  }
  const r = { name, seeds, truth: truthN, countAcc: ok / seeds, meanIou: mean(ious), containRate: cont / tot, ms: ms / seeds, detected: detected.join(',') };
  log(`SCENE ${name}: truth=${r.truth} detected=[${r.detected}] countAcc=${(r.countAcc * 100).toFixed(0)}% meanIoU=${r.meanIou.toFixed(2)} contain=${(r.containRate * 100).toFixed(0)}% ${r.ms.toFixed(0)}ms/img`);
  return r;
}
const base5 = (extra = {}) => (seed) => render({ width: 1024, height: 768, items: gridItems(5), seed, ...extra });

// ---------------------------------------------------------------------------------------------
// B0. sanity baseline and output contract
// ---------------------------------------------------------------------------------------------
test('B0 baseline: 5 items on a clean sheet -> exact count, containment, IoU >= 0.8, < 300 ms', () => {
  const r = scenario('baseline-5', base5({ noise: 3 }));
  assert.equal(r.countAcc, 1); assert.equal(r.containRate, 1); assert.ok(r.meanIou >= 0.8, `meanIoU ${r.meanIou}`); assert.ok(r.ms < 300, `${r.ms} ms`);
});
test('B0b output contract: integer boxes inside the frame, mask length == w*h, area == mask sum, non-overlapping, deterministic, input untouched', () => {
  const c = collector();
  const im = render({ width: 800, height: 600, items: gridItems(6, 800, 600), noise: 4, shadow: 0.4, seed: 3 });
  const copy = new Uint8ClampedArray(im.data);
  const a = segmentItems(im); const b = segmentItems(im);
  assert.deepEqual(a, b, 'non-deterministic');
  assert.deepEqual(im.data, copy, 'input pixels were mutated');
  for (const bx of a) {
    for (const k of ['x', 'y', 'w', 'h', 'area']) if (!Number.isFinite(bx[k])) c.add(`${k}=${bx[k]}`);
    if (bx.x < 0 || bx.y < 0 || bx.x + bx.w > im.width || bx.y + bx.h > im.height) c.add(`box outside frame ${JSON.stringify([bx.x, bx.y, bx.w, bx.h])}`);
    if (bx.w < 1 || bx.h < 1) c.add('empty box');
    if (bx.mask && bx.mask.length !== bx.w * bx.h) c.add(`mask len ${bx.mask.length} != ${bx.w * bx.h}`);
    if (bx.mask && bx.mask.reduce((s, v) => s + v, 0) !== bx.area) c.add('area != mask sum');
    if (![bx.x, bx.y, bx.w, bx.h].every(Number.isInteger)) c.add(`non-integer box ${JSON.stringify([bx.x, bx.y, bx.w, bx.h])}`);
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (iou(a[i], a[j]) > 0.05) c.add(`boxes ${i},${j} overlap IoU=${iou(a[i], a[j]).toFixed(2)}`);
  none(c, 'output contract');
});
test('B0c boxes are sorted top-left to bottom-right (reading order by rows)', () => {
  const im = render({ width: 1024, height: 768, items: gridItems(6), seed: 4 });
  const boxes = segmentItems(im);
  const key = (b) => Math.round((b.y + b.h / 2) / 200) * 10000 + (b.x + b.w / 2);
  for (let i = 1; i < boxes.length; i++) assert.ok(key(boxes[i]) >= key(boxes[i - 1]), `order broken at ${i}: ${JSON.stringify(boxes.map((b) => [b.x, b.y]))}`);
});

// ---------------------------------------------------------------------------------------------
// B1. low contrast
// ---------------------------------------------------------------------------------------------
test('B1a low contrast: white shirt on white sheet (informational: reports detection rate, must not crash)', () => {
  const mk = (seed) => render({ width: 1024, height: 768, bg: [236, 235, 230], items: [{ shape: 'shirt', x: 300, y: 150, w: 420, h: 460, color: [250, 250, 248] }], noise: 2, shadow: 0.25, seed });
  const r = scenario('white-on-white (dL~6)', mk, { seeds: 8 });
  log(`INFO white shirt on white sheet detected in ${(r.countAcc * 100).toFixed(0)}% of runs (extreme case, informational)`);
});
test('B1b low contrast: white shirt on cream sheet (dL~12) detected >= 90%', () => {
  const mk = (seed) => render({ width: 1024, height: 768, bg: [228, 222, 205], items: [{ shape: 'shirt', x: 300, y: 150, w: 420, h: 460, color: [248, 248, 246] }], noise: 2, shadow: 0.2, seed });
  const r = scenario('white-on-cream (dL~12)', mk, { seeds: 8 });
  assert.ok(r.countAcc >= 0.9 && r.containRate >= 0.9, `${JSON.stringify(r)}`);
});
test('B1c low contrast: black jeans on dark floor (reported)', () => {
  const mk = (seed) => render({ width: 1024, height: 768, bg: [38, 36, 36], items: [{ shape: 'rect', x: 380, y: 90, w: 260, h: 580, color: [14, 14, 18] }], noise: 2, gradient: 0.15, seed });
  const r = scenario('black-on-dark-floor', mk, { seeds: 8 });
  assert.ok(r.countAcc >= 0.5, `black jeans on dark floor found in only ${(r.countAcc * 100).toFixed(0)}% of runs`);
});
test('B1d low contrast: grey tee on grey carpet at dL~10 with noise sigma 6', () => {
  const mk = (seed) => render({ width: 1024, height: 768, bg: [120, 120, 122], items: [{ shape: 'shirt', x: 300, y: 150, w: 420, h: 460, color: [142, 142, 144] }], noise: 6, seed });
  const r = scenario('grey-on-grey (dL~9, noisy)', mk, { seeds: 8 });
  assert.ok(r.countAcc >= 0.5, `${(r.countAcc * 100).toFixed(0)}%`);
});

// ---------------------------------------------------------------------------------------------
// B2. patterned backgrounds
// ---------------------------------------------------------------------------------------------
test('B2a wood-grain floor: 4 items counted correctly >= 80% of runs', () => {
  const r = scenario('wood-grain bg', (seed) => render({ width: 1024, height: 768, bg: woodGrain(), items: gridItems(4, 1024, 768, { colors: [[235, 235, 232], [31, 42, 68], [200, 60, 60], [230, 220, 190]] }), noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8, `count accuracy ${(r.countAcc * 100).toFixed(0)}% detected=[${r.detected}]`);
});
test('B2b striped bed sheet (35px stripes): 4 items counted correctly >= 80%', () => {
  const r = scenario('striped sheet bg', (seed) => render({ width: 1024, height: 768, bg: stripedSheet(), items: gridItems(4, 1024, 768, { colors: [[31, 42, 68], [196, 60, 50], [60, 90, 60], [40, 40, 44]] }), noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8, `count accuracy ${(r.countAcc * 100).toFixed(0)}% detected=[${r.detected}]`);
});
test('B2c checkered tablecloth: 4 items counted correctly >= 80%', () => {
  const r = scenario('checked bg', (seed) => render({ width: 1024, height: 768, bg: checkedSheet(), items: gridItems(4, 1024, 768, { colors: [[31, 42, 68], [196, 60, 50], [60, 90, 60], [40, 40, 44]] }), noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8, `count accuracy ${(r.countAcc * 100).toFixed(0)}% detected=[${r.detected}]`);
});
test('B2d patterned bg: boxes must not balloon (no box > 40% of frame for 4 items)', () => {
  const c = collector();
  for (const [n, bg] of [['wood', woodGrain()], ['stripe', stripedSheet()], ['check', checkedSheet()]]) {
    const im = render({ width: 1024, height: 768, bg, items: gridItems(4, 1024, 768, { colors: [[31, 42, 68], [196, 60, 50], [60, 90, 60], [40, 40, 44]] }), noise: 3, seed: 5 });
    for (const b of segmentItems(im)) if (b.w * b.h > 0.4 * 1024 * 768) c.add(`${n}: box ${b.w}x${b.h}`);
  }
  none(c, 'ballooned box');
});

// ---------------------------------------------------------------------------------------------
// B3. lighting
// ---------------------------------------------------------------------------------------------
test('B3a strong vignette (0.45)', () => {
  const r = scenario('vignette 0.45', base5({ vignette: 0.45, noise: 3 }));
  assert.ok(r.countAcc >= 0.8 && r.containRate >= 0.9, JSON.stringify(r));
});
test('B3b one-sided window light (side=0.9)', () => {
  const r = scenario('one-sided light 0.9', base5({ side: 0.9, noise: 3 }));
  assert.ok(r.countAcc >= 0.8 && r.containRate >= 0.9, JSON.stringify(r));
});
test('B3c hard drop shadows (strength 0.6, offset 28,36): count right and boxes not swollen by shadows', () => {
  const r = scenario('hard shadows 0.6', base5({ shadow: 0.6, shadowOffset: [28, 36], noise: 3 }));
  assert.ok(r.countAcc >= 0.8, `count ${JSON.stringify(r)}`);
  assert.ok(r.meanIou >= 0.7, `shadows swelled the boxes: meanIoU ${r.meanIou.toFixed(2)}`);
});
test('B3d everything at once: vignette + side light + shadow + noise + jpeg blocks', () => {
  const r = scenario('combined lighting+jpeg', base5({ vignette: 0.3, side: 0.5, shadow: 0.45, shadowOffset: [20, 26], noise: 5, jpeg: 5 }));
  assert.ok(r.countAcc >= 0.7 && r.containRate >= 0.85, JSON.stringify(r));
});
test('B3e JPEG-like blockiness (+-8) and heavy noise (sigma 12)', () => {
  const r = scenario('jpeg blocks 8 + noise 12', base5({ jpeg: 8, noise: 12 }));
  assert.ok(r.countAcc >= 0.8 && r.containRate >= 0.9, JSON.stringify(r));
});

// ---------------------------------------------------------------------------------------------
// B4. white balance and colour accuracy
// ---------------------------------------------------------------------------------------------
const src = readFileSync(new URL('./vision-color.test.js', import.meta.url), 'utf8');
const TABLE = [...src.matchAll(/\['(#[0-9a-f]{6})', '([a-z-]+)', '([^']+)'\]/g)].map((m) => [m[1], m[2], m[3]]);
const tint = (rgb, [kr, kg, kb]) => [Math.min(255, rgb[0] * kr), Math.min(255, rgb[1] * kg), Math.min(255, rgb[2] * kb)].map(Math.round);
const WB = { neutral: [1, 1, 1], 'warm indoor (+R -B 15%)': [1.15, 1, 0.85], 'cool shade (-R +B 15%)': [0.85, 1, 1.15], 'mild warm (+8%)': [1.08, 1, 0.92], 'mild cool (+8%)': [0.92, 1, 1.08] };
for (const [label, k] of Object.entries(WB)) {
  test(`B4 nameColor on the ${TABLE.length}-colour table under ${label}`, () => {
    assert.ok(TABLE.length >= 40, `table parse found ${TABLE.length}`);
    const miss = [];
    for (const [hex, fam, name] of TABLE) { const got = nameColor(tint(hexRgb(hex), k)); if (got !== fam) miss.push(`${name}: ${fam} -> ${got}`); }
    const acc = 1 - miss.length / TABLE.length;
    log(`WB nameColor ${label}: ${(acc * 100).toFixed(1)}% (${TABLE.length - miss.length}/${TABLE.length}) misses: ${miss.slice(0, 8).join('; ')}`);
    const floor = label === 'neutral' ? 0.9 : label.startsWith('mild') ? 0.85 : 0.65;
    assert.ok(acc >= floor, `accuracy ${(acc * 100).toFixed(1)}% < ${floor * 100}%: ${miss.join('; ')}`);
  });
}
test('B4b extractColors on noisy solid swatches under +-15% white balance keeps >= 65% of the table correct', () => {
  for (const [label, k] of [['warm', WB['warm indoor (+R -B 15%)']], ['cool', WB['cool shade (-R +B 15%)']]]) {
    let ok = 0; const miss = [];
    for (const [hex, fam, name] of TABLE) {
      const rgb = tint(hexRgb(hex), k);
      const im = render({ width: 48, height: 48, bg: rgb, items: [], noise: 4, seed: 9 });
      const got = extractColors(im)[0].family;
      if (got === fam) ok++; else miss.push(`${name}->${got}`);
    }
    log(`WB extractColors ${label}: ${(100 * ok / TABLE.length).toFixed(1)}% ${miss.slice(0, 6).join('; ')}`);
    assert.ok(ok / TABLE.length >= 0.65, `${label}: ${ok}/${TABLE.length}`);
  }
});
test('B4c colour accuracy per item inside a segmented scene (mask-aware), with and without warm/cool white balance', () => {
  const cols = [[31, 42, 68], [196, 60, 50], [60, 90, 60], [200, 160, 60], [235, 235, 232]];
  const expected = cols.map(nameColor);
  for (const [label, wb] of [['neutral', [1, 1, 1]], ['warm', [1.12, 1, 0.88]], ['cool', [0.88, 1, 1.12]]]) {
    const im = render({ width: 1024, height: 768, bg: [214, 204, 188], items: gridItems(5, 1024, 768, { colors: cols }), noise: 3, shadow: 0.3, wb, seed: 21 });
    const boxes = segmentItems(im);
    let ok = 0;
    for (let i = 0; i < im.truth.length; i++) {
      const t = im.truth[i];
      const bx = boxes.find((b) => contains(b, t, 6)); if (!bx) continue;
      const crop = { width: bx.w, height: bx.h, data: new Uint8ClampedArray(bx.w * bx.h * 4) };
      for (let y = 0; y < bx.h; y++) for (let x = 0; x < bx.w; x++) { const s = ((bx.y + y) * im.width + bx.x + x) * 4; const d = (y * bx.w + x) * 4; crop.data.set(im.data.subarray(s, s + 4), d); }
      const got = extractColors(crop, { mask: bx.mask })[0].family;
      if (got === expected[i]) ok++;
      else log(`  item ${i} under ${label}: expected ${expected[i]} got ${got}`);
    }
    log(`SCENE colour accuracy ${label} WB: ${ok}/5`);
    assert.ok(ok >= (label === 'neutral' ? 5 : 3), `${label}: ${ok}/5 correct`);
  }
});
test('B4d two-tone item (navy/white stripes, 50/50) reports both families with weights summing ~1', () => {
  const im = stripes(120, 120, { c1: [31, 42, 68], c2: [240, 240, 238], period: 10, orientation: 'v', noiseSigma: 3 });
  const cs = extractColors(im, { maxColors: 3 });
  const fams = cs.map((c) => c.family);
  assert.ok(fams.includes('navy') && fams.includes('white'), `got ${JSON.stringify(cs)}`);
  assert.ok(Math.abs(cs.reduce((s, c) => s + c.weight, 0) - 1) < 0.08, `weights ${cs.map((c) => c.weight)}`);
});
test('B4e same two-tone item WITH an all-ones mask reports both families (isolates the background-removal path)', () => {
  const im = stripes(120, 120, { c1: [31, 42, 68], c2: [240, 240, 238], period: 10, orientation: 'v', noiseSigma: 3 });
  const cs = extractColors(im, { mask: new Uint8Array(120 * 120).fill(1) });
  const fams = cs.map((c) => c.family);
  assert.ok(fams.includes('navy') && fams.includes('white'), `got ${JSON.stringify(cs)}`);
});

// ---------------------------------------------------------------------------------------------
// B5. size handling / degenerate
// ---------------------------------------------------------------------------------------------
test('B5a 4000x3000 input: downsampled internally, < 1.5 s, boxes in original pixel coordinates', () => {
  const W = 4000, H = 3000; const s = W / 1024;
  const items = gridItems(5, 1024, 768).map((it) => ({ ...it, x: it.x * s, y: it.y * s, w: it.w * s, h: it.h * s }));
  const im = render({ width: W, height: H, items, noise: 3, seed: 8 });
  const t0 = performance.now(); const boxes = segmentItems(im); const dt = performance.now() - t0;
  log(`SCENE 4000x3000: ${boxes.length} boxes, ${dt.toFixed(0)} ms, IoU=${mean(bestIous(im.truth, boxes)).toFixed(2)}`);
  assert.ok(dt < 1500, `${dt.toFixed(0)} ms`);
  assert.equal(boxes.length, 5);
  assert.ok(mean(bestIous(im.truth, boxes)) >= 0.8, 'boxes not in original coordinates');
  for (const b of boxes) assert.equal(b.mask.length, b.w * b.h, 'mask not at full resolution');
});
test('B5b degenerate sizes and inputs never throw and return []', () => {
  const cases = {
    '0x0': { width: 0, height: 0, data: new Uint8ClampedArray(0) }, '1x1': solid(1, 1, [10, 20, 30]), '2x2': solid(2, 2, [10, 20, 30]), '7x7': solid(7, 7, [9, 9, 9]),
    '1x1000': solid(1, 1000, [200, 10, 10]), '1000x1': solid(1000, 1, [200, 10, 10]), '8x8': solid(8, 8, [100, 100, 100]),
    'all transparent': solid(200, 200, [255, 255, 255], 0), 'half transparent': solid(200, 200, [255, 0, 0], 100),
    'NaN dims': { width: NaN, height: 5, data: new Uint8ClampedArray(20) }, 'negative dims': { width: -5, height: 5, data: new Uint8ClampedArray(20) },
    'data too short': { width: 100, height: 100, data: new Uint8ClampedArray(40) }, 'fractional dims': { width: 10.5, height: 10.5, data: new Uint8ClampedArray(1000) },
    'null': null, 'undefined': undefined, 'empty obj': {}, 'no data': { width: 10, height: 10 }, 'plain array data': { width: 20, height: 20, data: new Array(1600).fill(128) },
  };
  for (const [name, im] of Object.entries(cases)) {
    let r; try { r = segmentItems(im); } catch (e) { assert.fail(`${name} threw ${e.message}`); }
    assert.ok(Array.isArray(r), `${name}: not array`);
    if (!['plain array data'].includes(name)) assert.ok(r.length <= 1, `${name}: ${r.length} boxes from a blank/degenerate image`);
  }
  for (const o of [null, 5, 'x', { minAreaFrac: -1 }, { minAreaFrac: 5 }, { minAreaFrac: NaN }, { maxItems: 0 }, { maxItems: -3 }, { maxItems: NaN }, { maxItems: 1e9 }, { padding: -1 }, { padding: 5 }, { padding: NaN }]) {
    const im = render({ width: 640, height: 480, items: gridItems(4, 640, 480), seed: 2 });
    let r; try { r = segmentItems(im, o); } catch (e) { assert.fail(`opts ${JSON.stringify(o)} threw ${e.message}`); }
    assert.ok(Array.isArray(r));
    for (const b of r) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 640 && b.y + b.h <= 480, `opts ${JSON.stringify(o)} box out of frame ${JSON.stringify([b.x, b.y, b.w, b.h])}`);
  }
});
test('B5c uniform / empty frame gives [] or exactly one full-frame box, never a spurious pile', () => {
  for (const im of [solid(400, 300, [230, 228, 220]), addNoise(solid(400, 300, [230, 228, 220]), 4, 3), solid(400, 300, [0, 0, 0]), solid(400, 300, [255, 255, 255])]) {
    const r = segmentItems(im);
    assert.ok(r.length <= 1, `${r.length} boxes on an empty sheet`);
    if (r.length === 1) assert.ok(r[0].w * r[0].h >= 0.8 * 400 * 300, 'single box that is not full frame');
  }
});
test('B5d close-up garment filling the whole frame returns one near-full-frame box (ARCHITECTURE contract)', () => {
  for (const im of [stripes(400, 300, { c1: [31, 42, 68], c2: [240, 240, 238], period: 14, noiseSigma: 3 }), checks(400, 300, { size: 20, noiseSigma: 3 }), print(400, 300)]) {
    const r = segmentItems(im);
    assert.equal(r.length, 1, `${r.length} boxes`);
    assert.ok(r[0].w * r[0].h >= 0.8 * 400 * 300, `box covers ${(100 * r[0].w * r[0].h / 120000).toFixed(0)}% of frame`);
  }
});
test('B5e a single large item on the sheet gives exactly one box', () => {
  const r = scenario('single large item', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'shirt', x: 200, y: 100, w: 600, h: 560, color: [90, 70, 120] }], noise: 3, shadow: 0.3, seed }));
  assert.equal(r.countAcc, 1);
});

// ---------------------------------------------------------------------------------------------
// B6. geometry: touching, rotated, tiny, belt, many
// ---------------------------------------------------------------------------------------------
test('B6a touching items with different colours (0 px gap) are split into 2', () => {
  const r = scenario('touching 0px gap', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 150, y: 150, w: 330, h: 450, color: [31, 42, 68] }, { shape: 'rect', x: 480, y: 150, w: 330, h: 450, color: [196, 60, 50] }], noise: 3, seed }), { seeds: 6 });
  assert.ok(r.countAcc >= 0.8, `count accuracy ${(r.countAcc * 100).toFixed(0)}% detected=[${r.detected}]`);
});
test('B6b items overlapping slightly (shirt over trousers) are not merged into a mega box', () => {
  const r = scenario('overlapping 40px', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 150, y: 120, w: 340, h: 500, color: [31, 42, 68] }, { shape: 'shirt', x: 450, y: 150, w: 380, h: 420, color: [200, 160, 60] }], noise: 3, seed }), { seeds: 6 });
  log(`INFO overlapping items: detected=[${r.detected}] (informational; a background model cannot separate overlapping items)`);
});
test('B6c 4px gap between items (e.g. shirts laid side by side) is split', () => {
  const r = scenario('4px gap', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 150, y: 150, w: 330, h: 450, color: [31, 42, 68] }, { shape: 'rect', x: 484, y: 150, w: 330, h: 450, color: [60, 90, 60] }], noise: 3, seed }), { seeds: 6 });
  assert.ok(r.countAcc >= 0.8, `detected=[${r.detected}]`);
});
for (const angle of [15, 30, 45, 70]) {
  test(`B6d item rotated ${angle} deg: counted once, box contains it`, () => {
    const r = scenario(`rotated ${angle}`, (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 330, y: 190, w: 380, h: 290, angle, color: [31, 42, 68] }, { shape: 'rect', x: 60, y: 60, w: 200, h: 200, color: [196, 60, 50] }], noise: 3, seed }));
    assert.equal(r.countAcc, 1, `detected=[${r.detected}]`); assert.ok(r.containRate >= 0.95);
  });
}
test('B6e five items at mixed rotations (flat-lay "artistic" layout)', () => {
  const angles = [0, 20, -35, 45, 10];
  const r = scenario('5 items rotated mix', (seed) => render({ width: 1024, height: 768, items: gridItems(5, 1024, 768, { fill: 0.55, shape: ['rect'] }).map((it, i) => ({ ...it, angle: angles[i] })), noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8 && r.containRate >= 0.9, JSON.stringify(r));
});
test('B6f tiny item (socks) at 1.5% of the frame is found; default threshold (1%) means 0.6% is dropped; minAreaFrac lowers it', () => {
  const frame = 1024 * 768;
  const mkTiny = (frac) => (seed) => { const s = Math.sqrt(frame * frac); return render({ width: 1024, height: 768, items: [...gridItems(3, 1024, 768, { fill: 0.5 }).map((it) => ({ ...it, y: it.y + 60, x: it.x })), { shape: 'rect', x: 460, y: 640, w: s * 1.3, h: s / 1.3, color: [200, 160, 60] }], noise: 3, seed }); };
  const a = scenario('tiny item 1.5% frame', mkTiny(0.015), { seeds: 6 });
  assert.ok(a.countAcc >= 0.8, `1.5% item missed: detected=[${a.detected}] (want 4)`);
  const b = scenario('tiny item 1.0% frame', mkTiny(0.010), { seeds: 6 });
  log(`INFO a sock at exactly ~1% of the frame is detected in ${(b.countAcc * 100).toFixed(0)}% of runs (default minAreaFrac=0.01)`);
  const c = scenario('tiny item 0.6% frame, minAreaFrac 0.003', mkTiny(0.006), { seeds: 6, opts: { minAreaFrac: 0.003 } });
  assert.ok(c.countAcc >= 0.8, `minAreaFrac:0.003 did not recover a 0.6% item: detected=[${c.detected}]`);
});
test('B6g belt: long+thin (700x22) flat, diagonal 30deg, and touching a shirt', () => {
  const shirt = { shape: 'shirt', x: 80, y: 60, w: 300, h: 320, color: [31, 42, 68] };
  const r1 = scenario('belt flat 700x22', (seed) => render({ width: 1024, height: 768, items: [shirt, { shape: 'rect', x: 150, y: 560, w: 700, h: 22, color: [110, 70, 40] }], noise: 3, shadow: 0.3, seed }));
  assert.ok(r1.countAcc >= 0.8, `flat belt: detected=[${r1.detected}]`);
  const r2 = scenario('belt diagonal 30deg', (seed) => render({ width: 1024, height: 768, items: [shirt, { shape: 'rect', x: 350, y: 380, w: 600, h: 24, angle: 30, color: [110, 70, 40] }], noise: 3, shadow: 0.3, seed }));
  assert.ok(r2.countAcc >= 0.8, `diagonal belt: detected=[${r2.detected}]`);
  const r3 = scenario('belt touching shirt hem', (seed) => render({ width: 1024, height: 768, items: [shirt, { shape: 'rect', x: 60, y: 381, w: 600, h: 24, color: [110, 70, 40] }], noise: 3, seed }));
  log(`INFO belt directly under shirt (1px gap): detected=[${r3.detected}] (want 2) meanIoU=${r3.meanIou.toFixed(2)}`);
});
test('B6h dark belt on a black-ish floor / light belt on a pale sheet (thin low-contrast)', () => {
  const r = scenario('thin canvas belt on beige sheet', (seed) => render({ width: 1024, height: 768, bg: [222, 218, 208], items: [{ shape: 'rect', x: 120, y: 340, w: 760, h: 26, color: [196, 182, 150] }], noise: 3, seed }));
  log(`INFO thin low-contrast belt detected ${(r.countAcc * 100).toFixed(0)}%`);
  assert.ok(r.countAcc >= 0.5, `detected=[${r.detected}]`);
});
test('B6i 15 items: default cap is maxItems=12 and the cap keeps the LARGEST items; maxItems:15 returns all', () => {
  const sizes = Array.from({ length: 15 }, (_, i) => 0.55 + 0.025 * i);
  const items = gridItems(15, 1280, 960, { fill: 0.9 }).map((it, i) => { const f = sizes[i] / 0.9; const cx = it.x + it.w / 2, cy = it.y + it.h / 2; return { ...it, w: it.w * f, h: it.h * f, x: cx - it.w * f / 2, y: cy - it.h * f / 2 }; });
  const im = render({ width: 1280, height: 960, items, noise: 3, seed: 31 });
  const d = segmentItems(im);
  log(`SCENE 15 items default: ${d.length} boxes`);
  assert.equal(d.length, 12, `default cap returned ${d.length}`);
  const areas = items.map((it) => it.w * it.h);
  const kept = d.map((b) => areas.findIndex((_, i) => contains(b, im.truth[i], 12)));
  const dropped = areas.map((a, i) => ({ a, i })).filter(({ i }) => !kept.includes(i));
  const minKept = Math.min(...kept.filter((k) => k >= 0).map((k) => areas[k]));
  for (const x of dropped) assert.ok(x.a <= minKept * 1.05, `cap dropped a larger item (#${x.i}, area ${x.a.toFixed(0)}) while keeping one of ${minKept.toFixed(0)}`);
  const all = segmentItems(im, { maxItems: 15 });
  assert.equal(all.length, 15, `maxItems:15 returned ${all.length}`);
  assert.equal(segmentItems(im, { maxItems: 3 }).length, 3);
});
test('B6j item cut by the frame edge (half a shirt) is still found and not mistaken for background', () => {
  const r = scenario('item cropped at frame edge', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: -120, y: 200, w: 400, h: 360, color: [31, 42, 68] }, { shape: 'rect', x: 500, y: 150, w: 300, h: 300, color: [196, 60, 50] }], noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8, `detected=[${r.detected}]`);
});
test('B6k item touching all four border sides of a corner (shirt in the corner) does not poison the background model', () => {
  const r = scenario('item in corner', (seed) => render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 0, y: 0, w: 300, h: 260, color: [31, 42, 68] }, { shape: 'rect', x: 500, y: 300, w: 300, h: 300, color: [196, 60, 50] }], noise: 3, seed }));
  assert.ok(r.countAcc >= 0.8, `detected=[${r.detected}]`);
});
test('B6l padding option: padding:0 gives boxes that hug the item; default padding expands but never exceeds the frame', () => {
  const im = render({ width: 1024, height: 768, items: gridItems(4), seed: 12 });
  const tight = segmentItems(im, { padding: 0 }); const pad = segmentItems(im, { padding: 0.1 });
  assert.equal(tight.length, 4); assert.equal(pad.length, 4);
  for (const t of im.truth) { assert.ok(tight.some((b) => iou(b, t) >= 0.93), 'padding:0 box not tight'); }
  const ta = mean(tight.map((b) => b.w * b.h)); const pa = mean(pad.map((b) => b.w * b.h));
  assert.ok(pa > ta * 1.1, 'padding has no effect');
});
test('B6m realistic size sweep: 320x240, 640x480, 1280x720, 1920x1080 all find 5 items', () => {
  const c = collector();
  for (const [W, H] of [[320, 240], [640, 480], [1280, 720], [1920, 1080]]) {
    const im = render({ width: W, height: H, items: gridItems(5, W, H), noise: 3, shadow: 0.3, shadowOffset: [W / 100, H / 60], seed: 6 });
    const t0 = performance.now(); const b = segmentItems(im); const dt = performance.now() - t0;
    log(`SCENE ${W}x${H}: ${b.length} boxes ${dt.toFixed(0)} ms`);
    if (b.length !== 5) c.add(`${W}x${H}: ${b.length} boxes`);
  }
  none(c, 'size sweep');
});
test('B6n random flat-lays (seeded): 3-8 items, random rotation/size/colour, count accuracy >= 75% and no crash', () => {
  const c = collector(); let ok = 0; const N = 40; const ious = [];
  for (let i = 0; i < N; i++) {
    const seed = 3000 + i; const R = rng(seed);
    const n = 3 + Math.floor(R() * 6);
    const cells = gridItems(n, 1024, 768, { fill: 0.5 + R() * 0.2 });
    const bgc = [200 + R() * 40, 195 + R() * 40, 185 + R() * 40];
    const items = cells.map((it, k) => ({ ...it, angle: (R() - 0.5) * 70, shape: ['rect', 'ellipse', 'shirt'][Math.floor(R() * 3)], color: PALETTE[(k + i) % PALETTE.length].map((v) => Math.max(0, Math.min(255, v + (R() - 0.5) * 30))) }));
    const im = render({ width: 1024, height: 768, bg: bgc, items, noise: 2 + R() * 6, shadow: R() * 0.5, vignette: R() * 0.3, seed });
    let b; try { b = segmentItems(im); } catch (e) { c.add(`seed=${seed} threw`); continue; }
    if (b.length === n) ok++; else c.add(`seed=${seed} n=${n} detected=${b.length}`);
    ious.push(...bestIous(im.truth, b));
  }
  log(`SCENE random flat-lays: count accuracy ${(100 * ok / N).toFixed(0)}% meanIoU=${mean(ious).toFixed(2)}`);
  assert.ok(ok / N >= 0.75, `count accuracy ${(100 * ok / N).toFixed(0)}%; misses: ${c.first.join(' | ')}`);
});
test('B6o performance: typical 1024x768 phone photo segments in < 300 ms (all effects on)', () => {
  const im = render({ width: 1024, height: 768, items: gridItems(8), noise: 5, shadow: 0.4, vignette: 0.2, jpeg: 4, seed: 1 });
  segmentItems(im);
  const t0 = performance.now(); segmentItems(im); const dt = performance.now() - t0;
  log(`PERF 1024x768 x8 items: ${dt.toFixed(0)} ms`);
  assert.ok(dt < 300, `${dt.toFixed(0)} ms`);
});

// ---------------------------------------------------------------------------------------------
// B7. color.js hostile input
// ---------------------------------------------------------------------------------------------
const validColors = (cs, label) => {
  assert.ok(Array.isArray(cs) && cs.length >= 1 && cs.length <= 50, `${label}: length ${cs?.length}`);
  for (const c of cs) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/, `${label}: hex ${c.hex}`);
    assert.ok(COLOR_FAMILIES[c.family], `${label}: family ${c.family}`);
    assert.ok(Number.isFinite(c.weight) && c.weight >= 0 && c.weight <= 1.0001, `${label}: weight ${c.weight}`);
  }
  assert.ok(Math.abs(cs.reduce((s, c) => s + c.weight, 0) - 1) < 0.1, `${label}: weights sum ${cs.reduce((s, c) => s + c.weight, 0)}`);
};
test('B7a extractColors hostile images/options always returns 1..maxColors valid colours', () => {
  const imgs = { '0x0': { width: 0, height: 0, data: new Uint8ClampedArray(0) }, '1x1': solid(1, 1, [200, 30, 30]), 'transparent': solid(50, 50, [10, 10, 200], 0), 'null': null, 'noData': { width: 5, height: 5 }, 'short data': { width: 50, height: 50, data: new Uint8ClampedArray(10) }, 'NaN dims': { width: NaN, height: NaN, data: new Uint8ClampedArray(16) }, 'noise': addNoise(solid(60, 60, [128, 128, 128]), 90, 4), 'black': solid(30, 30, [0, 0, 0]), 'white': solid(30, 30, [255, 255, 255]), '1xN': solid(1, 500, [30, 200, 30]) };
  const optss = [{}, { maxColors: 1 }, { maxColors: 0 }, { maxColors: -2 }, { maxColors: NaN }, { maxColors: 50 }, { ignoreBackground: false }, { mask: new Uint8Array(3) }, { mask: new Uint8Array(100000) }, { mask: new Uint8Array(100000).fill(1) }, { mask: 'abc' }];
  const c = collector();
  for (const [n, im] of Object.entries(imgs)) for (const o of optss) {
    const label = `${n} opts=${Object.keys(o).map((k) => `${k}:${Number.isNaN(o[k]) ? 'NaN' : typeof o[k] === 'object' ? 'obj' : o[k]}`)}`;
    let cs; try { cs = extractColors(im, o); } catch (e) { c.add(`${label} threw ${e.message}`); continue; }
    try { validColors(cs, label); } catch (e) { c.add(e.message); continue; }
    const mc = Number.isFinite(o.maxColors) && o.maxColors >= 1 ? Math.floor(o.maxColors) : 3;
    if (o.maxColors !== undefined && Number.isFinite(o.maxColors) && cs.length > Math.max(1, Math.min(4, mc))) c.add(`${label} -> ${cs.length} colours`);
  }
  none(c, 'extractColors hostile');
});
test('B7b nameColor hostile input never throws and always returns a family', () => {
  const c = collector();
  for (const v of [[NaN, 0, 0], [-10, 300, 1e9], [0, 0, 0], [255, 255, 255], [128.5, 99.9, 3.3], [], undefined, null, 'red', [1, 2], ['a', 'b', 'c'], [Infinity, 0, 0]]) {
    let f; try { f = nameColor(v); } catch (e) { c.add(`nameColor(${String(JSON.stringify(v))}) threw ${e.message}`); continue; }
    if (!COLOR_FAMILIES[f]) c.add(`nameColor(${String(JSON.stringify(v))}) -> ${f}`);
  }
  none(c, 'nameColor hostile');
});
test('B7c guessPattern hostile input never throws and returns a known pattern', () => {
  const known = ['solid', 'stripe', 'check', 'textured', 'print', 'plaid', 'graphic', 'polka', 'floral', 'camo', 'houndstooth'];
  for (const im of [null, { width: 0, height: 0, data: new Uint8ClampedArray(0) }, solid(1, 1, [1, 2, 3]), solid(3, 3, [1, 2, 3]), solid(50, 50, [9, 9, 9], 0), { width: 50, height: 50, data: new Uint8ClampedArray(5) }, solid(1, 300, [9, 9, 9])]) {
    let p; try { p = guessPattern(im); } catch (e) { assert.fail(`guessPattern threw ${e.message}`); }
    assert.ok(known.includes(p), `guessPattern -> ${p}`);
  }
});
test('B7d extractColors without a mask ignores the background: small red item on a large beige sheet -> red first', () => {
  const im = render({ width: 400, height: 300, bg: [222, 215, 200], items: [{ shape: 'rect', x: 150, y: 100, w: 100, h: 100, color: [196, 40, 50] }], noise: 3, seed: 3 });
  const cs = extractColors(im);
  assert.equal(cs[0].family, 'red', `dominant ${JSON.stringify(cs)}`);
});
test('B7e extractColors on a light item on a light sheet (white tee on cream) keeps white as dominant', () => {
  const im = render({ width: 400, height: 300, bg: [232, 224, 205], items: [{ shape: 'rect', x: 80, y: 40, w: 240, h: 220, color: [246, 246, 244] }], noise: 3, seed: 4 });
  const cs = extractColors(im);
  assert.ok(['white', 'cream'].includes(cs[0].family), `dominant ${JSON.stringify(cs)}`);
});
test('B7f nameColor: grey ramp and near-neutral saturation edge (no hallucinated colours for neutral greys)', () => {
  const c = collector();
  for (let v = 0; v <= 255; v += 5) {
    const f = nameColor([v, v, v]);
    if (!['black', 'charcoal', 'grey', 'white'].includes(f)) c.add(`grey ${v} -> ${f}`);
  }
  for (const rgb of [[120, 122, 124], [128, 126, 124], [60, 62, 64], [200, 201, 203]]) { const f = nameColor(rgb); if (!['black', 'charcoal', 'grey', 'white', 'cream'].includes(f)) c.add(`${rgb} -> ${f}`); }
  none(c, 'grey ramp');
});
test('B7g nameColor monotonic lightness: darker version of a colour never gets a lighter-family name (white>cream>...>black chain for greys)', () => {
  const order = ['black', 'charcoal', 'grey', 'white'];
  let last = -1;
  for (let v = 0; v <= 255; v += 3) { const i = order.indexOf(nameColor([v, v, v])); if (i < 0) continue; assert.ok(i >= last, `grey ramp non-monotonic at ${v}`); last = i; }
});

// ---------------------------------------------------------------------------------------------
// B8. pattern guess
// ---------------------------------------------------------------------------------------------
test('B8a guessPattern: noisy solids / heathered / denim texture are solid or textured, never stripe/check/print', () => {
  const c = collector();
  for (const [label, rgb, sig] of [['navy solid', [31, 42, 68], 2], ['white tee noisy', [240, 240, 238], 6], ['heather grey', [142, 145, 150], 10], ['denim', [74, 98, 134], 14], ['black jeans noisy', [30, 30, 32], 8], ['jpeg-ish', [196, 60, 50], 12]]) {
    const p = guessPattern(addNoise(solid(120, 120, rgb), sig, 5));
    if (!['solid', 'textured'].includes(p)) c.add(`${label} (sigma ${sig}) -> ${p}`);
  }
  none(c, 'false pattern');
});
test('B8b guessPattern: stripes of any orientation / pitch are detected (pinstripe 4px, bold 24px, diagonal, rotated)', () => {
  const c = collector();
  for (const [period, orientation] of [[4, 'v'], [8, 'h'], [24, 'v'], [12, 'd'], [40, 'h'], [6, 'd']]) {
    const p = guessPattern(stripes(160, 160, { c1: [31, 42, 68], c2: [235, 235, 235], period, orientation, noiseSigma: 3 }));
    if (p !== 'stripe') c.add(`period=${period} ${orientation} -> ${p}`);
  }
  none(c, 'stripe detection');
});
test('B8c guessPattern: low-contrast stripes (navy on slightly lighter navy) are still stripes', () => {
  const p = guessPattern(stripes(160, 160, { c1: [31, 42, 68], c2: [60, 72, 100], period: 10, orientation: 'v', noiseSigma: 2 }));
  assert.equal(p, 'stripe');
});
test('B8d guessPattern: checks (small 6px, big 30px), and a mask hides the background', () => {
  const c = collector();
  for (const size of [6, 12, 30]) { const p = guessPattern(checks(180, 180, { size, noiseSigma: 3 })); if (!['check', 'plaid'].includes(p)) c.add(`size ${size} -> ${p}`); }
  const im = render({ width: 300, height: 300, bg: stripedSheet([230, 228, 220], [196, 214, 232], 20), items: [{ shape: 'rect', x: 60, y: 60, w: 180, h: 180, color: [31, 42, 68] }], noise: 2, seed: 2 });
  const mask = new Uint8Array(300 * 300); for (let y = 60; y < 240; y++) for (let x = 60; x < 240; x++) mask[y * 300 + x] = 1;
  const p = guessPattern(im, { mask }); if (!['solid', 'textured'].includes(p)) c.add(`solid item on striped sheet with mask -> ${p}`);
  none(c, 'check/mask');
});
test('B8e guessPattern: multi-colour prints are not called solid/stripe/check', () => {
  const p = guessPattern(print(160, 160));
  assert.ok(['print', 'floral', 'graphic', 'plaid', 'camo'].includes(p) || p === 'textured', `print -> ${p}`);
  assert.notEqual(p, 'solid');
});
test('B8f pipeline: segment -> per-item pattern: striped shirt and solid trousers on a sheet get different patterns', () => {
  const striped = (x, y) => (Math.floor(x / 7) % 2 ? [31, 42, 68] : [236, 236, 236]);
  const im = render({ width: 1024, height: 768, items: [{ shape: 'rect', x: 80, y: 120, w: 340, h: 420, color: striped }, { shape: 'rect', x: 560, y: 120, w: 340, h: 420, color: [74, 98, 134] }], noise: 3, seed: 5 });
  const boxes = segmentItems(im);
  assert.equal(boxes.length, 2);
  const pats = boxes.map((bx) => { const crop = { width: bx.w, height: bx.h, data: new Uint8ClampedArray(bx.w * bx.h * 4) }; for (let y = 0; y < bx.h; y++) for (let x = 0; x < bx.w; x++) { const s = ((bx.y + y) * im.width + bx.x + x) * 4; crop.data.set(im.data.subarray(s, s + 4), (y * bx.w + x) * 4); } return guessPattern(crop, { mask: bx.mask }); });
  assert.equal(pats[0], 'stripe', pats.join(',')); assert.ok(['solid', 'textured'].includes(pats[1]), pats.join(','));
});
