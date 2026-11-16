/** Q2-29: a command that exits non-zero is a FAILED step, with the command and the output kept (the owner's "[exit code 1] marked done"). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

const windows = process.platform === 'win32';
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

async function runner(t, command) {
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"runner"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.messages.some((m) => m.role === 'tool')) { res.end(frame({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      res.end(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-exit-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'x', providerId: 'openai', model: 'runner' });
  const j = { 'content-type': 'application/json' };
  for (const [k, v] of [['folder', folder], ['workMode', 'code'], ['permissionMode', 'auto']]) await fetch(`${base}/api/sessions/${s.id}/setting/${k}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: v }) });
  await (await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'runner', workMode: 'code' }) })).text();
  return (await (await fetch(`${base}/api/sessions/${s.id}`)).json()).messages.find((m) => m.kind === 'tool_call');
}

test('a command that exits 3 is a failed step with the command and its output kept', { skip: !windows && 'PowerShell only' }, async (t) => {
  const step = await runner(t, 'Write-Output oops; exit 3');
  assert.equal(step.status, 'failed');
  assert.equal(step.content, 'Write-Output oops; exit 3');
  assert.match(step.result, /^\[exit code 3\]/);
  assert.match(step.result, /oops/);
});

test('a command that succeeds is done, and its command is still shown', { skip: !windows && 'PowerShell only' }, async (t) => {
  const step = await runner(t, 'Write-Output fine');
  assert.equal(step.status, 'done');
  assert.equal(step.content, 'Write-Output fine');
});
