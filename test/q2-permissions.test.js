import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

/**
 * Q-2 addition (owner, 2026-11-16): "when allowed by me, everything should be allowed". For every permission mode
 * and every kind of tool: does Bunny ask when it should, and not ask when the person already allowed it?
 *
 * A scripted model calls one named tool; the test answers every permission card (Allow for read, edit and run
 * tools in a temp folder, Deny for the tools that would drive this computer or build a program: those are never run).
 * A test marked todo states the owner's rule where the code does something else (docs/plans/audit-q2.md, Q2-24 to Q2-26).
 */

const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const ARGS = {
  list_files: {}, write_file: { path: 'note.txt', content: 'carrots\n' }, run_command: { command: 'echo hi' },
  computer_click: { x: 5, y: 5 }, computer_key: { key: 'a' }, create_tool: { name: 'q2_tool', description: 'x', script: 'Write-Output 1', parameters: {} },
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
      if (tool && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: tool, arguments: JSON.stringify(tool === 'run_command' && /exit3/.test(asked) ? { command: 'exit 3' } : (ARGS[tool] ?? {})) } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  return base;
}

/** Run one reply that calls `tool` in `mode`; answer cards; say what was asked and whether the tool ran. */
async function run(base, mode, tool, { answer = true, settings = {}, suffix = '' } = {}) {
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ autoJudgeEnabled: false, ...settings }) }); // F12: the check is on by default; these tests are about the modes
  const folder = await mkdtemp(join(tmpdir(), 'bunny-q2-perm-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'perm', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: `call ${tool}${suffix}`, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
  const asked = []; let buf = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) {
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); asked.push(card.title);
        await fetch(`${base}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) });
      }
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  return { asked, status: step?.status ?? 'none', folder, wrote: existsSync(join(folder, 'note.txt')) };
}

// ---------------------------------------------------------------- read tools never ask

for (const mode of ['ask', 'accept', 'auto', 'plan']) {
  test(`${mode}: reading the folder (list_files) never asks`, async (t) => {
    const base = await setup(t);
    const r = await run(base, mode, 'list_files');
    assert.deepEqual(r.asked, []);
    assert.equal(r.status, 'done');
  });
}

// ---------------------------------------------------------------- edits

test('Manual: a file edit asks, and Allow does it', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'write_file');
  assert.equal(r.asked.length, 1); assert.ok(r.wrote);
});
test('Manual: Deny keeps the file out and the model is told not to retry', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'write_file', { answer: false });
  assert.equal(r.asked.length, 1); assert.equal(r.wrote, false); assert.equal(r.status, 'denied');
});
for (const mode of ['accept', 'auto']) {
  test(`${mode}: a file edit goes through without asking`, async (t) => {
    const base = await setup(t);
    const r = await run(base, mode, 'write_file');
    assert.deepEqual(r.asked, []); assert.ok(r.wrote);
  });
}

// ---------------------------------------------------------------- commands

test('Manual and Accept edits: a command asks; Allow runs it', async (t) => {
  const base = await setup(t);
  for (const mode of ['ask', 'accept']) {
    const r = await run(base, mode, 'run_command');
    assert.equal(r.asked.length, 1, mode); assert.equal(r.status, 'done', mode);
  }
});
test('Auto: a command runs without asking', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'run_command');
  assert.deepEqual(r.asked, []); assert.equal(r.status, 'done');
});

// ---------------------------------------------------------------- Plan: nothing but looking

test('Plan: a write the model asks for anyway is refused, with no card and no file', { todo: 'Q2-1: src/server/app.js:2227-2248 runs it' }, async (t) => {
  const base = await setup(t);
  const r = await run(base, 'plan', 'write_file');
  assert.equal(r.wrote, false);
});
test('Plan: a command the model asks for anyway is refused', { todo: 'Q2-1: src/server/app.js:2227-2248 runs it' }, async (t) => {
  const base = await setup(t);
  const r = await run(base, 'plan', 'run_command');
  assert.notEqual(r.status, 'done');
});

// ---------------------------------------------------------------- grants: computer use, tools that build

// Decision (Chief of Staff under the owner's rule, 2026-11-16): in Auto, build actions run without asking; in Manual and
// Accept edits they ask; a granted computer-use click follows the mode (it asks in Manual and Accept edits).
// The Auto computer-use case is NOT driven here: allowing it would click this computer's real screen.
const COMPUTER = { aiComputerUse: true };
for (const mode of ['ask', 'accept']) {
  test(`Computer use granted, ${mode === 'ask' ? 'Manual' : 'Accept edits'}: a click asks (and is denied here, so nothing is clicked)`, { skip: process.platform !== 'win32' && 'computer tools are Windows only' }, async (t) => {
    const base = await setup(t);
    const r = await run(base, mode, 'computer_click', { answer: false, settings: COMPUTER });
    assert.equal(r.asked.length, 1);
  });
}
for (const mode of ['ask', 'accept']) {
  test(`${mode === 'ask' ? 'Manual' : 'Accept edits'}: building a tool asks`, { skip: process.platform !== 'win32' && 'custom tools are Windows only' }, async (t) => {
    const base = await setup(t);
    const r = await run(base, mode, 'create_tool', { answer: false, settings: { customToolsEnabled: true } });
    assert.equal(r.asked.length, 1);
  });
}
test('Q2-26: Auto: building a tool runs without asking (the owner allowed Auto)', { skip: process.platform !== 'win32' && 'custom tools are Windows only', todo: 'Q2-26: src/server/app.js:1510 (needsOk) asks for risk "build" in every mode; Chief of Staff decision 2026-11-16: not in Auto' }, async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'create_tool', { answer: false, settings: { customToolsEnabled: true } });
  assert.deepEqual(r.asked, [], 'asked: ' + r.asked.join(' | '));
});

// ---------------------------------------------------------------- a command that fails is shown as failed (D-2)

test('Q2-29: a command that ends with an error code is a failed step, not a "done" one', { todo: 'Q2-29 (found on the Builder branch at 6ef4ccf): src/server/workspace.js run_command returns "[exit code N]" as text and src/server/app.js logs status "done"; the transcript shows no Failed label' }, async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'run_command', { suffix: ' exit3' });
  assert.equal(r.status, 'failed', `the step is saved as "${r.status}"`);
});
