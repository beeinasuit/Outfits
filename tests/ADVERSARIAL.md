# Adversarial test plan

Goal: find the ways the app breaks or gives bad fashion advice, before the user does.
Testers **find and report**; they do not fix product code. Each failing check becomes a bug with a minimal repro.

## A. Engine (Node, `tests/unit/adv-engine.test.js`)

### A1. Taste: golden set
`fixtures/golden.js` — pairs of outfits a stylist would rank one way. Written independently of the rule weights.
- `scoreOutfit(better, ctx) > scoreOutfit(worse, ctx)` for every case; `tie: true` cases must be within 12 points.
- Report the margin of every case; margins < 3 are "fragile" and listed even if passing.

### A2. Invariants (seeded random wardrobes, ≥ 500 trials, sizes 0–120, plus a 400-item stress case)
For every outfit returned by `buildOutfits`:
1. `score` is an integer in 0..100, never NaN.
2. `items.top` and `items.bottom` exist; every `items[slot].slot === slot`; no item appears twice.
3. No `available: false` item appears.
4. **Belt rule:** bottom has loops and an available belt exists → belt present. Bottom has no loops → no belt.
5. Neckwear only with a collared top.
6. Keys are unique; `length <= limit`; results sorted by score descending (or documented diversity order).
7. Valid locks are honored in every result; invalid locks (unknown id, unavailable, wrong slot) are ignored, not fatal.
8. Determinism: same input → identical output (deep-equal), and shuffling the wardrobe array doesn't change the set of results.
9. `scoreOutfit` is independent of object key order.
10. Runtime: 300 items < 300 ms, 1000 items < 2 s.

### A3. Metamorphic relations
- Adding an item never lowers the best outfit's score.
- Marking any item unavailable removes it from every result.
- Liking an outfit doesn't lower its rank; disliking doesn't raise it.
- Changing ids/names (not attributes) doesn't change scores.
- Swapping a black belt for a brown one when shoes are brown leather doesn't lower the score (and vice versa).
- In `hot` weather, no outfit in the top 5 has a layer with warmth ≥ 2. In `freezing`, every top-5 outfit has a layer if the user owns one.
- Recently worn items (yesterday) rank lower than the same outfit without them.

### A4. Hostile input
Items missing colors, `colors: [null]`, unknown family `ultraviolet`, `formality: NaN/99/-3`, `slot: 'cape'`, duplicate ids,
same id in two slots, `worn: ['garbage']`, 2 000 items, locks on every slot, `exclude` everything, `limit: 0/-1/1e9`.
Requirement: never throws; returns sensible output or `[]`.

## B. Vision (Node, `tests/unit/adv-vision.test.js`)
Synthetic scenes that model real phone photos:
- low contrast: white shirt on white sheet, black jeans on dark floor (must not crash; report detection rate)
- patterned/wood-grain background, striped sheet
- strong vignette, one-sided window light, hard drop shadows
- warm indoor white balance (+R −B tint ~ 15%) and cool shade (−R +B): color family accuracy on the 40-hex table under each
- JPEG-like blockiness + noise, 4000×3000 input (must downsample, < 1.5 s), 1×1, 0×0, all-transparent
- touching items, rotated items (45°), tiny items (socks ~1% of frame), a belt (long + thin), 15 items (cap at maxItems)
Report: per-scenario count accuracy, box IoU vs ground truth, color accuracy, timings.

## C. Storage & backup (browser, Playwright, `tests/e2e/adv-store.mjs`)
- Export → clear → import(replace) round-trips items, photos, feedback, settings exactly.
- Import: invalid JSON, truncated file, wrong `app`, future `version`, items with garbage fields, bad photo dataURLs,
  a 20 MB file, an empty file, a PNG renamed .json → clear error, no partial corruption of existing data.
- XSS: item name `<img src=x onerror="window.__pwned=1">` and `"><svg onload=...>` entered via the form and via import
  must render as text; `window.__pwned` stays undefined everywhere (closet, spin, looks, review card, toasts).
- IndexedDB unavailable (stub `indexedDB` to throw) → app still works in memory with a warning.

## D. UI chaos (browser, Playwright, `tests/e2e/adv-ui.mjs`, iPhone viewport + 320px)
- Double/triple-tap SPIN, spin during a spin, lock all reels and spin, lock an item then delete it, then spin.
- Delete every item mid-session; empty closet on every screen; closet with only tops; with 200 items (scroll perf).
- Very long names (80 chars), emoji, RTL text — no overflow at 320px.
- Back/forward through every route; deep-link to each hash route on cold load.
- Upload: a non-image file, a 0-byte file, a 6000×4000 JPEG, a PNG with transparency, canceling the picker.
- Snap review: delete all boxes then Next; add a box of 0 size; drag a box off-screen.
- Offline: load once, go offline, reload → app shell works and data is intact.
- `prefers-reduced-motion` → no long animations; dark mode → screenshot every screen, check contrast of text vs background.
- Keyboard only: can spin, lock, like and navigate tabs; every button has an accessible name.
- Monkey: 60 s of random taps across the app with a fixed seed → zero console errors / unhandled rejections.

## Output
Each tester writes `tests/ADVERSARIAL-REPORT-<area>.md`: a table of check → pass/fail, and for each failure a minimal
repro, observed vs expected, severity (blocker / major / minor / taste).
