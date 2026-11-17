/**
 * Q2-24 / Q2-26, the owner's rule: "when allowed by me, everything should be allowed". A permission mode does what it says:
 *   Manual        asks before an edit, a command and a build action
 *   Accept edits  asks before a command and a build action
 *   Auto          asks for nothing a person can undo or allowed; build actions run (a project file grants none of this)
 *   Plan          refuses every edit, command and build action
 * Sending an email speaks for the person and asks in every mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, post } from './helpers.js';
import { GOOGLE_TOOL_RISK } from '../src/server/google.js';
import { AGENT_TOOL_RISK } from '../src/server/agentTools.js';

const j = { 'content-type': 'application/json' };
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

/** A model that calls the tool its model id names ("call:schedule_task"), then says done. */
async function caller(t) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'call:schedule_task' }] })); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.messages.some((m) => m.role === 'tool')) { res.end(frame({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      const args = { name: 'nightly', prompt: 'tidy up', every_minutes: 60, may_change: true };
      res.end(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'schedule_task', arguments: JSON.stringify(args) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

/** Run one reply in a mode, allowing whatever asks; report what asked and how it ended. */
async function runIn(t, mode) {
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await caller(t) });
  const { body: s } = await post(base, '/api/sessions', { title: mode, providerId: 'openai', model: 'call:schedule_task' });
  await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'schedule a tidy-up', providerId: 'openai', model: 'call:schedule_task', workMode: 'chat' }) });
  const asked = [];
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const part = decoder.decode(chunk, { stream: true });
    text += part;
    for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) {
      const data = JSON.parse(m[1]);
      asked.push(data);
      await post(base, `/api/sessions/${s.id}/permission/${data.id}`, { allowed: true });
    }
  }
  const { body: tasks } = await (async () => ({ body: await (await fetch(`${base}/api/schedules`)).json() }))();
  return { asked, text, tasks };
}

for (const mode of ['ask', 'accept']) {
  test(`${mode === 'ask' ? 'Manual' : 'Accept edits'}: a schedule that may change things asks first`, async (t) => {
    const { asked, tasks } = await runIn(t, mode);
    assert.equal(asked.length, 1);
    assert.match(asked[0].title, /schedule|nightly/i);
    assert.equal(tasks.length, 1, 'allowed, so it ran');
  });
}

test('Auto (W3-3): a schedule that may change things still asks first, then runs', async (t) => {
  const { asked, tasks } = await runIn(t, 'auto');
  assert.equal(asked.length, 1);
  assert.equal(tasks.length, 1);
});

test('Plan: the same call is refused, nothing is scheduled', async (t) => {
  const { asked, tasks, text } = await runIn(t, 'plan');
  assert.deepEqual(asked, []);
  assert.equal(tasks.length, 0);
  assert.match(text, /denied|not available/);
});

test('the risk table: sending an email asks in every mode; computer use and tool building are build actions', () => {
  assert.equal(GOOGLE_TOOL_RISK.gmail_send, 'send');
  for (const name of ['computer_click', 'computer_type', 'computer_key', 'computer_scroll', 'create_tool']) assert.equal(AGENT_TOOL_RISK[name], 'build', name);
  assert.equal(AGENT_TOOL_RISK.computer_screenshot, 'read');
});

test('a project file cannot grant a permission: the mode comes only from the chat and the person\'s settings', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8');
  const mode = /const permissionMode = ([^\n]*)/.exec(src)?.[1] ?? '';
  assert.match(mode, /session\.permissionMode[\s\S]*settings\.defaultPermissionMode/);
  assert.ok(!/AGENTS\.md|CLAUDE\.md|\.cursor/.test(mode));
});
