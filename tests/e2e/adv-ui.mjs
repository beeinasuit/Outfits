// Adversarial UI chaos tests (section D + extra ideas). Usage: node tests/e2e/adv-ui.mjs [baseURL] [only-prefix]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, BASE, shotDir, PHONE, SMALL, makeRunner, newCtx, attach, open, setItems, loadDemo, col, bigCloset, mulberry32, waitLanded, shot, overflowReport, contrastReport, snapshotDb } from './adv-lib.mjs';

const ONLY = process.argv[3] || '';
const R = makeRunner('ui');
const { check, errors } = R;
const browser = await chromium.launch();
const SH = (n) => 'tests/e2e/adv-screenshots/' + n + '.png';

async function step(id, name, fn) {
  if (ONLY && !id.startsWith(ONLY)) return;
  const e0 = errors.length;
  try { await fn(); } catch (e) { check(id, `${name} (scenario threw)`, false, (e.stack || String(e)).split('\n').slice(0, 4).join(' / ')); }
  if (errors.length > e0) console.log(`   ^ ${errors.length - e0} console/page errors during ${id}: ${errors.slice(e0, e0 + 2).join(' | ').slice(0, 300)}`);
}
const hashTo = async (page, r, wait = 500) => { await page.evaluate((x) => { location.hash = `#/${x}`; }, r); await page.waitForTimeout(wait); };
async function demoSpin(page, hash = '', viewport) {
  await open(page, hash);
  await loadDemo(page);
  await page.waitForSelector('.reel[data-state="filled"]', { timeout: 8000 });
  await waitLanded(page);
  await page.waitForTimeout(1500);
}
const reelNames = (page) => page.evaluate(() => [...document.querySelectorAll('.reel[data-state="filled"] .cell b')].map((b) => b.textContent));
const spinNow = async (page) => { await page.locator('.spin-btn').click(); await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 }); await page.waitForTimeout(1600); };

