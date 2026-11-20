// Debug helper: find where injected nodes come from.
import { chromium, newCtx, makeRunner, open, setItems, col } from './adv-lib.mjs';
const R = makeRunner('probe'); const b = await chromium.launch();
const { page } = await newCtx(b, R);
await open(page);
const P1 = '<img src=x onerror="window.__pwned=1">';
await setItems(page, [{ id: 't', slot: 'top', kind: 't-shirt', name: P1, colors: [col('white')] }, { id: 'b', slot: 'bottom', kind: 'jeans', name: 'ok', colors: [col('navy')] }]);
await page.evaluate(() => { location.hash = '#/spin'; });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => [...document.querySelectorAll('[onerror],[onload],img[src="x"]')].map((e) => e.parentElement.outerHTML.slice(0, 300))));
await page.evaluate(() => { location.hash = '#/closet'; }); await page.waitForTimeout(600);
console.log(await page.evaluate(() => [...document.querySelectorAll('[onerror],[onload],img[src="x"]')].map((e) => e.parentElement.outerHTML.slice(0, 300))));
console.log('pwned', await page.evaluate(() => window.__pwned));
await b.close();
