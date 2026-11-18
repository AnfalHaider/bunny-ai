import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WEBAPP_FILES, WEBAPP_PUBLIC_PATHS, isWebappPath, serviceWorkerSource, webappResponse } from '../src/server/webapp.js';
import { startApp } from './helpers.js';

// Bunny as a web app: the manifest, the icons, the service worker (which must never keep a secret) and the exact paths that need no token.
const read = (rel) => readFile(new URL(`../src/ui/${rel}`, import.meta.url), 'utf8');
const pngSize = async (rel) => { const b = await readFile(new URL(`../src/ui/${rel}`, import.meta.url)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the manifest: name, short name, scope and start at "/", standalone, the design colours, and icons of 192 and 512 px (plain and maskable) that exist at their sizes', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.deepEqual([m.name, m.short_name, m.start_url, m.scope, m.display], ['Bunny AI', 'Bunny', '/', '/', 'standalone']);
  assert.equal(m.background_color, '#faf9f6');
  assert.equal(m.theme_color, '#faf9f6');
  for (const [size, purpose] of [[192, 'any'], [512, 'any'], [192, 'maskable'], [512, 'maskable']]) {
    const icon = m.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === purpose);
    assert.ok(icon, `${purpose} ${size}`);
    assert.equal(icon.type, 'image/png');
    assert.ok(isWebappPath(icon.src), `${icon.src} is served`);
    const file = WEBAPP_FILES[icon.src].file;
    assert.deepEqual(await pngSize(file), [size, size], file);
  }
  assert.deepEqual(await pngSize('icons/apple-touch-icon.png'), [180, 180]);
  assert.ok(!JSON.stringify(m).match(/token|csrf|secret/i));
});

test('the exact paths: the manifest, the service worker, the offline page and the icons, nothing else; a device that has not signed in gets only the manifest and the icons', async () => {
  assert.deepEqual(Object.keys(WEBAPP_FILES).sort(), ['/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/manifest.webmanifest', '/offline.html', '/sw.js']);
  assert.deepEqual([...WEBAPP_PUBLIC_PATHS].sort(), ['/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/manifest.webmanifest']);
  for (const bad of ['/', '/index.html', '/src/ui/index.html', '/src/ui/token.js', '/api/health', '/icons/', '/icons/../src/server/app.js', '/icons/icon-192.png/', '/sw.js/', '/SW.JS', 'constructor', '__proto__', 'toString', '/icons/secret.png', '/manifest.webmanifest?x=1']) {
    assert.equal(isWebappPath(bad), false, bad);
    assert.equal(await webappResponse(bad, '1.0.0'), null, bad);
  }
  for (const p of Object.keys(WEBAPP_FILES)) assert.ok((await webappResponse(p, '1.2.3')).body.length > 0, p);
});

test('the service worker is served at the root scope with the app\'s version in its cache name, and the version cannot inject code', async () => {
  const r = await webappResponse('/sw.js', '0.1.11');
  assert.equal(r.headers['service-worker-allowed'], '/');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.match(r.body.toString(), /const VERSION = '0\.1\.11';/);
  assert.doesNotMatch(r.body.toString(), /__BUNNY_VERSION__/);
  assert.match(serviceWorkerSource("const VERSION = '__BUNNY_VERSION__';", "1.0'; evil(); '"), /const VERSION = '1\.0evil\(\);';/ .source ? /const VERSION = '[\w.-]*';/ : /x/);
  assert.doesNotMatch(serviceWorkerSource("const VERSION = '__BUNNY_VERSION__';", "1.0'; evil(); '"), /evil\(\);/);
});

