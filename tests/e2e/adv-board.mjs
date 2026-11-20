// Adversarial checks for the redesigned Today board, swap sheet, glow-up, battle, custom occasions, plan, profile.
// Usage: node tests/e2e/adv-board.mjs [baseURL] [only-id,id,...]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, BASE, shotDir, PHONE, SMALL, makeRunner, newCtx, attach, open, setItems, loadDemo, col, mulberry32, waitLanded, shot, overflowReport, contrastReport, boardSlots, eventCounts } from './adv-lib.mjs';

const ONLY = process.argv[3] || '';
const R = makeRunner('board');
const { check, errors } = R;
const browser = await chromium.launch();
const SH = (n) => 'tests/e2e/adv-screenshots/' + n + '.png';

async function step(id, name, fn) {
  if (ONLY && !ONLY.split(',').includes(id)) return;
  const e0 = errors.length;
  try { await fn(); } catch (e) { check(id, `${name} (scenario threw)`, false, (e.stack || String(e)).split('\n').slice(0, 4).join(' / ')); }
  if (errors.length > e0) console.log(`   ^ ${errors.length - e0} errors during ${id}: ${errors.slice(e0, e0 + 2).join(' | ').slice(0, 300)}`);
}
const hashTo = async (page, r, wait = 500) => { await page.evaluate((x) => { location.hash = `#/${x}`; }, r); await page.waitForTimeout(wait); };
const STAMP = '.t-stamp.slam, .t-stamp.shown';
const demoToday = async (page, hash = '') => { await open(page, hash); await loadDemo(page); await page.waitForSelector('.fm-piece[data-item]', { timeout: 8000 }); await waitLanded(page); await page.waitForTimeout(900); };
const settleShuffle = (page) => page.waitForFunction(() => !document.querySelector('.t-shuffle:disabled') && !document.querySelector('.fm-piece.fm-land') && document.querySelector('.t-stamp.slam, .t-stamp.shown'), null, { timeout: 15000 });
const shuffleOnce = async (page) => { await page.locator('.t-shuffle').click(); await page.waitForTimeout(150); await settleShuffle(page); await page.waitForTimeout(500); };
const annCounter = (page) => page.evaluate(() => { window.__ann = 0; let last = ''; window.__mo && window.__mo.disconnect(); window.__mo = new MutationObserver(() => { const t = document.getElementById('live').textContent; if (t && !last) window.__ann++; last = t; }); window.__mo.observe(document.getElementById('live'), { childList: true, characterData: true, subtree: true }); });
const selectPiece = async (page, slot) => { await page.locator(`.fm-piece[data-slot="${slot}"]`).dispatchEvent('click'); await page.waitForSelector('.t-bar:not([hidden])', { timeout: 3000 }); };
const openChange = async (page, slot) => { await selectPiece(page, slot); await page.locator('.t-bar [data-act="change"]').click(); await page.waitForSelector('dialog.sheet[open] .sw-tab', { timeout: 3000 }); };
const names = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fm-board .fm-piece[data-item]')].map((p) => [p.dataset.slot, p.getAttribute('aria-label')])));
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ccol = (f) => [col(f)];
const FORMAL = [
  { id: 'f-top1', slot: 'top', kind: 'button-down', name: 'White dress shirt', colors: ccol('white'), collared: true },
  { id: 'f-top2', slot: 'top', kind: 'oxford', name: 'Navy oxford', colors: ccol('navy'), collared: true },
  { id: 'f-bot1', slot: 'bottom', kind: 'chinos', name: 'Gray trousers', colors: ccol('gray'), beltLoops: true },
  { id: 'f-bot2', slot: 'bottom', kind: 'chinos', name: 'Navy chinos', colors: ccol('navy'), beltLoops: true },
  { id: 'f-sh1', slot: 'shoes', kind: 'derbies', name: 'Black derbies', colors: ccol('black'), leather: 'black' },
  { id: 'f-sh2', slot: 'shoes', kind: 'boots', name: 'Brown boots', colors: ccol('brown'), leather: 'brown' },
  { id: 'f-belt1', slot: 'belt', kind: 'dress belt', name: 'Black belt', colors: ccol('black'), leather: 'black' },
  { id: 'f-belt2', slot: 'belt', kind: 'leather belt', name: 'Brown belt', colors: ccol('brown'), leather: 'brown' },
  { id: 'f-lay1', slot: 'layer', kind: 'blazer', name: 'Navy blazer', colors: ccol('navy') },
  { id: 'f-lay2', slot: 'layer', kind: 'denim jacket', name: 'Denim jacket', colors: ccol('denim') },
  { id: 'f-tie1', slot: 'neckwear', kind: 'tie', name: 'Burgundy tie', colors: ccol('burgundy') },
  { id: 'f-hat1', slot: 'headwear', kind: 'beanie', name: 'Gray beanie', colors: ccol('gray') },
];
const MINIMAL = [
  { id: 'm-top', slot: 'top', kind: 't-shirt', name: 'Only tee', colors: ccol('white') },
  { id: 'm-bot', slot: 'bottom', kind: 'jeans', name: 'Only jeans', colors: ccol('denim') },
  { id: 'm-sh', slot: 'shoes', kind: 'sneakers', name: 'Only sneakers', colors: ccol('white') },
];
const TWO_TOPS = [
  { id: 't2-a', slot: 'top', kind: 't-shirt', name: 'Tee A', colors: ccol('white') },
  { id: 't2-b', slot: 'top', kind: 't-shirt', name: 'Tee B', colors: ccol('black') },
  { id: 't2-bot', slot: 'bottom', kind: 'jeans', name: 'Jeans', colors: ccol('denim') },
];

