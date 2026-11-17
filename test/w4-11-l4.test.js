import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, post, json } from './helpers.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { createMcpStore } from '../src/server/mcpStore.js';
import { createLocalMcp } from '../src/server/mcpLocal.js';

// W4-11 L-4 (Security's requirements): a local connector's settings (API keys) are not kept in plain text in mcp.json.
const SECRET = 'test-secret-value-123';
const script = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-l4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('L-4: a new connector\'s setting goes to the secret store; mcp.json, list and get show the name only; the program still gets the value', async (t) => {
  const dir = await temp(t);
  const secrets = memorySecretStore();
  const store = createMcpStore({ file: join(dir, 'mcp.json'), secrets });
  const added = await store.add({ name: 'Echo', command: process.execPath, args: [script], env: { ECHO_PREFIX: SECRET } });
  assert.deepEqual(added.envNames, ['ECHO_PREFIX']);
  assert.equal(added.env, undefined);
  assert.ok(!(await readFile(join(dir, 'mcp.json'), 'utf8')).includes(SECRET), 'not in mcp.json');
  assert.ok(!JSON.stringify(await store.list()).includes(SECRET));
  assert.ok(!JSON.stringify(await store.get(added.id)).includes(SECRET));
  assert.deepEqual(await readdir(dir), ['mcp.json'], 'no temp file left behind');
  assert.deepEqual(await store.resolveEnv(added.id), { ECHO_PREFIX: SECRET });
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const server = { ...added, env: await store.resolveEnv(added.id) };
  await local.listTools(server);
  const said = await local.callTool(server, { name: 'echo', arguments: { text: 'hi' } });
  assert.equal(said.content[0].text, `${SECRET}hi`, 'the program received it');
});

test('L-4: through the app, no answer of /api/mcp, no tool answer and no mcp.json holds the value', async (t) => {
  const { base, dataDir } = await startApp(t, { fake: false });
  const { body: added } = await post(base, '/api/mcp', { name: 'Echo', command: process.execPath, args: [script], env: { ECHO_PREFIX: SECRET }, confirmLocal: true });
  assert.ok(!JSON.stringify(added).includes(SECRET));
  assert.ok(!JSON.stringify((await json(base, '/api/mcp')).body).includes(SECRET));
  const tools = await json(base, `/api/mcp/${added.id}/tools`);
  assert.equal(tools.status, 200);
  assert.ok(!JSON.stringify(tools.body).includes(SECRET));
  const called = await post(base, `/api/mcp/${added.id}/call`, { name: 'echo', arguments: { text: 'x' } });
  assert.equal(called.body.result.content[0].text, `${SECRET}x`, 'the connector still works');
  for (const f of await readdir(dataDir)) if (/^mcp\.json/.test(f)) assert.ok(!(await readFile(join(dataDir, f), 'utf8')).includes(SECRET), f);
});

test('L-4 migration: an old plain value is stored and read back BEFORE the file is rewritten; the file ends without it; no temp file', async (t) => {
  const dir = await temp(t);
  const file = join(dir, 'mcp.json');
  await writeFile(file, JSON.stringify([{ id: 'old-1', name: 'Old', type: 'local', command: 'node', args: [], env: { API_KEY: SECRET }, enabled: true, status: 'unknown', tools: [] }]));
  const secrets = memorySecretStore();
  const order = [];
  const watched = { ...secrets, set: (k, v) => { order.push('set'); return secrets.set(k, v); }, get: (k) => { order.push('get'); return secrets.get(k); } };
  const store = createMcpStore({ file, secrets: watched });
  assert.deepEqual((await store.list())[0].envNames, ['API_KEY']);
  assert.deepEqual(order.slice(0, 2), ['set', 'get'], 'written, then read back');
  const rewritten = await readFile(file, 'utf8');
  assert.ok(!rewritten.includes(SECRET));
  assert.deepEqual(await store.resolveEnv('old-1'), { API_KEY: SECRET });
  assert.deepEqual(await readdir(dir), ['mcp.json']);
});

test('L-4 migration: if the store cannot keep a value, the file and the plain value are left alone and the connector still works', async (t) => {
  const dir = await temp(t);
  const file = join(dir, 'mcp.json');
  await writeFile(file, JSON.stringify([{ id: 'old-2', name: 'Old', type: 'local', command: 'node', args: [], env: { API_KEY: SECRET }, enabled: true, status: 'unknown', tools: [] }]));
  const broken = { set: () => { throw new Error('store unavailable'); }, get: () => null, delete: () => {} };
  const store = createMcpStore({ file, secrets: broken });
  await store.list();
  assert.ok((await readFile(file, 'utf8')).includes(SECRET), 'nothing was lost');
  assert.deepEqual(await store.resolveEnv('old-2'), { API_KEY: SECRET });
  const lying = { set: () => {}, get: () => 'something else', delete: () => {} }; // a store that does not read back what it was given
  const store2 = createMcpStore({ file, secrets: lying });
  await store2.list();
  assert.ok((await readFile(file, 'utf8')).includes(SECRET), 'a failed read-back keeps the plain value too');
});

test('L-4: editing: a name not mentioned keeps its value, a blank value clears it (and its secret), a deleted connector takes its secrets with it', async (t) => {
  const dir = await temp(t);
  const secrets = memorySecretStore();
  const store = createMcpStore({ file: join(dir, 'mcp.json'), secrets });
  const added = await store.add({ name: 'Two', command: process.execPath, args: [], env: { A_KEY: 'one', B_KEY: 'two' } });
  await store.update(added.id, { name: 'Renamed' }); // no env sent: nothing changes
  assert.deepEqual(await store.resolveEnv(added.id), { A_KEY: 'one', B_KEY: 'two' });
  await store.update(added.id, { env: { A_KEY: 'changed' } }); // B_KEY not mentioned: kept
  assert.deepEqual(await store.resolveEnv(added.id), { A_KEY: 'changed', B_KEY: 'two' });
  await store.update(added.id, { env: { B_KEY: '' } }); // blank clears
  assert.deepEqual(await store.resolveEnv(added.id), { A_KEY: 'changed' });
  assert.deepEqual((await store.get(added.id)).envNames, ['A_KEY']);
  assert.equal(secrets._dump().filter((k) => k.includes(added.id)).length, 1, 'the cleared secret is gone from the store');
  await store.remove(added.id);
  assert.deepEqual(secrets._dump().filter((k) => k.includes(added.id)), [], 'removing the connector removed its secrets');
});

test('L-4: a changed value restarts the program (the restart key follows the value but holds none of it)', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const base = { id: 'restart-1', type: 'local', name: 'Echo', command: process.execPath, args: [script] };
  await local.listTools({ ...base, env: { ECHO_PREFIX: 'first-' } });
  assert.equal((await local.callTool({ ...base, env: { ECHO_PREFIX: 'first-' } }, { name: 'echo', arguments: { text: 'a' } })).content[0].text, 'first-a');
  assert.equal((await local.callTool({ ...base, env: { ECHO_PREFIX: 'second-' } }, { name: 'echo', arguments: { text: 'a' } })).content[0].text, 'second-a', 'a new value, a new process');
});

test('L-4: a value never appears in the error text or the progress line when the program fails', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const server = { id: 'leaky', type: 'local', name: 'Leaky', command: process.execPath, args: ['-e', 'console.error("token is " + process.env.MY_TOKEN); process.exit(3)'], env: { MY_TOKEN: SECRET } };
  await assert.rejects(local.listTools(server), (err) => !err.message.includes(SECRET) && /stopped|could not/.test(err.message));
});