/** Runs the real service worker file in a sandbox with a fake cache, and returns what it did. */
async function worker({ network = async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/css' } }) } = {}) {
  const source = serviceWorkerSource(await read('bunny-sw.js'), '9.9.9');
  const handlers = {};
  const store = new Map(); // cache name -> Map(url -> response)
  const caches = {
    open: async (name) => { if (!store.has(name)) store.set(name, new Map()); const c = store.get(name); return { put: async (req, res) => { c.set(req.url ?? String(req), res); }, addAll: async (urls) => { for (const u of urls) c.set(new URL(u, 'http://127.0.0.1:1').href, await network(new Request(new URL(u, 'http://127.0.0.1:1').href))); } }; },
    keys: async () => [...store.keys()],
    delete: async (k) => store.delete(k),
    match: async (req) => { const url = typeof req === 'string' ? new URL(req, 'http://127.0.0.1:1').href : req.url; for (const c of store.values()) if (c.has(url)) return c.get(url); return undefined; },
  };
  const self = { location: { origin: 'http://127.0.0.1:1' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const context = vm.createContext({ self, caches, URL, Request, Response, Headers, fetch: (req) => network(req), console });
  vm.runInContext(`${source}\nthis.__mayCache = mayCache;`, context);
  const respond = async (request) => {
    let given = null;
    handlers.fetch({ request, respondWith: (p) => { given = p; } });
    return given === null ? null : given;
  };
  return { handlers, store, mayCache: context.__mayCache, respond, caches };
}
const req = (path, init = {}, extra = {}) => { const r = new Request(`http://127.0.0.1:1${path}`, init); if (extra.mode) Object.defineProperty(r, 'mode', { value: extra.mode }); return r; };
const res = (type = 'text/css', init = {}) => new Response('x', { status: 200, headers: { 'content-type': type, ...(init.headers ?? {}) } });

test('the service worker never keeps /api/, a page, a query, a cookie, a header with a secret or another site; it keeps only static app files', async () => {
  const w = await worker();
  const may = (path, response = res(), init = {}) => w.mayCache(req(path, init), response);
  // kept: static files
  for (const p of ['/src/ui/app.css', '/src/ui/chat.js', '/src/ui/markdown.js', '/src/ui/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest', '/src/ui/fonts/x.woff2']) {
    if (p.includes('fonts/')) continue; // only direct files of src/ui are matched
    assert.equal(may(p, res(p.endsWith('.css') ? 'text/css' : p.endsWith('.png') ? 'image/png' : 'text/javascript')), true, p);
  }
  assert.equal(may('/offline.html', res('text/html')), true, 'the offline page (it holds no secret)');
  // never: the API, whatever it says
  for (const p of ['/api/sessions', '/api/settings', '/api/health', '/api/artifacts/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/raw', '/api/remote/me']) assert.equal(may(p, res('application/json')), false, p);
  // never: a page (the launch token or the CSRF meta is in it), in any spelling
  for (const p of ['/', '/index.html', '/src/ui/index.html', '/src/ui/settings.html', '/src/ui/customize.html', '/src/ui/signin.html']) assert.equal(may(p, res('text/html; charset=utf-8')), false, p);
  // never: the token script or the device scripts, even though they are .js
  for (const p of ['/src/ui/token.js', '/src/ui/remote.js', '/src/ui/signin.js']) assert.equal(may(p, res('text/javascript')), false, p);
  // never: a query string, a response that sets a cookie, a request that carries a token or the CSRF header or credentials, a failed answer, another origin
  assert.equal(may('/src/ui/app.css?x=1'), false);
  assert.equal(may('/src/ui/app.css', res('text/css', { headers: { 'set-cookie': 'bunny_remote=abc' } })), false);
  assert.equal(may('/src/ui/app.css', res(), { headers: { 'x-bunny-token': 'secret' } }), false);
  assert.equal(may('/src/ui/app.css', res(), { headers: { 'x-bunny-csrf': 'secret' } }), false);
  assert.equal(may('/src/ui/app.css', res(), { headers: { authorization: 'Bearer x' } }), false);
  assert.equal(may('/src/ui/app.css', new Response('no', { status: 404 })), false);
  assert.equal(w.mayCache(new Request('https://example.com/src/ui/app.css'), res()), false);
  assert.equal(may('/src/ui/app.css', res(), { method: 'POST' }), false);
  assert.equal(may('/src/ui/other.exe', res('application/octet-stream')), false);
});

test('the service worker: install keeps only the offline page, manifest and icons (no page); the API is never touched; a page is network-first and falls back to the "Bunny is not running" page; old caches go on update', async () => {
  const w = await worker();
  let installed = null;
  w.handlers.install({ waitUntil: (p) => { installed = p; } });
  await installed;
  const cacheName = [...w.store.keys()][0];
  assert.equal(cacheName, 'bunny-static-9.9.9');
  const keptUrls = [...w.store.get(cacheName).keys()].map((u) => new URL(u).pathname);
  assert.ok(keptUrls.includes('/offline.html') && keptUrls.includes('/manifest.webmanifest') && keptUrls.includes('/icons/icon-192.png'));
  for (const u of keptUrls) { assert.doesNotMatch(u, /^\/api\//); if (u.endsWith('.html')) assert.equal(u, '/offline.html'); }
  // the API is left to the network: the worker does not even answer for it
  assert.equal(await w.respond(req('/api/sessions')), null);
  assert.equal(await w.respond(new Request('https://example.com/x')), null, 'another site is not its business');
  assert.equal(await w.respond(req('/api/health', { method: 'POST' })), null);
  // a page: the network first
  const online = await worker({ network: async () => res('text/html') });
  online.handlers.install({ waitUntil: () => {} });
  const page = await (await online.respond(req('/src/ui/index.html', {}, { mode: 'navigate' })));
  assert.equal(page.status, 200);
  const stored = [...online.store.values()].flatMap((c) => [...c.keys()]).map((u) => new URL(u).pathname);
  assert.ok(!stored.includes('/src/ui/index.html'), 'the page was not kept');
  // offline: a page navigation gets the offline page; a static file with nothing kept fails
  let down = false;
  const fallback = await worker({ network: async (r) => { if (down) throw new TypeError('offline'); return new Response(`<h1>Bunny is not running</h1>`, { status: 200, headers: { 'content-type': 'text/html' } }); } });
  let ready = null;
  fallback.handlers.install({ waitUntil: (p) => { ready = p; } });
  await ready;
  down = true;
  const offlinePage = await fallback.respond(req('/src/ui/index.html', {}, { mode: 'navigate' }));
  assert.match(await offlinePage.text(), /Bunny is not running/);
  const missing = await fallback.respond(req('/src/ui/chat.js'));
  await assert.rejects(async () => { const r = await missing; if (r.type === 'error') throw new Error('error response'); }, /error response/);
  // an update: caches of other versions are deleted
  fallback.store.set('bunny-shell-v1', new Map());
  fallback.store.set('bunny-static-0.0.1', new Map());
  let activated = null;
  fallback.handlers.activate({ waitUntil: (p) => { activated = p; } });
  await activated;
  assert.deepEqual([...fallback.store.keys()], ['bunny-static-9.9.9']);
});

test('the old worker (scope /src/ui/, which kept index.html) is replaced by one that clears every cache and removes itself', async () => {
  const old = await read('sw.js');
  assert.match(old, /caches\.delete/);
  assert.match(old, /unregister\(\)/);
  assert.doesNotMatch(old, /cache\.put|addAll|\.match\(/, 'it keeps nothing and answers nothing');
});

test('pages that Bunny serves to a browser link the manifest and carry the theme colours and the home-screen meta; the sign-in and offline pages too', async () => {
  for (const page of ['index.html', 'signin.html', 'offline.html', 'settings.html', 'providers.html', 'automation.html', 'customize.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, page);
    assert.match(html, /<meta name="theme-color" content="#faf9f6" media="\(prefers-color-scheme: light\)">/, page);
    assert.match(html, /<meta name="theme-color" content="#141518" media="\(prefers-color-scheme: dark\)">/, page);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/, page);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/, page);
    assert.match(html, /apple-mobile-web-app-status-bar-style/, page);
  }
  const chat = await read('chat.js');
  assert.match(chat, /register\('\/sw\.js', \{ scope: '\/' \}\)/);
  assert.match(chat, /window\.isSecureContext/);
  assert.match(chat, /!window\.bunnyDesktop/, 'not inside Bunny\'s own window');
});

test('Settings says plainly that over plain HTTP on the network there is no full install, and gives the browser install steps', async () => {
  const html = await read('settings.html');
  assert.match(html, /Install as an app/);
  assert.match(html, /On your network over plain HTTP/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /home-screen shortcut/);
});

// ---------------------------------------------------------------- over real HTTP, with the request guard on

const get = (url, path, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path, headers }, (r) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, text: t })); }).on('error', reject);
});

