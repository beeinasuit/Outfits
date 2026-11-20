# Outfits — architecture

A phone-first, installable web app (PWA) that decides which of your clothes look good together.
Everything runs on the phone: no account, no server, works offline. Photos and data live in IndexedDB.

## Constraints

- **No build step, no npm runtime dependencies.** Plain ES modules served as static files, so the app can be
  hosted anywhere (GitHub Pages, any static host) under any sub-path. All asset/module paths are **relative**.
- **Pure logic is DOM-free** (`src/model.js`, `src/engine/*`, `src/vision/color.js`, `src/vision/segment.js`)
  so it runs in Node for unit tests (`node --test tests/unit`).
- Dev dependencies for testing only: Node's built-in test runner; Playwright is pre-installed globally
  (`require('playwright')`) for end-to-end tests.
- Phone first: designed at 390×844, must work from 320px wide up to desktop; no horizontal scroll.

## Layout

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline cache of the shell)
icons/                  app icons (SVG + PNG)
src/model.js            SHARED CONTRACT: slots, kinds, colour families, Item/Outfit typedefs, makeItem()
src/engine/rules.js     colour/pattern/formality/accessory rules -> Reasons
src/engine/score.js     scoreOutfit(outfit, ctx)
src/engine/build.js     buildOutfits(items, opts), gapAnalysis(items, opts)
src/vision/color.js     extractColors(imageData, opts), nameColor(rgb)
src/vision/segment.js   segmentItems(imageData, opts)  (flat-lay multi-item split)
src/vision/image.js     browser-only: decode, resize, compress, crop, getImageData
src/store.js            IndexedDB: items, photos, feedback, settings; export/import backup
src/app.js              entry point, router
src/ui/*                screens + components
styles/app.css          design system
tests/unit/*.test.js    node --test
tests/e2e/*.spec.mjs    Playwright scripts (plain node scripts using require('playwright'))
```

## Module contracts

All types are defined in `src/model.js` (`Item`, `Color`, `Outfit`, `Reason`). Do not redefine them.

### `src/engine/score.js`

```js
/**
 * @param {Object<string, Item>} items  slot -> item (top + bottom required; others optional)
 * @param {ScoreContext} ctx
 * @returns {{ score: number /* 0..100 integer *\/, reasons: Reason[] }}
 */
export function scoreOutfit(items, ctx = {})

/** ScoreContext:
 *  { occasion?: keyof OCCASIONS = 'any',
 *    weather?: keyof WEATHER | null = null,   // null = ignore weather
 *    rain?: boolean = false,
 *    feedback?: { liked: Set<string>, disliked: Set<string> }  // outfit keys and/or pair keys "idA|idB"
 *  }
 */
```

Pure and deterministic. A baseline good outfit (neutral top + neutral bottom, matching leathers, right formality) scores ~75-85.
Hard clashes push below 40. The score must be stable under item order and must never be NaN or outside 0..100.

### `src/engine/build.js`

```js
/**
 * @param {Item[]} items  whole wardrobe (unavailable items are ignored)
 * @param {BuildOptions} opts
 * @returns {Outfit[]}  best first, unique by key, length <= opts.limit
 */
export function buildOutfits(items, opts = {})
/** BuildOptions: ScoreContext & {
 *    limit?: number = 20,
 *    locks?: Object<string, string>,      // slot -> item id that MUST be used
 *    exclude?: Object<string, string[]>,  // slot -> item ids to skip (e.g. reshuffle)
 *    recentDays?: number = 3,             // items worn within N days are penalised
 *    today?: string,                      // YYYY-MM-DD, for deterministic tests
 *    diversity?: boolean = true,          // avoid returning 20 outfits that differ only by belt
 *  }
 */

/**
 * "What one purchase would unlock the most good outfits?"
 * @returns {Array<{ slot: string, kind: string, family: string, leather?: string, unlocks: number, text: string }>}
 */
