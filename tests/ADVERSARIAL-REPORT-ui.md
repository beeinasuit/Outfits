# Adversarial report: UI, storage and backup (sections C and D)

Tester: adversarial UI agent. Scripts: `tests/e2e/adv-store.mjs`, `tests/e2e/adv-ui.mjs`, helpers `tests/e2e/adv-lib.mjs` (`adv-xss-probe.mjs` is a debug helper). Screenshots: `tests/e2e/adv-screenshots/`.
Run: `node tests/e2e/adv-store.mjs [url]`, `node tests/e2e/adv-ui.mjs [url] [id,id,...]`.

**Caveat on the Today screen.** Part-way through, the app began a redesign (route `spin` became `today`, the reels are going away, the SW SHELL gained `taste.js` and `skin.js`). The UI checks below were run in pieces against the old reel-based Spin screen. A final full run was disturbed by the redesign and its `results-ui.json` is not meaningful. The storage run (`results-store.json`, 121 checks) is complete and current. Reel-specific findings are marked **[reel]**. Everything else applies app-wide.

## Totals

| Area | Checks | Pass | Fail |
|---|---|---|---|
| C: storage, backup, XSS, IndexedDB (`adv-store`) | 121 | 107 | 14 |
| D and extras: UI chaos (`adv-ui`, last good per-scenario runs) | about 190 | about 160 | about 30 (several are the same root cause) |

Monkey test: 60 s with a fixed seed (20241120), hundreds of random taps, keys, drags, back/forward, uploads, resizes. **Zero console errors, page errors or unhandled rejections, and no modal survived Escape twice.**

## Top findings by severity

### Blockers and majors (app-wide)

1. **XSS via item name (aria-label breakout), major to blocker.** `window.__pwned` was set.
   - Repro: add an item named `"><img src=x onerror=window.__pwned=1>` (37 chars, fits the 40-char form limit) via Snap, then No photo, then Add. Tap an empty reel so the "pick one" sheet opens. Importing the same name in a backup works too.
   - Observed: script executes. Expected: rendered as text.
   - Cause: `src/ui/illustrations.js:192` puts `title` unescaped into `aria-label="${title}"`, and `src/ui/itemart.js:8` passes it through `innerHTML`. `itemArt(it, {cls:'tile'})` with the default `title: true` is used in the pick sheet (`spin.js:223`). Any new screen that calls `itemArt` with a title will be vulnerable too.
   - Screenshot: `adv-screenshots/c3-form-closet.png`.
2. **XSS via color hex from an imported backup, major to blocker.** An import with `colors:[{family:'red',hex:'#fff"/><img src=x onerror=...>'}]` injects an element on every screen that draws the item (closet, reels, looks).
   - Cause: `src/model.js:241` only checks `COLOR_FAMILIES[c.family]` and never validates `hex`. The value reaches SVG markup at `illustrations.js:~180-190` (`path(d, p, S)` and `fill="${p}"`).
   - Screenshot: `adv-screenshots/c3-import-closet.png`.
   - Names, reasons, stickers, toasts, edit sheet, review card and looks are safe: they render as text nodes (checks C3a2, C3a3, C3b2 pass).
3. **Restore "Replace everything" can destroy data on a bad import.** Repro: import a backup where one item has `id: true` or `id: {}`. `parseBackup` accepts it, `importBackup` calls `clearAll()` first, then `putItem` throws an IndexedDB DataError. The closet stays wiped and the toast shows the raw DOMException text ("Failed to execute 'put' on 'IDBObjectStore'...").
   - Cause: `src/store.js` `importBackup` (clear before validate and write) and `parseBackup`/`makeItem` not validating `id`. Fix direction: validate everything first and write in one transaction.
