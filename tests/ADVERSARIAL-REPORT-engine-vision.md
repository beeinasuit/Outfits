# Adversarial report: engine + vision (sections A and B)

Run: `node --test tests/unit/adv-*.test.js` (tests: `tests/unit/adv-engine.test.js`, `tests/unit/adv-vision.test.js`; helpers `tests/unit/fixtures/adv-gen.js`, `adv-scenes.js`).
All random tests are seeded (mulberry32); seeds and minimal repros are in the assertion messages. Nothing under `src/` was touched.
Each failing test encodes the expected behaviour; the findings below are real problems, not harness errors (several harness mistakes were found and fixed while writing, see "Harness notes").

## Summary

| | tests | pass | fail |
|---|---|---|---|
| A1 golden (27 cases + margins report) | 28 | 28 | 0 |
| A2 invariants (520 seeded wardrobes 0-120 items, 400-item stress, runtime) | 19 | 18 | 1 |
| A3 metamorphic | 12 | 11 | 1 |
| A4 hostile input | 25 | 25 | 0 |
| X extra engine ideas (X1-X19) | 41 | 24 | 17 |
| B vision (B0-B8) | 61 | 51 | 10 |
| **Total** | **186** | **157** | **29** |

Requirement checks that PASS (good news): belt rule in all 520 random trials + 400-item stress (loops + owned available belt => belt always; no loops => never a belt, no penalty text, no score difference whether or not a belt is owned); laundry items never suggested (also via locks); valid locks honoured, invalid locks ignored; determinism and shuffle-stability; scoreOutfit key-order independence; never throws on any hostile input (null entries, `colors:[null]`, `ultraviolet`, NaN/99/-3 formality, `slot:'cape'`, duplicate ids, garbage `worn`, 2000 items, limit 0/-1/1e9, locks on every slot, exclude everything); inputs are not mutated (deep-frozen); runtime 300 items = ~40 ms, 1000 items = ~350 ms, hostile 2000 items = ~720 ms; all 27 golden pairs rank correctly; all 4 "stack of mistakes" outfits score < 10 (HMM).

## Top findings (ranked)

1. **MAJOR: score saturation, the meter is nearly meaningless** (X1, X1b, X1c). Top-20 of six realistic wardrobes: 62% are "CERTIFIED FIT" (>=90), 38% "LOOKING SHARP", 0% below 75 in the default context; across 10 contexts x 6 wardrobes: 60% / 35% / 5% / 0% / 0%. 72% of RANDOM (uncurated) outfits from those wardrobes score >= 75. Streetwear wardrobe: 20 outfits, only 2 distinct values (86, 87). Plain grey tee + jeans + sneakers is 83, a navy blazer/oxford look 92, a casual-only streetwear wardrobe at "work" still gets SHARP 77 (X17, 32 outfits). Sandals locked into a formal dress-pants outfit = 79 (X9). Only deliberate multi-mistake outfits go below 45.
   Cause: `src/engine/rules.js:7` base 70 plus many stackable positives (`neutralSafe 6`, `onePop 10`, `goodPair 5 x2`, `formality.close 4`, `leather.match 10`, `lightOverDark 3`) vs capped/mild penalties (`occasion cap -16` line ~20); `src/engine/score.js:6` squash is the identity to 80.