export function gapAnalysis(items, opts = {})
```

Staged search (never a full cartesian product):
1. score every available top × bottom pair on core rules, keep the best N (N ≈ 40);
2. for each, choose shoes, then a belt **iff `bottom.beltLoops`** (belt is skipped, never penalised, when there are no loops;
   if the bottom has loops and the user owns a compatible belt, a belt is always included);
3. add a layer when weather/occasion calls for it or it raises the score; neckwear only with a collared top at
   formality ≥ 3; headwear only in casual contexts or cold weather;
4. apply locks (a locked slot uses only that item, even if it is "wrong"; a locked belt with a loopless bottom
   means only loop bottoms are considered), recent-wear penalty, diversity, then sort.

Must handle: empty wardrobe, only tops, no shoes, no belts, 300+ items (< 300ms on a phone), duplicate items,
locks pointing at missing/unavailable ids (ignore the lock).

### `src/vision/color.js`

```js
/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData  RGBA
 * @param {{ mask?: Uint8Array /* 1 = item pixel *\/, maxColors?: number = 3, ignoreBackground?: boolean = true }} opts
 * @returns {Color[]}  dominant first, weights sum to ~1, 1..maxColors entries, never empty
 */
export function extractColors(imageData, opts = {})
/** Map one sRGB colour to the closest COLOR_FAMILIES key (perceptual, CIELAB/ΔE). */
export function nameColor([r, g, b])
/** Heuristic pattern guess from pixel variance/edges: 'solid' | 'stripe' | 'check' | 'textured' | 'print'. */
export function guessPattern(imageData, opts = {})
```

### `src/vision/segment.js`

```js
/**
 * Split a flat-lay photo into item boxes by modelling the background from the border pixels.
 * @param {{width,height,data}} imageData
 * @param {{ minAreaFrac?: number = 0.01, maxItems?: number = 12, padding?: number = 0.03 }} opts
 * @returns {Array<{ x:number, y:number, w:number, h:number, area:number, mask?: Uint8Array }>}
 *          boxes in image pixel coordinates, sorted top-left to bottom-right, non-overlapping where possible.
 *          Returns [] if nothing is found; returns one full-frame box if the whole image is one item.
 */
export function segmentItems(imageData, opts = {})
```

### `src/vision/image.js` (browser only)

```js
export async function fileToBitmap(file)                      // ImageBitmap, EXIF orientation respected
export function bitmapToCanvas(bitmap, maxDim = 1024)       // downscaled canvas
export function cropCanvas(canvas, box)                     // new canvas
export async function canvasToBlob(canvas, { maxDim = 600, type = 'image/webp', quality = 0.8 })  // falls back to jpeg
export function canvasImageData(canvas, maxDim = 256)       // small ImageData for analysis
```

### `src/store.js`

```js
export async function listItems()          // Item[]
export async function putItem(item)
export async function deleteItem(id)       // also deletes its photo
export async function putPhoto(blob)       // -> photoId
export async function getPhotoURL(photoId) // object URL (cached)
export async function getFeedback() / setFeedback(key, 'like'|'dislike'|null)
export async function getSettings() / putSettings(partial)
export async function exportBackup()       // -> Blob (JSON with base64 photos, versioned)
export async function importBackup(file, { mode: 'merge'|'replace' })
```

## Data flow

Capture → `fileToBitmap` → `segmentItems` (boxes, user can edit) → per box: `cropCanvas` → `extractColors` +
`guessPattern` → review form (slot/kind/pattern/belt loops...) → `makeItem` → `putPhoto` + `putItem`.

Outfits → `listItems` → `buildOutfits(items, {occasion, weather, locks, feedback})` → render.

## Version 2 (not now)

A tiny serverless proxy holding the API key, calling Claude Haiku 5.5 to label crops (kind, pattern, colours, leather tone).
The review form already has every field the AI would fill, so v2 only adds an "auto-fill" step.

## Laundry

- `item.available === false` means "in the hamper": never suggested.
- **Auto-hamper** (setting, default on): "Wearing it!" appends today to `worn[]` (once per day per item), then any item where
  `needsWash(item)` is true gets `available = false`. Limits come from `item.wearsBeforeWash` (defaults per kind/slot in
  `WEARS_BEFORE_WASH`; 0 = never, e.g. belts and shoes), editable per item.
- **Laundry day** button: every item gets `available = true` and `lastWashed = today`, so wear counts reset.
- Manual per-item toggle stays; manually washing one item also sets its `lastWashed`.

## Outfit board & single-item swap (replaces the slot-machine reels)

The Today screen shows the outfit as a **flat-lay board**: the real photos (background removed) composed head-to-toe
(hat, layer overlapping top, neckwear, belt across the waist, bottom, shoes; extras off to the side). Each piece has a
**swap** button opening a sheet with two tabs:
- **Suggest** — `rankForSlot` ranks candidates for that slot with the rest of the outfit held fixed, showing each score delta.
- **I'll pick** — the user's items for that slot, no hints; on pick, `scoreOutfit` rescores and the meter animates the delta.
Optional slots can be removed ("skip") or added ("+ add a layer").

### `src/engine/build.js` (addition)
```js
/**
 * Rank every available item for `slot` as a replacement in `outfitItems` (other slots held fixed).
 * Includes the "none" option for optional/conditional slots (and drops the belt automatically when the
 * candidate bottom has no loops / adds the best belt when it gains loops).
 * @returns {Array<{ item: Item|null, items: Object<string,Item>, score: number, delta: number, reasons: Reason[] }>}
 *          best first; `delta` = score - current score; `items` = the full resulting outfit.
 */
export function rankForSlot(allItems, outfitItems, slot, ctx = {})
```

### `src/vision/image.js` (addition)
```js
/** Apply a segmentation mask to a crop: pixels outside the item become transparent; edge feathered ~2px;
 *  trimmed to the item's bounding box. Mask is box-sized (w*h) as returned by segmentItems. */
export function cutoutCanvas(sourceCanvas, box, mask, { feather = 2 } = {})
```
Store `item.cutoutId` (photo store key of a transparent WebP/PNG) alongside `photoId`. `canvasToBlob` must keep alpha
(WebP keeps alpha; the JPEG fallback must not be used for cutouts — fall back to PNG).

## Personal colouring (complexion)

Optional `settings.profile` (`Profile` / `makeProfile` in model.js). Passed to the engine as `ctx.profile`
(ScoreContext gains `profile?: Profile`). Only used when `profile.enabled`.

- **Selfie**: taken inside an oval guide; the head-and-shoulders cutout is shown at the top of the outfit board so the
  user sees the colours next to their own face. Never leaves the device; excluded from backups unless opted in.
- **Drape test** (UI): the selfie cutout is shown over pairs of colour backgrounds (gold vs silver, rust vs burgundy,
  cream vs pure white, black vs charcoal, camel vs grey, coral vs fuchsia-pink); ~6 taps "which looks better?" decide
  undertone and contrast. A skin sample gives an initial guess for depth/undertone. User can also set them manually.

### `src/vision/skin.js` (pure)
```js
/** Sample skin inside an ellipse (the oval guide, in image coords), robust to hair/eyes/background (skin-likelihood
 *  filter in YCbCr/Lab + trimmed mean), with optional white point correction.
 * @returns {{ hex, lab:[L,a,b], depth:'light'|'medium'|'deep', undertoneGuess:'warm'|'cool'|'neutral', confidence:0..1 } | null}
 */
export function analyzeSkin(imageData, { cx, cy, rx, ry, whitePoint } = {})
/** Contrast guess from the oval: luminance spread between skin and the darkest large region (hair/brows). */
export function guessContrast(imageData, ellipse, skinLab)   // -> 'low'|'medium'|'high'
```

### Engine complexion rules (`src/engine/rules.js`)
Weighted by `NEAR_FACE`; magnitude modest (a great complexion match ≈ +6, a poor one ≈ −6; never more than ±10 total),
only for colours near the face. Friendly reasons ("Rust warms up your complexion", "Pure black is a bit stark next to your
face — charcoal is softer"). Heuristics: warm ↔ olive, rust, camel/beige, cream, mustard, warm brown, coral, forest;
cool ↔ navy, burgundy, crisp white, grey, blue, pink, lavender, emerald/teal; neutral: mild bonus to both, no penalties.
High contrast handles black/white and bold pairings (+); low contrast is flattered by tonal/muted (+) and overpowered by
stark black-and-white (−). Very light depth: pale beige/cream/pastel yellow near the face can wash out (mild −) unless
contrast is high. Deep depth: rich saturated colours and crisp white (+).

## Occasions

The occasion picker is how the user asks "what do I wear to X?". Each occasion in `OCCASIONS` (model.js) is data:
a formality window plus optional colour/kind preferences that the engine applies generically
(`preferFamilies` +, `avoidFamilies` −, `avoidKinds` −−, `wantKinds` +, `wantLayer`, `muted` = penalise loud colours and
busy patterns, `noHeadwear`). Users can add their own occasions (label, emoji, formality range) — stored in
`settings.customOccasions`, same shape, passed to the engine via `ctx.occasionDef`.

Not planned (decided with the user): streaks, and any AI/API features.

## Glow-up, battle, week plan

- **Outfit glow-up ("Improve this look")** — one tap finds the single best swap across all slots (loop `rankForSlot`
  over every slot, take the max positive delta) and shows before/after with a drag slider; "Apply" swaps it in.
  If no swap gains ≥ 3 points, say so cheerfully ("Already peak — nothing to improve").
- **Outfit battle** — two outfits side by side (two top suggestions, the user's own build vs the app's pick, or two
  liked looks). The user taps the winner; the vote is recorded as a `battle` event for taste learning, then both scores
  and the deciding reasons are revealed. "Next battle" keeps them coming; variety is forced (different tops/bottoms).
- **Plan the week** — assign outfits to the next 7 days, each with its own occasion; the builder avoids reusing tops and
  bottoms across planned days and respects the hamper (planned items count as worn on their day). Stored in settings.plan.

## Taste learning (`src/engine/taste.js`, pure)

Learns the user's preferences from events, not just exact outfits:
```js
/** events: Array<{ type:'battle'|'like'|'dislike'|'wear', at:number, winner?:Object<slot,Item>, loser?:Object<slot,Item>,
 *                  items?:Object<slot,Item> }>   (items are snapshots; ids may no longer exist)
 * @returns {Taste}  per-feature weights in [-1, 1] with evidence counts */
export function learnTaste(events, { now = Date.now(), halfLifeDays = 60 } = {})
/** Score adjustment for an outfit: bounded to ±8 total, 0 when evidence is thin.
 * @returns {{ delta:number, reasons: Reason[] }} reasons like "You tend to pick olive — it's a favourite" */
export function tasteDelta(items, taste)
/** Human-readable summary for Settings: top likes / dislikes with strength. */
export function describeTaste(taste)
```
Features: colour family per slot group (near-face / lower / feet), kind, pattern, formality relative to the occasion,
layering habit, contrast level (light-over-dark vs tonal). Battle = pairwise (winner features +, loser −); like/wear
= +, dislike = −; wear is weaker than an explicit vote. Recency-weighted. `scoreOutfit` applies `tasteDelta` when
`ctx.taste` is set. The store keeps an append-only `events` log (capped ~5 000) and settings shows `describeTaste`
with a reset.

## UI data layer (src/ui/data.js) — shared foundation for all screens

- `data` = { items, feedback, records, settings, events, taste, ready }; `subscribe(fn)` / `emit(what)`.
- `getContext()` → `{ occasion, occasionDef, weather, rain, feedback, note, profile, taste }` — pass straight to the engine.
- `allOccasions()` built-ins + `settings.customOccasions` (normalised with `makeOccasion`).
- `recordEvent({type:'battle', winner, loser})` / like / dislike / wear (snapshots stored in the `events` IDB store,
  capped at 5 000; `data.taste` re-learned on every event). `resetTaste()`.
- `setFeedback(outfit, 'like'|'dislike'|null)` also records a like/dislike event.
- `logWorn(outfit)` → `{ hampered }`: appends today, records a wear event, applies auto-hamper (`settings.autoHamper`).
- `laundryDay()` → number of items that came out of the hamper; `setClean(item, bool)`.
- Settings keys: `autoHamper`, `useTaste`, `profile` (Profile), `customOccasions`, `plan` ({ 'YYYY-MM-DD': { occasion, slots:{slot:id} } }).
- Backups include `events`; selfie photos only when `profile.includeSelfieInBackup`.
