import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

// WEB-ACCESS (v0.1.14): "use the internet" reaches a model that has web_search, also when the provider refuses tools once, and Quick ask may look things up.
const json = { 'content-type': 'application/json' };
const mcpReply = (res, id, result) => { res.writeHead(200, json); res.end(JSON.stringify({ jsonrpc: '2.0', id, result })); };

/** A connector stand-in (two tools, like the owner's Context7 and DeepWiki). */
async function connector(t, tools = ['resolve-library-id', 'get-library-docs']) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      if (r.method === 'tools/list') return mcpReply(res, r.id, { tools: tools.map((name) => ({ name, description: `${name} of a connector`, inputSchema: { type: 'object', properties: {} } })) });
      return mcpReply(res, r.id, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

/** A provider stand-in that records every request; `refuse(body)` may answer a tools refusal. */
async function provider(t, refuse = () => false) {
  const seen = [];
  const up = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })); }
      const body = JSON.parse(raw);
      seen.push(body);
      if (refuse(body)) { res.writeHead(400, json); return res.end('{"error":{"message":"tools is not supported by this model"}}'); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { up.closeAllConnections?.(); up.close(r); }));
  return { seen, url: `http://127.0.0.1:${up.address().port}/v1` };
}

async function setup(t, { refuse, withConnectors = true } = {}) {
  const { base } = await startApp(t, { fake: false });
  const up = await provider(t, refuse);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: up.url });
  if (withConnectors) {
    await post(base, '/api/mcp', { name: 'Context7', url: await connector(t) });
    await post(base, '/api/mcp', { name: 'DeepWiki', url: await connector(t, ['read_wiki_structure', 'read_wiki_contents', 'ask_question']) });
  }
  const { body: session } = await post(base, '/api/sessions', { title: 'web' });
  const send = async (content, extra = {}) => { const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content, providerId: 'openai', model: 'm1', ...extra }) }); return res.text(); };
  return { base, up, send, session };
}
const names = (request) => (request.tools ?? []).map((d) => d.function.name);
const systemText = (request) => request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

test('"use the internet" with two connectors on: web_search and read_url are in the request, beside the connectors tools, and the text says the web can be searched', async (t) => {
  const { up, send } = await setup(t);
  await send('use the internet');
  const last = up.seen.at(-1);
  assert.ok(names(last).includes('web_search') && names(last).includes('read_url'), names(last).join(','));
  assert.ok(names(last).some((n) => /resolve/.test(n)) && names(last).some((n) => /ask_question/.test(n)), 'the connector tools are there too');
  assert.match(systemText(last), /search and read the web/);
  assert.match(systemText(last), /Connectors: Context7 \(2 tools\), DeepWiki \(3 tools\)/);
});

test('a provider that refuses the tool list: the retry keeps Bunny\'s own tools (web_search), drops only the connectors, and the next message starts there', async (t) => {
  // the stand-in refuses any request that carries a connector tool (as one odd schema would)
  const hasConnector = (body) => (body.tools ?? []).some((d) => /resolve|ask_question/.test(d.function.name));
  const { up, send } = await setup(t, { refuse: hasConnector });
  const text = await send('use the internet');
  assert.match(text, /Connector tools are off for this model/);
  assert.equal(up.seen.length, 2);
  assert.ok(hasConnector(up.seen[0]));
  assert.ok(names(up.seen[1]).includes('web_search') && names(up.seen[1]).includes('read_url'), 'the retry still has the web tools');
  assert.ok(!hasConnector(up.seen[1]));
  await send('use the internet again');
  assert.equal(up.seen.length, 3, 'no second refusal: the chat remembers the narrower list');
  assert.ok(names(up.seen[2]).includes('web_search') && !hasConnector(up.seen[2]));
});

test('a provider that refuses every tool: no tools, and the model is told so (it is not left believing it can search or use connectors)', async (t) => {
  const { up, send } = await setup(t, { refuse: (body) => Array.isArray(body.tools) && body.tools.length > 0 });
  const text = await send('use the internet');
  assert.match(text, /Tools are off for this model/);
  assert.match(text, /no web search/);
  const last = up.seen.at(-1);
  assert.equal('tools' in last, false);
  assert.match(systemText(last), /No tools are available in this reply/);
  await send('and now?');
  assert.match(systemText(up.seen.at(-1)), /No tools are available in this reply/, 'the next message in this chat says so from the start');
  assert.equal('tools' in up.seen.at(-1), false);
});

test('Quick ask: the only tools are web_search and read_url, the text asks for sources, and nothing else can be run', async (t) => {
  const { up, send } = await setup(t, { withConnectors: false });
  await send('what is the weather in Islamabad?', { textOnly: true });
  const last = up.seen.at(-1);
  assert.deepEqual(names(last).sort(), ['read_url', 'web_search']);
  assert.match(systemText(last), /only tools you have are web_search and read_url/);
  assert.match(systemText(last), /which sites the facts came from, with their links/);
  assert.match(systemText(last), /\[\[NEEDS_BUNNY_WINDOW\]\]/);
  assert.doesNotMatch(systemText(last), /request_capability|code_mode|computer_use|run_subagent|search_plugins|ask_user|create_artifact|move_to_new_chat|create_tool/);
});
