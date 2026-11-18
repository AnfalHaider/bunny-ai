/**
 * QA, release-0.1.12 walk (eba5478): Bunny as a web app. Invented profile only. In-process Bunny (createApp, guard on, folderPickerOnly) with a tiny reverse proxy in front of
 * it on 127.0.0.1 (so the test can serve a CHANGED service worker for the update check; everything else is passed through untouched). Chromium plays the browser.
 *   1 manifest, icons, worker scope, cache contents, offline page
 *   2 Settings -> Use Bunny in a browser -> Install as an app states (synthetic beforeinstallprompt / appinstalled), the network line
 *   3 "Update ready - Reload" under the top bar, never over the composer, and Reload applies the update
 *   4 a LAN device (lanAddress 127.0.0.2) that has not signed in gets the manifest and icons only
 *   node e2e/w0112-walk.mjs
 */
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const pkgVersion = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8')).version;
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 320) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PASS = 'qa passcode for the 0112 walk';

const bunny = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'bunny-w0112-data-')), fake: true, secretStore: memorySecretStore(), probe: async () => ({ ok: true }), discover: async () => [], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2' });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const target = bunny.server.address().port;
let swVersion = null; // when set, the proxy serves the worker with this version instead
const proxy = createServer((req, res) => {
  const fwd = { ...req.headers, host: `127.0.0.1:${target}` }; if (req.headers.origin) fwd.origin = `http://127.0.0.1:${target}`; if (req.headers.referer) fwd.referer = fwd.origin ?? `http://127.0.0.1:${target}/`;
  const up = httpRequest({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: fwd }, (ur) => {
    if (req.url === '/sw.js' && swVersion) { const chunks = []; ur.on('data', (c) => chunks.push(c)); ur.on('end', () => { const body = Buffer.from(Buffer.concat(chunks).toString('utf8').replace(`const VERSION = '${pkgVersion}'`, `const VERSION = '${swVersion}'`)); res.writeHead(ur.statusCode, { ...ur.headers, 'content-length': body.length }); res.end(body); }); return; }
    res.writeHead(ur.statusCode, ur.headers); ur.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${proxy.address().port}`;
const adminJson = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { await adminJson('/api/remote', 'PUT', { enabled: false }); } catch { /* x */ } try { proxy.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); process.exit(code ?? (bad.length ? 1 : 0)); };

try {
  browser = await chromium.launch();
  // ================= 1. the web app at 127.0.0.1 =================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/'); await page.waitForTimeout(2500);
  const link = await page.evaluate(() => ({ manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'), apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'), theme: [...document.querySelectorAll('meta[name="theme-color"]')].length }));
  check('1a', 'the app page links the manifest, an apple-touch icon and a theme colour', link.manifest === '/manifest.webmanifest' && link.apple === '/icons/apple-touch-icon.png' && link.theme >= 1, JSON.stringify(link));
  const mres = await fetch(BASE + '/manifest.webmanifest'); const man = await mres.json().catch(() => null);
  check('1b', 'the manifest is JSON with the right type, name, id, start_url "/", scope "/", display standalone, and 192 and 512 icons, any and maskable', mres.status === 200 && /application\/manifest\+json/.test(mres.headers.get('content-type') ?? '') && man?.name === 'Bunny AI' && man.start_url === '/' && man.scope === '/' && man.display === 'standalone' && Boolean(man.id) && ['192x192', '512x512'].every((sz) => ['any', 'maskable'].every((pu) => man.icons.some((i) => i.sizes === sz && i.purpose === pu && i.type === 'image/png'))), JSON.stringify({ n: man?.name, id: man?.id, d: man?.display, icons: man?.icons?.length }));
  const iconResults = [];
  for (const ic of man?.icons ?? []) { const r = await fetch(BASE + ic.src); const buf = Buffer.from(await r.arrayBuffer()); const dims = ic.type === 'image/png' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null; iconResults.push({ src: ic.src, status: r.status, type: r.headers.get('content-type'), dims, want: ic.sizes }); }
  check('1c', 'every icon in the manifest loads (200, right type) and the PNG sizes equal the sizes stated', iconResults.length >= 5 && iconResults.every((i) => i.status === 200 && (i.dims ? `${i.dims.w}x${i.dims.h}` === i.want && i.type === 'image/png' : /svg/.test(i.type ?? ''))), JSON.stringify(iconResults.map((i) => `${i.src}:${i.status}:${i.dims ? i.dims.w + 'x' + i.dims.h : i.type}`)));
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await navigator.serviceWorker.ready; return { scope: r?.scope, active: r?.active?.state, script: r?.active?.scriptURL, controlled: Boolean(navigator.serviceWorker.controller) }; });
  check('1d', 'the worker registers at scope "/" from /sw.js and is active', reg.scope === BASE + '/' && reg.active === 'activated' && reg.script === BASE + '/sw.js', JSON.stringify(reg));
  const sw = await fetch(BASE + '/sw.js'); const swText = await sw.text();
  check('1e', 'the worker file has the app version in it (no marker left), is no-cache and allowed for scope "/"', sw.status === 200 && swText.includes(`'${pkgVersion}'`) && !swText.includes('__BUNNY_VERSION__') && /no-cache/.test(sw.headers.get('cache-control') ?? '') && sw.headers.get('service-worker-allowed') === '/', `${pkgVersion} ${sw.headers.get('cache-control')} ${sw.headers.get('service-worker-allowed')}`);
  // exercise: open pages, settings, call the API, so the worker has had every chance to keep something it must not
  await page.reload(); await page.waitForTimeout(1200);
  await page.goto(BASE + '/src/ui/settings.html?embed=1&section=desktop'); await page.waitForTimeout(1000);
  await page.evaluate(() => Promise.all(['/api/sessions', '/api/health', '/api/settings', '/api/remote', '/src/ui/chat.js?x=1', '/src/ui/index.html'].map((u) => fetch(u).catch(() => null)))); await page.waitForTimeout(800);
  const cache = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) { const c = await caches.open(k); out[k] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); } return out; });
  const all = Object.values(cache).flat();
  check('1f', 'one cache named for the version', Object.keys(cache).length === 1 && Object.keys(cache)[0] === `bunny-static-${pkgVersion}`, JSON.stringify(Object.keys(cache)));
  check('1g', 'the cache holds NO page except offline.html, nothing under /api, nothing with a query string', !all.some((p) => /\.html$/.test(p) && p !== '/offline.html') && !all.some((p) => p === '/' || p.startsWith('/api/') || p.includes('?')) && all.includes('/offline.html'), all.join(' '));
  check('1h', 'and none of the token or sign-in scripts', !all.some((p) => /\/(token|signin|remote)\.js$/.test(p)), String(all.length) + ' entries');
  await page.goto(BASE + '/'); await page.waitForTimeout(1200);
  await ctx.setOffline(true);
  await page.goto(BASE + '/').catch(() => {}); await page.waitForTimeout(1200);
  const off = await page.evaluate(() => document.body.innerText.slice(0, 160));
  check('1i', 'offline, opening the app shows "Bunny is not running" (the cached offline page)', /Bunny is not running/i.test(off), off);
  await page.screenshot({ path: join(tmpdir(), 'qa-w0112-offline.png') });
  await ctx.setOffline(false);
  check('1j', 'no page error in the app page', errs.length === 0, errs.join(' | '));

  // ================= 2. Settings: Install as an app =================
  const s2 = await ctx.newPage();
  for (const [label, w, h, scheme] of [['desktop', 1280, 800, 'light'], ['phone', 390, 780, 'dark']]) {
    await s2.setViewportSize({ width: w, height: h }); await s2.emulateMedia({ colorScheme: scheme });
    await s2.goto(BASE + '/src/ui/settings.html?section=desktop'); await s2.waitForTimeout(1200);
    const st = () => s2.evaluate(() => ({ state: document.getElementById('install-row')?.dataset.state, hidden: document.getElementById('install-row')?.hidden, dis: document.getElementById('install-app')?.disabled, btn: document.getElementById('install-app')?.textContent, badge: !document.getElementById('install-badge')?.hidden, body: document.getElementById('install-body')?.textContent, net: document.getElementById('install-network')?.textContent, pointer: document.getElementById('open-browser-pointer')?.hidden }));
    const none = await st();
    check(`2a ${label}`, 'no install offer from the browser: state "none", the button is off, the body says the browser does not offer it', none.state === 'none' && none.dis === true && /does not offer/.test(none.body), JSON.stringify(none).slice(0, 200));
    await s2.screenshot({ path: join(tmpdir(), `qa-w0112-install-none-${label}.png`) });
    await s2.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); window.__promptCalled = 0; e.prompt = async () => { window.__promptCalled += 1; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); }); await s2.waitForTimeout(400);
    const ready = await st();
    check(`2b ${label}`, 'a synthetic beforeinstallprompt: state "ready", Install is on', ready.state === 'ready' && ready.dis === false && ready.btn === 'Install', JSON.stringify(ready).slice(0, 200));
    await s2.screenshot({ path: join(tmpdir(), `qa-w0112-install-ready-${label}.png`) });
    await s2.locator('#install-app').click(); await s2.waitForTimeout(500);
    const used = await s2.evaluate(() => window.__promptCalled);
    check(`2c ${label}`, 'pressing Install asks the browser (prompt() called once) and the offer is used up', used === 1 && (await st()).state === 'none', String(used));
    await s2.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await s2.waitForTimeout(400);
    const inst = await st();
    check(`2d ${label}`, 'after appinstalled: state "installed", the badge "Installed" shows, the button says Installed and is off', inst.state === 'installed' && inst.badge && inst.btn === 'Installed' && inst.dis === true, JSON.stringify(inst).slice(0, 200));
    await s2.screenshot({ path: join(tmpdir(), `qa-w0112-install-installed-${label}.png`) });
    check(`2e ${label}`, 'the network line shows in every state', [none, ready, inst].every((x) => /On other devices over the network, browsers allow only a home-screen shortcut, unless Bunny has HTTPS\./.test(x.net)), none.net);
    await s2.evaluate(() => localStorage.removeItem('bunny.installed'));
  }
  // Settings inside the app page (a frame): it reads the offer from the top page
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(BASE + '/'); await page.waitForTimeout(1200);
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await page.evaluate((b) => { document.getElementById('settings-backdrop').hidden = false; document.getElementById('settings-frame').src = b + '/src/ui/settings.html?embed=1&section=desktop'; }, BASE); await page.waitForTimeout(1800);
  const fr = page.frames().find((f) => f.url().includes('section=desktop'));
  const inFrame = await fr.evaluate(() => ({ state: document.getElementById('install-row')?.dataset.state, dis: document.getElementById('install-app')?.disabled })).catch(() => null);
  check('2f', 'Settings inside the app page (iframe) reads the browser\'s offer from the top page: state "ready", Install on', inFrame?.state === 'ready' && inFrame.dis === false, JSON.stringify(inFrame));
  // Bunny's own window (a bridge present): no install row, a pointer line instead
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const wp = await wctx.newPage();
  await wp.addInitScript(() => { window.bunnyDesktop = { platform: 'win32', getPrefs: async () => ({}), setPrefs: async () => ({}), secureWrite: async () => ({ status: 200, data: {} }), pickFolder: async () => null, updates: { get: async () => null, check: async () => null, install: async () => null, onStatus: () => () => {} }, quickAsk: { take: async () => null, onNewChat: () => () => {} }, zoom: { get: () => 1, set: () => {} }, browserView: { send: async () => null, onEvent: () => () => {} }, openInBrowser: async () => null }; });
  await wp.goto(BASE + '/src/ui/settings.html?embed=1&section=desktop'); await wp.waitForTimeout(1200);
  const win = await wp.evaluate(() => ({ rowHidden: document.getElementById('install-row')?.hidden, pointer: document.getElementById('open-browser-pointer')?.textContent, shown: !document.getElementById('open-browser-pointer')?.hidden }));
  check('2g', 'in Bunny\'s own window the install row is not offered; a pointer line says to open it in a browser', win.rowHidden === true && win.shown && /open it in your browser/i.test(win.pointer ?? ''), JSON.stringify(win).slice(0, 220));
  await wctx.close();
  const wreg = await (async () => { const c = await browser.newContext(); const p = await c.newPage(); await p.addInitScript(() => { window.bunnyDesktop = { platform: 'win32', getPrefs: async () => ({}), setPrefs: async () => ({}), secureWrite: async () => ({ status: 200, data: {} }), pickFolder: async () => null, updates: { get: async () => null, check: async () => null, install: async () => null, onStatus: () => () => {} }, quickAsk: { take: async () => null, onNewChat: () => () => {} }, zoom: { get: () => 1, set: () => {} }, browserView: { send: async () => null, onEvent: () => () => {} } }; }); await p.goto(BASE + '/'); await p.waitForTimeout(1500); const n = await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length); await c.close(); return n; })();
  check('2h', 'inside Bunny\'s own window (a bridge present) no service worker is registered', wreg === 0, String(wreg));

  // ================= 3. Update ready · Reload =================
  const uctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const up = await uctx.newPage();
  await up.goto(BASE + '/'); await up.waitForTimeout(2500); await up.reload(); await up.waitForTimeout(1500);
  const before = await up.evaluate(async () => ({ controlled: Boolean(navigator.serviceWorker.controller), caches: await caches.keys() }));
  check('3a', 'the page is under the worker\'s control before the update, with the one current cache', before.controlled && before.caches.length === 1 && before.caches[0] === `bunny-static-${pkgVersion}`, JSON.stringify(before));
  swVersion = pkgVersion + '-qa-next';
  await up.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await r.update(); });
  await up.waitForTimeout(2500);
  check('3b', 'a changed worker WAITS: the page is not replaced, and "Update ready · Reload" is shown', (await up.locator('#update-ready').count()) === 1 && /Update ready/.test(await up.locator('#update-ready').innerText()) && (await up.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).waiting?.state)) === 'installed');
  await up.close();
  for (const [label, w, h, scheme] of [['desktop', 1280, 800, 'light'], ['phone 390', 390, 780, 'dark'], ['phone 320', 320, 640, 'light']]) {
    swVersion = null; const fctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }); const pg = await fctx.newPage();
    await pg.goto(BASE + '/'); await pg.waitForTimeout(2500); await pg.reload(); await pg.waitForTimeout(1500); swVersion = pkgVersion + '-qa-next';
    await pg.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await r.update(); }); await pg.waitForTimeout(2500);
    console.log('INFO  3c state', label, JSON.stringify(await pg.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return { waiting: r?.waiting?.state, installing: r?.installing?.state, active: r?.active?.state, controller: Boolean(navigator.serviceWorker.controller), bar: Boolean(document.getElementById('update-ready')) }; })));
    const geo = await pg.evaluate(() => { const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) }; }; return { bar: b(document.getElementById('update-ready')), top: b(document.querySelector('.topbar')), composer: b(document.querySelector('.composer')), dock: b(document.querySelector('.dock')), vw: innerWidth, vh: innerHeight }; });
    const overlap = (a, c) => a && c && !(a.r <= c.l || a.l >= c.r || a.b <= c.t || a.t >= c.b);
    check(`3c ${label}`, 'the bar sits under the top bar and inside the window, and does not touch the composer or its dock', geo.bar && geo.top && geo.bar.t >= geo.top.b - 1 && geo.bar.l >= 0 && geo.bar.r <= geo.vw && !overlap(geo.bar, geo.composer) && !overlap(geo.bar, geo.dock), JSON.stringify(geo));
    await pg.screenshot({ path: join(tmpdir(), `qa-w0112-update-${label.replace(' ', '')}.png`) }); await fctx.close();
  }
  swVersion = null; const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const rp = await rctx.newPage(); await rp.goto(BASE + '/'); await rp.waitForTimeout(2500); await rp.reload(); await rp.waitForTimeout(1500); swVersion = pkgVersion + '-qa-next';
  await rp.evaluate(async () => { (await navigator.serviceWorker.getRegistration('/')).update(); }); await rp.waitForTimeout(2500);
  const navP = rp.waitForEvent('framenavigated', { timeout: 8000 }).catch(() => null);
  await rp.locator('#update-ready button').click(); await navP; await rp.waitForTimeout(2500);
  const applied = await rp.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return { active: r.active?.state, waiting: Boolean(r.waiting), bar: Boolean(document.getElementById('update-ready')), caches: await caches.keys() }; });
  check('3d', 'Reload applies the update: the page reloaded, the new worker is active, nothing waits, the bar is gone, and only the new version\'s cache is left (the old one deleted)', applied.active === 'activated' && !applied.waiting && !applied.bar && applied.caches.length === 1 && applied.caches[0] === `bunny-static-${pkgVersion}-qa-next`, JSON.stringify(applied));
  swVersion = null; await rctx.close(); await uctx.close(); await ctx.close();

  // ================= 4. a LAN device that has not signed in =================
  const on = await adminJson('/api/remote', 'PUT', { enabled: true, passcode: PASS }); const lan = (on.json?.url ?? '').replace(/\/$/, ''); const lanHost = new URL(lan).host;
  const get = async (path) => { const r = await fetch(lan + path, { headers: { host: lanHost } }); return { status: r.status, type: r.headers.get('content-type') ?? '', text: (await r.text()).slice(0, 200) }; };
  check('4.0', 'remote is on at 127.0.0.2 (a second address)', lan.includes('127.0.0.2'), lan);
  const open = {};
  for (const p of ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']) open[p] = (await get(p)).status;
  check('4a', 'without signing in the manifest and every icon can be fetched (200)', Object.values(open).every((s) => s === 200), JSON.stringify(open));
  const root = await get('/'); const signin = /Sign in to Bunny AI/.test(root.text) || root.status === 200;
  check('4b', 'and the sign-in page is what "/" gives', signin && !/launch|bunny-token|csrf/i.test(root.text), `${root.status} ${root.text.slice(0, 60)}`);
  // "refused" = not the file asked for: a 401/403/404, or the sign-in page instead (never the worker's code, the offline page, a page's content, an icon, or API JSON)
  const closed = {}; const leaks = [];
  for (const [p, marker] of [['/sw.js', /CACHE|serviceWorker|caches/], ['/offline.html', /Bunny is not running/], ['/src/ui/index.html', /id="composer"|bunny-csrf|bunny-token/], ['/src/ui/settings.html', /install-row|id="theme"/], ['/src/ui/chat.js', /import .* from|export /], ['/src/ui/token.js', /bunny-token|x-bunny/], ['/src/ui/icon.svg', /<svg/], ['/api/health', /"ok"/], ['/api/sessions', /"id"/], ['/api/settings', /"theme"/], ['/api/remote', /"enabled"/]]) {
    const r = await get(p); const isSignin = /Sign in to Bunny AI/.test(r.text); closed[p] = r.status + (r.status === 200 ? (isSignin ? ':sign-in page' : ':' + r.type.split(';')[0]) : '');
    if (r.status === 200 && !isSignin && marker.test(r.text)) leaks.push(p);
  }
  check('4c', 'everything else is refused to a device that has not signed in: the worker, the offline page, every other page and script, icon.svg and the whole API each give the sign-in page or an error, never their own content', leaks.length === 0, JSON.stringify(closed));
  const sw4 = await get('/sw.js');
  check('4d', 'a device that has not signed in gets no worker code', !/CACHE|serviceWorker|caches/.test(sw4.text) && !/javascript/.test(sw4.type), `${sw4.status} ${sw4.type} ${sw4.text.slice(0, 40)}`);
  const lctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const lp = await lctx.newPage();
  await lp.goto(lan + '/'); await lp.fill('#passcode', PASS); await Promise.all([lp.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {}), lp.locator('#form').evaluate((f) => f.requestSubmit())]); await lp.waitForTimeout(1500);
  await lp.waitForTimeout(1500);
  const lreg = await lp.evaluate(async () => { const out = { secure: window.isSecureContext, sw: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 'n/a', cache: [] }; for (const k of await caches.keys()) { const c = await caches.open(k); out.cache.push(...(await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search)); } return out; });
  console.log('INFO  4e on this loopback stand-in (127.0.0.2 counts as a secure context in Chromium; a real network address over plain http does not) the signed-in device page registers ' + lreg.sw + ' worker(s)');
  check('4e', 'a signed-in device page that has a worker keeps no page, no /api and no query-string URL in it (offline.html and static files only)', /index.html/.test(lp.url()) && !lreg.cache.some((u) => /.html$/.test(u) && u !== '/offline.html') && !lreg.cache.some((u) => u === '/' || u.startsWith('/api/') || u.includes('?')), lreg.cache.join(' ').slice(0, 200));
  await lp.goto(lan + '/src/ui/settings.html?section=desktop'); await lp.waitForTimeout(1200);
  const net = await lp.evaluate(() => ({ state: document.getElementById('install-row')?.dataset.state, dis: document.getElementById('install-app')?.disabled, body: document.getElementById('install-body')?.textContent.slice(0, 90), net: document.getElementById('install-network')?.textContent.slice(0, 40) }));
  check('4f', 'Settings on the device over the network: state "network", Install is off, the line says a shortcut at most', net.state === 'network' && net.dis === true && /shortcut/.test(net.body ?? ''), JSON.stringify(net));
  await lp.screenshot({ path: join(tmpdir(), 'qa-w0112-install-network-phone.png') });
  await lctx.close();
} catch (err) { console.log('WALK CRASHED: ' + (err?.stack ?? err)); await finish(2); }
await finish();
