// Spike S1: a tiny stdio MCP server with one tool ("ping"), so the hook can be shown to fire for an MCP tool. Not Bunny code.
import { appendFileSync } from 'node:fs';
let buf = '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spike', version: '1' } } });
    else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] } });
    else if (m.method === 'tools/call') { if (process.env.MCP_RAN) appendFileSync(process.env.MCP_RAN, 'ran\n'); out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'MCP-RAN-MARKER' }] } }); }
    else if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