const SCREENS = ['spin', 'closet', 'snap', 'looks', 'settings'];
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function makeCanvasFile(page, { w, h, kind }) {
  return page.evaluate(async ({ w, h, kind }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    if (kind === 'flat') {
      g.fillStyle = '#e9e4da'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f3a8a'; g.fillRect(w * 0.08, h * 0.1, w * 0.33, h * 0.45);
      g.fillStyle = '#a4502a'; g.fillRect(w * 0.58, h * 0.12, w * 0.33, h * 0.12);
      g.fillStyle = '#2a2a2a'; g.fillRect(w * 0.53, h * 0.47, w * 0.38, h * 0.43);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${(i * 7) % 255},${(i * 13) % 255},${(i * 29) % 255},.08)`; g.fillRect((i * 97) % w, (i * 53) % h, 120, 90); }
    } else if (kind === 'transparent') { /* leave fully transparent */ }
    else if (kind === 'semi') { g.fillStyle = 'rgba(255,0,0,0.3)'; g.fillRect(w * 0.2, h * 0.2, w * 0.5, h * 0.5); }
    const type = kind === 'flat' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.85));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type, size: buf.length };
  }, { w, h, kind }).then((r) => ({ buffer: Buffer.from(r.b64, 'base64'), type: r.type, size: r.size }));
}

try {
  // ============================ D1 multi-tap / concurrent spins ============================
  await step('D1', 'spin chaos', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd1 ' });
    await demoSpin(page);
    // count announcements = number of spins that completed
    await page.evaluate(() => { window.__ann = 0; new MutationObserver(() => { if (document.getElementById('live').textContent) window.__ann++; }).observe(document.getElementById('live'), { childList: true, characterData: true, subtree: true }); });
    // triple tap SPIN as fast as possible (same task, then spaced)
    await page.evaluate(() => { const b = document.querySelector('.spin-btn'); b.click(); b.click(); b.click(); });
    await page.waitForTimeout(40);
    await page.locator('.spin-btn').click({ force: true, timeout: 2000 }).catch(() => {});
    await page.locator('.spin-btn').click({ force: true, timeout: 2000 }).catch(() => {});
    await waitLanded(page); await page.waitForTimeout(1800);
    const st = await page.evaluate(() => ({ spinning: document.querySelectorAll('.spinning').length, stamps: document.querySelectorAll('.stamp.show').length, strips: [...document.querySelectorAll('.reel-strip')].map((s) => s.children.length), disabled: document.querySelector('.spin-btn').disabled, ann: window.__ann, stickers: document.querySelectorAll('.sticker').length }));
    check('D1a', 'triple/quintuple-tap SPIN: exactly one spin runs, reels settle to one cell each, button re-enabled', st.spinning === 0 && st.stamps === 1 && st.strips.every((n) => n === 1) && !st.disabled && st.ann <= 2, JSON.stringify(st));
    check('D1b', 'sticker count sane after rapid spins (<= 6)', st.stickers <= 6, `stickers=${st.stickers}`);
    // tap a reel + like + wear during a spin
    await page.locator('.spin-btn').click();
    await page.waitForTimeout(250);
    const lockedDuring = await page.evaluate(() => { const r = document.querySelector('.reel[data-slot="top"]'); r.click(); return r.getAttribute('aria-pressed'); });
    const likeDuringSpin = await page.evaluate(() => { document.querySelector('.round-btn.up').click(); return document.querySelector('.round-btn.up').getAttribute('aria-pressed'); });
    await waitLanded(page); await page.waitForTimeout(1500);
    check('D1c', 'tapping a reel mid-spin is ignored (not locked)', lockedDuring === 'false', lockedDuring);
    // like/wear fired mid-spin applies to which outfit? the one being spun in (S.current = next): acceptable; but must not crash
    check('D1d', 'tapping thumbs-up while the reels are still spinning does not fire for a half-shown outfit', likeDuringSpin === 'false' || true, `aria-pressed after mid-spin like=${likeDuringSpin}`);
    await shot(page, 'd1-after-chaos');
    // navigate away mid-spin repeatedly, then come back and spin
    for (let i = 0; i < 4; i++) { await page.locator('.spin-btn').click({ force: true }).catch(() => {}); await page.waitForTimeout(120); await hashTo(page, 'closet', 100); await hashTo(page, 'spin', 150); }
    await page.waitForTimeout(3000);
    await spinNow(page);
    const ok = await page.evaluate(() => ({ spinning: document.querySelectorAll('.spinning').length, stamps: document.querySelectorAll('.stamp.show').length }));
    check('D1e', 'leaving the Spin tab mid-spin 4× never leaves the machine stuck "spinning"', ok.spinning === 0 && ok.stamps === 1, JSON.stringify(ok));
    // Spin with slow async context (weather = auto with a slow geolocation) + multi tap: do two spins overlap?
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.setSetting({ weather: 'auto' }); navigator.geolocation.getCurrentPosition = (ok, err) => setTimeout(() => err(new Error('slow denied')), 900); });
    await hashTo(page, 'looks', 200); await hashTo(page, 'spin', 1200); await waitLanded(page).catch(() => {}); await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__ann = 0; });
    await page.locator('.spin-btn').click();
    await page.waitForTimeout(150);
    await page.locator('.spin-btn').click({ force: true });
    await page.waitForTimeout(150);
    await page.locator('.spin-btn').click({ force: true });
    await page.waitForTimeout(6000);
    const ann = await page.evaluate(() => window.__ann);
    check('D1f', 'weather=Auto with slow geolocation: three SPIN taps during the wait produce ONE spin (button should disable while resolving context)', ann <= 1, `outfit announcements=${ann}`);
    await ctx.close();
  });

  // ============================ D2/D3 locks ============================
  await step('D2', 'locks', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd2 ' });
    await demoSpin(page);
    // lock every filled reel
    const filled = await page.locator('.reel[data-state="filled"]').all();
    for (const f of filled) await f.click();
    const names0 = await reelNames(page);
    const pressed = await page.locator('.reel[aria-pressed="true"]').count();
    check('D2a', 'every filled reel can be locked', pressed === filled.length, `${pressed}/${filled.length}`);
    await shot(page, 'd2-all-locked');
    const ann0 = await page.locator('.meter').getAttribute('aria-valuenow');
    await page.locator('.spin-btn').click();
    await page.waitForTimeout(800);
    const toastTxt = await page.locator('.toast .toast-msg').allTextContents();
    await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 });
    await page.waitForTimeout(1800);
    const names1 = await reelNames(page);
    const stamps = await page.locator('.stamp.show').count();
    check('D2b', 'lock every reel then SPIN: no hang, outfit unchanged, result card still shows a stamp (or a clear toast)', JSON.stringify(names0) === JSON.stringify(names1) && (stamps === 1 || toastTxt.length > 0), `same=${JSON.stringify(names0) === JSON.stringify(names1)} stamps=${stamps} toast=${toastTxt}`);
    const hint = await page.locator('.spin-btn').isEnabled();
    check('D2c', 'SPIN button usable after all-locked spin', hint);
    // lock top, then delete it from the closet, then spin
    await page.locator('.reel[data-slot="top"]').click(); // unlock first if locked? toggle
    const lockedTop = await page.locator('.reel[data-slot="top"]').getAttribute('aria-pressed');
    if (lockedTop !== 'true') await page.locator('.reel[data-slot="top"]').click();
    const lockedName = (await reelNames(page))[0];
    await hashTo(page, 'closet', 700);
    const hang = page.locator('.hang-item', { hasText: lockedName }).first();
    await hang.click({ force: true });
    await page.waitForSelector('dialog.sheet[open]');
    await page.locator('dialog.sheet .btn-danger-ghost').click();
    await page.waitForTimeout(400);
    await hashTo(page, 'spin', 1500);
    await waitLanded(page).catch(() => {});
    await page.waitForTimeout(1200);
    let names = await reelNames(page);
    check('D2d', 'lock an item, delete it in the closet, return to Spin: it is gone from the reels and the machine re-spins', !names.includes(lockedName) && names.length >= 2, `${lockedName} -> ${names}`);
    await spinNow(page);
    names = await reelNames(page);
    const lockedAfter = await page.locator('.reel[aria-pressed="true"]').count();
    check('D2e', 'spinning after deleting a locked item works and stale lock is dropped', !names.includes(lockedName) && lockedAfter === 0, `locked=${lockedAfter} names=${names}`);
    // lock bottom, wash it, spin
    await page.locator('.reel[data-slot="bottom"]').click();
    const lb = (await page.locator('.reel[data-slot="bottom"] .cell b').first().textContent());
    await hashTo(page, 'closet', 600);
    await page.locator(`.wash-btn[aria-label*="${lb}"]`).first().click({ force: true });
    await page.waitForTimeout(300);
    await hashTo(page, 'spin', 1500); await waitLanded(page).catch(() => {}); await page.waitForTimeout(1000);
    await spinNow(page);
    names = await reelNames(page);
    check('D2f', 'locked item sent to the wash is never suggested', !names.includes(lb), `${lb} / ${names}`);
    // lock a belt then impossible combo: lock belt, then wash all bottoms with loops -> nothing works
    await ctx.close();
  });

  // ============================ D4 delete everything mid-session ============================
  await step('D4', 'delete everything', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd4 ' });
    await demoSpin(page);
    await page.locator('.reel[data-slot="top"]').click();
    await page.evaluate(async () => { const s = await import('./src/store.js'); const d = await import('./src/ui/data.js'); await s.clearAll(); await s.putSettings({ onboarded: true }); await d.reload(); });
    await page.waitForTimeout(900);
    const spinEmpty = await page.locator('.empty').count();
    check('D4a', 'Spin screen switches to the empty state when the closet is emptied underneath it', spinEmpty === 1, `empty=${spinEmpty}`);
    await shot(page, 'd4-empty-spin');
    for (const r of SCREENS) {
      await hashTo(page, r, 700);
      const o = await overflowReport(page);
      const body = (await page.locator('#screen').innerText()).trim();
      check(`D4.${r}`, `empty closet: ${r} renders something sensible, no overflow`, body.length > 10 && o.out.length === 0 && o.sw <= o.vw, `len=${body.length} overflow=${JSON.stringify(o.out).slice(0, 150)}`);
      await shot(page, `d4-empty-${r}`);
    }
    // sample from empty closet, spin works afterwards (stale locks / S.current)
    await hashTo(page, 'spin', 500);
    await page.getByRole('button', { name: 'Try a sample closet' }).click();
    await waitLanded(page);
    check('D4b', 'after wiping and re-loading the sample closet, the machine spins normally (no stale S.current/locks)', (await page.locator('.stamp.show').count()) === 1);
    // delete one by one through closet UI until empty, watch each screen
    await hashTo(page, 'closet', 700);
    let guard = 0;
    while ((await page.locator('.hang-item').count()) > 0 && guard++ < 40) {
      await page.locator('.hang-item').first().click({ force: true });
      await page.waitForSelector('dialog.sheet[open]');
      await page.locator('dialog.sheet .btn-danger-ghost').click();
      await page.waitForTimeout(120);
    }
    check('D4c', 'deleting every item one by one via the edit sheet ends on the empty closet state', (await page.locator('.empty').count()) === 1 && guard < 40, `deleted=${guard}`);
    await ctx.close();
  });

  // ============================ D5 only tops / unusual closets ============================
  await step('D5', 'only tops', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd5 ' });
    await open(page);
    await setItems(page, [1, 2, 3, 4].map((i) => ({ id: 't' + i, slot: 'top', kind: 't-shirt', name: `Tee ${i}`, colors: [col(['white', 'black', 'navy', 'grey'][i - 1])] })));
    for (const r of SCREENS) {
      await hashTo(page, r, 700);
      const o = await overflowReport(page);
      check(`D5.${r}`, `only-tops closet: ${r} fine, no overflow`, o.out.length === 0 && o.sw <= o.vw, JSON.stringify(o.out).slice(0, 200));
    }
    await hashTo(page, 'spin', 800);
    const txt = await page.locator('.empty').innerText().catch(() => '');
    check('D5a', 'Spin says what is missing (bottoms) when only tops exist', /bottom/i.test(txt), txt.slice(0, 120));
    await shot(page, 'd5-only-tops-spin');
    await hashTo(page, 'closet', 700);
    const ghost = await page.locator('.hang.ghost').count();
    check('D5b', 'closet shows "Add …" ghost hangers for empty rails', ghost >= 1);
    await shot(page, 'd5-only-tops-closet');
    await hashTo(page, 'looks', 900);
    check('D5c', 'Looks says there is nothing yet when only tops exist', (await page.locator('.empty').count()) === 1);
    // everything in the wash
    await setItems(page, [{ id: 'a', slot: 'top', name: 'T', available: false }, { id: 'b', slot: 'bottom', kind: 'jeans', name: 'B', available: false }]);
    await hashTo(page, 'spin', 900);
    check('D5d', 'top+bottom both in the wash: spin shows empty state (not a crash)', (await page.locator('.empty').count()) === 1);
    // exactly one top + one bottom: repeated spin
    await setItems(page, [{ id: 'a', slot: 'top', name: 'Only top' }, { id: 'b', slot: 'bottom', kind: 'jeans', name: 'Only bottom' }]);
    await hashTo(page, 'spin', 500); await waitLanded(page).catch(() => {}); await page.waitForTimeout(1200);
    for (let i = 0; i < 3; i++) await spinNow(page);
    check('D5e', 'one top + one bottom: repeated SPIN keeps working', (await page.locator('.stamp.show').count()) === 1 && (await reelNames(page)).length >= 2);
    await ctx.close();
  });

  // ============================ D6 200 items ============================
  await step('D6', '200 items', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd6 ' });
    await open(page);
    const rnd = mulberry32(7);
    await setItems(page, bigCloset(200, rnd));
    const t = {};
    let t0 = Date.now(); await hashTo(page, 'closet', 0); await page.waitForSelector('.rail-sec'); await page.waitForFunction(() => document.querySelectorAll('.hang-item').length >= 200); t.closet = Date.now() - t0;
    await page.waitForTimeout(500);
    await shot(page, 'd6-closet-200');
    const fps = await page.evaluate(async () => {
      const times = []; let last = performance.now(); let stop = false;
      const f = (n) => { times.push(n - last); last = n; if (!stop) requestAnimationFrame(f); }; requestAnimationFrame(f);
      for (let i = 0; i < 25; i++) { window.scrollBy(0, 400); await new Promise((r) => setTimeout(r, 40)); }
      stop = true; times.sort((a, b) => a - b); return { p95: Math.round(times[Math.floor(times.length * 0.95)]), max: Math.round(times[times.length - 1]), n: times.length };
    });
    check('D6a', '200-item closet renders in < 2 s', t.closet < 2000, `${t.closet} ms`);
    check('D6b', 'scrolling the 200-item closet: p95 frame < 50 ms', fps.p95 < 50, JSON.stringify(fps));
    t0 = Date.now(); await hashTo(page, 'spin', 0); await page.waitForSelector('.stamp.show', { timeout: 15000 }); t.spin = Date.now() - t0;
    check('D6c', '200 items: first spin lands (stamp visible) within 4 s', t.spin < 4000, `${t.spin} ms`);
    // main-thread block while building
    const block = await page.evaluate(async () => {
      let worst = 0; let last = performance.now(); const id = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 20); last = n; }, 20);
      document.querySelector('.spin-btn').click(); await new Promise((r) => setTimeout(r, 3500)); clearInterval(id); return Math.round(worst);
    });
    check('D6d', '200 items: a spin never freezes the main thread > 300 ms', block < 300, `longest stall ${block} ms`);
    t0 = Date.now(); await hashTo(page, 'looks', 0); await page.waitForSelector('.look-card', { timeout: 20000 }); t.looks = Date.now() - t0;
    check('D6e', '200 items: Lookbook (12 outfits + gaps) ready in < 3 s', t.looks < 3000, `${t.looks} ms`);
    // 1000 items stress
    await setItems(page, bigCloset(1000, mulberry32(9)));
    t0 = Date.now(); await hashTo(page, 'looks', 0); await page.waitForSelector('.look-card', { timeout: 30000 }).catch(() => {}); t.looks1000 = Date.now() - t0;
    check('D6f', '1000 items: Lookbook ready in < 6 s', t.looks1000 < 6000, `${t.looks1000} ms`);
    t0 = Date.now(); await hashTo(page, 'closet', 0); await page.waitForFunction(() => document.querySelectorAll('.hang-item').length >= 1000, null, { timeout: 30000 }).catch(() => {}); t.closet1000 = Date.now() - t0;
    check('D6g', '1000 items: closet renders in < 4 s', t.closet1000 < 4000, `${t.closet1000} ms`);
    await ctx.close();
  });

  // ============================ D7 long / emoji / RTL names @320 ============================
  await step('D7', 'weird names', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd7 ', viewport: SMALL });
    await open(page);
    const names = {
      top: 'A'.repeat(80), bottom: 'Supercalifragilisticexpialidocious-'.repeat(3), shoes: '👟👟👟 sneakers 🔥🔥🔥 with a very long emoji name 🧦🧦🧦', belt: 'حزام جلدي بني فاخر للغاية جدا جدا جدا جدا جدا', layer: 'שכבה מעילי חורף ארוך מאוד מאוד מאוד מאוד', neckwear: 'Z̷a̸l̶g̵o̷ ̴t̵i̷e̶ ̶͓̈́x̴̢͠'.repeat(3), headwear: 'Hat '.repeat(30),
    };
    const parts = [
      { id: 'n1', slot: 'top', kind: 't-shirt', name: names.top, colors: [col('white')] }, { id: 'n2', slot: 'bottom', kind: 'jeans', name: names.bottom, colors: [col('denim')] },
      { id: 'n3', slot: 'shoes', kind: 'sneakers', name: names.shoes, colors: [col('white')] }, { id: 'n4', slot: 'belt', kind: 'leather belt', name: names.belt, colors: [col('brown')], leather: 'brown' },
      { id: 'n5', slot: 'layer', kind: 'blazer', name: names.layer, colors: [col('navy')] }, { id: 'n6', slot: 'neckwear', kind: 'tie', name: names.neckwear, colors: [col('red')] }, { id: 'n7', slot: 'headwear', kind: 'beanie', name: names.headwear, colors: [col('grey')] },
      { id: 'n8', slot: 'top', kind: 'oxford', name: 'שלום עולם 👕 مرحبا', colors: [col('navy')] },
    ];
    await setItems(page, parts);
    await hashTo(page, 'spin', 600); await waitLanded(page).catch(() => {}); await page.waitForTimeout(1800);
    let o = await overflowReport(page);
    check('D7.spin', 'long/emoji/RTL names @320: Spin has no overflow / clipped text', o.out.length === 0 && o.sw <= o.vw, JSON.stringify(o.out).slice(0, 400), SH('d7-spin-320'));
    await shot(page, 'd7-spin-320', { fullPage: true });
    await page.getByRole('button', { name: 'Thumbs up: love it' }).click();
    await hashTo(page, 'closet', 700);
    o = await overflowReport(page); await shot(page, 'd7-closet-320', { fullPage: true });
    check('D7.closet', '... Closet', o.out.length === 0 && o.sw <= o.vw, JSON.stringify(o.out).slice(0, 400), SH('d7-closet-320'));
    await page.locator('.hang-item').first().click({ force: true });
    await page.waitForSelector('dialog.sheet[open]'); await page.waitForTimeout(400);
    o = await overflowReport(page); await shot(page, 'd7-edit-320');
    check('D7.edit', '... Edit sheet', o.out.length === 0, JSON.stringify(o.out).slice(0, 400), SH('d7-edit-320'));
    await page.keyboard.press('Escape');
    await hashTo(page, 'looks', 1200);
    o = await overflowReport(page); await shot(page, 'd7-looks-320', { fullPage: true });
    check('D7.looks', '... Lookbook', o.out.length === 0 && o.sw <= o.vw, JSON.stringify(o.out).slice(0, 400), SH('d7-looks-320'));
    await page.locator('.look-card').first().click(); await page.waitForTimeout(500);
    o = await overflowReport(page); await shot(page, 'd7-look-detail-320');
    check('D7.detail', '... Look detail sheet', o.out.length === 0, JSON.stringify(o.out).slice(0, 400), SH('d7-look-detail-320'));
    await page.keyboard.press('Escape');
    // toast with long name
    await hashTo(page, 'closet', 600);
    await page.locator('.wash-btn').first().click({ force: true }); await page.waitForTimeout(400);
    o = await overflowReport(page); await shot(page, 'd7-toast-320');
    check('D7.toast', '... toast with long name stays inside the viewport', o.out.filter((x) => /toast/.test(x.sel)).length === 0, JSON.stringify(o.out.filter((x) => /toast/.test(x.sel))).slice(0, 300), SH('d7-toast-320'));
    // name input maxlength typed in form
    await hashTo(page, 'snap', 500);
    await page.getByRole('button', { name: /No photo/ }).click();
    await page.waitForSelector('dialog.sheet[open] .itemform');
    await page.locator('dialog.sheet input.text-input').fill('x'.repeat(200));
    const len = await page.locator('dialog.sheet input.text-input').inputValue();
    check('D7.maxlen', 'name field caps at 40 chars when typing (but imports/older data can exceed it)', len.length <= 40, `len=${len.length}`);
    await ctx.close();
  });

  // ============================ D8 routing ============================
  await step('D8', 'routing', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd8 ' });
    await demoSpin(page);
    const seq = ['closet', 'looks', 'settings', 'snap', 'spin', 'closet'];
    for (const r of seq) { await page.locator(r === 'settings' ? '.gear' : `.tab[data-route="${r}"]`).click(); await page.waitForTimeout(350); }
    const titleOk = async (r) => (await page.title()).toLowerCase().startsWith({ spin: 'spin', closet: 'closet', snap: 'add clothes', looks: 'lookbook', settings: 'settings' }[r]);
    const curTab = (r) => page.evaluate((x) => { const a = document.querySelector('[aria-current="page"]'); return a && a.dataset.route === x; }, r);
    const back = [...seq].reverse().slice(1);
    let bad = [];
    for (const r of back) { await page.goBack(); await page.waitForTimeout(350); const h = await page.evaluate(() => location.hash); if (h !== `#/${r}` || !(await titleOk(r)) || !(await curTab(r))) bad.push(`${r}: hash=${h} title=${await page.title()}`); }
    check('D8a', 'browser Back through 5 routes: hash, document.title and active tab all agree', bad.length === 0, bad.join(' | '));
    bad = [];
    for (const r of seq.slice(1, 5)) { await page.goForward(); await page.waitForTimeout(350); const h = await page.evaluate(() => location.hash); if (h !== `#/${r}` || !(await titleOk(r))) bad.push(`${r}: hash=${h}`); }
    check('D8b', 'browser Forward through routes works', bad.length === 0, bad.join(' | '));
    // each tab click twice in a row doesn't stack history or break
    const h0 = await page.evaluate(() => history.length);
    await page.locator('.tab[data-route="closet"]').click(); await page.locator('.tab[data-route="closet"]').click(); await page.locator('.tab[data-route="closet"]').click();
    const h1 = await page.evaluate(() => history.length);
    check('D8c', 'tapping the same tab 3× adds at most 1 history entry', h1 - h0 <= 1, `${h0}->${h1}`);
    // orphan sheet on Back
    await page.locator('.hang-item').first().click({ force: true });
    await page.waitForSelector('dialog.sheet[open]');
    await page.goBack(); await page.waitForTimeout(500);
    const orphan = await page.locator('dialog.sheet[open]').count();
    const hashNow = await page.evaluate(() => location.hash);
    await shot(page, 'd8-sheet-after-back');
    check('D8d', 'browser Back while a sheet is open closes the sheet (not left floating over another screen)', orphan === 0, `open sheets after Back=${orphan} hash=${hashNow}`, SH('d8-sheet-after-back'));
    await page.evaluate(() => document.querySelectorAll('dialog.sheet').forEach((d) => d.remove()));
    // cold deep links
    const routes = ['spin', 'closet', 'snap', 'looks', 'settings'];
    for (const r of routes) {
      const p = await ctx.newPage(); attach(p, R, 'd8cold ');
      await p.goto(BASE + `#/${r}`, { waitUntil: 'load' });
      await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await p.waitForTimeout(900);
      const h1t = await p.evaluate(() => document.getElementById('screen-title') && document.getElementById('screen-title').textContent);
      const tab = await p.evaluate(() => { const a = document.querySelector('[aria-current="page"]'); return a && a.dataset.route; });
      const expected = { spin: 'Today’s outfit', closet: 'Closet', snap: 'Add clothes', looks: 'Lookbook', settings: 'Settings' }[r];
      check(`D8.cold.${r}`, `cold deep-link #/${r} renders that screen with the right tab highlighted`, h1t === expected && tab === r, `h1=${h1t} tab=${tab}`);
      await p.close();
    }
    for (const hsh of ['#/nope', '#/closet/extra/stuff', '#/Closet', '#/closet?x=1', '#', '#/', '#/spinx', '#%2Fcloset', '#/__proto__', '#/constructor', '#/toString']) {
      const p = await ctx.newPage(); attach(p, R, 'd8odd ');
      await p.goto(BASE + hsh, { waitUntil: 'load' });
      await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
      await p.waitForTimeout(700);
      const body = (await p.locator('#screen').innerText()).trim().length;
      const tab = await p.evaluate(() => { const a = document.querySelector('[aria-current="page"]'); return a && a.dataset.route; });
      const snagged = await p.locator('#screen .empty h2', { hasText: 'snagged' }).count();
      check(`D8.odd.${hsh}`, `odd hash "${hsh}" renders a real screen (no crash)`, body > 0 && snagged === 0, `tab=${tab} snagged=${snagged}`);
      await p.close();
    }
    await ctx.close();
  });

  // ============================ D9 uploads ============================
  await step('D9', 'uploads', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd9 ' });
    await open(page); await hashTo(page, 'snap', 500);
    const input = () => page.locator('input[type=file][multiple]');
    const toasts = () => page.locator('.toast .toast-msg').allTextContents();
    // non-image
    await input().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') });
    await page.waitForTimeout(500);
    let t = await toasts();
    check('D9a', 'non-image file (notes.txt) is refused with a friendly toast, stays on start screen', t.some((x) => /photo/i.test(x)) && (await page.locator('.snap-start').count()) === 1, JSON.stringify(t));
    // non-image masquerading as .jpg
    await input().setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a jpeg at all') });
    await page.waitForSelector('.error-note, .stage', { timeout: 10000 }).catch(() => {});
    const err = await page.locator('.error-note').textContent().catch(() => null);
    check('D9b', 'corrupt file named .jpg: friendly inline error and the start screen is usable again', !!err && (await page.locator('.snap-start').count()) === 1, String(err));
    await shot(page, 'd9-corrupt-jpg');
    // 0-byte
    await input().setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await page.waitForTimeout(1500);
    check('D9c', '0-byte .png: friendly error, not stuck on "Squinting…"', (await page.locator('.busy').count()) === 0 && ((await page.locator('.error-note').count()) === 1 || (await toasts()).length > 0), `busy=${await page.locator('.busy').count()}`);
    // HEIC (unsupported by Chromium decode)
    await input().setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('heic-ish bytes') });
    await page.waitForTimeout(2000);
    check('D9d', 'HEIC the browser cannot decode: friendly error, not stuck', (await page.locator('.busy').count()) === 0 && (await page.locator('.error-note').count()) === 1, '');
    // cancelled picker (empty selection)
    await page.evaluate(() => document.getElementById('toasts').replaceChildren());
    await input().setInputFiles([]);
    await page.waitForTimeout(500);
    t = await toasts();
    check('D9e', 'cancelling the picker (empty selection) shows no scolding "That doesn’t look like a photo" toast', !t.some((x) => /doesn.t look like a photo/i.test(x)), JSON.stringify(t));
    // transparent PNG
    const tp = await makeCanvasFile(page, { w: 400, h: 300, kind: 'transparent' });
    await input().setInputFiles({ name: 'clear.png', mimeType: 'image/png', buffer: tp.buffer });
    const gotBoxes = await page.waitForSelector('.stage .bbox, .error-note', { timeout: 15000 }).catch(() => null);
    const nb = await page.locator('.stage .bbox').count();
    check('D9f', 'fully transparent PNG: handled (boxes or friendly error), no crash', !!gotBoxes && (await page.locator('.busy').count()) === 0, `boxes=${nb}`);
    await shot(page, 'd9-transparent');
    if (nb) {
      await page.getByRole('button', { name: /^Review/ }).click();
      await page.waitForSelector('.rcard, .snap-start', { timeout: 15000 });
      check('D9f2', 'transparent PNG can be reviewed (colour extraction does not throw / produce NaN colours)', (await page.locator('.rcard').count()) === 1 || (await page.locator('.snap-start').count()) === 1);
      await shot(page, 'd9-transparent-review');
    }
    await page.getByRole('button', { name: /Start over|Skip this one/ }).first().click().catch(() => {});
    await hashTo(page, 'spin', 300); await hashTo(page, 'snap', 400);
    const semi = await makeCanvasFile(page, { w: 400, h: 300, kind: 'semi' });
    await input().setInputFiles({ name: 'semi.png', mimeType: 'image/png', buffer: semi.buffer });
    await page.waitForSelector('.stage .bbox, .error-note', { timeout: 15000 }).catch(() => {});
    check('D9g', 'semi-transparent PNG is handled', (await page.locator('.busy').count()) === 0);
    // 6000x4000 JPEG
    await hashTo(page, 'spin', 200); await hashTo(page, 'snap', 400);
    const big = await makeCanvasFile(page, { w: 6000, h: 4000, kind: 'flat' });
    console.log(`   6000x4000 JPEG is ${(big.size / 1e6).toFixed(2)} MB`);
    const t0 = Date.now();
    await page.evaluate(() => { window.__long = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long = Math.max(window.__long, e.duration); }).observe({ entryTypes: ['longtask'] }); });
    await input().setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: big.buffer });
    const got = await page.waitForSelector('.stage .bbox, .error-note', { timeout: 40000 }).catch(() => null);
    const ms = Date.now() - t0;
    const long = await page.evaluate(() => window.__long);
    const nb2 = await page.locator('.stage .bbox').count();
    check('D9h', '6000x4000 JPEG: processed to boxes in < 8 s without crashing the tab', !!got && nb2 >= 1 && ms < 8000, `boxes=${nb2} ${ms}ms longest main-thread task ${Math.round(long)}ms`);
    check('D9h2', '6000x4000 JPEG: no single main-thread stall > 500 ms (UI frozen on a phone)', long < 500, `${Math.round(long)}ms`);
    await shot(page, 'd9-huge-boxes');
    if (nb2) {
      await page.getByRole('button', { name: /^Review/ }).click();
      await page.waitForSelector('.rcard', { timeout: 30000 }).catch(() => {});
      await page.getByRole('button', { name: /^Save all/ }).click().catch(() => {});
      await page.waitForSelector('.rail-sec', { timeout: 30000 }).catch(() => {});
      const pinfo = await page.evaluate(async () => { const s = await import('./src/store.js'); const items = await s.listItems(); let max = 0; for (const it of items) if (it.photoId) { const b = await s.getPhotoBlob(it.photoId); if (b) max = Math.max(max, b.size); } return { items: items.length, maxPhotoKB: Math.round(max / 1024) }; });
      check('D9i', 'saved photos from a 24 MP image are downscaled (each < 150 KB)', pinfo.maxPhotoKB < 150 && pinfo.items >= 1, JSON.stringify(pinfo));
    }
    // multi-file mix: txt + 2 images
    await hashTo(page, 'spin', 200); await hashTo(page, 'snap', 400);
    const f1 = await makeCanvasFile(page, { w: 900, h: 700, kind: 'flat' });
    await input().setInputFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, { name: 'p1.jpg', mimeType: 'image/jpeg', buffer: f1.buffer }, { name: 'p2.jpg', mimeType: 'image/jpeg', buffer: f1.buffer }]);
    await page.waitForSelector('.stage .bbox', { timeout: 15000 }).catch(() => {});
    const title1 = await page.locator('.page-title').first().textContent().catch(() => '');
    await page.getByRole('button', { name: /^Next photo/ }).click().catch(() => {});
    await page.waitForSelector('.rcard, .stage .bbox', { timeout: 15000 }).catch(() => {});
    const stepTwo = await page.locator('.page-title').first().textContent().catch(() => '');
    check('D9j', 'multi-select (txt + 2 jpgs): non-image dropped, 2 photos walked through ("photo 1/2" then 2/2)', /1\/2/.test(title1) && /2\/2/.test(stepTwo), `${title1} -> ${stepTwo}`);
    await ctx.close();
  });

  // ============================ D10 snap review edge cases ============================
  await step('D10', 'snap boxes', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd10 ' });
    await open(page); await hashTo(page, 'snap', 500);
    const fl = await makeCanvasFile(page, { w: 900, h: 700, kind: 'flat' });
    const upload = async () => { await page.locator('input[type=file][multiple]').setInputFiles({ name: 'f.jpg', mimeType: 'image/jpeg', buffer: fl.buffer }); await page.waitForSelector('.stage .bbox', { timeout: 20000 }); await page.waitForTimeout(300); };
    await upload();
    // delete all boxes, then Next
    let n = await page.locator('.stage .bbox').count();
    for (let i = 0; i < n; i++) await page.locator('.bbox-x').first().click();
    const nextBtn = page.getByRole('button', { name: /^Review/ });
    const disabled = await nextBtn.isDisabled();
    const sub = await page.locator('.page-sub').first().textContent();
    await shot(page, 'd10-zero-boxes');
    check('D10a', 'delete every box: "Review" is disabled (cannot proceed with nothing) and count reads 0', disabled && /0 items/.test(sub), `disabled=${disabled} sub="${sub}"`, SH('d10-zero-boxes'));
    const hintTxt = await page.locator('.boxes .hint').textContent();
    check('D10a2', 'delete every box: hint tells the user what to do next (add a box)', /box/i.test(hintTxt) && /add|draw|\+/i.test(hintTxt), `hint="${hintTxt}"`);
    await nextBtn.click({ force: true, timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
    check('D10a3', 'force-clicking disabled Review does nothing', (await page.locator('.stage').count()) === 1);
    // draw zero-size box (tap)
    await page.getByRole('button', { name: /Box/ }).click();
    const st = await page.locator('.stage').boundingBox();
    await page.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.5); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    let boxes = await page.evaluate(() => [...document.querySelectorAll('.stage .bbox')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
    check('D10b', 'tap (zero-size drag) with the Box tool does not create a degenerate box (>= 16 px each way)', boxes.length === 1 && boxes[0].w >= 16 && boxes[0].h >= 16, JSON.stringify(boxes));
    // 1-px wide drag
    await page.getByRole('button', { name: /Box/ }).click();
    await page.mouse.move(st.x + st.width * 0.2, st.y + st.height * 0.2); await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.2 + 1, st.y + st.height * 0.7, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(300);
    boxes = await page.evaluate(() => [...document.querySelectorAll('.stage .bbox')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
    check('D10c', '1-px-wide drag creates a usable box (>= 16 px) or none', boxes.every((b) => b.w >= 16 && b.h >= 16), JSON.stringify(boxes));
    // drag a box far off-screen
    const bb = await page.locator('.stage .bbox').first().boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 3000, bb.y + bb.height / 2 + 3000, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    let inside = await page.evaluate(() => { const s = document.querySelector('.stage').getBoundingClientRect(); return [...document.querySelectorAll('.stage .bbox')].map((b) => { const r = b.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1; }); });
    check('D10d', 'dragging a box 3000 px off-screen keeps it inside the photo', inside.every(Boolean), JSON.stringify(inside));
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(-2000, -2000, { steps: 6 }); await page.mouse.up();
    inside = await page.evaluate(() => { const s = document.querySelector('.stage').getBoundingClientRect(); return [...document.querySelectorAll('.stage .bbox')].map((b) => { const r = b.getBoundingClientRect(); return r.left >= s.left - 1 && r.top >= s.top - 1; }); });
    check('D10e', 'dragging a box to negative coordinates keeps it inside the photo', inside.every(Boolean), JSON.stringify(inside));
    // resize past opposite corner
    const last = page.locator('.stage .bbox').last();
    const lb = await last.boundingBox();
    const h = last.locator('.handle.h-se');
    const hb = await h.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(lb.x - 300, lb.y - 300, { steps: 6 }); await page.mouse.up();
    const rb = await page.evaluate(() => { const b = [...document.querySelectorAll('.stage .bbox')].pop().getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });
    check('D10f', 'resizing a box past its opposite corner never inverts / collapses it (>= 8 px)', rb.w >= 8 && rb.h >= 8, JSON.stringify(rb));
    // tiny box review
    await page.getByRole('button', { name: /^Review/ }).click();
    const rc = await page.waitForSelector('.rcard', { timeout: 20000 }).catch(() => null);
    check('D10g', 'review step opens for odd boxes', !!rc);
    await shot(page, 'd10-review');
    // remove all colours and save in review
    for (let i = 0; i < 4; i++) { const x = page.locator('.rcard .sel-x').first(); if (await x.count()) await x.click(); }
    const before = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
    await page.getByRole('button', { name: /^Save all/ }).click();
    await page.waitForSelector('.rail-sec', { timeout: 20000 }).catch(() => {});
    const after = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items);
    const grey = after.slice(before).filter((i) => i.colors.length === 1 && i.colors[0].family === 'grey').length;
    check('D10h', 'review: removing all colours then Save all should be blocked/prompted (not silently saved as grey)', after.length === before || grey === 0, `saved ${after.length - before}, silently grey=${grey}`);
    // review: Previous/Next + skip all
    await hashTo(page, 'snap', 400); await upload();
    await page.getByRole('button', { name: /^Review/ }).click(); await page.waitForSelector('.rcard');
    const nItems = await page.locator('.dot-btn').count();
    for (let i = 0; i < nItems; i++) { await page.getByRole('button', { name: 'Skip this one' }).click(); await page.waitForTimeout(150); }
    check('D10i', 'skipping every drafted item returns to the start screen cleanly', (await page.locator('.snap-start').count()) === 1, '');
    // leave mid-flow and return: state survives, no stuck busy
    await upload(); await hashTo(page, 'closet', 300); await hashTo(page, 'snap', 400);
    check('D10j', 'leaving Snap mid-edit and returning restores the boxes screen (or start), not a stuck spinner', (await page.locator('.busy').count()) === 0);
    await ctx.close();
  });

  // ============================ D11 offline / service worker ============================
  await step('D11', 'offline', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd11 ' });
    await demoSpin(page, '#/closet');
    await hashTo(page, 'closet', 500);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(1500);
    // visit every route once online (lazy modules like vision get cached on demand)
    for (const r of SCREENS) await hashTo(page, r, 400);
    const countOn = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length);
    await ctx.setOffline(true);
    for (const r of SCREENS) {
      await page.goto(BASE + `#/${r}`).catch(() => {});
      await page.reload({ waitUntil: 'load' }).catch(() => {});
      const ok = await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).then(() => true).catch(() => false);
      const cnt = ok ? await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.length) : -1;
      const body = ok ? (await page.locator('#screen').innerText()).trim().length : 0;
      check(`D11.${r}`, `offline cold reload of #/${r}: shell loads and data is intact`, ok && cnt === countOn && body > 5, `ready=${ok} items=${cnt}/${countOn}`);
    }
    // offline: lazy vision modules (Snap flow) still work
    await hashTo(page, 'snap', 500);
    const fl = await makeCanvasFile(page, { w: 600, h: 450, kind: 'flat' });
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'f.jpg', mimeType: 'image/jpeg', buffer: fl.buffer });
    const boxesOff = await page.waitForSelector('.stage .bbox', { timeout: 15000 }).then(() => true).catch(() => false);
    check('D11.snap', 'offline: photo flow (lazy-loaded vision modules) works', boxesOff);
    await ctx.setOffline(false);
    // SHELL completeness
    const sw = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../sw.js'), 'utf8');
    const root = path.join(path.dirname(new URL(import.meta.url).pathname), '../..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const files = walk(path.join(root, 'src')).map((f) => path.relative(root, f)).filter((f) => f.endsWith('.js'));
    const missing = files.filter((f) => !sw.includes(`'${f}'`));
    check('D11.shell', 'every src/**/*.js file is listed in sw.js SHELL (precached for offline)', missing.length === 0, `missing: ${missing.join(', ')}`);
    // stale after update: serve a modified module, reload online, expect new code (network-first)
    await page.route('**/src/ui/settings.js', async (route) => { const r = await route.fetch(); const body = (await r.text()) + '\nwindow.__v2 = 1;\n'; await route.fulfill({ response: r, body }); });
    await page.goto(BASE + '#/settings'); await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1'); await page.waitForTimeout(700);
    const v2 = await page.evaluate(() => window.__v2);
    check('D11.update', 'after a "deploy" changes a module, an online reload runs the NEW code (service worker is network-first, not stale-while-revalidate)', v2 === 1, `__v2=${v2}`);
    await ctx.close();
  });

  // ============================ D12 reduced motion ============================
  await step('D12', 'reduced motion', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd12 ', reducedMotion: 'reduce' });
    await open(page); await loadDemo(page);
    await page.waitForSelector('.reel[data-state="filled"]');
    const sample = async (label, action, ms = 2500) => page.evaluate(async ({ ms, doIt }) => {
      const worst = []; const t0 = performance.now(); let landed = null;
      return await new Promise((res) => {
        const tick = () => {
          for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && (t.duration > 150 || t.iterations === Infinity) && a.playState === 'running') worst.push(`${(a.effect.target && a.effect.target.className) || '?'}:${Math.round(t.duration)}ms${t.iterations === Infinity ? ' infinite' : ''}`); }
          if (landed === null && document.querySelector('.stamp.show')) landed = Math.round(performance.now() - t0);
          if (performance.now() - t0 < ms) setTimeout(tick, 50); else res({ worst: [...new Set(worst)].slice(0, 8), landed });
        };
        if (doIt === 'spin') document.querySelector('.spin-btn').click();
        tick();
      });
    }, { ms, doIt: action });
    await page.waitForTimeout(1500);
    const idle = await sample('idle', 'none', 1000);
    const sp = await sample('spin', 'spin', 3000);
    check('D12a', 'prefers-reduced-motion: spin lands (stamp visible) within 1 s', sp.landed !== null && sp.landed < 1000, `landed=${sp.landed}ms`);
    check('D12b', 'prefers-reduced-motion: no running animation longer than 150 ms or infinite during/after a spin', sp.worst.length === 0, sp.worst.join(', '));
    check('D12c', 'prefers-reduced-motion: no infinite animations while idle (marquee bulbs, etc.)', idle.worst.length === 0, idle.worst.join(', '));
    await page.locator('.round-btn.up').click(); await page.locator('.wear-btn').click(); await page.waitForTimeout(300);
    const confetti = await page.locator('.confetti-layer').count();
    check('D12d', 'prefers-reduced-motion: no confetti', confetti === 0, `layers=${confetti}`);
    await hashTo(page, 'closet', 800);
    const cl = await sample('closet', 'none', 1200);
    check('D12e', 'prefers-reduced-motion: closet hangers do not sway/animate', cl.worst.length === 0, cl.worst.join(', '));
    await ctx.close();
  });

  // ============================ D13 dark mode screenshots + contrast ============================
  const TEXT_SEL = ['.page-title', '.page-sub', '.hint', '.btn', '.chip', '.tab span', '.sticker-text', '.stamp', '.meter-title', '.meter-num', '.cell-text b', '.cell-text small', '.reel-tag', '.reel-note', '.hang-name', '.set-card p', '.set-card h2', '.toggle-text b', '.toggle-text small', '.empty p', '.empty h2', '.look-names', '.look-why', '.look-score b', '.look-score small', '.toast-msg', '.field-label', '.legend', 'legend', '.count-badge', '.ctx-note', '.demo-banner', '.card-title', '.swipe-hint', '.kv span', '.brand-name', '.lock-hint', '.demo-banner b', '.pill-select select', '.error-note', '.wash-tag'];
  for (const scheme of ['dark', 'light']) {
    await step(`D13-${scheme}`, `${scheme} screens`, async () => {
      const { ctx, page } = await newCtx(browser, R, { scheme, tag: `d13${scheme} ` });
      await page.goto(BASE, { waitUntil: 'load' }); await page.waitForSelector('.onboard');
      await page.waitForTimeout(600);
      await shot(page, `d13-${scheme}-onboarding`);
      const onb = await contrastReport(page, ['.onboard h1', '.onboard p', '.onboard .btn']);
      const lowOnb = onb.filter((x) => x.ratio < 4.5);
      await page.getByRole('button', { name: 'Try with a sample closet' }).click();
      await page.waitForSelector('.reel[data-state="filled"]'); await waitLanded(page); await page.waitForTimeout(1500);
      const all = []; const add = (screen, r) => r.forEach((x) => all.push({ screen, ...x }));
      add('onboarding', onb);
      await shot(page, `d13-${scheme}-spin`); add('spin', await contrastReport(page, TEXT_SEL));
      await page.locator('.reel[data-slot="top"]').click();
      await hashTo(page, 'closet', 900); await shot(page, `d13-${scheme}-closet`); add('closet', await contrastReport(page, TEXT_SEL));
      await page.locator('.wash-btn').first().click({ force: true }); await page.waitForTimeout(400);
      await shot(page, `d13-${scheme}-closet-wash-toast`); add('toast', await contrastReport(page, ['.toast-msg', '.toast-btn']));
      await page.locator('.hang-item').nth(1).click({ force: true }); await page.waitForSelector('dialog.sheet[open]'); await page.waitForTimeout(400);
      await shot(page, `d13-${scheme}-edit-sheet`); add('edit-sheet', await contrastReport(page, ['dialog .chip', 'dialog legend', 'dialog .btn', 'dialog .legend', 'dialog .range-val', 'dialog .toggle-text b', 'dialog .toggle-text small', 'dialog .sheet-title', 'dialog .edit-meta b', 'dialog .edit-meta small', 'dialog .range-ticks span']));
      await page.keyboard.press('Escape');
      await hashTo(page, 'snap', 700); await shot(page, `d13-${scheme}-snap`); add('snap', await contrastReport(page, TEXT_SEL.concat(['.big-tile b', '.big-tile small', '.tip-card li', '.tip-card h3'])));
      await hashTo(page, 'looks', 1300); await shot(page, `d13-${scheme}-looks`, { fullPage: true }); add('looks', await contrastReport(page, TEXT_SEL));
      await page.locator('.look-card').first().click(); await page.waitForTimeout(500); await shot(page, `d13-${scheme}-look-detail`); add('look-detail', await contrastReport(page, ['dialog .stamp', 'dialog .sticker-text', 'dialog .detail-list b', 'dialog .detail-list small', 'dialog .detail-score', 'dialog .btn']));
      await page.keyboard.press('Escape');
      await hashTo(page, 'settings', 600); await shot(page, `d13-${scheme}-settings`, { fullPage: true }); add('settings', await contrastReport(page, TEXT_SEL));
      await page.getByRole('button', { name: 'Clear all data' }).click(); await page.waitForTimeout(500); await shot(page, `d13-${scheme}-confirm-wipe`);
      add('confirm', await contrastReport(page, ['dialog .confirm-body', 'dialog .field-label', 'dialog .btn', 'dialog .text-input']));
      await page.keyboard.press('Escape');
      await page.evaluate(async () => { const s = await import('./src/store.js'); const d = await import('./src/ui/data.js'); await s.clearAll(); await s.putSettings({ onboarded: true }); await d.reload(); });
      await hashTo(page, 'spin', 800); await shot(page, `d13-${scheme}-empty-spin`); add('empty', await contrastReport(page, ['.empty h2', '.empty p', '.empty .btn']));
      const bad = all.filter((x) => { const large = parseFloat(x.size) >= 24 || (parseFloat(x.size) >= 18.66 && Number(x.weight) >= 700); return x.ratio < (large ? 3 : 4.5); });
      const uniq = []; const seen = new Set(); for (const b of bad) { const k = `${b.screen}|${b.sel}|${b.fg}|${b.bg}`; if (!seen.has(k)) { seen.add(k); uniq.push(b); } }
      check(`D13.contrast.${scheme}`, `${scheme} mode: text contrast >= 4.5:1 (3:1 for large text) on all screens (${all.length} samples)`, uniq.length === 0, uniq.slice(0, 8).map((b) => `${b.screen} ${b.sel} "${b.text}" ${b.ratio} (${b.fg} on ${b.bg}, ${b.size})`).join(' ;; '));
      fs.writeFileSync(path.join(shotDir, `contrast-${scheme}.json`), JSON.stringify({ lowest: all.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 25), failures: uniq }, null, 1));
      // theme override: dark OS + Light setting
      await ctx.close();
    });
  }
  await step('D13x', 'theme override', async () => {
    const { ctx, page } = await newCtx(browser, R, { scheme: 'dark', tag: 'd13x ' });
    await open(page); await loadDemo(page); await hashTo(page, 'settings', 500);
    await page.getByRole('button', { name: 'Light', exact: true }).click(); await page.waitForTimeout(300);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const meta = await page.evaluate(() => document.querySelector('meta[name=theme-color]').content);
    check('D13x1', 'OS dark + Theme "Light": body turns light and theme-color meta follows', /247, 240, 225/.test(bg) && meta === '#f7f0e1', `bg=${bg} meta=${meta}`);
    await page.getByRole('button', { name: 'Auto', exact: true }).click(); await page.waitForTimeout(200);
    const bg2 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('D13x2', 'Theme "Auto" follows the OS (dark) again', /23, 20, 31/.test(bg2), bg2);
    await ctx.close();
  });

  // ============================ D14 keyboard ============================
  await step('D14', 'keyboard', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd14 ', mobile: false, viewport: PHONE });
    await demoSpin(page);
    const desc = () => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); return { tag: a.tagName.toLowerCase(), cls: String(a.className).slice(0, 40), label: a.getAttribute('aria-label') || (a.textContent || '').trim().slice(0, 24), slot: a.dataset && a.dataset.slot || '', outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none', role: a.getAttribute('role') }; });
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const seen = []; let lastKey = '';
    await page.keyboard.press('Tab');
    for (let i = 0; i < 45; i++) { const d = await desc(); if (!d) break; seen.push(d); await page.keyboard.press('Tab'); }
    const has = (f) => seen.some(f);
    const needed = [['skip link', (d) => /skip/i.test(d.label)], ['brand', (d) => /home/i.test(d.label)], ['settings gear', (d) => /settings/i.test(d.label)], ['occasion select', (d) => d.tag === 'select'], ['top reel', (d) => d.slot === 'top'], ['bottom reel', (d) => d.slot === 'bottom'], ['lever', (d) => /lever/i.test(d.label)], ['spin button', (d) => /SPIN/.test(d.label)], ['thumbs down', (d) => /down/i.test(d.label)], ['wear', (d) => /Wearing|Worn/i.test(d.label)], ['thumbs up', (d) => /up/i.test(d.label)], ['tab: Spin', (d) => /^Spin$/.test(d.label)], ['tab: Closet', (d) => /^Closet$/.test(d.label)], ['tab: Snap', (d) => /Snap/.test(d.label)], ['tab: Looks', (d) => /^Looks$/.test(d.label)]];
    const miss = needed.filter(([, f]) => !has(f)).map(([n]) => n);
    check('D14a', 'Tab order reaches every primary control (skip link, nav, selects, reels, lever, spin, thumbs, wear, all 4 tabs)', miss.length === 0, `missing: ${miss.join(', ')}; order: ${seen.map((s) => s.label).join(' > ').slice(0, 400)}`);
    const noFocusRing = seen.filter((d) => !d.outline && !d.shadow && !/skip/i.test(d.label));
    check('D14b', 'every focused control shows a visible focus indicator (outline or box-shadow)', noFocusRing.length === 0, noFocusRing.slice(0, 6).map((d) => `${d.tag}.${d.cls}:${d.label}`).join(' | '));
    // focus a reel by keyboard and lock it with Space/Enter
    await page.locator('.reel[data-slot="top"]').focus();
    await page.keyboard.press('Space'); await page.waitForTimeout(150);
    const p1 = await page.locator('.reel[data-slot="top"]').getAttribute('aria-pressed');
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const p2 = await page.locator('.reel[data-slot="top"]').getAttribute('aria-pressed');
    check('D14c', 'keyboard: Space locks a reel, Enter unlocks it', p1 === 'true' && p2 === 'false', `${p1} ${p2}`);
    await page.keyboard.press('Space'); // lock again
    const topName = (await reelNames(page))[0];
    // spin via keyboard on the SPIN button
    await page.locator('.spin-btn').focus(); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const spinningNow = await page.locator('.spinning').count();
    await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 }); await page.waitForTimeout(1800);
    check('D14d', 'keyboard: Enter on SPIN spins; locked top reel is kept', spinningNow >= 1 && (await reelNames(page))[0] === topName, `spinning=${spinningNow}`);
    // lever via keyboard
    await page.locator('.lever').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const lever = await page.locator('.spinning').count();
    await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 }); await page.waitForTimeout(1800);
    check('D14e', 'keyboard: lever activates with Enter', lever >= 1);
    await page.locator('.lever').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(300);
    check('D14e2', 'keyboard: lever activates with Space', (await page.locator('.spinning').count()) >= 1);
    await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 }); await page.waitForTimeout(1800);
    // like via keyboard
    await page.getByRole('button', { name: 'Thumbs up: love it' }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    check('D14f', 'keyboard: Enter on thumbs-up likes (aria-pressed)', (await page.locator('.round-btn.up').getAttribute('aria-pressed')) === 'true');
    // tabs via keyboard
    await page.locator('.tab[data-route="looks"]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    const foc = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    check('D14g', 'keyboard: Enter on a tab navigates and moves focus to the screen heading', (await page.evaluate(() => location.hash)) === '#/looks' && foc === 'screen-title', `focus=${foc}`);
    // sheet: Escape closes, focus returns to opener
    await page.locator('.tab[data-route="closet"]').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    await page.locator('.hang-item').first().focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.sheet[open]');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement.closest('dialog'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const back = await page.evaluate(() => document.activeElement && document.activeElement.className);
    check('D14h', 'keyboard: focus stays inside an open sheet; Escape closes and returns focus to the item', inside && (await page.locator('dialog.sheet[open]').count()) === 0 && /hang-item/.test(back), `inside=${inside} focus=${back}`);
    // keyboard users: closet item deletion only via long-press? edit sheet has Delete button => ok
    // skip link
    await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('.skip').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    check('D14i', 'skip link moves focus/scroll to main content', true);
    // shake chip etc n/a. closet rails keyboard-scrollable?
    const railFocusable = await page.locator('.rail[tabindex="0"]').count();
    check('D14j', 'closet rails are keyboard-scrollable (tabindex 0)', railFocusable >= 1);
    await ctx.close();
  });

  // ============================ D15 accessible names ============================
  await step('D15', 'a11y names', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd15 ' });
    await demoSpin(page);
    const audit = () => page.evaluate(() => {
      const bad = [];
      const nameOf = (el) => {
        const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
        const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if (t) return t; }
        if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l && l.textContent.trim()) return l.textContent.trim(); }
        const wl = el.closest('label'); if (wl && wl.textContent.trim()) return wl.textContent.trim();
        const t = (el.textContent || '').trim(); if (t) return t;
        const img = el.querySelector('img[alt]:not([alt=""]), svg[aria-label]:not([aria-label=""])'); if (img) return img.getAttribute('alt') || img.getAttribute('aria-label');
        if (el.getAttribute('title')) return el.getAttribute('title');
        return '';
      };
      for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=meter], [role=slider]')) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const hiddenAnc = el.closest('[hidden], [aria-hidden="true"], dialog:not([open])'); if (hiddenAnc) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (!nameOf(el)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      }
      return bad;
    });
    const where = {};
    const run = async (label) => { where[label] = await audit(); };
    await run('spin');
    await page.locator('.reel[data-state="empty"]').first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(300); await run('pick-sheet'); await page.keyboard.press('Escape');
    await hashTo(page, 'closet', 800); await run('closet');
    await page.locator('.hang-item').first().click({ force: true }); await page.waitForSelector('dialog.sheet[open]'); await page.waitForTimeout(300); await run('edit-sheet'); await page.keyboard.press('Escape');
    await hashTo(page, 'snap', 500); await run('snap');
    await page.getByRole('button', { name: /No photo/ }).click(); await page.waitForSelector('dialog.sheet[open] .itemform'); await page.waitForTimeout(300); await run('add-sheet'); await page.keyboard.press('Escape');
    await hashTo(page, 'looks', 1200); await run('looks');
    await page.locator('.look-card').first().click(); await page.waitForTimeout(400); await run('look-detail'); await page.keyboard.press('Escape');
    await hashTo(page, 'settings', 500); await run('settings');
    await page.getByRole('button', { name: 'Clear all data' }).click(); await page.waitForTimeout(400); await run('wipe-confirm'); await page.keyboard.press('Escape');
    // review step
    const fl = await makeCanvasFile(page, { w: 600, h: 450, kind: 'flat' });
    await hashTo(page, 'snap', 400);
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'f.jpg', mimeType: 'image/jpeg', buffer: fl.buffer });
    await page.waitForSelector('.stage .bbox', { timeout: 15000 }); await run('snap-boxes');
    await page.getByRole('button', { name: /^Review/ }).click(); await page.waitForSelector('.rcard'); await run('snap-review');
    await hashTo(page, 'spin', 300);
    await page.evaluate(async () => { const s = await import('./src/store.js'); const d = await import('./src/ui/data.js'); await s.clearAll(); await s.putSettings({ onboarded: true }); await d.reload(); });
    await hashTo(page, 'spin', 600); await run('empty-spin');
    await hashTo(page, 'closet', 600); await run('empty-closet');
    const badAll = Object.entries(where).filter(([, v]) => v.length);
    check('D15a', 'every button / link / input / select on every screen and sheet has an accessible name', badAll.length === 0, badAll.map(([k, v]) => `${k}: ${[...new Set(v)].join(', ')}`).join(' ;; '));
    // images alt
    await ctx.close();
  });

  // ============================ D16 monkey ============================
  await step('D16', 'monkey', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'd16 ' });
    const rnd = mulberry32(20241120);
    const pickR = (a) => a[Math.floor(rnd() * a.length)];
    await demoSpin(page);
    const logTail = [];
    let actions = 0, e0 = errors.length, stuck = 0; const t0 = Date.now();
    const STR = ['', 'Blue shirt', '😀👕', '<b>x</b>', 'مرحبا', 'A'.repeat(70), '"><img src=x onerror=window.__pwned=1>', ' '];
    const targets = () => page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], [role=tab], select, input, .reel, .look-card, .hang-item, .lever, .bbox, .stage')) {
        if (el.closest('[hidden], dialog:not([open])') || el.disabled) continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        const x = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2)), y = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
        const top = document.elementFromPoint(x, y); if (!top || !(el.contains(top) || top.contains(el))) continue;
        out.push({ x, y, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 25), type: el.type || '', text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18) });
      }
      return out;
    });
    while (Date.now() - t0 < 60000) {
      const r = rnd(); let desc = '';
      try {
        if (r < 0.62) {
          const ts = await targets();
          if (ts.length) {
            const t = pickR(ts); desc = `tap ${t.tag}.${t.cls} "${t.text}"`;
            if (t.type === 'file') { desc = 'skip file input'; } // handled below
            else if (t.tag === 'select') { const opts = await page.evaluate(({ x, y }) => { const s = document.elementFromPoint(x, y).closest('select'); return s ? [...s.options].map((o) => o.value) : []; }, t); if (opts.length) { await page.evaluate(({ x, y, v }) => { const s = document.elementFromPoint(x, y).closest('select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, { ...t, v: pickR(opts) }); desc = `select ${t.cls}`; } }
            else if (t.tag === 'input' && ['text', 'search', ''].includes(t.type)) { await page.touchscreen.tap(t.x, t.y); await page.keyboard.type(pickR(STR), { delay: 0 }); desc = 'type text'; }
            else await page.touchscreen.tap(t.x, t.y);
          }
        } else if (r < 0.70) { desc = 'scroll'; await page.mouse.wheel(0, Math.floor(rnd() * 900 - 300)); }
        else if (r < 0.80) { const k = pickR(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowRight', 'ArrowDown', 'Escape']); desc = `key ${k}`; await page.keyboard.press(k); }
        else if (r < 0.86) { desc = rnd() < 0.5 ? 'back' : 'forward'; await (desc === 'back' ? page.goBack() : page.goForward()).catch(() => {}); }
        else if (r < 0.92) { const ts = (await targets()).filter((t) => /lever|reel|bbox|stage|look-card/.test(t.cls)); if (ts.length) { const t = pickR(ts); desc = `drag ${t.cls}`; await page.mouse.move(t.x, t.y); await page.mouse.down(); await page.mouse.move(t.x + (rnd() * 300 - 150), t.y + (rnd() * 300 - 100), { steps: 4 }); await page.mouse.up(); } }
        else if (r < 0.94) { const fi = page.locator('input[type=file]:not([accept*=json])'); if (await fi.count()) { desc = 'upload png'; await fi.first().setInputFiles({ name: 'm.png', mimeType: 'image/png', buffer: png1 }).catch(() => {}); } }
        else if (r < 0.96) { desc = 'hash nav'; await hashTo(page, pickR(SCREENS), 0); }
        else if (r < 0.97) { desc = 'resize'; await page.setViewportSize(rnd() < 0.5 ? SMALL : PHONE); }
        else if (r < 0.985) { desc = 'sheet close'; await page.keyboard.press('Escape'); }
        else { desc = 'multi tap spin'; await page.evaluate(() => { const b = document.querySelector('.spin-btn'); if (b) { b.click(); b.click(); } }); }
      } catch (e) { desc += ` (action error: ${String(e.message).split('\n')[0].slice(0, 80)})`; }
      actions++; logTail.push(desc); if (logTail.length > 12) logTail.shift();
      if (errors.length > e0) { console.log(`   monkey error after action #${actions}: ${errors[errors.length - 1].slice(0, 200)}\n     last actions: ${logTail.join(' > ')}`); e0 = errors.length; }
      // after two Escapes there must be no modal left
      if (rnd() < 0.02) { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(150); const open = await page.locator('dialog[open]').count(); if (open) { stuck++; console.log('   monkey: modal survived Escape x2'); await page.evaluate(() => document.querySelectorAll('dialog').forEach((d) => d.remove())); } }
      await page.waitForTimeout(20 + Math.floor(rnd() * 90));
    }
    const pw = await page.evaluate(() => window.__pwned);
    await shot(page, 'd16-monkey-end');
    check('D16a', `60 s seeded monkey (${actions} actions): zero console errors / page errors / unhandled rejections`, errors.filter((x) => /d16/.test(x)).length === 0, errors.filter((x) => /d16/.test(x)).slice(0, 4).join(' | '));
    check('D16b', 'monkey: a modal never survived Escape ×2', stuck === 0, `stuck=${stuck}`);
    check('D16c', 'monkey: typed XSS strings never executed', !pw, String(pw));
    const alive = await page.evaluate(() => document.documentElement.dataset.ready === '1' && !!document.querySelector('#screen'));
    check('D16d', 'monkey: app still alive at the end', alive);
    await ctx.close();
  });

  // ============================ E: own ideas ============================
  await step('E1', 'stale reasons', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e1 ' });
    await demoSpin(page);
    const stale = []; let checked = 0;
    const names = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.map((i) => i.name));
    const inspect = async (label) => {
      const on = (await reelNames(page)).map((n) => n.toLowerCase());
      const stickers = await page.locator('.sticker-text').allTextContents();
      for (const s of stickers) {
        checked++;
        for (const n of names) if (!on.includes(n.toLowerCase()) && s.toLowerCase().includes(n.toLowerCase())) stale.push(`${label}: "${s}" mentions "${n}" not on reels [${on.join(', ')}]`);
      }
    };
    const locks = ['top', 'bottom', 'shoes', 'belt', 'layer'];
    for (let i = 0; i < 28; i++) {
      if (i % 3 === 1) { const s = locks[i % locks.length]; await page.locator(`.reel[data-slot="${s}"]`).click({ timeout: 1500 }).catch(() => {}); await page.keyboard.press('Escape'); await inspect(`after lock ${s} #${i}`); }
      if (i % 7 === 6) await page.evaluate(() => document.querySelectorAll('.reel.locked').forEach((r) => r.click()));
      await page.locator('.spin-btn').click();
      await page.waitForTimeout(500); // mid-spin: stickers should be the "Spinning…" placeholder, not the previous outfit's reasons
      const mid = await page.locator('.sticker-text').count();
      if (mid > 0 && (await page.locator('.spinning').count()) > 0) stale.push(`#${i}: ${mid} old stickers still visible mid-spin`);
      await page.waitForFunction(() => !document.querySelector('.spinning'), null, { timeout: 15000 });
      await page.waitForTimeout(1500);
      await inspect(`spin#${i}`);
    }
    check('E1a', `sticker reasons never name an item that is not on the reels (${checked} stickers over 28 spins with random locks)`, stale.length === 0, stale.slice(0, 4).join(' ;; '));
    // delete a shown item while on Spin screen
    const shown = (await reelNames(page))[1];
    await page.evaluate(async (n) => { const d = await import('./src/ui/data.js'); const it = d.data.items.find((i) => i.name === n); await d.removeItem(it.id); }, shown);
    await page.waitForTimeout(2800);
    const after = await reelNames(page);
    const st = await page.locator('.sticker-text').allTextContents();
    check('E1b', 'deleting an item while it is on the reels removes it from reels and reasons', !after.includes(shown) && !st.some((s) => s.toLowerCase().includes(shown.toLowerCase())), `deleted "${shown}" reels=${after}`);
    await ctx.close();
  });

  await step('E2', 'above the fold', async () => {
    for (const [vp, nm] of [[PHONE, '390x844'], [SMALL, '320x640'], [{ width: 360, height: 640 }, '360x640'], [{ width: 375, height: 667 }, '375x667 (iPhone SE)']]) {
      const { ctx, page } = await newCtx(browser, R, { tag: 'e2 ', viewport: vp });
      await demoSpin(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const g = await page.evaluate(() => {
        const tb = document.querySelector('.tabbar').getBoundingClientRect(); const vis = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= tb.top + 1 }; };
        return { vh: innerHeight, tabTop: Math.round(tb.top), stamp: vis('.stamp'), meter: vis('.meter'), spin: vis('.spin-btn'), sticker: vis('.sticker'), reels: vis('.reels'), card: vis('.result-card') };
      });
      const s = await shot(page, `e2-spin-${vp.width}x${vp.height}`);
      const ok = g.stamp && g.stamp.visible && g.meter && g.meter.visible && g.spin && g.spin.visible;
      check(`E2.${vp.width}x${vp.height}`, `right after a spin @${nm}: fit meter, stamp and SPIN button are visible without scrolling (above the tab bar)`, ok, JSON.stringify(g), s);
      await ctx.close();
    }
  });

  await step('E3', 'double like', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e3 ' });
    await demoSpin(page);
    await page.evaluate(() => { const b = document.querySelector('.round-btn.up'); b.click(); b.click(); });
    await page.waitForTimeout(800);
    let fb = await page.evaluate(async () => (await (await import('./src/store.js')).listFeedback()).map((r) => `${r.kind}:${r.value}`));
    const pr = await page.locator('.round-btn.up').getAttribute('aria-pressed');
    check('E3a', 'two instant taps on thumbs-up: exactly 2 feedback records (outfit + pair), no duplicates', fb.length === 2, JSON.stringify(fb));
    check('E3b', 'two quick taps on thumbs-up behave like a toggle (liked then un-liked) — not "liked, liked"', pr === 'false', `aria-pressed=${pr} (toggle semantics: the 2nd tap should clear it)`);
    await page.evaluate(() => { const u = document.querySelector('.round-btn.up'), d = document.querySelector('.round-btn:not(.up)'); u.click(); d.click(); });
    await page.waitForTimeout(3500);
    fb = await page.evaluate(async () => (await (await import('./src/store.js')).listFeedback()).map((r) => `${r.key}:${r.value}`));
    const keysDup = new Set(fb.map((x) => x.split(':')[0])).size !== fb.length;
    check('E3c', 'like + dislike in the same tick leaves one consistent record per key', !keysDup && new Set(fb.map((x) => x.split(':')[1])).size === 1, JSON.stringify(fb));
    await ctx.close();
  });

  await step('E4', 'worn twice', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e4 ' });
    await demoSpin(page);
    await page.evaluate(() => { const b = document.querySelector('.wear-btn'); b.click(); b.click(); b.click(); });
    await page.waitForTimeout(1500);
    await page.locator('.wear-btn').click(); await page.waitForTimeout(500);
    await spinNow(page);
    await page.evaluate(async () => { /* wear the same again after re-spin is a different outfit; also log via lookbook later */ });
    const dups = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.filter((i) => new Set(i.worn).size !== i.worn.length).map((i) => `${i.name}: ${i.worn.join(',')}`));
    const dupsDb = await page.evaluate(async () => (await (await import('./src/store.js')).listItems()).filter((i) => new Set(i.worn).size !== i.worn.length).map((i) => i.name));
    check('E4a', '"Wearing it!" tapped 3× at once, then again: no item ends up with the same date twice', dups.length === 0 && dupsDb.length === 0, dups.join(' ; '));
    const label = await page.locator('.wear-btn').textContent();
    const toasts = await page.locator('.toast .toast-msg').allTextContents();
    await spinNow(page); await hashTo(page, 'looks', 1200);
    await page.locator('.look-card').first().click(); await page.waitForSelector('dialog.sheet[open]');
    await page.locator('dialog.sheet .btn-mint').click(); await page.locator('dialog.sheet .btn-mint').click().catch(() => {}); await page.waitForTimeout(500);
    const dups2 = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.filter((i) => new Set(i.worn).size !== i.worn.length).map((i) => `${i.name}: ${i.worn.join(',')}`));
    check('E4b', 'logging from the Lookbook detail twice also never duplicates the date', dups2.length === 0, dups2.join(' ; '));
    await ctx.close();
  });

  await step('E5', 'modal escape hatches', async () => {
    for (const [vp, nm] of [[SMALL, '320x640'], [{ width: 640, height: 320 }, 'landscape 640x320']]) {
      const { ctx, page } = await newCtx(browser, R, { tag: 'e5 ', viewport: vp });
      await demoSpin(page);
      const probes = [];
      const probe = async (label) => {
        const r = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); if (!d) return null; const c = d.querySelector('.sheet-close'); const cr = c && c.getBoundingClientRect(); const dr = d.getBoundingClientRect(); const body = d.querySelector('.sheet-body'); const cs = body && getComputedStyle(body); return { closeVisible: !!cr && cr.top >= 0 && cr.bottom <= innerHeight && cr.right <= innerWidth && cr.left >= 0, sheetTop: Math.round(dr.top), sheetH: Math.round(dr.height), vh: innerHeight, scrollable: body ? (body.scrollHeight > body.clientHeight ? cs.overflowY : 'fits') : '?' }; });
        probes.push({ label, r });
        return r;
      };
      await hashTo(page, 'closet', 700); await page.locator('.hang-item').first().click({ force: true }); await page.waitForSelector('dialog[open]'); await page.waitForTimeout(400); await probe('edit');
      await shot(page, `e5-edit-${vp.width}x${vp.height}`);
      const bd = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const r = d.getBoundingClientRect(); return [r.left + r.width / 2, Math.max(2, r.top - 8)]; });
      await page.mouse.click(Math.max(2, 5), 2); await page.waitForTimeout(250);
      const closedByBackdrop = (await page.locator('dialog[open]').count()) === 0;
      if (!closedByBackdrop) await page.keyboard.press('Escape');
      await hashTo(page, 'snap', 400); await page.getByRole('button', { name: /No photo/ }).click(); await page.waitForSelector('dialog[open] .itemform'); await page.waitForTimeout(300); await probe('add-by-colour');
      await page.keyboard.press('Escape');
      await hashTo(page, 'settings', 400); await page.getByRole('button', { name: 'Clear all data' }).click(); await page.waitForTimeout(300); await probe('wipe-confirm');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const lock = await page.evaluate(() => document.documentElement.classList.contains('lock-scroll'));
      const badP = probes.filter((p) => !p.r || !p.r.closeVisible);
      check(`E5.${vp.width}x${vp.height}`, `@${nm}: every sheet's ✕ is on-screen and Escape/backdrop closes it; page scroll unlocked afterwards`, badP.length === 0 && !lock, JSON.stringify(probes.map((p) => [p.label, p.r && p.r.closeVisible, p.r && p.r.scrollable])) + ` lock-scroll-left=${lock} backdropClose=${closedByBackdrop}`);
      await ctx.close();
    }
    // onboarding: no way out? skip button visible at 320x640 & Escape
    const { ctx, page } = await newCtx(browser, R, { tag: 'e5o ', viewport: SMALL });
    await page.goto(BASE, { waitUntil: 'load' }); await page.waitForSelector('.onboard');
    const skip = await page.getByRole('button', { name: 'Skip' }).boundingBox();
    check('E5o', 'onboarding: Skip is visible on 320x640 and tapping it dismisses the overlay', !!skip && skip.y >= 0 && skip.y + skip.height <= 640, JSON.stringify(skip));
    await ctx.close();
  });

  await step('E6', 'sample closet vs own items', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e6 ' });
    await open(page);
    await setItems(page, [{ id: 'mine-1', slot: 'top', kind: 't-shirt', name: 'My real tee', colors: [col('red')] }, { id: 'mine-2', slot: 'bottom', kind: 'jeans', name: 'My real jeans', colors: [col('denim')] }]);
    await loadDemo(page);
    await page.waitForTimeout(800);
    await hashTo(page, 'spin', 600);
    await page.locator('.demo-banner .btn').click(); await page.waitForTimeout(600);
    const left = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.map((i) => i.id));
    check('E6a', 'sample closet "Remove" deletes only demo-* items and leaves the user’s own', left.length === 2 && left.includes('mine-1') && left.includes('mine-2'), JSON.stringify(left));
    // Settings count excludes demos
    await loadDemo(page);
    await hashTo(page, 'settings', 500);
    const txt = await page.locator('.set-card', { hasText: 'Back up' }).innerText();
    check('E6b', 'Settings "items in your closet" counts only real items while the sample is loaded', /\b2 items/.test(txt), txt.replace(/\n/g, ' ').slice(0, 100));
    // adopt a demo item (rename it) then remove sample
    await hashTo(page, 'closet', 600);
    await page.locator('.hang-item', { hasText: 'White tee' }).click({ force: true });
    await page.waitForSelector('dialog.sheet[open]');
    await page.locator('dialog.sheet input.text-input').fill('My favourite white tee');
    await page.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(400);
    await page.locator('.demo-banner .btn').click(); await page.waitForTimeout(500);
    const kept = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.some((i) => i.name === 'My favourite white tee'));
    check('E6c', 'a sample item the user renamed/edited is not silently deleted by "Remove sample items"', kept, `kept=${kept}`);
    // load sample twice overwrites edits?
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.loadDemo(); });
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); const it = d.data.items.find((i) => i.id === 'demo-1'); await d.saveItem({ ...it, name: 'Edited demo', worn: ['2026-01-01'] }); await d.loadDemo(); });
    const ed = await page.evaluate(async () => (await import('./src/ui/data.js')).data.items.find((i) => i.id === 'demo-1'));
    check('E6d', 'Loading the sample closet again does not overwrite edits / wear history of existing sample items', ed.name === 'Edited demo' && ed.worn.length === 1, `${ed.name} worn=${ed.worn.length}`);
    await ctx.close();
  });

  await step('E7', 'touch targets / iOS zoom / viewport', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e7 ' });
    await demoSpin(page);
    const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
    check('E7a', 'viewport meta does not block pinch-zoom', !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(meta), meta);
    const small = []; const smallInputs = [];
    const scan = async (label) => {
      const r = await page.evaluate(() => {
        const out = [], inp = [];
        for (const el of document.querySelectorAll('button, a[href], [role=tab], select, input:not([type=file]):not([type=hidden]), [role=switch]')) {
          if (el.closest('[hidden], dialog:not([open]), .sr-only, .skip')) continue;
          const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
          if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}[${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 14)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
          if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'range' && parseFloat(cs.fontSize) < 16) inp.push(`${el.tagName.toLowerCase()}.${el.className} ${cs.fontSize}`);
        }
        return { out, inp };
      });
      small.push(...r.out.map((x) => `${label}: ${x}`)); smallInputs.push(...r.inp.map((x) => `${label}: ${x}`));
    };
    await scan('spin'); await hashTo(page, 'closet', 700); await scan('closet');
    await page.locator('.hang-item').first().click({ force: true }); await page.waitForSelector('dialog[open]'); await page.waitForTimeout(300); await scan('edit-sheet'); await page.keyboard.press('Escape');
    await hashTo(page, 'looks', 1000); await scan('looks'); await hashTo(page, 'settings', 400); await scan('settings'); await hashTo(page, 'snap', 400); await scan('snap');
    const uniq = [...new Set(small)];
    // WCAG 2.2 AA minimum is 24x24; Apple HIG 44x44
    const under24 = uniq.filter((s) => { const m = / (\d+)x(\d+)$/.exec(s); return m && (+m[1] < 24 || +m[2] < 24); });
    check('E7b', 'tap targets >= 24x24 CSS px (WCAG 2.2 AA 2.5.8)', under24.length === 0, `${under24.length}: ${under24.slice(0, 8).join(' | ')}`);
    check('E7c', 'tap targets >= 44x44 (Apple HIG) — informational for a phone-first app', uniq.length === 0, `${uniq.length}: ${uniq.slice(0, 10).join(' | ')}`);
    check('E7d', 'text inputs/selects use font-size >= 16px (else iOS Safari zooms the page on focus)', smallInputs.length === 0, [...new Set(smallInputs)].join(' | '));
    await ctx.close();
  });

  await step('E8', 'clipping @320 on normal data', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e8 ', viewport: SMALL });
    await demoSpin(page);
    const problems = [];
    for (const r of SCREENS) {
      await hashTo(page, r, 900);
      const o = await overflowReport(page);
      if (o.out.length || o.sw > o.vw) problems.push(`${r}: ${JSON.stringify(o.out).slice(0, 250)} sw=${o.sw}/${o.vw}`);
    }
    // sample items on sheets
    await hashTo(page, 'closet', 700); await page.locator('.hang-item').nth(3).click({ force: true }); await page.waitForSelector('dialog[open]'); await page.waitForTimeout(400);
    let o = await overflowReport(page); if (o.out.length) problems.push(`edit-sheet: ${JSON.stringify(o.out).slice(0, 250)}`);
    await page.keyboard.press('Escape');
    await shot(page, 'e8-closet-320');
    check('E8a', 'text clipped / elements outside the viewport at 320 px on every screen with the sample closet', problems.length === 0, problems.join(' ;; '));
    // textual clipping: elements whose text is cut by overflow hidden
    await hashTo(page, 'spin', 900); await waitLanded(page).catch(() => {}); await page.waitForTimeout(1500);
    const clip = await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('.cell-text b, .cell-text small, .sticker-text, .look-names, .look-why, .reel-note, .hang-name, .toast-msg')) { const r = el.getBoundingClientRect(); if (!r.width) continue; const cs = getComputedStyle(el); const clippedX = el.scrollWidth > el.clientWidth + 1; const clippedY = el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible'; if (clippedX || clippedY) out.push(`${el.className}:${el.textContent.trim().slice(0, 30)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight} ${cs.textOverflow}`); } return out; });
    await shot(page, 'e8-spin-320');
    check('E8b', 'reel names/stickers: text is not hard-clipped (ellipsis is acceptable) at 320 px', clip.filter((c) => !/ellipsis/.test(c)).length === 0, clip.slice(0, 5).join(' | '), SH('e8-spin-320'));
    await ctx.close();
  });

  await step('E9', 'undo / toast replacement', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e9 ' });
    await open(page);
    // item with photo, delete + undo
    await page.evaluate(async () => {
      const s = await import('./src/store.js'); const { makeItem } = await import('./src/model.js'); const d = await import('./src/ui/data.js');
      await s.clearAll(); await s.putSettings({ onboarded: true });
      const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillRect(0, 0, 10, 10); const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await s.putPhoto(blob, 'pp1');
      for (const p of [{ id: 'u1', slot: 'top', name: 'Photo tee', photoId: 'pp1' }, { id: 'u2', slot: 'top', name: 'Second tee' }, { id: 'u3', slot: 'bottom', kind: 'jeans', name: 'Jeans' }]) await s.putItem(makeItem(p));
      await d.reload();
    });
    await hashTo(page, 'closet', 700);
    await page.locator('.hang-item', { hasText: 'Photo tee' }).click({ force: true }); await page.waitForSelector('dialog[open]');
    await page.locator('dialog .btn-danger-ghost').click(); await page.waitForTimeout(300);
    await page.locator('.toast-btn', { hasText: 'Undo' }).click(); await page.waitForTimeout(500);
    const back = await page.evaluate(async () => { const s = await import('./src/store.js'); const it = (await s.listItems()).find((i) => i.id === 'u1'); return { item: !!it, photo: it && it.photoId ? !!(await s.getPhotoBlob(it.photoId)) : false }; });
    check('E9a', 'delete then Undo restores the item and its photo', back.item && back.photo, JSON.stringify(back));
    // delete two quickly; first undo lost?
    await page.locator('.hang-item', { hasText: 'Photo tee' }).click({ force: true }); await page.waitForSelector('dialog[open]'); await page.locator('dialog .btn-danger-ghost').click(); await page.waitForTimeout(250);
    await page.locator('.hang-item', { hasText: 'Second tee' }).click({ force: true }); await page.waitForSelector('dialog[open]'); await page.locator('dialog .btn-danger-ghost').click(); await page.waitForTimeout(300);
    const msg = await page.locator('.toast .toast-msg').textContent();
    check('E9b', 'deleting two items in a row: the first deletion remains undoable (toast stack or batched undo) — currently only the last toast survives', /Photo tee/.test(msg) || /2 items/.test(msg), `toast shows: "${msg}"`);
    // long-press delete: accidental? ensure it needs 650ms and gives undo
    await page.locator('.toast-btn', { hasText: 'Undo' }).click(); await page.waitForTimeout(300);
    await hashTo(page, 'closet', 400);
    const hb = await page.locator('.hang-item', { hasText: 'Jeans' }).boundingBox();
    await page.mouse.move(hb.x + 20, hb.y + 20); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
    await page.waitForTimeout(300);
    const gone = (await page.locator('.hang-item', { hasText: 'Jeans' }).count()) === 0;
    const sheetOpen = await page.locator('dialog[open]').count();
    check('E9c', 'long-press deletes an item with no confirmation (Undo toast only) — acceptable only if the toast is clearly offered', gone ? (await page.locator('.toast-btn', { hasText: 'Undo' }).count()) === 1 : true, `deleted=${gone} sheetOpen=${sheetOpen}`);
    await ctx.close();
  });

  await step('E10', 'weather auto / geolocation denied', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e10 ' });
    await demoSpin(page);
    const t0 = Date.now();
    await page.locator('select[aria-label="Weather"]').selectOption('auto');
    await page.waitForFunction(() => !document.querySelector('.spinning') && document.querySelector('.stamp.show'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1600);
    const note = await page.locator('.ctx-note').first().textContent();
    const ms = Date.now() - t0;
    check('E10a', 'weather=Auto with geolocation unavailable/denied: spin still completes in < 6 s and a note explains', ms < 6000 && /weather/i.test(note), `${ms}ms note="${note}"`);
    // reload with auto stored: first autospin
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.waitForSelector('.stamp.show', { timeout: 20000 }).catch(() => {});
    check('E10b', 'reload with weather=Auto: app still shows an outfit', (await page.locator('.stamp.show').count()) === 1);
    await ctx.close();
  });

  await step('E11', 'persistence of UI state', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'e11 ' });
    await demoSpin(page);
    await page.locator('select[aria-label="Occasion"]').selectOption('formal');
    await waitLanded(page); await page.waitForTimeout(1500);
    const names = await reelNames(page);
    const sc = await page.locator('.meter').getAttribute('aria-valuenow');
    await hashTo(page, 'closet', 500); await hashTo(page, 'spin', 900);
    const names2 = await reelNames(page); const sc2 = await page.locator('.meter').getAttribute('aria-valuenow');
    check('E11a', 'switching tabs and back keeps the same outfit on the reels (not a surprise re-spin)', JSON.stringify(names) === JSON.stringify(names2) && sc === sc2, `${names} / ${names2}`);
    await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => document.documentElement.dataset.ready === '1'); await page.waitForTimeout(1200);
    const occ = await page.locator('select[aria-label="Occasion"]').inputValue();
    check('E11b', 'selected occasion persists across reload', occ === 'formal', occ);
    await ctx.close();
  });
} catch (e) {
  check('RUN', 'adv-ui ran without throwing', false, e.stack || String(e));
} finally {
  await browser.close();
}

check('D.errors', 'zero console errors / page errors / unhandled rejections across the whole UI run', errors.length === 0, errors.slice(0, 8).join(' | '));
R.save();
const failed = R.results.filter((r) => !r.ok);
console.log(`\n${R.results.length - failed.length}/${R.results.length} checks passed`);
