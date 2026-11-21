// Plaid / flannel garments must survive background removal: a close-up or a busy pattern must not carve the shirt away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentItems, maskQuality, segmentCrop } from '../../src/vision/segment.js';
import { plaidScene, downsample, score, PLAIDS } from './fixtures/plaid.js';

const cache = new Map();
function scene(key, opts) {
  if (!cache.has(key)) { const im = downsample(plaidScene(opts), 4); cache.set(key, im); }
  return cache.get(key);
}
function run(key, opts) {
  const im = scene(key, opts);
  const dets = segmentItems(im, {});
  return { im, dets, sc: score(im, im.truth[0].mask, dets) };
}
const fmt = (sc) => `coverage ${sc.coverage.toFixed(2)} iou ${sc.iou.toFixed(2)}`;

const PLAID_NAMES = ['buffalo', 'tartan', 'gingham', 'flannel'];
const BGS = ['whiteSheet', 'beigeCarpet', 'woodFloor', 'darkFloor', 'stripedSheet'];

// ---- flat lay with margins: tight mask on the whole shirt ----
for (const bg of BGS) {
  for (const plaid of PLAID_NAMES) {
    test(`plaid flat-lay: ${plaid} on ${bg}`, () => {
      const { dets, sc } = run(`flat-${bg}-${plaid}`, { bg, plaid });
      assert.ok(sc.coverage >= 0.9 && sc.iou >= 0.85, fmt(sc));
      assert.equal(dets.length, 1, `expected one item, got ${dets.length}`);
    });
  }
}

// ---- close-ups: the shirt fills the frame and touches 2-4 edges; keep nearly all of it ----
const CLOSE = { close1: { size: [900, 820], cy: 400, rot: 5 }, close2: { size: [1100, 1000], cy: 420, rot: 4 }, close3: { size: [1300, 1000], cy: 384, rot: -8 } };
for (const [cn, o] of Object.entries(CLOSE)) {
  for (const bg of ['whiteSheet', 'woodFloor', 'darkFloor', 'stripedSheet']) {
    for (const plaid of PLAID_NAMES) {
      test(`plaid close-up (${cn}): ${plaid} on ${bg}`, () => {
        const { sc } = run(`${cn}-${bg}-${plaid}`, { bg, plaid, ...o });
        assert.ok(sc.coverage >= 0.85, fmt(sc));
      });
    }
  }
}

// ---- colors close to the background ----
test('plaid: gray gingham on a gray floor keeps the shirt (or boxes the whole thing)', () => {
  const { sc } = run('gray-gray', { bg: 'grayFloor', plaid: 'gingham' });
  assert.ok(sc.coverage >= 0.85, fmt(sc));
});
test('plaid: brown flannel on a wood floor', () => {
  const { sc } = run('wood-flannel', { bg: 'woodFloor', plaid: 'flannel', size: [520, 500], rot: -10 });
  assert.ok(sc.coverage >= 0.9 && sc.iou >= 0.8, fmt(sc));
});
test('plaid: tilted buffalo check on a dark floor', () => {
  const { sc } = run('tilt-dark', { bg: 'darkFloor', plaid: 'buffalo', rot: 25, size: [500, 480] });
  assert.ok(sc.coverage >= 0.9 && sc.iou >= 0.85, fmt(sc));
});

