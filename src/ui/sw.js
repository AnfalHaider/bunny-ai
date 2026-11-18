/**
 * The old service worker lived here (scope /src/ui/) and kept a copy of index.html, which holds the launch token. This one replaces it in any browser that still has it:
 * it clears every cache it can see and removes itself. The app's service worker is now served at /sw.js (src/ui/bunny-sw.js).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url).catch(() => {}))),
  );
});
