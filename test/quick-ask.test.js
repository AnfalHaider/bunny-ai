import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SHORTCUT, MAX_IMAGE_BYTES as MAX_SHOT_BYTES, MAX_TEXT, applyTrayRule, buildNewChatRequest, validateAccelerator, validateSubmission } from '../electron/quick-ask-logic.js';
import { barWindowOptions, createQuickAsk } from '../electron/quick-ask.js';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngUrl = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
const smallPng = () => pngUrl(Buffer.concat([PNG_HEAD, Buffer.from('invented picture bytes')]));

test('accelerator: the default is valid and spelled the way Electron wants', () => {
  assert.deepEqual(validateAccelerator(DEFAULT_SHORTCUT), { ok: true, accelerator: 'Ctrl+Alt+Space' });
  assert.equal(validateAccelerator('control + alt + space').accelerator, 'Ctrl+Alt+Space');
  assert.equal(validateAccelerator('Win+Shift+k').accelerator, 'Shift+Super+K');
  assert.equal(validateAccelerator('alt+f9').accelerator, 'Alt+F9');
});

test('accelerator: empty, bare, unknown and double-key shortcuts are refused with a plain message', () => {
  for (const bad of ['', '   ', null, undefined, 42, 'Space', 'K', 'Shift+K', 'Ctrl+', '+Ctrl+K', 'Ctrl+Alt', 'Ctrl+K+L', 'Ctrl+Escape', 'Ctrl+Banana', 'Ctrl+F25', 'x'.repeat(60)]) {
    const r = validateAccelerator(bad);
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.message && /^[A-Z]/.test(r.message), String(bad));
  }
  assert.equal(validateAccelerator('Shift+K').message, 'Use Ctrl, Alt or Win with another key');
});

test('tray rule: turning Quick ask on turns the tray on, with a note', () => {
  const r = applyTrayRule({ closeToTray: false, quickAskEnabled: false }, { quickAskEnabled: true });
  assert.equal(r.prefs.closeToTray, true);
  assert.equal(r.prefs.quickAskEnabled, true);
  assert.match(r.note, /tray/);
});

test('tray rule: turning the tray off turns Quick ask off, with a note saying why', () => {
  const r = applyTrayRule({ closeToTray: true, quickAskEnabled: true }, { closeToTray: false });
  assert.equal(r.prefs.closeToTray, false);
  assert.equal(r.prefs.quickAskEnabled, false);
  assert.match(r.note, /Quick ask is off because it needs Bunny to keep running in the tray/);
});

test('tray rule: turning the tray off when Quick ask is already off says nothing; unrelated changes pass through', () => {
  assert.equal(applyTrayRule({ closeToTray: true, quickAskEnabled: false }, { closeToTray: false }).note, null);
  const r = applyTrayRule({ closeToTray: true, quickAskEnabled: true, launchAtLogin: true }, { quickAskShortcut: 'Ctrl+Alt+B' });
  assert.deepEqual(r.prefs, { closeToTray: true, quickAskEnabled: true, launchAtLogin: true, quickAskShortcut: 'Ctrl+Alt+B' });
  assert.equal(r.note, null);
});

test('submission: text limits', () => {
  assert.equal(validateSubmission('  hello  ', []).text, 'hello');
  for (const bad of ['', '   ', null, 5, {}]) assert.equal(validateSubmission(bad, []).ok, false);
  assert.equal(validateSubmission('a'.repeat(MAX_TEXT), []).ok, true);
  assert.equal(validateSubmission('a'.repeat(MAX_TEXT + 1), []).ok, false);
});

test('submission: one PNG screenshot at most, a real PNG, and at most 3 MB (what the chat accepts)', () => {
  const ok = validateSubmission('what is this?', [{ data: smallPng() }]);
  assert.equal(ok.ok, true);
  assert.ok(Buffer.isBuffer(ok.shot));
  assert.equal(validateSubmission('x', [{ data: smallPng() }, { data: smallPng() }]).ok, false);
  assert.equal(validateSubmission('x', 'nope').ok, false);
  assert.equal(validateSubmission('x', [{ data: 'data:image/jpeg;base64,AAAA' }]).ok, false);
  assert.equal(validateSubmission('x', [{ data: 'javascript:alert(1)' }]).ok, false);
  assert.equal(validateSubmission('x', [{ data: pngUrl(Buffer.from('not a png at all')) }]).ok, false);
  const exact = Buffer.concat([PNG_HEAD, Buffer.alloc(MAX_SHOT_BYTES - PNG_HEAD.length)]);
  assert.equal(validateSubmission('x', [{ data: pngUrl(exact) }]).ok, true);
  const big = Buffer.concat([PNG_HEAD, Buffer.alloc(MAX_SHOT_BYTES)]);
  assert.equal(validateSubmission('x', [{ data: pngUrl(big) }]).ok, false);
});

test('new chat request: Chat mode, no folder, text as plain data, the screenshot as an ordinary image attachment', () => {
  const none = buildNewChatRequest('hi <b>there</b>', null);
  assert.deepEqual(none, { text: 'hi <b>there</b>', workMode: 'chat', folder: null, files: [] });
  const shot = Buffer.concat([PNG_HEAD, Buffer.from('x')]);
  const withShot = buildNewChatRequest('look', shot);
  assert.equal(withShot.files.length, 1);
  assert.deepEqual({ ...withShot.files[0], data: undefined }, { name: 'Screenshot.png', mime: 'image/png', kind: 'image', data: undefined, size: shot.length });
  assert.equal(withShot.files[0].data, pngUrl(shot));
});