4. **Cryptic import error and no per-field validation.** An item with `name: 12345` or `name: {}` is rejected with "`(partial.name || "").trim is not a function`". Cause: `src/model.js:247`. Every case in the hostile list that follows the name-type check pass or fail on this one message in `adv-store` (C2.22 to C2.46 originally collapsed into this error). Minor severity on its own, but it means that apart from the invalid-id case (finding 3) the garbage-field cases were not truly exercised past that first message. Re-run after a fix.
5. **Offline cold start breaks when a module is missing from `sw.js` SHELL.** Observed with `src/engine/taste.js`: an offline reload gave a blank, never-ready app, because modules fetched during the very first page load (before the SW controls the page) are not runtime-cached. SHELL has since been updated, so this no longer reproduces for `taste.js` or `skin.js`. The risk is structural: every new module must be added to SHELL and `CACHE_VERSION` bumped. `adv-ui` check D11.shell guards this (it failed twice during this session). The 'online reload gets new code' test (D11.update) could not be confirmed because the app was already offline-broken at that point.
6. **Storage failures are not surfaced.** With `IDBObjectStore.put` throwing QuotaExceededError, tapping a closet wash button throws an unhandled rejection and shows no toast (`closet.js` `toggleWash`, `data.js` `saveItem`). Same pattern for edit-sheet Save, wear logging and likes (no try/catch around awaited store calls). Major: the user believes data saved.
7. **Concurrent spins race [reel, but the root cause is app-wide].** With weather = Auto and a slow geolocation, three SPIN taps in the 900 ms wait produce 3 spins and 3 announcements. `spin()` checks `S.spinning` before `await getContext()` and sets it after (`spin.js:164-185`). Any redesign that keeps an async context resolve before locking the busy flag will have it. Also triple-tap in one task gave 3 announcements, and reel strips ended with 0 children in some reels (`strips:[0,0,1,0,1,1,1]`): empty reels are valid, but 3 announcements shows overlapping spins.

### Minor and polish

