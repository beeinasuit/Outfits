// App data layer: in-memory mirror of the store + change notifications + shared context (occasion/weather).
import * as store from '../store.js';
import { makeItem, COLOR_FAMILIES, todayISO } from '../model.js';
import { prefs } from './fx.js';

export const data = { items: [], feedback: {}, records: [], settings: {}, ready: false };
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what = 'items') { for (const fn of [...listeners]) { try { fn(what); } catch (e) { console.error(e); } } }

export async function load() {
  await store.init();
  const [items, feedback, records, settings] = await Promise.all([store.listItems(), store.getFeedback(), store.listFeedback(), store.getSettings()]);
  data.items = items; data.feedback = feedback; data.records = records; data.settings = settings; data.ready = true;
  prefs.haptics = settings.haptics !== false;
  applyTheme();
}

export function applyTheme() {
  const t = data.settings.theme;
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (meta) meta.setAttribute('content', dark ? '#17141f' : '#f7f0e1');
}

export async function setSetting(partial) {
  Object.assign(data.settings, partial);
  if ('haptics' in partial) prefs.haptics = partial.haptics !== false;
  if ('theme' in partial) applyTheme();
  try { await store.putSettings(partial); } catch (e) { console.warn(e); }
  emit('settings');
}

export async function saveItem(item, { silent = false } = {}) {
  const it = makeItem(item);
  await store.putItem(it);
  const i = data.items.findIndex((x) => x.id === it.id);
  if (i >= 0) data.items[i] = it; else data.items.push(it);
  if (!silent) emit('items');
  return it;
}

export async function removeItem(id) {
  const it = data.items.find((x) => x.id === id);
  if (!it) return null;
  const blob = it.photoId ? await store.getPhotoBlob(it.photoId) : null;
  await store.deleteItem(id);
  data.items = data.items.filter((x) => x.id !== id);
  emit('items');
  // returns an undo function
  return async () => {
    if (it.photoId && blob) await store.putPhoto(blob, it.photoId);
    await saveItem(it);
  };
}

export async function reload() {
  const [items, feedback, records, settings] = await Promise.all([store.listItems(), store.getFeedback(), store.listFeedback(), store.getSettings()]);
  data.items = items; data.feedback = feedback; data.records = records; data.settings = settings;
  prefs.haptics = settings.haptics !== false;
  applyTheme();
  emit('items');
}

export const isDemo = (it) => typeof it.id === 'string' && it.id.startsWith('demo-');
export const demoCount = () => data.items.filter(isDemo).length;
export const realCount = () => data.items.filter((i) => !isDemo(i)).length;

export async function removeDemo() {
  const ids = data.items.filter(isDemo).map((i) => i.id);
  for (const id of ids) await store.deleteItem(id);
  data.items = data.items.filter((i) => !isDemo(i));
  emit('items');
  return ids.length;
}

export async function setFeedback(outfit, value) {
  const slots = {};
  for (const [s, it] of Object.entries(outfit.items)) if (it) slots[s] = it.id;
  await store.setFeedback(outfit.key, value, { kind: 'outfit', slots });
  const pair = pairKey(outfit);
  if (pair) await store.setFeedback(pair, value, { kind: 'pair' });
  const [feedback, records] = await Promise.all([store.getFeedback(), store.listFeedback()]);
  data.feedback = feedback; data.records = records;
  emit('feedback');
}
export function pairKey(outfit) {
  const t = outfit.items.top, b = outfit.items.bottom;
  return t && b ? [t.id, b.id].sort().join('|') : null;
}
export function feedbackSets() {
  const liked = new Set(), disliked = new Set();
  for (const [k, v] of Object.entries(data.feedback)) (v === 'like' ? liked : disliked).add(k);
  return { liked, disliked };
}

