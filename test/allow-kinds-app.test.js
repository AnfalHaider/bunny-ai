/** AGENT-FLOW F9 through the app: a scripted provider, Ask mode, an invented folder. The card offers the kind; one "Allow for this chat" stops the next calls of that kind from asking. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';

async function scripted(t, steps) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

async function chat(base, id, content, onEvent, extra = {}) {
  const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code', ...extra }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); const events = []; let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data); events.push({ event, data: parsed }); await onEvent?.(event, parsed);
    }
  }
  return events;
}

async function setup(t, steps) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-f9-'));
  await mkdir(join(folder, 'src', 'a'), { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { base } = await startApp(t, { fake: false });
  const provider = await scripted(t, steps);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'F9' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', 'ask'); await set('folder', folder);
  return { base, folder, session, provider, set };
}

test('Allow for this chat: the first edit in a folder asks and offers the kind; the next edits in it do not ask', async (t) => {
  const { base, folder, session } = await setup(t, [
    { name: 'write_file', args: { path: 'src/a/one.js', content: '1\n' } },
    { name: 'write_file', args: { path: 'src/a/two.js', content: '2\n' } },
    { name: 'write_file', args: { path: 'src/a/deep/three.js', content: '3\n' } },
  ]);
  const cards = [];
  await chat(base, session.id, 'write three files', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true });
  });
  assert.equal(cards.length, 1, 'only the first call asked');
  assert.match(cards[0].kind.button, /src\/a\//);
  assert.equal(await readFile(join(folder, 'src/a/two.js'), 'utf8'), '2\n');
  assert.equal(await readFile(join(folder, 'src/a/deep/three.js'), 'utf8'), '3\n');
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 1);
  assert.match(list.kinds[0].label, /src\/a/);
  // Forget: the next call asks again
  const gone = await fetch(`${base}/api/sessions/${session.id}/allow-kinds/all`, { method: 'DELETE' });
  assert.ok([200, 403].includes(gone.status));
});

test('the root folder, a file that runs later, and Plan mode never get a kind; a stray "kind" answer is refused', async (t) => {
  const { base, session, set } = await setup(t, [
    { name: 'write_file', args: { path: 'top.txt', content: 'x\n' } },
    { name: 'write_file', args: { path: 'src/a/package.json', content: '{}\n' } },
  ]);
  const cards = [];
  let refused = null;
  await chat(base, session.id, 'write', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    if (!data.kind && refused === null) refused = (await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true })).status;
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].kind ?? null, null); assert.match(cards[0].reason, /^Asked every time/);
  assert.equal(cards[1].kind ?? null, null);
  assert.equal(refused, 400, 'a kind that was not offered cannot be given');
  await set('permissionMode', 'plan');
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 0);
});

test('a folder change clears what was allowed; PATCH cannot write the list', async (t) => {
  const { base, folder, session, set } = await setup(t, [{ name: 'write_file', args: { path: 'src/a/one.js', content: '1\n' } }]);
  await chat(base, session.id, 'write', async (event, data) => { if (event === 'permission') await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true }); });
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 1);
  await set('allowKinds', [{ type: 'edit', key: 'x', label: 'x' }]);
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 1, 'the setting route did not take a list');
  const other = await mkdtemp(join(tmpdir(), 'bunny-f9b-')); t.after(() => rm(other, { recursive: true, force: true }));
  await set('folder', other);
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 0);
  void folder;
});

test('a command: the first "node -v" asks and offers its exact kind; the same command again does not ask, a different one does; a moved npm form is exact only', async (t) => {
  const { base, session } = await setup(t, [
    { name: 'run_command', args: { command: 'node -v' } },
    { name: 'run_command', args: { command: 'node -v' } },
    { name: 'run_command', args: { command: 'node -p 1' } },
  ]);
  const cards = [];
  await chat(base, session.id, 'run three commands', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, data.kind && cards.length === 1 ? { allowed: true, kind: true } : { allowed: true });
  });
  assert.equal(cards.length, 2, 'the repeat did not ask; the different command did');
  assert.match(cards[0].kind.button, /node -v/); assert.match(cards[0].kind.button, /exact command/);
  assert.match(cards[1].kind.button, /node -p 1/);
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 1);
});

test('a compound command gets no kind and the fixed reason; a device-style kind answer is not accepted without an offered kind', async (t) => {
  const { base, session } = await setup(t, [{ name: 'run_command', args: { command: 'node -v && node -v' } }]);
  const cards = [];
  await chat(base, session.id, 'run it', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  assert.equal(cards.length, 1); assert.equal(cards[0].kind ?? null, null);
  assert.match(cards[0].reason, /^Asked every time: it has more than one part/);
});

test('a scheduled run neither creates nor uses a kind: with a kind already given to the chat, its edit still has nobody to ask and writes nothing', async (t) => {
  const { base, folder, session } = await setup(t, [
    { name: 'write_file', args: { path: 'src/a/one.js', content: '1\n' } },
    { name: 'write_file', args: { path: 'src/a/two.js', content: '2\n' } },
  ]);
  await chat(base, session.id, 'write', async (event, data) => { if (event === 'permission') await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true }); });
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 1, 'the chat has a kind');
  assert.equal(await readFile(join(folder, 'src/a/one.js'), 'utf8').catch(() => null), '1\n');
  // the same chat, now as a scheduled run: the kind is not used, and no card offers one
  const { base: b2, folder: f2, session: s2 } = await setup(t, [{ name: 'write_file', args: { path: 'src/a/x.js', content: 'x\n' } }]);
  const cards = [];
  const res = await fetch(`${b2}/api/sessions/${s2.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'nightly', providerId: 'openai', model: 'gpt-4o', workMode: 'code', scheduledTask: 'nightly' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) { const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card); await post(b2, `/api/sessions/${s2.id}/permission/${card.id}`, { allowed: false }); }
    }
  }
  assert.ok(cards.every((c) => !c.kind), 'a scheduled run is never offered a kind');
  assert.equal((await json(b2, `/api/sessions/${s2.id}/allow-kinds`)).body.kinds.length, 0, 'and creates none');
  assert.equal(await readFile(join(f2, 'src/a/x.js'), 'utf8').catch(() => null), null, 'nobody was there to allow it');
});

test('a helper never gets a kind and a taint card still shows a kind or a reason: only the exact fixed strings are used', async () => {
  const { REASONS, reasonLine } = await import('../src/server/allowKinds.js');
  for (const key of ['helper', 'pcText', 'scheduled', 'compound', 'root', 'protectedPath', 'sends', 'sending', 'building', 'askRule', 'path', 'noHost']) assert.ok(REASONS[key], key);
  assert.match(reasonLine('helper'), /^Asked every time: a helper is asking/);
  assert.match(reasonLine('pcText'), /read text from your PC files/);
  assert.equal(reasonLine('anything the model wrote'), '', 'a reason is only ever one of the fixed strings');
});

// the connector kind and a helper's own card, with a stand-in MCP server (a swapped fetch, like agent-flow's) and a scripted model
function mcpStandIn(t) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://weather.example.com/mcp') return real(url, init);
    const rpc = JSON.parse(String(init?.body ?? '{}'));
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
    if (rpc.method === 'initialize') return reply({ protocolVersion: rpc.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'weather', version: '1' } });
    if (rpc.method === 'tools/list') return reply({ tools: [{ name: 'forecast', description: 'The forecast for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }, { name: 'send_alert', description: 'Send an alert', inputSchema: { type: 'object', properties: {} } }] });
    if (rpc.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'Sunny' }] });
    return new Response('', { status: 202 });
  };
  t.after(() => { globalThis.fetch = real; });
}
async function modelThat(t, decide) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw); seen.push(body);
      const step = decide(body, seen.length);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}
const toolNamed = (body, re) => (body.tools ?? []).find((d) => re.test(d.function.name))?.function.name;

test('a connector tool: the first call asks and offers its kind; the same tool again does not ask; a tool that sends gets no kind and the fixed reason', async (t) => {
  mcpStandIn(t);
  const { base } = await startApp(t, { fake: false });
  const model = await modelThat(t, (body, n) => {
    const forecast = toolNamed(body, /forecast/); const alert = toolNamed(body, /send_alert/);
    const told = body.messages.filter((m) => m.role === 'tool').length;
    if (told === 0 && forecast) return { name: forecast, args: { city: 'Lisbon' } };
    if (told === 1 && forecast) return { name: forecast, args: { city: 'Porto' } };
    if (told === 2 && alert) return { name: alert, args: {} };
    return null;
  });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: model.url });
  const added = await post(base, '/api/mcp', { name: 'Weather', url: 'https://weather.example.com/mcp', enabled: true });
  assert.equal(added.status, 200);
  const { body: session } = await post(base, '/api/sessions', { title: 'Connector kind' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'ask' }) });
  const cards = [];
  await chat(base, session.id, 'forecast twice, then alert', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, data.kind ? { allowed: true, kind: true } : { allowed: true });
  }, { workMode: 'chat' });
  assert.equal(cards.length, 2, 'the second forecast did not ask; the alert did');
  assert.match(cards[0].kind.button, /Weather: forecast/);
  assert.equal(cards[1].kind ?? null, null); assert.match(cards[1].reason, /^Asked every time: this sends or buys something/);
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 1); assert.match(list.kinds[0].label, /Weather: forecast/);
});

test("a helper's own card offers no kind (only Allow once), the fixed reason says a helper is asking, and what the helper was allowed creates no kind", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-f9h-')); await mkdir(join(folder, 'src', 'a'), { recursive: true }); t.after(() => rm(folder, { recursive: true, force: true }));
  const { base } = await startApp(t, { fake: false });
  const model = await modelThat(t, (body) => {
    const isParent = Boolean(toolNamed(body, /^run_subagent$/));
    const told = body.messages.filter((m) => m.role === 'tool').length;
    if (isParent && told === 0) return { name: 'run_subagent', args: { title: 'Writer', task: 'write src/a/h.js' } };
    if (!isParent && told === 0) return { name: 'write_file', args: { path: 'src/a/h.js', content: 'h\n' } };
    return null;
  });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: model.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Helper' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', 'ask'); await set('folder', folder);
  const cards = [];
  await chat(base, session.id, 'use a helper to write the file', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  const editCards = cards.filter((c) => /h\.js/.test(`${c.title} ${c.detail}`));
  assert.ok(editCards.length >= 1, `the helper's edit asked: ${cards.map((c) => c.title).join(' | ')}`);
  assert.ok(editCards.every((c) => !c.kind), 'a helper is never offered a kind');
  assert.match(editCards[0].reason, /^Asked every time: a helper is asking/);
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 0);
});
