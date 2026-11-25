/**
 * PG1-c: the browser panel enforces the person's website rules on EVERY request of a panel page (frames, scripts, fetch and XHR, images),
 * not only on the address a tab was sent to. An ask on a sub-resource is a block (no card can stop a page mid-load); a top-level page on an
 * ask host loads only right after the person said yes to it. Fake Electron objects, as in browser-views.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBrowserViews } from '../electron/browserViews.js';
import { approveSite, panelAllows, siteApproved } from '../src/server/pgRules.js';

const R = (effect, pattern) => ({ kind: 'domain', effect, pattern });

function setup(getRules) {
  const sessions = new Map();
  const session = { fromPartition: (name) => {
    if (!sessions.has(name)) {
      const ses = new EventEmitter();
      Object.assign(ses, { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest: (fn) => { ses.beforeRequest = fn; } } });
      sessions.set(name, ses);
    }
    return sessions.get(name);
  } };
  class FakeView { constructor() { const c = new EventEmitter(); Object.assign(c, { setWindowOpenHandler() {}, loadURL: async () => {}, getURL: () => '', close() {} }); this.webContents = c; } setBounds() {} setVisible() {} }
  const win = { contentView: { addChildView() {}, removeChildView() {} }, getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) };
  const views = createBrowserViews({ WebContentsView: FakeView, session, getWindow: () => win, getOwnPort: () => '45678', siteAllows: (d) => panelAllows(getRules(), d) });
  const page = Object.assign(new EventEmitter(), { send() {}, getZoomFactor: () => 1, isDestroyed: () => false });
  return { views, page, session };
}
const ask = (ses, details) => new Promise((resolve) => ses.beforeRequest(details, resolve));

test('PG1-c: a page on an allowed host that loads a script, a frame and a fetch from a denied host has all three blocked', async () => {
  const rules = [R('deny', '*.tracker.example')];
  const { views, page, session } = setup(() => rules);
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const ses = session.fromPartition('persist:bunny-browser');
  assert.equal((await ask(ses, { url: 'https://ok.example/page', resourceType: 'mainFrame' })).cancel, false);
  for (const resourceType of ['script', 'subFrame', 'xhr', 'image', 'mainFrame']) {
    assert.equal((await ask(ses, { url: 'https://cdn.tracker.example/x.js', resourceType })).cancel, true, resourceType);
  }
  assert.equal((await ask(ses, { url: 'https://ok.example/app.js', resourceType: 'script' })).cancel, false);
});

test('PG1-c: an ask on a sub-resource is a block; a top-level page on an ask host loads only after the person said yes', async () => {
  const rules = [R('ask', 'news.example')];
  const { views, page, session } = setup(() => rules);
  views.handle(page, { op: 'open', tab: 'bunny-tab-1' });
  const ses = session.fromPartition('persist:bunny-browser');
  assert.equal((await ask(ses, { url: 'https://news.example/', resourceType: 'mainFrame' })).cancel, true, 'no yes yet');
  assert.equal((await ask(ses, { url: 'https://news.example/a.js', resourceType: 'script' })).cancel, true);
  approveSite('news.example'); // what app.js does after the card is answered yes
  assert.equal(siteApproved('news.example'), true);
  assert.equal((await ask(ses, { url: 'https://news.example/', resourceType: 'mainFrame' })).cancel, false);
  assert.equal((await ask(ses, { url: 'https://news.example/a.js', resourceType: 'script' })).cancel, true, 'a sub-resource is still a block');
});

test('PG1-c: an approval runs out, and a deny is never overruled by it', () => {
  const now = 1_000_000;
  approveSite('paste.example', { now, ttl: 1000 });
  assert.equal(siteApproved('paste.example', now + 500), true);
  assert.equal(siteApproved('paste.example', now + 1500), false);
  approveSite('bad.example');
  assert.equal(panelAllows([R('deny', 'bad.example')], { url: 'https://bad.example/', resourceType: 'mainFrame' }), false);
});
