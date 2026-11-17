/**
 * W6-24: the browser panel's tabs as views. Fake Electron objects: what is checked here is what Bunny decides (the partition, the
 * preferences, which addresses may load, where a view may sit, who may command it, how the model's actions reach the page).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBrowserViews, allowedUrl, PARTITION } from '../electron/browserViews.js';

function fakeContents() {
  const c = new EventEmitter();
  c.loaded = [];
  c.scripts = [];
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
      if (!sessions.has(name)) sessions.set(name, { name, requestHandler: null, checkHandler: null, setPermissionRequestHandler(fn) { this.requestHandler = fn; }, setPermissionCheckHandler(fn) { this.checkHandler = fn; } });
      return sessions.get(name);
    },
  };
  const win = { contentView: { addChildView: (v) => added.push(v), removeChildView: (v) => removed.push(v) }, getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) };
  const views = createBrowserViews({ WebContentsView: FakeView, session, getWindow: () => win });
  const page = Object.assign(new EventEmitter(), { sent: [], send(channel, payload) { this.sent.push([channel, payload]); }, getZoomFactor: () => 1, isDestroyed: () => false });
  return { views, made, added, removed, page, session, win };
}

test('W6-24: only http and https addresses (no login in them) are allowed', () => {
  for (const ok of ['http://localhost:3000/', 'https://example.com/a?b=1']) assert.equal(allowedUrl(ok), true, ok);
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<b>x', 'blob:http://x/1', 'chrome://settings', 'devtools://devtools/x', 'about:blank', 'ftp://x/y', 'https://user:pw@example.com/', '', 'not a url', 'view-source:https://example.com']) assert.equal(allowedUrl(bad), false, bad);
});

test('W6-24: a view is sandboxed, has no preload, no Node and no webview, and its own partition (not the default session)', () => {
  const { views, made, page, session, added } = setup();
  assert.deepEqual(views.handle(page, { op: 'open', tab: 'bunny-tab-1' }), { ok: true });
  const prefs = made[0].options.webPreferences;
  assert.equal(prefs.partition, PARTITION);
  assert.equal(PARTITION, 'persist:bunny-browser');
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal('preload' in prefs, false, 'no preload');
  assert.equal(added.length, 1);
  assert.equal(made[0].visible, false, 'hidden until the page says where the panel is');
  // the partition asks for nothing: every permission is refused
  const ses = session.fromPartition(PARTITION);
  let allowed = 'unset';
  ses.requestHandler(null, 'media', (a) => { allowed = a; });
  assert.equal(allowed, false);
  assert.equal(ses.checkHandler(null, 'geolocation'), false);
  assert.equal(views.ownsSession(ses), true);
  assert.equal(views.ownsSession(session.fromPartition('persist:other')), false);
});

test('W6-24: a view loads http(s) only, and a navigation to anything else is cancelled (including redirects)', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1', url: 'https://example.com/' });
  const contents = made[0].webContents;
  assert.deepEqual(contents.loaded, ['https://example.com/']);
  assert.equal(views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url: 'file:///C:/secret.txt' }).ok, false);
  assert.equal(views.handle(page, { op: 'navigate', tab: 'bunny-tab-1', url: 'javascript:alert(1)' }).ok, false);
  assert.equal(views.handle(page, { op: 'open', tab: 'bunny-tab-2', url: 'file:///x' }).ok, false, 'opening with a bad address is refused too');
  assert.deepEqual(contents.loaded, ['https://example.com/']);
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    let stopped = 0;
    contents.emit(event, { preventDefault: () => { stopped += 1; } }, 'file:///C:/secret.txt');
    contents.emit(event, { preventDefault: () => { stopped += 1; } }, 'javascript:alert(1)');
    contents.emit(event, { preventDefault: () => { stopped += 10; } }, 'https://fine.example/');
    assert.equal(stopped, 2, `${event}: the two bad ones are cancelled, the good one is not`);
  }
});

test('W6-24: a window.open from the page becomes a new tab event, never a new app window; a bad address is dropped', () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const contents = made[0].webContents;
  assert.deepEqual(contents.opener({ url: 'https://popup.example/' }), { action: 'deny' });
  assert.deepEqual(page.sent.at(-1), ['browser:view-event', { tab: 'bunny-tab-1', event: 'new-tab', url: 'https://popup.example/' }]);
  const before = page.sent.length;
  assert.deepEqual(contents.opener({ url: 'file:///C:/x' }), { action: 'deny' });
  assert.deepEqual(contents.opener({ url: 'javascript:1' }), { action: 'deny' });
  assert.equal(page.sent.length, before, 'nothing was passed on for them');
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
  assert.equal(view.bounds.x, 0);
  assert.equal(view.visible, false, 'a rect with nothing left of it hides the view');
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 'nonsense', y: NaN, width: Infinity, height: null }, visible: true });
  assert.equal(view.visible, false);
  views.handle(page, { op: 'rect', tab: 'bunny-tab-1', rect: { x: 10, y: 10, width: 300, height: 300 }, visible: false });
  assert.equal(view.visible, false, 'the page can ask for it hidden (a menu is open over it)');
  assert.deepEqual(views.handle(page, { op: 'hideAll' }), { ok: true });
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
  // the stranger's closeAll touches only its own (none)
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
  const events = page.sent.map(([, p]) => p.event);
  assert.deepEqual(events, ['navigated', 'title', 'loading', 'failed']);
  assert.equal(page.sent[0][1].url, 'https://example.com/next');
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
  // a dozen at most
  for (let i = 1; i <= 12; i += 1) assert.equal(views.handle(page, { op: 'open', tab: `bunny-tab-${i}` }).ok, true);
  assert.equal(views.handle(page, { op: 'open', tab: 'bunny-tab-13' }).ok, false);
  views.handle(page, { op: 'closeAll' });
  assert.equal(views.count(), 0);
});

test('W6-24: the model\'s browser actions reach the view: read, click, type, scroll and screenshot; a frame tab is left to the frame code', async () => {
  const { views, made, page } = setup();
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const c = made[0].webContents;
  const read = await views.control(page, 'bunny-tab-1', 'read', {});
  assert.equal(read.page.text, 'hello');
  assert.match(c.scripts[0], /"read"/);
  c.answer = { clicked: true };
  c.scripts.length = 0;
  let step = 0;
  c.executeJavaScript = async (code) => { c.scripts.push(code); step += 1; return step === 1 ? { clicked: true } : { url: 'https://x/', title: 't', text: 'after', elements: [] }; };
  const clicked = await views.control(page, 'bunny-tab-1', 'click', { ref: 7 });
  assert.equal(clicked.note, 'Clicked element 7.');
  assert.match(c.scripts[0], /"click"/);
  assert.match(c.scripts[0], /"ref":7/);
  assert.equal(clicked.page.text, 'after');
  const shot = await views.control(page, 'bunny-tab-1', 'screenshot', {});
  assert.match(shot.image, /^data:image\/png;base64,/);
  assert.equal(await views.control(page, 'bunny-tab-9', 'read', {}), null, 'not a view: the caller falls back to the frame');
  const stranger = Object.assign(new EventEmitter(), { send() {}, getZoomFactor: () => 1 });
  assert.equal(await views.control(stranger, 'bunny-tab-1', 'read', {}), null, 'and another page cannot work this one');
  assert.deepEqual(await views.control(page, 'bunny-tab-1', 'run-script', {}), { error: 'Not a browser action' });
});
