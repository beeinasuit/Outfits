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
