// An invented local MCP server (stdio) for the W4-11 first-batch walk: node w411b-mcp-server.mjs '<JSON options>'
//   options: { label, tools: [names], pageSize, instructions, logFile, slowMs }
// A call answers "server=<label> ran <tool>". The tool "slow" waits slowMs (default 20 s). Every line it receives is appended to logFile.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const o = JSON.parse(process.argv[2] ?? '{}');
const tools = o.tools ?? ['echo'];
const log = (x) => { if (o.logFile) appendFileSync(o.logFile, `${x}\n`); };
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
log(`started pid ${process.pid}`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  log(`got ${msg.method ?? 'response'}${msg.params?.requestId !== undefined ? ` requestId=${msg.params.requestId}` : ''}`);
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: o.label ?? 'x', version: '1' }, ...(o.instructions ? { instructions: o.instructions } : {}) } });
  else if (msg.method === 'tools/list') {
    const cursor = msg.params?.cursor ? Number(msg.params.cursor) : 0; const size = o.pageSize || tools.length;
    const next = o.pageSize && cursor + size < tools.length ? String(cursor + size) : undefined;
    send({ id: msg.id, result: { tools: tools.slice(cursor, cursor + size).map((n) => ({ name: n, description: `tool ${n}`, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })), ...(next ? { nextCursor: next } : {}) } });
  } else if (msg.method === 'tools/call') {
    if (msg.params.name === 'slow') { log('slow started'); setTimeout(() => { log('slow finished'); send({ id: msg.id, result: { content: [{ type: 'text', text: 'slow finished' }] } }); }, o.slowMs ?? 20000); }
    else send({ id: msg.id, result: { content: [{ type: 'text', text: `server=${o.label ?? 'x'} ran ${msg.params.name}` }] } });
  } else if (msg.id != null && msg.method) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
process.on('exit', () => log('exiting'));
