import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentItems } from '../../src/vision/segment.js';
import { flatLay, standardItems, solid, blank, noise } from './fixtures/synth.js';

const contains = (box, t, tol = 3) => box.x <= t.x + tol && box.y <= t.y + tol && box.x + box.w >= t.x + t.w - tol && box.y + box.h >= t.y + t.h - tol;
const BG = [225, 222, 215];

for (const n of [3, 5, 6]) {
  test(`segment: ${n} items, clean`, () => {
    const im = flatLay({ items: standardItems(n) });
    const r = segmentItems(im);
    assert.equal(r.length, n);
    for (const t of im.truth) assert.ok(r.some((b) => contains(b, t)), `no box contains ${JSON.stringify(t)}`);
  });
  test(`segment: ${n} items with gradient + vignette + noise + shadows`, () => {
    const im = flatLay({ items: standardItems(n), gradient: 0.25, vignette: 0.15, noise: 6, shadow: 0.4 });
    const r = segmentItems(im);
    assert.equal(r.length, n, JSON.stringify(r.map(({ x, y, w, h }) => [x, y, w, h])));
    for (const t of im.truth) assert.ok(r.some((b) => contains(b, t, 6)), `no box contains ${JSON.stringify(t)}`);
    // boxes do not balloon because of shadows
    for (const b of r) assert.ok(b.w < 400 && b.h < 400);
  });
}

test('segment: dark floor with light shirts, strong noise', () => {
  const im = flatLay({ bg: [50, 48, 46], items: standardItems(5).map((it, i) => ({ ...it, color: [[240, 240, 235], [200, 190, 150], [150, 190, 220], [230, 120, 130], [240, 240, 240]][i] })), noise: 8, gradient: 0.3, shadow: 0.5 });
  assert.equal(segmentItems(im).length, 5);
});

test('segment: coloured sheet', () => {
  const im = flatLay({ bg: [120, 150, 190], items: standardItems(4).map((it) => ({ ...it, color: [235, 235, 232] })), noise: 5, shadow: 0.35, gradient: 0.2 });
  assert.equal(segmentItems(im).length, 4);
});

test('segment: a long thin belt survives morphology', () => {
  const im = flatLay({ items: standardItems(3, { belt: true }), noise: 5, shadow: 0.3, gradient: 0.15 });
  const r = segmentItems(im);
  assert.equal(r.length, 4);
  const belt = im.truth[3];
  const hit = r.find((b) => contains(b, belt, 6));
  assert.ok(hit, 'belt box missing');
  assert.ok(hit.w / hit.h > 5, `belt box ${hit.w}x${hit.h}`);
  // thin belt (22px) too
  const thin = flatLay({ items: [...standardItems(3), { shape: 'rect', x: 120, y: 600, w: 760, h: 22, color: [60, 40, 30] }] });
  assert.equal(segmentItems(thin).length, 4);
});

test('segment: masks mark item pixels and match box size', () => {
  const items = standardItems(3);
  const im = flatLay({ items, noise: 4, shadow: 0.3 });
  const r = segmentItems(im);
  for (const b of r) {
    assert.equal(b.mask.length, b.w * b.h);
    assert.equal(b.mask.reduce((s, v) => s + v, 0), b.area);
  }
  // first (top-left) item is a 260x280 rect: mask covers it almost fully
  const b = r[0];
  assert.ok(b.area > 0.93 * 260 * 280 && b.area < 1.1 * 260 * 280, `area ${b.area}`);
  assert.equal(b.mask[Math.floor(b.h / 2) * b.w + Math.floor(b.w / 2)], 1);
  assert.equal(b.mask[0], 0); // padded corner is not item
});

test('segment: sorted top-left to bottom-right, tolerant of row jitter', () => {
  const r = segmentItems(flatLay({ items: standardItems(6) }));
  const rows = r.map((b) => b.y > 300 ? 1 : 0);
  assert.deepEqual(rows, [0, 0, 0, 1, 1, 1]);
  assert.ok(r[0].x < r[1].x && r[1].x < r[2].x && r[3].x < r[4].x && r[4].x < r[5].x);
  // slightly staggered tops in a row must still read left to right
  const items = standardItems(3);
  items[1].y += 40; items[2].y -= 30;
  const s = segmentItems(flatLay({ items }));
  assert.deepEqual(s.map((b) => Math.round(b.x / 100)), [...s.map((b) => Math.round(b.x / 100))].sort((a, b) => a - b));
});

