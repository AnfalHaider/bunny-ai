import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { FIXED_PORT_MAX, FIXED_PORT_MIN, browserAddress, listenWithFallback, randomPort, validPort, wantedPort } from '../electron/browser-access.js';

// BROWSER step 1: Bunny in the person's own browser, this computer only.
const close = (s) => new Promise((r) => s.close(r));

test('the port: any free one normally; the stored fixed one when "Keep the same address" is on; a new one in the fixed range when none is stored', () => {
  assert.equal(wantedPort({ keepAddress: false, fixedPort: 50000 }), 0);
  assert.equal(wantedPort({}), 0);
  assert.equal(wantedPort({ keepAddress: true, fixedPort: 50000 }), 50000);
  const fresh = wantedPort({ keepAddress: true, fixedPort: null }, () => 0.5);
  assert.ok(validPort(fresh) && fresh >= FIXED_PORT_MIN && fresh <= FIXED_PORT_MAX);
  for (const bad of [80, 1023, 65001, 'x', 1.5, NaN, null]) assert.equal(validPort(bad), false, String(bad));
  assert.equal(wantedPort({ keepAddress: true, fixedPort: 80 }, () => 0), FIXED_PORT_MIN, 'a stored port outside the range is not trusted');
  assert.equal(randomPort(() => 0.999999), FIXED_PORT_MAX);
});

test('listening: always 127.0.0.1; the fixed port is kept when free; when another program has it, a free port is used and the person is told', async (t) => {
  const first = createServer();
  const got = await listenWithFallback(first, '127.0.0.1', 0);
  t.after(() => close(first));
  assert.equal(first.address().address, '127.0.0.1');
  assert.equal(got.note, '');
  // someone else holds a port: asking for it falls back with a note
  const taken = createServer();
  await listenWithFallback(taken, '127.0.0.1', 0);
  t.after(() => close(taken));
  const wanted = taken.address().port;
  const second = createServer();
  const fell = await listenWithFallback(second, '127.0.0.1', wanted);
  t.after(() => close(second));
  assert.notEqual(fell.port, wanted);
  assert.equal(fell.fixed, false);
  assert.match(fell.note, new RegExp(`port ${wanted}\\) is used by another program`));
  assert.equal(second.address().address, '127.0.0.1');
  // the fixed port is used when it is free
  const free = createServer();
  const freePort = (await (async () => { const s = createServer(); await listenWithFallback(s, '127.0.0.1', 0); const p = s.address().port; await close(s); return p; })());
  const kept = await listenWithFallback(free, '127.0.0.1', freePort);
  t.after(() => close(free));
  assert.deepEqual([kept.port, kept.fixed, kept.note], [freePort, true, '']);
});

test('"Open in your browser" opens only this server\'s own address on 127.0.0.1: no path, no query, no token', () => {
  assert.equal(browserAddress('http://127.0.0.1:51234'), 'http://127.0.0.1:51234/');
  assert.equal(browserAddress('http://127.0.0.1:51234/src/ui/index.html?token=abc#x'), 'http://127.0.0.1:51234/');
  for (const bad of ['https://127.0.0.1:51234', 'http://localhost:51234', 'http://192.168.1.5:51234', 'http://127.0.0.1', 'file:///C:/x', 'javascript:1', '', null, undefined, 'x']) assert.equal(browserAddress(bad), null, String(bad));
});

test('the shell wires it: a button and a tray item, only a Bunny page may ask, nothing is taken from the page, and the server keeps 127.0.0.1', async () => {
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /label: 'Open in your browser', click: openInBrowser/);
  assert.match(main, /ipcMain\.handle\('app:open-browser', \(event\) => \(isOwn\(event\.senderFrame\?\.url \?\? ''\)/);
  assert.match(main, /listenWithFallback\(bunny\.server, '127\.0\.0\.1', wantedPort\(prefs\)\)/);
  assert.match(main, /shell\.openExternal\(url\)/);
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /openInBrowser: \(\) => ipcRenderer\.invoke\('app:open-browser'\)\)?/);
  assert.doesNotMatch(preload, /app:open-browser'[^)]*,\s*\w/, 'no argument goes with it');
  const page = await readFile(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
  assert.match(page, /Use Bunny in a browser/);
  assert.match(page, /Keep the same address after restart/);
});

test('/api/health says whether window-only changes are kept to the window', async (t) => {
  const { startApp } = await import('./helpers.js');
  const started = await startApp(t);
  const body = await (await fetch(`${started.base}/api/health`)).json();
  assert.equal(typeof body.windowOnlyLock, 'boolean');
});
