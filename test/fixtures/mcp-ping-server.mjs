// A tiny local MCP server for tests: after the handshake it asks the client ping and roots/list, and writes down the answers (PING_LOG).
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ping', version: '1' } } });
  else if (msg.method === 'notifications/initialized') { send({ id: 7001, method: 'ping' }); send({ id: 7002, method: 'roots/list' }); send({ id: 7003, method: 'sampling/createMessage', params: {} }); }
  else if (msg.method === 'tools/list') send({ id: msg.id, result: { tools: [] } });
  else if (msg.id === 7001) appendFileSync(process.env.PING_LOG, `ping ${JSON.stringify(msg.result)}\n`);
  else if (msg.id === 7002) appendFileSync(process.env.PING_LOG, `roots ${JSON.stringify(msg.result)}\n`);
  else if (msg.id === 7003) appendFileSync(process.env.PING_LOG, `sampling ${msg.error ? 'refused' : 'answered'}\n`);
  else if (msg.id != null && msg.method) send({ id: msg.id, error: { code: -32601, message: 'unknown method' } });
});
