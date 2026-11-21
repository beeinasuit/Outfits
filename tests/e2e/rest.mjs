// E2E for the "rest" screens: laundry, snap cutouts, Your colors, complexion ranking, plan, settings taste, backup.
// Usage: node tests/e2e/rest.mjs [baseURL]   (serve the repo first: python3 -m http.server 8765)
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
const shots = path.join(here, 'rest-screenshots');
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const errors = [];
const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
const go = async (page, route, ms = 900) => { await page.evaluate((r) => { location.hash = `#/${r}`; }, route); await page.waitForTimeout(ms); };
const D = (page, fn, arg) => page.evaluate(async ([src, a]) => { const m = await import('./src/ui/data.js'); const mod = await import('./src/model.js'); return (new Function('m', 'mod', 'a', `return (async()=>{${src}})()`))(m, mod, a); }, [fn, arg]);

async function newCtx(browser, { scheme = 'light', viewport = { width: 390, height: 844 }, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION|FAILED|ABORTED)|net::/.test(t)) errors.push(`[console] ${t}`); } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { ctx, page };
}
async function boot(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  await page.getByRole('button', { name: 'Try with a sample closet' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.onboard').length === 0);
  await page.waitForTimeout(600);
}

async function makeFlatLay(page) {
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 700; const g = c.getContext('2d');
    g.fillStyle = '#e9e4da'; g.fillRect(0, 0, 900, 700);
    g.fillStyle = '#1f3a8a'; g.fillRect(70, 80, 300, 320);
    g.fillStyle = '#a4502a'; g.fillRect(520, 90, 300, 90);
    g.fillStyle = '#2a2a2a'; g.fillRect(480, 330, 340, 300);
    return c.toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1], 'base64');
}
async function makeSelfie(page, { skin = '#d9a47a', hair = '#2a1c14' } = {}) {
  const url = await page.evaluate(([skin, hair]) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800; const g = c.getContext('2d');
    g.fillStyle = '#d9dee2'; g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#33415c'; g.beginPath(); g.ellipse(300, 820, 270, 230, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = skin; g.fillRect(262, 470, 76, 140);
    g.fillStyle = hair; g.beginPath(); g.ellipse(300, 250, 134, 125, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = skin; g.beginPath(); g.ellipse(300, 340, 118, 152, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = hair; g.fillRect(250, 300, 28, 8); g.fillRect(322, 300, 28, 8);
    g.fillStyle = '#7a3b2e'; g.fillRect(278, 420, 44, 8);
    return c.toDataURL('image/png');
  }, [skin, hair]);
  return Buffer.from(url.split(',')[1], 'base64');
}

const browser = await chromium.launch();
try {
  // ======================= light 390 =======================
  let { ctx, page } = await newCtx(browser);
  await boot(page);

  // ---- laundry: auto-hamper
  const r1 = await D(page, `
    const tee = m.data.items.find(i => i.id === 'demo-1'), jeans = m.data.items.find(i => i.id === 'demo-8');
    const res = await m.logWorn({ items: { top: tee, bottom: jeans } });
    const t = m.data.items.find(i => i.id === 'demo-1'), j = m.data.items.find(i => i.id === 'demo-8');
    return { hampered: res.hampered, teeAvail: t.available, jeansAvail: j.available, limit: t.wearsBeforeWash };`);
  check('auto-hamper: tee (1 wear limit) goes to the hamper after wearing', r1.teeAvail === false && r1.limit === 1, JSON.stringify(r1));
  check('auto-hamper: jeans (4 wears) stay clean', r1.jeansAvail === true);

  await go(page, 'closet');
  await page.waitForSelector('.laundry-bar');
  const cnt = await page.locator('.hamper-count').textContent();
  check('closet shows hamper counter', /1 in the hamper/.test(cnt), cnt);
  check('hampered item is grayed with bubbles badge and worn info', await page.locator('.hang.washing .bubbles').count() >= 1 && /worn 1×/.test(await page.locator('.hang.washing .worn-info').first().textContent()));
  await page.screenshot({ path: `${shots}/01-closet-hamper.png` });
  await page.locator('.chip', { hasText: 'Hamper' }).click();
  check('hamper filter chip lists only hampered items', await page.locator('.hang').count() === 1);
  await page.locator('.chip', { hasText: 'All' }).click();
  // per-item toggle
  await page.locator('.hang.washing .wash-btn').click({ force: true });
  await page.waitForTimeout(400);
  check('per-item toggle marks clean (setClean)', (await D(page, `return m.data.items.find(i=>i.id==='demo-1').available`)) === true);
  await page.locator('.hang').filter({ hasText: 'White tee' }).locator('.wash-btn').click({ force: true });
  await page.waitForTimeout(300);
  check('per-item toggle sends back to hamper', (await D(page, `return m.data.items.find(i=>i.id==='demo-1').available`)) === false);

  // laundry day
  await page.locator('.laundry-btn').click();
  await page.waitForSelector('.wash-overlay');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/02-laundry-animation.png` });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/03-laundry-fresh-stamp.png` });
  await page.waitForSelector('.wash-overlay', { state: 'detached', timeout: 8000 });
  const toastTxt = await page.locator('.toast-msg').textContent();
  check('laundry day toast says pieces are fresh', /1 piece fresh and ready/.test(toastTxt), toastTxt);
  const r2 = await D(page, `
    const allClean = m.data.items.every(i => i.available);
    const since = m.data.items.map(i => mod.wearsSinceWash(i));
    return { allClean, maxSince: Math.max(...since), washed: m.data.items.every(i => i.lastWashed === mod.todayISO()) };`);
  check('laundry day restores everything and resets wear counts', r2.allClean && r2.maxSince === 0 && r2.washed, JSON.stringify(r2));
  check('hamper counter is empty after laundry', /empty/i.test(await page.locator('.hamper-count').textContent()));
  await page.screenshot({ path: `${shots}/04-closet-clean.png` });

  // auto-hamper off
  await D(page, `await m.setSetting({ autoHamper: false });`);
  const r3 = await D(page, `
    const sh = m.data.items.find(i => i.id === 'demo-4'), jeans = m.data.items.find(i => i.id === 'demo-9');
    const res = await m.logWorn({ items: { top: sh, bottom: jeans } });
    return { hampered: res.hampered, avail: m.data.items.find(i => i.id === 'demo-4').available };`);
  check('auto-hamper off: nothing is hampered', r3.hampered === 0 && r3.avail === true, JSON.stringify(r3));
  await D(page, `await m.setSetting({ autoHamper: true });`);

  // edit form: wears before wash
  await go(page, 'closet');
  await page.locator('.hang-item').first().click({ force: true });
  await page.waitForSelector('dialog.sheet[open] .ww');
  const wwBefore = await page.locator('.ww-val').textContent();
  await page.locator('.ww-btn').nth(1).click();
  const wwAfter = await page.locator('.ww-val').textContent();
  check('edit form has Wears before wash with per-kind default hint', wwBefore !== wwAfter && /Usual for/.test(await page.locator('.ww-hint').textContent()), `${wwBefore} -> ${wwAfter}`);
  await page.locator('dialog.sheet').getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(400);
  check('wears-before-wash edit is saved', (await D(page, `return m.data.items.some(i => i.wearsBeforeWash !== mod.defaultWearsBeforeWash(i.slot, i.kind))`)) === true);

  // ---- snap: cutouts
  await go(page, 'snap', 600);
  await page.waitForSelector('.snap-start');
  check('snap tip mentions leaving a gap', /gap/i.test(await page.locator('.tip-card').textContent()));
  const flat = await makeFlatLay(page);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: flat });
  await page.waitForSelector('.stage .bbox', { timeout: 20000 });
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.waitForSelector('.rcard', { timeout: 20000 });
  check('review card shows a cutout', await page.locator('.rcard .crop.cut').count() === 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/05-snap-review-cutout.png` });
  // background toggle: removed <-> original photo, live preview, big targets
  const optBox = await page.locator('.rcard .bg-opt').first().boundingBox();
  check('bg toggle targets are at least 44px', !!optBox && optBox.height >= 44 && optBox.width >= 44, JSON.stringify(optBox));
  const radio = (n) => page.getByRole('radio', { name: n });
  check('clean cutout starts on "Background removed"', (await radio('Background removed').getAttribute('aria-checked')) === 'true');
  await radio('Original photo').click();
  check('"Original photo" previews the plain crop', await page.locator('.rcard .crop.cut').count() === 0 && (await radio('Original photo').getAttribute('aria-checked')) === 'true');
  await page.screenshot({ path: `${shots}/05b-snap-review-original.png` });
  await radio('Background removed').click();
  check('switching back restores the cutout preview', await page.locator('.rcard .crop.cut').count() === 1);
  // item 2 is saved with the original photo only
  await page.getByRole('button', { name: 'Next item' }).click();
  await radio('Original photo').click();
  check('item 2 now shows the plain crop', await page.locator('.rcard .crop.cut').count() === 0);
  const before = await D(page, `return m.data.items.length`);
  await page.getByRole('button', { name: /^Save all/ }).click();
  await page.waitForSelector('.rail-sec', { timeout: 20000 });
  const sn = await D(page, `
    const mine = m.data.items.filter(i => !i.id.startsWith('demo-') && i.photoId);
    const store = await import('./src/store.js');
    const out = [];
    for (const it of mine) {
      if (!it.cutoutId) { out.push({ id: it.id, cut: false }); continue; }
      const blob = await store.getPhotoBlob(it.cutoutId);
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data; let lo = 0, hi = 0;
      for (let i = 3; i < px.length; i += 4) { if (px[i] < 20) lo++; else if (px[i] > 235) hi++; }
      out.push({ id: it.id, cut: true, type: blob.type, transparent: lo > 0, opaque: hi > 0 });
    }
    return { n: mine.length, out };`);
  check('snap saved items with photo', sn.n >= 2, `n=${sn.n}`);
  check('snapped items keep their cutout, except the one switched to the original photo', sn.out.filter((o) => o.cut).length === sn.n - 1 && sn.out.filter((o) => !o.cut).length === 1, JSON.stringify(sn.out));
  const cuts = sn.out.filter((o) => o.cut);
  check('cutouts are webp/png with real alpha', cuts.length >= 1 && cuts.every((o) => /image\/(webp|png)/.test(o.type) && o.transparent && o.opaque), JSON.stringify(cuts.map((o) => [o.type, o.transparent, o.opaque])));
  check('items count grew', (await D(page, `return m.data.items.length`)) > before);
  await page.screenshot({ path: `${shots}/06-closet-after-snap.png` });

  // ---- closet edit sheet: Background removed on/off, later
  const cutItem = await D(page, `const it = m.data.items.find(i => !i.id.startsWith('demo-') && i.cutoutId); return it ? { id: it.id, name: it.name, cutoutId: it.cutoutId } : null;`);
  check('there is a cut-out item to edit', !!cutItem);
  const openEdit = async (name) => {
    await go(page, 'closet', 500);
    await page.evaluate((n) => { [...document.querySelectorAll('.hang-item')].find((e) => (e.getAttribute('aria-label') || '').startsWith(n)).click(); }, name);
    await page.waitForSelector('dialog.sheet[open] .bg-opt');
  };
  const sheetRadio = (n) => page.locator('dialog.sheet[open]').getByRole('radio', { name: n });
  await openEdit(cutItem.name);
  check('edit sheet shows "Background removed" selected', (await sheetRadio('Background removed').getAttribute('aria-checked')) === 'true');
  await page.screenshot({ path: `${shots}/05c-edit-background.png` });
  await sheetRadio('Original photo').click();
  await page.locator('dialog.sheet').getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(500);
  const off = await D(page, `const it = m.data.items.find(i => i.id === a.id); const store = await import('./src/store.js'); return { cutoutId: it.cutoutId, photo: !!it.photoId, oldBlob: !!(await store.getPhotoBlob(a.cutoutId)) };`, cutItem);
  check('turning the background off clears cutoutId and deletes that photo', off.cutoutId === null && off.photo && off.oldBlob === false, JSON.stringify(off));
  await openEdit(cutItem.name);
  check('edit sheet reopens on "Original photo"', (await sheetRadio('Original photo').getAttribute('aria-checked')) === 'true');
  await sheetRadio('Background removed').click();
  await page.waitForFunction(() => document.querySelector('dialog.sheet[open] .bg-opt[aria-checked="true"]') && /removed/i.test(document.querySelector('dialog.sheet[open] .bg-opt[aria-checked="true"]').textContent), null, { timeout: 15000 }).catch(() => {});
  const onNow = (await sheetRadio('Background removed').getAttribute('aria-checked')) === 'true';
  check('turning it back on recomputes the cutout from the stored photo', onNow);
  await page.locator('dialog.sheet').getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(600);
  const on2 = await D(page, `const it = m.data.items.find(i => i.id === a.id); const store = await import('./src/store.js'); const b = it.cutoutId ? await store.getPhotoBlob(it.cutoutId) : null; return { id: it.cutoutId, type: b && b.type };`, cutItem);
  check('the recomputed cutout is stored', !!on2.id && /image\/(webp|png)/.test(on2.type || ''), JSON.stringify(on2));

  // ---- snap safety net: a plaid close-up that cannot be cut out cleanly defaults to the plain photo
  await go(page, 'snap', 600);
  await page.waitForSelector('.snap-start');
  const plaidUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 700; const g = c.getContext('2d');
    for (let y = 0; y < 700; y += 40) for (let x = 0; x < 800; x += 40) { const k = ((x / 40) % 2) + ((y / 40) % 2); g.fillStyle = k === 0 ? '#bc2026' : k === 1 ? '#701a1e' : '#1a1818'; g.fillRect(x, y, 40, 40); }
    return c.toDataURL('image/png');
  });
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'plaid.png', mimeType: 'image/png', buffer: Buffer.from(plaidUrl.split(',')[1], 'base64') });
  await page.waitForSelector('.stage .bbox', { timeout: 20000 });
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.waitForSelector('.rcard', { timeout: 20000 });
  check('plaid close-up defaults to the original photo (no chewed-up cutout)', await page.locator('.rcard .crop.cut').count() === 0 && (await radio('Original photo').getAttribute('aria-checked')) === 'true');
  check('review explains why there is no cutout', /keeping your photo|kept your photo/i.test(await page.locator('.rcard .cut-note').textContent()), await page.locator('.rcard .cut-note').textContent());
  await page.screenshot({ path: `${shots}/05d-snap-plaid-closeup.png` });
  await page.getByRole('button', { name: 'Skip this one' }).click();
  await page.waitForSelector('.snap-start');

  // ---- profile + selfie
  await go(page, 'profile', 700);
  await page.waitForSelector('.profile');
  check('profile explains privacy', /never leaves this phone/i.test(await page.locator('.colors-intro').textContent()));
  await page.screenshot({ path: `${shots}/07-profile-empty.png`, fullPage: true });
  const selfie = await makeSelfie(page);
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: selfie });
  await page.waitForSelector('.oval-guide');
  await page.waitForTimeout(300);
  // nudge: drag the oval a little, resize via slider
  const ob = await page.locator('.oval-guide').boundingBox();
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2); await page.mouse.down(); await page.mouse.move(ob.x + ob.width / 2 + 2, ob.y + ob.height / 2 + 1, { steps: 3 }); await page.mouse.up();
  await page.screenshot({ path: `${shots}/08-selfie-fit.png` });
  await page.locator('.analyze-btn').click();
  await page.waitForSelector('.selfie-view.has', { timeout: 30000 });
  await page.waitForTimeout(500);
  const pf1 = await D(page, `return m.data.settings.profile`);
  check('selfie + cutout saved into profile', !!pf1 && !!pf1.selfieId && !!pf1.cutoutId, JSON.stringify(pf1));
  check('skin depth detected (medium/light for the synthetic face)', !!pf1 && ['light', 'medium'].includes(pf1.depth) && /^#[0-9a-f]{6}$/.test(pf1.skinHex || ''), `${pf1 && pf1.depth} ${pf1 && pf1.skinHex}`);
  check('honest confidence wording shown', /Lighting can fool cameras/.test(await page.locator('.selfie-card').textContent()));
  await page.screenshot({ path: `${shots}/09-profile-selfie.png`, fullPage: true });

  // drape test
  await page.locator('.drape-start').click();
  await page.waitForSelector('.drape-opt');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/10-drape-round1.png` });
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction((n) => document.querySelector('.drape .page-sub')?.textContent.includes(`Round ${n} of`), i + 1);
    const warm = page.locator('.drape-opt[data-vote="warm"]');
    if (await warm.count()) await warm.first().click(); else await page.locator('.drape-opt[data-name="Black"]').click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('.reveal', { timeout: 5000 });
  const rv = await page.locator('.reveal-title').textContent();
  check('drape reveal says warm-toned', /warm-toned/.test(rv), rv);
  check('reveal shows a palette of swatches', await page.locator('.reveal .swatches li').count() >= 6);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/11-drape-reveal.png` });
  const pf2 = await D(page, `return m.data.settings.profile`);
  check('profile saved: warm undertone from picks, contrast set, enabled', pf2.undertone === 'warm' && ['low', 'medium', 'high'].includes(pf2.contrast) && pf2.enabled === true, JSON.stringify({ u: pf2.undertone, c: pf2.contrast, e: pf2.enabled }));
  // manual override
  await page.locator('.manual-fld[data-key="undertone"] .chip[data-val="cool"]').click();
  await page.waitForTimeout(300);
  check('manual override works', (await D(page, `return m.data.settings.profile.undertone`)) === 'cool');
  await page.locator('.manual-fld[data-key="undertone"] .chip[data-val="warm"]').click();
  await page.waitForTimeout(300);
  // enable toggle
  await page.locator('.toggle-row[data-key="complexion"]').click();
  await page.waitForTimeout(300);
  check('complexion matching can be disabled', (await D(page, `return m.data.settings.profile.enabled`)) === false);
  check('disabled profile is not passed to the engine', (await D(page, `return (await m.getContext()).profile === null`)) === true);
  await page.locator('.toggle-row[data-key="complexion"]').click();
  await page.waitForTimeout(300);
  check('complexion matching can be re-enabled', (await D(page, `return (await m.getContext()).profile !== null`)) === true);

  // ---- complexion changes ranking
  const rank = await page.evaluate(async () => {
    const m = await import('./src/ui/data.js'); const mod = await import('./src/model.js'); const b = await import('./src/engine/build.js');
    const items = m.data.items.filter((i) => i.id.startsWith('demo-'));
    // add two characterful tops so the tone matters
    const extra = [mod.makeItem({ id: 'x-rust', slot: 'top', kind: 'sweater', name: 'Rust sweater', colors: [{ family: 'rust', hex: '#a4502a', weight: 1 }] }),
      mod.makeItem({ id: 'x-burg', slot: 'top', kind: 'sweater', name: 'Burgundy sweater', colors: [{ family: 'burgundy', hex: '#6d1f2f', weight: 1 }] }),
      mod.makeItem({ id: 'x-mustard', slot: 'top', kind: 'sweater', name: 'Mustard sweater', colors: [{ family: 'mustard', hex: '#c99a2e', weight: 1 }] }),
      mod.makeItem({ id: 'x-lav', slot: 'top', kind: 'sweater', name: 'Lavender sweater', colors: [{ family: 'lavender', hex: '#b9a7e0', weight: 1 }] })];
    const all = [...items, ...extra];
    const ctx = await m.getContext();
    const top = (undertone) => b.buildOutfits(all, { ...ctx, occasion: 'any', weather: null, taste: null, profile: mod.makeProfile({ enabled: true, undertone, depth: 'medium', contrast: 'medium' }), limit: 12, today: '2030-01-01' }).map((o) => o.items.top.name);
    return { warm: top('warm'), cool: top('cool') };
  });
  check('warm vs cool profile gives a different top-ranked top', rank.warm[0] !== rank.cool[0] || rank.warm.slice(0, 5).join() !== rank.cool.slice(0, 5).join(), `warm=${rank.warm.slice(0, 3)} cool=${rank.cool.slice(0, 3)}`);
  check('warm profile ranks warm tops ahead of cool ones', rank.warm.findIndex((n) => /Rust|Mustard/.test(n)) < rank.warm.findIndex((n) => /Lavender|Burgundy/.test(n)) || rank.warm.findIndex((n) => /Lavender/.test(n)) === -1, rank.warm.join(' | '));
  await go(page, 'looks', 1400);
  await page.waitForSelector('.look-card');
  check('looks renders boards and entries to Battle and Plan', await page.locator('.look-card').count() >= 4 && await page.locator('a[data-goto="battle"]').count() === 1 && await page.locator('a[data-goto="plan"]').count() === 1);
  check('looks has the occasion picker', await page.locator('.occ-picker, .occ-chip').count() > 0);
  await page.screenshot({ path: `${shots}/12-looks.png` });
  let o = await overflow(page);
  check('no horizontal overflow @390 (looks)', o.sw <= o.cw, JSON.stringify(o));

  // ---- plan
  await page.locator('a[data-goto="plan"]').click();
  await page.waitForSelector('.plan-day');
  check('plan shows seven day cards', await page.locator('.plan-day').count() === 7);
  await page.locator('.plan-all').click();
  await page.waitForSelector('.plan-day.filled', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const pl = await D(page, `const p = m.data.settings.plan || {}; const ks = Object.keys(p).sort();
    return { n: ks.length, tops: ks.map(k => p[k].slots.top), bottoms: ks.map(k => p[k].slots.bottom), filled: ks.filter(k => p[k].slots.top && p[k].slots.bottom).length };`);
  check('plan whole week fills 7 days', pl.n === 7 && pl.filled === 7, JSON.stringify({ n: pl.n, filled: pl.filled }));
  check('no top repeats across the week', new Set(pl.tops).size === 7, pl.tops.join());
  check('bottoms are spread (at least 4 different)', new Set(pl.bottoms).size >= 4, `${new Set(pl.bottoms).size}`);
  await page.screenshot({ path: `${shots}/13-plan-week.png`, fullPage: true });
  o = await overflow(page);
  check('no horizontal overflow @390 (plan)', o.sw <= o.cw, JSON.stringify(o));
  // single day refill + clear
  const firstTop = pl.tops[1];
  await page.locator('.plan-day').nth(1).locator('.plan-fill').click();
  await page.waitForTimeout(700);
  check('per-day re-fill keeps the week valid', (await D(page, `const p = m.data.settings.plan; return new Set(Object.values(p).map(x => x.slots.top)).size`)) === 7);
  await page.locator('.plan-day').nth(2).locator('.plan-clear').click();
  await page.waitForTimeout(500);
  check('per-day clear works', (await D(page, `return Object.keys(m.data.settings.plan).length`)) === 6);
  // stale past days dropped
  await D(page, `await m.setSetting({ plan: { ...m.data.settings.plan, '2000-01-01': { occasion: 'any', slots: {} } } });`);
  await go(page, 'looks', 300); await go(page, 'plan', 800);
  check('past days are dropped', (await D(page, `return !('2000-01-01' in (m.data.settings.plan || {}))`)) === true);
  // planned items count as worn on their day: the tee (1 wear) can only be used once
  check('plan keeps 1-wear items to a single day', (await D(page, `const p = m.data.settings.plan; const ids = Object.values(p).flatMap(x => Object.values(x.slots)); const tee = m.data.items.find(i => i.id==='demo-1'); return ids.filter(i => i==='demo-1').length <= 1`)) === true);

  // ---- settings: taste card
  await go(page, 'settings', 700);
  check('taste card empty before any signal', (await page.locator('#taste-card').getAttribute('data-has-taste')) === 'false');
  await go(page, 'closet', 300);
  await D(page, `
    const get = (id) => m.data.items.find(i => i.id === id);
    for (let i = 0; i < 6; i++) {
      await m.recordEvent({ type: 'battle', winner: { top: get('demo-6'), bottom: get('demo-9'), shoes: get('demo-15') }, loser: { top: get('demo-2'), bottom: get('demo-11'), shoes: get('demo-14') } });
    }
    await m.recordEvent({ type: 'like', items: { top: get('demo-6'), bottom: get('demo-9') } });`);
  await page.waitForTimeout(600);
  await go(page, 'settings', 800);
  check('taste card shows learned likes after 5+ battles', (await page.locator('#taste-card').getAttribute('data-has-taste')) === 'true' && await page.locator('#taste-card .taste-row').count() >= 1, `rows=${await page.locator('#taste-card .taste-row').count()}`);
  await page.locator('#taste-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/14-settings-taste.png`, fullPage: true });
  check('settings has auto-hamper toggle with explanation', await page.locator('.toggle-row[data-key="autoHamper"]').count() === 1 && /hamper/i.test(await page.locator('.toggle-row[data-key="autoHamper"]').textContent()));
  await page.locator('.toggle-row[data-key="useTaste"]').click(); await page.waitForTimeout(300);
  check('use-taste toggle writes setting', (await D(page, `return m.data.settings.useTaste`)) === false);
  check('taste is not passed to the engine when off', (await D(page, `return (await m.getContext()).taste === null`)) === true);
  await page.locator('.toggle-row[data-key="useTaste"]').click(); await page.waitForTimeout(300);
  check('settings links to Your colors', await page.locator('a[data-goto="profile"]').count() === 1);

  // ---- backup round-trip
  const bk = await page.evaluate(async () => {
    const store = await import('./src/store.js'); const m = await import('./src/ui/data.js');
    const p = m.data.settings.profile;
    const a = JSON.parse(await (await store.exportBackup()).text());
    await m.setSetting({ profile: { ...p, includeSelfieInBackup: true } });
    const b = JSON.parse(await (await store.exportBackup()).text());
    await m.setSetting({ profile: { ...p, includeSelfieInBackup: false } });
    return { events: a.events.length, selfieOff: !a.photos[p.selfieId] && !a.photos[p.cutoutId] && !(a.settings.profile && a.settings.profile.selfieId), selfieOn: !!b.photos[p.selfieId] && !!b.photos[p.cutoutId], n: m.data.events.length };
  });
  check('backup includes events', bk.events === bk.n && bk.events >= 7, `${bk.events}`);
  check('backup excludes selfie by default', bk.selfieOff);
  check('backup includes selfie only when opted in', bk.selfieOn);
  // ---- delete selfie
  await go(page, 'profile', 700);
  await page.getByRole('button', { name: /Delete selfie/ }).click();
  await page.locator('dialog.sheet').getByRole('button', { name: 'Delete selfie' }).click();
  await page.waitForTimeout(500);
  const pf3 = await D(page, `return m.data.settings.profile`);
  check('delete selfie clears ids but keeps colors', !pf3.selfieId && !pf3.cutoutId && !!pf3.undertone);

  // ---- no-selfie drape test works with silhouette
  await page.locator('.drape-start').click();
  await page.waitForSelector('.drape-sil');
  check('drape test works without a selfie (silhouette)', await page.locator('.drape-sil').count() === 2);
  await page.locator('.drape-opt[data-vote="cool"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Quit test' }).click();

  const rt = await page.evaluate(async () => {
    const store = await import('./src/store.js'); const m = await import('./src/ui/data.js');
    const text = await (await store.exportBackup()).text();
    const n0 = m.data.events.length, items0 = m.data.items.length;
    await store.importBackup(text, { mode: 'replace' }); await m.reload();
    return { n0, n1: m.data.events.length, items0, items1: m.data.items.length, taste: !!m.data.taste };
  });
  check('restore round-trip keeps events and items', rt.n0 === rt.n1 && rt.items0 === rt.items1, JSON.stringify(rt));
  // reset taste
  await go(page, 'settings', 600);
  await page.getByRole('button', { name: /Reset what I/ }).click();
  await page.locator('dialog.sheet').getByRole('button', { name: 'Forget it' }).click();
  await page.waitForTimeout(500);
  check('taste reset clears events', (await D(page, `return m.data.events.length`)) === 0);

  await ctx.close();

  // ======================= 320 wide + drape + overflow =======================
  ({ ctx, page } = await newCtx(browser, { viewport: { width: 320, height: 640 } }));
  await boot(page);
  await D(page, `await m.setSetting({ profile: mod.makeProfile({ undertone: 'warm', depth: 'medium', contrast: 'medium', enabled: true }) }); await m.logWorn({ items: { top: m.data.items[0], bottom: m.data.items.find(i=>i.slot==='bottom') } });`);
  for (const r of ['closet', 'snap', 'looks', 'plan', 'profile', 'settings']) {
    await go(page, r, 1100);
    o = await overflow(page);
    check(`no horizontal overflow @320 (${r})`, o.sw <= o.cw && o.bw <= o.cw, JSON.stringify(o));
    await page.screenshot({ path: `${shots}/20-${r}-320.png`, fullPage: r !== 'looks' });
  }
  await go(page, 'profile', 600);
  await page.locator('.drape-start').click();
  await page.waitForSelector('.drape-opt');
  await page.waitForTimeout(400);
  o = await overflow(page);
  check('no horizontal overflow @320 (drape test)', o.sw <= o.cw, JSON.stringify(o));
  await page.screenshot({ path: `${shots}/21-drape-320.png` });
  check('drape targets are at least 44px', (await page.locator('.drape-opt').first().boundingBox()).height >= 44);
  await go(page, 'closet', 600);
  await page.screenshot({ path: `${shots}/22-closet-320-top.png` });
  await page.evaluate(async () => { location.hash = '#/today'; });
  await ctx.close();

  // ======================= onboarding (320) =======================
  ({ ctx, page } = await newCtx(browser, { viewport: { width: 320, height: 640 } }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.onboard');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(500);
  check('onboarding has an optional colors step', await page.getByRole('button', { name: 'Find my colors now' }).count() === 1);
  await page.screenshot({ path: `${shots}/23-onboarding-colors-320.png` });
  o = await overflow(page);
  check('no horizontal overflow @320 (onboarding)', o.sw <= o.cw, JSON.stringify(o));
  await page.getByRole('button', { name: 'Find my colors now' }).click();
  await page.waitForSelector('.profile');
  check('onboarding colors step opens Your colors', (await page.evaluate(() => location.hash)) === '#/profile');
  await ctx.close();

  // ======================= dark 390 =======================
  ({ ctx, page } = await newCtx(browser, { scheme: 'dark' }));
  await boot(page);
  await D(page, `
    await m.logWorn({ items: { top: m.data.items.find(i => i.id==='demo-1'), bottom: m.data.items.find(i => i.id==='demo-8') } });
    await m.setSetting({ profile: mod.makeProfile({ undertone: 'cool', depth: 'medium', contrast: 'high', enabled: true }) });
    const get = (id) => m.data.items.find(i => i.id === id);
    for (let i = 0; i < 6; i++) await m.recordEvent({ type: 'battle', winner: { top: get('demo-3'), bottom: get('demo-10') }, loser: { top: get('demo-2'), bottom: get('demo-11') } });`);
  await go(page, 'closet', 900);
  await page.screenshot({ path: `${shots}/30-dark-closet.png` });
  await page.locator('.laundry-btn').click();
  await page.waitForSelector('.wash-overlay');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${shots}/31-dark-laundry.png` });
  await page.waitForSelector('.wash-overlay', { state: 'detached', timeout: 8000 });
  for (const [r, f] of [['looks', 'looks'], ['plan', 'plan'], ['profile', 'profile'], ['settings', 'settings'], ['snap', 'snap']]) {
    await go(page, r, 1200);
    if (r === 'plan') { await page.locator('.plan-all').click(); await page.waitForTimeout(1500); }
    await page.screenshot({ path: `${shots}/32-dark-${f}.png`, fullPage: r !== 'looks' });
  }
  await go(page, 'profile', 500);
  await page.locator('.drape-start').click();
  await page.waitForSelector('.drape-opt'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/33-dark-drape.png` });
  await ctx.close();

  // ======================= reduced motion =======================
  ({ ctx, page } = await newCtx(browser, { reduced: true }));
  await boot(page);
  await go(page, 'closet', 700);
  await page.locator('.laundry-btn').click();
  await page.waitForSelector('.wash-overlay.calm');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/40-laundry-reduced-motion.png` });
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.wash-machine .drum')).animationName);
  check('reduced motion: drum does not spin (simple fade)', anim === 'none', anim);
  await page.waitForSelector('.wash-overlay', { state: 'detached', timeout: 5000 });
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
