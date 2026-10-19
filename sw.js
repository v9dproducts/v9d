// Bump VERSION on every deploy so phones pick up the new files.
const VERSION = 'v9d-33';
const SHELL = [
  './',
  'index.html',
  'demo.js',
  'demo-camera.html',
  'styles.css',
  'app.js',
  'icons.js',
  'costs.js',
  'fees.js',
  'products.js',
  'maint-help.js',
  'maint.js',
  'radar.js',
  'dash.js',
  'print.js',
  'home.js',
  'printers.json',
  'trends-snapshot.json',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/favicon-32.png',
  'icons/favicon-64.png',
  'icons/bg-logo.jpg',
  'icons/icon-512.png',
  'icons/logo-banner.png',
  'icons/demo/benchy.png',
  'icons/demo/blocks.png',
  'icons/demo/block.png',
  'icons/demo/stand.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up quickly), fall back to cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    // 'no-cache' skips the browser's HTTP cache (GitHub Pages caches files for 10 min).
    fetch(e.request.url, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Push notifications from the V9D monitor.
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data.json(); } catch { msg = { title: 'V9D', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'V9D', {
    body: msg.body || '',
    tag: msg.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: msg.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      return win ? win.navigate(url).then((w) => (w || win).focus()) : self.clients.openWindow(url);
    })
  );
});
