import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { NETWORK_LINE, installContext, installRowState, installRowText, isLocalHost, runInstall, showUpdateBar, watchInstall, watchUpdates } from '../src/ui/install-app.js';
import { serviceWorkerSource } from '../src/server/webapp.js';

// Install as an app (Design's drawing): the states of the row, the browser's install offer kept by the top page, and an update that WAITS for the person.
const events = () => { const map = new Map(); return { addEventListener: (n, f) => map.set(n, [...(map.get(n) ?? []), f]), fire: (n, e = {}) => (map.get(n) ?? []).forEach((f) => f(e)) }; };

test('the row\'s state: Bunny\'s window gets a pointer, a tab on this computer is ready / installed / not offered, any other host is the network (a shortcut at most)', () => {
  assert.equal(installRowState({ bridge: true, host: '127.0.0.1', hasPrompt: true }), 'window');
  assert.equal(installRowState({ host: '127.0.0.1', hasPrompt: true }), 'ready');
  assert.equal(installRowState({ host: 'localhost', hasPrompt: true }), 'ready');
  assert.equal(installRowState({ host: '127.0.0.1', installed: true, hasPrompt: true }), 'installed');
  assert.equal(installRowState({ host: '127.0.0.1' }), 'none');
  for (const host of ['192.168.1.20', '10.0.0.4', 'bunny.example', '']) assert.equal(installRowState({ host, hasPrompt: true, installed: true }), 'network', host);
  assert.equal(isLocalHost('127.0.0.1') && isLocalHost('LOCALHOST') && !isLocalHost('192.168.1.1'), true);
});

test('the words of each state are the drawing\'s; Install is on only when ready; the network line shows in EVERY state', () => {
  const states = ['window', 'ready', 'installed', 'none', 'network'];
  for (const s of states) assert.equal(installRowText(s).network, NETWORK_LINE, s);
  assert.equal(NETWORK_LINE, 'On other devices over the network, browsers allow only a home-screen shortcut, unless Bunny has HTTPS.');
  assert.deepEqual(states.map((s) => installRowText(s).enabled), [false, true, false, false, false]);
  assert.match(installRowText('ready').body, /its own window on this computer, with an icon in the Start menu and the taskbar/);
  assert.match(installRowText('installed').body, /Apps, then Uninstall/);
  assert.equal(installRowText('installed').badge, 'Installed');
  assert.match(installRowText('none').body, /Chrome and Edge do/);
  assert.match(installRowText('network').body, /Add to Home Screen/);
  assert.match(installRowText('network').body, /A full install needs HTTPS/);
  assert.match(installRowText('window').body, /open it in your browser and use Install as an app in Settings there/);
  assert.equal(installRowText('window').button, null, 'no button in the window');
});

test('the top page keeps the browser\'s install offer (and stops the browser\'s own mini-bar); the install, once done, is remembered; a frame reads its parent\'s', async () => {
  const stored = new Map();
  const win = { ...events(), localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) }, matchMedia: () => ({ matches: false }) };
  win.parent = win;
  watchInstall(win);
  assert.deepEqual([win.__bunnyInstall.prompt, win.__bunnyInstall.installed], [null, false]);
  let told = 0;
  win.__bunnyInstall.listeners.add(() => { told += 1; });
  let prevented = 0;
  const offer = { preventDefault: () => { prevented += 1; }, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  win.fire('beforeinstallprompt', offer);
  assert.equal(prevented, 1);
  assert.equal(win.__bunnyInstall.prompt, offer);
  // a Settings page in a frame of it sees the same
  const frame = { parent: win, location: { origin: 'http://127.0.0.1:1' }, ...events() };
  win.location = { origin: 'http://127.0.0.1:1' };
  assert.equal(installContext(frame), win.__bunnyInstall);
  assert.equal(await runInstall(win.__bunnyInstall), 'accepted');
  assert.equal(win.__bunnyInstall.prompt, null, 'an offer is used once');
  assert.equal(await runInstall(win.__bunnyInstall), 'unavailable');
  win.fire('appinstalled');
  assert.equal(win.__bunnyInstall.installed, true);
  assert.equal(stored.get('bunny.installed'), '1');
  assert.ok(told >= 2, 'the page is told');
  // a refused install
  const second = { ...events(), localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: true }) };
  second.parent = second;
  watchInstall(second);
  assert.equal(second.__bunnyInstall.installed, true, 'the installed window itself counts as installed');
  assert.equal(await runInstall({ prompt: { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) } }), 'dismissed');
  // a frame from another origin sees none of it
  const stranger = { parent: win, location: { origin: 'http://evil.test' }, ...events(), localStorage: { getItem: () => null }, matchMedia: () => ({ matches: false }) };
  assert.notEqual(installContext(stranger), win.__bunnyInstall);
});

