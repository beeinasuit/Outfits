import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWearing, normalizeGuide, DEFAULT_GUIDE } from '../../src/vision/wearing.js';
import { COLOR_FAMILIES } from '../../src/model.js';
import { rgbToLab, deltaE2000 } from '../../src/vision/color.js';
import { makeScene, WARM } from './fixtures/person-scene.js';

const F = (n) => COLOR_FAMILIES[n].hex;
const fam = (r, band) => r.bands[band].colors[0].family;
const hexLab = (h) => rgbToLab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const close = (a, b) => deltaE2000(hexLab(a), hexLab(b)) < 22;

test('plain wall: top, bottom and shoes land in the right color families', () => {
  const r = analyzeWearing(makeScene({ seed: 3, top: F('navy'), pants: F('charcoal'), shoes: F('black') }));
  assert.equal(r.ok, true);
  assert.equal(fam(r, 'top'), 'navy');
  assert.equal(fam(r, 'bottom'), 'charcoal');
  assert.equal(fam(r, 'shoes'), 'black');
  assert.equal(r.bands.layer, undefined, 'no layer on a plain shirt');
  for (const b of ['top', 'bottom', 'shoes']) { assert.equal(r.bands[b].pattern, 'solid'); assert.ok(r.bands[b].confidence > 0.5); }
  assert.ok(r.person.w > 0.2 && r.person.h > 0.6);
});

test('bright colors: red top, denim jeans, white sneakers (shadowed white may read as light gray)', () => {
  const r = analyzeWearing(makeScene({ seed: 4, top: F('red'), pants: F('denim'), shoes: F('white') }));
  assert.equal(fam(r, 'top'), 'red');
  assert.equal(fam(r, 'bottom'), 'denim');
  assert.ok(['white', 'gray'].includes(fam(r, 'shoes')));
});

test('warm indoor lighting on an off-white wall is corrected: white tee stays white, not yellow', () => {
  const r = analyzeWearing(makeScene({ seed: 5, bg: '#f1efe9', cast: WARM, top: F('white'), pants: F('denim'), shoes: F('brown') }));
  assert.ok(['white', 'cream'].includes(fam(r, 'top')), `got ${fam(r, 'top')}`);
  assert.ok(['denim', 'blue', 'navy'].includes(fam(r, 'bottom')), `got ${fam(r, 'bottom')}`);
  assert.equal(fam(r, 'shoes'), 'brown');
});

test('warm cast with olive top and khaki pants', () => {
  const r = analyzeWearing(makeScene({ seed: 6, cast: WARM, top: F('olive'), pants: F('beige'), shoes: F('brown') }));
  assert.equal(fam(r, 'top'), 'olive');
  assert.ok(['beige', 'cream', 'mustard'].includes(fam(r, 'bottom')), `got ${fam(r, 'bottom')}`);
});

test('cluttered background (shelves, posters): primary colors still correct', () => {
  for (const seed of [1, 2, 3]) {
    const r = analyzeWearing(makeScene({ seed, bg: 'clutter', top: F('mustard'), pants: F('navy'), shoes: F('black') }));
    assert.equal(r.ok, true);
    assert.equal(fam(r, 'top'), 'mustard');
    assert.equal(fam(r, 'bottom'), 'navy');
    assert.ok(close(r.bands.shoes.colors[0].hex, F('black')));
  }
});

test('vignette + warm light + burgundy sweater', () => {
  const r = analyzeWearing(makeScene({ seed: 8, vignette: true, cast: WARM, top: F('burgundy'), pants: F('denim'), shoes: F('brown') }));
  assert.equal(fam(r, 'top'), 'burgundy');
});

test('open jacket: the layer is the outer color, the top is the shirt showing through', () => {
  const r = analyzeWearing(makeScene({ seed: 9, top: F('white'), layer: F('navy'), pants: F('charcoal'), shoes: F('black') }));
  assert.ok(r.bands.layer, 'layer detected');
  assert.equal(fam(r, 'layer'), 'navy');
  assert.ok(['white', 'cream', 'gray'].includes(fam(r, 'top')), `top was ${fam(r, 'top')}`);
});

test('open jacket on a cluttered background is still found', () => {
  const r = analyzeWearing(makeScene({ seed: 2, bg: 'clutter', top: F('white'), layer: F('forest'), pants: F('charcoal'), shoes: F('black') }));
  assert.ok(r.bands.layer);
  assert.ok(['forest', 'green', 'olive'].includes(fam(r, 'layer')), `layer ${fam(r, 'layer')}`);
});

