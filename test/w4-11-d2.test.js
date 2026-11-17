import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { mcpResultText } from '../src/server/mcp.js';

// W4-11 D-2: a picture from a connector reaches a model that can see, and any other model is told there was one.
const jsonH = { 'content-type': 'application/json' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('D-2: with vision, a png part becomes a data address and the text says it follows; without, only the placeholder', () => {
  const result = { content: [{ type: 'text', text: 'chart:' }, { type: 'image', mimeType: 'image/png', data: PNG }] };
  const seen = mcpResultText(result, { vision: true });
  assert.deepEqual(seen.images, [`data:image/png;base64,${PNG}`]);
  assert.match(seen.text, /^chart:\n\[image: image\/png, \d+ KB, shown after this answer\]$/);
  const blind = mcpResultText(result);
  assert.deepEqual(blind.images, []);
  assert.match(blind.text, /not shown here\]$/);
});

test('D-2: only png, jpeg, gif and webp, only clean base64, at most two pictures, none over 4 MB', () => {
  const part = (mimeType, data) => ({ type: 'image', mimeType, data });
  const r = mcpResultText({ content: [part('image/svg+xml', PNG), part('image/png', 'not base64!!'), part('image/png', 'A'.repeat(6 * 1024 * 1024)), part('image/png', PNG), part('image/jpeg', PNG), part('image/webp', PNG)] }, { vision: true });
  assert.equal(r.images.length, 2, 'two at most');
  assert.ok(r.images.every((u) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u)));
  assert.equal((r.text.match(/shown after this answer/g) ?? []).length, 2);
  assert.equal((r.text.match(/not shown here/g) ?? []).length, 4);
});

async function reply(t, { vision }) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const told = body.messages.find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: told ? { content: 'seen' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'charts__plot', arguments: '{}' } }] } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const connector = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      res.writeHead(200, jsonH);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: r.method === 'tools/list'
        ? { tools: [{ name: 'plot', description: 'draws', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
        : r.method === 'tools/call' ? { content: [{ type: 'text', text: 'here' }, { type: 'image', mimeType: 'image/png', data: PNG }] } : {} }));
    });
  });
  await new Promise((r) => connector.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { connector.closeAllConnections?.(); connector.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: added } = await post(base, '/api/mcp', { name: 'Charts', url: `http://127.0.0.1:${connector.address().port}/mcp` });
  await fetch(`${base}/api/mcp/${added.id}/tools`).then(() => fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ trustReadOnly: true }) }));
  const { body: session } = await post(base, '/api/sessions', { title: 'D2' });
  await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'plot it', providerId: 'openai', model: 'gpt-4o', vision }) })).text();
  return seen.at(-1).messages;
}

test('D-2 through a real reply: a model that can see gets the picture in the next request; one that cannot gets the placeholder only', async (t) => {
  const withEyes = await reply(t, { vision: true });
  const pictures = withEyes.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url');
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].image_url.url, `data:image/png;base64,${PNG}`);
  const blind = await reply(t, { vision: false });
  assert.equal(blind.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length, 0);
  assert.match(JSON.stringify(blind), /not shown here/);
});
