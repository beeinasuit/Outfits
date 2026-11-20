// Shared helpers for the adversarial browser tests (adv-store.mjs, adv-ui.mjs). Find-and-report only.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire('/opt/node22/lib/node_modules/')('playwright'); }
export const { chromium } = playwright;

export const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:8765/';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const shotDir = path.join(here, 'adv-screenshots');
fs.mkdirSync(shotDir, { recursive: true });

export const PHONE = { width: 390, height: 844 };
export const SMALL = { width: 320, height: 640 };

export function makeRunner(area) {
  const results = [];
  const errors = [];
  const check = (id, name, ok, detail = '', shot = '') => {
    results.push({ id, name, ok: !!ok, detail: String(detail).slice(0, 600), shot });
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '  :: ' + String(detail).slice(0, 300) : ''}`);
    return !!ok;
  };
  const save = () => fs.writeFileSync(path.join(shotDir, `results-${area}.json`), JSON.stringify({ results, errors }, null, 1));
  return { results, errors, check, save };
}

const IGNORED = /fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION|FAILED|ABORTED)|net::/;

/** Fresh isolated context + page with error capture. */
export async function newCtx(browser, runner, { scheme = 'light', viewport = PHONE, reducedMotion = 'no-preference', tag = '', sw = 'allow', mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion, acceptDownloads: true, serviceWorkers: sw });
  const page = await ctx.newPage();
  attach(page, runner, tag);
  return { ctx, page };
}
export function attach(page, runner, tag = '') {
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!IGNORED.test(t)) runner.errors.push(`[${tag}console] ${t}`); } });
  page.on('pageerror', (e) => runner.errors.push(`[${tag}pageerror] ${e.message}`));
  page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.addInitScript(() => { window.addEventListener('unhandledrejection', (e) => console.error('UNHANDLED REJECTION: ' + ((e.reason && (e.reason.message || e.reason.name)) || e.reason))); });
}

/** Open the app, skip onboarding. */
export async function open(page, hash = '', { skipOnboarding = true } = {}) {
  await page.goto(BASE + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 15000 });
  if (skipOnboarding) {
    const sk = page.getByRole('button', { name: 'Skip' });
    if (await sk.count()) await sk.click();
    await page.waitForTimeout(80);
  }
}

/** Replace the whole closet via the app's own data layer (so UI state stays in sync). items are partials for makeItem. */
export async function setItems(page, partials, { feedback = [] } = {}) {
  await page.evaluate(async ({ partials, feedback }) => {
    const store = await import('./src/store.js');
    const { makeItem } = await import('./src/model.js');
    const d = await import('./src/ui/data.js');
    await store.clearAll();
    await store.putSettings({ onboarded: true });
    for (const p of partials) await store.putItem(makeItem(p));
    for (const f of feedback) await store.setFeedback(f.key, f.value, f.meta || {});
    await d.reload();
  }, { partials, feedback });
}

export async function loadDemo(page) {
  await page.evaluate(async () => { const d = await import('./src/ui/data.js'); await d.loadDemo(); });
}

export const col = (family, hex) => ({ family, hex: hex || ({ black: '#1c1c1e', white: '#f5f5f2', navy: '#1f2a44', grey: '#8e9196', denim: '#4a6286', brown: '#6b4a2f', beige: '#d8c3a0', olive: '#5d6136', red: '#d13b3b' }[family] || '#8e9196'), weight: 1 });

/** n deterministic items spread across slots. */
export function bigCloset(n, rnd) {
  const fam = ['black', 'white', 'navy', 'grey', 'denim', 'brown', 'beige', 'olive', 'red'];
  const slots = [['top', 't-shirt', 0.34], ['bottom', 'jeans', 0.24], ['shoes', 'sneakers', 0.14], ['belt', 'leather belt', 0.08], ['layer', 'blazer', 0.1], ['neckwear', 'tie', 0.05], ['headwear', 'beanie', 0.05]];
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rnd(), acc = 0, s = slots[0];
    for (const x of slots) { acc += x[2]; if (r <= acc) { s = x; break; } }
    const f = fam[Math.floor(rnd() * fam.length)];
    out.push({ id: `big-${i}`, slot: s[0], kind: s[1], name: `${f} ${s[1]} ${i}`, colors: [col(f)] });
  }
  // guarantee base
  out.push({ id: 'big-top', slot: 'top', kind: 't-shirt', name: 'Base tee', colors: [col('white')] });
  out.push({ id: 'big-bot', slot: 'bottom', kind: 'jeans', name: 'Base jeans', colors: [col('denim')] });
  return out;
}

export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function waitLanded(page, timeout = 15000) {
  await page.waitForFunction(() => !document.querySelector('.spinning') && document.querySelector('.stamp.show') && document.querySelector('.sticker'), null, { timeout });
}
export async function waitIdle(page, ms = 1700) { await page.waitForTimeout(ms); }

export async function snapshotDb(page) {
  return page.evaluate(async () => {
    const store = await import('./src/store.js');
    const items = (await store.listItems()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const fb = (await store.listFeedback()).map((r) => ({ key: r.key, value: r.value, kind: r.kind })).sort((a, b) => a.key.localeCompare(b.key));
    const settings = await store.getSettings();
    delete settings.lastBackup; delete settings.remindedAt;
    const photos = {};
    for (const it of items) if (it.photoId) { const b = await store.getPhotoBlob(it.photoId); photos[it.photoId] = b ? `${b.type}:${b.size}` : null; }
    return JSON.stringify({ items, fb, settings, photos });
  });
}

export async function shot(page, name, opts = {}) {
  const p = path.join(shotDir, name.endsWith('.png') ? name : name + '.png');
  try { await page.screenshot({ path: p, ...opts }); } catch (e) { console.log('screenshot failed', name, e.message); }
  return 'tests/e2e/adv-screenshots/' + path.basename(p);
}

/** Elements that poke past the viewport's right/left edge, or whose own text is clipped. */
export async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      if (el.closest('.sr-only, .sr-only-input, svg, .confetti-layer, dialog:not([open]), .chips.scroll, .rail, .skip')) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.push({ kind: 'offscreen', sel: sel(el), right: Math.round(r.right), left: Math.round(r.left), text: (el.textContent || '').trim().slice(0, 40) });
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0 && cs.textOverflow !== 'ellipsis')
        out.push({ kind: 'clipped', sel: sel(el), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || '').trim().slice(0, 40) });
    }
    function sel(el) { return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''); }
    return { vw, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, out: out.slice(0, 12) };
  });
}

/** WCAG contrast helpers evaluated in page. */
export async function contrastReport(page, selectors) {
  return page.evaluate((selectors) => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; const root = parse(getComputedStyle(document.documentElement).backgroundColor); if (root && root.a > 0) base = root; for (const c of stack.reverse()) base = blend(c, base); return base; };
    const res = [];
    for (const s of selectors) {
      for (const el of [...document.querySelectorAll(s)].slice(0, 6)) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el); const fg0 = parse(cs.color); if (!fg0) continue;
        const bg = bgOf(el); const fg = blend({ ...fg0, a: fg0.a * parseFloat(cs.opacity || 1) }, bg);
        const l1 = L(fg), l2 = L(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        res.push({ sel: s, text: (el.textContent || '').trim().slice(0, 30), ratio: Math.round(ratio * 100) / 100, size: cs.fontSize, weight: cs.fontWeight, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
      }
    }
    return res;
  }, selectors);
}

export function bytesPng(w = 4, h = 4) { return null; }
