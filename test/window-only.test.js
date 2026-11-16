/**
 * W27-3 / W5-7: in the desktop app the permission rules and the permission mode change only from Bunny's window.
 * A program that merely holds the launch token gets 403; the main process (adminFetch) gets through; plain-browser dev mode keeps HTTP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, post, json } from './helpers.js';
import { WINDOW_ONLY_SETTING_KEYS, WINDOW_ONLY_SESSION_SETTINGS, isWindowOnlyRoute } from '../src/server/windowOnly.js';
// the page module touches window when it loads: give it an empty one
globalThis.window = {};
const ui = await import('../src/ui/api.js');
delete globalThis.window;

const j = { 'content-type': 'application/json' };
const put = (base, path, body, headers = {}) => json(base, path, { method: 'PUT', headers: { ...j, ...headers }, body: JSON.stringify(body) });
const patch = (base, path, body) => json(base, path, { method: 'PATCH', headers: j, body: JSON.stringify(body) });

test('the page and the server agree on which writes are window-only', () => {
  assert.deepEqual(ui.WINDOW_ONLY_SETTING_KEYS, WINDOW_ONLY_SETTING_KEYS);
  assert.deepEqual(ui.WINDOW_ONLY_SESSION_SETTINGS, WINDOW_ONLY_SESSION_SETTINGS);
  const id = '11111111-1111-1111-1111-111111111111';
  for (const [m, p, b] of [
    ['PUT', '/api/permission-rules', {}], ['put', '/api/permission-rules', {}], ['PUT', '/api/settings', { defaultPermissionMode: 'auto' }], ['PUT', '/api/settings', { permissionRules: {} }],
    ['PUT', '/api/settings', { theme: 'dark', defaultPermissionMode: 'ask' }], ['PATCH', `/api/sessions/${id}/setting/permissionMode`, { value: 'auto' }],
    ['PUT', '/api/settings', { theme: 'dark' }], ['GET', '/api/permission-rules', null], ['POST', '/api/permission-rules/try', {}], ['PATCH', `/api/sessions/${id}/setting/folder`, {}],
    ['PUT', '/api/settings', null], ['PUT', '/api/settings', 'x'], ['PATCH', '/api/sessions/abc/setting/permissionMode', {}],
  ]) assert.equal(ui.isWindowOnlyRoute(m, p, b), isWindowOnlyRoute(m, p, b), `${m} ${p}`);
  assert.equal(isWindowOnlyRoute('PUT', '/api/permission-rules'), true);
  assert.equal(isWindowOnlyRoute('PUT', '/api/settings', { defaultPermissionMode: 'auto' }), true);
  assert.equal(isWindowOnlyRoute('PUT', '/api/settings', { theme: 'dark' }), false);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/sessions/${id}/setting/permissionMode`, { value: 'auto' }), true);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/sessions/${id}/setting/effort`, { value: 'high' }), false);
});

test('desktop app: a program with the token cannot change the rules or the mode over HTTP; the main process can', async (t) => {
  const { app, base } = await startApp(t, { folderPickerOnly: true });
  const rules = { global: [{ kind: 'command', effect: 'deny', pattern: 'rm *' }], folders: {} };
  const denied = await put(base, '/api/permission-rules', rules);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'request.windowOnly');
  assert.equal(denied.body.message, "Change this in Bunny's window.");
  assert.deepEqual((await json(base, '/api/permission-rules')).body, { global: [], folders: {} }, 'nothing was saved');

  assert.equal((await put(base, '/api/settings', { defaultPermissionMode: 'auto' })).status, 403);
  assert.equal((await put(base, '/api/settings', { permissionRules: { global: [] } })).status, 403);
  assert.notEqual((await json(base, '/api/settings')).body.defaultPermissionMode, 'auto');

  const { body: s } = await post(base, '/api/sessions', { title: 'x' });
  const blocked = await patch(base, `/api/sessions/${s.id}/setting/permissionMode`, { value: 'auto' });
  assert.equal(blocked.status, 403);
  assert.equal((await json(base, `/api/sessions/${s.id}`)).body.permissionMode === 'auto', false);

  // everything else about settings and sessions still works over HTTP
  assert.equal((await put(base, '/api/settings', { displayName: 'Someone' })).status, 200);
  assert.equal((await patch(base, `/api/sessions/${s.id}/setting/effort`, { value: 'high' })).status, 200);
  assert.equal((await post(base, '/api/permission-rules/try', { command: 'rm x' })).status, 200);

  // the main process: token plus the window-only secret
  const viaMain = await app.adminFetch('/api/permission-rules', { method: 'PUT', headers: j, body: JSON.stringify(rules) });
  assert.equal(viaMain.status, 200);
  assert.equal((await json(base, '/api/permission-rules')).body.global[0].pattern, 'rm *');
  assert.equal((await app.adminFetch('/api/settings', { method: 'PUT', headers: j, body: JSON.stringify({ defaultPermissionMode: 'auto' }) })).status, 200);
  assert.equal((await json(base, '/api/settings')).body.defaultPermissionMode, 'auto');
  assert.equal((await app.adminFetch(`/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'plan' }) })).status, 200);
});

test('desktop app: a wrong or empty window-only header is refused too', async (t) => {
  const { base } = await startApp(t, { folderPickerOnly: true });
  for (const h of [{ 'x-bunny-admin': '' }, { 'x-bunny-admin': 'guess' }, { 'x-bunny-admin': 'a'.repeat(64) }]) {
    assert.equal((await put(base, '/api/permission-rules', { global: [], folders: {} }, h)).status, 403, JSON.stringify(h));
  }
});

test('plain-browser dev mode keeps HTTP for these writes', async (t) => {
  const { base } = await startApp(t, {});
  assert.equal((await put(base, '/api/permission-rules', { global: [], folders: {} })).status, 200);
  assert.equal((await put(base, '/api/settings', { defaultPermissionMode: 'plan' })).status, 200);
});

test('the page sends window-only writes to the main process when it is there, and over HTTP when it is not', async () => {
  const calls = [];
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => { fetched.push([path, init?.method]); return { ok: true, status: 200, json: async () => ({ via: 'http' }) }; };
  globalThis.window = { bunnyDesktop: { secureWrite: async (m, p, b) => { calls.push([m, p, b]); return { status: 200, data: { via: 'main' } }; } } };
  try {
    assert.deepEqual(await ui.sendJSON('/api/permission-rules', 'PUT', { global: [] }), { via: 'main' });
    assert.deepEqual(await ui.sendJSON('/api/settings', 'PUT', { defaultPermissionMode: 'ask' }), { via: 'main' });
    assert.deepEqual(await ui.sendJSON('/api/settings', 'PUT', { theme: 'dark' }), { via: 'http' }, 'other settings stay on HTTP');
    assert.equal(calls.length, 2);
    globalThis.window.bunnyDesktop.secureWrite = async () => ({ status: 403, data: { message: "Change this in Bunny's window." } });
    await assert.rejects(ui.sendJSON('/api/permission-rules', 'PUT', {}), /Change this in Bunny's window\./);
    delete globalThis.window;
    assert.deepEqual(await ui.sendJSON('/api/permission-rules', 'PUT', { global: [] }), { via: 'http' }, 'no desktop bridge: HTTP');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
  }
});

test('the desktop shell wires the bridge: preload exposes secureWrite and main checks the page and the route', async () => {
  const { readFileSync } = await import('node:fs');
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(preload, /secureWrite: \(method, path, body\) => ipcRenderer\.invoke\('secure:write'/);
  assert.match(main, /ipcMain\.handle\('secure:write'/);
  assert.match(main, /isOwn\(from\)/);
  assert.match(main, /isWindowOnlyRoute\(method, path, body\)/);
  assert.match(main, /bunnyApp\.adminFetch/);
  assert.match(main, /createApp\(\{ dataDir, folderPickerOnly: true \}\)/);
});