2. **MAJOR: results are not sorted best-first** (A2.6b, 228 of 520 trials). Example (seed 90006, n=35, lounge/freezing): `93,93,93,89,78,78,73,93,93,93,92,...`. A 93 is shown after a 73. ARCHITECTURE says "best first". Cause: `src/engine/build.js:177-206` `diversify()` appends the `skipped` candidates after the picked ones without re-sorting.
3. **MAJOR (taste): rules miss footwear/weather coherence** (A3.6c, X2b, X18, X19). Sandals are ranked top-5 in `cold` and `freezing` (big80 wardrobe: puffer + sandals + canvas belt 95), scoring *identically* to boots (66 vs 66); a puffer/overcoat with sandals or shorts gets no penalty even without weather (87 vs 87). Cause: no sandals/cold rule in `weatherRules` (`rules.js:380`) and `shoeRules` (`rules.js:305`) only checks dress bottoms/blazers.
4. **MAJOR (vision): striped bed sheet breaks segmentation** (B2b). 4 items on a 35 px striped sheet -> 5 full-height column boxes (`304x768`, `82x768`, ...), 0/6 correct count, IoU 0.27; wood grain and checks are fine. Cause: border background model is a plane/quadratic fit (`segment.js:~192-215`), a periodic pattern is not representable, so stripes become foreground and merge with items.
5. **MINOR: reasons contradict each other** (X5, 10 cases in the sampled set). "Brown and black together can look like a mistake." appears next to "Black, brown and charcoal: easy neutral colours that always go together." Cause: `rules.js:123-124` (neutral praise) emitted regardless of `rules.js:149` clash.
6. **MINOR: top-N variety** (X4, X4b). Same top+bottom pair appears 3x in a top-10 (streetwear default, weekend); a wardrobe with 3 identical white tees fills 6 of the top 10 with visually identical outfits. Cause: `build.js:178-206` PAIR_CAP only applied before the fill pass; no visual-signature dedupe.
7. **MINOR: diversity cap fights rain/layer requirement** (X11b): with rain and an owned rain jacket only 3 of the top 5 wear it (ITEM_CAP 3 on `layer`, `build.js:178`); the others are blazer outfits without rain protection.
8. **MINOR: gapAnalysis** (X7, X7c): suggests "A black leather belt would complete 54 outfits" when the user owns a black leather belt whose colour family is charcoal (owned test requires colour family AND leather tone, `build.js:265`); for a wardrobe with zero shoes it suggests jeans/chinos/sweaters but never shoes (shoes never change scores, so they never "unlock").
9. **MINOR: no-weather defaults** (X3b): with no weather information a puffer (warmth 3) is suggested and 17/20 outfits of the 80-item wardrobe carry a layer.
10. Vision minors: close-up garment filling the frame returns `[]` instead of one full-frame box (B5d); touching items / 4 px gap are merged (B6a, B6c); hard shadows swell boxes (IoU 0.69 vs 0.88 baseline, B3c); strong white balance drops nameColor to ~69-70%; `extractColors` without mask drops one colour of a half-navy/half-white striped item and returns the background for a small item (<10% of pixels); `maxColors: NaN` returns `[]`; `nameColor(null/undefined)` throws; a polka/print swatch is called `check`.

## Check -> pass/fail

### A. Engine
| check | result |
|---|---|
| A1 golden #0-#26 (27 cases), tie case within 12 | all pass |
| A2.0 520 trials never throw | pass |
| A2.1 integer 0..100, never NaN | pass |
| A2.2 top+bottom, slot match, no duplicate item | pass |
| A2.3 unavailable never appear | pass |
| A2.4 belt rule (+4b no belt penalty text) | pass |
| A2.5 ties only with collared top (scarf exempt) | pass |
| A2.6 unique keys, <= limit, key matches items | pass |
| **A2.6b sorted best-first** | **FAIL (228/520)** |
| A2.6c diversity:false strictly sorted | pass |
| A2.7a valid locks honoured / 7b invalid locks ignored | pass |
| A2.8a deterministic / 8b shuffle-stable | pass |
| A2.9 key-order independent | pass |
| A2.10 runtime 300 (~40 ms) / 1000 (~350 ms) | pass |
| A2.11 400-item stress, 6 occasions x 6 weathers | pass |
| A3.1 adding item never lowers best | pass (shoes/belt excluded, see note) |
| A3.2 unavailable removes item everywhere | pass |
| A3.3 like/dislike rank monotonic; dislike pushes #1 out of top 3 | pass |
| A3.4 ids/names don't change scores (top 5) | pass |
| A3.5 matching belt leather >= mismatched | pass |
| A3.6a hot: no layer warmth >= 2 in top 5 / 6b freezing: layer in every top 5 | pass |
| **A3.6c cold: no sandals / shorts in top 5** | **FAIL (big80: sandals, 4 cases)** |
| A3.7 worn yesterday ranks lower (+explained in reasons) | pass |
| A4 hostile wardrobes x 6 option sets (18 wardrobe kinds), same id in 2 slots, non-array args, 2000 items, locks/exclude/limit extremes, scoreOutfit hostile args, no mutation | all pass |

