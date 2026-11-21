// Fit Machine service worker: precache the shell, network-first with cache fallback, offline after first load.
// Bump CACHE_VERSION whenever shell files change.
const CACHE_VERSION = 'fit-machine-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'styles/app.css', 'styles/today.css', 'styles/extra.css', 'styles/check.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'src/app.js', 'src/model.js', 'src/store.js',
  'src/engine/rules.js', 'src/engine/score.js', 'src/engine/build.js', 'src/engine/taste.js',
  'src/vision/color.js', 'src/vision/segment.js', 'src/vision/image.js', 'src/vision/skin.js', 'src/vision/wearing.js',
  'src/ui/closet.js', 'src/ui/data.js', 'src/ui/dom.js', 'src/ui/fx.js', 'src/ui/icons.js', 'src/ui/illustrations.js', 'src/ui/itemart.js',
  'src/ui/itemform.js', 'src/ui/looks.js', 'src/ui/onboarding.js', 'src/ui/overlay.js', 'src/ui/settings.js', 'src/ui/snap.js',
  'src/ui/today.js', 'src/ui/board.js', 'src/ui/swap.js', 'src/ui/glowup.js', 'src/ui/battle.js', 'src/ui/occasions.js',
  'src/ui/plan.js', 'src/ui/profile.js', 'src/ui/maskutil.js', 'src/ui/lazyboard.js', 'src/ui/check.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // allSettled: one missing file must not break the whole install.
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE_VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return; // weather API etc: straight to network

  if (isFont) { // cache-first for fonts, fail quietly offline
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }
      catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const res = await Promise.race([fetch(req), timeout(5000)]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await cache.match('index.html') || await cache.match('./'); if (idx) return idx; }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
