import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { relistReason, TOOL_LIST_MAX_AGE_MS } from '../src/server/mcp.js';

// W4-11 L-3: a connector that failed once comes back without the person pressing Check, and a list is asked for again after an hour.
const jsonH = { 'content-type': 'application/json' };

test('L-3: when a connector is asked for its tools again', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
  assert.equal(relistReason({ tools: [], status: 'unknown' }, now), 'new');
  assert.equal(relistReason({ tools: [{ name: 'a' }], status: 'connected', checkedAt: hoursAgo(0.5) }, now), null, 'a fresh list is kept');
  assert.equal(relistReason({ tools: [{ name: 'a' }], status: 'connected', checkedAt: hoursAgo(2) }, now), 'stale', 'an old list is asked for again');
  assert.equal(relistReason({ tools: [], status: 'error', type: undefined }, now), 'retry', 'a remote connector that failed is tried again');
  assert.equal(relistReason({ tools: [], status: 'error', type: 'local' }, now), null, 'a local one is not (starting a program can take minutes)');
  assert.ok(TOOL_LIST_MAX_AGE_MS >= 3600_000);
});

test('L-3: a remote connector that was down is offered again in a later reply, with no manual check', async (t) => {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  let up = false;
  const connector = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      if (!up) { res.writeHead(503, jsonH).end('{"error":"down"}'); return; }
      res.writeHead(200, jsonH);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: r.method === 'tools/list' ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } : {} }));
    });
  });
  await new Promise((r) => connector.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { connector.closeAllConnections?.(); connector.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  await post(base, '/api/mcp', { name: 'Flaky', url: `http://127.0.0.1:${connector.address().port}/mcp` });
  const { body: session } = await post(base, '/api/sessions', { title: 'L3' });
  const say = async (content) => (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) })).text();
  await say('one');
  assert.ok(!(seen[0].tools ?? []).some((d) => d.function.name === 'flaky__ping'), 'down: not offered');
  assert.ok(seen[0].messages.some((m) => m.role === 'system' && /Flaky \(not connected/.test(String(m.content))), 'and the model is told');
  up = true;
  await say('two');
  assert.ok((seen[1].tools ?? []).some((d) => d.function.name === 'flaky__ping'), 'back up: offered again, nobody pressed Check');
});