Informational A3.1b: adding shoes or a belt lowered the best score in 22/250 trials (e.g. seed 12010, adding oxfords: 91 -> 73), because those slots become mandatory once owned. This follows from the belt requirement and "shoes required", so it is not counted as a failure.

### X. Extra ideas
| check | result |
|---|---|
| **X1 saturation: <=40% of top-20 CERTIFIED** | **FAIL (62%)** |
| **X1b >=6 distinct values per top-20** | **FAIL (streetwear 2, brights 5, standard 5, big80 4)** |
| **X1c plain outfit <90 and random outfits <70% >= 75** | **FAIL (72%)** |
| X1d hard clashes land in HMM (<45) | pass (6, 1, 31, 8) |
| X1e ordinal sanity plain < smart-casual | pass (87 < 92) |
| **X2 stylist oracle top-5, 10 contexts x 6 wardrobes** | **FAIL (8/300: puffer+sandals)** |
| **X2b stylist oracle top-20** | **FAIL (2)** |
| **X2c top-1 has textbook mistake while clean alternative exists** | **FAIL (7/150 random wardrobes)** |
| X3 accessory discipline (hats only when cold, ties only smart, no layer in heat) | pass (571/1160 outfits carry an optional piece, all justified) |
| **X3b layer/heavy coat with no weather context** | **FAIL** |
| **X4 variety (shoes/tops/bottoms/pair repeat)** | **FAIL (pair 3x)** |
| **X4b duplicate twins** | **FAIL (6/10 visual duplicates)** |
| **X5 reasons contradict outfit/each other** | **FAIL (10, colour neutral-vs-clash)** |
| X5b reason sign vs text | pass |
| X5c reasons add up to score (<6 reasons) | pass |
| X6 / X6b reason hygiene (no undefined/NaN/raw tags, punctuation, a/an, <=110 chars, sorted, <=6; hostile names) | pass |
| **X7 gap suggests owned item** | **FAIL (2)** |
| X7b gap wording/belt logic | pass |
| **X7c gap for no-shoes wardrobe suggests shoes** | **FAIL** |
| X7d gap for no-bottoms wardrobe suggests bottoms | pass |
| X8 / X8b-e belt scenarios (loopless-only, belt in laundry, wrong belt still included and flagged, locked belt) | pass |
| **X9 sandals locked into formal outfit graded honestly (<75)** | **FAIL (79)** |
| X10 exclude / lock+exclude | pass |
| X11 work top-10 appropriate | pass |
| **X11b rain jacket in every top-5 when owned** | **FAIL (3/5)** |
| X12 hot/freezing top choice | pass |
| X13 recent-wear edge cases | pass |
| X14 empty/singleton | pass |
| X15 all-neutral wardrobe no colour-clash | pass |
| X16 running shoes never beat dress shoes under dress pants | pass |
| **X17 casual-only wardrobe at work/formal/date never SHARP+** | **FAIL (32 outfits, 77 at work)** |
| **X18 sandals penalised in cold** | **FAIL (66 vs 66)** |
| **X19 puffer+sandals penalised without weather** | **FAIL (87 vs 87)** |

## Minimal repros (engine)

