import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromOwnFrame } from '../electron/own-ipc.js';

// v0.1.14 LOWs: START-WAIT (the first window does not wait for the network lookup of "open to other devices"), the stale remoteAccess comment, and PREFS-OWN (prefs:set checks the sender).
const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');

test('START-WAIT: the window is created before the resume of "open to other devices" starts, and nothing awaits it', () => {
  const ready = main.slice(main.indexOf('app.whenReady()'));
  assert.ok(ready.length > 100, 'found the ready block');
  assert.doesNotMatch(main, /await\s+resumeOpenToDevices\(/, 'the first window must not wait for the 5 s lookup');
  const create = ready.indexOf('createWindow();');
  const resume = ready.indexOf('void resumeOpenToDevices();');
  assert.ok(create > 0 && resume > create, 'createWindow() comes first, then the resume runs alongside');
  assert.ok(ready.indexOf('startServer()') < create, 'the server is still started before the window');
});

test('START-WAIT: RS-5 still holds: the tray text is synced when the resume ends and every 5 s, and says "open" only when access is open; the notification is only for a real resume', () => {
  const fn = /async function resumeOpenToDevices\(\) \{([\s\S]*?)\n\}/.exec(main)[1];
  assert.match(fn, /bunnyApp\.resumeRemote\(\)/);
  assert.match(fn, /if \(result\.resumed\) new Notification/); // "open" is said only after it is open
  assert.match(fn, /syncTrayTooltip\(\);\s*$/); // the tray follows when it ends
  assert.match(main, /const syncTrayTooltip = .*trayTooltip\(bunnyApp\?\.remote\?\.enabled, trayEvent\)/); // the text follows the real state (words in electron/tray-words.js: 'Bunny AI: Open to other devices' when open, 'Bunny AI' when not)
  assert.match(main, /setInterval\(syncTrayTooltip, 5000\)/);
});

test('START-WAIT: the page asks for the banner every second for its first 15 s, then every 10 s, so it shows as soon as access is really open', async () => {
  const chat = await readFile(new URL('../src/ui/chat.js', import.meta.url), 'utf8');
  const watch = chat.slice(chat.indexOf('function watchRemote()'));
  assert.match(watch, /setTimeout\(loop, looks <= 15 \? 1000 : 10000\)/); // one second for the first 15 looks, then every 10 s
  assert.match(watch, /getJSON\('\/api\/remote'\)/, 'what it shows is what the server says is open, never a guess');
});

test('the comment on remoteAccess "on" says what it now does (resumed at start by resumeRemote, nothing about sessions kept)', async () => {
  const src = await readFile(new URL('../src/server/remoteAccess.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /never read back from a file/);
  assert.match(src, /let on = false;\s+\/\/ whether access is open right now: it starts OFF, and is turned on again at start only by resumeRemote\(\)/);
});

test('PREFS-OWN: fromOwnFrame is true only for a frame of Bunny\'s own page', () => {
  const isOwn = (url) => /^http:\/\/127\.0\.0\.1:5173\/(index|settings)\.html/.test(url);
  assert.equal(fromOwnFrame({ senderFrame: { url: 'http://127.0.0.1:5173/index.html?s=1' } }, isOwn), true);
  assert.equal(fromOwnFrame({ senderFrame: { url: 'https://example.com/' } }, isOwn), false);
  assert.equal(fromOwnFrame({ senderFrame: { url: 'file:///C:/x/electron/quick-ask/bar.html' } }, isOwn), false);
  assert.equal(fromOwnFrame({ senderFrame: {} }, isOwn), false);
  assert.equal(fromOwnFrame({}, isOwn), false);
  assert.equal(fromOwnFrame(null, isOwn), false);
  assert.equal(fromOwnFrame({ senderFrame: { url: 'http://127.0.0.1:5173/index.html' } }, () => { throw new Error('boom'); }), false, 'a check that throws is a no');
});

test('PREFS-OWN: prefs:set refuses a stranger before it reads or changes anything, like theme:set and app:open-browser', () => {
  const start = main.indexOf("ipcMain.handle('prefs:set'");
  const body = main.slice(start, main.indexOf("\nipcMain.handle(", start + 10));
  const first = body.indexOf('fromOwnFrame(event, isOwn)');
  assert.ok(first > 0, 'the handler checks the sender');
  for (const touch of ['patch', 'applyTrayRule', 'savePrefs', 'prefs']) {
    const at = body.indexOf(touch, body.indexOf('=> {'));
    assert.ok(at === -1 || at > first, `${touch} is not used before the check`);
  }
  assert.match(body.slice(first, first + 120), /return \{ ok: false, error: 'Not allowed' \}/);
  // the two that already did it are unchanged
  assert.match(main, /ipcMain\.handle\('theme:set', \(event, theme\) => \{\s*if \(!isOwn\(event\.senderFrame\?\.url \?\? ''\)/);
  assert.match(main, /ipcMain\.handle\('app:open-browser', \(event\) => \(isOwn\(event\.senderFrame\?\.url \?\? ''\)/);
});