try {
  // ============ N1: rapid multi-tap everything (events counted in IndexedDB) ============
  await step('N1', 'rapid multi-tap', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n1 ' });
    await demoToday(page);
    await annCounter(page);
    await page.evaluate(() => { const b = document.querySelector('.t-shuffle'); for (let i = 0; i < 10; i++) b.click(); });
    await page.waitForTimeout(100);
    await settleShuffle(page);
    await page.waitForTimeout(500);
    const ann = await page.evaluate(() => window.__ann);
    const pieces = await page.evaluate(() => [...document.querySelectorAll('.fm-board .fm-piece[data-item]')].map((p) => p.dataset.slot));
    check('N1a', '10 SHUFFLE taps in one task: at most 1 new outfit announced, no duplicate pieces on the board', ann <= 1 && pieces.length === new Set(pieces).size, `announcements=${ann} pieces=${pieces}`);
    // wear x5 in one task: one wear event, one "worn" date per item
    const w0 = await eventCounts(page);
    await page.evaluate(() => { const b = document.querySelector('.t-wear'); for (let i = 0; i < 5; i++) b.click(); });
    await page.waitForTimeout(900);
    const w1 = await eventCounts(page);
    const dates = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return d.data.items.filter((i) => i.worn.length).map((i) => i.worn.length); });
    const wearEvents = (w1.wear || 0) - (w0.wear || 0);
    check('N1b', '5 rapid taps on "Wearing it!" create exactly ONE wear event and one worn date per item', wearEvents === 1 && dates.every((n) => n === 1), `wear events +${wearEvents}, worn lengths ${dates}`);
    // like x4 in one task
    await page.evaluate(() => { const b = document.querySelector('.round-btn.up'); for (let i = 0; i < 4; i++) b.click(); });
    await page.waitForTimeout(700);
    const l1 = await eventCounts(page);
    const likeEvents = (l1.like || 0) - (w1.like || 0);
    const fb = await page.evaluate(async () => { const s = await import('./src/store.js'); return (await s.listFeedback()).length; });
    check('N1c', '4 rapid thumbs-up taps: at most one like event and one feedback record', likeEvents <= 1 && fb <= 1, `like events +${likeEvents}, feedback records ${fb}`);
    // swap double-tap: same row clicked twice in a task
    await openChange(page, 'shoes');
    await annCounter(page);
    const clicked = await page.evaluate(() => { const rows = [...document.querySelectorAll('dialog[open] .sw-row:not(.is-current)')]; if (!rows.length) return 0; rows[0].click(); rows[0].click(); rows[0].click(); return rows.length; });
    await page.waitForTimeout(900);
    const ann2 = await page.evaluate(() => window.__ann);
    check('N1d', 'triple-tap on a Suggest row applies the swap once (one score announcement; 2nd/3rd tap should be ignored)', clicked === 0 || ann2 <= 1, `rows=${clicked} announcements=${ann2}`);
    const popN = await page.locator('.t-delta-pop').count();
    check('N1e', 'only one score-delta pop after a swap', popN <= 1, `pops=${popN}`);
    await ctx.close();
  });

  // ============ N2: select then shuffle; toolbar state ============
  await step('N2', 'select then shuffle', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n2 ' });
    await demoToday(page);
    await selectPiece(page, 'top');
    await page.locator('.t-shuffle').click();
    await page.waitForTimeout(150);
    await settleShuffle(page); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ barHidden: document.querySelector('.t-bar').hidden, selected: document.querySelectorAll('.fm-piece.is-selected').length, pressed: document.querySelectorAll('.fm-piece[aria-pressed="true"]').length }));
    check('N2a', 'select a piece then SHUFFLE: toolbar closes and no piece stays selected', st.barHidden && st.selected === 0 && st.pressed === 0, JSON.stringify(st));
    // select piece, tap empty stage / outside -> deselect
    await selectPiece(page, 'bottom');
    await page.touchscreen.tap(195, 770).catch(() => {});
    await page.waitForTimeout(200);
    const hid = await page.evaluate(() => document.querySelector('.t-bar').hidden);
    check('N2b', 'tapping elsewhere deselects the piece (toolbar hidden)', hid);
    // select, then lock via toolbar, shuffle: locked piece kept
    await selectPiece(page, 'top');
    const topId = (await boardSlots(page)).top;
    await page.locator('.t-bar [data-act="lock"]').click();
    const lockedAria = await page.locator('.t-bar [data-act="lock"]').getAttribute('aria-pressed');
    await page.keyboard.press('Escape');
    let kept = true;
    for (let i = 0; i < 5; i++) { await shuffleOnce(page); if ((await boardSlots(page)).top !== topId) kept = false; }
    check('N2c', 'locked top survives 5 shuffles', lockedAria === 'true' && kept, `aria-pressed=${lockedAria} kept=${kept}`);
    // Remove a required piece is not offered
    await selectPiece(page, 'top');
    const hasRemove = await page.locator('.t-bar [data-act="remove"]').count();
    check('N2d', 'toolbar offers no Remove for the top (required piece)', hasRemove === 0, `remove buttons=${hasRemove}`);
    await ctx.close();
  });

  // ============ N3: swap to item then hamper it; lock then delete; everything in hamper; laundry day ============
  await step('N3', 'swap then hamper / all in hamper / laundry day', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n3 ' });
    await demoToday(page);
    await openChange(page, 'top');
    await page.locator('dialog[open] .sw-tab[data-tab="pick"]').click();
    const pick = page.locator('dialog[open] .sw-tile:not(.is-current):not(.is-wash):not(.sw-none-tile)').first();
    const pickId = await pick.getAttribute('data-item');
    const pickName = (await pick.locator('b').textContent());
    await pick.click(); await page.waitForTimeout(900);
    const now = (await boardSlots(page)).top;
    check('N3a', "I'll pick: choosing a top puts exactly that top on the board", now === pickId, `picked ${pickId} got ${now}`);
    await hashTo(page, 'closet', 700);
    await page.locator(`.wash-btn[aria-label*="${pickName}"]`).first().click({ force: true });
    await page.waitForTimeout(300);
    await hashTo(page, 'today', 1500); await settleShuffle(page).catch(() => {});
    const after = (await boardSlots(page)).top;
    check('N3b', 'swap to an item, send it to the hamper, return to Today: it is no longer on the board', after && after !== pickId, `${pickId} -> ${after}`);
    // everything in the hamper
    await page.evaluate(async () => { const d = await import('./src/ui/data.js'); for (const it of [...d.data.items]) await d.setClean(it, false); });
    await page.waitForTimeout(1000);
    const empty = await page.evaluate(() => ({ h2: document.querySelector('.empty h2')?.textContent, laundry: !!document.querySelector('[data-act="laundry"]'), board: document.querySelectorAll('.fm-piece').length, txt: document.querySelector('#screen').innerText.slice(0, 80) }));
    check('N3c', 'every item in the hamper while on Today: board is replaced by the "in the wash" state with a laundry-day button', empty.laundry && empty.board === 0, JSON.stringify(empty));
    await shot(page, 'n3-all-hamper');
    await page.locator('[data-act="laundry"]').click();
    await page.waitForSelector('.fm-piece[data-item]', { timeout: 8000 }).catch(() => {});
    await settleShuffle(page).catch(() => {});
    const back = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return { avail: d.data.items.filter((i) => i.available).length, all: d.data.items.length, pieces: document.querySelectorAll('.fm-piece[data-item]').length }; });
    check('N3d', 'laundry day while on Today: everything is back, board shows an outfit, no manual reload', back.avail === back.all && back.pieces >= 2, JSON.stringify(back));
    // laundry day (from Closet or data layer) while Today open in another state: call laundryDay() directly while board shown
    const c = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return d.laundryDay(); });
    await page.waitForTimeout(500);
    check('N3e', 'laundryDay() with nothing in the hamper while on Today is a no-op (returns 0, board intact)', c === 0 && (await page.locator('.fm-piece[data-item]').count()) >= 2, `returned ${c}`);
    await ctx.close();
  });

  // ============ N4: items vanish while a shuffle is in flight ============
  await step('N4', 'race: closet emptied during shuffle', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n4 ' });
    await demoToday(page);
    const e0 = errors.length;
    await page.evaluate(async () => {
      document.querySelector('.t-shuffle').click();
      const s = await import('./src/store.js'); const d = await import('./src/ui/data.js');
      await s.clearAll(); await s.putSettings({ onboarded: true }); await d.reload();
    });
    await page.waitForTimeout(2000);
    const mine = errors.slice(e0).filter((x) => /n4 /.test(x));
    check('N4a', 'closet emptied while a SHUFFLE is in flight: no TypeError (board is null after re-render)', mine.length === 0, mine.slice(0, 2).join(' | '), SH('n4-empty'));
    check('N4b', '... and the empty state is shown', (await page.locator('.empty').count()) === 1);
    await shot(page, 'n4-empty');
    await ctx.close();
    // same with everything washed
    const b = await newCtx(browser, R, { tag: 'n4b ' });
    await demoToday(b.page);
    const e1 = errors.length;
    await b.page.evaluate(async () => { document.querySelector('.t-shuffle').click(); const d = await import('./src/ui/data.js'); for (const it of [...d.data.items]) await d.setClean(it, false); });
    await b.page.waitForTimeout(2000);
    const mine2 = errors.slice(e1).filter((x) => /n4b /.test(x));
    check('N4c', 'everything sent to the hamper while a SHUFFLE is in flight: no TypeError', mine2.length === 0, mine2.slice(0, 2).join(' | '));
    await b.ctx.close();
    // glow-up sheet open while the closet is wiped
    const c = await newCtx(browser, R, { tag: 'n4c ' });
    await demoToday(c.page);
    const e2 = errors.length;
    await openChange(c.page, 'top');
    await c.page.evaluate(async () => { const s = await import('./src/store.js'); const d = await import('./src/ui/data.js'); await s.clearAll(); await s.putSettings({ onboarded: true }); await d.reload(); });
    await c.page.waitForTimeout(800);
    await c.page.locator('dialog[open] .sw-row').first().click({ timeout: 1500 }).catch(() => {});
    await c.page.waitForTimeout(600);
    const mine3 = errors.slice(e2).filter((x) => /n4c /.test(x));
    check('N4d', 'swap sheet open, closet wiped underneath, then a row is tapped: no crash', mine3.length === 0, mine3.slice(0, 2).join(' | '));
    await c.ctx.close();
  });

  // ============ N5: stray text ("null") on screens ============
  await step('N5', 'stray text nodes', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n5 ' });
    await open(page);
    await setItems(page, FORMAL);
    const bad = [];
    for (const r of ['today', 'closet', 'looks', 'battle', 'plan', 'profile', 'settings']) {
      await hashTo(page, r, 1100);
      const t = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('#screen'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const v = n.textContent.trim(); if (/^(null|undefined|NaN|\[object Object\])$/.test(v)) out.push(v); } return out.concat((document.querySelector('#screen').innerText.match(/\b(undefined|NaN|\[object Object\])\b/g) || [])); });
      if (t.length) bad.push(`${r}: ${t.join(',')}`);
      if (r === 'today') await shot(page, 'n5-today-null-text');
    }
    check('N5a', 'no literal "null" / "undefined" / "NaN" text on any screen (own closet, no sample)', bad.length === 0, bad.join(' ; '), SH('n5-today-null-text'));
    await ctx.close();
  });

  // ============ N6: glow-up apply twice ============
  await step('N6', 'glow-up', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n6 ' });
    await demoToday(page);
    let found = false;
    for (let i = 0; i < 14 && !found; i++) {
      await page.locator('.t-improve').click(); await page.waitForTimeout(700);
      if (await page.locator('dialog[open] [data-act="apply"]').count()) { found = true; break; }
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      await shuffleOnce(page);
    }
    check('N6a', 'a shuffled outfit with an available glow-up was found within 14 shuffles', found);
    if (found) {
      await annCounter(page);
      const before = await page.locator('.t-meter').getAttribute('aria-valuenow');
      const scores = await page.locator('dialog[open] .gu-scores').getAttribute('aria-label');
      await shot(page, 'n6-glowup');
      await page.evaluate(() => { const b = document.querySelector('dialog[open] [data-act="apply"]'); b.click(); b.click(); b.click(); });
      await page.waitForTimeout(1200);
      const after = await page.locator('.t-meter').getAttribute('aria-valuenow');
      const ann = await page.evaluate(() => window.__ann);
      const m = /to (\d+)/.exec(scores || '');
      check('N6b', 'Apply tapped 3x in one task: applied once (single announcement) and the meter shows the promised score', ann <= 1 && m && Number(after) === Number(m[1]), `before=${before} promised="${scores}" after=${after} announcements=${ann}`);
      const dlg = await page.locator('dialog[open]').count();
      check('N6c', 'glow-up sheet closes after Apply', dlg === 0, `open dialogs=${dlg}`);
      // second Improve straight after: either peak or another improvement but never a crash
      await page.locator('.t-improve').click(); await page.waitForTimeout(700);
      check('N6d', 'Improve again right after Apply opens a sheet (peak or another glow-up)', (await page.locator('dialog[open]').count()) === 1);
      await page.keyboard.press('Escape');
    }
    // peak state
    await setItems(page, MINIMAL);
    await hashTo(page, 'closet', 300); await hashTo(page, 'today', 1500); await settleShuffle(page).catch(() => {});
    await page.locator('.t-improve').click(); await page.waitForTimeout(700);
    const peak = await page.locator('dialog[open] .gu-peak').count();
    check('N6e', 'minimal closet (1 top, 1 bottom, 1 pair of shoes): Improve says "already peak" (no empty sheet, no crash)', peak === 1, `peak=${peak}`);
    await ctx.close();
  });

  // ============ N7: battle with 1-2 items, double vote ============
  await step('N7', 'battle', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n7 ' });
    await open(page);
    await setItems(page, [MINIMAL[0], MINIMAL[1]]);
    await hashTo(page, 'battle', 1200);
    let st = await page.evaluate(() => ({ h2: document.querySelector('#screen h2')?.textContent, cards: document.querySelectorAll('.bt-card').length, empty: !!document.querySelector('.empty') }));
    check('N7a', 'battle with 1 top + 1 bottom: friendly empty state, no cards, no crash', st.empty && st.cards === 0, JSON.stringify(st));
    await shot(page, 'n7-battle-tiny');
    await setItems(page, TWO_TOPS);
    await hashTo(page, 'today', 300); await hashTo(page, 'battle', 1500);
    st = await page.evaluate(() => ({ h2: document.querySelector('#screen h2')?.textContent, cards: document.querySelectorAll('.bt-card').length, empty: !!document.querySelector('.empty') }));
    check('N7b', 'battle with 2 tops + 1 bottom: either two cards or the empty state; never half a screen', (st.cards === 2) !== st.empty, JSON.stringify(st));
    await shot(page, 'n7-battle-2');
    // full closet: double vote
    await setItems(page, FORMAL);
    await hashTo(page, 'today', 300); await hashTo(page, 'battle', 1500);
    const e0 = await eventCounts(page);
    const cards = await page.locator('.bt-card').count();
    check('N7c', 'battle with the full closet renders two cards', cards === 2, `cards=${cards}`);
    await shot(page, 'n7-battle-full');
    await page.evaluate(() => { const a = document.querySelector('.bt-card[data-side="a"]'), b = document.querySelector('.bt-card[data-side="b"]'); a.click(); a.click(); b.click(); a.click(); });
    await page.waitForTimeout(1500);
    const e1 = await eventCounts(page);
    check('N7d', 'rapid A, A, B, A taps record exactly one battle event', (e1.battle || 0) - (e0.battle || 0) === 1, `battle events +${(e1.battle || 0) - (e0.battle || 0)}`);
    const reveal = await page.locator('.bt-card[data-result="win"] .bt-score').count();
    check('N7e', 'after voting, scores are revealed on both cards and a Next battle button appears', reveal === 1 && (await page.locator('.bt-reveal .bt-score').count()) === 2 && (await page.locator('[data-act="next"]').count()) === 1);
    await shot(page, 'n7-battle-voted');
    // Next battle x3 rapid
    await page.evaluate(() => { const b = document.querySelector('[data-act="next"]'); b.click(); b.click(); b.click(); });
    await page.waitForTimeout(1600);
    const nc = await page.locator('.bt-card').count();
    check('N7f', 'Next battle tapped 3x in one task: exactly two cards on screen', nc === 2, `cards=${nc}`);
    // leave mid-reveal then come back; vote on a battle then navigate during the 520ms reveal timer
    await page.evaluate(() => { document.querySelector('.bt-card[data-side="b"]').click(); });
    await hashTo(page, 'closet', 100); await hashTo(page, 'battle', 900);
    check('N7g', 'leaving Battle during the reveal timer and returning is fine', (await page.locator('.bt-card').count()) === 2 || (await page.locator('.empty').count()) === 1);
    await ctx.close();
  });

  // ============ N8: custom occasion labels ============
  await step('N8', 'custom occasion label hostility', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n8 ', viewport: SMALL });
    await demoToday(page);
    const payload = '<img src=x onerror=window.__pwned=1>';
    // via the real UI (maxlength 30 truncates the payload - still must be text)
    await page.locator('.t-occ-pill').click();
    await page.locator('.occ-add').click();
    await page.locator('input[aria-label="Occasion name"]').fill('<img src=x onerror=__pwned=1>');
    await page.locator('input[aria-label="Emoji"]').fill('😀👍🏽🇯🇵x');
    await page.getByRole('button', { name: 'Add occasion' }).click();
    await page.waitForTimeout(900);
    // via the data layer (import-style, no maxlength): full payload + 600 char label + emoji field abuse
    await page.evaluate(async ({ payload }) => {
      const d = await import('./src/ui/data.js'); const m = await import('./src/model.js');
      const c = { ...(d.data.settings.customOccasions || {}) };
      c['xss-full'] = m.makeOccasion({ label: payload, emoji: payload, min: 1, max: 5 });
      c['long'] = m.makeOccasion({ label: 'Z'.repeat(600), emoji: '🧳', min: 2, max: 3 });
      c['long-words'] = m.makeOccasion({ label: 'Extraordinarily long occasion name with many many words in it '.repeat(6), emoji: 'e'.repeat(300), min: 2, max: 3 });
      c['rtl'] = m.makeOccasion({ label: 'مناسبة رسمية جدا', emoji: '🕌', min: 3, max: 5 });
      await d.setSetting({ customOccasions: c });
    }, { payload });
    await page.waitForTimeout(500);
    const probe = async (where) => page.evaluate((where) => ({ where, pwned: window.__pwned, inj: document.querySelectorAll('body [onerror],body [onload],img[src="x"]').length }), where);
    const hits = []; let pillTxt = '';
    const note = async (w) => { const p = await probe(w); if (p.pwned || p.inj) hits.push(`${w}: pwned=${p.pwned} inj=${p.inj}`); };
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await note('today-after-add');
    for (const key of ['xss-full', 'long', 'long-words', 'rtl']) {
      await page.evaluate(async (k) => { const d = await import('./src/ui/data.js'); await d.setSetting({ occasion: k }); }, key);
      await page.waitForTimeout(500);
      await note(`today-pill-${key}`);
      const ov = await overflowReport(page);
      if (ov.sw > ov.vw + 1 || ov.out.some((o) => o.kind === 'offscreen')) hits.push(`overflow@320 on Today with occasion ${key}: sw=${ov.sw} vw=${ov.vw} ${JSON.stringify(ov.out).slice(0, 160)}`);
      if (key === 'xss-full') pillTxt = await page.locator('.t-occ-pill').textContent();
      if (key === 'long') await shot(page, 'n8-today-long-label-320');
    }
    await page.locator('.t-occ-pill').click(); await page.waitForTimeout(400);
    await note('occasion-sheet');
    await shot(page, 'n8-occasion-sheet-320');
    const ovs = await overflowReport(page);
    if (ovs.sw > ovs.vw + 1) hits.push(`occasion sheet overflow sw=${ovs.sw} vw=${ovs.vw}`);
    await page.keyboard.press('Escape');
    // text literalness
    const lit = await page.evaluate((payload) => document.body.innerHTML.includes('&lt;img src=x onerror=window.__pwned=1&gt;') || !!document.querySelector('.occ-chip') , payload);
    // Plan page
    await hashTo(page, 'plan', 1500);
    await note('plan');
    const planTxt = await page.evaluate(() => document.querySelector('#screen').innerText);
    const ovp = await overflowReport(page);
    await shot(page, 'n8-plan-320');
    if (ovp.sw > ovp.vw + 1 || ovp.out.some((o) => o.kind === 'offscreen' && !/occ-/.test(o.sel))) hits.push(`plan overflow@320: sw=${ovp.sw} vw=${ovp.vw} ${JSON.stringify(ovp.out).slice(0, 200)}`);
    check('N8a', 'custom occasion labels (HTML payload, 600 chars, emoji spam, RTL) render as text on Today, the picker and Plan: no script, no injected nodes', hits.filter((x) => !/overflow/.test(x)).length === 0, hits.join(' | '));
    check('N8b', 'long / hostile custom occasion labels do not cause horizontal overflow at 320px (Today pill, picker sheet, Plan)', hits.filter((x) => /overflow/.test(x)).length === 0, hits.filter((x) => /overflow/.test(x)).join(' | '), SH('n8-today-long-label-320'));
    check('N8c', 'the HTML payload label shows literally as text in the Today occasion pill', pillTxt.includes('<img src=x'), pillTxt.slice(0, 80));
    // delete the selected custom occasion via manage sheet -> falls back
    await hashTo(page, 'today', 800);
    await page.locator('.t-occ-pill').click();
    await page.locator('.occ-chip[data-key="long"]').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    await ctx.close();
  });

  // ============ N9: plan then delete a planned item ============
  await step('N9', 'plan', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n9 ' });
    await demoToday(page);
    await hashTo(page, 'plan', 1200);
    await page.locator('.plan-all').click();
    await page.waitForTimeout(3500);
    const planned = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return { days: Object.keys(d.data.settings.plan || {}).length, filled: document.querySelectorAll('.plan-day.filled').length }; });
    check('N9a', 'Plan whole week fills 7 days', planned.days === 7 && planned.filled === 7, JSON.stringify(planned));
    await shot(page, 'n9-plan-week');
    // delete a planned top via the data layer (like Closet delete) while Plan is open
    const victim = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); const p = d.data.settings.plan; const day = Object.keys(p).sort()[2]; const id = p[day].slots.top; await d.removeItem(id); return { day, id }; });
    await page.waitForTimeout(1500);
    const st = await page.evaluate((v) => ({ cards: document.querySelectorAll('.plan-day').length, stale: [...document.querySelectorAll('.plan-day')].filter((c) => /gone/.test(c.innerText)).length, err: document.querySelector('.empty h2')?.textContent }), victim);
    check('N9b', 'deleting a planned top while Plan is open: still 7 day cards, affected day shows a "pieces are gone" prompt, no crash', st.cards === 7 && st.stale >= 1, JSON.stringify(st));
    await shot(page, 'n9-plan-deleted');
    // Re-fill the stale day
    const stale = page.locator('.plan-day', { hasText: 'gone' }).first();
    await stale.locator('.plan-fill').click(); await page.waitForTimeout(900);
    check('N9c', 'Re-fill on the stale day rebuilds an outfit', (await page.locator('.plan-day.filled').count()) === 7, `filled=${await page.locator('.plan-day.filled').count()}`);
    // delete a planned item in Closet UI, come back
    const nm = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); const p = d.data.settings.plan; const day = Object.keys(p).sort()[4]; const it = d.data.items.find((i) => i.id === p[day].slots.bottom); return it && it.name; });
    await hashTo(page, 'closet', 700);
    await page.locator('.hang-item', { hasText: nm }).first().click({ force: true });
    await page.waitForSelector('dialog.sheet[open]');
    await page.locator('dialog.sheet .btn-danger-ghost').click(); await page.waitForTimeout(400);
    await hashTo(page, 'plan', 1500);
    const st2 = await page.evaluate(() => ({ cards: document.querySelectorAll('.plan-day').length, stale: [...document.querySelectorAll('.plan-day')].filter((c) => /gone/.test(c.innerText)).length }));
    check('N9d', 'delete a planned bottom in Closet, return to Plan: stale day flagged, other days intact', st2.cards === 7 && st2.stale >= 1, JSON.stringify(st2));
    // clear week and plan twice quickly
    await page.evaluate(() => { const b = document.querySelector('.plan-all'); b.click(); b.click(); b.click(); });
    await page.waitForTimeout(4500);
    const nplan = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return Object.keys(d.data.settings.plan || {}).length; });
    check('N9e', 'Plan whole week tapped 3x in one task: result is still 7 consistent days', nplan === 7 && (await page.locator('.plan-day').count()) === 7, `plan days=${nplan}`);
    // plan with tiny closet
    await setItems(page, MINIMAL);
    await hashTo(page, 'today', 300); await hashTo(page, 'plan', 1000);
    await page.locator('.plan-all').click(); await page.waitForTimeout(2500);
    const f1 = await page.locator('.plan-day.filled').count();
    check('N9f', 'plan the week with one top and one bottom: at least day 1 planned, remaining days explained (hamper), no crash', f1 >= 1 && (await page.locator('.plan-day').count()) === 7, `filled=${f1}/7 (observation: single tee hits wash limit; other days read "Nothing planned yet")`);
    await ctx.close();
  });

  // ============ N10: profile drape abandoned ============
  await step('N10', 'profile drape abandoned', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n10 ' });
    await demoToday(page);
    await hashTo(page, 'profile', 900);
    await page.locator('.drape-start').click();
    for (let i = 0; i < 3; i++) { await page.locator('.drape-opt').first().click(); await page.waitForTimeout(520); }
    const round = await page.locator('.page-sub').textContent();
    await hashTo(page, 'closet', 400); await hashTo(page, 'profile', 900);
    const prof = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return d.data.settings.profile || null; });
    const onHome = await page.locator('.drape-start').count();
    check('N10a', 'drape test abandoned after 3 rounds (navigate away): profile untouched, returning shows Home not a half test', onHome === 1 && (!prof || (!prof.undertone && !prof.enabled)), `round=${round} profile=${JSON.stringify(prof)}`);
    // Back button mid-drape
    await page.locator('.drape-start').click(); await page.locator('.drape-opt').first().click(); await page.waitForTimeout(520);
    await page.goBack(); await page.waitForTimeout(600);
    const h = await page.evaluate(() => location.hash);
    check('N10b', 'Back during the drape test leaves the Profile screen cleanly (no half-written profile)', !(await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return d.data.settings.profile && d.data.settings.profile.undertone; })), `hash=${h}`);
    // click an option many times quickly (S.locked)
    await hashTo(page, 'profile', 700);
    await page.locator('.drape-start').click();
    await page.evaluate(() => { const o = document.querySelector('.drape-opt'); for (let i = 0; i < 6; i++) o.click(); });
    await page.waitForTimeout(700);
    const rnd = await page.locator('.page-sub').textContent();
    check('N10c', 'six taps on one drape option in a task advance exactly one round', /Round 2 of 6/.test(rnd), rnd);
    // Quit test then restart; complete all rounds; result stored
    await page.getByRole('button', { name: 'Quit test' }).click(); await page.waitForTimeout(300);
    await page.locator('.drape-start').click();
    for (let i = 0; i < 6; i++) { await page.locator('.drape-opt').first().click(); await page.waitForTimeout(520); }
    await page.waitForTimeout(600);
    const done = await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return { p: d.data.settings.profile, reveal: !!document.querySelector('.reveal') }; });
    check('N10d', 'completing the drape test shows the reveal and saves undertone + enables matching', done.reveal && done.p && done.p.undertone && done.p.enabled, JSON.stringify(done));
    // Today still fine with a profile enabled and no selfie
    await hashTo(page, 'today', 1500); await settleShuffle(page).catch(() => {});
    check('N10e', 'Today works with complexion matching on (no selfie)', (await page.locator('.fm-piece[data-item]').count()) >= 2);
    await ctx.close();
  });

  // ============ N11 / N12: selfie edge cases ============
  const mkImage = async (page, { w, h, kind, type = 'image/jpeg' }) => page.evaluate(async ({ w, h, kind, type }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    if (kind === 'blank') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    else if (kind === 'black') { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
    else if (kind === 'noise') { const id = g.createImageData(Math.min(w, 800), Math.min(h, 800)); for (let i = 0; i < id.data.length; i += 4) { id.data[i] = (i * 7) % 255; id.data[i + 1] = (i * 13) % 255; id.data[i + 2] = (i * 29) % 255; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); }
    else { g.fillStyle = '#9fb7d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#c68b64'; g.beginPath(); g.ellipse(w / 2, h * 0.42, w * 0.14, w * 0.18, 0, 0, 7); g.fill(); g.fillStyle = '#4a4f66'; g.fillRect(w * 0.25, h * 0.72, w * 0.5, h * 0.3); }
    const blob = await new Promise((r) => c.toBlob(r, type, 0.8));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, kind, type }).then((b) => Buffer.from(b, 'base64'));
  const selfieFlow = async (page, buffer, name, mime) => {
    await hashTo(page, 'profile', 900);
    const t0 = Date.now();
    await page.locator('input[aria-label="Choose a selfie from your library"]').setInputFiles({ name, mimeType: mime, buffer });
    const view = await page.waitForSelector('.fit-view, .error-note', { timeout: 40000 }).then((e) => e.evaluate((n) => n.className)).catch(() => 'timeout');
    let outcome = view;
    if (/fit-view/.test(view)) {
      await page.locator('.analyze-btn').click();
      await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.selfie-card') || document.querySelector('.fit-view')), null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(800);
      outcome = (await page.locator('.selfie-card').count()) ? 'home' : 'fit';
    }
    return { outcome, ms: Date.now() - t0 };
  };
  await step('N11', 'selfie of a non-face', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n11 ' });
    await demoToday(page);
    for (const kind of ['blank', 'black', 'noise']) {
      const e0 = errors.length;
      const buf = await mkImage(page, { w: 800, h: 1000, kind });
      const r = await selfieFlow(page, buf, `${kind}.jpg`, 'image/jpeg');
      const toast = await page.locator('.toast .toast-msg').allTextContents();
      const mine = errors.slice(e0).filter((x) => /n11 /.test(x));
      check(`N11.${kind}`, `selfie of a ${kind} image: graceful (ends on Profile home with a message, no errors, app usable)`, r.outcome === 'home' && mine.length === 0, `${r.outcome} ${r.ms}ms toast=${toast.join('|').slice(0, 120)} errs=${mine.slice(0, 2).join('|')}`, SH(`n11-${kind}`));
      await shot(page, `n11-${kind}`);
      // does the board survive a cutout of nothing?
      await hashTo(page, 'today', 1500); await settleShuffle(page).catch(() => {});
      const pcs = await page.locator('.fm-piece[data-item]').count();
      const face = await page.locator('.fm-face').count();
      check(`N11.${kind}.board`, `... then Today still shows the whole outfit (pieces=${pcs}, face piece=${face})`, pcs >= 2, `pieces=${pcs} face=${face}`);
      await shot(page, `n11-${kind}-today`);
      await hashTo(page, 'profile', 700);
      const del = page.getByRole('button', { name: /Delete selfie/ });
      if (await del.count()) { await del.click(); await page.locator('dialog .btn-tomato').click(); await page.waitForTimeout(500); }
    }
    // non-image file as selfie
    const r2 = await selfieFlow(page, Buffer.from('not an image at all'), 'x.jpg', 'image/jpeg');
    check('N11.text', 'a text file renamed .jpg as selfie: error note shown, stays on Profile', r2.outcome === 'error-note' || r2.outcome === 'home', r2.outcome);
    await ctx.close();
  });
  await step('N12', 'huge selfie', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n12 ' });
    await demoToday(page);
    const buf = await mkImage(page, { w: 6000, h: 4000, kind: 'face' });
    const e0 = errors.length;
    const r = await selfieFlow(page, buf, 'huge.jpg', 'image/jpeg');
    const mine = errors.slice(e0).filter((x) => /n12 /.test(x));
    check('N12a', `6000x4000 selfie (${Math.round(buf.length / 1024)} KB): analyzed and saved in < 30 s, no errors`, r.outcome === 'home' && r.ms < 30000 && mine.length === 0, `${r.outcome} ${r.ms}ms ${mine.slice(0, 2).join('|')}`);
    await shot(page, 'n12-huge-selfie');
    await hashTo(page, 'today', 1800); await settleShuffle(page).catch(() => {});
    await shot(page, 'n12-today-after-selfie');
    const faceBefore = await page.locator('.fm-face').count();
    check('N12b', 'after saving a selfie (before enabling complexion matching) the board shows the face as the UI copy promises', faceBefore >= 1, `face pieces=${faceBefore} (profile.enabled is false until the drape test / toggle)`, SH('n12-today-after-selfie'));
    await hashTo(page, 'profile', 800);
    await page.locator('[data-key="complexion"]').click().catch(() => {}); await page.waitForTimeout(500);
    await hashTo(page, 'today', 1800); await settleShuffle(page).catch(() => {});
    for (const vp of [PHONE, SMALL]) {
      await page.setViewportSize(vp); await page.waitForTimeout(500); await page.evaluate(() => window.scrollTo(0, 0));
      const g = await page.evaluate(() => { const tab = document.querySelector('.tabbar').getBoundingClientRect(); const out = []; for (const p of document.querySelectorAll('.fm-board .fm-piece')) { const r = p.getBoundingClientRect(); out.push({ slot: p.dataset.slot, top: Math.round(r.top), bottom: Math.round(r.bottom) }); } return { out, tab: Math.round(tab.top), sh: document.querySelector('.t-shuffle').getBoundingClientRect().bottom }; });
      const probs = g.out.filter((p) => p.bottom > g.tab + 1 || p.top < 0);
      const gh = await page.evaluate(() => { const d = document.querySelector('.t-dock').getBoundingClientRect(); return [...document.querySelectorAll('.fm-ghost')].filter((x) => x.getBoundingClientRect().bottom > d.top + 1).map((x) => x.dataset.slot); });
      check(`N12g.${vp.width}`, `face + outfit: the "+ layer / hat / tie" chips are not hidden behind the SHUFFLE dock at ${vp.width}x${vp.height}`, gh.length === 0, `covered chips=${gh}`, SH(`n12-face-${vp.width}`));
      check(`N12c.${vp.width}`, `with face + outfit, every piece (incl. face) is inside the viewport above the tab bar at ${vp.width}x${vp.height}`, g.out.some((p) => p.slot === 'face') && probs.length === 0 && g.sh <= g.tab + 1, JSON.stringify({ probs, tab: g.tab, shuffleBottom: Math.round(g.sh), faces: g.out.filter((p) => p.slot === 'face').length }), SH(`n12-face-${vp.width}`));
      await shot(page, `n12-face-${vp.width}`);
    }
    await ctx.close();
  });

  // ============ N13: Back with each sheet open ============
  await step('N13', 'back with a sheet open', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n13 ' });
    await demoToday(page);
    const opens = {
      'swap sheet': async () => { await openChange(page, 'top'); },
      'glow-up sheet': async () => { await page.locator('.t-improve').click(); await page.waitForSelector('dialog[open]'); },
      'occasion sheet': async () => { await page.locator('.t-occ-pill').click(); await page.waitForSelector('dialog[open]'); },
      'weather sheet': async () => { await page.locator('.t-wx-pill').click(); await page.waitForSelector('dialog[open]'); },
      'custom occasion editor': async () => { await page.locator('.t-occ-pill').click(); await page.locator('.occ-add').click(); await page.waitForSelector('input[aria-label="Occasion name"]'); },
    };
    const bad = [];
    for (const [nm, open_] of Object.entries(opens)) {
      await hashTo(page, 'closet', 300); await hashTo(page, 'today', 900); await settleShuffle(page).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await open_(); await page.waitForTimeout(250);
      await page.goBack(); await page.waitForTimeout(600);
      const st = await page.evaluate(() => ({ dlg: document.querySelectorAll('dialog[open]').length, hash: location.hash, lock: document.documentElement.classList.contains('lock-scroll') }));
      if (st.dlg) bad.push(`${nm}: dialog survives Back on ${st.hash}`);
      if (st.lock && !st.dlg) bad.push(`${nm}: scroll locked with no dialog`);
      await shot(page, `n13-${nm.replace(/\W+/g, '-')}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    check('N13a', 'browser Back with each Today sheet open (swap, glow-up, occasion, weather, custom editor) closes it (no sheet floating over another route)', bad.length === 0, bad.join(' | '), SH('n13-swap-sheet'));
    // after those, can we still use Today
    await hashTo(page, 'today', 800);
    await page.keyboard.press('Escape');
    await shuffleOnce(page);
    check('N13b', 'Today is still usable after the Back-with-sheet gauntlet (sheetOpen flag not stuck)', true);
    await openChange(page, 'top').then(() => true).catch(() => false).then(async (ok) => check('N13c', 'swap sheet can still be opened after Back with a sheet open (sheetOpen flag not stuck)', ok));
    await ctx.close();
  });

  // ============ N14: deep links on cold load ============
  await step('N14', 'deep links', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n14 ' });
    await demoToday(page);
    await page.close();
    const exp = { battle: 'Outfit battle', plan: 'Plan the week', profile: 'Your colors', today: 'Today’s outfit', spin: 'Today’s outfit' };
    for (const r of ['battle', 'plan', 'profile', 'today', 'spin']) {
      const p = await ctx.newPage(); attach(p, R, 'n14 ');
      await p.goto(BASE + `#/${r}`, { waitUntil: 'load' });
      await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
      await p.waitForTimeout(1600);
      const h1 = await p.evaluate(() => document.getElementById('screen-title') && document.getElementById('screen-title').textContent);
      const title = await p.title();
      const content = await p.evaluate(() => ({ cards: document.querySelectorAll('.bt-card, .plan-day, .fm-piece, .set-card').length, onboarding: !!document.querySelector('.onboard') }));
      check(`N14.${r}`, `cold deep link #/${r}: right screen ("${exp[r]}"), document.title matches, content rendered`, h1 === exp[r] && content.cards > 0 && title.startsWith(exp[r === 'spin' ? 'today' : r] === 'Today’s outfit' ? 'Today' : exp[r]), `h1=${h1} title=${title} ${JSON.stringify(content)}`);
      await shot(p, `n14-cold-${r}`);
      await p.close();
    }
    await ctx.close();
    // fresh install (no data, onboarding) deep link
    const f = await newCtx(browser, R, { tag: 'n14f ' });
    await f.page.goto(BASE + '#/battle', { waitUntil: 'load' });
    await f.page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await f.page.waitForTimeout(800);
    const fresh = await f.page.evaluate(() => ({ onboard: !!document.querySelector('.onboard'), h1: document.getElementById('screen-title')?.textContent, empty: !!document.querySelector('.empty') }));
    check('N14f', 'fresh install deep link #/battle: onboarding + friendly "battles need a closet" empty state behind it', fresh.h1 === 'Outfit battle' && fresh.empty, JSON.stringify(fresh));
    await f.ctx.close();
  });

  // ============ N15: offline reload of every route ============
  await step('N15', 'offline', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n15 ', sw: 'allow' });
    await demoToday(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    const exp = { today: 'Today’s outfit', closet: 'Closet', looks: 'Lookbook', snap: 'Add clothes', settings: 'Settings', battle: 'Outfit battle', plan: 'Plan the week', profile: 'Your colors' };
    const bad = [];
    for (const [r, t] of Object.entries(exp)) {
      await page.goto(BASE + `#/${r}`, { waitUntil: 'load' }).catch(() => {});
      await page.reload({ waitUntil: 'load' }).catch((e) => bad.push(`${r}: reload threw ${String(e.message).slice(0, 60)}`));
      const ready = await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(900);
      const h1 = ready ? await page.evaluate(() => document.getElementById('screen-title') && document.getElementById('screen-title').textContent) : null;
      const items = ready ? await page.evaluate(async () => { const d = await import('./src/ui/data.js'); return d.data.items.length; }) : -1;
      if (!ready || h1 !== t || items < 5) bad.push(`${r}: ready=${ready} h1=${h1} items=${items}`);
      if (r === 'today') await shot(page, 'n15-offline-today');
    }
    check('N15a', 'offline reload of every route (today, closet, looks, snap, settings, battle, plan, profile): app boots, right screen, data intact', bad.length === 0, bad.join(' | '));
    await ctx.setOffline(false);
    await ctx.close();
  });

  // ============ N16: screenshots dark/light 390 + 320 of every new screen, overflow ============
  await step('N16', 'screens x themes x widths', async () => {
    const results = [];
    for (const scheme of ['light', 'dark']) {
      for (const [vp, nm] of [[PHONE, '390'], [SMALL, '320']]) {
        const { ctx, page } = await newCtx(browser, R, { tag: `n16${scheme}${nm} `, scheme, viewport: vp });
        await demoToday(page);
        const snap = async (name) => { const o = await overflowReport(page); results.push({ name: `${name}/${scheme}/${nm}`, sw: o.sw, vw: o.vw, off: o.out.filter((x) => x.kind === 'offscreen').length, out: JSON.stringify(o.out).slice(0, 140) }); await shot(page, `n16-${name}-${scheme}-${nm}`); };
        await snap('today');
        await selectPiece(page, 'top'); await page.waitForTimeout(300); await snap('today-toolbar');
        await page.locator('.t-bar [data-act="change"]').click(); await page.waitForSelector('dialog[open] .sw-tab'); await page.waitForTimeout(300); await snap('swap-suggest');
        await page.locator('dialog[open] .sw-tab[data-tab="pick"]').click(); await page.waitForTimeout(250); await snap('swap-pick');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        await page.locator('.t-occ-pill').click(); await page.waitForTimeout(400); await snap('occasion-sheet');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        for (let i = 0; i < 8; i++) { await page.locator('.t-improve').click(); await page.waitForTimeout(600); if (await page.locator('dialog[open] [data-act="apply"]').count()) break; await page.keyboard.press('Escape'); await page.waitForTimeout(250); await shuffleOnce(page); }
        await page.waitForTimeout(500); await snap('glowup');
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        await hashTo(page, 'battle', 1500); await snap('battle');
        await page.locator('.bt-card').first().click().catch(() => {}); await page.waitForTimeout(1400); await snap('battle-voted');
        await hashTo(page, 'plan', 1500); await page.locator('.plan-all').click(); await page.waitForTimeout(3500); await snap('plan');
        await hashTo(page, 'profile', 900); await snap('profile');
        await page.locator('.drape-start').click(); await page.waitForTimeout(500); await snap('drape');
        await ctx.close();
      }
    }
    const bad = results.filter((r) => r.sw > r.vw + 1 || r.off > 0);
    check('N16a', `every new screen x light/dark x 390/320 (${results.length} shots): no horizontal overflow or off-screen elements`, bad.length === 0, bad.slice(0, 6).map((b) => `${b.name} sw=${b.sw} vw=${b.vw} off=${b.off} ${b.out}`).join(' ;; '));
    fs.writeFileSync(path.join(shotDir, 'n16-overflow.json'), JSON.stringify(results, null, 1));
  });

  // ============ N17: whole outfit visible after 10 shuffles, varied closets, both viewports ============
  await step('N17', 'whole outfit visible', async () => {
    const closets = [['demo', null], ['formal(layer+hat+tie+belt)', FORMAL], ['minimal', MINIMAL]];
    const failures = [];
    let total = 0;
    for (const [vp, nm] of [[PHONE, '390x844'], [SMALL, '320x640']]) {
      for (const [cn, items] of closets) {
        const { ctx, page } = await newCtx(browser, R, { tag: `n17 `, viewport: vp });
        if (items) { await open(page); await setItems(page, items); await hashTo(page, 'closet', 200); await hashTo(page, 'today', 900); await waitLanded(page).catch(() => {}); await page.waitForTimeout(600); }
        else await demoToday(page);
        if (cn.startsWith('formal')) {
          // make hat/tie/layer likely: formal occasion + cold
          await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.setSetting({ weather: 'cold' }); });
          await page.waitForTimeout(400);
        }
        const seenSlots = new Set();
        for (let i = 0; i < 10; i++) {
          if (i) await shuffleOnce(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(100);
          const g = await page.evaluate(() => {
            const tab = document.querySelector('.tabbar').getBoundingClientRect();
            const dock = document.querySelector('.t-dock').getBoundingClientRect();
            const vh = innerHeight;
            const out = [];
            for (const p of document.querySelectorAll('.fm-board .fm-piece[data-item]')) {
              const r = p.getBoundingClientRect();
              const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = r.top + r.height / 2;
              const topEl = document.elementFromPoint(cx, Math.min(vh - 1, Math.max(0, cy)));
              const covered = !topEl || !!topEl.closest('.tabbar, .t-dock, .topbar, header, .t-shuffle, dialog');
              out.push({ slot: p.dataset.slot, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), covered, below: r.bottom > tab.top + 1, above: r.top < 0 });
            }
            const ghosts = document.querySelector('.fm-ghosts'); const gr = ghosts && !ghosts.hidden ? ghosts.getBoundingClientRect() : null;
            const ghostBad = [...document.querySelectorAll('.fm-ghost')].filter((gEl) => { const r = gEl.getBoundingClientRect(); const e = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(vh - 1, r.top + r.height / 2)); return r.bottom > dock.top + 1 || !e || !e.closest('.fm-ghost'); }).map((gEl) => gEl.dataset.slot);
            return { out, tabTop: Math.round(tab.top), dockTop: Math.round(dock.top), dockBottom: Math.round(dock.bottom), vh, vw: innerWidth, ghostBottom: gr ? Math.round(gr.bottom) : null, ghostBad, shuffleVisible: (() => { const s = document.querySelector('.t-shuffle').getBoundingClientRect(); return s.top >= 0 && s.bottom <= tab.top + 1; })() };
          });
          total++;
          for (const p of g.out) seenSlots.add(p.slot);
          const probs = g.out.filter((p) => p.covered || p.below || p.above || p.left < -2 || p.right > g.vw + 2);
          const shoes = g.out.find((p) => p.slot === 'shoes');
          const boardBottom = Math.max(...g.out.map((p) => p.bottom));
          if (probs.length || g.ghostBad.length || !g.shuffleVisible || (shoes && shoes.bottom > g.dockTop + 1)) failures.push(`${cn}@${nm}#${i}: ${probs.map((p) => `${p.slot}(${p.covered ? 'covered ' : ''}${p.below ? 'below-tabbar ' : ''}${p.above ? 'above-view ' : ''}b=${p.bottom} tab=${g.tabTop})`).join(',')} ghostChipsCovered=[${g.ghostBad}] shuffleVisible=${g.shuffleVisible} shoesBottom=${shoes && shoes.bottom} dockTop=${g.dockTop}`);
          if (i === 9) await shot(page, `n17-${cn.split('(')[0]}-${nm}`);
        }
        console.log(`   n17 ${cn}@${nm}: slots seen ${[...seenSlots].join(',')}`);
        await ctx.close();
      }
    }
    // dedicated layer + hat + tie outfit: lock them all
    for (const [vp, nm] of [[PHONE, '390x844'], [SMALL, '320x640']]) {
      const { ctx, page } = await newCtx(browser, R, { tag: 'n17b ', viewport: vp });
      await open(page); await setItems(page, FORMAL); await hashTo(page, 'closet', 200); await hashTo(page, 'today', 900); await waitLanded(page).catch(() => {});
      // add hat, tie, layer via ghost chips / swap
      for (const [slot, id] of [['layer', 'f-lay1'], ['headwear', 'f-hat1'], ['neckwear', 'f-tie1']]) {
        if (!(await page.locator(`.fm-piece[data-slot="${slot}"]`).count())) {
          const g = page.locator(`.fm-ghost[data-slot="${slot}"]`);
          if (await g.count()) { await g.click(); await page.waitForSelector('dialog[open] .sw-tab'); await page.locator('dialog[open] .sw-tab[data-tab="pick"]').click(); await page.locator(`dialog[open] .sw-tile[data-item="${id}"]`).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(700); }
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const have = await page.evaluate(() => [...document.querySelectorAll('.fm-board .fm-piece[data-item]')].map((p) => p.dataset.slot));
      const g = await page.evaluate(() => {
        const tab = document.querySelector('.tabbar').getBoundingClientRect(); const out = [];
        for (const p of document.querySelectorAll('.fm-board .fm-piece[data-item]')) { const r = p.getBoundingClientRect(); const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))); out.push({ slot: p.dataset.slot, bottom: Math.round(r.bottom), top: Math.round(r.top), covered: !top || !!top.closest('.tabbar, .t-dock, header') }); }
        return { out, tabTop: Math.round(tab.top) };
      });
      const probs = g.out.filter((p) => p.covered || p.bottom > g.tabTop + 1 || p.top < 0);
      check(`N17.full.${nm}`, `outfit with layer + hat + tie (${have.join(',')}) is entirely visible and uncovered at ${nm}`, have.includes('layer') && have.includes('headwear') && have.includes('neckwear') && probs.length === 0, `have=${have} problems=${JSON.stringify(probs)} tabTop=${g.tabTop}`, SH(`n17-full-${nm}`));
      await shot(page, `n17-full-${nm}`);
      await ctx.close();
    }
    check('N17a', `whole outfit (top to shoes, plus hat/layer/tie when present) in the viewport, above the tab bar and not covered, after 10 shuffles x 3 closets x 2 viewports (${total} samples)`, failures.length === 0, failures.slice(0, 6).join(' ;; '));
  });

  // ============ N18: monkey over every route ============
  await step('N18', 'monkey all routes', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n18 ' });
    const rnd = mulberry32(777);
    const pickR = (a) => a[Math.floor(rnd() * a.length)];
    await demoToday(page);
    const ROUTES = ['today', 'closet', 'snap', 'looks', 'settings', 'battle', 'plan', 'profile'];
    const stuckInfo = []; let actions = 0, stuck = 0; const t0 = Date.now(); const log = []; let e0 = errors.length;
    const targets = () => page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], [role=tab], [role=switch], [role=slider], input:not([type=file]), .fm-piece, .fm-ghost, .bt-card, .plan-day, .drape-opt')) {
        if (el.closest('[hidden], dialog:not([open])') || el.disabled) continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        const x = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2)), y = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
        const top = document.elementFromPoint(x, y); if (!top || !(el.contains(top) || top.contains(el))) continue;
        out.push({ x, y, tag: el.tagName.toLowerCase(), type: el.type || '', text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18) });
      }
      return out;
    });
    while (Date.now() - t0 < 60000) {
      const r = rnd(); let desc = '';
      try {
        if (r < 0.66) {
          const ts = await targets();
          if (ts.length) {
            const t = pickR(ts); desc = `tap ${t.tag} "${t.text}"`;
            if (t.tag === 'input' && ['text', 'search', ''].includes(t.type)) { await page.touchscreen.tap(t.x, t.y); await page.keyboard.type(pickR(['', 'Blue', '😀', '<img src=x onerror=window.__pwned=1>', 'A'.repeat(50)]), { delay: 0 }); }
            else await page.touchscreen.tap(t.x, t.y);
          }
        } else if (r < 0.72) { desc = 'scroll'; await page.mouse.wheel(0, Math.floor(rnd() * 900 - 300)); }
        else if (r < 0.80) { const k = pickR(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowRight', 'ArrowLeft', 'Escape']); desc = `key ${k}`; await page.keyboard.press(k); }
        else if (r < 0.86) { desc = rnd() < 0.5 ? 'back' : 'forward'; await (desc === 'back' ? page.goBack() : page.goForward()).catch(() => {}); if (!page.url().startsWith(BASE)) await page.goForward().catch(() => {}); }
        else if (r < 0.93) { desc = 'hash nav'; await hashTo(page, pickR(ROUTES), 0); }
        else if (r < 0.95) { desc = 'resize'; await page.setViewportSize(rnd() < 0.5 ? SMALL : PHONE); }
        else if (r < 0.97) { desc = 'multi shuffle'; await page.evaluate(() => { const b = document.querySelector('.t-shuffle'); if (b) { b.click(); b.click(); } }); }
        else if (r < 0.985) { desc = 'closet wipe/restore'; await page.evaluate(async (wipe) => { const d = await import('./src/ui/data.js'); if (wipe) { for (const it of [...d.data.items].slice(0, 6)) await d.setClean(it, false); } else await d.laundryDay(); }, rnd() < 0.5); }
        else { desc = 'escape x2'; await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
      } catch (e) { desc += ` (action error: ${String(e.message).split('\n')[0].slice(0, 60)})`; }
      actions++; log.push(desc); if (log.length > 12) log.shift();
      if (errors.length > e0) { console.log(`   n18 error after #${actions}: ${errors[errors.length - 1].slice(0, 180)}\n     last: ${log.join(' > ')}`); e0 = errors.length; }
      if (rnd() < 0.02) { await page.waitForTimeout(450); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(250); if (await page.locator('dialog[open]').count()) { stuck++; stuckInfo.push(await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => (d.getAttribute('aria-label') || '') + '@' + location.hash).join('+')) + ' after: ' + log.slice(-4).join(' > ')); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); } }
      await page.waitForTimeout(20 + Math.floor(rnd() * 90));
    }
    const mine = errors.filter((x) => /n18 /.test(x));
    check('N18a', `60 s seeded monkey across all 8 routes (${actions} actions): zero console errors / page errors / unhandled rejections`, mine.length === 0, mine.slice(0, 4).join(' | '));
    check('N18b', 'monkey: no modal survived Escape x2; no XSS', stuck === 0 && !(await page.evaluate(() => window.__pwned)), `stuck=${stuck} ${stuckInfo.join(' ;; ')}`);
    await ctx.close();
  });

  // ============ N19: contrast on new screens, both themes ============
  await step('N19', 'contrast', async () => {
    const SEL = ['.t-pill-txt', '.t-meter-label', '.t-num', '.t-stamp', '.t-sticker span:not(.t-sticker-ico)', '.t-hint', '.hint', '.t-why-title', '.t-bar-name', '.t-bar-btn', '.btn', '.t-shuffle', '.chip', '.tab span', '.page-title', '.page-sub', '.empty h2', '.empty p'];
    const all = [];
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await newCtx(browser, R, { tag: `n19${scheme} `, scheme });
      await demoToday(page);
      const add = (screen, rs) => rs.forEach((x) => all.push({ screen: `${screen}/${scheme}`, ...x }));
      add('today', await contrastReport(page, SEL));
      await selectPiece(page, 'top'); await page.waitForTimeout(250);
      add('today-toolbar', await contrastReport(page, ['.t-bar-name', '.t-bar-btn']));
      await page.locator('.t-bar [data-act="change"]').click(); await page.waitForSelector('dialog[open] .sw-tab'); await page.waitForTimeout(300);
      add('swap-suggest', await contrastReport(page, ['dialog .sheet-title', 'dialog .sw-tab', 'dialog .sw-intro', 'dialog .sw-text b', 'dialog .sw-text small', 'dialog .sw-num', 'dialog .sw-delta', 'dialog .sw-tag']));
      await page.locator('dialog[open] .sw-tab[data-tab="pick"]').click(); await page.waitForTimeout(250);
      add('swap-pick', await contrastReport(page, ['dialog .sw-tile b', 'dialog .sw-tile small', 'dialog .sw-tab']));
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      for (let i = 0; i < 8; i++) { await page.locator('.t-improve').click(); await page.waitForTimeout(600); if (await page.locator('dialog[open] [data-act="apply"]').count()) break; await page.keyboard.press('Escape'); await page.waitForTimeout(250); await shuffleOnce(page); }
      add('glowup', await contrastReport(page, ['dialog .gu-headline', 'dialog .gu-scores', 'dialog .gu-notes li', 'dialog .gu-tag', 'dialog .btn', 'dialog .gu-peak h3', 'dialog .gu-peak p']));
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      await hashTo(page, 'battle', 1500);
      add('battle', await contrastReport(page, ['.bt-count', '.bt-title h2', '.bt-hint', '.hint', '.bt-label', '.bt-vs', '.btn']));
      await page.locator('.bt-card').first().click().catch(() => {}); await page.waitForTimeout(1500);
      add('battle-voted', await contrastReport(page, ['.bt-stamp', '.bt-score', '.bt-verdict', '.bt-why li', '.bt-note', '.btn']));
      await hashTo(page, 'plan', 1500); await page.locator('.plan-all').click(); await page.waitForTimeout(3500);
      add('plan', await contrastReport(page, ['.plan-name', '.plan-date', '.plan-score', '.plan-names', '.plan-empty', '.hint', '.btn', '.chip']));
      await hashTo(page, 'profile', 900);
      add('profile', await contrastReport(page, ['.set-card h2', '.set-card p', '.hint', '.chip', '.btn', '.toggle-text b', '.toggle-text small', '.privacy', 'legend', '.page-title']));
      await page.locator('.drape-start').click(); await page.waitForTimeout(500);
      add('drape', await contrastReport(page, ['.drape-q', '.drape-name', '.hint', '.btn', '.page-sub']));
      await ctx.close();
    }
    const bad = all.filter((x) => { const large = parseFloat(x.size) >= 24 || (parseFloat(x.size) >= 18.66 && Number(x.weight) >= 700); return x.ratio < (large ? 3 : 4.5); });
    const uniq = []; const seen = new Set(); for (const b of bad) { const k = `${b.screen}|${b.sel}|${b.fg}|${b.bg}`; if (!seen.has(k)) { seen.add(k); uniq.push(b); } }
    fs.writeFileSync(path.join(shotDir, 'contrast-board.json'), JSON.stringify({ samples: all.length, lowest: all.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 25), failures: uniq }, null, 1));
    for (const scheme of ['light', 'dark']) {
      const u = uniq.filter((b) => b.screen.endsWith(scheme));
      check(`N19.${scheme}`, `${scheme}: text contrast >= 4.5:1 (3:1 large) on Today, swap, glow-up, battle, plan, profile, drape (${all.filter((a) => a.screen.endsWith(scheme)).length} samples)`, u.length === 0, u.slice(0, 8).map((b) => `${b.screen} ${b.sel} "${b.text}" ${b.ratio} (${b.fg} on ${b.bg}, ${b.size})`).join(' ;; '));
    }
  });

  // ============ N20: accessible names + 44px targets ============
  await step('N20', 'a11y names and target size', async () => {
    const { ctx, page } = await newCtx(browser, R, { tag: 'n20 ' });
    await demoToday(page);
    const audit = () => page.evaluate(() => {
      const nameOf = (el) => {
        const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
        const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if (t) return t; }
        if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l && l.textContent.trim()) return l.textContent.trim(); }
        const wl = el.closest('label'); if (wl && wl.textContent.trim()) return wl.textContent.trim();
        const t = (el.textContent || '').trim(); if (t) return t;
        return el.getAttribute('title') || '';
      };
      const noName = [], small = [];
      for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, [role=button], [role=tab], [role=switch], [role=slider], [role=radio], [role=meter]')) {
        if (el.closest('[hidden], [aria-hidden="true"], dialog:not([open]), .sr-only, .skip')) continue;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const tag = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)}[${nameOf(el).slice(0, 22)}]`;
        if (!nameOf(el)) noName.push(tag);
        if (el.matches('[role=meter]')) continue;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${tag} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { noName, small };
    });
    const res = {};
    const run = async (label) => { res[label] = await audit(); };
    await run('today');
    await selectPiece(page, 'top'); await run('today-toolbar');
    await page.locator('.t-bar [data-act="change"]').click(); await page.waitForSelector('dialog[open] .sw-tab'); await page.waitForTimeout(250); await run('swap-suggest');
    await page.locator('dialog[open] .sw-tab[data-tab="pick"]').click(); await page.waitForTimeout(200); await run('swap-pick');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.locator('.t-occ-pill').click(); await page.waitForTimeout(350); await run('occasion-sheet');
    await page.locator('.occ-add').click(); await page.waitForTimeout(350); await run('occasion-editor');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250); const left = await page.locator('dialog[open]').count(); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    console.log(`   n20: dialogs left after one Escape from the editor: ${left}`);
    for (let i = 0; i < 8; i++) { await page.locator('.t-improve').click(); await page.waitForTimeout(600); if (await page.locator('dialog[open] [data-act="apply"]').count()) break; await page.keyboard.press('Escape'); await page.waitForTimeout(250); await shuffleOnce(page); }
    await run('glowup'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await hashTo(page, 'battle', 1500); await run('battle');
    await hashTo(page, 'plan', 1500); await page.locator('.plan-all').click(); await page.waitForTimeout(3500); await run('plan');
    await hashTo(page, 'profile', 900); await run('profile');
    await page.locator('.drape-start').click(); await page.waitForTimeout(400); await run('drape');
    const noName = Object.entries(res).flatMap(([k, v]) => v.noName.map((n) => `${k}: ${n}`));
    const small = Object.entries(res).flatMap(([k, v]) => v.small.map((n) => `${k}: ${n}`));
    const uniqSmall = [...new Set(small)];
    check('N20a', 'every interactive element on the new screens has an accessible name', noName.length === 0, noName.slice(0, 8).join(' | '));
    check('N20b', 'every interactive element on the new screens is >= 44x44 px', uniqSmall.length === 0, `${uniqSmall.length} undersized: ` + uniqSmall.slice(0, 12).join(' | '));
    fs.writeFileSync(path.join(shotDir, 'n20-targets.json'), JSON.stringify({ noName, small: uniqSmall }, null, 1));
    await ctx.close();
  });
} catch (e) {
  check('RUN', 'adv-board ran without throwing', false, e.stack || String(e));
} finally {
  await browser.close();
}

check('N.errors', 'zero console errors / page errors / unhandled rejections across the whole board run', errors.length === 0, errors.slice(0, 8).join(' | '));
R.save();
const failed = R.results.filter((r) => !r.ok);
console.log(`\n${R.results.length - failed.length}/${R.results.length} checks passed`);
if (failed.length) console.log('Failed:\n' + failed.map((f) => `  [${f.id}] ${f.name} :: ${f.detail.slice(0, 200)}`).join('\n'));
