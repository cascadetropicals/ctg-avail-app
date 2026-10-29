// Service worker: lets the app open instantly and work without a connection.
// It only caches this site's own files. Calls to Google are never cached.

const VERSION = 'cg-avail-v3';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'config.js',
  'main.js',
  'ui.js',
  'store.js',
  'api.js',
  'demo.js',
  'format.js',
  'figtree-latin-wght-normal.woff2',
  'bricolage-grotesque-latin-wght-normal.woff2',
  'icon.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: show the saved copy now, fetch a fresh one for next time.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    })
  );
});