test('segment: padding, clamping, maxItems, minAreaFrac', () => {
  const items = standardItems(5);
  const im = flatLay({ items });
  const p0 = segmentItems(im, { padding: 0 }), p1 = segmentItems(im, { padding: 0.1 });
  assert.ok(p1[0].w > p0[0].w + 20);
  for (const b of p1) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1024 && b.y + b.h <= 768);
  const edge = segmentItems(flatLay({ items: [{ shape: 'rect', x: 0, y: 0, w: 300, h: 300, color: [20, 20, 20] }] }), { padding: 0.2 });
  assert.equal(edge[0].x, 0); assert.equal(edge[0].y, 0);
  assert.equal(segmentItems(im, { maxItems: 2 }).length, 2);
  assert.equal(segmentItems(im, { minAreaFrac: 0.2 }).length, 0);
});

test('segment: small fragment next to a big item merges (sleeve / button)', () => {
  const items = [
    { shape: 'rect', x: 300, y: 200, w: 400, h: 350, color: [31, 42, 68] },
    { shape: 'rect', x: 712, y: 300, w: 16, h: 16, color: [31, 42, 68] }, // detached button, 12px from the shirt
  ];
  assert.equal(segmentItems(flatLay({ items, noise: 3 })).length, 1);
});

test('segment: touching items merge into one box (documented limitation)', () => {
  const items = [
    { shape: 'rect', x: 200, y: 200, w: 300, h: 300, color: [31, 42, 68] },
    { shape: 'rect', x: 500, y: 200, w: 300, h: 300, color: [196, 60, 50] },
  ];
  assert.equal(segmentItems(flatLay({ items })).length, 1);
});

test('segment: blank / uniform / transparent images -> []', () => {
  assert.deepEqual(segmentItems(solid(640, 480, BG)), []);
  assert.deepEqual(segmentItems(flatLay({ noise: 5, gradient: 0.3, vignette: 0.2, shadow: 0 })), []);
  assert.deepEqual(segmentItems(blank(300, 300)), []);
});

test('segment: item filling the frame -> one full-frame box', () => {
  const im = flatLay({ width: 800, height: 600, items: [{ shape: 'rect', x: 20, y: 15, w: 760, h: 570, color: [93, 97, 54] }], noise: 3 });
  const r = segmentItems(im);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].x, r[0].y, r[0].w, r[0].h], [0, 0, 800, 600]);
  assert.equal(r[0].mask.length, 800 * 600);
});

test('segment: white shirt on a white sheet does not crash (low contrast)', () => {
  const items = standardItems(3).map((it) => ({ ...it, color: [243, 243, 240] }));
  const r = segmentItems(flatLay({ items, noise: 3, bg: [238, 238, 236] }));
  assert.ok(Array.isArray(r) && r.length <= 3);
  const r2 = segmentItems(flatLay({ items, noise: 3, bg: [225, 222, 215], shadow: 0.3 }));
  assert.ok(Array.isArray(r2));
});

test('segment: performance 1024x768 under 400ms', () => {
  const im = flatLay({ items: standardItems(6), gradient: 0.25, vignette: 0.15, noise: 6, shadow: 0.4 });
  segmentItems(im); // warm up
  const times = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); segmentItems(im); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  console.log(`segment 1024x768 median ${times[2].toFixed(0)}ms (max ${times[4].toFixed(0)}ms)`);
  assert.ok(times[2] < 400, `${times[2]}ms`);
  const big = flatLay({ width: 2000, height: 1500, items: standardItems(5).map((i) => ({ ...i, x: i.x * 2, y: i.y * 2, w: i.w * 2, h: i.h * 2 })) });
  const t = performance.now(); segmentItems(big);
  console.log(`segment 2000x1500 ${(performance.now() - t).toFixed(0)}ms`);
});

test('segment: degenerate inputs never throw', () => {
  const imgs = [null, undefined, {}, { width: 0, height: 0, data: new Uint8ClampedArray(0) }, solid(1, 1, [1, 2, 3]),
    solid(3, 500, [9, 9, 9]), solid(500, 3, [9, 9, 9]), noise(64, 64), noise(500, 400, 2), { width: 10, height: 10, data: new Uint8ClampedArray(8) }];
  for (const im of imgs) assert.ok(Array.isArray(segmentItems(im)));
  assert.ok(Array.isArray(segmentItems(solid(100, 100, [1, 2, 3]), { minAreaFrac: NaN, maxItems: -3, padding: 'x' })));
});
