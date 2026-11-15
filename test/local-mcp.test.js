import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startApp, post, json } from './helpers.js';
import { createLocalMcp } from '../src/server/mcpLocal.js';

const serverScript = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
const echo = (extra = {}) => ({ id: 'echo-1', type: 'local', name: 'Echo', command: process.execPath, args: [serverScript], env: { ECHO_PREFIX: 'you said: ' }, ...extra });

test('a local connector starts, lists its tools, runs one, and stops', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const tools = await local.listTools(echo());
  assert.deepEqual(tools.map((x) => [x.name, x.readOnly]), [['echo', true]]);
  const result = await local.callTool(echo(), { name: 'echo', arguments: { text: 'carrots' } });
  assert.equal(result.content[0].text, 'you said: carrots', 'its settings reach the program');
  assert.deepEqual(local.running(), ['echo-1'], 'the program is kept for the next call');
  await local.stop('echo-1');
  assert.deepEqual(local.running(), []);
});

test('a local connector that cannot start says why', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  await assert.rejects(local.listTools(echo({ id: 'bad', command: process.execPath, args: ['-e', 'process.exit(3)'] })), /stopped|could not start/);
  await assert.rejects(local.listTools(echo({ id: 'none', command: '' })), /no command/);
});

test('a local connector is only added with the command confirmed, and its tools reach the chat', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const body = { name: 'Echo', command: process.execPath, args: [serverScript], env: { ECHO_PREFIX: '> ' } };
  const refused = await post(base, '/api/mcp', body);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'mcp.confirmLocal');
  const { body: added } = await post(base, '/api/mcp', { ...body, confirmLocal: true });
  assert.equal(added.type, 'local');
  assert.deepEqual(added.args, [serverScript]);
  const tools = await json(base, `/api/mcp/${added.id}/tools`);
  assert.equal(tools.status, 200, JSON.stringify(tools.body));
  assert.equal(tools.body.tools[0].name, 'echo');
  const called = await post(base, `/api/mcp/${added.id}/call`, { name: 'echo', arguments: { text: 'hi' } });
  assert.equal(called.body.result.content[0].text, '> hi');
  const removed = await json(base, `/api/mcp/${added.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.deepEqual((await json(base, '/api/mcp')).body, []);
});

test('a command with a line break is refused', async (t) => {
  const { base } = await startApp(t);
  const bad = await post(base, '/api/mcp', { name: 'Bad', command: 'node\nrm -rf /', confirmLocal: true });
  assert.equal(bad.status, 400);
});
