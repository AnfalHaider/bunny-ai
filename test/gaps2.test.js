import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';
import { clip } from '../src/server/clip.js';
import { createWorkspace } from '../src/server/workspace.js';
import { parseImport } from '../src/server/import.js';
import { buildHistory } from '../src/server/history.js';

const windows = process.platform === 'win32';

test('long output keeps its start and its end, where the error is', () => {
  const text = `START ${'x'.repeat(50_000)} ERROR: missing module`;
  const out = clip(text, 2000);
  assert.ok(out.length <= 2000);
  assert.match(out, /^START/);
  assert.match(out, /ERROR: missing module$/);
  assert.match(out, /characters left out/);
  assert.equal(clip('short', 2000), 'short');
});

test('a failed command puts its exit code first and keeps the end of a long output', { skip: !windows }, async () => {
  const ws = createWorkspace(await mkdtemp(join(tmpdir(), 'bunny-gap-')));
  const out = await ws.run('run_command', { command: '1..3000 | ForEach-Object { "line $_" }; Write-Output "THE REAL ERROR"; exit 3' });
  assert.match(out, /^\[exit code 3\]/);
  assert.match(out, /THE REAL ERROR/);
});

test('Stop ends a running command at once, with everything it started', { skip: !windows }, async () => {
  const controller = new AbortController();
  const ws = createWorkspace(await mkdtemp(join(tmpdir(), 'bunny-gap-')), { signal: () => controller.signal });
  const began = Date.now();
  setTimeout(() => controller.abort(), 1500);
  const out = await ws.run('run_command', { command: 'cmd /c "ping -n 60 127.0.0.1 > nul"' });
  assert.ok(Date.now() - began < 15_000, `took ${Date.now() - began}ms`);
  assert.match(out, /stopped by the person/);
});

test('imports read JSON Lines, message lists nested anywhere, parts arrays and more Markdown headings', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello there' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi!' }, { type: 'tool_use', name: 'x' }] } }),
    'not json',
  ].join('\n');
  assert.deepEqual(parseImport(jsonl).messages.map((m) => [m.role, m.content]), [['user', 'hello there'], ['assistant', 'hi!']]);
  const nested = { meta: { title: 'Trip plan' }, sessions: [{ subagents: [], turns: [{ author: 'human', text: 'plan a trip' }, { author: 'model', text: 'Sure.' }] }] };
  assert.deepEqual(parseImport(JSON.stringify(nested)).messages.map((m) => m.role), ['user', 'assistant']);
  const md = '# Notes\n\n**User:**\nwhat is 2+2\n\n**Assistant:**\n4\n\n### Human\nthanks';
  assert.deepEqual(parseImport(md).messages.map((m) => [m.role, m.content]), [['user', 'what is 2+2'], ['assistant', '4'], ['user', 'thanks']]);
});

test('a large import (over the normal request limit) goes through', async (t) => {
  const { base } = await startApp(t);
  const messages = Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i} ${'word '.repeat(1500)}` }));
  const content = JSON.stringify({ title: 'Big one', messages });
  assert.ok(content.length > 2 * 1024 * 1024);
  const { status, body } = await post(base, '/api/import', { content });
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.equal(body.imported, 400);
  assert.equal(body.session.title, 'Big one');
});

test('saved errors stay in the chat but never reach the model', () => {
  const plain = (m) => ({ role: m.role, content: String(m.content ?? '') });
  const { history } = buildHistory([
    { role: 'user', content: 'go' },
    { role: 'assistant', kind: 'tool_call', tool: 'Run build', status: 'done', result: 'ok' },
    { role: 'assistant', kind: 'error', content: 'model x could not finish: 429' },
  ], plain);
  assert.ok(!JSON.stringify(history).includes('could not finish'));
  assert.equal(history.at(-1).role, 'user');
});

test('a model error is saved in the chat as the reason the reply stopped', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"This model does not support tool use"}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Err' });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hi', providerId: 'openai', model: 'gpt-4o' }) });
  assert.match(await res.text(), /event: error/);
  const saved = await (await fetch(`${base}/api/sessions/${session.id}`)).json();
  assert.equal(saved.messages.at(-1).kind, 'error');
  assert.match(saved.messages.at(-1).content, /does not support tool use/);
});

test('a started program understands && chains too', { skip: !windows }, async () => {
  const { createProcessStore } = await import('../src/server/processes.js');
  const store = createProcessStore();
  const p = store.start({ command: 'echo first && echo second', cwd: await mkdtemp(join(tmpdir(), 'bunny-gap-')), owner: 't' });
  const r = await store.settle(p.id, 't', 10);
  await store.stopAll();
  assert.match(r.output, /first[\s\S]*second/);
});
