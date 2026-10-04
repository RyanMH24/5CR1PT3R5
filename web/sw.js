/**
 * Makes the office installable and lets the page open without a connection. Network first:
 * edits to web/ show up on the next load, and the cache is only a fallback. Live data (/api/)
 * is never cached, so an offline page says it can't reach the office rather than showing old jobs.
 */
const CACHE = 'office-shell-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/api.js', 'js/attachments.js', 'js/composer.js', 'js/demo.js', 'js/director.js', 'js/examples.js', 'js/map.js',
  'js/mode.js', 'js/panel.js', 'js/pathfinding.js', 'js/renderer.js', 'js/sprites.js', 'js/wander.js',
  'icons/icon-192.png', 'icons/favicon-32.png',
];
const API = new URL('api/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  // One missing file shouldn't stop the install; it'll be cached the first time it loads.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path)))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(API)) return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true })
      .then((cached) => cached ?? Response.error())));
});