test('an update WAITS: the worker does not take over by itself, only when told; the person is shown "Update ready · Reload" and the page reloads once the new worker has taken over', async () => {
  // the worker file: no skipWaiting at install, a SKIP_WAITING message does it
  const source = serviceWorkerSource(await readFile(new URL('../src/ui/bunny-sw.js', import.meta.url), 'utf8'), '2.0.0');
  const handlers = {};
  let skipped = 0;
  vm.runInNewContext(source, { self: { location: { origin: 'http://127.0.0.1:1' }, addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting: () => { skipped += 1; }, clients: { claim: async () => {} } }, caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true }, URL, Request, Response, fetch: async () => new Response('x') });
  let installing = null;
  handlers.install({ waitUntil: (p) => { installing = p; } });
  await installing;
  assert.equal(skipped, 0, 'installing a new version does not replace the old one');
  handlers.message({ data: { type: 'SOMETHING_ELSE' } });
  handlers.message({ data: null });
  assert.equal(skipped, 0);
  handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, 1, 'only when the person said Reload');

  // the page: a waiting worker with an older one in charge -> the bar; the first install -> nothing to ask
  const makeWorker = () => { const w = { ...events(), state: 'installing', posted: [], postMessage: (m) => w.posted.push(m) }; return w; };
  const sw = { ...events(), controller: {} };
  const waiting = makeWorker();
  const registration = { ...events(), waiting, installing: null };
  const shown = [];
  let reloads = 0;
  watchUpdates(registration, (apply) => shown.push(apply), { serviceWorker: sw, reload: () => { reloads += 1; } });
  assert.equal(shown.length, 1, 'a worker already waiting is offered');
  assert.deepEqual(waiting.posted, [], 'nothing is sent until the person agrees');
  assert.equal(reloads, 0);
  shown[0]();
  assert.deepEqual(waiting.posted, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloads, 0, 'not before the new worker is in charge');
  sw.fire('controllerchange');
  sw.fire('controllerchange');
  assert.equal(reloads, 1, 'one reload, when the new worker took over');
  // a new worker found while the page runs
  const found = makeWorker();
  const reg2 = { ...events(), waiting: null, installing: null };
  const shown2 = [];
  watchUpdates(reg2, (apply) => shown2.push(apply), { serviceWorker: { ...events(), controller: {} }, reload() {} });
  reg2.installing = found;
  reg2.fire('updatefound');
  assert.equal(shown2.length, 0, 'not while it is still installing');
  found.state = 'installed';
  found.fire('statechange');
  assert.equal(shown2.length, 1);
  // the first install (nothing in charge yet): no "update ready"
  const first = makeWorker();
  const reg3 = { ...events(), waiting: null, installing: null };
  const shown3 = [];
  watchUpdates(reg3, (apply) => shown3.push(apply), { serviceWorker: { ...events(), controller: null }, reload() {} });
  reg3.installing = first;
  reg3.fire('updatefound');
  first.state = 'installed';
  first.fire('statechange');
  assert.deepEqual(shown3, []);
});

test('the update bar is small, says "Update ready · Reload", is made of text, appears once, and applies only when Reload is pressed', () => {
  const made = [];
  const el = (tag) => { const e = { tag, children: [], style: {}, attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, addEventListener(n, f) { this.listeners[n] = f; } }; made.push(e); return e; };
  const doc = { body: el('body'), createElement: el, getElementById: (id) => made.find((m) => m.id === id) ?? null };
  let applied = 0;
  const bar = showUpdateBar(doc, () => { applied += 1; });
  assert.equal(bar.attrs.role, 'status');
  const text = bar.children.map((c) => c.textContent).join(' ');
  assert.equal(text, 'Update ready · Reload');
  assert.equal(showUpdateBar(doc, () => {}), null, 'only one');
  assert.equal(applied, 0);
  bar.children[2].listeners.click();
  assert.equal(applied, 1);
});

test('the pages: fill the screen (viewport-fit=cover) and keep clear of the notch and the home bar; the title bar colours are the app\'s own', async () => {
  for (const page of ['index.html', 'signin.html', 'offline.html']) assert.match(await readFile(new URL(`../src/ui/${page}`, import.meta.url), 'utf8'), /viewport-fit=cover/, page);
  const css = await readFile(new URL('../docs/design/bunny-app-bindings.css', import.meta.url), 'utf8');
  assert.match(css, /\.topbar \{ height: calc\(var\(--topbar-h\) \+ env\(safe-area-inset-top, 0px\)\); padding-top: env\(safe-area-inset-top, 0px\); \}/);
  assert.match(css, /\.dock \{ padding-bottom: calc\(var\(--sp-7\) \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
  const built = await readFile(new URL('../src/ui/app.css', import.meta.url), 'utf8');
  assert.match(built, /safe-area-inset-top/, 'the built stylesheet has it');
  const manifest = JSON.parse(await readFile(new URL('../src/ui/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual([manifest.theme_color, manifest.background_color], ['#faf9f6', '#faf9f6']);
  const index = await readFile(new URL('../src/ui/index.html', import.meta.url), 'utf8');
  assert.match(index, /theme-color" content="#141518" media="\(prefers-color-scheme: dark\)"/);
  assert.doesNotMatch(index + JSON.stringify(manifest), /#6a4fd8.*theme/i, 'no violet title bar');
});
