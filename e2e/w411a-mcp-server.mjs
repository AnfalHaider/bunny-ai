// An invented local MCP server for the W4-11 slice A walk: node w411a-mcp-server.mjs <server label> <JSON array of tool names>
// It lists those tools, and a call answers "server=<label> tool=<the real tool name> args=<json>" so the walk can see where a call landed.
import { createInterface } from 'node:readline';
const label = process.argv[2] ?? 'x';
const names = JSON.parse(process.argv[3] ?? '[]');
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: label, version: '1' } } });
  else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: names.map((n) => ({ name: n, description: `tool ${n} of ${label}`, inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: !/write/.test(n) } })) } });
  else if (msg.method === 'tools/call') send({ id: msg.id, result: { content: [{ type: 'text', text: `server=${label} tool=${msg.params.name} args=${JSON.stringify(msg.params.arguments ?? {})}` }] } });
  else if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
