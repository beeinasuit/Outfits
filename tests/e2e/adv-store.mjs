// Adversarial storage / backup / XSS / IndexedDB-unavailable tests. Usage: node tests/e2e/adv-store.mjs [baseURL]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, BASE, shotDir, PHONE, makeRunner, newCtx, attach, open, setItems, loadDemo, col, snapshotDb, shot, waitLanded } from './adv-lib.mjs';

const R = makeRunner('store');
const { check, errors } = R;
const browser = await chromium.launch();
const DL = path.join(shotDir, '_dl'); fs.mkdirSync(DL, { recursive: true });

function isoDaysAgo(n) { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function seedBaseline(page) {
  await page.evaluate(async () => {
    const store = await import('./src/store.js');
    const { makeItem } = await import('./src/model.js');
    const d = await import('./src/ui/data.js');
    await store.clearAll();
    const mk = (w, h2, color) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h2; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h2); g.fillStyle = '#fff'; g.fillRect(2, 2, 5, 5); c.toBlob(res, 'image/png'); });
    await store.putPhoto(await mk(30, 20, '#c33'), 'ph-a');
    await store.putPhoto(await mk(40, 40, '#3a3'), 'ph-b');
    const C = (family, hex) => ({ family, hex, weight: 1 });
    const items = [
      makeItem({ id: 'b-top', slot: 'top', kind: 'oxford', name: 'Baseline oxford', colors: [C('navy', '#1f2a44')], photoId: 'ph-a', worn: ['2026-01-02', '2026-02-03'], formality: 4 }),
      makeItem({ id: 'b-bot', slot: 'bottom', kind: 'chinos', name: 'Baseline chinos', colors: [C('beige', '#d8c3a0'), C('white', '#f5f5f2')], pattern: 'stripe', photoId: 'ph-b' }),
      makeItem({ id: 'b-shoe', slot: 'shoes', kind: 'boots', name: 'Baseline boots', colors: [C('brown', '#6b4a2f')], leather: 'tan', available: false }),
    ];
    for (const it of items) await store.putItem(it);
    await store.setFeedback('b-top|b-bot', 'like', { kind: 'outfit', slots: { top: 'b-top', bottom: 'b-bot' } });
    await store.setFeedback('b-bot|b-top', 'like', { kind: 'pair' });
    await store.putSettings({ onboarded: true, theme: 'dark', occasion: 'work', weather: 'mild', haptics: false });
    await d.reload();
  });
}

const goSettings = async (page) => { await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('.set-card'); };

