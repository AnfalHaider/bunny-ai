/**
 * Plan mode is read-only on the server (Q2-1, completed after Tech Lead's review): every path refuses an
 * edit, run or build tool, including the browser's click and type, and a tool the model was never offered
 * does not run at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

/** A model that asks for whatever tool its model id names ("call:browser_click"), then says done. */
async function callerServer(t) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'call:browser_click' }, { id: 'call:browser_type' }, { id: 'call:write_file' }, { id: 'call:no_such_tool' }, { id: 'call:move_to_new_chat' }] })); return; }
      const body = JSON.parse(raw);
      const afterTool = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (afterTool) { res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      const name = body.model.replace('call:', '');
      const args = name === 'move_to_new_chat' ? { title: 'Other', message: 'something else' } : name === 'write_file' ? { path: 'x.txt', content: 'x' } : name === 'browser_type' ? { text: 'hi' } : name === 'browser_click' ? { selector: 'a' } : {};
      res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name, arguments: JSON.stringify(args) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

async function run(t, model, { mode = 'plan', browserControl = true, workMode = 'code' } = {}) {
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await callerServer(t) });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-plan-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'plan', providerId: 'openai', model });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', workMode); await set('permissionMode', mode);
  const stream = await (await fetch(`${base}/api/sessions/${s.id}/messages`, {
    method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model, workMode, browserControl }),
  })).text();
  return { stream, folder };
}
const ran = (stream) => /"status":"running"/.test(stream);

for (const tool of ['browser_click', 'browser_type']) {
  test(`Plan mode: a call to ${tool} is refused, not run (even with browser control on)`, async (t) => {
    const { stream } = await run(t, `call:${tool}`);
    assert.ok(!ran(stream), stream);
    assert.match(stream, /"status":"denied"/);
  });
}

test('Plan mode: write_file is refused and nothing is written', async (t) => {
  const { stream, folder } = await run(t, 'call:write_file');
  assert.ok(!ran(stream), stream);
  assert.equal(existsSync(join(folder, 'x.txt')), false);
});

test('Plan mode: move_to_new_chat is not offered and a call to it is refused (Q2-S2)', async (t) => {
  const { stream } = await run(t, 'call:move_to_new_chat', { mode: 'plan', workMode: 'chat', browserControl: false });
  assert.ok(!ran(stream), stream);
  assert.ok(!/event: new_chat|event: newchat/i.test(stream), 'no new chat was started');
  assert.match(stream, /"status":"denied"/);
});

test('a tool that was never offered does not run in any mode', async (t) => {
  const { stream } = await run(t, 'call:no_such_tool', { mode: 'auto' });
  assert.ok(!ran(stream), stream);
  assert.match(stream, /"status":"denied"/);
});

test('a chat-mode reply has no workspace tools, so a write_file call from it never runs', async (t) => {
  const { stream, folder } = await run(t, 'call:write_file', { mode: 'auto', workMode: 'chat', browserControl: false });
  assert.ok(!ran(stream), stream);
  assert.equal(existsSync(join(folder, 'x.txt')), false);
});
