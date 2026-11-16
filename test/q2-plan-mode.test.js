import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

/**
 * Plan mode (QA, release-0.1.5): looking, asking and making an artifact are allowed; edits, commands, build actions and
 * moving the work to a new chat are refused, even when the model calls a tool it was never offered.
 * A scripted model calls the tool named in the message; the test answers every question and permission card.
 */
const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const ARGS = {
  ask_user: { question: 'Which colour?', choices: [{ label: 'Blue', reason: 'calm' }, { label: 'Green', reason: 'fresh', recommended: true }] },
  create_artifact: { title: 'Plan page', kind: 'html', content: '<h1>Plan</h1>' },
  write_file: { path: 'note.txt', content: 'carrots\n' },
  edit_file: { path: 'note.txt', old_text: 'a', new_text: 'b' },
  run_command: { command: 'echo hi' },
  start_process: { command: 'echo hi' },
  create_tool: { name: 'q2_tool', description: 'x', script: 'Write-Output 1', parameters: {} },
  move_to_new_chat: { title: 'Other', message: 'do the other thing' },
  list_files: {},
};

async function setup(t) {
  const { base } = await startApp(t, { fake: false });
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
      const tool = /^call (\w+)/.exec(asked)?.[1];
      const done = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (tool && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: tool, arguments: JSON.stringify(ARGS[tool] ?? {}) } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  return base;
}

/** One reply in Plan mode that calls `tool`; answers a question with its first choice; reports cards, status, files, artifacts. */
async function inPlan(base, tool) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-q2-plan-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'plan', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', 'plan');
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: `call ${tool}`, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
  const events = []; let buf = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const name = /^event: (\w+)/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!name) continue;
      let parsed = null; try { parsed = JSON.parse(data); } catch { /* not json */ }
      events.push(name);
      if (name === 'question') await fetch(`${base}/api/sessions/${s.id}/question/${parsed.id}`, { method: 'POST', headers: j, body: JSON.stringify({ choices: [parsed.choices?.[0]?.label ?? 'Blue'] }) });
      if (name === 'permission') await fetch(`${base}/api/sessions/${s.id}/permission/${parsed.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) });
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  const artifacts = await (await fetch(`${base}/api/artifacts`)).json();
  return { events, step, status: step?.status ?? 'none', result: String(step?.result ?? ''), wrote: existsSync(join(folder, 'note.txt')), artifacts: artifacts.length, sessions: (await (await fetch(`${base}/api/sessions`)).json()).length };
}

test('Plan mode: the model can ask a question, and the question card reaches the person', async (t) => {
  const base = await setup(t);
  const r = await inPlan(base, 'ask_user');
  assert.ok(r.events.includes('question'), 'no question card; events: ' + r.events.join(','));
  assert.ok(!/read-only|not run/i.test(r.result), 'the question was refused: ' + r.result);
});

test('Plan mode: the model can make an artifact', async (t) => {
  const base = await setup(t);
  const r = await inPlan(base, 'create_artifact');
  assert.equal(r.artifacts, 1, 'no artifact was made; step result: ' + r.result);
  assert.ok(!/read-only|not run/i.test(r.result), 'refused: ' + r.result);
});

test('Plan mode: reading the folder works', async (t) => {
  const base = await setup(t);
  const r = await inPlan(base, 'list_files');
  assert.equal(r.status, 'done'); assert.ok(!r.events.includes('permission'));
});

for (const tool of ['write_file', 'edit_file', 'run_command', 'start_process', 'create_tool', 'move_to_new_chat']) {
  test(`Plan mode refuses ${tool}: nothing runs, no card, no new chat, no file`, { skip: tool === 'create_tool' && process.platform !== 'win32' && 'custom tools are Windows only' }, async (t) => {
    const base = await setup(t);
    const before = (await (await fetch(`${base}/api/sessions`)).json()).length;
    const r = await inPlan(base, tool);
    assert.ok(!r.events.includes('permission'), 'a permission card appeared: it should have been refused outright');
    assert.ok(!r.events.includes('newChat'), 'a new chat was started');
    assert.equal(r.wrote, false, 'a file was written');
    assert.notEqual(r.status, 'done', `the step ran: "${r.status}" ${r.result.slice(0, 120)}`);
    assert.ok(r.sessions <= before + 1, 'extra chats appeared');
  });
}
