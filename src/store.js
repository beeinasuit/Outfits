// Persistence: IndexedDB (items, photos, feedback, settings) with an in-memory fallback.
// Everything is wrapped in try/catch; if IndexedDB is unavailable (private mode) the app keeps working
// for the session and shows a warning banner (see `storageInfo()`).
import { makeItem, makeCheck, newId, todayISO, SLOTS } from './model.js';

const DB_NAME = 'fit-machine';
const DB_VERSION = 3;
const KEYS = { items: 'id', photos: 'id', feedback: 'key', settings: 'k', events: 'id', checks: 'id' };
export const MAX_EVENTS = 5000;
const DEFAULT_SETTINGS = { onboarded: false, autoHamper: true, useTaste: true, profile: null, customOccasions: {}, plan: {}, occasion: 'any', weather: 'none', theme: 'auto', haptics: true, shake: false, lastBackup: null, remindedAt: 0 };

let db = null;
let mode = 'idb';
let reason = '';
let initPromise = null;
const mem = { items: new Map(), photos: new Map(), feedback: new Map(), settings: new Map(), events: new Map(), checks: new Map() };
const urlCache = new Map();

export function storageInfo() { return { mode, persistent: mode === 'idb', reason }; }

export function init() {
  if (!initPromise) initPromise = openDb();
  return initPromise;
}

async function openDb() {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    db = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB timed out')), 4000);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of Object.entries(KEYS)) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
      };
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('IndexedDB error')); };
      req.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB blocked')); };
    });
    await run('settings', 'readwrite', (s) => s.put({ k: '__probe', v: 1 }));
    await run('settings', 'readwrite', (s) => s.delete('__probe'));
    db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } };
  } catch (e) {
    db = null; mode = 'memory'; reason = String(e && e.message || e);
  }
}

