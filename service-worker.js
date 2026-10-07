// ZEL — service worker (network-first: always fresh, cached copy only when offline)
const CACHE_NAME = 'zel-shell-v2';
const SHELL_FILES = ['./', './index.html', './css/style.css', './js/theme-init.js', './js/app.js', './js/ui.js',
  './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request)));
});
