// E2E for the Today experience: board, shuffle, locks, swap (Suggest / I'll pick), add/remove, glow-up, battle, custom occasions.
// Usage: node tests/e2e/today.mjs [baseURL]   (serve the repo first: python3 -m http.server 8765)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire('/opt/node22/lib/node_modules/')('playwright'); }
const { chromium } = playwright;

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:8765/';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'today-screenshots');
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const errors = [];

async function newCtx(browser, scheme = 'light', viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 700, hasTouch: viewport.width < 700, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION|FAILED|ABORTED)|net::/.test(t)) errors.push(`[console] ${t}`); } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { ctx, page };
}
const overflow = async (page) => { await page.waitForTimeout(500); await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity), null, { timeout: 5000 }).catch(() => {}); await page.waitForFunction(() => !document.querySelector('.confetti-layer'), null, { timeout: 5000 }).catch(() => {}); return overflowNow(page); };
const overflowNow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
const settle = (page) => page.waitForFunction(() => !document.querySelector('.fm-piece.fm-land') && !document.querySelector('.t-shuffle:disabled') && !document.querySelector('.confetti-layer') && document.querySelector('.t-stamp.slam, .t-stamp.shown'), null, { timeout: 15000 }).then(() => page.waitForTimeout(350));
const slots = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fm-board .fm-piece[data-item]')].map((p) => [p.dataset.slot, p.dataset.item])));
const score = (page) => page.locator('.t-meter').getAttribute('aria-valuenow').then(Number);
const selectPiece = async (page, slot) => { await page.locator(`.fm-piece[data-slot="${slot}"]`).dispatchEvent('click'); await page.waitForSelector(`.t-bar:not([hidden])`); };
const act = async (page, slot, what) => { await selectPiece(page, slot); await page.locator(`.t-bar [data-act="${what}"]`).click(); };
const D = (page, fn, arg) => page.evaluate(async ([src, a]) => { const d = await import('./src/ui/data.js'); return (new Function('d', 'a', `return (${src})(d, a)`))(d, a); }, [fn.toString(), arg]);

async function loadSample(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  await page.waitForSelector('.fm-piece[data-item]');
  await settle(page);
}

