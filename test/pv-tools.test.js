import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { streamChat, refusesTools } from '../src/server/chat.js';
import { capTools, describeDeferred } from '../src/server/mcp.js';

// W4-11 PV-1 (a provider that refuses tools), PV-2 (too many tools) and PV-3 (the fake provider calls tools).
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
const json = { 'content-type': 'application/json' };
const tool = (name, description = 'does a thing') => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } } });

test('PV-1: a 400 that names the tools is retried without them, once, and the reply goes on', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.tools) return new Response('{"error":{"message":"tools is not supported by this model"}}', { status: 400, headers: json });
    return new Response(sse({ content: 'plain answer' }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  let told = 0;
  let out = '';
  for await (const piece of streamChat({ baseUrl: 'http://x', model: 'm', messages: [{ role: 'user', content: 'hi' }], fetchImpl, tools: [tool('a_tool')], runTool: async () => 'never', onToolsRefused: () => { told += 1; } })) out += piece;
  assert.equal(out, 'plain answer');
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].tools && !bodies[1].tools, 'the second request has no tools');
  assert.equal(told, 1);
});

test('PV-1: a 400 about something else is still an error', async () => {
  const fetchImpl = async () => new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400, headers: json });
  await assert.rejects(async () => { for await (const _ of streamChat({ baseUrl: 'http://x', model: 'm', messages: [{ role: 'user', content: 'hi' }], fetchImpl, tools: [tool('a')], runTool: async () => '' })) { /* nothing */ } }, (err) => err.code === 'chat.http');
  assert.equal(refusesTools({ code: 'chat.http', message: 'The provider answered 400: max_tokens is too large' }), false);
  assert.equal(refusesTools({ code: 'chat.http', message: 'The provider answered 400: Tool use is not supported' }), true);
  assert.equal(refusesTools({ code: 'chat.http', message: 'The provider answered 500: tools are down' }), false);
});

test('PV-2: over the limit only the built-in tools and two small ones are offered, and every connector tool stays reachable', () => {
  const builtin = ['read_file', 'web_search'].map((n) => tool(n));
  const conn = Array.from({ length: 150 }, (_, i) => tool(`big__tool_${i}`, i === 149 ? 'finds the needle' : 'ordinary'));
  const index = new Map(conn.map((d) => [d.function.name, {}]));
  const capped = capTools([...builtin, ...conn], index);
  assert.ok(capped.definitions.length <= 100);
  assert.deepEqual(capped.definitions.map((d) => d.function.name).sort(), ['call_connector_tool', 'list_connector_tools', 'read_file', 'web_search']);
  assert.equal(capped.deferred.size, 150);
  assert.match(describeDeferred(capped.deferred, 'needle'), /^big__tool_149: finds the needle$/);
  assert.match(describeDeferred(capped.deferred), /more: narrow it with match/);
  // under the limit nothing changes
  const small = capTools([...builtin, ...conn.slice(0, 5)], new Map(conn.slice(0, 5).map((d) => [d.function.name, {}])));
  assert.equal(small.definitions.length, 7);
  assert.equal(small.deferred.size, 0);
});

test('PV-3: the fake provider calls the tool a [[call ...]] line names, through the real loop, and says what it got', async () => {
  const ran = [];
  let out = '';
  for await (const piece of streamChat({
    baseUrl: 'http://x', model: 'm', fake: true,
    messages: [{ role: 'user', content: 'do it [[call echo {"text":"hi"}]] [[call echo {"text":"again"}]]' }],
    tools: [tool('echo')], runTool: async ({ name, arguments: args }) => { ran.push([name, JSON.parse(args)]); return `echoed ${JSON.parse(args).text}`; },
  })) out += piece;
  assert.deepEqual(ran, [['echo', { text: 'hi' }], ['echo', { text: 'again' }]]);
  assert.match(out, /Scripted: echoed again/);
});

