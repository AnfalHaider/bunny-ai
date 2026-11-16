// W4-10: plugins can be uninstalled (one and many), a failure is said in words, and installing twice gives one plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { createAppTools } from '../src/server/appTools.js';
import { memorySecretStore } from '../src/providers/connections.js';

async function start(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-plugin-'));
  const app = await createApp({ dataDir, fake: true, secretStore: memorySecretStore(), localGuard: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => { app.server.close(() => resolve()); app.server.closeAllConnections?.(); });
    await rm(dataDir, { recursive: true, force: true });
  });
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call };
}

const PACK = {
  name: 'Developer docs pack', description: 'docs',
  connectors: [{ name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' }, { name: 'Context7', url: 'https://mcp.context7.com/mcp' }],
  skills: [{ name: 'Cite sources', description: 'x', instructions: 'Name the source.' }],
};

const counts = async (call) => ({
  plugins: ((await call('/api/settings')).body.plugins ?? []).length,
  connectors: (await call('/api/mcp')).body.length,
  skills: (await call('/api/skills')).body.length,
});

test('install, uninstall, reload: everything is gone', async (t) => {
  const { call } = await start(t);
  const installed = await call('/api/plugins', 'POST', PACK);
  assert.equal(installed.status, 200);
  assert.deepEqual(await counts(call), { plugins: 1, connectors: 2, skills: 1 });
  const gone = await call(`/api/plugins/${installed.body.plugin.id}`, 'DELETE');
  assert.equal(gone.status, 200);
  assert.equal(gone.body.ok, true);
  assert.deepEqual(await counts(call), { plugins: 0, connectors: 0, skills: 0 });
});

test('installing the same plugin twice gives one plugin, also when both arrive at once', async (t) => {
  const { call } = await start(t);
  const [a, b] = await Promise.all([call('/api/plugins', 'POST', PACK), call('/api/plugins', 'POST', PACK)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  const refused = a.status === 400 ? a : b;
  assert.match(refused.body.message, /already installed/);
  assert.deepEqual(await counts(call), { plugins: 1, connectors: 2, skills: 1 });
  const again = await call('/api/plugins', 'POST', PACK);
  assert.equal(again.status, 400);
  assert.deepEqual(await counts(call), { plugins: 1, connectors: 2, skills: 1 });
});

test('uninstall still works when a part was already removed by hand, and an unknown plugin is reported', async (t) => {
  const { call } = await start(t);
  const { body } = await call('/api/plugins', 'POST', PACK);
  await call(`/api/mcp/${body.plugin.connectors[0]}`, 'DELETE');
  await call(`/api/skills/${body.plugin.skills[0]}`, 'DELETE');
  assert.equal((await call(`/api/plugins/${body.plugin.id}`, 'DELETE')).status, 200);
  assert.deepEqual(await counts(call), { plugins: 0, connectors: 0, skills: 0 });
  const unknown = await call('/api/plugins/00000000-0000-4000-8000-000000000000', 'DELETE');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.ok, false);
});

test('a failing uninstall answers with a plain message and keeps the plugin listed', async (t) => {
  const { call } = await start(t);
  // The real server with a store that fails: done through the tools directly.
  let settings = { plugins: [] };
  const fail = { value: false };
  const tools = createAppTools({
    skills: { add: async (s) => ({ id: `s-${s.name}` }), remove: async () => true },
    mcp: { add: async (c) => ({ id: `c-${c.name}` }), remove: async () => { if (fail.value) throw new Error('the list could not be saved'); return true; } },
    getSettings: () => settings,
    saveSettings: async (patch) => { settings = { ...settings, ...patch }; },
  });
  const record = await tools.installBundle(PACK);
  fail.value = true;
  await assert.rejects(() => tools.uninstall(record.id), /could not be saved/);
  assert.equal(settings.plugins.length, 1, 'the plugin stays listed after a failed uninstall');
  fail.value = false;
  assert.equal((await tools.uninstall(record.id)).ok, true, 'and a retry works');
  assert.equal(settings.plugins.length, 0);
  assert.ok(call);
});

test('half an install is undone', async () => {
  let settings = { plugins: [] };
  const removed = [];
  const tools = createAppTools({
    skills: { add: async (s) => ({ id: `s-${s.name}` }), remove: async (id) => { removed.push(id); return true; } },
    mcp: { add: async () => { throw new Error('bad address'); }, remove: async () => true },
    getSettings: () => settings,
    saveSettings: async (patch) => { settings = { ...settings, ...patch }; },
  });
  await assert.rejects(() => tools.installBundle(PACK), /bad address/);
  assert.deepEqual(removed, ['s-Cite sources']);
  assert.equal(settings.plugins.length, 0);
});

test('the Customize page shows an uninstall failure and uses the server routes', async () => {
  const page = await readFile(new URL('../src/ui/customize.html', import.meta.url), 'utf8');
  assert.match(page, /id="cz-error"[^>]*role="alert"/);
  assert.match(page, /could not be uninstalled/);
  assert.match(page, /\/api\/plugins\/\$\{plugin\.id\}/);
  assert.match(page, /'\/api\/plugins', 'POST'/);
  assert.doesNotMatch(page, /plugins: \[\.\.\.data\.plugins/, 'the page no longer rewrites the plugin list from its own copy');
});

test('installing and uninstalling a plugin are window-only, like connectors and skills', async () => {
  const { isWindowOnlyRoute } = await import('../src/server/windowOnly.js');
  const id = '11111111-2222-4333-8444-555555555555';
  assert.equal(isWindowOnlyRoute('POST', '/api/plugins', { name: 'x' }), true);
  assert.equal(isWindowOnlyRoute('DELETE', `/api/plugins/${id}`), true);
});