test('over HTTP with the guard on: the web app files are readable without a token, with no secret in them; the pages still hand out the token only to a page', async (t) => {
  const { base, app } = await startApp(t, { localGuard: true, folderPickerOnly: true });
  const host = new URL(base).host;
  for (const path of Object.keys(WEBAPP_FILES)) {
    const r = await get(base, path, { host });
    assert.equal(r.status, 200, path);
    assert.doesNotMatch(r.text, /name="bunny-token"|x-bunny-admin/, path);
  }
  const sw = await get(base, '/sw.js', { host });
  assert.equal(sw.headers['service-worker-allowed'], '/');
  assert.match(sw.headers['content-type'], /javascript/);
  const manifest = await get(base, '/manifest.webmanifest', { host });
  assert.match(manifest.headers['content-type'], /manifest\+json/);
  assert.equal(JSON.parse(manifest.text).start_url, '/');
  // the guard is unchanged: the API still needs the token, and a wrong Host is refused for these files too
  assert.equal((await get(base, '/api/sessions', { host })).status, 403);
  assert.equal((await get(base, '/manifest.webmanifest', { host: 'evil.example' })).status, 403);
  assert.equal((await get(base, '/icons/../src/server/app.js', { host })).status, 404);
  // the app page does carry the token (to a page), and links the manifest
  const page = await get(base, '/src/ui/index.html', { host });
  assert.match(page.text, /name="bunny-token"/);
  assert.match(page.text, /rel="manifest"/);
  void app;
});

test('on the network: a device that has not signed in may fetch the manifest and the icons and nothing more (not the worker, not the offline page, not a page); a signed-in one gets the rest', async (t) => {
  const { base, app } = await startApp(t, { lanAddress: '127.0.0.1' });
  const on = await (await fetch(`${base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: 'a passcode of enough length' }) })).json();
  const lan = on.url.replace(/\/$/, '');
  const host = new URL(lan).host;
  t.after(() => app.remote.disable());
  for (const path of WEBAPP_PUBLIC_PATHS) {
    const r = await get(lan, path, { host });
    assert.equal(r.status, 200, path);
    assert.doesNotMatch(r.text, /bunny-token|bunny-csrf/);
  }
  for (const path of ['/sw.js', '/offline.html', '/src/ui/index.html', '/src/ui/bunny-sw.js', '/src/ui/icons/icon-192.png', '/api/sessions']) {
    const r = await get(lan, path, { host });
    assert.ok(r.status === 302 || r.status === 401, `${path} -> ${r.status}`);
  }
  const signin = await get(lan, '/', { host });
  assert.match(signin.text, /rel="manifest"/);
  assert.match(String(signin.headers['content-security-policy']), /manifest-src 'self'/);
  assert.match(String(signin.headers['content-security-policy']), /img-src 'self'/);
});
