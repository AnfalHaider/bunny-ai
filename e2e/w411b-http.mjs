// An invented remote MCP server (streamable HTTP) for the W4-11 first-batch walk. Everything it was asked is in `log`.
//   const s = await startHttpMcp({ requireSession, instructions, pageSize, tools, sse, slowMs, forgetAfter });
//   s.url, s.log, s.close(), s.state (sessions made, aborted slow calls)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export async function startHttpMcp({ requireSession = false, instructions = '', pageSize = 0, tools = ['echo'], sse = false, slowMs = 0, forgetAfter = 0, noHandshake = false } = {}) {
  const log = []; const state = { sessionsMade: 0, abortedSlow: 0, slowStarted: 0 };
  let sessions = new Set(); let calls = 0;
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let msg = {}; try { msg = JSON.parse(raw); } catch { /* ignore */ }
      const sid = req.headers['mcp-session-id'] ?? null; const ver = req.headers['mcp-protocol-version'] ?? null;
      log.push({ method: msg.method ?? '(none)', id: msg.id, sid, ver });
      const json = (obj, headers = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      const answer = (obj) => {
        if (!sse) return json(obj);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'working' } })}\n\n`);
        res.write(`data: ${JSON.stringify(obj)}\n\n`); res.end();
      };
      if (msg.method === 'initialize') {
        if (noHandshake) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"no handshake here"}'); return; }
        const id = randomUUID(); sessions.add(id); state.sessionsMade += 1;
        return json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'invented', version: '1' }, instructions } }, requireSession ? { 'mcp-session-id': id } : {});
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (requireSession && !sessions.has(sid)) { res.writeHead(sid ? 404 : 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: sid ? 'session not found' : 'missing session id' })); return; }
      if (msg.method === 'tools/list') {
        const cursor = msg.params?.cursor ? Number(msg.params.cursor) : 0;
        const size = pageSize || tools.length; const slice = tools.slice(cursor, cursor + size);
        const next = pageSize && cursor + size < tools.length ? String(cursor + size) : undefined;
        return answer({ jsonrpc: '2.0', id: msg.id, result: { tools: slice.map((t) => (typeof t === 'string' ? { name: t, description: `tool ${t}`, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } } : t)), ...(next ? { nextCursor: next } : {}) } });
      }
      if (msg.method === 'tools/call') {
        calls += 1;
        if (forgetAfter && calls === forgetAfter) sessions = new Set(); // the server restarts and forgets every session
        if (requireSession && !sessions.has(sid)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"session not found"}'); return; }
        const name = msg.params?.name;
        if (name === 'slow') {
          state.slowStarted += 1;
          const timer = setTimeout(() => answer({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'slow finished' }] } }), slowMs || 20000);
          res.on('close', () => { if (!res.writableEnded) { state.abortedSlow += 1; clearTimeout(timer); } });
          return;
        }
        const variants = {
          two_parts: { content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two\nwith a new line' }] },
          structured: { structuredContent: { count: 2, items: ['a', 'b'] } },
          is_error: { isError: true, content: [{ type: 'text', text: 'the file was not found' }] },
          resource: { content: [{ type: 'resource', resource: { uri: 'file:///notes/a.txt', text: 'resource text here' } }, { type: 'resource_link', name: 'Spec', uri: 'https://example.invalid/spec' }] },
          image: { content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(4000) }, { type: 'text', text: 'caption' }] },
          empty: { content: [] },
        };
        return answer({ jsonrpc: '2.0', id: msg.id, result: variants[name] ?? { content: [{ type: 'text', text: `ran ${name} with ${JSON.stringify(msg.params?.arguments ?? {})}` }] } });
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, log, state, close: () => { server.closeAllConnections?.(); server.close(); } };
}
