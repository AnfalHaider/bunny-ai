import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';

// W4-11 D-3: a big result from a connector is saved whole in .bunny/notes (Code mode, a workspace, not Plan mode, nothing that looks like a secret).
const jsonH = { 'content-type': 'application/json' };
const BIG = 'row of data\n'.repeat(1000); // 12,000 characters

async function callBig(t, { mode = 'auto', workMode = 'code', text = BIG } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-d3-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const connector = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      res.writeHead(200, jsonH);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: r.method === 'tools/list'
        ? { tools: [{ name: 'dump', description: 'dumps rows', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
        : r.method === 'tools/call' ? { content: [{ type: 'text', text }] } : {} }));
    });
  });
  await new Promise((r) => connector.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { connector.closeAllConnections?.(); connector.close(r); }));
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = seen.length === 1 ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'rows__dump', arguments: '{}' } }] } : { content: 'ok' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: added } = await post(base, '/api/mcp', { name: 'Rows', url: `http://127.0.0.1:${connector.address().port}/mcp` });
  await fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ trustReadOnly: true }) });
  const { body: session } = await post(base, '/api/sessions', { title: 'D3' });
  const patch = (k, v) => fetch(`${base}/api/sessions/${session.id}/setting/${k}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: v }) });
  await patch('permissionMode', mode);
  if (workMode === 'code') await patch('folder', folder);
  const streamText = await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'dump it', providerId: 'openai', model: 'gpt-4o', workMode }) })).text();
  const notes = await readdir(join(folder, '.bunny', 'notes')).catch(() => []);
  const steps = (await (await fetch(`${base}/api/sessions/${session.id}`)).json()).messages.filter((m) => m.kind === 'tool_call');
  return { folder, notes, steps };
}

test('D-3: in Code mode a big connector result is saved whole in .bunny/notes, and the step says where', async (t) => {
  const r = await callBig(t);
  assert.equal(r.notes.length, 1, r.notes.join(', '));
  assert.equal(await readFile(join(r.folder, '.bunny', 'notes', r.notes[0]), 'utf8'), BIG);
  assert.equal(r.steps.at(-1).resultFile, `.bunny/notes/${r.notes[0]}`);
});

test('D-3: not in Plan mode, not in Chat mode (no workspace), and not when the result looks like a secret', async (t) => {
  assert.deepEqual((await callBig(t, { mode: 'plan' })).notes, [], 'Plan mode is read-only');
  assert.deepEqual((await callBig(t, { workMode: 'chat' })).notes, [], 'no workspace');
  const key = `api_key = "sk-live-${'a1b2c3d4'.repeat(6)}"\n`;
  assert.deepEqual((await callBig(t, { text: key + BIG })).notes, [], 'a secret is not written to disk');
});
