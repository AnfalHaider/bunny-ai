import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, post } from './helpers.js';
import { createLocalMcp } from '../src/server/mcpLocal.js';

// W4-11 L-5: a local connector can ask the app ping and roots/list (and is refused the rest plainly); its command can be changed with the same confirmation as adding.
const ping = fileURLToPath(new URL('./fixtures/mcp-ping-server.mjs', import.meta.url));
const echo = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
const jsonH = { 'content-type': 'application/json' };

test('L-5: ping and roots/list from the connector are answered, and a request we do not serve is refused (not left waiting)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-ping-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'log.txt');
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  await local.listTools({ id: 'ping-1', type: 'local', name: 'Ping', command: process.execPath, args: [ping], env: { PING_LOG: log } });
  let said = '';
  for (let i = 0; i < 60 && !/sampling/.test(said); i += 1) { said = await readFile(log, 'utf8').catch(() => ''); if (!/sampling/.test(said)) await new Promise((r) => setTimeout(r, 50)); }
  assert.match(said, /^ping \{\}$/m);
  assert.match(said, /^roots \{"roots":\[\]\}$/m);
  assert.match(said, /^sampling refused$/m);
});

test('L-5: changing the command of a local connector needs the confirmation, and then replaces the program and drops old trust', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const { body: added } = await post(base, '/api/mcp', { name: 'Echo', command: process.execPath, args: [echo], env: {}, confirmLocal: true });
  await fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ trustReadOnly: true }) });
  const refused = await fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ command: process.execPath, args: [ping] }) });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).code, 'mcp.confirmLocal');
  const ok = await fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ command: process.execPath, args: [ping], confirmLocal: true }) });
  assert.equal(ok.status, 200);
  const now = await ok.json();
  assert.deepEqual(now.args, [ping]);
  assert.notEqual(now.trustReadOnly, true, 'trust given to the old program is gone');
  const bad = await fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ command: 'node\nrm -rf /', confirmLocal: true }) });
  assert.equal(bad.status, 404, 'a command with a line break is refused (the route answers with the store\'s error)');
});