function run(name, rw, fn) {
  return new Promise((resolve, reject) => {
    let t, out;
    try {
      t = db.transaction(name, rw);
      out = fn(t.objectStore(name));
    } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

const kv = {
  async all(name) { await init(); return mode === 'memory' ? [...mem[name].values()] : run(name, 'readonly', (s) => s.getAll()); },
  async get(name, key) { await init(); return mode === 'memory' ? mem[name].get(key) : run(name, 'readonly', (s) => s.get(key)); },
  async put(name, rec) { await init(); if (mode === 'memory') { mem[name].set(rec[KEYS[name]], rec); return; } await run(name, 'readwrite', (s) => s.put(rec)); },
  async del(name, key) { await init(); if (mode === 'memory') { mem[name].delete(key); return; } await run(name, 'readwrite', (s) => s.delete(key)); },
  async clear(name) { await init(); if (mode === 'memory') { mem[name].clear(); return; } await run(name, 'readwrite', (s) => s.clear()); },
};

// ---- items ----
export async function listItems() {
  try { return (await kv.all('items')).map((i) => makeItem(i)); } catch (e) { console.warn('listItems failed', e); return []; }
}
export async function putItem(item) { await kv.put('items', makeItem(item)); return item; }
export async function deleteItem(id) {
  const it = await kv.get('items', id).catch(() => null);
  await kv.del('items', id);
  if (it && it.photoId) await deletePhoto(it.photoId).catch(() => {});
  if (it && it.cutoutId) await deletePhoto(it.cutoutId).catch(() => {});
}

// ---- photos ----
export async function putPhoto(blob, id = newId()) { await kv.put('photos', { id, blob }); return id; }
export async function getPhotoBlob(id) { try { const r = await kv.get('photos', id); return r ? r.blob : null; } catch { return null; } }
export async function getPhotoURL(photoId) {
  if (!photoId) return null;
  if (urlCache.has(photoId)) return urlCache.get(photoId);
  const blob = await getPhotoBlob(photoId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(photoId, url);
  return url;
}
export function revokePhotoURL(photoId) {
  const u = urlCache.get(photoId);
  if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } urlCache.delete(photoId); }
}
export async function deletePhoto(id) { revokePhotoURL(id); await kv.del('photos', id); }

// ---- feedback: records { key, value:'like'|'dislike', kind:'outfit'|'pair', slots?, at } ----
export async function getFeedback() {
  try { const out = {}; for (const r of await kv.all('feedback')) out[r.key] = r.value; return out; } catch { return {}; }
}
export async function listFeedback() { try { return await kv.all('feedback'); } catch { return []; } }
export async function setFeedback(key, value, meta = {}) {
  if (!value) { await kv.del('feedback', key); return; }
  await kv.put('feedback', { key, value, kind: meta.kind || 'pair', slots: meta.slots || null, at: Date.now() });
}

// ---- taste events: { id, type:'battle'|'like'|'dislike'|'wear', at, winner?, loser?, items? } ----
// Items inside events are attribute snapshots (no photos), so learning survives deleted items.
const snap = (items) => {
  if (!items || typeof items !== 'object') return undefined;
  const out = {};
  for (const [slot, it] of Object.entries(items)) {
    if (!it || typeof it !== 'object') continue;
    const { photoId, cutoutId, worn, ...rest } = it; // eslint-disable-line no-unused-vars
    out[slot] = rest;
  }
  return out;
};
export async function appendEvent(evt) {
  if (!evt || !['battle', 'like', 'dislike', 'wear'].includes(evt.type)) return null;
  const rec = { id: newId(), type: evt.type, at: Number.isFinite(evt.at) ? evt.at : Date.now(),
    winner: snap(evt.winner), loser: snap(evt.loser), items: snap(evt.items) };
  try {
    await kv.put('events', rec);
    const all = await kv.all('events');
    if (all.length > MAX_EVENTS) {
      all.sort((a, b) => a.at - b.at);
      for (const old of all.slice(0, all.length - MAX_EVENTS)) await kv.del('events', old.id);
    }
  } catch (e) { console.warn('appendEvent failed', e); }
  return rec;
}
export async function listEvents() {
  try { return (await kv.all('events')).sort((a, b) => a.at - b.at); } catch { return []; }
}
export async function clearEvents() { try { await kv.clear('events'); } catch { /* ignore */ } }

// ---- fit checks (photos of what you actually wore) ----
export async function listChecks() {
  try { return (await kv.all('checks')).map(makeCheck).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt); } catch { return []; }
}
export async function putCheck(check) { const c = makeCheck(check); if (!c) throw new Error('Invalid fit check'); await kv.put('checks', c); return c; }
export async function deleteCheck(id) {
  const c = await kv.get('checks', id);
  if (c?.photoId) await deletePhoto(c.photoId);
  await kv.del('checks', id);
}

// ---- settings ----
export async function getSettings() {
  try { const out = { ...DEFAULT_SETTINGS }; for (const r of await kv.all('settings')) out[r.k] = r.v; return out; } catch { return { ...DEFAULT_SETTINGS }; }
}
export async function putSettings(partial) { for (const [k, v] of Object.entries(partial)) await kv.put('settings', { k, v }); }

export async function clearAll() {
  for (const id of [...urlCache.keys()]) revokePhotoURL(id);
  for (const name of Object.keys(KEYS)) await kv.clear(name);
}

// ---- backup ----
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('bad data URL');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

export function backupFileName(d = new Date()) { return `fit-machine-backup-${todayISO(d)}.json`; }

export async function exportBackup() {
  const [items, feedback, settings, photoRecs, events, checks] = await Promise.all([listItems(), listFeedback(), getSettings(), kv.all('photos'), listEvents(), listChecks()]);
  const photos = {};
  const wanted = new Set([...items.flatMap((i) => [i.photoId, i.cutoutId]), ...checks.map((c) => c.photoId)].filter(Boolean));
  const prof = settings.profile;
  if (prof && prof.includeSelfieInBackup) { if (prof.selfieId) wanted.add(prof.selfieId); if (prof.cutoutId) wanted.add(prof.cutoutId); }
  for (const r of photoRecs) {
    if (!wanted.has(r.id)) continue;
    try { photos[r.id] = await blobToDataURL(r.blob); } catch { /* skip unreadable photo */ }
  }
  const { lastBackup, remindedAt, ...keep } = settings; // eslint-disable-line no-unused-vars
  if (keep.profile && !keep.profile.includeSelfieInBackup) keep.profile = { ...keep.profile, selfieId: null, cutoutId: null };
  const payload = { app: 'fit-machine', version: 1, exportedAt: new Date().toISOString(), items, feedback, settings: keep, photos, events, checks };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/** Validate + normalize a parsed backup. Throws Error with a friendly message. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON, so it can’t be a Fit Machine backup.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This doesn’t look like a Fit Machine backup.');
  if (data.app !== 'fit-machine') throw new Error('This file wasn’t made by Fit Machine (missing app marker).');
  if (!Number.isFinite(data.version) || data.version < 1) throw new Error('Backup has no valid version number.');
  if (data.version > 1) throw new Error('This backup comes from a newer version of Fit Machine. Update the app and try again.');
  if (!Array.isArray(data.items)) throw new Error('Backup is missing its list of clothes.');
  let skipped = 0;
  const items = [];
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Backup contains an item that isn’t an object. File looks damaged.');
    if (!SLOTS.includes(raw.slot)) { skipped++; continue; }
    items.push(makeItem(raw));
  }
  const feedback = Array.isArray(data.feedback)
    ? data.feedback.filter((r) => r && typeof r.key === 'string' && (r.value === 'like' || r.value === 'dislike'))
    : [];
  const photos = {};
  if (data.photos && typeof data.photos === 'object') {
    for (const [id, url] of Object.entries(data.photos)) if (typeof url === 'string' && url.startsWith('data:')) photos[id] = url;
  }
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
  const events = Array.isArray(data.events)
    ? data.events.filter((e) => e && typeof e === 'object' && ['battle', 'like', 'dislike', 'wear'].includes(e.type)).slice(-MAX_EVENTS)
    : [];
  const checks = Array.isArray(data.checks) ? data.checks.map(makeCheck).filter(Boolean) : [];
  return { items, feedback, photos, settings, skipped, events, checks };
}

export async function importBackup(file, { mode: how = 'merge' } = {}) {
  const text = typeof file === 'string' ? file : await file.text();
  const b = parseBackup(text); // throws friendly errors before anything is touched
  let snapshot = null;
  if (how === 'replace') {
    snapshot = await (await exportBackup()).text(); // safety net: restore this if the import fails midway
    await clearAll();
  }
  try {
    return await applyBackup(b, how);
  } catch (e) {
    if (snapshot) { try { await clearAll(); await applyBackup(parseBackup(snapshot), 'replace'); } catch { /* best effort */ } }
    throw new Error('Restore failed partway, so nothing was changed. ' + (e?.name === 'QuotaExceededError' ? 'Your phone is out of storage space.' : 'The backup may be damaged.'));
  }
}

async function applyBackup(b, how) {
  let photoCount = 0;
  for (const [id, url] of Object.entries(b.photos)) {
    try { revokePhotoURL(id); await putPhoto(dataURLToBlob(url), id); photoCount++; } catch { /* skip bad photo */ }
  }
  for (const it of b.items) await putItem(it);
  for (const r of b.feedback) await kv.put('feedback', r);
  for (const e of b.events) await appendEvent(e);
  for (const c of b.checks || []) await kv.put('checks', c);
  const { onboarded, ...rest } = b.settings; // eslint-disable-line no-unused-vars
  await putSettings({ ...(how === 'replace' ? rest : {}), onboarded: true });
  return { items: b.items.length, photos: photoCount, skipped: b.skipped };
}
