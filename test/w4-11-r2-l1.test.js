import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { listTools, callTool, connectorInstructions } from '../src/server/mcp.js';
import { createLocalMcp } from '../src/server/mcpLocal.js';

// W4-11 R-2 (the handshake and the session id) and L-1 (what a connector says about itself).
const json = { 'content-type': 'application/json' };

/** A connector that refuses anything without the handshake and its session id, and can forget the session. */
async function strictServer(t, { instructions = '' } = {}) {
  const seen = [];
  const state = { session: null, sessions: 0 };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      seen.push({ method: r.method, session: req.headers['mcp-session-id'] ?? null, version: req.headers['mcp-protocol-version'] ?? null });
      if (r.method === 'initialize') {
        state.sessions += 1;
        state.session = `s${state.sessions}`;
        res.writeHead(200, { ...json, 'mcp-session-id': state.session });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'strict', version: '1' }, ...(instructions ? { instructions } : {}) } }));
        return;
      }
      if (r.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
      if (req.headers['mcp-session-id'] !== state.session) { res.writeHead(state.session ? 404 : 400, json).end('{"error":"no session"}'); return; }
      const result = r.method === 'tools/list'
        ? { tools: [{ name: 'ping', description: 'pings', inputSchema: { type: 'object', properties: {} } }] }
        : { content: [{ type: 'text', text: 'pong' }] };
      res.writeHead(200, json);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return { seen, state, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

test('R-2: the handshake runs once, then the session id and protocol version go with every request', async (t) => {
  const s = await strictServer(t);
  const server = { id: 'strict-1', name: 'Strict', url: s.url };
  const tools = await listTools(server);
  assert.deepEqual(tools.map((x) => x.name), ['ping']);
  const result = await callTool(server, { name: 'ping' });
  assert.equal(result.content[0].text, 'pong');
  assert.deepEqual(s.seen.map((x) => x.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  for (const x of s.seen.slice(1)) assert.equal(x.session, 's1');
  assert.equal(s.seen[2].version, '2025-06-18');
});

test('R-2: a server that forgot the session (a restart) is recovered once', async (t) => {
  const s = await strictServer(t);
  const server = { id: 'strict-2', name: 'Strict', url: s.url };
  await listTools(server);
  s.state.session = 'fresh-after-restart'; // the old id is now unknown to the server
  const result = await callTool(server, { name: 'ping' });
  assert.equal(result.content[0].text, 'pong');
  assert.equal(s.state.sessions, 2, 'a second handshake was made');
});

test('R-2: a server that does not speak the handshake is used as before', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      seen.push(r.method);
      if (r.method === 'initialize') { res.writeHead(400, json).end('{"error":"unknown method"}'); return; }
      res.writeHead(200, json);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: r.method === 'tools/list' ? { tools: [{ name: 'old', inputSchema: { type: 'object' } }] } : { content: [{ type: 'text', text: 'ok' }] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const conn = { id: 'old-1', name: 'Old', url: `http://127.0.0.1:${server.address().port}/mcp` };
  assert.deepEqual((await listTools(conn)).map((x) => x.name), ['old']);
  assert.equal((await callTool(conn, { name: 'old' })).content[0].text, 'ok');
});

test('L-1: a remote connector\'s instructions are kept (cut at 2,000 characters)', async (t) => {
  const s = await strictServer(t, { instructions: `Use paths relative to C:\\notes. ${'x'.repeat(3000)}` });
  const server = { id: 'strict-3', name: 'Strict', url: s.url };
  await listTools(server);
  const said = connectorInstructions(server);
  assert.ok(said.startsWith('Use paths relative to C:\\notes.'));
  assert.equal(said.length, 2000);
  assert.equal(connectorInstructions({ id: 'never-seen', url: 'http://127.0.0.1:1/mcp' }), '');
});

test('L-1: a local connector\'s instructions are kept while it runs', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const script = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
  const server = { id: 'echo-i', type: 'local', name: 'Echo', command: process.execPath, args: [script], env: { ECHO_INSTRUCTIONS: 'Always say please.' } };
  assert.equal(local.instructions('echo-i'), '');
  await local.listTools(server);
  assert.equal(local.instructions('echo-i'), 'Always say please.');
});

test('R-2: a connector whose address changed never receives the session id of the old address', async (t) => {
  const a = await strictServer(t);
  const b = await strictServer(t);
  await listTools({ id: 'moved-1', name: 'Moved', url: a.url });
  await listTools({ id: 'moved-1', name: 'Moved', url: b.url }); // same connector id, new address
  assert.ok(b.seen.length > 0);
  assert.equal(b.seen[0].method, 'initialize', 'the new address starts with its own handshake');
  assert.equal(b.seen[0].session, null, 'and no session id of the old address was sent to it');
});
