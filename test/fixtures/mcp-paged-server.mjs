// A tiny local MCP server for tests whose tool list comes in pages (7 tools, 3 to a page).
import { createInterface } from 'node:readline';
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'paged', version: '1' } } });
  else if (msg.method === 'tools/list') {
    const from = Number(msg.params?.cursor ?? 0);
    const tools = Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, description: 'a tool', inputSchema: { type: 'object', properties: {} } })).slice(from, from + 3);
    send({ id: msg.id, result: { tools, ...(from + 3 < 7 ? { nextCursor: String(from + 3) } : {}) } });
  } else if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