- **Back with a sheet open leaves the sheet floating** over the previous route (`overlay.js sheet()` is not tied to the hash; `app.js render()` doesn't close dialogs). Not a trap (Escape and ✕ work) but a visible glitch. Check D8d.
- **Unknown/odd hashes:** `#/constructor` (and `__proto__`, `toString`) is looked up with `ROUTES[m[1]]` on a plain object (`app.js:23`); it resolved to inherited properties. In the run it rendered no highlighted tab. Use `Object.hasOwn`. Other odd hashes were fine.
- **Canceled photo picker** (empty selection) shows "That doesn’t look like a photo" (`snap.js:66`). Should be silent. D9e.
- **Boxes editor:** after deleting every box the hint still says "Drag boxes to move…" instead of "add a box" (`snap.js:126`). Review screen lets you remove all colors and "Save all" silently saves a gray item (D10h).
- **Long names break layout at 320 px:** an unbroken 80-char name overflows `.cell-text b` (reel) and `.look-names` (clipped, sw 734 vs cw 272), and the look-detail head is pushed off-screen. Import also accepts a 2,000,000-char name (no length cap; the form caps at 40). Needs `overflow-wrap: anywhere` plus an import cap. Screenshots: `d7-spin-320.png`, `d7-looks-320.png`, `d7-look-detail-320.png`.
- **Contrast (WCAG AA):** light mode: CERTIFIED FIT stamp 4.2 on card and 3.85 on paper (`--stamp-mint #078a5e`), Delete / Clear-all buttons 4.41 (`--stamp-tomato #d93a1c`). Dark mode: danger button "Delete it all" 2.29 (dark text `#17141f` on `#ff5a3c`... actually the confirm button sits on the tomato accent with the dark ink: 2.29 as measured; see `d13-dark-confirm-wipe.png`). Data in `adv-screenshots/contrast-*.json`. All other sampled text (about 229 samples per theme) passes.
- **Sample closet:** renaming a demo item then "Remove sample items" deletes it (E6c); "Load sample closet" again overwrites edits and wear history of demo items (E6d). Own (non-demo) items are untouched (E6a, E6b pass).
- **Undo:** only the last deletion is undoable; a second delete replaces the toast and the first can no longer be undone (E9b, `overlay.js` `toast` clears the host). Delete then Undo restores item and photo (E9a pass).
- **Two quick thumbs-up taps:** both read the old state, so result is "liked", not toggled off (E3b, `spin.js like()`). No duplicate records (E3a pass).
- **Perf:** 200 items: first spin landed in 4.3 s (limit 4 s; mostly the animation); closet 200 and 1000 items and looks passed in the runs that completed.
- **Touch targets and inputs:** 10+ controls under 44 px (selects 40 px tall, reels 28 px, ✕ chips); Occasion and Weather selects use 14 px font (iOS zooms on focus). Closet rails have no `tabindex` in the redesigned markup (D14j); the Spin tab link name was `Today` after the rename (my check D14a looked for "Spin").
- **[reel] Above the fold:** at 390x844 after a spin, meter and SPIN button are visible but the stamp (top 817, tab bar at 780) and stickers are below the fold; at 320x640 and 375x667 the SPIN button is also hidden. Whatever replaces the reels should keep stamp + score above the tab bar.
- **Keyboard:** everything else passed (Space/Enter lock, spin, lever, like, tabs, focus returned after Escape, visible focus rings).

## Check table

Result of the last completed run of each check. "n/a (redesign)" means it was disturbed by the Today redesign and should be re-run.

| Check | Result |
|---|---|
| C1 round trip: export, clear, import (replace) restores items, photos (byte-exact), feedback, settings | pass |
| C1 UI path download then wipe then restore; merge twice has no duplicates; merge keeps settings | pass |
| C1 Replace then Cancel / Cancel / Escape leaves data intact | pass |
| C2 invalid JSON, truncated (2 variants), empty, whitespace, `null`, array, string | pass (clear message, data intact) |
| C2 wrong or missing app, version 2, 999, "1", 0, -1, null | pass |
| C2 items not array / missing / null / string / array entry | pass |
| C2 PNG renamed .json; 20 MB padded valid file; 20 MB truncated file | pass |
| C2 item name number / object | **fail** (cryptic TypeError text) |
| C2 item id `true` / `{}` in replace mode | **fail** (data wiped, raw DOMException) |
| C2 other garbage fields, bad photos, feedback, settings, 3000 items | masked by the name-type error in the run; re-run after fix |
| C2 post-import app still renders every screen; hostile theme value ignored | pass |
| C2 2,000,000-char name accepted | **fail** (no cap) |
| C3 XSS via form (closet, spin, stickers, looks, review/edit sheets, toasts, undo) | **fail** (pick sheet, aria-label) |
| C3 XSS via import (names ok, hex injection) | **fail** (hex and name) |
| C3 names render literally; stickers contain only text nodes | pass |
| C4 IndexedDB unavailable (getter throws, open throws, onerror, never answers): boots, banner, in-memory spin, backup, clear-all | pass (4 variants) |
| C4 QuotaExceeded on save shows a message | **fail** (unhandled rejection, no toast) |
| D1 spin chaos: reel taps mid-spin ignored; leaving tab mid-spin never sticks | pass |
| D1 multi-tap yields one spin; Auto weather multi-tap | **fail** |
| D2 lock every reel and spin; lock then delete or wash then spin | pass |
| D4 delete everything mid-session; every screen with empty closet; delete one by one | pass |
| D5 only-tops, all-in-wash, one top + one bottom | pass |
| D6 200 and 1000 items closet / scroll / looks | pass (first spin 4.3 s) |
| D7 long / emoji / RTL names at 320 px | **fail** (overflow, see above) |
| D8 back / forward, cold deep links, odd hashes | pass except sheet-after-Back and `#/constructor` |
| D9 non-image, corrupt jpg, 0-byte, HEIC, transparent PNG, 6000x4000 JPEG (0.26 MB file, boxes and saved photo downscaled), multi-select | pass |
| D9 canceled picker | **fail** (scolding toast) |
| D10 delete all boxes, zero-size, off-screen drag, resize, skip all, leave mid-flow | pass |
| D10 hint after deleting all boxes; save with zero colors | **fail** (minor) |
| D11 offline reload per route; lazy vision modules offline | **fail** while SHELL lacked new modules; recheck |
| D11 SHELL completeness | **fail** then fixed by another agent (`taste.js`, `skin.js` now listed) |
| D12 reduced motion: lands < 1 s, no long or infinite animations, no confetti | pass |
| D13 dark and light screenshots of every screen | done (31 shots) |
| D13 contrast | **fail** (5 items, listed above) |
| D13 theme override Light / Auto follows OS | pass |
| D14 keyboard: lock, spin, lever, like, tabs, focus trap and restore | pass |
| D14 rails keyboard-scrollable | **fail** |
| D15 every control has an accessible name (all screens and sheets) | pass |
| D16 60 s seeded monkey: zero errors, no stuck modal | pass |
| E1 stale reasons: 28 spins with random locks, no sticker mentions an item not on the reels; deleting a shown item updates reels and reasons | pass |
| E2 stamp and meter above the fold | **fail** [reel] |
| E3 double-like: no duplicate records; toggle semantics | pass / **fail** |
| E4 "Worn today" tapped 3x then again: no duplicate dates | pass (checked before the redesign; re-run) |
| E5 sheet escape hatches at 320x640 and landscape | pass (before redesign; re-run) |
| E6 sample removal vs own items | pass (own items safe) / **fail** (edited demo items deleted or overwritten) |
| E7 touch targets, iOS input zoom | **fail** (minor) |
| E9 undo | pass / **fail** (only last undo) |
| E10 / E11 weather Auto denied; UI state persistence | pass |

## What to re-run after the Today redesign

`node tests/e2e/adv-ui.mjs http://localhost:8765/ D1,D2,D14,E1,E2,E3,E4,E5,D11` (selectors for `.reel`, `.spin-btn`, `.stamp`, `.tab[data-route="spin"]` will need updating to the new board), plus the whole of `adv-store.mjs` after the import validation fixes.