// ---- multi-item: plaid shirt beside solid pants and a solid tee ----
for (const [bg, plaid] of [['whiteSheet', 'buffalo'], ['woodFloor', 'flannel'], ['beigeCarpet', 'tartan'], ['darkFloor', 'tartan']]) {
  test(`plaid + solid items still split: ${plaid} shirt on ${bg}`, () => {
    const opts = {
      bg, plaid, cx: 300, cy: 380, size: [420, 400], rot: 5,
      others: [
        { x: 600, y: 60, w: 160, h: 340, color: [34, 48, 84] },      // pants
        { x: 560, y: 470, w: 330, h: 230, color: [196, 150, 60] },   // tee
      ],
    };
    const im = scene(`multi-${bg}-${plaid}`, opts);
    const dets = segmentItems(im, {});
    assert.equal(dets.length, 3, `expected 3 items, got ${dets.length}`);
    const shirt = score(im, im.truth[0].mask, dets);
    assert.ok(shirt.coverage >= 0.9 && shirt.iou >= 0.8, 'shirt: ' + fmt(shirt));
    for (const k of [1, 2]) {
      const s = score(im, im.truth[k].mask, dets);
      assert.ok(s.coverage >= 0.9 && s.iou >= 0.85, `solid ${k}: ` + fmt(s));
    }
  });
}

// ---- crop path (the review step re-segments an edited box) ----
for (const plaid of PLAID_NAMES) {
  test(`segmentCrop: tight crop of ${plaid} on a wood floor keeps the shirt`, () => {
    const s = scene(`crop-${plaid}`, { bg: 'woodFloor', plaid, size: [600, 560] });
    const t = s.truth[0].mask;
    let x0 = s.width, y0 = s.height, x1 = 0, y1 = 0;
    for (let p = 0; p < t.length; p++) if (t[p]) { const x = p % s.width, y = (p - x) / s.width; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4), truth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * s.width + x0 + x) * 4, o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) data[o + k] = s.data[i + k];
      truth[y * w + x] = t[(y0 + y) * s.width + x0 + x];
    }
    const crop = { width: w, height: h, data };
    const r = segmentCrop(crop);
    assert.ok(r && r.mask && r.mask.length === w * h);
    let inter = 0, tt = 0;
    for (let p = 0; p < w * h; p++) { tt += truth[p]; inter += truth[p] & r.mask[p]; }
    assert.ok(inter / tt >= 0.9, `coverage ${(inter / tt).toFixed(2)}`);
  });
}

// ---- quality metric ----
test('maskQuality: solid blob is confident, carved or empty masks are not', () => {
  const w = 100, h = 80;
  const solid = new Uint8Array(w * h);
  for (let y = 10; y < 70; y++) for (let x = 15; x < 85; x++) solid[y * w + x] = 1;
  assert.ok(maskQuality(solid, w, h).ok);
  const carved = solid.slice();
  for (let y = 10; y < 70; y++) for (let x = 15; x < 85; x++) if ((Math.floor(x / 5) + Math.floor(y / 5)) % 2) carved[y * w + x] = 0;
  assert.equal(maskQuality(carved, w, h).ok, false);
  const frag = new Uint8Array(w * h);
  for (let k = 0; k < 8; k++) for (let y = 5 + k * 8; y < 10 + k * 8; y++) for (let x = 5; x < 95; x++) frag[y * w + x] = 1;
  assert.equal(maskQuality(frag, w, h).ok, false);
  assert.equal(maskQuality(new Uint8Array(w * h), w, h).ok, false);
  assert.equal(maskQuality(new Uint8Array(w * h).fill(1), w, h).ok, true); // full box = "keep it all"
});

test('plaid: performance stays flat for a 4000x3000 photo', () => {
  const im = plaidScene({ W: 1024, H: 768, bg: 'woodFloor', plaid: 'flannel' });
  // upscale nearest to 4000x3000
  const W = 4000, H = 3000, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) { const sy = Math.floor(y * 768 / H); for (let x = 0; x < W; x++) { const i = (sy * 1024 + Math.floor(x * 1024 / W)) * 4, o = (y * W + x) * 4; data[o] = im.data[i]; data[o + 1] = im.data[i + 1]; data[o + 2] = im.data[i + 2]; data[o + 3] = 255; } }
  const t0 = performance.now();
  const dets = segmentItems({ width: W, height: H, data }, {});
  const ms = performance.now() - t0;
  assert.ok(dets.length >= 1);
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});
