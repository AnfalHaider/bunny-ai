// A tiny local MCP server for tests: speaks JSON-RPC over stdin/stdout, one message per line.
import { createInterface } from 'node:readline';
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
console.error('echo server starting'); // logs go to stderr, as real servers do
process.stdout.write('a log line that is not JSON\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' }, ...(process.env.ECHO_INSTRUCTIONS ? { instructions: process.env.ECHO_INSTRUCTIONS } : {}) } });
  else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [{ name: 'echo', description: 'Say it back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] } });
  else if (msg.method === 'tools/call') send({ id: msg.id, result: { content: [{ type: 'text', text: `${process.env.ECHO_PREFIX ?? ''}${msg.params.arguments.text}` }] } });
  else if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
