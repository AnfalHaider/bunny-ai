import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json as getJson } from './helpers.js';

// W4-11: S-5 (helpers know the skills), M-2 (Chat offers connectors), H-1 (a look-only helper and connector tools), P-5 (a plugin on or off as a whole).
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

async function connector(t, toolName) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      res.writeHead(200, jsonH);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: r.method === 'tools/list' ? { tools: [{ name: toolName, description: 'looks', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] } : {} }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

/** A provider that, for the main reply, calls run_subagent once; the helper's request is told apart by its system text. */
async function setup(t, { task = 'look around', readOnly = false } = {}) {
  const main = [];
  const helper = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const isHelper = body.messages.some((m) => m.role === 'system' && /a helper agent/.test(String(m.content)));
      (isHelper ? helper : main).push(body);
      const told = body.messages.find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (isHelper) res.end(sse({ content: 'helper report' }));
      else if (told) res.end(sse({ content: 'done' }));
      else res.end(sse({ tool_calls: [{ index: 0, id: 'h1', function: { name: 'run_subagent', arguments: JSON.stringify({ title: 'Looker', task, read_only: readOnly }) } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const run = async (mode = 'auto') => {
    const { body: session } = await post(base, '/api/sessions', { title: 'misc' });
    await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: mode }) });
    await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) })).text();
  };
  return { base, main, helper, run };
}

test('S-5: a helper is given the skills index and the person\'s standing instructions', async (t) => {
  const s = await setup(t);
  await post(s.base, '/api/skills', { name: 'carrot-math', description: 'Count carrots the careful way', instructions: 'x'.repeat(5000), enabled: true });
  await fetch(`${s.base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ instructions: 'Always answer in French.' }) });
  await s.run();
  assert.ok(s.helper.length > 0, 'a helper ran');
  const system = s.helper[0].messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.match(system, /carrot-math/);
  assert.match(system, /Count carrots the careful way/);
  assert.match(system, /Always answer in French\./);
});

test('M-2: in Chat mode a connector\'s tools are offered', async (t) => {
  const s = await setup(t);
  await post(s.base, '/api/mcp', { name: 'Maps', url: await connector(t, 'find_place') });
  await s.run();
  assert.ok(s.main[0].tools.some((d) => d.function.name === 'maps__find_place'));
});

test('H-1: a look-only helper gets the tools of a connector the person trusts, not those of one that only says it reads', async (t) => {
  const s = await setup(t, { readOnly: true });
  const { body: trusted } = await post(s.base, '/api/mcp', { name: 'Trusted', url: await connector(t, 'look') });
  await post(s.base, '/api/mcp', { name: 'Stranger', url: await connector(t, 'peek') });
  await fetch(`${s.base}/api/mcp/${trusted.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ trustReadOnly: true }) });
  await s.run();
  assert.ok(s.helper.length > 0);
  const names = (s.helper[0].tools ?? []).map((d) => d.function.name);
  assert.ok(names.includes('trusted__look'), names.join(', '));
  assert.ok(!names.includes('stranger__peek'), 'an untrusted label does not make a tool look-only');
});

const REPO = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }),
  'skills/grow/SKILL.md': '---\nname: grow\ndescription: How to grow carrots\n---\nWater them every morning.',
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
};

test('P-5: a plugin is switched off and on as a whole, and uninstalling twice is a no-op', async (t) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.github.com') && u.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(REPO).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
    if (m) return REPO[m[1]] !== undefined ? new Response(REPO[m[1]], { status: 200 }) : new Response('nf', { status: 404 });
    return real(url, init);
  };
  t.after(() => { globalThis.fetch = real; });
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/plugins/install', { url: 'https://github.com/bunny/carrot-helper' });
  const settings = (await getJson(base, '/api/settings')).body;
  const id = settings.plugins[0].id;
  const state = async () => [(await getJson(base, '/api/skills')).body.map((s) => s.enabled), (await getJson(base, '/api/mcp')).body.map((c) => c.enabled)];
  assert.deepEqual(await state(), [[true], [true]]);
  const off = await fetch(`${base}/api/plugins/${id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: false }) });
  assert.equal(off.status, 200);
  assert.deepEqual(await state(), [[false], [false]], 'neither the skill nor the connector is on');
  await fetch(`${base}/api/plugins/${id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: true }) });
  assert.deepEqual(await state(), [[true], [true]]);
  assert.equal((await fetch(`${base}/api/plugins/${id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({}) })).status, 400);
  const first = await fetch(`${base}/api/plugins/${id}`, { method: 'DELETE' });
  assert.equal((await first.json()).ok, true);
  const second = await fetch(`${base}/api/plugins/${id}`, { method: 'DELETE' });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, false, 'the second uninstall is a no-op');
  assert.equal((await fetch(`${base}/api/plugins/${id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: true }) })).status, 404, 'a plugin that is gone cannot be switched');
});
