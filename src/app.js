// Entry point: boot, hash router, tab bar, service worker.
import * as store from './store.js';
import { data, load, subscribe, loadDemo, emit } from './ui/data.js';
import { h, $, $$ } from './ui/dom.js';
import { toast } from './ui/overlay.js';
import { showOnboarding } from './ui/onboarding.js';
import { mount as today } from './ui/today.js';
import { mount as battle } from './ui/battle.js';
import { mount as plan } from './ui/plan.js';
import { mount as profile } from './ui/profile.js';
import { mount as closet } from './ui/closet.js';
import { mount as snap } from './ui/snap.js';
import { mount as looks } from './ui/looks.js';
import { mount as settings } from './ui/settings.js';
import { setSetting } from './ui/data.js';

const ROUTES = { today, closet, snap, looks, settings, battle, plan, profile };
const ALIASES = { spin: 'today' };
const TITLES = { today: 'Today', closet: 'Closet', snap: 'Add clothes', looks: 'Lookbook', settings: 'Settings', battle: 'Outfit battle', plan: 'Plan the week', profile: 'Your colours' };
let current = null;
let currentName = null;
let first = true;

export function navigate(name) {
  const target = `#/${name}`;
  if (location.hash === target) render(); else location.hash = target;
}

function routeName() {
  const m = /^#\/([a-z]+)/.exec(location.hash);
  if (m && Object.hasOwn(ALIASES, m[1])) return ALIASES[m[1]];
  return m && Object.hasOwn(ROUTES, m[1]) ? m[1] : 'today';
}

function render() {
  const name = routeName();
  const root = $('#screen');
  if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
  current = null;
  root.replaceChildren();
  root.style.animation = 'none'; void root.offsetWidth; root.style.animation = '';
  currentName = name;
  try { current = ROUTES[name](root, { navigate }) || {}; }
  catch (e) { console.error(e); root.append(h('div', { class: 'empty' }, h('h2', {}, 'Something snagged'), h('p', {}, 'Try reloading the app.'))); }
  for (const a of $$('.tab, .gear')) {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = `${TITLES[name]} · Fit Machine`;
  if (!first) { window.scrollTo(0, 0); const t = $('#screen-title'); if (t) t.focus({ preventScroll: true }); }
  first = false;
}

function showStorageBanner() {
  const info = store.storageInfo();
  const host = $('#banner');
  host.replaceChildren();
  if (!info.persistent) host.append(h('div', { class: 'banner', role: 'status' }, 'Heads up: this browser won’t save your closet (private mode?). It will vanish when you close the tab.'));
}

async function boot() {
  try { await load(); } catch (e) { console.error(e); }
  showStorageBanner();
  subscribe((what) => { if (current && current.update) current.update(what); });
  window.addEventListener('hashchange', render);
  // Surface storage/other async failures instead of failing silently.
  let lastErr = 0;
  window.addEventListener('unhandledrejection', (e) => {
    console.warn(e.reason);
    if (Date.now() - lastErr < 3000) return;
    lastErr = Date.now();
    const quota = e.reason && (e.reason.name === 'QuotaExceededError' || /quota/i.test(String(e.reason.message)));
    toast(quota ? 'Your phone is out of storage space, so that change wasn’t saved.' : 'Something didn’t save. Try that again?', { tone: 'bad' });
  });
  if (!location.hash) history.replaceState(null, '', '#/today');
  render();
  if (!data.settings.onboarded) {
    showOnboarding({
      onDone: () => setSetting({ onboarded: true }),
      onSample: async () => { await loadDemo(); toast('Sample closet loaded. Hit Shuffle!'); },
    });
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
  document.documentElement.dataset.ready = '1';
}

boot();
