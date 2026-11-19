import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipText, chipView, eventText, newEvents, shownEvents } from '../src/ui/remote-notice.js';
import { cleanTrayEvent, trayTooltip } from '../electron/tray-words.js';

// BANNER-NOTICE (the owner: no banner anywhere; Security's BN-6 to BN-9): the chip's words, and which things count as new.
const dev = (id, label, level = 'chats') => ({ id, label, level });
const open = (devices = [], extra = {}) => ({ enabled: true, signedIn: devices.length, devices, ...extra });

test('BN-6: the chip says the state in words: Open to devices · N, and in the warning colour who has Everything (one by name, several as a count); a narrow window gets the short words', () => {
  assert.deepEqual(chipText(open()), { text: 'Open to devices', short: 'Open', bad: false });
  assert.deepEqual(chipText(open([dev('a', 'Pixel 8')])), { text: 'Open to devices · 1', short: 'Open · 1', bad: false });
  assert.deepEqual(chipText(open([dev('a', 'Pixel 8', 'everything')])), { text: 'Pixel 8 has Everything', short: 'Everything', bad: true });
  assert.equal(chipText(open([dev('a', 'Pixel 8', 'everything'), dev('b', 'Tablet', 'everything'), dev('c', 'TV')])).text, 'Everything: 2 devices');
});

test('BN-7: a new sign-in, a device raised to Everything and a setting change each have words; the newest event wins and a count says how many wait', () => {
  assert.deepEqual(eventText({ kind: 'signin', label: 'Pixel 8' }), { text: 'New: Pixel 8 signed in', short: 'New sign-in', bad: false });
  assert.equal(eventText({ kind: 'everything', label: 'Pixel 8' }).text, 'Pixel 8 has Everything');
  assert.deepEqual(eventText({ kind: 'setting', label: 'Pixel 8' }), { text: 'Pixel 8 changed a setting', short: 'Setting changed', bad: true });
  const st = open([dev('a', 'Pixel 8')]);
  assert.equal(chipView(st, []).count, 0);
  assert.equal(chipView(st, []).text, 'Open to devices · 1', 'nothing waits: the state words');
  const two = chipView(st, [{ kind: 'setting', label: 'Pixel 8' }, { kind: 'setting', label: 'Pixel 8' }]);
  assert.equal(two.count, 2);
  assert.equal(two.text, 'Pixel 8 changed a setting');
  assert.equal(chipView(open([dev('a', 'Pixel 8', 'everything')]), [{ kind: 'signin', label: 'Tablet' }]).bad, true, 'a device at Everything keeps the chip in the warning colour');
});

test('BN-7: what is new is found by device id (BN-L1), never at the first look or when access has just turned on; nothing for a sign-out or a drop back to Chats', () => {
  const one = open([dev('a', 'Pixel 8')]);
  assert.deepEqual(newEvents(null, one), [], 'the first look: the state words');
  assert.deepEqual(newEvents({ enabled: false }, one), [], 'access just turned on');
  assert.deepEqual(newEvents(one, open([dev('a', 'Pixel 8'), dev('b', 'Tablet')])), [{ kind: 'signin', device: 'b', label: 'Tablet' }]);
  assert.deepEqual(newEvents(one, open([dev('a', 'Pixel 8', 'everything')])), [{ kind: 'everything', device: 'a', label: 'Pixel 8' }]);
  // BN-L1: one signs out and another signs in between two looks: the count is the same, the event still comes
  assert.deepEqual(newEvents(one, open([dev('b', 'Tablet')])), [{ kind: 'signin', device: 'b', label: 'Tablet' }]);
  assert.equal(newEvents(open([dev('a', 'Pixel 8'), dev('b', 'Tablet')]), open([dev('b', 'Tablet'), dev('c', 'TV')])).length, 1, 'one out, one in');
  assert.deepEqual(newEvents(one, one), []);
  assert.deepEqual(newEvents(open([dev('a', 'Pixel 8', 'everything')]), open([dev('a', 'Pixel 8', 'everything')])), [], 'still the same Everything');
  assert.deepEqual(newEvents(open([dev('a', 'Pixel 8'), dev('b', 'Tablet')]), one), [], 'a device signed out');
  assert.deepEqual(newEvents(open([dev('a', 'Pixel 8', 'everything')]), one), [], 'back to Chats');
  assert.deepEqual(newEvents(one, { enabled: false }), []);
  const both = newEvents(one, open([dev('a', 'Pixel 8', 'everything'), dev('b', 'Tablet', 'everything')]));
  assert.equal(both.length, 3, 'a raise, and a new device that arrives already at Everything: a sign-in and an Everything');
});

