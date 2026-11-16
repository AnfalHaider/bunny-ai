// An invented local MCP server for tests of the first start.
//   node mcp-slow-start-server.mjs <delay ms before it answers initialize | never> [file to write its process ids to]
// It logs a few lines to stderr (one long, one with a secret, one with colour codes), starts a child program of its own
// (so a test can prove stopping ends the whole tree), then answers like a normal server.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const delay = process.argv[2] === 'never' ? Infinity : Number(process.argv[2] ?? 0);
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
if (process.argv[3]) writeFileSync(process.argv[3], `${process.pid} ${helper.pid}`); // a test reads the process ids from here
console.error('downloading carrot-server 1.0.0');
console.error(`\u001b[32mhttp fetch\u001b[0m with token=abc123secretvalue ${'x'.repeat(300)}`);
console.error('almost ready');

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    if (delay === Infinity) return;
    setTimeout(() => send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1' } } }), delay);
  } else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [{ name: 'hello', description: 'Say hello', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
  else if (msg.method === 'tools/call') send({ id: msg.id, result: { content: [{ type: 'text', text: 'hello' }] } });
});
process.on('exit', () => { try { helper.kill(); } catch { /* gone */ } });
