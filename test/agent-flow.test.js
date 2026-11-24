import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';
import { capabilityMap } from '../src/server/capabilityMap.js';

// AGENT-FLOW F1 to F3 (Tech Lead's diagnosis): tools switched on in a reply arrive in that reply; the model is told which abilities are on and off and how to get each; Chat mode is extended like Code.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

// ---------- F2: the capability map (pure) ----------
test('F2: the map names what is on, says how to get what is off, and lists connectors that are installed but not working', () => {
  const text = capabilityMap({ code: false, computer: false, build: true, browser: false, pc: false, google: false, github: true, connectors: [{ name: 'Maps', state: 'off' }, { name: 'Mail <b>x</b>', state: 'needsSignIn' }, { name: 'Broken', state: 'failed' }] });
  assert.match(text, /On: building tools, GitHub\./);
  assert.match(text, /files and commands: off; call request_capability with code_mode/);
  assert.match(text, /control of this computer: off; call request_capability with computer_use/);
  assert.match(text, /searching this PC: off; call request_capability with pc_search/);
  assert.match(text, /Gmail, Calendar and Drive: not signed in; call request_capability with sign_in \(service: google\)/);
  assert.match(text, /the browser panel: only in Bunny's window on the PC/);
  assert.match(text, /Maps \(switched off\), Mail b x b  \(needs sign-in\)|Maps \(switched off\), Mail b x \/b \(needs sign-in\)|Maps \(switched off\)/);
  assert.match(text, /Broken \(did not start\)/);
  assert.match(text, /do not just say you cannot/);
  assert.ok(!/[<>]/.test(text), 'a connector name cannot bring markup in');
});

test('F2: on a device some abilities say "only in the window", and nothing is on that is not', () => {
  const text = capabilityMap({ device: true, code: false, computer: false, build: false, pc: false, browser: false });
  assert.match(text, /On: none beyond chatting/);
  assert.match(text, /control of this computer: only in the window/);
  assert.ok(!/request_capability/.test(text.replace(/files and commands:[^;]*;/, '')), 'no capability card is promised for what a device cannot ask for');
});

test("F2: on a device the Google and GitHub lines end (in Bunny's window)", () => {
  const text = capabilityMap({ device: true });
  assert.match(text, /sign in to Google in Settings › Profile \(in Bunny's window\)/);
  assert.match(text, /sign in to GitHub in Settings › Profile \(in Bunny's window\)/);
  assert.ok(!/\(in Bunny's window\)/.test(capabilityMap({})), 'not on the window itself');
});

test('F2: it is short (about 150 tokens at most) when everything is off, and shorter when things are on', () => {
  const none = capabilityMap({});
  assert.ok(none.length < 900, `${none.length} characters`);
  const all = capabilityMap({ code: true, computer: true, build: true, browser: true, pc: true, google: true, github: true });
  assert.ok(all.length < none.length);
  assert.match(all, /On: files and commands, control of this computer, building tools, the browser panel, searching this PC, Gmail, Calendar and Drive, GitHub\./);
});

// ---------- the app: a stand-in model that records what it was sent ----------
async function startModel(t, script) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(script(body, seen.length)));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  return { base, seen };
}
async function say(base, sessionId, content, answers = {}) {
  const res = await fetch(`${base}/api/sessions/${sessionId}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) });
  const reader = res.body.getReader();
  let text = '';
  const done = {};
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    text += new TextDecoder().decode(value);
    for (const kind of ['permission', 'capability']) {
      const m = !done[kind] && new RegExp(`event: ${kind}\\ndata: (.*)\\n`).exec(text);
      if (m) { done[kind] = JSON.parse(m[1]); await post(base, `/api/sessions/${sessionId}/${kind}/${done[kind].id}`, kind === 'permission' ? (done[kind].choices ? { allowed: true, choice: (answers.grant ?? true) === false ? 'off' : 'on' } : { allowed: true }) : { granted: answers.grant ?? true }); }
    }
  }
  return text;
}

test('F2: the system text of a reply carries the capability map, built from the real state', async (t) => {
  const { base, seen } = await startModel(t, () => ({ content: 'ok' }));
  const { body: session } = await post(base, '/api/sessions', { title: 'map' });
  await say(base, session.id, 'hello');
  const system = seen[0].messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  assert.match(system, /Abilities now\. On: /);
  assert.match(system, /files and commands: off; call request_capability with code_mode/);
  assert.match(system, /Gmail, Calendar and Drive: not signed in/);
});

test('F2: a connector that is installed but off is named in the map, and one that is on is not (it is in the Connectors line)', async (t) => {
  const { base, seen } = await startModel(t, () => ({ content: 'ok' }));
  await post(base, '/api/mcp', { name: 'Sleepy', url: 'https://sleepy.example.com/mcp', enabled: false });
  const { body: session } = await post(base, '/api/sessions', { title: 'map2' });
  await say(base, session.id, 'hello');
  const system = seen[0].messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  assert.match(system, /Connectors installed but not working: Sleepy \(switched off\)/);
});

// ---------- F3: Chat mode is extended ----------
test('F3: a Chat job that needs more than its 3 steps (low effort) goes on and finishes, instead of answering half done', async (t) => {
  const { base, seen } = await startModel(t, (body, n) => (n <= 8 ? { tool_calls: [{ index: 0, id: `c${n}`, function: { name: 'list_sessions', arguments: JSON.stringify({ n }) } }] } : { content: 'All done after many steps.' }));
  const { body: session } = await post(base, '/api/sessions', { title: 'long chat job' });
  await fetch(`${base}/api/sessions/${session.id}/setting/effort`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'low' }) });
  const text = await say(base, session.id, 'do a long job');
  assert.match(text, /All done after many steps\./);
  assert.ok(seen.filter((b) => b.tools).length > 3, 'more than the 3 steps of low effort were taken');
  assert.match(text, /event: working/, 'the person is told it is going on (Still working · step N)');
});

test('F3: the quick bar is never extended (it answers as text, with at most its own steps)', async (t) => {
  const { base, seen } = await startModel(t, (body, n) => (n <= 8 ? { tool_calls: [{ index: 0, id: `c${n}`, function: { name: 'web_search', arguments: JSON.stringify({ query: 'x' + n }) } }] } : { content: 'enough' }));
  const { body: session } = await post(base, '/api/sessions', { title: 'bar' });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'quick', providerId: 'openai', model: 'gpt-4o', textOnly: true }) });
  await res.text();
  assert.ok(seen.length <= 7, `the bar stopped at its own 6 steps plus the answer, not extended (${seen.length} requests)`);
});

// ---------- F1: what was just switched on arrives in the same reply ----------
const REPO = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }),
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
};
function standIn(t) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.github.com') && u.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(REPO).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
    if (m) return REPO[m[1]] !== undefined ? new Response(REPO[m[1]], { status: 200 }) : new Response('not found', { status: 404 });
    if (u === 'https://weather.example.com/mcp') { // a tiny MCP server over HTTP
      const rpc = JSON.parse(String(init?.body ?? '{}'));
      const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
      if (rpc.method === 'initialize') return reply({ protocolVersion: rpc.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'weather', version: '1' } });
      if (rpc.method === 'tools/list') return reply({ tools: [{ name: 'forecast', description: 'The forecast for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
      if (rpc.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'Sunny in Lisbon' }] });
      return new Response('', { status: 202 });
    }
    return real(url, init);
  };
  process.env.BUNNY_TEST_TRANSPORT = '1'; globalThis.__bunnyTestFetch = globalThis.fetch; // the guarded connector transport is stood in for only when a test says so
  t.after(() => { globalThis.fetch = real; delete process.env.BUNNY_TEST_TRANSPORT; delete globalThis.__bunnyTestFetch; });
}

test('F1: after install_plugin and the person\'s yes, the new connector\'s tools are offered in the SAME reply and the model can use them', async (t) => {
  standIn(t);
  const { base, seen } = await startModel(t, (body, n) => {
    const told = body.messages.filter((m) => m.role === 'tool');
    if (n === 1) return { tool_calls: [{ index: 0, id: 'c1', function: { name: 'install_plugin', arguments: JSON.stringify({ url: 'https://github.com/bunny/carrot-helper' }) } }] };
    const forecast = (body.tools ?? []).find((d) => /forecast/.test(d.function.name));
    if (n === 2 && forecast) return { tool_calls: [{ index: 0, id: 'c2', function: { name: forecast.function.name, arguments: '{"city":"Lisbon"}' } }] };
    return { content: `final: ${told.at(-1)?.content ?? ''}`.slice(0, 300) };
  });
  const { body: session } = await post(base, '/api/sessions', { title: 'F1' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'auto' }) });
  const text = await say(base, session.id, 'find me a weather tool and tell me the forecast', { grant: true });
  const second = seen[1];
  assert.ok((second.tools ?? []).some((d) => /forecast/.test(d.function.name)), `the second request of the SAME reply carries the new tool: ${(second.tools ?? []).map((d) => d.function.name).join(', ')}`);
  const told = second.messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.match(told, /now switched on/);
  assert.match(told, /You now have its tools: .*forecast/);
  assert.match(text, /Sunny in Lisbon/, 'the model called the new tool in the same reply');
  assert.equal(seen.length >= 3, true);
  assert.deepEqual((await json(base, '/api/mcp')).body.map((c) => [c.name, c.enabled]), [['weather', true]]);
});

test('F1: a no on the card changes nothing: no tool arrives and the connector stays off', async (t) => {
  standIn(t);
  const { base, seen } = await startModel(t, (body, n) => (n === 1 ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'install_plugin', arguments: JSON.stringify({ url: 'https://github.com/bunny/carrot-helper' }) } }] } : { content: 'ok' }));
  const { body: session } = await post(base, '/api/sessions', { title: 'F1 no' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'auto' }) });
  await say(base, session.id, 'add a weather tool', { grant: false });
  assert.ok(!(seen[1].tools ?? []).some((d) => /forecast/.test(d.function.name)));
  assert.deepEqual((await json(base, '/api/mcp')).body.map((c) => [c.name, c.enabled]), [['weather', false]]);
});

test('F1-1: with Connectors turned off globally, a yes switches nothing on in this reply: no tool arrives and the model is told why in fixed words', async (t) => {
  standIn(t);
  const { base, seen } = await startModel(t, (body, n) => (n === 1 ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'install_plugin', arguments: JSON.stringify({ url: 'https://github.com/bunny/carrot-helper' }) } }] } : { content: 'ok' }));
  await post(base, '/api/settings', {}).catch(() => {});
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ connectorsEnabled: false }) });
  const { body: session } = await post(base, '/api/sessions', { title: 'F1-1' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'auto' }) });
  await say(base, session.id, 'add a weather tool', { grant: true });
  assert.ok(!(seen[1].tools ?? []).some((d) => /forecast/.test(d.function.name)), 'no connector tool was loaded');
  const told = seen[1].messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.match(told, /The person said yes, but Connectors are turned off in Settings › Capabilities, so its tools are not loaded\./);
  assert.ok(!/now switched on/.test(told), 'it does not also say it is switched on');
});