test('BN-4 and BN-5: the chip code stores nothing and calls no route: no localStorage, sessionStorage, cookie or setting, no write; and no notice element exists anywhere in the UI code', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/ui/remote-notice.js', 'src/ui/remote.js']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /localStorage|sessionStorage|document\.cookie|indexedDB|sendJSON|PUT|POST/, file + ' stores nothing and writes nothing');
  }
  for (const file of ['src/ui/remote-notice.js', 'src/ui/remote.js', 'src/ui/chat.js', 'src/ui/device-access.js', 'src/ui/app.css']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /remote-note|device-note|device-notice|settingNotice|paintNote/, file + ' has no notice');
  }
});

test('BN-7 hook for OPEN-SIGNIN: the internet shut-off is an event made from the saved shutoffAt, shown even with access closed, and cleared for a page only by a click on that page', () => {
  assert.equal(eventText({ kind: 'shutoff' }).text, 'Closed to the internet: too many wrong passcodes');
  assert.equal(eventText({ kind: 'shutoff' }).bad, true);
  const closed = { enabled: false, shutoffAt: '2026-11-19T10:00:00.000Z' };
  assert.deepEqual(shownEvents(closed, []), [{ kind: 'shutoff' }]);
  assert.deepEqual(shownEvents(closed, [], true), [], 'clicked on this page');
  assert.deepEqual(shownEvents({ enabled: true }, []), [], 'no saved shut-off, nothing to show');
  assert.equal(shownEvents(closed, [{ kind: 'signin', label: 'A' }]).at(-1).kind, 'shutoff', 'the shut-off is the one the chip says');
  assert.equal(chipView(closed, [{ kind: 'shutoff' }]).text, 'Closed to the internet: too many wrong passcodes');
});

test('the tray tooltip mirrors the chip: fixed words made in the shell from a kind and a cleaned device name; a page cannot put its own sentence there', () => {
  assert.equal(trayTooltip(true, null), 'Bunny AI: Open to other devices');
  assert.equal(trayTooltip(false, null), 'Bunny AI');
  assert.equal(trayTooltip(true, cleanTrayEvent({ kind: 'signin', label: 'Pixel 8' })), 'Bunny AI: Open to other devices · New: Pixel 8 signed in');
  assert.equal(trayTooltip(true, cleanTrayEvent({ kind: 'setting', label: 'Pixel 8' })), 'Bunny AI: Open to other devices · Pixel 8 changed a setting');
  assert.equal(trayTooltip(false, cleanTrayEvent({ kind: 'shutoff' })), 'Bunny AI · Closed to the internet: too many wrong passcodes');
  assert.equal(cleanTrayEvent({ kind: 'run-this', label: 'x' }), null, 'a kind outside the list is dropped');
  assert.equal(cleanTrayEvent('text'), null);
  assert.equal(cleanTrayEvent(null), null);
  const dirty = cleanTrayEvent({ kind: 'signin', label: ['Pi', 'xel', ' 8'].join(String.fromCharCode(10, 0x202e)).padEnd(80, 'x') });
  assert.ok(dirty.label.length <= 40, 'cut to 40');
  assert.ok(!dirty.label.includes(String.fromCharCode(10)) && !dirty.label.includes(String.fromCharCode(0x202e)), 'control and bidi characters gone');
  assert.equal(cleanTrayEvent({ kind: 'signin', label: 5 }).label, 'A device');
  assert.equal(cleanTrayEvent({ kind: 'signin', label: 'Pixel', text: 'extra' }).text, undefined, 'only fixed fields');
});

test('the tray IPC is window-only: the handler checks isOwn first, the preload sends only a kind and a label', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /ipcMain\.handle\('remote:tray-event', \(event, raw\) => \{[^]*?if \(!isOwn\(event\.senderFrame\?\.url \?\? ''\)\) return \{ ok: false \};[^]*?cleanTrayEvent\(raw\)/);
  const pre = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(pre, /setRemoteEvent: \(event\) => ipcRenderer\.invoke\('remote:tray-event', event && typeof event === 'object' \? \{ kind: event\.kind, label: event\.label \} : null\)/);
});
