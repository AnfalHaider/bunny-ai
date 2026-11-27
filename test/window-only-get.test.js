/**
 * LOCAL-MODELS (QA's SC-f, broken since v0.1.15): a device's Activity list showed "Change this in Bunny's window." in the real window, because getJSON read a window-only GET
 * (/api/remote/log) with a plain fetch. getJSON now sends every window-only GET through the bridge, as sendJSON does for writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startApp } from './helpers.js';

globalThis.window = { matchMedia: undefined };
const { getJSON, isWindowOnlyRoute } = await import('../src/ui/api.js');
const { WINDOW_ONLY_ROUTES } = await import('../src/server/windowOnly.js');

test('a plain read of /api/remote/log is refused (403) and the window\'s path (the bridge) gets 200; getJSON takes the bridge', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-wog-'));
  const { app, base } = await startApp(t, { dataDir: dir, folderPickerOnly: true, localGuard: true, apiToken: 'tok-test-0000000000' });
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }));
  const plain = await fetch(`${base}/api/remote/log`, { headers: { authorization: 'Bearer tok-test-0000000000' } });
  assert.equal(plain.status, 403, 'a page in a browser tab cannot read the log');
  const viaMain = await app.adminFetch('/api/remote/log', { method: 'GET' });
  assert.equal(viaMain.status, 200);

  // getJSON with a bridge: the read goes through secureWrite (which is adminFetch in the real window), never a plain fetch
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = { matchMedia: undefined, bunnyDesktop: { secureWrite: async (method, path, body) => { calls.push([method, path, body]); const r = await app.adminFetch(path, { method }); return { status: r.status, data: await r.json() }; } } };
  globalThis.fetch = async (u, ...r) => { if (typeof u === 'string' && u.startsWith('/')) throw new Error('a plain page fetch was used'); return realFetch(u, ...r); };
  try {
    const out = await getJSON('/api/remote/log');
    assert.ok(Array.isArray(out.entries), 'the entries came back');
    assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1]), ['GET /api/remote/log']);
    await getJSON('/api/remote/log?x=1').catch(() => {}); // a query string still counts as the same route
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = realFetch; globalThis.window = { matchMedia: undefined }; }
});

test('a read that is not window-only still goes over plain HTTP, even with the bridge present', async () => {
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.window = { matchMedia: undefined, bunnyDesktop: { secureWrite: async () => { throw new Error('the bridge was used for an open read'); } } };
  globalThis.fetch = async (p) => { sent.push(p); return { ok: true, status: 200, json: async () => ({ ok: 1 }) }; };
  try { assert.deepEqual(await getJSON('/api/settings'), { ok: 1 }); assert.deepEqual(sent, ['/api/settings']); }
  finally { globalThis.fetch = realFetch; globalThis.window = { matchMedia: undefined }; }
});

test('every window-only GET route is read through the bridge: no page calls getJSON on one without it covering the call', async () => {
  const gets = WINDOW_ONLY_ROUTES.filter(([m]) => m.includes('GET'));
  assert.ok(gets.length >= 2);
  for (const [, re] of gets) assert.equal(isWindowOnlyRoute('GET', re.includes('remote/log') ? '/api/remote/log' : '/api/local-models/places'), true);
  // every getJSON('<literal path>') in the pages: any that is a window-only GET is covered by getJSON itself (the test above); list them so a new one is seen
  const root = fileURLToPath(new URL('../src/ui/', import.meta.url));
  const hits = [];
  for (const f of (await readdir(root)).filter((n) => /\.(js|html)$/.test(n))) {
    const text = await readFile(join(root, f), 'utf8');
    for (const m of text.matchAll(/getJSON\(\s*[`'"](\/api\/[^`'"?$]*)/g)) if (isWindowOnlyRoute('GET', m[1])) hits.push(`${f} ${m[1]}`);
  }
  assert.ok(hits.every((h) => /\/api\/remote\/log$|\/api\/local-models\/places/.test(h)), `unexpected window-only GET reads: ${hits.join(', ')}`);
});
