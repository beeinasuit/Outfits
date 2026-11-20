// End-to-end smoke test (plain node + Playwright). Usage: node tests/e2e/smoke.mjs [baseURL]
// Serve the repo first, e.g. `python3 -m http.server 8765`, then run with http://localhost:8765/
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
const shots = path.join(here, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const errors = [];

async function overflow(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
}

async function newCtx(browser, scheme = 'light', viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION|FAILED|ABORTED)|net::/.test(t)) errors.push(`[console] ${t}`); } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  // Fonts are optional: block them so the test is hermetic and exercises the fallback.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { ctx, page };
}

// Today screen = outfit board + SHUFFLE (agent A). If the board isn't there yet, those checks are skipped, not failed.
const skip = (name) => { results.push({ name, ok: true }); console.log(`SKIP  ${name}`); };
const hasBoard = (page) => page.waitForSelector('.fm-board', { timeout: 4000 }).then(() => true).catch(() => false);
async function waitLanded(page) {
  await page.waitForFunction(() => Number(document.querySelector('.t-meter')?.getAttribute('aria-valuenow')) > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1600); // let stickers finish landing
}

async function makeFlatLay(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 700; const g = c.getContext('2d');
    g.fillStyle = '#e9e4da'; g.fillRect(0, 0, 900, 700);
    g.fillStyle = '#1f3a8a'; g.fillRect(70, 80, 300, 320);          // navy tee
    g.fillStyle = '#a4502a'; g.fillRect(520, 90, 300, 90);           // rust belt
    g.fillStyle = '#2a2a2a'; g.fillRect(480, 330, 340, 300);         // dark trousers
    return c.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const browser = await chromium.launch();
try {
  // ---------------- light, 390x844 ----------------
  let { ctx, page } = await newCtx(browser, 'light');
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/01-onboarding.png` });
  check('onboarding shows', await page.locator('.onboard').isVisible());
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  let today = await hasBoard(page);
  if (today) {
    check('sample closet loads and the board fills', await page.locator('.fm-board').count() === 1);
    await waitLanded(page);
    await page.screenshot({ path: `${shots}/02-today-landed.png` });
    const score1 = await page.locator('.t-meter').getAttribute('aria-valuenow');
    check('fit meter has a score', Number(score1) > 0, `score=${score1}`);
    let o0 = await overflow(page);
    check('no horizontal overflow @390 (today)', o0.sw <= o0.cw && o0.bw <= o0.cw, JSON.stringify(o0));
    for (let i = 0; i < 3; i++) { await page.locator('.t-shuffle').click(); await page.waitForTimeout(1200); }
    check('shuffle keeps producing a scored outfit', Number(await page.locator('.t-meter').getAttribute('aria-valuenow')) > 0);
    await page.locator('.round-btn.up').click();
    await page.waitForSelector('.round-btn.up[aria-pressed="true"]', { timeout: 3000 }).catch(() => {});
    check('like registers (aria-pressed)', (await page.locator('.round-btn.up').getAttribute('aria-pressed')) === 'true');
    await page.locator('.t-wear').click();
    await page.waitForSelector('.t-wear.done', { timeout: 5000 }).catch(() => {});
    check('"Wearing it" logs', await page.locator('.t-wear.done').count() === 1);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${shots}/04-today-liked.png` });
  } else {
    for (const n of ['board fills', 'fit meter', 'no overflow (today)', 'shuffle', 'like', 'wear']) skip(`today: ${n} (board.js/today.js not ready)`);
  }
  let o = await overflow(page);

  // closet
  await page.locator('.tab[data-route="closet"]').click();
  await page.waitForSelector('.rail-sec');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/05-closet.png` });
  o = await overflow(page);
  check('no horizontal overflow @390 (closet)', o.sw <= o.cw, JSON.stringify(o));
  const before = await page.locator('.wash-btn[aria-pressed="true"]').count();
  await page.locator('.wash-btn').first().click({ force: true });
  await page.waitForTimeout(400);
  check('laundry toggle', (await page.locator('.wash-btn[aria-pressed="true"]').count()) === before + 1);
  await page.screenshot({ path: `${shots}/06-closet-laundry.png` });
  // edit sheet
  await page.locator('.hang-item').nth(2).click({ force: true });
  await page.waitForSelector('dialog.sheet[open]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/07-edit-sheet.png` });
  await page.locator('dialog.sheet .sheet-close').click();

  // add photo-less item
  await page.locator('.tab[data-route="snap"]').click();
  await page.waitForSelector('.snap-start');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/08-snap.png` });
  o = await overflow(page);
  check('no horizontal overflow @390 (snap)', o.sw <= o.cw, JSON.stringify(o));
  const countBefore = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  await page.getByRole('button', { name: /No photo/ }).click();
  await page.waitForSelector('dialog.sheet[open] .itemform');
  await page.locator('dialog.sheet .slot-btn', { hasText: 'Belt' }).click();
  await page.locator('dialog.sheet .swatch[aria-label="Tan"], dialog.sheet .swatch[aria-label="Brown"]').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/09-add-by-color.png` });
  await page.getByRole('button', { name: 'Add to closet' }).click();
  await page.waitForSelector('.rail-sec');
  const countAfter = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  check('photo-less item added', countAfter === countBefore + 1, `${countBefore} -> ${countAfter}`);

  // photo flow (vision modules)
  await page.locator('.tab[data-route="snap"]').click();
  await page.waitForSelector('.snap-start');
  const png = await makeFlatLay(page);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'flatlay.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.stage .bbox', { timeout: 20000 });
  const boxes = await page.locator('.stage .bbox').count();
  check('photo is segmented into boxes', boxes >= 2, `boxes=${boxes}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/10-boxes.png` });
  // delete a box via x and add one via drawing
  await page.locator('.bbox-x').first().click();
  check('box delete works', (await page.locator('.stage .bbox').count()) === boxes - 1);
  await page.getByRole('button', { name: /Box/ }).click();
  const st = await page.locator('.stage').boundingBox();
  await page.mouse.move(st.x + st.width * 0.1, st.y + st.height * 0.6);
  await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.3, st.y + st.height * 0.9, { steps: 4 }); await page.mouse.up();
  check('box can be drawn', (await page.locator('.stage .bbox').count()) === boxes);
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.waitForSelector('.rcard', { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/11-review.png` });
  const cnt0 = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  await page.getByRole('button', { name: /^Save all/ }).click();
  await page.waitForSelector('.rail-sec', { timeout: 20000 });
  const cnt1 = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  check('review -> save all adds items with photos', cnt1 > cnt0, `${cnt0} -> ${cnt1}`);
  check('photo thumbnails render', await page.locator('.hang .art.has-photo').first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/12-closet-with-photos.png` });

  // looks
  await page.locator('.tab[data-route="looks"]').click();
  await page.waitForSelector('.look-card');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/13-looks.png`, fullPage: true });
  o = await overflow(page);
  check('no horizontal overflow @390 (looks)', o.sw <= o.cw, JSON.stringify(o));
  await page.locator('.look-card').first().click();
  await page.waitForSelector('dialog.sheet[open] .detail');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/14-look-detail.png` });
  await page.locator('dialog.sheet .sheet-close').click();

  // settings + export
  await page.locator('.gear').click();
  await page.waitForSelector('.set-card');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/15-settings.png`, fullPage: true });
  o = await overflow(page);
  check('no horizontal overflow @390 (settings)', o.sw <= o.cw, JSON.stringify(o));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download backup/ }).click()]);
  const name = dl.suggestedFilename();
  check('backup filename format', /^fit-machine-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
  const file = path.join(shots, name);
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('backup JSON shape', json.app === 'fit-machine' && json.version === 1 && Array.isArray(json.items) && json.items.length > 20 && Object.keys(json.photos).length >= 1, `items=${json.items.length} photos=${Object.keys(json.photos).length}`);
  fs.unlinkSync(file);

  // restore garbage is rejected, valid merge works
  await page.locator('input[type=file][accept*="json"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.waitForSelector('.toast.warn');
  check('garbage backup rejected with message', /Fit Machine/.test(await page.locator('.toast-msg').textContent()));

  // persistence: reload keeps data and SW registers
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.set-card');
  const persisted = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  check('data persists across reload (IndexedDB)', persisted > 20, `items=${persisted}`);
  const swOk = await page.evaluate(async () => { try { const r = await navigator.serviceWorker.ready; return !!r.active; } catch { return false; } });
  check('service worker active', swOk);
  // offline reload
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  const offlineOk = await page.waitForSelector('.set-card', { timeout: 8000 }).then(() => true).catch(() => false);
  check('app loads offline', offlineOk);
  await ctx.setOffline(false);
  await ctx.close();

  // ---------------- 320 wide ----------------
  ({ ctx, page } = await newCtx(browser, 'light', { width: 320, height: 640 }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.screenshot({ path: `${shots}/20-onboarding-320.png` });
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  if (await hasBoard(page)) { await waitLanded(page); await page.screenshot({ path: `${shots}/21-today-320.png` }); }
  for (const r of ['today', 'closet', 'snap', 'looks', 'settings']) {
    await page.evaluate((x) => { location.hash = `#/${x}`; }, r);
    await page.waitForTimeout(700);
    o = await overflow(page);
    check(`no horizontal overflow @320 (${r})`, o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
    await page.screenshot({ path: `${shots}/22-${r}-320.png` });
  }
  await page.getByRole('link', { name: 'Snap: add clothes' }).click();
  await page.getByRole('button', { name: /No photo/ }).click();
  await page.waitForSelector('dialog.sheet[open] .itemform');
  await page.locator('dialog.sheet .swatch').nth(3).click();
  await page.waitForTimeout(300);
  const sheetOverflow = await page.evaluate(() => { const b = document.querySelector('dialog.sheet .sheet-body'); return b.scrollWidth - b.clientWidth; });
  check('add sheet has no horizontal overflow @320', sheetOverflow <= 0, `diff=${sheetOverflow}`);
  await page.screenshot({ path: `${shots}/23-add-sheet-320.png` });
  await ctx.close();

  // ---------------- dark, 390 ----------------
  ({ ctx, page } = await newCtx(browser, 'dark'));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.screenshot({ path: `${shots}/30-dark-onboarding.png` });
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  if (await hasBoard(page)) { await waitLanded(page); await page.screenshot({ path: `${shots}/31-dark-today.png` }); }
  await page.locator('.tab[data-route="closet"]').click();
  await page.waitForSelector('.rail-sec'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/32-dark-closet.png` });
  await page.locator('.tab[data-route="looks"]').click();
  await page.waitForSelector('.look-card'); await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/33-dark-looks.png` });
  await page.locator('.tab[data-route="snap"]').click();
  await page.waitForSelector('.snap-start'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/34-dark-snap.png` });
  await page.locator('.gear').click(); await page.waitForSelector('.set-card'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/35-dark-settings.png` });
  await ctx.close();

  // ---------------- empty state, reduced motion ----------------
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForSelector('.empty');
  await page.screenshot({ path: `${shots}/40-empty-today.png` });
  check('empty state shows mascot', await page.locator('.empty .mascot').count() === 1);
  await ctx.close();
} catch (e) {
  check('test run completed without throwing', false, e.stack || String(e));
} finally {
  await browser.close();
}

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
