import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OWN_PAGE_PATHS, childWindowOptions, isOwnOrigin, isOwnPage, openDecision } from '../electron/own-pages.js';

// SB-1: an artifact opened with "Open" is served from Bunny's own address (/api/artifacts/<id>/raw). It must not count as one of Bunny's own pages.
const ORIGIN = 'http://127.0.0.1:41234';

test('only the listed page paths are Bunny\'s own pages, with any query or fragment', () => {
  for (const p of OWN_PAGE_PATHS) {
    assert.equal(isOwnPage(`${ORIGIN}${p}`, ORIGIN), true, p);
    assert.equal(isOwnPage(`${ORIGIN}${p}?embed=1&section=code#x`, ORIGIN), true, `${p} with a query`);
  }
  assert.equal(isOwnPage(`${ORIGIN}/src/ui/index.html?s=0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f`, ORIGIN), true, 'a pop-out chat');
});

test('an artifact, the API and any other path on Bunny\'s own address are not Bunny\'s own pages', () => {
  for (const path of ['/api/artifacts/abc/raw', '/api/artifacts/abc/raw?x=1', '/api/sessions', '/', '/src/ui/token.js', '/src/ui/app.css', '/src/ui/chat.js', '/src/ui/other.html', '/index.html', '/src/ui/index.html/extra', '/src/ui/index.htm']) {
    assert.equal(isOwnPage(`${ORIGIN}${path}`, ORIGIN), false, path);
    assert.equal(isOwnOrigin(`${ORIGIN}${path}`, ORIGIN), true, `${path} is still on Bunny's server`);
  }
});

test('tricks do not turn an artifact into a page: dot segments, encoded dots, other origins, look-alike hosts, other schemes, junk', () => {
  for (const url of [
    `${ORIGIN}/src/ui/../../api/artifacts/abc/raw`, `${ORIGIN}/src/ui/%2e%2e/%2e%2e/api/artifacts/abc/raw`, `${ORIGIN}/api/artifacts/abc/raw/../../../src/ui/x.html`,
    'http://127.0.0.1:41235/src/ui/index.html', 'http://localhost:41234/src/ui/index.html', `${ORIGIN}.evil.test/src/ui/index.html`, 'http://evil.test/src/ui/index.html',
    'https://127.0.0.1:41234/src/ui/index.html', 'file:///C:/x/src/ui/index.html', 'javascript:alert(1)', 'about:blank', 'data:text/html,hi', '', null, undefined, 'not a url',
  ]) assert.equal(isOwnPage(url, ORIGIN), false, String(url));
  // a dot-segment path that really resolves to a page is that page (the address parser resolves it first, so nothing hides)
  assert.equal(isOwnPage(`${ORIGIN}/api/../src/ui/index.html`, ORIGIN), true);
  assert.equal(isOwnPage(`${ORIGIN}/src/ui/index.html`, ''), false, 'no origin yet: nothing is own');
  assert.equal(isOwnPage(`${ORIGIN}/src/ui/index.html`, undefined), false);
});

test('window.open: a Bunny page becomes a Bunny window, an artifact a window with NO preload, the web the person\'s browser, the rest nothing', () => {
  assert.equal(openDecision(`${ORIGIN}/src/ui/index.html?s=1`, ORIGIN), 'bunny');
  assert.equal(openDecision(`${ORIGIN}/api/artifacts/abc/raw`, ORIGIN), 'plain');
  assert.equal(openDecision('https://example.com/a', ORIGIN), 'web');
  assert.equal(openDecision('http://example.com/a', ORIGIN), 'web');
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'about:blank', 'data:text/html,x', '', null]) assert.equal(openDecision(url, ORIGIN), 'deny', String(url));
  const bunny = childWindowOptions('bunny', { icon: 'i', bunnyPreferences: () => ({ preload: '/x/preload.cjs', sandbox: true }) });
  assert.equal(bunny.webPreferences.preload, '/x/preload.cjs');
  const plain = childWindowOptions('plain', { icon: 'i', bunnyPreferences: () => ({ preload: '/x/preload.cjs' }) });
  assert.equal(plain.webPreferences.preload, undefined, 'no preload');
  assert.deepEqual([plain.webPreferences.sandbox, plain.webPreferences.contextIsolation, plain.webPreferences.nodeIntegration], [true, true, false]);
});

test('main.js and the preload use these rules, and the preload\'s own list equals OWN_PAGE_PATHS', async () => {
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /const isOwn = \(url\) => isOwnPage\(/, 'every IPC check goes through the allow-list');
  assert.doesNotMatch(main, /startsWith\(`\$\{origin\}\/`\)/, 'no prefix test of the address is left');
  assert.match(main, /openDecision\(url, origin\)/);
  assert.match(main, /childWindowOptions\(kind,/);
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const listed = /const OWN_PAGE_PATHS = \[([^\]]*)\]/.exec(preload)[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(listed, [...OWN_PAGE_PATHS]);
  assert.match(preload, /if \(isOwnPagePath\) \{/, 'the bridge is only exposed in an own page');
});
