import test from 'node:test';
import assert from 'node:assert/strict';
import { WARNING, IDLE_NOTE, describeAction, everythingDevices, statusParts } from '../src/ui/device-access.js';

// DEVICE-FULL (owner approved Design's drawing, version 5): the words the window's screens use.

test('the warning is Security\'s wording, in full, and the idle note follows it', () => {
  assert.equal(WARNING, "Everything lets this device do anything you can do on this PC: run programs, change settings, read your files and saved keys. The connection is not encrypted, so on a network you don't fully trust, someone could take over this device's access. Give it only on your own home network, to a device you own. Signing the device out stops it, but does not undo what it already did.");
  assert.equal(IDLE_NOTE, 'Everything ends by itself after 30 minutes without use, and when the device signs out or Bunny restarts.');
});

test('the status line names the devices that have Everything: one by name, several as a list, none says nothing extra', () => {
  const dev = (label, level) => ({ id: label, label, level });
  assert.deepEqual(statusParts({ signedIn: 2, devices: [dev("Sam's phone", 'chats'), dev('Laptop', 'chats')] }), { base: 'Open to other devices · 2 signed in', strong: '' });
  assert.deepEqual(statusParts({ signedIn: 2, devices: [dev("Sam's phone", 'everything'), dev('Laptop', 'chats')] }), { base: 'Open to other devices · 2 signed in', strong: "Sam's phone has Everything" });
  assert.deepEqual(statusParts({ signedIn: 3, devices: [dev("Sam's phone", 'everything'), dev('Kitchen laptop', 'everything'), dev('x', 'chats')] }), { base: 'Open to other devices · 3 signed in', strong: "Everything: Sam's phone, Kitchen laptop" });
  assert.equal(statusParts({ signedIn: 1, autoChats: ['a'], devices: [] }, ' (back to Ask when it signs out)').base, 'Open to other devices · 1 signed in · 1 chat on Auto from a device (back to Ask when it signs out)');
  assert.deepEqual(everythingDevices({ devices: [{ level: 'chats' }, { level: 'everything' }] }).length, 1);
});

test('Activity says each entry in the drawing\'s words and never shows a value', () => {
  const at = '2026-11-18T09:12:00.000Z';
  assert.deepEqual(describeAction({ at, kind: 'signin' }).what, 'Signed in');
  assert.deepEqual(describeAction({ at, kind: 'level', level: 'everything' }), { when: describeAction({ at, kind: 'level', level: 'everything' }).when, what: 'Level changed to Everything', note: "By Bunny's window", bad: true });
  assert.equal(describeAction({ at, kind: 'level', level: 'chats' }).bad, false);
  assert.equal(describeAction({ at, kind: 'tool', tool: 'read_file' }).what, 'Tool: read_file');
  assert.equal(describeAction({ at, kind: 'tool', tool: 'run_command' }).bad, true);
  assert.deepEqual([describeAction({ at, kind: 'route', method: 'PUT', path: '/api/settings' }).what, describeAction({ at, kind: 'route', method: 'PUT', path: '/api/settings' }).note], ['Setting changed', 'PUT /api/settings (a setting; no value shown)']);
  assert.equal(describeAction({ at, kind: 'idle-signout', level: 'everything' }).note, 'Ended: 30 minutes idle');
  assert.equal(describeAction({ at, kind: 'idle-signout', level: 'chats' }).note, 'Ended: idle for 2 hours');
  assert.equal(describeAction({ at: 'not a date', kind: 'signin' }).when, '');
});

test('a device page asks the server for its level once; at Everything nothing is locked, at Chats the lock stays; a page that is not a device\'s asks nothing', async () => {
  const { deviceLevel, windowOnlyLocked, resetBrowserMode } = await import('../src/ui/browser-mode.js');
  const doc = { querySelector: (sel) => (sel === 'meta[name="bunny-csrf"]' ? {} : null) };
  const asked = [];
  const server = (level) => async (url) => { asked.push(url); return { json: async () => (url === '/api/remote/me' ? { level } : { windowOnlyLock: true }) }; };
  resetBrowserMode();
  assert.equal(await deviceLevel(server('everything'), { querySelector: () => null }), null, 'not a device page');
  assert.deepEqual(asked, []);
  assert.equal(await deviceLevel(server('everything'), doc), 'everything');
  assert.equal(await deviceLevel(server('chats'), doc), 'everything', 'asked once');
  resetBrowserMode();
  assert.equal(await deviceLevel(server('root'), doc), 'chats', 'anything but Everything is Chats');
  resetBrowserMode();
  assert.equal(await deviceLevel(async () => { throw new Error('offline'); }, doc), null, 'not known: not cached');
  resetBrowserMode();
});

test('only a device changing a setting is announced: the route and method of the log entry, never a value', async () => {
  const { isSettingChange } = await import('../src/ui/device-access.js');
  assert.equal(isSettingChange({ kind: 'route', method: 'PUT', path: '/api/settings' }), true);
  for (const e of [{ kind: 'route', method: 'POST', path: '/api/skills' }, { kind: 'tool', tool: 'read_file' }, { kind: 'level' }, { kind: 'signin' }, null]) assert.equal(isSettingChange(e), false);
});