```js
// 1. unsorted
import { buildOutfits } from './src/engine/build.js';
import { randomWardrobe, mulberry32 } from './tests/unit/fixtures/adv-gen.js';
const r = mulberry32(90006); const items = randomWardrobe(r, 35); // see test A2.6b for exact opts
buildOutfits(items, { today:'2026-11-20', occasion:'lounge', weather:'freezing', rain:false }).map(o=>o.score)
// observed 93,93,93,89,78,78,73,93,93,93,92,... expected non-increasing        (build.js:177-206 diversify fill)

// 2. sandals + puffer, no penalty
scoreOutfit({top:tee, bottom:cargo, layer:puffer, shoes:sandals}).score === scoreOutfit({...,shoes:sneakers}).score // 87 == 87
scoreOutfit({top:sweater, bottom:jeans, layer:puffer, shoes:sandals},{weather:'cold'}).score // 66, same as boots   (rules.js:380 weatherRules)

// 3. contradicting reasons (seed 90083): "Brown and black together can look like a mistake."  +
//    "Charcoal, brown and black: easy neutral colours that always go together."          (rules.js:123 vs :149)

// 4. gap suggests owned (big80 wardrobe): "A black leather belt would complete 54 outfits."
//    while belt big51 = {kind:'leather belt', leather:'black', colors:[charcoal]}          (build.js:265)
```

## Score distribution (top-20, default context, `today=2026-11-20`)

| wardrobe | n | >=90 CERTIFIED | 75-89 SHARP | 60-74 SOLID | 45-59 BOLD | <45 HMM | distinct values | range |
|---|---|---|---|---|---|---|---|---|
| capsule (10 items) | 16 | 6 | 10 | 0 | 0 | 0 | 9 | 80-92 |
| work (21) | 20 | 17 | 3 | 0 | 0 | 0 | 7 | 81-95 |
| streetwear (19) | 20 | 0 | 20 | 0 | 0 | 0 | **2** | 86-87 |
| brights (14) | 20 | 17 | 3 | 0 | 0 | 0 | 5 | 86-92 |
| standard (fixture, 36) | 20 | 12 | 8 | 0 | 0 | 0 | 5 | 88-94 |
| big80 (80 neutral-heavy) | 20 | 20 | 0 | 0 | 0 | 0 | **4** | 90-95 |
| **aggregate** | 116 | **62%** | 38% | 0% | 0% | 0% | 14 total | 80-95 |
| all 10 contexts x 6 wardrobes (1160 outfits) | | 60% | 35% | 5% | 0% | 0% | | |
| 900 random outfits from those wardrobes | | | 72% score >= 75 | | | | | |

Stack of deliberate mistakes: 6, 1, 31, 8 (HMM works at the extreme); the bands BOLD MOVE (45-59) and SOLID (60-74) are essentially unreachable for outfits the engine itself picks, and a user will almost never see anything but CERTIFIED/SHARP.

## Golden margins (better - worse; "FRAGILE" = margin < 3)

| # | case | better | worse | margin |
|---|---|---|---|---|
| 0 | navy+beige vs navy+black | 84 | 77 | 7 |
| 1 | one accent vs two loud brights | 84 | 41 | 43 |
| 2 | orange+purple clash | 86 | 46 | 40 |
| 3 | light top over dark vs same tone | 92 | 82 | 10 |
| 4 | grey tee+jeans vs grey tee+grey chinos | 83 | 82 | **1 FRAGILE** |
| 5 | tonal black vs black/brown leathers | 86 | 57 | 29 |
| 6 | belt matches shoes brown | 90 | 63 | 27 |
| 7 | belt matches shoes black | 90 | 63 | 27 |
| 8 | canvas belt vs dress belt with shorts | 87 | 77 | 10 |
| 9 | joggers vs jeans no belt (tie, <=12) | 87 | 83 | 4 (ok) |
| 10 | one pattern vs two busy | 91 | 74 | 17 |
| 11 | floral + solid tie vs plaid tie | 91 | 53 | 38 |
| 12 | stripe + solid tie vs plaid tie | 96 | 84 | 12 |
| 13 | tie with trousers vs joggers | 94 | 78 | 16 |
| 14 | tie with tee vs no tie | 87 | 56 | 31 |
| 15 | blazer+chinos vs blazer+joggers | 94 | 66 | 28 |
| 16 | derbies vs running shoes with dress pants | 91 | 68 | 23 |
| 17 | blazer+tie with cap vs without | 96 | 94 | **2 FRAGILE** |
| 18 | overcoat vs puffer (cold, suit) | 96 | 84 | 12 |
| 19 | shorts+boots+blazer mess | 87 | 63 | 24 |
| 20 | graphic tee with dress trousers | 82 | 57 | 25 |
| 21 | work: oxford+chinos vs tee+jeans | 95 | 66 | 29 |
| 22 | lounge: joggers+tee vs suit | 89 | 84 | 5 |
| 23 | freezing: layer+beanie vs bare tee | 87 | 70 | 17 |
| 24 | hot: shorts+tee vs sweater+puffer | 92 | 60 | 32 |
| 25 | rain jacket vs suede/no jacket | 95 | 61 | 34 |
| 26 | sandals with dress trousers in cold | 90 | 64 | 26 |

