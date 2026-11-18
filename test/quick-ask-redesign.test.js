import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { barWindowOptions, createQuickAsk, MIN_BAR_HEIGHT, MAX_BAR_HEIGHT } from '../electron/quick-ask.js';

// QUICK-UI (v0.1.13): the main-process side of the redesign, with stand-ins for Electron.
function fakes() {
  const handlers = new Map();
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.destroyed = false;
      this.sent = [];
      this.inputHandlers = [];
      const self = this;
      this.webContents = {
        setWindowOpenHandler() {}, on(name, fn) { if (name === 'before-input-event') self.inputHandlers.push(fn); }, focus() {},
        session: { setPermissionRequestHandler() {} },
        send(channel, payload) { self.sent.push([channel, payload]); },
      };
      this.listeners = {};
      windows.push(this);
    }
    on(name, fn) { this.listeners[name] = fn; }
    once(name, fn) { this.listeners[name] = fn; }
    setAlwaysOnTop() {} loadFile() {} show() {} hide() {} focus() {}
    setBounds(b) { this.bounds = { ...this.bounds, ...b }; }
    getBounds() { return this.bounds; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const screen = { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, id: 1 }) };
  return { handlers, windows, BrowserWindow: FakeWindow, screen, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, globalShortcut: { register: () => true, unregister: () => {} }, desktopCapturer: {} };
}
const fromBar = (win) => ({ sender: win.webContents, senderFrame: { url: 'file:///C:/app/electron/quick-ask/bar.html' } });
const stranger = { sender: {}, senderFrame: { url: 'file:///C:/app/electron/quick-ask/bar.html' } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (win) => { let prevented = false; for (const fn of win.inputHandlers) fn({ preventDefault: () => { prevented = true; } }, { type: 'keyDown', key: 'Escape' }); return prevented; };

test('2: the window is 640 wide and starts as tall as the pill (80), and grows no further than 560', () => {
  const o = barWindowOptions('/x/preload.cjs');
  assert.equal(o.width, 640);
  assert.equal(o.height, 80);
  assert.equal(MIN_BAR_HEIGHT, 80);
  assert.equal(MAX_BAR_HEIGHT, 560);
  assert.equal(o.transparent, true, 'option A: a ~92% opaque pill over a transparent window, not acrylic');
  assert.equal(o.backgroundMaterial, undefined, 'no acrylic');
});

test('2: the page asks for a height and gets exactly that, within 80 and 560 and the screen; a stranger gets nothing', async () => {
  const e = fakes();
  const qa = createQuickAsk({ ...e, onSubmit: () => true });
  qa.open();
  const win = e.windows[0];
  const resize = e.handlers.get('quickask:resize');
  assert.deepEqual(await resize(fromBar(win), 70), { ok: true, height: 80 }, 'never below the pill');
  assert.deepEqual(await resize(fromBar(win), 133), { ok: true, height: 133 });
  assert.equal(win.bounds.height, 133);
  assert.deepEqual(await resize(fromBar(win), 5000), { ok: true, height: 560 });
  assert.equal((await resize(stranger, 200)).ok, false);
  assert.equal(win.bounds.height, 560);
});

test('3: Esc is sent to the page to decide; a page that handled it keeps the bar open, a page that closes it closes it, a stuck page closes it by itself', async () => {
  const e = fakes();
  const qa = createQuickAsk({ ...e, onSubmit: () => true });
  qa.open();
  const win = e.windows[0];
  // the main process still takes the key (the page cannot stop it), and passes it on
  assert.equal(esc(win), true);
  assert.deepEqual(win.sent.at(-1), ['quickask:esc', undefined]);
  assert.equal(win.destroyed, false, 'the bar is not closed by the key itself');
  // the page dealt with it (closed the menu, stopped an answer): the bar stays
  assert.equal((await e.handlers.get('quickask:escHandled')(fromBar(win))).ok, true);
  await wait(750);
  assert.equal(win.destroyed, false, 'still open after the page said it handled Esc');
  // nothing to handle: the page closes the bar
  esc(win);
  assert.equal((await e.handlers.get('quickask:close')(fromBar(win))).ok, true);
  assert.equal(win.destroyed, true);
});

test('3: an Esc the page never answers closes the bar after a moment (so Esc can always close it)', async () => {
  const e = fakes();
  createQuickAsk({ ...e, onSubmit: () => true }).open();
  const win = e.windows[0];
  esc(win);
  assert.equal(win.destroyed, false);
  await wait(750);
  assert.equal(win.destroyed, true);
});

test('3: only the bar\'s own page can say "handled" or "close"; anything else changes nothing', async () => {
  const e = fakes();
  createQuickAsk({ ...e, onSubmit: () => true }).open();
  const win = e.windows[0];
  esc(win);
  await e.handlers.get('quickask:escHandled')(stranger); // not the bar: the timer keeps running
  assert.deepEqual(await e.handlers.get('quickask:close')(stranger), { ok: false });
  assert.equal(win.destroyed, false);
  await wait(750);
  assert.equal(win.destroyed, true, 'a stranger could not stop the bar from closing');
});

test('3: the bridge lists exactly the functions the redesign needs, and the page listens to the answer and to Esc only', async () => {
  const src = await readFile(new URL('../electron/quick-ask/preload.cjs', import.meta.url), 'utf8');
  const bridge = /exposeInMainWorld\('quickAsk', \{([\s\S]*?)\}\);/.exec(src)[1];
  const names = [...bridge.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.ok(names.includes('close') && names.includes('escHandled') && names.includes('onEscape'));
  assert.doesNotMatch(src, /ipcRenderer\.(send|once)\b|require\((?!'electron')/);
  const listened = [...src.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(listened.every((l) => ['quickask:answer', 'quickask:esc'].includes(l)), listened.join(','));
});
