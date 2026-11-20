import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSkin, guessContrast, segmentPortrait } from '../../src/vision/skin.js';
import { rgbToLab } from '../../src/vision/color.js';
import { solid, addNoise } from './fixtures/synth.js';

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Monk skin tone scale swatches 1..10
const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
const ELL = { cx: 200, cy: 220, rx: 100, ry: 130 };

/** Synthetic selfie: wall, shoulders (shirt), hair cap on top of the oval, skin oval with eyes, brows and mouth. */
function selfie({ skin, wall = [200, 205, 215], hair = [30, 22, 18], shirt = [60, 80, 120], tint = [1, 1, 1], noise = 3 }) {
  const W = 400, H = 480, im = solid(W, H, wall);
  const set = (x, y, c) => { const i = (y * W + x) * 4; im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x - ELL.cx) / ELL.rx, ny = (y - ELL.cy) / ELL.ry;
    const d = nx * nx + ny * ny;
    if (y > 380 && Math.abs(x - 200) < 170) set(x, y, shirt);                       // shoulders
    if (y > 330 && Math.abs(x - 200) < 45) set(x, y, skin);                          // neck
    if (d <= 1.15 && ny < -0.45) set(x, y, hair);                                    // hair at top
    else if (d <= 1) set(x, y, skin);
    if (d <= 1) {
      const ex = Math.abs(nx);
      if (Math.abs(ny + 0.12) < 0.05 && ex > 0.25 && ex < 0.5) set(x, y, [25, 20, 18]);   // eyes
      if (Math.abs(ny + 0.22) < 0.03 && ex > 0.22 && ex < 0.55) set(x, y, hair);           // brows
      if (Math.abs(ny - 0.5) < 0.05 && ex < 0.28) set(x, y, [150, 60, 70]);                // mouth
    }
  }
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) im.data[i * 4 + c] = Math.min(255, im.data[i * 4 + c] * tint[c]);
  return noise ? addNoise(im, noise, 9) : im;
}
const hue = (lab) => Math.atan2(lab[2], lab[1]) * 180 / Math.PI;

test('analyzeSkin: Monk 1-10 give monotonic lightness, correct depth bucket and a close hex', () => {
  let last = 101;
  MONK.forEach((hex, i) => {
    const r = analyzeSkin(selfie({ skin: hexRgb(hex) }), ELL);
    assert.ok(r, `monk ${i + 1} returned null`);
    assert.ok(r.lab[0] < last + 1.5, `monk ${i + 1} not darker than previous`); last = r.lab[0];
    const want = i <= 4 ? 'light' : i <= 6 ? 'medium' : 'deep';
    assert.equal(r.depth, want, `monk ${i + 1} L=${r.lab[0].toFixed(1)}`);
    const t = rgbToLab(...hexRgb(hex));
    assert.ok(Math.hypot(r.lab[0] - t[0], r.lab[1] - t[1], r.lab[2] - t[2]) < 6, `monk ${i + 1} sampled ${r.hex} vs ${hex}`);
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });
});
test('analyzeSkin: warm vs cool variants of the same depth', () => {
  const cool = analyzeSkin(selfie({ skin: [214, 164, 150] }), ELL), warm = analyzeSkin(selfie({ skin: [218, 168, 110] }), ELL);
  assert.equal(cool.undertoneGuess, 'cool', `hue ${hue(cool.lab).toFixed(0)}`);
  assert.equal(warm.undertoneGuess, 'warm', `hue ${hue(warm.lab).toFixed(0)}`);
  assert.ok(hue(cool.lab) < hue(warm.lab));
});
test('analyzeSkin: hair at the top, eyes, brows and mouth do not drag the sample', () => {
  const a = analyzeSkin(selfie({ skin: hexRgb('#a07e56') }), ELL), b = analyzeSkin(selfie({ skin: hexRgb('#a07e56'), hair: [240, 230, 200] }), ELL);
  assert.ok(Math.abs(a.lab[0] - b.lab[0]) < 2);
});
test('analyzeSkin: warm tint is corrected by whitePoint (and confidence is higher with it)', () => {
  const tint = [1.15, 1, 0.85], skin = hexRgb('#d7bd96');
  const im = selfie({ skin, tint, wall: [205, 205, 205] });
  const raw = analyzeSkin(im, ELL), fixed = analyzeSkin(im, { ...ELL, whitePoint: [205 * 1.15, 205, 205 * 0.85] });
  const t = rgbToLab(...skin);
  const err = (r) => Math.hypot(r.lab[1] - t[1], r.lab[2] - t[2]);
  assert.ok(err(fixed) < err(raw) && err(fixed) < 8, `raw ${err(raw).toFixed(1)} fixed ${err(fixed).toFixed(1)}`);
  assert.ok(fixed.confidence > raw.confidence);
});
test('analyzeSkin: background only, blank and hostile input -> null, never throws', () => {
  assert.equal(analyzeSkin(solid(400, 480, [200, 205, 215]), ELL), null);
  assert.equal(analyzeSkin(solid(400, 480, [20, 20, 20]), ELL), null);
  assert.equal(analyzeSkin(solid(400, 480, [30, 90, 200]), ELL), null);
  for (const im of [null, undefined, {}, { width: 5, height: 5, data: new Uint8ClampedArray(4) }, solid(4, 4, [200, 150, 120])]) assert.equal(analyzeSkin(im, ELL), null);
  assert.doesNotThrow(() => analyzeSkin(selfie({ skin: [200, 160, 130] }), { cx: NaN, cy: -5, rx: 0, ry: 'x' }));
});
test('guessContrast: dark hair on light skin is high, deep skin + black hair is low, light hair on light skin is lower', () => {
  const light = selfie({ skin: hexRgb('#f3e7db') }), s1 = analyzeSkin(light, ELL);
  assert.equal(guessContrast(light, ELL, s1.lab), 'high');
  const deep = selfie({ skin: hexRgb('#3a312a'), hair: [18, 14, 12] }), s2 = analyzeSkin(deep, ELL);
  assert.equal(guessContrast(deep, ELL, s2.lab), 'low');
  const blond = selfie({ skin: hexRgb('#f3e7db'), hair: [225, 205, 160] }), s3 = analyzeSkin(blond, ELL);
  assert.notEqual(guessContrast(blond, ELL, s3.lab), 'high');
  assert.equal(guessContrast(null, ELL, null), 'medium');
});
test('segmentPortrait: keeps the person (face + shoulders), drops the wall, mask matches box', () => {
  const im = selfie({ skin: hexRgb('#a07e56') });
  const r = segmentPortrait(im, ELL);
  assert.ok(r && r.mask.length === r.w * r.h);
  const at = (x, y) => r.mask[(y - r.y) * r.w + (x - r.x)];
  assert.equal(at(200, 220), 1); assert.equal(at(200, 440), 1);
  assert.ok(r.x > 5 && r.y > 5, `box swallowed the wall: ${r.x},${r.y}`);
  assert.equal(segmentPortrait(null, ELL), null);
});