Fragile (<3): #4 (margin 1) and #17 (margin 2). Notable weak-ish: #22 lounge (a full suit scores 84 for lounging, margin 5, a symptom of saturation), #0 (7).

## B. Vision

Typical 1024x768, 6 seeds each unless noted (`countAcc` = exact item count; `IoU` is vs ground truth with the default 3% padding, so a perfect result is ~0.88; `contain` = a box fully contains the item).

| scenario | truth | detected | count acc | mean IoU | contain | ms | verdict |
|---|---|---|---|---|---|---|---|
| baseline 5 items | 5 | 5 | 100% | 0.88 | 100% | 86 | pass |
| white shirt on white sheet (dL~6) | 1 | 0 | **0%** | 0 | 0 | 58 | informational (extreme) |
| white on cream (dL~12) | 1 | 1 | 100% | 0.88 | 100% | 62 | pass |
| black jeans on dark floor | 1 | 1 | 100% | 0.84 | 100% | 66 | pass |
| grey tee on grey carpet (dL~9, noise 6) | 1 | 1 | 100% | 0.88 | 100% | 64 | pass |
| wood grain bg | 4 | 4 | 100% | 0.87 | 100% | 65 | pass |
| **striped sheet bg** | 4 | **5** | **0%** | **0.27** | 100% | 73 | **FAIL (major)** |
| checked bg | 4 | 4 | 100% | 0.89 | 100% | 61 | pass |
| vignette 0.45 / one-sided light 0.9 | 5 | 5 | 100% | 0.88 | 100% | ~65 | pass |
| hard shadows 0.6, offset 28,36 | 5 | 5 | 100% | **0.69** | 100% | 62 | FAIL (boxes swell, minor) |
| vignette+side+shadow+noise+jpeg blocks combined | 5 | 5 | 100% | 0.74 | 100% | 68 | pass |
| jpeg blocks 8 + noise 12 | 5 | 5 | 100% | 0.88 | 100% | 61 | pass |
| 4000x3000 | 5 | 5 | ok | 0.87 | | **154** (< 1.5 s) | pass, boxes+masks in original px |
| 1x1, 0x0, 2x2, 7x7, 1x1000, 1000x1, all-transparent, NaN/negative dims, short data, null | | [] | | | | | pass (never throws) |
| uniform empty sheet (4 colours) | | <=1 | | | | | pass |
| **close-up garment fills frame (stripe/check/print)** | 1 | **0** | | | | | **FAIL: contract says one full-frame box** |
| touching items, 0 px gap | 2 | 1 | **0%** | 0.43 | 100% | 73 | FAIL (merged, minor) |
| 4 px gap | 2 | 1 | **0%** | 0.43 | 100% | 70 | FAIL (merged, minor) |
| overlapping 40 px | 2 | 1 | 0% | 0.42 | | | informational |
| rotated 15/30/45/70 deg | 2 | 2 | 100% | ~0.89 | 100% | ~68 | pass |
| 5 items mixed rotations | 5 | 5 | 100% | 0.90 | 100% | 59 | pass |
| tiny item 1.5% / 1.0% of frame; 0.6% with minAreaFrac 0.003 | 4 | 4 | 100% | 0.83 | 100% | 62 | pass |
| belt flat 700x22 / diagonal 30deg / thin low-contrast canvas belt | | found | 100% | 0.54 / 0.83 / 0.34 | | | pass (belt IoU low: boxes fat) |
| belt directly under shirt (1 px gap) | 2 | 1 | 0% | 0.22 | | | informational (merged) |
| 15 items: default cap 12 keeps the largest 12; maxItems 15 -> 15 | | 12 / 15 | | | | | pass |
| item cut by frame edge; item in corner | 2 | 2 | 100% | 0.88/0.90 | 100% | ~55 | pass |
| 320x240 ... 1920x1080 | 5 | 5 | | | | 37-62 | pass |
| 40 random flat-lays (3-8 items, rotation, shadows, vignette) | | | **90%** | 0.82 | | | pass |
| 1024x768 x 8 items, all effects | | | | | | 55 | pass |