/** Give every sample item a transparent "cutout" PNG (drawn on a canvas) so the board shows photo-style pieces; also a head-and-shoulders cutout. */
async function seedArt(page, { photoOnlyShoes = true } = {}) {
  await page.evaluate(async () => {
    const store = await import('./src/store.js');
    const dat = await import('./src/ui/data.js');
    const mk = (w, h, draw) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); c.toBlob(res, 'image/png'); });
    const poly = (g, pts, fill, stroke) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 3; g.stroke(); } };
    const dk = (hex, a) => { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v + a))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
    const painters = {
      top: (g, hex, long) => { poly(g, long ? [[110, 30], [170, 18], [200, 46], [230, 18], [290, 30], [400, 300], [350, 320], [300, 150], [300, 380], [100, 380], [100, 150], [50, 320], [0, 300]] : [[110, 30], [170, 18], [200, 46], [230, 18], [290, 30], [390, 120], [345, 170], [295, 135], [295, 380], [105, 380], [105, 135], [55, 170], [10, 120]], hex, dk(hex, -50)); g.fillStyle = dk(hex, -35); g.beginPath(); g.ellipse(200, 30, 36, 20, 0, 0, Math.PI); g.fill(); },
      layer: (g, hex) => { painters.top(g, hex, true); g.strokeStyle = dk(hex, -60); g.lineWidth = 4; g.beginPath(); g.moveTo(200, 46); g.lineTo(200, 380); g.stroke(); poly(g, [[200, 46], [150, 120], [185, 130]], dk(hex, 25), dk(hex, -60)); poly(g, [[200, 46], [250, 120], [215, 130]], dk(hex, 25), dk(hex, -60)); },
      bottom: (g, hex) => { poly(g, [[90, 0], [310, 0], [335, 400], [225, 400], [200, 130], [175, 400], [65, 400]], hex, dk(hex, -50)); g.fillStyle = dk(hex, -30); g.fillRect(90, 0, 220, 26); },
      shoes: (g, hex) => { g.fillStyle = hex; g.beginPath(); g.moveTo(20, 60); g.quadraticCurveTo(60, 20, 150, 40); g.lineTo(300, 100); g.quadraticCurveTo(390, 120, 380, 170); g.lineTo(20, 170); g.closePath(); g.fill(); g.strokeStyle = dk(hex, -60); g.lineWidth = 3; g.stroke(); g.fillStyle = '#f2efe8'; g.fillRect(14, 160, 372, 26); },
      belt: (g, hex) => { g.fillStyle = hex; g.fillRect(0, 10, 400, 34); g.strokeStyle = dk(hex, -60); g.lineWidth = 3; g.strokeRect(0, 10, 400, 34); g.fillStyle = '#c9b27a'; g.fillRect(170, 4, 60, 46); g.fillStyle = hex; g.fillRect(180, 14, 40, 26); },
      neckwear: (g, hex) => { poly(g, [[110, 0], [190, 0], [175, 40], [235, 330], [150, 400], [65, 330], [125, 40]], hex, dk(hex, -60)); },
      headwear: (g, hex) => { g.fillStyle = hex; g.beginPath(); g.ellipse(200, 110, 150, 100, 0, Math.PI, 0); g.fill(); g.fillRect(40, 108, 320, 22); g.strokeStyle = dk(hex, -60); g.lineWidth = 3; g.stroke(); },
    };
    const size = { top: [400, 400], layer: [400, 400], bottom: [400, 400], shoes: [400, 190], belt: [400, 54], neckwear: [300, 400], headwear: [400, 140] };
    for (const it of dat.data.items) {
      const [w, h] = size[it.slot] || [300, 300];
      const hex = it.colors[0].hex;
      const long = it.slot === 'top' && /sweater|henley/.test(it.kind);
      if (it.slot === 'shoes' && it.kind === 'boots' && false) continue;
      const blob = await mk(w, h, (g) => painters[it.slot] && painters[it.slot](g, hex, long));
      const id = await store.putPhoto(blob);
      await dat.saveItem({ ...it, cutoutId: id }, { silent: true });
    }
    const face = await mk(400, 340, (g) => {
      g.fillStyle = '#6b6f7a'; g.beginPath(); g.ellipse(200, 340, 190, 105, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#c68b64'; g.fillRect(172, 190, 56, 70); g.beginPath(); g.ellipse(200, 140, 70, 88, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a1d17'; g.beginPath(); g.ellipse(200, 100, 78, 70, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(175, 140, 6, 0, 7); g.arc(225, 140, 6, 0, 7); g.fill();
    });
    const fid = await store.putPhoto(face);
    await dat.setSetting({ profile: { enabled: true, undertone: 'warm', depth: 'medium', contrast: 'medium', cutoutId: fid } });
    dat.emit('items');
  });
  void photoOnlyShoes;
}

