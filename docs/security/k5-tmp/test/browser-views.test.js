/**
 * W6-24: the browser panel's tabs as views. Fake Electron objects: what is checked here is what Bunny decides (the partition, the
 * preferences, which addresses may load and which requests may leave, where a view may sit, who may command it, how the model's
 * actions reach the page). What only a real window can show (cookies kept, a frame-busting page loading) is in test/probes/views-smoke.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createBrowserViews, allowedUrl, isBunnyOwn, loadable, requestAllowed, senderAllowed, PARTITION } from '../electron/browserViews.js';

const OWN_PORT = '45678';

function fakeContents() {
  const c = new EventEmitter();
  c.loaded = [];
  c.scripts = [];
  c.isolated = [];
  c.closed = false;
  c.opener = null;
  c.setWindowOpenHandler = (fn) => { c.opener = fn; };
  c.loadURL = async (url) => { c.loaded.push(url); };
  c.getTitle = () => 'A title';
  c.reload = () => { c.reloaded = true; };
  c.stop = () => { c.stopped = true; };
  c.close = () => { c.closed = true; };
  c.goBack = () => { c.wentBack = true; };
  c.canGoBack = () => true;
  c.canGoForward = () => false;
  c.executeJavaScript = async (code) => { c.scripts.push(code); return c.answer ?? { url: 'https://x/', title: 't', text: 'hello', elements: [] }; };
  c.executeJavaScriptInIsolatedWorld = async (world, parts) => { c.isolated.push([world, parts[0].code]); return c.answer ?? { url: 'https://x/', title: 't', text: 'hello', elements: [] }; };
  c.capturePage = async () => ({ getSize: () => ({ width: 800, height: 600 }), resize: () => ({ toDataURL: () => 'data:image/png;base64,small' }), toDataURL: () => 'data:image/png;base64,AAAA' });
  return c;
}

function setup() {
  const made = [];
  const added = [];
  const removed = [];
  class FakeView {
    constructor(options) { this.options = options; this.webContents = fakeContents(); this.bounds = null; this.visible = true; made.push(this); }
    setBounds(b) { this.bounds = b; }
    setVisible(v) { this.visible = v; }
  }
  const sessions = new Map();
  const session = {
    fromPartition: (name) => {
      if (!sessions.has(name)) {
        const ses = new EventEmitter();
        Object.assign(ses, {
          name, requestHandler: null, checkHandler: null, beforeRequest: null,
          setPermissionRequestHandler(fn) { this.requestHandler = fn; }, setPermissionCheckHandler(fn) { this.checkHandler = fn; },
          webRequest: { onBeforeRequest: (fn) => { ses.beforeRequest = fn; } },
        });
        sessions.set(name, ses);
      }
      return sessions.get(name);
    },
  };
  const win = { contentView: { addChildView: (v) => added.push(v), removeChildView: (v) => removed.push(v) }, getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) };
  const views = createBrowserViews({ WebContentsView: FakeView, session, getWindow: () => win, getOwnPort: () => OWN_PORT });
  const page = Object.assign(new EventEmitter(), { sent: [], send(channel, payload) { this.sent.push([channel, payload]); }, getZoomFactor: () => 1, isDestroyed: () => false });
  return { views, made, added, removed, page, session, win };
}

const ask = (ses, details) => new Promise((resolve) => ses.beforeRequest(details, resolve));

test('W6-24: only http and https addresses (no login in them) are allowed', () => {
  for (const ok of ['http://localhost:3000/', 'https://example.com/a?b=1']) assert.equal(allowedUrl(ok), true, ok);
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<b>x', 'blob:http://x/1', 'chrome://settings', 'devtools://devtools/x', 'about:blank', 'ftp://x/y', 'https://user:pw@example.com/', '', 'not a url', 'view-source:https://example.com']) assert.equal(allowedUrl(bad), false, bad);
});

test('W6-24 (Security 1): Bunny\'s own server is never loaded in a view, in any spelling; other local dev servers are fine', () => {
  for (const own of [`http://127.0.0.1:${OWN_PORT}/`, `http://localhost:${OWN_PORT}/src/ui/index.html`, `http://[::1]:${OWN_PORT}/`, `http://0.0.0.0:${OWN_PORT}/`, `http://127.1.2.3:${OWN_PORT}/`, `http://LOCALHOST.:${OWN_PORT}/`, `http://app.localhost:${OWN_PORT}/`, `http://localhost:${OWN_PORT}/x?y=1#z`]) {
    assert.equal(isBunnyOwn(own, OWN_PORT), true, own);
    assert.equal(loadable(own, OWN_PORT), false, own);
  }
  // IPv4-mapped and compatible spellings of this PC (defence in depth: Bunny's own Host check stops them too)
  for (const mapped of [`http://[::ffff:127.0.0.1]:${OWN_PORT}/`, `http://[::ffff:7f00:1]:${OWN_PORT}/`, `http://[::ffff:127.9.9.9]:${OWN_PORT}/`, `http://[::ffff:0.0.0.0]:${OWN_PORT}/`, `http://[::127.0.0.1]:${OWN_PORT}/`, `http://[0:0:0:0:0:ffff:7f00:1]:${OWN_PORT}/`]) {
    assert.equal(isBunnyOwn(mapped, OWN_PORT), true, mapped);
  }
  assert.equal(isBunnyOwn('http://[::ffff:127.0.0.1]:3000/', OWN_PORT), false, 'another port is another server');
  assert.equal(isBunnyOwn(`http://[::ffff:8.8.8.8]:${OWN_PORT}/`, OWN_PORT), false, 'a public address is not this PC');
  for (const fine of ['http://localhost:3000/', 'http://127.0.0.1:5173/', 'https://example.com/', `http://example.com:${OWN_PORT}/`, 'https://localhost:3000/']) assert.equal(loadable(fine, OWN_PORT), true, fine);
  assert.equal(isBunnyOwn('http://localhost:80/', ''), false, 'no port known: nothing is Bunny');
});

test('W6-24 (Security 2): the partition cancels a request that is not for a page to make: file:, chrome:, devtools:, view-source: as a page, anything to Bunny\'s port', async () => {
  const { views, page, session } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const ses = session.fromPartition(PARTITION);
  const canceled = async (details) => (await ask(ses, details)).cancel;
  // a page or a frame must be http(s)
  for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,hi', 'blob:http://x/1', 'chrome://gpu', 'devtools://devtools/bundled/x.html', 'view-source:https://example.com', 'about:blank']) {
    for (const resourceType of ['mainFrame', 'subFrame']) assert.equal(await canceled({ url, resourceType }), true, `${resourceType} ${url}`);
  }
  assert.equal(await canceled({ url: 'https://example.com/', resourceType: 'mainFrame' }), false);
  assert.equal(await canceled({ url: 'http://localhost:3000/', resourceType: 'subFrame' }), false);
  // inline pictures and fonts and websockets are fine; the file system and the browser's own addresses are not
  assert.equal(await canceled({ url: 'data:image/png;base64,AAAA', resourceType: 'image' }), false);
  assert.equal(await canceled({ url: 'wss://example.com/socket', resourceType: 'webSocket' }), false);
  assert.equal(await canceled({ url: 'file:///C:/Windows/win.ini', resourceType: 'xhr' }), true);
  assert.equal(await canceled({ url: 'chrome://gpu', resourceType: 'script' }), true);
  // Bunny's own port, for every kind of request (a fetch, a script, an image, a websocket, a frame)
  for (const resourceType of ['mainFrame', 'subFrame', 'xhr', 'fetch', 'script', 'image', 'stylesheet', 'webSocket', 'ping', 'other']) {
    for (const url of [`http://127.0.0.1:${OWN_PORT}/api/sessions`, `http://localhost:${OWN_PORT}/`, `ws://127.0.0.1:${OWN_PORT}/x`, `http://[::1]:${OWN_PORT}/`]) assert.equal(await canceled({ url, resourceType }), true, `${resourceType} ${url}`);
  }
  assert.equal(requestAllowed({ url: 'not a url', resourceType: 'xhr' }, OWN_PORT), false);
});

test('W6-24: a view is sandboxed, has no preload, no Node and no webview, web security on, and its own partition (not the default session)', () => {
  const { views, made, page, session, added } = setup();
  assert.deepEqual(views.handle(page, { op: 'open', tab: 'bunny-tab-1' }), { ok: true });
  const prefs = made[0].options.webPreferences;
  assert.equal(prefs.partition, PARTITION);
  assert.equal(PARTITION, 'persist:bunny-browser');
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.navigateOnDragDrop, false);
  assert.equal(prefs.safeDialogs, true);
  assert.equal('preload' in prefs, false, 'no preload');
  assert.equal(added.length, 1);
  assert.equal(made[0].visible, false, 'hidden until the page says where the panel is');
  const ses = session.fromPartition(PARTITION);
  assert.equal(views.ownsSession(ses), true);
  assert.equal(views.ownsSession(session.fromPartition('persist:other')), false);
});

test('W6-24 (Security 4): the partition refuses every permission and every device, and stops a download with a line for the panel', () => {
  const { views, made, page, session } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const ses = session.fromPartition(PARTITION);
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'hid', 'serial', 'usb', 'bluetooth', 'display-capture', 'idle-detection', 'window-management', 'fullscreen']) {
    let answer = 'unset';
    ses.requestHandler(null, permission, (a) => { answer = a; });
    assert.equal(answer, false, permission);
    assert.equal(ses.checkHandler(null, permission), false, permission);
  }
  for (const picker of ['select-hid-device', 'select-serial-port', 'select-usb-device']) {
    let stopped = false; let chose = 'unset';
    ses.emit(picker, { preventDefault: () => { stopped = true; } }, {}, (id) => { chose = id; });
    assert.equal(stopped, true, picker);
    assert.equal(chose, '', `${picker}: no device is chosen`);
  }
  let btStopped = false; let btChose = 'unset';
  made[0].webContents.emit('select-bluetooth-device', { preventDefault: () => { btStopped = true; } }, [], (id) => { btChose = id; });
  assert.equal(btStopped, true);
  assert.equal(btChose, '');
  // a download
  let prevented = false; let cancelled = false;
  ses.emit('will-download', { preventDefault: () => { prevented = true; } }, { cancel: () => { cancelled = true; }, getFilename: () => 'setup.exe' }, made[0].webContents);
  assert.equal(prevented && cancelled, true);
  assert.deepEqual(page.sent.at(-1), ['browser:view-event', { tab: 'bunny-tab-1', event: 'download-blocked', filename: 'setup.exe' }]);
});

test('W6-24: a view loads http(s) only, and a navigation to anything else (or to Bunny) is cancelled, including redirects and frames', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1', url: 'https://example.com/' });
  const contents = made[0].webContents;
  assert.deepEqual(contents.loaded, ['https://example.com/']);
  for (const url of ['file:///C:/secret.txt', 'javascript:alert(1)', `http://127.0.0.1:${OWN_PORT}/`, `http://localhost:${OWN_PORT}/api/settings`]) {
    assert.equal(views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url }).ok, false, url);
    assert.equal(views.handle(page, { op: 'open', tab: 'bunny-tab-9', url }).ok, false, `open ${url}`);
  }
  assert.deepEqual(contents.loaded, ['https://example.com/']);
  assert.equal(views.has('bunny-tab-9'), false, 'a refused open leaves no view behind');
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    let stopped = 0;
    const cancel = () => ({ preventDefault: () => { stopped += 1; } });
    for (const url of ['file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,x', `http://127.0.0.1:${OWN_PORT}/`, `http://localhost:${OWN_PORT}/x`]) contents.emit(event, cancel(), url);
    contents.emit(event, { preventDefault: () => { stopped += 100; } }, 'https://fine.example/');
    contents.emit(event, { preventDefault: () => { stopped += 100; } }, 'http://localhost:3000/');
    assert.equal(stopped, 5, `${event}: the five bad ones are cancelled, the good ones are not`);
  }
});

test('W6-24 (Security 3): window.open always denies; a good address becomes a new tab event, Bunny\'s own or a bad address is dropped', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const contents = made[0].webContents;
  assert.deepEqual(contents.opener({ url: 'https://popup.example/' }), { action: 'deny' });
  assert.deepEqual(page.sent.at(-1), ['browser:view-event', { tab: 'bunny-tab-1', event: 'new-tab', url: 'https://popup.example/' }]);
  const before = page.sent.length;
  for (const url of ['file:///C:/x', 'javascript:1', `http://127.0.0.1:${OWN_PORT}/`, 'data:text/html,x']) assert.deepEqual(contents.opener({ url }), { action: 'deny' }, url);
  assert.equal(page.sent.length, before, 'nothing was passed on for them');
});

test('W6-24 (Security 5): a page cannot hold the panel with a leave prompt', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  let allowedLeave = false;
  made[0].webContents.emit('will-prevent-unload', { preventDefault: () => { allowedLeave = true; } });
  assert.equal(allowedLeave, true);
});

test('W6-24: where the view sits: scaled by the zoom, kept inside the window, hidden when there is no room', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const view = made[0];
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 100, y: 50, width: 600, height: 400 }, visible: true });
  assert.deepEqual(view.bounds, { x: 100, y: 50, width: 600, height: 400 });
  assert.equal(view.visible, true);
  page.getZoomFactor = () => 1.5;
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 100, y: 50, width: 400, height: 300 }, visible: true });
  assert.deepEqual(view.bounds, { x: 150, y: 75, width: 600, height: 450 }, 'zoom 150%');
  page.getZoomFactor = () => 1;
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 800, y: 600, width: 5000, height: 5000 }, visible: true });
  assert.deepEqual(view.bounds, { x: 800, y: 600, width: 200, height: 100 }, 'never past the window');
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: -500, y: -500, width: 100, height: 100 }, visible: true });
  assert.equal(view.visible, false, 'a rect with nothing left of it hides the view');
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 'nonsense', y: NaN, width: Infinity, height: null }, visible: true });
  assert.equal(view.visible, false);
  assert.ok(Object.values(view.bounds).every(Number.isInteger), 'whole numbers only');
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 10, y: 10, width: 300, height: 300 }, visible: false });
  assert.equal(view.visible, false, 'the page can ask for it hidden (a menu is open over it)');
  assert.deepEqual(views.handle(page, { op: 'hideAll' }), { ok: true });
});

test('W6-24 (Security 6): a command from a page that is not the window\'s own page is refused; so are a view, a sub-frame and a foreign address', () => {
  const win = {};
  const windows = new Map();
  const mainPage = { mainFrame: { url: 'http://127.0.0.1:45678/src/ui/index.html' } };
  windows.set(mainPage, win);
  const windowOf = (sender) => windows.get(sender) ?? null;
  const isOwn = (url) => url.startsWith('http://127.0.0.1:45678/');
  assert.equal(senderAllowed({ sender: mainPage, senderFrame: mainPage.mainFrame }, isOwn, windowOf), true);
  const view = { mainFrame: { url: 'https://evil.example/' } };
  assert.equal(senderAllowed({ sender: view, senderFrame: view.mainFrame }, isOwn, windowOf), false, 'a view is not a window page');
  assert.equal(senderAllowed({ sender: mainPage, senderFrame: { url: 'http://127.0.0.1:45678/x' } }, isOwn, windowOf), false, 'a frame inside the page');
  const odd = { mainFrame: { url: 'https://evil.example/' } };
  windows.set(odd, win);
  assert.equal(senderAllowed({ sender: odd, senderFrame: odd.mainFrame }, isOwn, windowOf), false, 'a window page at a foreign address');
  assert.equal(senderAllowed({}, isOwn, windowOf), false);
  assert.equal(senderAllowed({ sender: mainPage }, isOwn, windowOf), false);
  assert.equal(senderAllowed(null, isOwn, windowOf), false);
});

test('W6-24: another page cannot command a view it did not open, and a made-up tab name is refused', () => {
  const { views, made, page } = setup();
  const stranger = Object.assign(new EventEmitter(), { send() {}, getZoomFactor: () => 1 });
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  for (const op of ['navigate', 'rect', 'show', 'hide', 'back', 'forward', 'reload', 'stop', 'close']) {
    const answer = views.handle(stranger, { op, tab: 'bunny-tab-1', url: 'https://x/', rect: { x: 0, y: 0, width: 100, height: 100 } });
    assert.equal(answer.ok, false, op);
  }
  assert.equal(views.handle(stranger, { op: 'open', tab: 'bunny-tab-1' }).ok, false, 'cannot take over its name either');
  assert.equal(views.has('bunny-tab-1'), true);
  assert.equal(made[0].webContents.closed, false);
  for (const tab of ['', 'tab-1', 'bunny-tab-x', '../x', 'bunny-tab-1; drop']) assert.equal(views.handle(page, { op: 'open', tab }).ok, false, tab);
  views.handle(stranger, { op: 'closeAll' });
  assert.equal(views.has('bunny-tab-1'), true);
});

test('W6-24: events go back to the page that opened the view: navigated, title, loading, failed (but not "aborted")', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-3' });
  const c = made[0].webContents;
  c.emit('did-navigate', {}, 'https://example.com/next');
  c.emit('page-title-updated', {}, 'New title');
  c.emit('did-stop-loading');
  c.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/x', true);
  c.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/', true);
  c.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://ads.example/frame', false);
  assert.deepEqual(page.sent.map(([, p]) => p.event), ['navigated', 'title', 'loading', 'failed']);
  assert.equal(page.sent[0][1].url, 'https://example.com/next', 'the address bar shows the view\'s real address');
  assert.equal(page.sent.at(-1)[1].description, 'ERR_NAME_NOT_RESOLVED');
  assert.equal(page.sent.at(-1)[1].tab, 'bunny-tab-3');
});

test('W6-24: closing a tab, the page navigating away and closeAll remove the views, and nothing stays over a page that cannot see it', () => {
  const { views, made, removed, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  views.handle(page, { op: 'open', tab: 'bunny-tab-2' });
  views.handle(page, { op: 'close', tab: 'bunny-tab-1' });
  assert.equal(views.has('bunny-tab-1'), false);
  assert.equal(made[0].webContents.closed, true);
  assert.equal(removed.length, 1);
  page.emit('did-navigate'); // Bunny's own page went somewhere else (or was reloaded)
  assert.equal(views.count(), 0);
  views.handle(page, { op: 'open', tab: 'bunny-tab-5' });
  page.emit('destroyed');
  assert.equal(views.count(), 0);
  for (let i = 1; i <= 12; i += 1) assert.equal(views.handle(page, { op: 'open', tab: `bunny-tab-${i}` }).ok, true);
  assert.equal(views.handle(page, { op: 'open', tab: 'bunny-tab-13' }).ok, false);
  views.handle(page, { op: 'closeAll' });
  assert.equal(views.count(), 0);
});

test('W6-24 (Security 7): the model\'s actions reach the view in a world of their own: read, click, type, scroll and screenshot; a frame tab is left to the frame code', async () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const c = made[0].webContents;
  const read = await views.control(page, 'bunny-tab-1', 'read', {});
  assert.equal(read.page.text, 'hello');
  assert.equal(c.scripts.length, 0, 'never in the page\'s own world');
  assert.equal(c.isolated.length, 1);
  assert.equal(typeof c.isolated[0][0], 'number');
  assert.match(c.isolated[0][1], /"read"/);
  c.isolated.length = 0;
  let step = 0;
  c.executeJavaScriptInIsolatedWorld = async (world, parts) => { c.isolated.push([world, parts[0].code]); step += 1; return step === 1 ? { clicked: true } : { url: 'https://x/', title: 't', text: 'after', elements: [] }; };
  const clicked = await views.control(page, 'bunny-tab-1', 'click', { ref: 7 });
  assert.equal(clicked.note, 'Clicked element 7.');
  assert.match(c.isolated[0][1], /"click"/);
  assert.match(c.isolated[0][1], /"ref":7/);
  assert.equal(clicked.page.text, 'after');
  const shot = await views.control(page, 'bunny-tab-1', 'screenshot', {});
  assert.match(shot.image, /^data:image\/png;base64,/);
  assert.equal(await views.control(page, 'bunny-tab-9', 'read', {}), null, 'not a view: the caller falls back to the frame');
  const stranger = Object.assign(new EventEmitter(), { send() {}, getZoomFactor: () => 1 });
  assert.equal(await views.control(stranger, 'bunny-tab-1', 'read', {}), null, 'and another page cannot work this one');
  assert.deepEqual(await views.control(page, 'bunny-tab-1', 'run-script', {}), { error: 'Not a browser action' });
});

test('W6-24 (Security 9): Bunny\'s own session no longer drops any frame header, and the panel\'s views are never put in the default session', () => {
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /onHeadersReceived/, 'no hook on any session that removes X-Frame-Options or frame-ancestors');
  assert.doesNotMatch(main, /x-frame-options\s*['"]/i);
  const views = readFileSync(new URL('../electron/browserViews.js', import.meta.url), 'utf8');
  assert.doesNotMatch(views, /defaultSession/, 'the view code never touches the default session');
  assert.match(views, /partition: PARTITION/);
  assert.equal((main.match(/senderAllowed\(event, isOwn, windowOf\)/g) ?? []).length, 2, 'both commands check the sender');
});

test('W6-24 (QA b): a refused address says why: Bunny itself, or not a web address', () => {
  const { views, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const own = views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${OWN_PORT}/` });
  assert.deepEqual([own.ok, own.reason], [false, 'own']);
  const odd = views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url: 'file:///C:/x' });
  assert.deepEqual([odd.ok, odd.reason], [false, 'scheme']);
  const open = views.handle(page, { op: 'open', tab: 'bunny-tab-2', url: `http://localhost:${OWN_PORT}/` });
  assert.deepEqual([open.ok, open.reason], [false, 'own']);
  const fine = views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url: 'https://example.com/' });
  assert.equal(fine.ok, true);
});
