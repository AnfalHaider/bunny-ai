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
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'call:browser_click' }, { id: 'call:browser_type' }, { id: 'call:write_file' }, { id: 'call:no_such_tool' }, { id: 'call:move_to_new_chat' }, { id: 'call:ask_user' }, { id: 'call:create_artifact' }] })); return; }
      const body = JSON.parse(raw);
      const afterTool = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (afterTool) { res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      const name = body.model.replace('call:', '');
      const args = name === 'ask_user' ? { question: 'Which one?', choices: [{ label: 'A', reason: 'first', recommended: true }, { label: 'B', reason: 'second' }] } : name === 'create_artifact' ? { title: 'Plan sketch', kind: 'html', content: '<p>plan</p>' } : name === 'move_to_new_chat' ? { title: 'Other', message: 'something else' } : name === 'write_file' ? { path: 'x.txt', content: 'x' } : name === 'browser_type' ? { text: 'hi' } : name === 'browser_click' ? { selector: 'a' } : {};
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

test('Plan mode still asks questions: ask_user raises the question card', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const { post: p } = await import('./helpers.js');
  await p(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await callerServer(t) });
  const { body: s } = await p(base, '/api/sessions', { title: 'plan', providerId: 'openai', model: 'call:ask_user' });
  await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'plan' }) });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'call:ask_user', workMode: 'chat' }) });
  let text = '';
  let answered = false;
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    text += decoder.decode(chunk, { stream: true });
    const asked = /event: question[\r\n]+data: (.*)/.exec(text);
    if (asked && !answered) { // answer it, so the reply finishes and the folder can be cleaned up
      answered = true;
      await fetch(`${base}/api/sessions/${s.id}/question/${JSON.parse(asked[1]).id}`, { method: 'POST', headers: j, body: JSON.stringify({ answer: 'A' }) });
    }
  }
  assert.ok(answered, 'the question card was raised in Plan mode: ' + text.slice(0, 300));
});

test('Plan mode still makes artifacts: create_artifact runs and the artifact exists', async (t) => {
  const { stream } = await run(t, 'call:create_artifact', { mode: 'plan', workMode: 'chat', browserControl: false });
  assert.match(stream, /"status":"done"|artifact/i, stream.slice(0, 300));
  assert.ok(!/"status":"denied"/.test(stream), stream.slice(0, 300));
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