/** Drive the real restore UI. Returns { phase, msg }. */
async function uiRestore(page, name, buffer, mode = 'replace', mime = 'application/json') {
  await goSettings(page);
  await page.evaluate(() => { document.querySelectorAll('dialog.sheet').forEach((d) => d.remove()); document.documentElement.classList.remove('lock-scroll'); document.getElementById('toasts').replaceChildren(); });
  await page.locator('input[type=file][accept*="json"]').setInputFiles({ name, mimeType: mime, buffer });
  const t0 = Date.now();
  const got = await page.waitForSelector('.toast.warn, dialog.sheet[open]', { timeout: 25000 }).catch(() => null);
  if (!got) return { phase: 'none', msg: '', ms: Date.now() - t0 };
  if ((await got.getAttribute('class')).includes('toast')) return { phase: 'rejected', msg: await got.textContent(), ms: Date.now() - t0 };
  const sheetText = await got.textContent();
  await page.getByRole('button', { name: mode === 'merge' ? 'Merge into my closet' : 'Replace everything' }).click();
  if (mode === 'replace') { await page.getByRole('button', { name: 'Yes, replace' }).click(); }
  await page.waitForSelector('.toast', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(150);
  const toastEl = page.locator('.toast .toast-msg');
  const msg = (await toastEl.count()) ? await toastEl.first().textContent() : '';
  const warn = (await page.locator('.toast.warn').count()) > 0;
  return { phase: warn ? 'failed' : 'accepted', msg, sheetText, ms: Date.now() - t0 };
}

const friendly = (m) => !/TypeError|undefined|null|Cannot read|is not a function|DOMException|\[object|InvalidCharacter|DataError|Failed to execute|Unexpected token|JSON\.parse/.test(m || '');

try {
  // ====================== C1 round trip ======================
  {
    const { ctx, page } = await newCtx(browser, R, { tag: 'c1 ' });
    await open(page);
    await seedBaseline(page);
    const before = await snapshotDb(page);
    // programmatic
    const text = await page.evaluate(async () => { const s = await import('./src/store.js'); return await (await s.exportBackup()).text(); });
    const parsed = JSON.parse(text);
    check('C1a', 'export has app/version/items/feedback/settings/photos', parsed.app === 'fit-machine' && parsed.version === 1 && parsed.items.length === 3 && parsed.feedback.length === 2 && Object.keys(parsed.photos).length === 2 && parsed.settings.theme === 'dark');
    await page.evaluate(async () => { const s = await import('./src/store.js'); await s.clearAll(); });
    const cleared = JSON.parse(await snapshotDb(page));
    check('C1b', 'clearAll empties items/photos/feedback', cleared.items.length === 0 && cleared.fb.length === 0);
    await page.evaluate(async (t) => { const s = await import('./src/store.js'); await s.importBackup(t, { mode: 'replace' }); }, text);
    const after = await snapshotDb(page);
    check('C1c', 'export -> clear -> import(replace) round-trips items, photos, feedback, settings exactly', before === after, before === after ? '' : `before=${before.slice(0, 400)}\nafter=${after.slice(0, 400)}`);
    // photo bytes identical
    const bytesOk = await page.evaluate(async (t) => {
      const s = await import('./src/store.js');
      const p = JSON.parse(t).photos['ph-a'];
      const blob = await s.getPhotoBlob('ph-a'); if (!blob) return 'missing';
      const re = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      return re === p ? 'same' : 'different';
    }, text);
    check('C1d', 'photo bytes survive the round trip', bytesOk === 'same', bytesOk);
    // UI round trip: download -> wipe -> upload
    await goSettings(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download backup/ }).click()]);
    const f = path.join(DL, 'rt.json'); await dl.saveAs(f);
    const uiBefore = await snapshotDb(page);
    await page.evaluate(async () => { const s = await import('./src/store.js'); const d = await import('./src/ui/data.js'); await s.clearAll(); await d.reload(); });
    const r = await uiRestore(page, 'rt.json', fs.readFileSync(f), 'replace');
    const uiAfter = await snapshotDb(page);
    check('C1e', 'UI path: download backup -> wipe -> restore(replace) restores everything', r.phase === 'accepted' && uiBefore === uiAfter, `${r.phase} ${r.msg}`);
    // merge path doesn't duplicate
    const r2 = await uiRestore(page, 'rt.json', fs.readFileSync(f), 'merge');
    const merged = JSON.parse(await snapshotDb(page));
    check('C1f', 'merging the same backup twice does not duplicate items', merged.items.length === 3, `items=${merged.items.length}`);
    // merge doesn't overwrite local settings
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.setSetting({ theme: 'light' }); });
    await uiRestore(page, 'rt.json', fs.readFileSync(f), 'merge');
    const th = await page.evaluate(async () => (await import('./src/ui/data.js')).data.settings.theme);
    check('C1g', 'merge keeps local settings (theme stays light)', th === 'light', th);
    // replace: backup lacks theme setting? backup contains theme; replace sets it back
    // replace then cancel leaves data intact
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); const { makeItem } = await import('./src/model.js'); await d.saveItem(makeItem({ id: 'local-extra', slot: 'top', name: 'Only local' })); });
    const snapLocal = await snapshotDb(page);
    await goSettings(page);
    await page.locator('input[type=file][accept*="json"]').setInputFiles(f);
    await page.waitForSelector('dialog.sheet[open]');
    await page.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(400);
    check('C1h', 'restore: choose Replace then Cancel at the confirm leaves data intact', (await snapshotDb(page)) === snapLocal);
    // sheet Cancel
    await page.locator('input[type=file][accept*="json"]').setInputFiles(f);
    await page.waitForSelector('dialog.sheet[open]');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(300);
    check('C1i', 'restore: Cancel on the first sheet leaves data intact and closes the sheet', (await snapshotDb(page)) === snapLocal && (await page.locator('dialog.sheet[open]').count()) === 0);
    // restore replace clears the lastBackup? (info) and onboarded true
    // Escape closes the sheet
    await page.locator('input[type=file][accept*="json"]').setInputFiles(f);
    await page.waitForSelector('dialog.sheet[open]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check('C1j', 'restore sheet closes on Escape', (await page.locator('dialog.sheet[open]').count()) === 0);
    await ctx.close();
  }

  // ====================== C2 hostile imports ======================
  {
    const { ctx, page } = await newCtx(browser, R, { tag: 'c2 ' });
    await open(page);
    await seedBaseline(page);
    const base = await snapshotDb(page);
    const goodText = await page.evaluate(async () => { const s = await import('./src/store.js'); return await (await s.exportBackup()).text(); });
    const good = JSON.parse(goodText);
    const gi = good.items[0];
    const J = (o) => Buffer.from(JSON.stringify(o));
    const withItems = (items, extra = {}) => ({ ...good, items, ...extra });

    const cases = [
      ['invalid JSON', 'bad1.json', Buffer.from('{not json at all'), 'reject'],
      ['truncated file', 'trunc.json', Buffer.from(goodText.slice(0, Math.floor(goodText.length / 2))), 'reject'],
      ['truncated right before the end', 'trunc2.json', Buffer.from(goodText.slice(0, goodText.length - 2)), 'reject'],
      ['empty file (0 bytes)', 'empty.json', Buffer.alloc(0), 'reject'],
      ['whitespace-only file', 'ws.json', Buffer.from('   \n  '), 'reject'],
      ['JSON null', 'null.json', Buffer.from('null'), 'reject'],
      ['JSON array', 'arr.json', Buffer.from('[1,2,3]'), 'reject'],
      ['JSON string', 'str.json', Buffer.from('"hello"'), 'reject'],
      ['wrong app marker', 'wrongapp.json', J({ ...good, app: 'other-app' }), 'reject'],
      ['missing app marker', 'noapp.json', J({ items: [] }), 'reject'],
      ['future version 2', 'v2.json', J({ ...good, version: 2 }), 'reject'],
      ['version 999', 'v999.json', J({ ...good, version: 999 }), 'reject'],
      ['version as string "1"', 'vstr.json', J({ ...good, version: '1' }), 'reject'],
      ['version 0', 'v0.json', J({ ...good, version: 0 }), 'reject'],
      ['version -1', 'vneg.json', J({ ...good, version: -1 }), 'reject'],
      ['version NaN-ish (null)', 'vnull.json', J({ ...good, version: null }), 'reject'],
      ['items is an object, not array', 'itemsobj.json', J({ ...good, items: {} }), 'reject'],
      ['items missing', 'noitems.json', J({ app: 'fit-machine', version: 1 }), 'reject'],
      ['item is null', 'itemnull.json', J(withItems([null])), 'reject'],
      ['item is a string', 'itemstr.json', J(withItems(['oops'])), 'reject'],
      ['item is an array', 'itemarr.json', J(withItems([[1, 2]])), 'reject'],
      ['item name is a number (TypeError in makeItem?)', 'namenum.json', J(withItems([{ ...gi, id: 'g1', name: 12345 }])), 'sane'],
      ['item name is an object', 'nameobj.json', J(withItems([{ ...gi, id: 'g2', name: { a: 1 } }])), 'sane'],
      ['item id is boolean true (invalid IndexedDB key) in replace', 'idbool.json', J(withItems([{ ...gi, id: true }])), 'sane'],
      ['item id is an object', 'idobj.json', J(withItems([{ ...gi, id: { x: 1 } }])), 'sane'],
      ['item id is a number', 'idnum.json', J(withItems([{ ...gi, id: 7 }])), 'sane'],
      ['item id is NaN-ish string "__proto__"', 'idproto.json', J(withItems([{ ...gi, id: '__proto__' }])), 'sane'],
      ['item with unknown slot only (skipped)', 'slotbad.json', J(withItems([{ ...gi, slot: 'cape' }])), 'sane'],
      ['colors: garbage', 'colors.json', J(withItems([{ ...gi, id: 'g3', colors: 'red' }])), 'sane'],
      ['colors: [null, 5, {family:"nope"}]', 'colors2.json', J(withItems([{ ...gi, id: 'g4', colors: [null, 5, { family: 'nope' }] }])), 'sane'],
      ['colors: hex is a number', 'colors3.json', J(withItems([{ ...gi, id: 'g5', colors: [{ family: 'black', hex: 123, weight: 'x' }] }])), 'sane'],
      ['formality/warmth garbage', 'form.json', J(withItems([{ ...gi, id: 'g6', formality: 'abc', warmth: 1e99, beltLoops: 'yes' }])), 'sane'],
      ['worn: not an array / with junk', 'worn.json', J(withItems([{ ...gi, id: 'g7', worn: 'garbage' }, { ...gi, id: 'g8', worn: [1, null, 'x', '2026-13-45'] }])), 'sane'],
      ['createdAt garbage', 'created.json', J(withItems([{ ...gi, id: 'g9', createdAt: 'yesterday' }])), 'sane'],
      ['photoId points to nothing', 'photoid.json', J(withItems([{ ...gi, id: 'g10', photoId: 'does-not-exist' }])), 'sane'],
      ['photos: not a data URL', 'ph1.json', J({ ...good, photos: { 'ph-a': 'http://evil.example/x.png', 'ph-b': 42 } }), 'sane'],
      ['photos: invalid base64', 'ph2.json', J({ ...good, photos: { 'ph-a': 'data:image/png;base64,@@@@not base64!!!' } }), 'sane'],
      ['photos: data URL with no comma', 'ph3.json', J({ ...good, photos: { 'ph-a': 'data:image/png;base64' } }), 'sane'],
      ['photos: text/html payload as photo', 'ph4.json', J({ ...good, photos: { 'ph-a': 'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD0xPC9zY3JpcHQ+' } }), 'sane'],
      ['photos: array instead of object', 'ph5.json', J({ ...good, photos: ['a', 'b'] }), 'sane'],
      ['photos: __proto__ key', 'ph6.json', Buffer.from(goodText.replace('"photos":{', '"photos":{"__proto__":"data:image/png;base64,AAAA",')), 'sane'],
      ['feedback: garbage records', 'fb.json', J({ ...good, feedback: [null, 5, { key: 5, value: 'like' }, { key: 'a|b', value: 'maybe' }, { key: 'k', value: 'like', slots: 'zzz' }, { key: 'k2', value: 'like', kind: 'outfit', slots: { top: { x: 1 } } }] }), 'sane'],
      ['feedback: not an array', 'fb2.json', J({ ...good, feedback: 'nope' }), 'sane'],
      ['settings: hostile values', 'set.json', J({ ...good, settings: { theme: '<script>', occasion: 'zzz', weather: 'lava', haptics: 'maybe', shake: 'x' } }), 'sane'],
      ['settings: array', 'set2.json', J({ ...good, settings: [1, 2] }), 'sane'],
      ['items: 3000 copies (size)', 'many.json', J(withItems(Array.from({ length: 3000 }, (_, i) => ({ ...gi, id: 'many-' + i, photoId: null })))), 'sane'],
      ['PNG renamed .json', 'photo.json', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), 'reject', 'image/png'],
    ];
    let idx = 0;
    for (const [name, fname, buf, expect, mime] of cases) {
      idx++;
      for (const mode of expect === 'reject' ? ['replace'] : ['replace', 'merge']) {
        await seedBaseline(page);
        const b0 = await snapshotDb(page);
        errors.length; // noop
        const r = await uiRestore(page, fname, buf, mode, mime || 'application/json');
        const b1 = await snapshotDb(page);
        const id = `C2.${String(idx).padStart(2, '0')}${mode === 'merge' ? 'm' : ''}`;
        if (expect === 'reject') {
          const ok = r.phase === 'rejected' && friendly(r.msg) && b0 === b1;
          check(id, `import ${name}: rejected with a clear message, no data change`, ok, `phase=${r.phase} msg="${(r.msg || '').slice(0, 140)}" intact=${b0 === b1}`);
        } else {
          // 'sane': either rejected cleanly with intact data, or accepted with a sane DB. Failure = failed mid-way with changed data, cryptic message, or app broken.
          const dataSame = b0 === b1;
          let ok, detail;
          if (r.phase === 'rejected') { ok = friendly(r.msg) && dataSame; detail = `rejected "${(r.msg || '').slice(0, 120)}" intact=${dataSame}`; }
          else if (r.phase === 'failed') { ok = friendly(r.msg) && (mode === 'merge' || dataSame); detail = `FAILED mid-import msg="${(r.msg || '').slice(0, 120)}" dataIntact=${dataSame} (replace wipes first)`; }
          else {
            const s = JSON.parse(b1);
            const sane = s.items.every((it) => typeof it.name === 'string' && it.colors.length && Number.isFinite(it.formality) && it.worn.every((w) => typeof w === 'string'));
            ok = sane; detail = `accepted: "${(r.msg || '').slice(0, 80)}" items=${s.items.length}`;
          }
          check(id, `import ${name} (${mode}): rejected cleanly or accepted sanely, never half-applied`, ok, detail);
        }
      }
    }

    // after the nastiest accepted imports the app must still work on every screen
    await seedBaseline(page);
    await uiRestore(page, 'set.json', cases.find((c) => c[1] === 'set.json')[2], 'replace');
    await page.evaluate(() => { location.hash = '#/spin'; });
    await page.waitForTimeout(1500);
    for (const rt of ['looks', 'closet', 'snap', 'settings', 'spin']) { await page.evaluate((r) => { location.hash = `#/${r}`; }, rt); await page.waitForTimeout(500); }
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('C2.post1', 'after importing hostile settings (occasion "zzz", weather "lava") every screen still renders', (await page.locator('#screen > *').count()) > 0, `errors=${errors.length}`);
    check('C2.post2', 'hostile theme value from backup does not become an unknown data-theme attribute', themeAttr === null || ['light', 'dark'].includes(themeAttr), String(themeAttr));

    // 20 MB file
    await seedBaseline(page);
    const bigPad = JSON.stringify({ ...good, padding: 'x'.repeat(20 * 1024 * 1024) });
    const rb = await uiRestore(page, 'big.json', Buffer.from(bigPad), 'merge');
    check('C2.big1', '20 MB backup (valid + padding) is handled (clear result, < 20 s, no hang)', rb.phase !== 'none' && rb.ms < 20000, `${rb.phase} ${rb.ms}ms "${(rb.msg || '').slice(0, 100)}"`);
    await seedBaseline(page);
    const b0 = await snapshotDb(page);
    const big2 = Buffer.concat([Buffer.from('{"app":"fit-machine","version":1,"items":[],"junk":"'), Buffer.alloc(20 * 1024 * 1024, 'a'), Buffer.from('')]); // truncated 20 MB
    const rb2 = await uiRestore(page, 'big2.json', big2, 'replace');
    check('C2.big2', '20 MB truncated file rejected, data intact', rb2.phase === 'rejected' && b0 === (await snapshotDb(page)), `${rb2.phase} ${rb2.ms}ms ${(rb2.msg || '').slice(0, 100)}`);
    // item with a 5 MB name
    await seedBaseline(page);
    const rb3 = await uiRestore(page, 'hugename.json', J(withItems([{ ...gi, id: 'huge', name: 'N'.repeat(2_000_000) }])), 'merge');
    await page.evaluate(() => { location.hash = '#/closet'; });
    await page.waitForTimeout(800);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('C2.big3', 'import with a 2,000,000-char item name: app still responsive and name is capped/ellipsized (form caps at 40)', rb3.phase === 'accepted' ? false : rb3.phase !== 'none', `phase=${rb3.phase} (accepted means no length cap on import; form maxlength is 40)`);
    await ctx.close();
  }

  // ====================== C3 XSS ======================
  const P1 = '<img src=x onerror="window.__pwned=1">';
  const P2 = '"><svg onload=window.__pwned=1>';
  const P3 = '"><img src=x onerror=window.__pwned=1>';
  const P4 = "'><script>window.__pwned=1</script>";
  async function sweep(page, label) {
    const bad = async () => page.evaluate(() => ({ pwned: window.__pwned, inj: document.querySelectorAll('body [onerror],body [onload],img[src="x"]').length }));
    const log = [];
    const probe = async (where) => { const b = await bad(); if (b.pwned || b.inj) log.push(`${where}: pwned=${b.pwned} injected=${b.inj}`); };
    // today board: several shuffles, open Change sheets (swap sheet renders itemArt)
    await page.evaluate(() => { location.hash = '#/spin'; }); await page.waitForTimeout(900);
    for (let i = 0; i < 6; i++) {
      await page.waitForFunction(() => !document.querySelector('.t-shuffle:disabled'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      await probe(`board#${i}`);
      for (const sl of ['top', 'bottom', 'shoes']) {
        await page.locator(`.fm-piece[data-slot="${sl}"]`).dispatchEvent('click').catch(() => {});
        await page.locator('.t-bar [data-act="change"]').click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300); await probe(`swap-sheet-${sl}#${i}`);
        await page.locator('.sw-tab[data-tab="pick"]').click({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(150); await probe(`swap-pick-${sl}#${i}`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(120);
      }
      await page.locator('.t-shuffle').click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(1500); await probe('board-final');
    await page.locator('.round-btn.up').click().catch(() => {}); await page.waitForTimeout(200); await probe('liked-toast');
    await page.locator('.t-wear').click().catch(() => {}); await page.waitForTimeout(300); await probe('wear');
    await page.evaluate(() => { location.hash = '#/looks'; }); await page.waitForTimeout(1200); await probe('looks');
    const cards = await page.locator('.look-card').count();
    for (let i = 0; i < Math.min(cards, 4); i++) { await page.locator('.look-card').nth(i).click(); await page.waitForTimeout(250); await probe(`look-detail#${i}`); await page.locator('dialog.sheet .round-btn.up').click().catch(() => {}); await page.waitForTimeout(150); await probe('look-toast'); await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
    await page.evaluate(() => { location.hash = '#/closet'; }); await page.waitForTimeout(800); await probe('closet');
    const n = await page.locator('.hang-item').count();
    for (let i = 0; i < Math.min(n, 8); i++) {
      await page.locator('.hang-item').nth(i).click({ force: true }); await page.waitForTimeout(250); await probe(`edit-sheet#${i}`);
      const del = page.locator('dialog.sheet .btn-danger-ghost');
      if (i % 2 === 0) { await del.click().catch(() => {}); await page.waitForTimeout(250); await probe(`delete-undo-toast#${i}`); await page.locator('.toast-btn').click().catch(() => {}); await page.waitForTimeout(250); }
      else { await page.locator('dialog.sheet .sheet-close').click().catch(() => {}); await page.locator('.wash-btn').nth(i).click({ force: true }).catch(() => {}); await page.waitForTimeout(250); await probe(`wash-toast#${i}`); }
    }
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForTimeout(400); await probe('settings');
    await page.evaluate(() => { location.hash = '#/snap'; }); await page.waitForTimeout(400); await probe('snap');
    // are names rendered literally as text?
    return log;
  }
  async function literalCheck(page, payloads) {
    await page.evaluate(() => { location.hash = '#/closet'; }); await page.waitForTimeout(800);
    const names = await page.locator('.hang-name').allTextContents();
    return payloads.filter((p) => !names.includes(p));
  }

  {
    // --- via form ---
    const { ctx, page } = await newCtx(browser, R, { tag: 'c3form ' });
    await open(page);
    await setItems(page, [{ id: 'f-base-top', slot: 'top', kind: 't-shirt', name: 'Plain tee', colors: [col('white')] }]);
    const addByForm = async (slotLabel, name, kind) => {
      await page.evaluate(() => { location.hash = '#/snap'; }); await page.waitForSelector('.snap-start');
      await page.getByRole('button', { name: /No photo/ }).click();
      await page.waitForSelector('dialog.sheet[open] .itemform');
      await page.locator('dialog.sheet .slot-btn', { hasText: slotLabel }).click();
      if (kind) await page.locator('dialog.sheet .chips .chip', { hasText: new RegExp('^' + kind + '$', 'i') }).first().click().catch(() => {});
      await page.locator('dialog.sheet .swatch[aria-label="Black"]').click();
      await page.locator('dialog.sheet input.text-input').fill(name);
      await page.getByRole('button', { name: 'Add to closet' }).click();
      await page.waitForSelector('.rail-sec');
      await page.waitForTimeout(150);
      const pw = await page.evaluate(() => window.__pwned);
      if (pw) log0.push(`add-toast(${slotLabel})`);
    };
    const log0 = [];
    await addByForm('Top', P1);
    await addByForm('Bottom', P3, 'Joggers');
    await addByForm('Bottom', P2, 'Jeans');
    await addByForm('Shoes', P4);
    await addByForm('Belt', P3);
    await addByForm('Layer', P1);
    await addByForm('Neckwear', P2);
    await addByForm('Hat', P3);
    // worn yesterday so the "You wore your X" reason names them
    await page.evaluate(async (y) => { const d = await import('./src/ui/data.js'); for (const it of [...d.data.items]) await d.saveItem({ ...it, worn: [y] }, { silent: true }); }, isoDaysAgo(1));
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); d.emit('items'); });
    const log = log0.concat(await sweep(page, 'form'));
    const nonLiteral = await literalCheck(page, [P1, P3, P2, P4]);
    await shot(page, 'c3-form-closet');
    check('C3a', 'XSS via the Add-by-color form: window.__pwned never set; no injected [onerror]/[onload] nodes (closet, spin, pick sheet, looks, detail, edit sheet, toasts, undo toast)', log.length === 0, log.slice(0, 6).join(' | '), 'tests/e2e/adv-screenshots/c3-form-closet.png');
    check('C3a2', 'form-entered hostile names appear in the closet literally, as text', nonLiteral.length === 0, `not literal: ${JSON.stringify(nonLiteral)}`);
    // stickers/reasons: any sticker text containing a payload must be text
    await page.evaluate(() => { location.hash = '#/spin'; }); await page.waitForTimeout(1500);
    const stickerNodes = await page.evaluate(() => [...document.querySelectorAll('.t-sticker span:not(.t-sticker-ico)')].map((n) => n.children.length));
    check('C3a3', 'reason stickers contain only text nodes (no element children)', stickerNodes.every((c) => c === 0));
    await ctx.close();
  }

  {
    // --- via import ---
    const { ctx, page } = await newCtx(browser, R, { tag: 'c3imp ' });
    await open(page);
    await setItems(page, [{ id: 'seed', slot: 'top', name: 'seed' }]);
    const y = isoDaysAgo(1);
    const HEXBAD = '#fff"/><img src=x onerror=window.__pwned=1><path fill="';
    const mk = (id, slot, kind, name, extra = {}) => ({ id, slot, kind, name, colors: [{ family: 'black', hex: '#1c1c1e', weight: 1 }], worn: [y], ...extra });
    const items = [
      mk('x1', 'top', 't-shirt', P1), mk('x2', 'top', 'oxford', P2), mk('x3', 'bottom', 'jeans', P3), mk('x4', 'bottom', 'joggers', P4),
      mk('x5', 'shoes', 'sneakers', P1), mk('x6', 'belt', 'leather belt', P2), mk('x7', 'layer', 'blazer', P3), mk('x8', 'neckwear', 'tie', P4), mk('x9', 'headwear', 'beanie', P1),
      { ...mk('x10', 'top', 'polo', 'Hex attack'), colors: [{ family: 'red', hex: HEXBAD, weight: 1 }] },
      { ...mk('x11', 'bottom', 'chinos', 'Hex attack 2'), colors: [{ family: 'navy', hex: '#1f2a44', weight: 0.5 }, { family: 'red', hex: HEXBAD, weight: 0.5 }], pattern: 'stripe' },
      { ...mk('x12', 'shoes', 'boots', 'Leather attack'), leather: P1, material: 'leather', pattern: P2, photoId: P3 },
      { ...mk('x13', 'top', 'henley', 'Worn attack'), worn: [P1, P3, y] },
      { ...mk('x14', 'top', P1, 'Kind attack') },
    ];
    const backup = { app: 'fit-machine', version: 1, exportedAt: P1, items, feedback: [{ key: P1, value: 'like', kind: 'outfit', slots: { top: 'x1', bottom: 'x3' } }, { key: 'x1|x3', value: 'like', kind: 'outfit', slots: { top: 'x1', bottom: 'x3', shoes: 'x5' } }], settings: { theme: P1, occasion: P2, weather: P3 }, photos: { [P1]: 'data:image/png;base64,AAAA' } };
    const r = await uiRestore(page, 'xss.json', Buffer.from(JSON.stringify(backup)), 'replace');
    check('C3b0', 'hostile-but-well-formed backup is imported (or cleanly rejected)', r.phase === 'accepted' || r.phase === 'rejected', `${r.phase} ${r.msg}`);
    const pwnedEarly = await page.evaluate(() => window.__pwned);
    check('C3b1', 'import itself (toast, sheet, settings page) does not execute payloads', !pwnedEarly, String(pwnedEarly));
    const log = await sweep(page, 'import');
    // also the review sheet text: confirm sheet lists counts only
    const nonLiteral = await literalCheck(page, [P1, P2, P3]);
    await shot(page, 'c3-import-closet');
    check('C3b', 'XSS via import (names, color hex, leather, pattern, photoId, worn, kind, feedback keys, settings): __pwned never set, nothing injected', log.length === 0, log.slice(0, 8).join(' | '), 'tests/e2e/adv-screenshots/c3-import-closet.png');
    check('C3b2', 'imported hostile names render literally in the closet', nonLiteral.length === 0, `not literal: ${JSON.stringify(nonLiteral)}`);
    // hex injection specifically: closet svg
    const injected = await page.evaluate(() => document.querySelectorAll('.hang img[src="x"], .art img[src="x"]').length);
    check('C3b3', 'color hex from a backup is validated before being put into SVG markup', injected === 0 && !(await page.evaluate(() => window.__pwned)), `injected imgs=${injected}`);
    await ctx.close();
  }

  // ====================== C4 IndexedDB unavailable ======================
  const variants = [
    ['indexedDB getter throws', () => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('SecurityError: denied'); }, configurable: true }); }],
    ['indexedDB.open throws', () => { const o = window.indexedDB; Object.defineProperty(window, 'indexedDB', { value: { open() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }, configurable: true }); }],
    ['indexedDB.open fires onerror', () => { Object.defineProperty(window, 'indexedDB', { value: { open() { const r = {}; setTimeout(() => r.onerror && r.onerror(), 10); return r; } }, configurable: true }); }],
    ['indexedDB.open never answers (hang)', () => { Object.defineProperty(window, 'indexedDB', { value: { open() { return {}; } }, configurable: true }); }],
  ];
  for (let vi = 0; vi < variants.length; vi++) {
    const [vname, fn] = variants[vi];
    const { ctx, page } = await newCtx(browser, R, { tag: `c4-${vi} `, sw: 'block' });
    await page.addInitScript(fn);
    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: 'load' });
    const ready = await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 }).then(() => true).catch(() => false);
    const bootMs = Date.now() - t0;
    check(`C4.${vi}a`, `IndexedDB unavailable (${vname}): app boots in < 10 s`, ready && bootMs < 10000, `ready=${ready} ${bootMs}ms`);
    if (!ready) { await ctx.close(); continue; }
    const banner = await page.locator('#banner .banner').count();
    check(`C4.${vi}b`, '... shows the "won’t save" warning banner', banner === 1, `banner=${banner}`);
    await page.getByRole('button', { name: 'Try with a sample closet' }).click().catch(() => {});
    await page.waitForSelector('.fm-piece[data-item]', { timeout: 8000 }).catch(() => {});
    await waitLanded(page).catch(() => {});
    const oldN = await page.locator('.fm-piece[data-item]').count();
    await page.locator('.t-shuffle').click().catch(() => {});
    await waitLanded(page).catch(() => {}); await page.waitForTimeout(500);
    const landed = await page.locator('.t-stamp.slam, .t-stamp.shown').count();
    check(`C4.${vi}c`, '... in-memory sample closet + shuffle still works', landed === 1 && oldN >= 3 && (await page.locator('.fm-piece[data-item]').count()) >= 3, `pieces=${oldN}`);
    await shot(page, `c4-${vi}-spin`);
    // add item, backup, restore in memory mode
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('.set-card');
    const warnCard = await page.locator('.set-card.warn', { hasText: 'Not saving' }).count();
    check(`C4.${vi}d`, '... Settings shows the "Not saving" card and "Memory only" storage', warnCard === 1 && (await page.locator('.kv', { hasText: 'Memory only' }).count()) === 1);
    const dlOk = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).then(() => true).catch(() => false), page.getByRole('button', { name: /Download backup/ }).click()]);
    check(`C4.${vi}e`, '... backup download still works from memory', dlOk[0]);
    // clear all + reload loses data (expected), but must not crash
    await page.getByRole('button', { name: 'Clear all data' }).click();
    await page.locator('dialog.sheet input.text-input').fill('DELETE');
    await page.getByRole('button', { name: 'Delete it all' }).click();
    await page.waitForSelector('.toast');
    await page.evaluate(() => { location.hash = '#/closet'; }); await page.waitForTimeout(500);
    check(`C4.${vi}f`, '... clear-all in memory mode works and closet shows empty state', (await page.locator('.empty').count()) === 1);
    await ctx.close();
  }
  {
    // storage quota exceeded on put
    const { ctx, page } = await newCtx(browser, R, { tag: 'c4q ', sw: 'block' });
    await open(page);
    await setItems(page, [{ id: 'q1', slot: 'top', name: 'q top' }, { id: 'q2', slot: 'bottom', name: 'q bottom' }]);
    await page.evaluate(() => { const orig = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { throw new DOMException('quota', 'QuotaExceededError'); }; window.__origPut = orig; });
    await page.evaluate(() => { location.hash = '#/closet'; }); await page.waitForTimeout(500);
    const before = await page.locator('.hang-item').count();
    await page.locator('.wash-btn').first().click({ force: true });
    await page.waitForTimeout(600);
    const after = await page.locator('.hang-item').count();
    check('C4.q1', 'QuotaExceeded on save: user is told (toast) rather than silent failure / unhandled rejection', (await page.locator('.toast').count()) > 0 && !errors.some((e) => /c4q /.test(e)), `toast=${await page.locator('.toast .toast-msg').allTextContents()} errors=${errors.filter((e) => /c4q/.test(e)).join('|').slice(0, 200)}`);
    await ctx.close();
  }
} catch (e) {
  check('RUN', 'adv-store ran without throwing', false, e.stack || String(e));
} finally {
  await browser.close();
}

check('C.errors', 'no console errors / page errors / unhandled rejections during the whole storage run', errors.length === 0, errors.slice(0, 8).join(' | '));
R.save();
const failed = R.results.filter((r) => !r.ok);
console.log(`\n${R.results.length - failed.length}/${R.results.length} checks passed`);
