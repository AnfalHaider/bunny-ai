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

test('8 and 9: what the bar is told about Bunny\'s looks is cleaned to fixed keys: a theme name, a font key from the list, reduced motion, and a plain model name', async () => {
  const { barLook, BAR_FONT_KEYS } = await import('../electron/quick-ask-logic.js');
  assert.deepEqual(barLook({ theme: 'dark', interfaceFont: 'lexend', motion: 'reduced', model: 'meta/llama-3-70b' }), { theme: 'dark', font: 'lexend', motion: 'reduced', model: 'llama-3-70b' });
  assert.deepEqual(barLook({}), { theme: 'system', font: 'system', motion: '', model: '' });
  assert.deepEqual(barLook(null), { theme: 'system', font: 'system', motion: '', model: '' });
  // anything that is not on the list becomes the safe default: a url, a path, a style, markup
  const evil = barLook({ theme: 'url(http://x)', interfaceFont: '../../secrets/x', motion: '<b>', model: '<img src=x onerror=alert(1)> gpt\nnext' });
  assert.deepEqual([evil.theme, evil.font, evil.motion], ['system', 'system', '']);
  assert.doesNotMatch(evil.model, /[<>\n=()]/);
  assert.ok(evil.model.length <= 60);
  assert.equal(barLook({ model: 'x'.repeat(500) }).model.length, 60);
  // the font keys are the app's own: the four stacks and the thirteen bundled fonts
  assert.deepEqual(BAR_FONT_KEYS.slice(0, 4), ['system', 'serif', 'sans', 'mono']);
  for (const id of ['inter', 'source-sans-3', 'ibm-plex-sans', 'atkinson-hyperlegible', 'lexend', 'nunito', 'quicksand', 'lora', 'literata', 'source-serif-4', 'noto-serif', 'jetbrains-mono', 'ibm-plex-mono']) assert.ok(BAR_FONT_KEYS.includes(id), id);
  assert.equal(BAR_FONT_KEYS.length, 17);
});

test('8 and 9: the bar gets its look through one call that only its own page may make, and a failure gives it nothing (the defaults, and no model line)', async () => {
  const e = fakes();
  createQuickAsk({ ...e, onSubmit: () => true, getSettings: () => ({ theme: 'dark', interfaceFont: 'nunito', model: 'a/b-model', motion: 'reduced', providerKey: 'sk-should-never-travel' }) }).open();
  const win = e.windows[0];
  const init = e.handlers.get('quickask:init');
  assert.deepEqual(await init(fromBar(win)), { theme: 'dark', font: 'nunito', motion: 'reduced', model: 'b-model' });
  assert.deepEqual(await init(stranger), {}, 'not the bar: nothing');
  const e2 = fakes();
  createQuickAsk({ ...e2, onSubmit: () => true, getSettings: () => { throw new Error('settings are not readable'); } }).open();
  assert.deepEqual(await e2.handlers.get('quickask:init')(fromBar(e2.windows[0])), {});
});

test('9: the bar\'s policy allows fonts from its own folder only, and nothing else was loosened; the font files it names exist in the package', async () => {
  const { existsSync } = await import('node:fs');
  const html = await readFile(new URL('../electron/quick-ask/bar.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src 'self'");
  const js = await readFile(new URL('../electron/quick-ask/bar.js', import.meta.url), 'utf8');
  const files = [...js.matchAll(/'([a-z0-9-]+-\d{3}(?:-\d{3})?)'\]/g)].map((m) => m[1]);
  assert.ok(files.length >= 15, `found ${files.length} font files named`);
  for (const f of files) assert.ok(existsSync(new URL(`../src/ui/fonts/${f}.woff2`, import.meta.url)), `${f}.woff2`);
  assert.match(js, /src: url\("\.\.\/\.\.\/src\/ui\/fonts\/\$\{file\}\.woff2"\)/);
  assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/); // the only address in the page is the SVG namespace
});