const browser = await chromium.launch();
try {
  // ================= light 390x844 =================
  let { ctx, page } = await newCtx(browser, 'light');
  await loadSample(page);
  await page.screenshot({ path: `${shots}/01-today-illustrations.png` });
  let sl = await slots(page);
  check('Today shows a board with >= 4 pieces', Object.keys(sl).length >= 4, JSON.stringify(Object.keys(sl)));
  check('board is a flat-lay (no reels)', (await page.locator('.reel').count()) === 0 && (await page.locator('.fm-board').count()) === 1);
  const fitRes = await page.evaluate(() => {
    const vh = innerHeight; const dock = document.querySelector('.t-dock').getBoundingClientRect();
    const out = [];
    for (const p of document.querySelectorAll('.fm-board .fm-piece[data-item]')) {
      const r = p.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      out.push({ slot: p.dataset.slot, inView: r.top >= 0 && r.bottom <= vh && r.left >= -1 && r.right <= innerWidth + 1, clearOfDock: r.bottom <= dock.top + 1, hit: !!(top && top.closest('.fm-board')), vis: getComputedStyle(p).opacity === '1' });
    }
    return out;
  });
  check('every piece (incl. shoes) is in the viewport, clear of the dock and not covered @390x844', fitRes.length >= 4 && fitRes.every((x) => x.inView && x.clearOfDock && x.hit && x.vis) && fitRes.some((x) => x.slot === 'shoes'), JSON.stringify(fitRes.filter((x) => !(x.inView && x.clearOfDock && x.hit && x.vis))));
  const stampBox = await page.locator('.t-stamp').boundingBox();
  const sy = await page.evaluate(() => window.scrollY);
  check('stamp + meter visible without scrolling @390x844', stampBox && stampBox.y >= 0 && stampBox.y + stampBox.height <= 844 && sy === 0, JSON.stringify(stampBox));
  const meterBox = await page.locator('.t-meter').boundingBox();
  check('fit meter in viewport', meterBox && meterBox.y + meterBox.height <= 844);
  const shuffleBox = await page.locator('.t-shuffle').boundingBox();
  check('shuffle button reachable in viewport (sticky dock)', shuffleBox && shuffleBox.y + shuffleBox.height <= 844 && shuffleBox.y > 0);
  let o = await overflow(page);
  check('no horizontal overflow @390', o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
  check('default state is clean: no per-piece swap/lock/remove buttons', (await page.locator('.fm-swap, .fm-lock, .fm-x').count()) === 0 && (await page.locator('.t-bar:not([hidden])').count()) === 0);
  check('pieces are labelled buttons', await page.evaluate(() => [...document.querySelectorAll('.fm-board .fm-piece[data-item]')].every((b) => b.tagName === 'BUTTON' && /tap to change/.test(b.getAttribute('aria-label')))));
  check('first-time hint is shown', /Tap any piece/.test(await page.locator('.t-hint').textContent()) && await page.locator('.t-hint').isVisible());
  const beltBox = await page.locator('.fm-piece[data-slot="belt"]').boundingBox();
  check('belt is drawn wide and visible across the waist', !beltBox || (beltBox.width > 120 && beltBox.height >= 20), JSON.stringify(beltBox));
  await selectPiece(page, 'shoes');
  check('selecting a piece lifts it and shows a labelled toolbar (Change, Lock; no Remove for required slots)', (await page.locator('.fm-piece.is-selected[data-slot="shoes"]').count()) === 1 && (await page.locator('.t-bar [data-act="change"]').innerText()) === 'Change' && (await page.locator('.t-bar [data-act="remove"]').count()) === 0 && /Shoes/.test(await page.locator('.t-bar-name').textContent()));
  await page.waitForTimeout(350);
  check('toolbar buttons are >= 44px and inside the viewport', await page.evaluate(() => [...document.querySelectorAll('.t-bar button')].every((b) => { const r = b.getBoundingClientRect(); return r.height >= 43.5 && r.width >= 44 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })));
  await page.screenshot({ path: `${shots}/01b-selected.png` });
  await page.keyboard.press('Escape');
  check('Esc deselects', (await page.locator('.t-bar:not([hidden])').count()) === 0 && (await page.locator('.fm-piece.is-selected').count()) === 0);
  await selectPiece(page, 'top');
  await page.mouse.click(5, 300);
  check('tapping elsewhere deselects', (await page.locator('.t-bar:not([hidden])').count()) === 0);
  await page.locator('.fm-piece[data-slot="top"]').focus();
  await page.keyboard.press('Enter');
  check('Enter on a focused piece selects it', (await page.locator('.t-bar:not([hidden])').count()) === 1);
  await page.keyboard.press('Escape');

  // shuffle
  const before = await slots(page);
  let changed = false;
  for (let i = 0; i < 4 && !changed; i++) {
    await page.locator('.t-shuffle').click();
    await settle(page);
    const now = await slots(page);
    changed = JSON.stringify(now) !== JSON.stringify(before);
  }
  check('shuffle gives a different outfit', changed);
  check('all pieces fully visible after shuffle (none left faded out)', await page.evaluate(() => [...document.querySelectorAll('.fm-board .fm-piece')].every((p) => getComputedStyle(p).opacity === '1')));
  await page.screenshot({ path: `${shots}/02-after-shuffle.png` });
  check('stamp shows after shuffle', await page.locator('.t-stamp.slam, .t-stamp.shown').count() === 1 && (await page.locator('.t-stamp').textContent()).length > 2);

  // lock top, shuffle keeps it
  const topId = (await slots(page)).top;
  await act(page, 'top', 'lock');
  check('lock toggles (aria-pressed on toolbar button, badge on piece)', (await page.locator('.t-bar [data-act="lock"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('.fm-ctl[data-slot="top"] .fm-lockbadge').count()) === 1);
  await page.keyboard.press('Escape');
  let kept = true;
  for (let i = 0; i < 3; i++) { await page.locator('.t-shuffle').click(); await settle(page); if ((await slots(page)).top !== topId) kept = false; }
  check('locked top survives 3 shuffles', kept);
  await page.screenshot({ path: `${shots}/03-locked-top.png` });
  await act(page, 'top', 'lock');
  await page.keyboard.press('Escape');

  // swap via Suggest changes item + score
  const shoesBefore = (await slots(page)).shoes;
  const scoreBefore = await score(page);
  await act(page, 'shoes', 'change');
  await page.waitForSelector('dialog.sheet .sw-row');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/04-swap-suggest.png` });
  check('swap sheet is the topmost thing at its centre and cards are laid out', await page.evaluate(() => { const d = document.querySelector('dialog.sheet'); const r = d.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const row = document.querySelector('.sw-row'); const rr = row.getBoundingClientRect(); const nm = row.querySelector('b').getBoundingClientRect(); return d.contains(el) && rr.width > 250 && nm.width > 80; }));
  const hasDeltaBadges = await page.locator('.sw-delta').count();
  check('Suggest lists candidates with delta badges and a current marker', (await page.locator('.sw-row').count()) >= 2 && hasDeltaBadges >= 1 && (await page.locator('.sw-row.is-current .sw-tag').count()) === 1);
  const pickIdx = await page.evaluate(() => { const rows = [...document.querySelectorAll('.sw-row')]; return rows.findIndex((r) => !r.classList.contains('is-current') && !r.querySelector('.sw-delta.flat')); });
  await page.locator('.sw-row').nth(pickIdx).click();
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await settle(page);
  const shoesAfter = (await slots(page)).shoes;
  const scoreAfter = await score(page);
  check('Suggest swap changed the shoes', shoesAfter && shoesAfter !== shoesBefore);
  check('Suggest swap rescored', scoreAfter !== scoreBefore, `${scoreBefore} -> ${scoreAfter}`);

  // swap via I'll pick: pick the item whose delta is non-zero, no scores shown on the tab
  await act(page, 'top', 'change');
  await page.waitForSelector('dialog.sheet .sw-row');
  const target = await page.evaluate(() => { const rows = [...document.querySelectorAll('.sw-row')].filter((r) => !r.classList.contains('is-current')); rows.sort((a, b) => Math.abs(Number((b.querySelector('.sw-delta')?.textContent || '0').replace('−', '-'))) - Math.abs(Number((a.querySelector('.sw-delta')?.textContent || '0').replace('−', '-')))); return rows[0]?.dataset.item; });
  await page.getByRole('tab', { name: 'I’ll pick' }).click();
  await page.waitForSelector('.sw-tile');
  check('I’ll pick shows items with no scores or deltas', (await page.locator('.sw-panel .sw-num, .sw-panel .sw-delta').count()) === 0 && (await page.locator('.sw-tile').count()) >= 2);
  await page.screenshot({ path: `${shots}/05-swap-pick.png` });
  const topBefore = (await slots(page)).top;
  const sBefore = await score(page);
  await page.locator(`.sw-tile[data-item="${target}"]`).click();
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await page.waitForTimeout(250);
  const deltaShown = await page.locator('.t-delta-pop').count();
  await page.screenshot({ path: `${shots}/06-after-pick-delta.png` });
  await settle(page);
  const sAfter = await score(page);
  check('I’ll pick changed the top', (await slots(page)).top === target && target !== topBefore);
  check('I’ll pick rescored and showed a delta', sAfter !== sBefore ? deltaShown >= 1 : true, `${sBefore} -> ${sAfter}, pop=${deltaShown}`);
  const popBox = await page.evaluate(() => { const p = document.querySelector('.t-delta-pop'); const pill = document.querySelector('.t-occ-pill'); if (!p) return null; const a = p.getBoundingClientRect(), b = pill.getBoundingClientRect(); return { inside: !!p.closest('.t-numwrap'), overlap: !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom) }; });
  check('delta pop is anchored to the score number and does not cover the pills', !popBox || (popBox.inside && !popBox.overlap), JSON.stringify(popBox));
  check('score announced in live region', /Fit score/.test(await page.locator('#live').textContent()));

  // bottom -> joggers removes belt
  async function pickItem(slot, id) {
    await act(page, slot, 'change');
    await page.waitForSelector('dialog.sheet .sw-row');
    await page.getByRole('tab', { name: 'I’ll pick' }).click();
    await page.locator(`.sw-tile[data-item="${id}"]`).click();
    await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
    await settle(page);
  }
  await pickItem('bottom', 'demo-8');
  check('jeans bring a belt', !!(await slots(page)).belt);
  await page.screenshot({ path: `${shots}/07-jeans-with-belt.png` });
  await pickItem('bottom', 'demo-11');
  const afterJog = await slots(page);
  check('swapping to joggers removes the belt', afterJog.bottom === 'demo-11' && !afterJog.belt, JSON.stringify(afterJog));

  // add / remove a layer
  await pickItem('bottom', 'demo-9'); // chinos
  if ((await slots(page)).layer) { await act(page, 'layer', 'remove'); await settle(page); }
  check('ghost "+ layer" chip shows when no layer', await page.locator('.fm-ghost[data-slot="layer"]').count() === 1);
  await page.locator('.fm-ghost[data-slot="layer"]').click();
  await page.waitForSelector('dialog.sheet .sw-row');
  const rowIdx = await page.evaluate(() => [...document.querySelectorAll('.sw-row')].findIndex((r) => r.dataset.item !== 'none' && !r.classList.contains('is-current')));
  await page.locator('.sw-row').nth(rowIdx).click();
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await settle(page);
  check('adding a layer puts it on the board', !!(await slots(page)).layer);
  await page.screenshot({ path: `${shots}/08-with-layer.png` });
  const sc = await score(page);
  await act(page, 'layer', 'remove');
  await settle(page);
  check('× removes the layer and rescores', !(await slots(page)).layer && await page.locator('.fm-ghost[data-slot="layer"]').count() === 1, `${sc} -> ${await score(page)}`);

  // glow-up: make a weak outfit, then improve it
  await pickItem('bottom', 'demo-11'); await pickItem('top', 'demo-3'); await pickItem('shoes', 'demo-16');
  const weak = await score(page);
  await page.locator('.t-improve').click();
  await page.waitForSelector('dialog.sheet .gu-compare, dialog.sheet .gu-peak');
  const gu = await page.locator('.gu-compare').count();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shots}/09-glowup.png` });
  if (gu) {
    check('glow-up shows before/after boards and a reason', (await page.locator('.gu-compare .fm-board').count()) === 2 && (await page.locator('.gu-notes li').count()) >= 1 && /\+\d+/.test(await page.locator('.gu-scores em').textContent()));
    const slider = page.locator('.gu-compare');
    await slider.focus();
    const v0 = await slider.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const v1 = await slider.getAttribute('aria-valuenow');
    check('before/after slider works with the keyboard', Number(v1) > Number(v0), `${v0} -> ${v1}`);
    const bb = await slider.boundingBox();
    await page.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2, { steps: 4 }); await page.mouse.up();
    check('before/after slider drags with the pointer', Number(await slider.getAttribute('aria-valuenow')) < 40);
    await page.locator('.gu-actions [data-act="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
    await settle(page);
    check('glow-up Apply raises the score', (await score(page)) > weak, `${weak} -> ${await score(page)}`);
  } else {
    check('glow-up reports peak state', /peak/i.test(await page.locator('.gu-peak').textContent()));
    await page.getByRole('button', { name: 'Love that for me' }).click();
  }
  // peak state: re-run on the improved outfit until nothing is left
  for (let i = 0; i < 6; i++) {
    await page.locator('.t-improve').click();
    await page.waitForSelector('dialog.sheet .gu-compare, dialog.sheet .gu-peak');
    if (await page.locator('.gu-peak').count()) break;
    await page.locator('.gu-actions [data-act="apply"]').click();
    await page.waitForFunction(() => !document.querySelector('dialog.sheet')); await settle(page);
  }
  check('repeated glow-ups end in the cheerful peak state', (await page.locator('.gu-peak').count()) === 1 && /peak/i.test(await page.locator('.gu-peak').textContent()));
  await page.screenshot({ path: `${shots}/10-glowup-peak.png` });
  await page.getByRole('button', { name: 'Love that for me' }).click();

  // wear: hamper toast
  await page.locator('.t-wear').click();
  await page.waitForSelector('.toast');
  const toastText = await page.locator('.toast').textContent();
  check('Wearing it logs and mentions hamper when pieces went to the wash', /Logged/.test(toastText), toastText.trim());
  await page.screenshot({ path: `${shots}/11-worn.png` });

  // custom occasion
  await page.locator('.t-occ-pill').click();
  await page.waitForSelector('dialog.sheet .occ-add');
  await page.locator('.occ-add').click();
  await page.waitForSelector('dialog.sheet .occ-editor');
  await page.locator('.occ-editor input[aria-label="Occasion name"]').fill('Gallery opening');
  await page.locator('.occ-emoji-pick').nth(11).click();
  await page.locator('.occ-editor [aria-label="Least dressy"] .seg-btn[data-v="3"]').click();
  await page.locator('.occ-editor [aria-label="Most dressy"] .seg-btn[data-v="4"]').click();
  await page.screenshot({ path: `${shots}/12-custom-occasion-sheet.png` });
  await page.getByRole('button', { name: 'Add occasion' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await settle(page);
  const occ = await D(page, (d) => ({ k: d.data.settings.occasion, c: d.data.settings.customOccasions }));
  check('custom occasion saved and selected', occ.k && occ.c && occ.c[occ.k] && occ.c[occ.k].label === 'Gallery opening' && occ.c[occ.k].min === 3 && occ.c[occ.k].max === 4, JSON.stringify(occ));
  check('occasion pill shows the custom occasion', /Gallery opening/.test(await page.locator('.t-occ-pill').textContent()));
  await page.locator('.t-occ-pill').click();
  await page.waitForSelector('dialog.sheet .occ-chip');
  check('custom chip is pressed in the picker', (await page.locator(`.occ-chip[data-key="${occ.k}"]`).getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  await page.screenshot({ path: `${shots}/13-custom-selected.png` });
  // edit via the Edit chip, delete
  await page.locator('.t-occ-pill').click();
  await page.waitForSelector('dialog.sheet .occ-edit');
  await page.locator('.occ-edit').click();
  await page.waitForSelector('dialog.sheet .sheet-actions');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForSelector('dialog.sheet .confirm');
  await page.locator('dialog.sheet .confirm').getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'));
  check('custom occasion can be deleted (falls back to Anything)', (await D(page, (d) => d.data.settings.occasion)) === 'any');

  // battle
  await page.locator('.t-battle').click();
  await page.waitForSelector('.bt-card');
  await page.waitForTimeout(700);
  check('battle shows two outfit cards with boards', (await page.locator('.bt-card .fm-board').count()) === 2);
  await page.screenshot({ path: `${shots}/14-battle.png` });
  o = await overflow(page);
  check('no horizontal overflow @390 (battle)', o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
  const ev0 = await D(page, (d) => d.data.events.filter((e) => e.type === 'battle').length);
  await page.locator('.bt-card').first().click();
  await page.waitForSelector('.bt-score b');
  await page.waitForTimeout(1200);
  const ev1 = await D(page, (d) => d.data.events.filter((e) => e.type === 'battle').length);
  const evLast = await D(page, (d) => { const e = d.data.events.filter((x) => x.type === 'battle').pop(); return { w: Object.keys(e.winner || {}).length, l: Object.keys(e.loser || {}).length }; });
  check('battle vote records a battle event with winner and loser', ev1 === ev0 + 1 && evLast.w >= 2 && evLast.l >= 2, JSON.stringify(evLast));
  check('battle reveals both scores and reasons', (await page.locator('.bt-score').count()) === 2 && (await page.locator('.bt-why li').count()) >= 1);
  await page.screenshot({ path: `${shots}/15-battle-reveal.png` });
  const keys1 = await page.locator('.bt-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join('|'));
  await page.locator('[data-act="next"]').click();
  await page.waitForSelector('.bt-card:not([disabled])');
  await page.waitForTimeout(400);
  const keys2 = await page.locator('.bt-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join('|'));
  check('Next battle shows a different pairing', keys1 !== keys2);
  // taste chip after >= 5 evidence
  for (let i = 0; i < 5; i++) { await page.locator('.bt-card').first().click(); await page.waitForSelector('[data-act="next"]'); await page.waitForTimeout(500); await page.locator('[data-act="next"]').click(); await page.waitForSelector('.bt-card:not([disabled])'); }
  check('"Your taste so far" chip appears after enough battles', await page.locator('.bt-taste').count() === 1);
  await page.close(); await ctx.close();

  // ================= cutouts + face (real-photo look), light + dark + 320 =================
  ({ ctx, page } = await newCtx(browser, 'light'));
  await loadSample(page);
  await seedArt(page);
  await page.locator('.t-shuffle').click();
  await settle(page);
  await page.waitForTimeout(500);
  check('board shows the user\'s face cutout when a profile is set', (await page.locator('.fm-face img').count()) === 1);
  const fit2 = await page.evaluate(() => { const dock = document.querySelector('.t-dock').getBoundingClientRect(); return [...document.querySelectorAll('.fm-board .fm-piece')].every((p) => { const r = p.getBoundingClientRect(); return r.top >= 0 && r.bottom <= dock.top + 1; }); });
  check('face-to-shoes all visible above the dock with a face cutout @390x844', fit2);
  check('pieces upgrade to cutouts', (await page.locator('.fm-piece.is-cutout').count()) >= 3);
  await page.screenshot({ path: `${shots}/16-cutouts-face-light.png` });
  await page.screenshot({ path: `${shots}/16b-cutouts-face-light-full.png`, fullPage: true });
  o = await overflow(page);
  check('no horizontal overflow with cutouts', o.sw <= o.cw && o.bw <= o.cw);
  // dark
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.setSetting({ theme: 'dark' }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/17-cutouts-face-dark.png` });
  await page.screenshot({ path: `${shots}/17b-cutouts-face-dark-full.png`, fullPage: true });
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.setSetting({ theme: 'light' }); });
  await page.close(); await ctx.close();

  ({ ctx, page } = await newCtx(browser, 'light', { width: 320, height: 640 }));
  await loadSample(page);
  await seedArt(page);
  await page.locator('.t-shuffle').click(); await settle(page); await page.waitForTimeout(400);
  o = await overflow(page);
  check('no horizontal overflow @320 (today)', o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
  const st320 = await page.locator('.t-stamp').boundingBox();
  check('top-to-shoes visible @320x640', await page.evaluate(() => { const dock = document.querySelector('.t-dock').getBoundingClientRect(); const ps = [...document.querySelectorAll('.fm-board .fm-piece[data-item]')]; return ps.some((p) => p.dataset.slot === 'shoes') && ps.every((p) => { const r = p.getBoundingClientRect(); return r.top >= 0 && r.bottom <= dock.top + 1; }); }));
  check('stamp visible @320x640 without scrolling', st320 && st320.y + st320.height <= 640 && st320.x >= 0 && st320.x + st320.width <= 320, JSON.stringify(st320));
  const sh320 = await page.locator('.t-shuffle').boundingBox();
  check('SHUFFLE visible @320x640', sh320 && sh320.y + sh320.height <= 640 && sh320.y > 0, JSON.stringify(sh320));
  await page.screenshot({ path: `${shots}/18-today-320.png` });
  await page.screenshot({ path: `${shots}/18b-today-320-full.png`, fullPage: true });
  await act(page, 'top', 'change');
  await page.waitForSelector('.sw-row');
  await page.screenshot({ path: `${shots}/19-swap-320.png` });
  const so = await page.evaluate(() => { const b = document.querySelector('dialog.sheet .sheet-body'); return b.scrollWidth - b.clientWidth; });
  check('swap sheet has no horizontal overflow @320', so <= 1, String(so));
  await page.keyboard.press('Escape');
  await page.locator('.t-battle').click();
  await page.waitForSelector('.bt-card'); await page.waitForTimeout(700);
  o = await overflow(page);
  check('no horizontal overflow @320 (battle)', o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
  await page.screenshot({ path: `${shots}/20-battle-320.png` });
  await page.close(); await ctx.close();

  // dark mode battle + desktop
  ({ ctx, page } = await newCtx(browser, 'dark', { width: 1280, height: 900 }));
  await loadSample(page);
  await seedArt(page);
  await page.locator('.t-shuffle').click(); await settle(page); await page.waitForTimeout(400);
  o = await overflow(page);
  check('no horizontal overflow on desktop', o.sw <= o.cw && o.bw <= o.cw);
  await page.screenshot({ path: `${shots}/21-desktop-dark.png` });
  await page.locator('.t-battle').click();
  await page.waitForSelector('.bt-card'); await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/22-battle-desktop-dark.png` });
  await page.close(); await ctx.close();

  // ================= edge states =================
  ({ ctx, page } = await newCtx(browser, 'light'));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.onboard')?.remove());
  await page.waitForSelector('.empty');
  check('empty closet state', /blank page/.test(await page.locator('.empty h2').textContent()));
  await page.screenshot({ path: `${shots}/23-empty.png` });
  // only tops
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); const { makeItem } = await import('./src/model.js'); await d.saveItem(makeItem({ slot: 'top', kind: 't-shirt', name: 'Lone tee' })); });
  await page.waitForFunction(() => /need a bottom/.test(document.querySelector('.empty h2')?.textContent || ''));
  check('only-tops state asks for a bottom', true);
  await page.screenshot({ path: `${shots}/24-only-tops.png` });
  // everything in the hamper -> laundry day shortcut
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.loadDemo(); });
  await page.waitForSelector('.fm-piece[data-item]');
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); for (const it of d.data.items) await d.saveItem({ ...it, available: false }, { silent: true }); d.emit('items'); });
  await page.waitForSelector('[data-act="laundry"]');
  check('everything in the hamper offers Laundry Day', true);
  await page.screenshot({ path: `${shots}/25-all-in-wash.png` });
  await page.locator('[data-act="laundry"]').click();
  await page.waitForSelector('.fm-piece[data-item]');
  await settle(page);
  check('Laundry Day brings the board back', (await page.locator('.fm-piece[data-item]').count()) >= 4);
  await page.close(); await ctx.close();
} catch (e) {
  console.error(e);
  check('script ran to completion', false, e.message);
} finally {
  await browser.close();
}
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
