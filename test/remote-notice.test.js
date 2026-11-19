import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_HIDE_MS, bannerReturns, bannerText, chipText } from '../src/ui/remote-notice.js';

// BANNER-NOTICE (Design's drawing v3, Security's BN-1 to BN-5): the words and the rules for when the notification comes back.
const dev = (id, label, level = 'chats') => ({ id, label, level });
const open = (devices = [], extra = {}) => ({ enabled: true, signedIn: devices.length, devices, ...extra });

test('the chip says the state in words: Open to devices · N, and in the warning colour who has Everything (one by name, several as a count); a narrow window gets the short form', () => {
  assert.deepEqual(chipText(open()), { text: 'Open to devices', short: 'Open', bad: false });
  assert.deepEqual(chipText(open([dev('a', 'Pixel 8')])), { text: 'Open to devices · 1', short: 'Open · 1', bad: false });
  assert.deepEqual(chipText(open([dev('a', 'Pixel 8', 'everything')])), { text: 'Pixel 8 has Everything', short: 'Everything', bad: true });
  assert.deepEqual(chipText(open([dev('a', 'Pixel 8', 'everything'), dev('b', 'Tablet', 'everything'), dev('c', 'TV')])), { text: 'Everything: 2 devices', short: 'Everything', bad: true });
});

test('the notification says what it is: plain when nobody has Everything, red and in words when a device does', () => {
  assert.deepEqual(bannerText(open()), { title: 'Open to other devices', message: 'No device is signed in yet.', bad: false });
  assert.deepEqual(bannerText(open([dev('a', 'Pixel 8')])), { title: 'Open to other devices · 1 signed in', message: 'Pixel 8 signed in. It works as Chats. Change this in Settings.', bad: false });
  assert.deepEqual(bannerText(open([dev('a', 'Pixel 8', 'everything')])), { title: 'Pixel 8 has Everything', message: 'It can run programs and change settings. Ends after 30 minutes idle.', bad: true });
  assert.equal(bannerText(open([dev('a', 'A', 'everything'), dev('b', 'B', 'everything')])).title, 'Everything: 2 devices');
});

test('BN-3: the notification comes back at the first look, when access is turned on or reopened, when a device signs in, and when a device is newly at Everything; not otherwise, and never while access is off', () => {
  const one = open([dev('a', 'Pixel 8')]);
  assert.equal(bannerReturns(null, one), true, 'the window started or reloaded');
  assert.equal(bannerReturns({ enabled: false }, one), true, 'access turned on, or reopened at start');
  assert.equal(bannerReturns(one, open([dev('a', 'Pixel 8'), dev('b', 'Tablet')])), true, 'a device signed in');
  assert.equal(bannerReturns(one, open([dev('a', 'Pixel 8', 'everything')])), true, 'raised to Everything');
  assert.equal(bannerReturns(one, one), false, 'nothing new');
  assert.equal(bannerReturns(open([dev('a', 'Pixel 8', 'everything')]), open([dev('a', 'Pixel 8', 'everything')])), false, 'still the same Everything');
  assert.equal(bannerReturns(open([dev('a', 'Pixel 8'), dev('b', 'Tablet')]), one), false, 'a device signed out');
  assert.equal(bannerReturns(open([dev('a', 'Pixel 8', 'everything')]), one), false, 'back to Chats');
  assert.equal(bannerReturns(one, { enabled: false }), false);
  assert.equal(bannerReturns(null, null), false);
});

test('the plain banner hides itself after 10 seconds (Design\'s choice; Security left the time to Design)', () => {
  assert.equal(AUTO_HIDE_MS, 10_000);
});

test('BN-4 and BN-5: the notice code stores nothing and calls no new route: no localStorage, sessionStorage, cookie or setting, and no write beyond the window\'s own existing controls', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/ui/remote-notice.js', 'src/ui/remote.js']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ''), /localStorage|sessionStorage|document\.cookie|indexedDB|sendJSON|PUT|POST/, file + ' keeps a dismissal nowhere and sends nothing');
  }
});