test('shorts: bare legs are not read as the pants color', () => {
  const r = analyzeWearing(makeScene({ seed: 11, shorts: true, top: F('green'), pants: F('navy'), shoes: F('white') }));
  assert.equal(fam(r, 'bottom'), 'navy');
});

test('deep and light skin tones do not confuse the top', () => {
  for (const skin of ['#5a3a28', '#8d5a3b', '#f1c9a5']) {
    const r = analyzeWearing(makeScene({ seed: 12, skin, top: F('beige'), pants: F('navy'), shoes: F('black') }));
    assert.ok(['beige', 'cream', 'brown'].includes(fam(r, 'top')), `skin ${skin} top ${fam(r, 'top')}`);
    assert.equal(fam(r, 'bottom'), 'navy');
  }
});

test('striped top is flagged as a pattern', () => {
  const r = analyzeWearing(makeScene({ seed: 13, top: F('white'), stripes: F('navy'), pants: F('denim'), shoes: F('black') }));
  assert.notEqual(r.bands.top.pattern, 'solid');
});

test('a moved guide is honored; a nonsense guide is repaired, never thrown', () => {
  const a = analyzeWearing(makeScene({ seed: 14, top: F('teal'), pants: F('black'), shoes: F('white') }), { guide: { neck: 0.22, waist: 0.46, hem: 0.85, ankle: 0.9 } });
  assert.equal(a.ok, true);
  assert.equal(fam(a, 'top'), 'teal');
  for (const g of [null, {}, { neck: NaN, waist: 'x', hem: -3, ankle: 9 }, { neck: 0.9, waist: 0.1, hem: 0.2, ankle: 0.3 }]) {
    const r = analyzeWearing(makeScene({ seed: 14, top: F('teal'), pants: F('black'), shoes: F('white') }), { guide: g });
    assert.equal(typeof r.ok, 'boolean');
    const n = normalizeGuide(g);
    assert.ok(n.neck < n.waist && n.waist < n.hem && n.hem <= n.ankle && n.ankle <= 0.97 && n.neck > 0);
  }
  assert.deepEqual(normalizeGuide(undefined), DEFAULT_GUIDE);
});

test('bad input returns ok:false with a friendly reason and never throws', () => {
  const bad = [undefined, null, 5, {}, { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    { width: 10, height: 10, data: new Uint8ClampedArray(10) },
    { width: 20, height: 40, data: new Uint8ClampedArray(20 * 40 * 4).fill(128) }, // tiny
    { width: 240, height: 400, data: new Uint8ClampedArray(240 * 400 * 4).fill(200) }, // blank
    { width: 400, height: 240, data: makeScene({ W: 400, H: 240 }).data }, // sideways
  ];
  for (const im of bad) {
    const r = analyzeWearing(im, { guide: {} });
    assert.equal(r.ok, false);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 8);
    assert.deepEqual(r.bands, {});
  }
});

test('an empty room (no person) is rejected', () => {
  const r = analyzeWearing(makeScene({ seed: 15, empty: true }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /spot you|photo/i);
});

test('accuracy over a randomized batch of outfits, rooms and lighting', () => {
  let seed = 7; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(R() * a.length)];
  const fams = Object.keys(COLOR_FAMILIES);
  let n = 0, hit = 0, ok = 0, N = 60;
  for (let i = 0; i < N; i++) {
    const top = pick(fams), pants = pick(fams.filter((f) => f !== 'white' && f !== 'cream')), shoes = pick(['black', 'brown', 'white']);
    const r = analyzeWearing(makeScene({ seed: 100 + i, bg: pick(['#e9e4da', '#cfd8dc', '#f3f3f3', 'clutter', 'clutter']), cast: pick([[1, 1, 1], WARM, [0.9, 1, 1.1]]),
      skin: pick(['#d9a07c', '#8d5a3b', '#f1c9a5']), vignette: R() < 0.3, top: F(top), pants: F(pants), shoes: F(shoes) }));
    if (!r.ok) continue;
    ok++;
    for (const [b, f] of [['top', top], ['bottom', pants], ['shoes', shoes]]) { n++; if (close(r.bands[b].colors[0].hex, F(f))) hit++; }
  }
  assert.ok(ok >= N - 1, `person found in ${ok}/${N}`);
  assert.ok(hit / n >= 0.93, `close-color accuracy ${(hit / n * 100).toFixed(1)}%`);
});

test('fast enough for a phone (a 480px photo analyzes well under a second here)', () => {
  const im = makeScene({ W: 300, H: 480, seed: 1, top: F('red'), pants: F('denim'), shoes: F('black') });
  const t = Date.now();
  analyzeWearing(im);
  assert.ok(Date.now() - t < 1000);
});