/** A connector with 150 tools, over http. */
async function bigConnector(t) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      const result = r.method === 'tools/list'
        ? { tools: Array.from({ length: 150 }, (_, i) => ({ name: `t${i}`, description: i === 149 ? 'finds the needle' : 'ordinary', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })) }
        : r.method === 'tools/call' ? (calls.push(r.params), { content: [{ type: 'text', text: `ran ${r.params?.name}` }] }) : {};
      res.writeHead(200, json);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return { calls, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

test('PV-2 through a real reply: 150 connector tools are not all sent, and the model reaches one through call_connector_tool', async (t) => {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const result = body.messages.find((m) => m.role === 'tool');
      const delta = result
        ? { content: `got: ${result.content}` }
        : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'call_connector_tool', arguments: JSON.stringify({ name: 'big__t149', arguments: {} }) } }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(delta));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const connector = await bigConnector(t);
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ defaultPermissionMode: 'auto' }) });
  const { body: added } = await post(base, '/api/mcp', { name: 'Big', url: connector.url });
  await fetch(`${base}/api/mcp/${added.id}/tools`).then(() => fetch(`${base}/api/mcp/${added.id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ trustReadOnly: true }) })); // RO-1: its read-only labels are trusted, so no question card
  const { body: session } = await post(base, '/api/sessions', { title: 'Big' });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content: 'use the needle tool', providerId: 'openai', model: 'gpt-4o' }) });
  const text = await res.text();
  assert.ok(seen[0].tools.length <= 100, `sent ${seen[0].tools.length} tools`);
  assert.ok(seen[0].tools.some((d) => d.function.name === 'call_connector_tool'));
  assert.ok(!seen[0].tools.some((d) => d.function.name === 'big__t149'), 'a connector tool is not listed in the request');
  assert.deepEqual(connector.calls.map((c) => c.name), ['t149'], text.slice(-300));
  assert.match(text, /got: .*ran t149/);
});

// ---- PV-2 must not become a permission bypass: a connector tool reached through call_connector_tool is held to the same rules
/** One reply where the model calls big__t149 through call_connector_tool (or directly, when `direct`). */
async function viaMeta(t, { mode, answer = false, count = 150, direct = false }) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const told = body.messages.find((m) => m.role === 'tool');
      const call = direct
        ? { name: `big__t${count - 1}`, arguments: '{}' }
        : { name: 'call_connector_tool', arguments: JSON.stringify({ name: `big__t${count - 1}`, arguments: {} }) };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(told ? { content: `got: ${told.content}` } : { tool_calls: [{ index: 0, id: 'c1', function: call }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const calls = [];
  const connector = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      // the connector labels EVERY tool read-only: a hostile label (RO-1), not trusted by the person
      const result = r.method === 'tools/list'
        ? { tools: Array.from({ length: count }, (_, i) => ({ name: `t${i}`, description: 'ordinary', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })) }
        : r.method === 'tools/call' ? (calls.push(r.params.name), { content: [{ type: 'text', text: `ran ${r.params.name}` }] }) : {};
      res.writeHead(200, json);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => connector.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { connector.closeAllConnections?.(); connector.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  await post(base, '/api/mcp', { name: 'Big', url: `http://127.0.0.1:${connector.address().port}/mcp` });
  const { body: session } = await post(base, '/api/sessions', { title: 'PV2' });
  if (mode) await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: json, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content: 'use it', providerId: 'openai', model: 'gpt-4o' }) });
  const reader = res.body.getReader();
  let text = '';
  let card = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const m = !card && /event: permission\ndata: (.*)\n/.exec(text);
    if (m) { card = JSON.parse(m[1]); await post(base, `/api/sessions/${session.id}/permission/${card.id}`, { allowed: answer }); }
  }
  return { card, calls, text, seen };
}

test('PV-2 and Ask mode: a tool reached through call_connector_tool shows the same permission card as a direct call, and "no" stops it', async (t) => {
  const meta = await viaMeta(t, { mode: 'ask', answer: false });
  assert.ok(meta.seen[0].tools.some((d) => d.function.name === 'call_connector_tool'), 'the tool list was capped');
  assert.ok(meta.card, 'the permission card was shown');
  assert.deepEqual(meta.calls, [], 'a no stopped the tool');
  assert.match(meta.text, /did not allow/);
  const direct = await viaMeta(t, { mode: 'ask', answer: false, count: 5, direct: true });
  assert.ok(!direct.seen[0].tools.some((d) => d.function.name === 'call_connector_tool'), 'a small connector is not capped');
  assert.ok(direct.card, 'the direct call asked too');
  assert.equal(meta.card.title, 'Big: t149', 'the card names the real tool, not call_connector_tool');
  assert.equal(direct.card.title, 'Big: t4', 'the same kind of card for a direct call');
});

test('PV-2 and Ask mode: "yes" runs it once', async (t) => {
  const r = await viaMeta(t, { mode: 'ask', answer: true });
  assert.ok(r.card);
  assert.deepEqual(r.calls, ['t149']);
});

test('PV-2 and Plan mode: a may-write tool (its read-only label is not trusted) is refused through call_connector_tool, with no card', async (t) => {
  const r = await viaMeta(t, { mode: 'plan' });
  assert.equal(r.card, null);
  assert.deepEqual(r.calls, []);
  assert.match(r.text, /no connector tool called|not available/);
});

test('PV-1 combined: a provider refuses tools, the retry without tools fails too, and the error is the retry\'s (so the next model is tried), with no more than two requests', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.tools) return new Response('{"error":{"message":"tools is not supported by this model"}}', { status: 400, headers: json });
    return new Response('{"error":{"message":"upstream exploded"}}', { status: 500, headers: json });
  };
  let told = 0;
  await assert.rejects(async () => {
    for await (const _ of streamChat({ baseUrl: 'http://x', model: 'm', messages: [{ role: 'user', content: 'hi' }], fetchImpl, tools: [tool('a')], runTool: async () => '', onToolsRefused: () => { told += 1; } })) { /* nothing */ }
  }, (err) => err.code === 'chat.http' && /500/.test(err.message) && /upstream exploded/.test(err.message));
  assert.equal(bodies.length, 2, 'asked once with tools, once without, and no more');
  assert.equal(told, 1);
});

test('PV-2: the size limit counts the connectors\' tools only: big built-in tool sets (Code mode) do not hide a small connector', () => {
  const builtin = Array.from({ length: 60 }, (_, i) => tool(`builtin_${i}`, 'd'.repeat(500)));
  const conn = [tool('rows__dump')];
  const capped = capTools([...builtin, ...conn], new Map([['rows__dump', {}]]));
  assert.equal(capped.deferred.size, 0, 'the connector tool is offered directly');
  assert.equal(capped.definitions.length, 61);
});