Colour (`nameColor` on the 67-hex table in `vision-color.test.js`): neutral 100%; mild warm (+8% R, -8% B) 91.0%; mild cool 89.6%; **strong warm indoor (+15% R / -15% B) 68.7%**, **strong cool shade 70.1%** (dark denim -> charcoal, light denim -> grey, camel -> orange, mustard sweater misses, washed black -> charcoal, khaki -> grey, stone chinos -> denim). `extractColors` on noisy swatches: same 68.7 / 70.1%. Per-item in a segmented scene (mask aware): neutral 5/5, warm 4/5 (white -> cream), cool 4/5 (white -> light-blue). There is no white-balance normalisation anywhere in `color.js`.

Pattern: noisy solids/denim/heather -> solid/textured OK; stripes of 4-40 px, any orientation, low contrast -> OK; checks 6-30 px OK; **a multi-colour polka/print swatch (`print(160,160)`) -> `check`** (minor/taste).

Vision failures with causes:
- B2b striped sheet (major): `segment.js:~192-215` border plane/quadratic fit cannot model a periodic background.
- B5d close-up returns `[]`: border == item, so nothing differs from the "background"; the documented "one full-frame box" fallback is not implemented (`segment.js` ~l.190 area, after background fit).
- B6a/B6c merges: morphology (`erode`/`dilate`, `segment.js:92-130`) closes gaps of 1-2 working pixels (a 4 px gap at 1024 wide is ~1.5 px at the 384 px working size).
- B3c shadows: soft shadow edges are within tolerance of the background model only partly; boxes grow ~27%.
- B4d/B7d: `color.js:192-200` background removal uses the median border colour even when the item reaches the border, and falls back to all pixels when the item is <10% of the pixels (`keep.length >= smp.n * 0.1`). With a mask both cases pass (B4e).
- B7a: `color.js:280` `slice(0, Math.max(1, maxColors))` with `maxColors: NaN` -> `[]` (contract: never empty).
- B7b: `nameColor(null)` / `nameColor(undefined)` throw (destructuring in signature, `color.js:117`).

## Harness notes (mistakes found in my own tests and corrected)
- Ground-truth boxes of rotated ellipse/shirt shapes and items cropped by the frame were wrong (fixed: rect-only for rotation, truth clipped to frame).
- Low-contrast white tee in the colour scene (dL~4) was legitimately invisible; replaced with a visible contrast.
- X2 oracle initially counted a scarf as a tie and applied work/formal/lounge rules to wardrobes that own no such clothes; fixed. `maxColors: 50` returning 6 colours is within contract and not flagged.
- Floors for strong white balance were set to 65% after measuring (arbitrary bar; the numbers above are the finding).