export async function logWorn(outfit) {
  const today = todayISO();
  for (const it of Object.values(outfit.items)) {
    if (!it) continue;
    const cur = data.items.find((x) => x.id === it.id) || it;
    if (cur.worn.includes(today)) continue;
    await saveItem({ ...cur, worn: [...cur.worn, today] }, { silent: true });
  }
  emit('worn');
}
export const wornToday = (outfit) => Object.values(outfit.items).filter(Boolean).every((it) => (data.items.find((x) => x.id === it.id) || it).worn.includes(todayISO()));

// ---------- weather ----------
export function tempToBucket(c) {
  if (c >= 28) return 'hot';
  if (c >= 20) return 'warm';
  if (c >= 12) return 'mild';
  if (c >= 3) return 'cold';
  return 'freezing';
}
let autoWeather = null; // { bucket, temp, rain, at }
export async function fetchAutoWeather(force = false) {
  if (autoWeather && !force && Date.now() - autoWeather.at < 3600e3) return autoWeather;
  const pos = await new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 1800e3 });
  });
  const { latitude, longitude } = pos.coords;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&current=temperature_2m,precipitation`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('Weather service said ' + r.status);
    const j = await r.json();
    const temp = j.current.temperature_2m;
    autoWeather = { bucket: tempToBucket(temp), temp, rain: (j.current.precipitation || 0) > 0, at: Date.now() };
    return autoWeather;
  } finally { clearTimeout(t); }
}

/** Resolve the current context for the engine. Never throws; falls back to "no weather". */
export async function getContext() {
  const s = data.settings;
  let weather = null, rain = false, note = '';
  if (s.weather === 'auto') {
    try { const w = await fetchAutoWeather(); weather = w.bucket; rain = w.rain; note = `${Math.round(w.temp)}°C${w.rain ? ', rain' : ''}`; }
    catch { note = 'Couldn’t get the weather: pick one by hand'; }
  } else if (s.weather && s.weather !== 'none') weather = s.weather;
  return { occasion: s.occasion || 'any', weather, rain, feedback: feedbackSets(), note };
}

// ---------- demo closet ----------
const C = (family, weight = 1) => ({ hex: COLOR_FAMILIES[family].hex, family, weight });
export function demoItems() {
  const d = [
    ['top', 't-shirt', 'White tee', [C('white')]],
    ['top', 't-shirt', 'Heather grey tee', [C('grey')]],
    ['top', 'oxford', 'Navy oxford', [C('navy')]],
    ['top', 'button-down', 'Crisp white shirt', [C('white')]],
    ['top', 'button-down', 'Blue stripe shirt', [C('light-blue', 0.6), C('white', 0.4)], { pattern: 'stripe' }],
    ['top', 'henley', 'Olive henley', [C('olive')]],
    ['top', 'sweater', 'Grey crew sweater', [C('grey')]],
    ['bottom', 'jeans', 'Dark denim jeans', [C('denim')]],
    ['bottom', 'chinos', 'Khaki chinos', [C('beige')]],
    ['bottom', 'chinos', 'Navy chinos', [C('navy')]],
    ['bottom', 'joggers', 'Black joggers', [C('black')]],
    ['belt', 'leather belt', 'Brown leather belt', [C('brown')], { leather: 'brown' }],
    ['belt', 'dress belt', 'Black leather belt', [C('black')], { leather: 'black' }],
    ['shoes', 'sneakers', 'White sneakers', [C('white')]],
    ['shoes', 'boots', 'Brown boots', [C('brown')], { leather: 'brown' }],
    ['shoes', 'derbies', 'Black derbies', [C('black')], { leather: 'black' }],
    ['layer', 'blazer', 'Navy blazer', [C('navy')]],
    ['layer', 'denim jacket', 'Denim jacket', [C('denim')], { material: 'denim' }],
    ['neckwear', 'tie', 'Burgundy tie', [C('burgundy')]],
    ['headwear', 'beanie', 'Grey beanie', [C('grey')]],
  ];
  return d.map(([slot, kind, name, colors, extra], i) => makeItem({ id: `demo-${i + 1}`, slot, kind, name, colors, ...extra, createdAt: Date.now() + i }));
}
export async function loadDemo() {
  for (const it of demoItems()) await saveItem(it, { silent: true });
  emit('items');
}
