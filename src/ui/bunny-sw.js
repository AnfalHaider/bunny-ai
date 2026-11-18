/**
 * Bunny AI's service worker (served at /sw.js with the app's version put in place of the marker below). Browsers run one only in a secure context (127.0.0.1 and
 * localhost qualify; a device on the network over plain http does not), so this is the part that makes "install as an app" work on this computer.
 *
 * It must NEVER keep anything that carries a secret:
 *   - no page (index.html and every other page holds the launch token or the CSRF token), only the offline page;
 *   - nothing under /api/ (chats, settings, tokens) and nothing from another site;
 *   - nothing that was asked with a query string, or that came back setting a cookie.
 * What it keeps is the static app files only (stylesheets, scripts, icons, fonts), in a cache named by the app's version, so an update replaces them.
 * Pages are network first; with no network a page navigation gets the "Bunny is not running" page.
 */
const VERSION = '__BUNNY_VERSION__';
const CACHE = `bunny-static-${VERSION}`;
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/src/ui/icon.svg'];

/** May this request's answer be kept? The one place that decides; test/webapp.test.js runs this very function. */
function mayCache(request, response) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.search) return false; // a query string can carry anything
  if (request.headers.has('authorization') || request.headers.has('x-bunny-token') || request.headers.has('x-bunny-csrf')) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (response) {
    if (!response.ok || response.type === 'opaque' || response.headers.has('set-cookie')) return false;
    const type = response.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type) && url.pathname !== OFFLINE) return false; // a page may hold the launch token or the CSRF token
  }
  if (url.pathname === OFFLINE) return true;
  return /^\/(src\/ui\/[\w.-]+\.(css|js|svg|woff2?|ttf)|icons\/[\w.-]+\.png|manifest\.webmanifest)$/.test(url.pathname) && !/\/(token|signin|remote)\.js$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  // A new version WAITS for the person ("Update ready · Reload"); it never replaces the page under them. (The very first install has nothing to wait for and takes over.)
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); // the person pressed Reload
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return; // not ours
  if (url.pathname.startsWith('/api/')) return; // the server always answers the API: a cached answer would be a wrong one
  if (request.mode === 'navigate') {
    // a page: the network, never the cache; with no network, the "Bunny is not running" page
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE).then((hit) => hit ?? new Response('Bunny is not running', { status: 503, headers: { 'content-type': 'text/plain' } }))));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (mayCache(request, response)) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}); }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => (hit && mayCache(request, hit) ? hit : Response.error()))),
  );
});
