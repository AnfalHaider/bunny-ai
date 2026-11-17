// A tiny local MCP server for tests: its tool sleeps 20 seconds, and it writes down a cancel notification (SLEEP_LOG).
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'sleep', version: '1' } } });
  else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [{ name: 'nap', description: 'sleeps', inputSchema: { type: 'object', properties: {} } }] } });
  else if (msg.method === 'tools/call') setTimeout(() => send({ id: msg.id, result: { content: [{ type: 'text', text: 'woke' }] } }), 20_000).unref();
  else if (msg.method === 'notifications/cancelled') appendFileSync(process.env.SLEEP_LOG, `cancelled ${msg.params?.requestId}\n`);
  else if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
