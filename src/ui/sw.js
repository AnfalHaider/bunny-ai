/**
 * A service worker, so the app can be installed as a desktop app and still
 * open when the machine is offline.
 *
 * Only the shell is cached. Nothing about a chat is cached: a transcript is
 * private, and the server is the only place it lives.
 */

const CACHE = 'bunny-shell-v1';

const SHELL = [
  './index.html',
  './providers.html',
  './settings.html',
  './automation.html',
  './app.css',
  './api.js',
  './chat.js',
  './markdown.js',
  './highlight.js',
  './i18n.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // The API always goes to the server: a cached answer would be a wrong one.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