test('structure: the bar preload exposes exactly these functions (submit, the screenshot, one file, dropping it, ask, stop, open in Bunny, resize, hear the answer) and nothing else', async () => {
  const src = await readFile(new URL('../electron/quick-ask/preload.cjs', import.meta.url), 'utf8');
  const bridge = /exposeInMainWorld\('quickAsk', \{([\s\S]*?)\}\);/.exec(src)[1];
  const names = [...bridge.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(names, ['submit', 'captureScreenshot', 'pickFile', 'ask', 'stop', 'openInBunny', 'resize', 'onAnswer', 'dropFile']);
  assert.equal((src.match(/exposeInMainWorld/g) ?? []).length, 1);
  assert.doesNotMatch(src, /ipcRenderer\.(send|once)\b|require\((?!'electron')/);
  // the one thing that may arrive from main is the plain answer, and nothing else is listened to
  const listened = [...src.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listened, ['quickask:answer']);
});

test('structure: the bar window is frameless, transparent, always on top, and secure', () => {
  const o = barWindowOptions('/x/preload.cjs');
  assert.equal(o.frame, false);
  assert.equal(o.transparent, true);
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.show, false);
  assert.equal(o.skipTaskbar, true);
  assert.deepEqual(
    { c: o.webPreferences.contextIsolation, n: o.webPreferences.nodeIntegration, s: o.webPreferences.sandbox, w: o.webPreferences.webSecurity },
    { c: true, n: false, s: true, w: true },
  );
});

test('structure: the bar page has no remote content, a strict policy, and never builds HTML from text', async () => {
  const html = await readFile(new URL('../electron/quick-ask/bar.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../electron/quick-ask/bar.js', import.meta.url), 'utf8');
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.doesNotMatch(html, /(src|href)\s*=\s*"https?:/i);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|window\.open|location\s*=/);
  const main = await readFile(new URL('../electron/quick-ask.js', import.meta.url), 'utf8');
  for (const needle of ['setWindowOpenHandler', "'will-navigate'", 'preventDefault', 'setPermissionRequestHandler', 'fromBar(event)']) assert.ok(main.includes(needle), needle);
});

/** A stand-in for the parts of Electron the controller touches. */
function fakeElectron({ takenBy = null } = {}) {
  const registered = new Map();
  const handlers = new Map();
  return {
    registered,
    handlers,
    globalShortcut: {
      register: (acc, fn) => { if (takenBy === acc || registered.has(acc)) return false; registered.set(acc, fn); return true; },
      unregister: (acc) => registered.delete(acc),
    },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: class {},
    screen: {},
    desktopCapturer: {},
  };
}

test('controller: registers, switches and turns off the shortcut; a taken shortcut is refused with the plain message', () => {
  const e = fakeElectron({ takenBy: 'Ctrl+Alt+B' });
  const qa = createQuickAsk({ ...e, onSubmit: () => true });
  assert.equal(qa.enable('Ctrl+Alt+Space').ok, true);
  assert.deepEqual([...e.registered.keys()], ['Ctrl+Alt+Space']);
  const taken = qa.enable('ctrl+alt+b');
  assert.deepEqual(taken, { ok: false, message: 'That shortcut is already used by another app' });
  assert.deepEqual([...e.registered.keys()], ['Ctrl+Alt+Space'], 'the working shortcut stays');
  assert.equal(qa.enable('').ok, false);
  assert.equal(qa.enable('Ctrl+Alt+J').ok, true);
  assert.deepEqual([...e.registered.keys()], ['Ctrl+Alt+J'], 'the old one is released');
  qa.disable();
  assert.equal(e.registered.size, 0);
  assert.equal(qa.isEnabled(), false);
});

test('controller: submit and capture from anything but the bar are refused', async () => {
  const e = fakeElectron();
  let called = false;
  createQuickAsk({ ...e, onSubmit: () => { called = true; return true; } });
  const stranger = { sender: {}, senderFrame: { url: 'http://127.0.0.1:1/src/ui/index.html' } };
  assert.equal((await e.handlers.get('quickask:submit')(stranger, 'hi', [])).ok, false);
  assert.equal((await e.handlers.get('quickask:capture')(stranger)).ok, false);
  assert.equal(called, false);
});

test('wiring: main.js and the Settings page use the quick-ask pieces and the settings keys are named', async () => {
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  for (const needle of ['createQuickAsk(', 'applyTrayRule(', "globalShortcut.unregisterAll", "'quickask:take'", 'quickAskEnabled', 'quickAskShortcut']) assert.ok(main.includes(needle), needle);
  const settings = await readFile(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
  assert.ok(settings.includes('id="quick-ask"') && settings.includes('quickAskShortcut'));
});

test('window-only: quickAskEnabled and quickAskShortcut are window-only settings once the W5-7 list exists', async () => {
  const file = new URL('../src/server/windowOnly.js', import.meta.url);
  if (!existsSync(file)) return; // W5-7 is not in this branch's base; the keys are held by the desktop shell (IPC) instead
  const { WINDOW_ONLY_SETTING_KEYS, isWindowOnlyRoute } = await import(file.href);
  for (const key of ['quickAskEnabled', 'quickAskShortcut']) {
    assert.ok(WINDOW_ONLY_SETTING_KEYS.includes(key), key);
    assert.equal(isWindowOnlyRoute('PUT', '/api/settings', { [key]: true }), true, key);
  }
});
