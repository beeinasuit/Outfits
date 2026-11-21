// E2E for the fit check: photo -> line up -> matches -> score -> diary -> Lookbook -> delete/undo, roast, XSS, 320px.
// Usage: node tests/e2e/check.mjs [baseURL]   (serve the repo first: python3 -m http.server 8765)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire('/opt/node22/lib/node_modules/')('playwright'); }
const { chromium } = playwright;

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:8765/';
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'check-screenshots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const errors = [];

/** Draw a person (head, top, pants, shoes) on a plain wall and return PNG bytes. */
async function personPng(page, { top = '#1f2a44', pants = '#d8c3a0', shoes = '#6b4a2f' } = {}) {
  const b64 = await page.evaluate(async ({ top, pants, shoes }) => {
    const W = 360, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#ece7dd'; g.fillRect(0, 0, W, H);
    const rect = (x0, y0, x1, y1, col) => { g.fillStyle = col; g.fillRect(x0, y0, x1 - x0, y1 - y0); };
    const cx = W / 2, tw = 62;
    rect(cx - tw, H * 0.47, cx - 5, H * 0.88, pants); rect(cx + 5, H * 0.47, cx + tw, H * 0.88, pants);
    rect(cx - tw - 10, H * 0.9, cx - 4, H * 0.97, shoes); rect(cx + 4, H * 0.9, cx + tw + 10, H * 0.97, shoes);
    rect(cx - tw - 28, H * 0.215, cx - tw, H * 0.4, top); rect(cx + tw, H * 0.215, cx + tw + 28, H * 0.4, top);
    rect(cx - tw - 28, H * 0.4, cx - tw - 6, H * 0.46, '#d9a07c'); rect(cx + tw + 6, H * 0.4, cx + tw + 28, H * 0.46, '#d9a07c');
    rect(cx - tw, H * 0.2, cx + tw, H * 0.48, top);
    rect(cx - 12, H * 0.17, cx + 12, H * 0.21, '#d9a07c');
    g.fillStyle = '#d9a07c'; g.beginPath(); g.ellipse(cx, H * 0.11, 30, 40, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1d14'; g.beginPath(); g.ellipse(cx, H * 0.075, 31, 20, 0, 0, Math.PI * 2); g.fill();
    // light noise like a real photo
    const im = g.getImageData(0, 0, W, H);
    for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 10; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
    g.putImageData(im, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  }, { top, pants, shoes });
  const f = path.join(os.tmpdir(), `fit-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  return f;
}

const overflow = async (page) => { await page.waitForTimeout(700); return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); };
const settle = (page) => page.waitForFunction(() => !document.querySelector('.confetti-layer'), null, { timeout: 6000 }).catch(() => {});

async function newCtx(browser, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/fonts\.(googleapis|gstatic)|ERR_|net::/.test(t)) errors.push(`[console] ${t}`); } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { ctx, page };
}

async function loadSample(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  await page.waitForSelector('.fm-piece[data-item]');
}

async function toAlign(page, png) {
  await page.evaluate(() => { location.hash = '#/check'; });
  await page.waitForSelector('.ck-start');
  await page.locator('input[aria-label^="Choose an outfit photo"]').setInputFiles(png);
  await page.waitForSelector('.ck-stage .ck-handle', { timeout: 15000 });
}
async function toWhat(page) {
  await page.locator('[data-act="read"]').click();
  await page.waitForSelector('.ck-band[data-slot="top"]', { timeout: 15000 });
}
const matchNames = (page, slot) => page.locator(`.ck-band[data-slot="${slot}"] .ck-match b`).allTextContents();

const server = null;
const browser = await chromium.launch();
try {
  const { ctx, page } = await newCtx(browser);
  await loadSample(page);

  // ---- entry point on Today ----
  const entry = page.locator('a.ck-entry');
  check('Today has the "Rate what I\'m wearing" button', await entry.count() === 1 && /Rate what I/.test(await entry.textContent()));
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  await page.waitForSelector('.ck-start');
  check('button opens #/check', page.url().endsWith('#/check'));
  check('start screen mirrors the hint', /head to toe/i.test(await page.locator('.ck-tip').textContent()));
  const ov0 = await overflow(page); check('start: no horizontal scroll at 390', ov0.sw <= ov0.cw, JSON.stringify(ov0));
  await page.screenshot({ path: path.join(shots, '1-start.png') });

  // ---- capture + line up ----
  const png = await personPng(page);
  await page.locator('input[aria-label^="Choose an outfit photo"]').setInputFiles(png);
  await page.waitForSelector('.ck-stage .ck-handle', { timeout: 15000 });
  const handles = page.locator('.ck-handle');
  check('four draggable handles (neck, waist, hem, ankles)', await handles.count() === 4);
  const boxes = await page.locator('.ck-grip').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
  check('handles are >= 44px touch targets', boxes.every(([w, hgt]) => w >= 44 && hgt >= 44), JSON.stringify(boxes));
  const neck = page.locator('.ck-handle[data-key="neck"]');
  const v0 = Number(await neck.getAttribute('aria-valuenow'));
  await neck.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const v1 = Number(await neck.getAttribute('aria-valuenow'));
  check('keyboard moves a handle', v1 === v0 + 2, `${v0} -> ${v1}`);
  const waist = page.locator('.ck-handle[data-key="waist"] .ck-grip');
  const wb = await waist.boundingBox(); const w0 = Number(await page.locator('.ck-handle[data-key="waist"]').getAttribute('aria-valuenow'));
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await page.mouse.down(); await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2 + 12, { steps: 4 }); await page.mouse.up();
  const w1 = Number(await page.locator('.ck-handle[data-key="waist"]').getAttribute('aria-valuenow'));
  check('dragging a handle moves it', w1 > w0, `${w0} -> ${w1}`);
  await neck.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: path.join(shots, '2-align.png') });
  const ov1 = await overflow(page); check('align: no horizontal scroll', ov1.sw <= ov1.cw);

  // ---- pieces ----
  await toWhat(page);
  const topM = await matchNames(page, 'top'), botM = await matchNames(page, 'bottom'), shoeM = await matchNames(page, 'shoes');
  check('top: Navy oxford is the first match', topM[0] === 'Navy oxford', topM.join(' | '));
  check('bottom: Khaki chinos is the first match', botM[0] === 'Khaki chinos', botM.join(' | '));
  check('shoes: Brown boots is the first match', shoeM[0] === 'Brown boots', shoeM.join(' | '));
  check('detected colors are shown to the user', (await page.locator('.ck-band[data-slot="top"] .ck-saw').textContent()).toLowerCase().includes('navy'));
  check('Continue is disabled until top and bottom are picked', await page.locator('.ck-continue').isDisabled());
  const ov2 = await overflow(page); check('pieces: no horizontal scroll', ov2.sw <= ov2.cw);
  await page.screenshot({ path: path.join(shots, '3-pieces.png') });
  for (const slot of ['top', 'bottom', 'shoes']) await page.locator(`.ck-band[data-slot="${slot}"] .ck-match`).first().click();
  check('tapping a match confirms it', await page.locator('.ck-band.done').count() === 3);
  check('belt offered when the chinos have loops and a belt is owned', await page.locator('.ck-opt[data-slot="belt"]').count() === 1);
  await page.locator('.ck-opt[data-slot="belt"]').click();
  await page.locator('dialog.sheet .sw-tile').first().waitFor();
  await page.keyboard.press('Escape');
  check('Continue enables', await page.locator('.ck-continue').isEnabled());

  // ---- score ----
  await page.locator('.ck-continue').click();
  await page.waitForSelector('.ck-score .t-meter');
  await page.waitForFunction(() => Number(document.querySelector('.ck-score .t-meter').getAttribute('aria-valuenow')) > 0, null, { timeout: 8000 });
  const score = Number(await page.locator('.ck-score .t-meter').getAttribute('aria-valuenow'));
  check('a score appears', score > 0 && score <= 100, String(score));
  await page.waitForTimeout(1200);
  check('"How it looks on you" nudges to set up colors when there is no profile', await page.locator('.ck-you.nudge a[href="#/profile"]').count() === 1);
  check('pieces list shows what you wore', (await page.locator('.ck-piece-list li').count()) >= 3);
  check('a best swap (or peak) card is shown', await page.locator('.ck-swap').count() === 1);
  await settle(page);
  await page.screenshot({ path: path.join(shots, '4-score.png'), fullPage: true });
  const ov3 = await overflow(page); check('score: no horizontal scroll', ov3.sw <= ov3.cw);

  // ---- log it (with an XSS attempt in the note) ----
  await page.locator('.ck-mood[data-mood="love"]').click();
  check('mood is pressed', await page.locator('.ck-mood[data-mood="love"]').getAttribute('aria-pressed') === 'true');
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await page.locator('.ck-note').fill(evil);
  await page.locator('.ck-save').click();
  await page.waitForSelector('.ck-saved-msg', { timeout: 10000 });
  check('saved to the diary', await page.locator('.ck-saved-msg').count() === 1);
  const wornSaved = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return { checks: d.data.checks.length, worn: d.data.items.filter((i) => i.worn.length).map((i) => i.name), note: d.data.checks[0].note, hasPhoto: !!d.data.checks[0].photoId, mood: d.data.checks[0].mood, ids: Object.keys(d.data.checks[0].itemIds) }; });
  check('check saved with photo, mood, items', wornSaved.checks === 1 && wornSaved.hasPhoto && wornSaved.mood === 'love' && wornSaved.ids.includes('top'), JSON.stringify(wornSaved));
  check('matched closet pieces were logged as worn', ['Navy oxford', 'Khaki chinos', 'Brown boots'].every((n) => wornSaved.worn.includes(n)), wornSaved.worn.join(', '));
  check('a like was recorded for the loved outfit', await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return Object.values(d.data.feedback).includes('like'); }));
  await settle(page);

  // ---- Lookbook diary ----
  await page.locator('a[href="#/looks"].btn').first().click().catch(async () => { await page.evaluate(() => { location.hash = '#/looks'; }); });
  await page.waitForSelector('.ck-diary-card', { timeout: 10000 });
  check('diary strip shows the fit check', await page.locator('.ck-diary-card').count() === 1);
  await page.waitForFunction(() => document.querySelector('.ck-diary-card img.ck-diary-photo'), null, { timeout: 5000 }).catch(() => {});
  check('diary card shows the photo and a score', await page.locator('.ck-diary-card img.ck-diary-photo').count() === 1 && /\d+/.test(await page.locator('.ck-diary-score').textContent()));
  await page.locator('.ck-diary-card').click();
  await page.waitForSelector('dialog.sheet .ck-detail');
  const noteText = await page.locator('.ck-detail-note').textContent();
  check('note is shown as plain text (XSS escaped)', noteText === evil.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200), noteText);
  check('XSS did not run', await page.evaluate(() => window.__xss === undefined));
  check('no <img>/<script> injected from the note', await page.locator('.ck-detail-note img, .ck-detail-note script').count() === 0);
  check('detail lists the items', (await page.locator('.ck-detail .detail-list li').count()) >= 3);
  await page.screenshot({ path: path.join(shots, '5-detail.png') });
  await page.locator('[data-act="delete-check"]').click();
  await page.locator('dialog.sheet button', { hasText: /^Delete$/ }).last().click();
  await page.waitForFunction(() => !document.querySelector('.ck-diary-card'), null, { timeout: 5000 });
  check('delete removes it from the diary', true);
  await page.locator('.toast-btn', { hasText: 'Undo' }).click();
  await page.waitForSelector('.ck-diary-card', { timeout: 5000 });
  check('undo brings it back', true);
  check('Lookbook: no horizontal scroll', (await overflow(page)).sw <= (await overflow(page)).cw);

  // ---- roast: a wedding in a graphic tee ----
  await page.evaluate(() => { location.hash = '#/check'; });
  await page.waitForSelector('.ck-start, .ck-scoreview, .ck-what, .ck-align');
  const png2 = await personPng(page, { top: '#d13b3b', pants: '#1c1c1e', shoes: '#f5f5f2' });
  await page.evaluate(() => { location.hash = '#/today'; }); await page.evaluate(() => { location.hash = '#/check'; });
  await page.waitForSelector('.ck-scoreview, .ck-start');
  if (await page.locator('[data-act="again"]').count()) await page.locator('[data-act="again"]').click();
  await page.waitForSelector('.ck-start');
  await page.locator('input[aria-label^="Choose an outfit photo"]').setInputFiles(png2);
  await page.waitForSelector('.ck-stage .ck-handle', { timeout: 15000 });
  await toWhat(page);
  await page.locator('.ck-band[data-slot="top"] [data-act="extra"]').click();
  await page.locator('dialog.sheet [data-kind="graphic tee"]').click();
  await page.locator('[data-act="use-extra"]').click();
  await page.locator('.ck-band[data-slot="bottom"] [data-act="extra"]').click();
  await page.locator('dialog.sheet [data-kind="athletic shorts"]').click();
  await page.locator('[data-act="use-extra"]').click();
  check('"Not in my closet" makes a one-off piece', (await page.locator('.ck-band[data-slot="top"] .ck-match.on small').textContent()).includes('Not in closet'));
  await page.locator('.ck-continue').click();
  await page.waitForSelector('.ck-score .t-meter');
  await page.locator('.occ-chip[data-key="wedding"]').click();
  await page.waitForSelector('.ck-roast:not([hidden])', { timeout: 8000 });
  // let the count-up and sticker animations finish before reading numbers or taking the picture
  await page.waitForFunction(() => document.querySelector('.ck-score .t-num').textContent === document.querySelector('.ck-score .t-meter').getAttribute('aria-valuenow'), null, { timeout: 8000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity), null, { timeout: 8000 }).catch(() => {});
  await settle(page);
  const roastTxt = await page.locator('.ck-roast').textContent();
  const sc2 = Number(await page.locator('.ck-score .t-meter').getAttribute('aria-valuenow'));
  const num2 = Number(await page.locator('.ck-score .t-num').textContent());
  const swapNow = (await page.locator('.ck-swap-text small').last().textContent()).match(/(\d+) → (\d+)/);
  check('meter number, aria value and the best move\'s "before" score all agree', num2 === sc2 && swapNow && Number(swapNow[1]) === sc2, `${num2}/${sc2}/${swapNow && swapNow[0]}`);
  check('roast level matches the score band (<55 = full roast)', (sc2 < 55) === /The roast/.test(roastTxt), `${sc2}`);
  check('"What\'s working" and "Easy fixes" are never empty boxes', (await page.locator('.ck-card:has(> h3:text-is("What’s working")), .ck-card:has(> h3:text-is("Easy fixes"))').evaluateAll((els) => els.map((e) => e.innerText.trim().length))).every((n) => n > 30));
  check('roast sentences have no template leftovers', !/[{}]|undefined|null|\s{3,}/.test(roastTxt));
  check('a bad score gets roasted', sc2 < 55 && /🔥/.test(roastTxt) && (await page.locator('.ck-roast-lines li').count()) >= 2, `${sc2}: ${roastTxt.slice(0, 160)}`);
  check('roast ends with the rescue swap', /\+\d+/.test(await page.locator('.ck-roast-lines li.fix').textContent()));
  await page.screenshot({ path: path.join(shots, '6-roast.png'), fullPage: true });
  await page.locator('[data-act="go-easy"]').click();
  await page.waitForSelector('.ck-roast-off');
  check('"Go easy on me" turns the roast off and remembers it', await page.locator('.ck-roast-lines').count() === 0 && await page.evaluate(async () => (await import('./src/ui/data.js')).data.settings.roast === false));
  await page.locator('[data-act="go-easy"]').click();
  await page.waitForSelector('.ck-roast-lines');
  check('roast can come back', await page.locator('.ck-roast-lines').count() === 1);
  await page.locator('[data-act="add-closet"]').first().scrollIntoViewIfNeeded();
  const before = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
  await page.locator('[data-act="add-closet"]').first().click();
  await page.waitForFunction((n) => import('./src/ui/data.js').then((d) => d.data.items.length === n + 1), before);
  check('"Add to closet" adds the one-off piece', true);
  await ctx.close();

  // ---- a bad photo shows a friendly reason ----
  {
    const { ctx: c2, page: p2 } = await newCtx(browser);
    await loadSample(p2);
    const blank = await p2.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#cccccc'; g.fillRect(0, 0, 300, 500); const b = await new Promise((r) => c.toBlob(r, 'image/png')); const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); });
    const f = path.join(os.tmpdir(), `blank-${Date.now()}.png`); fs.writeFileSync(f, Buffer.from(blank, 'base64'));
    await toAlign(p2, f);
    await p2.locator('[data-act="read"]').click();
    await p2.waitForSelector('.ck-problem', { timeout: 10000 });
    check('a blank photo gets a friendly message and a manual option', /blank|spot you/i.test(await p2.locator('.ck-problem').textContent()) && await p2.locator('[data-act="manual"]').count() === 1);
    await p2.locator('[data-act="manual"]').click();
    await p2.waitForSelector('.ck-band[data-slot="top"]');
    await p2.locator('.ck-band[data-slot="top"] [data-act="else"]').click();
    await p2.locator('dialog.sheet .sw-tile').first().click();
    await p2.locator('.ck-band[data-slot="bottom"] [data-act="else"]').click();
    await p2.locator('dialog.sheet .sw-tile').first().click();
    check('manual path works', await p2.locator('.ck-continue').isEnabled());
    await c2.close();
  }

  // ---- 320px, dark mode ----
  {
    const { ctx: c3, page: p3 } = await newCtx(browser, 320);
    await p3.emulateMedia({ colorScheme: 'dark' });
    await loadSample(p3);
    const f = await personPng(p3);
    await toAlign(p3, f);
    let o = await overflow(p3); check('320px align: no horizontal scroll', o.sw <= o.cw, JSON.stringify(o));
    const g320 = await p3.locator('.ck-grip').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
    check('320px: handles stay on screen', g320.every(Boolean));
    await toWhat(p3);
    o = await overflow(p3); check('320px pieces: no horizontal scroll', o.sw <= o.cw, JSON.stringify(o));
    for (const slot of ['top', 'bottom', 'shoes']) await p3.locator(`.ck-band[data-slot="${slot}"] .ck-match`).first().click();
    await p3.locator('.ck-continue').click();
    await p3.waitForSelector('.ck-score .t-meter');
    await p3.waitForTimeout(1500); await settle(p3);
    o = await overflow(p3); check('320px score: no horizontal scroll', o.sw <= o.cw, JSON.stringify(o));
    await p3.screenshot({ path: path.join(shots, '7-score-320-dark.png'), fullPage: true });
    await p3.evaluate(() => { location.hash = '#/looks'; });
    await p3.waitForSelector('.ck-diary');
    o = await overflow(p3); check('320px lookbook: no horizontal scroll', o.sw <= o.cw, JSON.stringify(o));
    await c3.close();
  }
} catch (e) {
  check('script completed without throwing', false, e.stack || String(e));
} finally {
  await browser.close();
}
check('no console errors', errors.length === 0, errors.slice(0, 4).join(' || '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
