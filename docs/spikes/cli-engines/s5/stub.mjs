// S5 stand-in model + logging proxy (not Bunny code). node stub.mjs <port> <scenario.json> <log>
// The stand-in speaks OpenAI chat-completions SSE and asks for one scripted tool call per model request, then says "done". Every request is logged (method, url, body size, first 300 chars).
// It also answers as a CONNECT/HTTP proxy on port+1 that only LOGS what it is asked to reach (nothing is forwarded), to see whether the engine talks to anything else.
import { createServer } from 'node:http';
import { createServer as net } from 'node:net';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const [port, scenarioFile, logFile] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const steps = JSON.parse(readFileSync(scenarioFile, 'utf8'));
writeFileSync(logFile, '');
const log = (o) => appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
let n = 0;
createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.includes('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] })); }
    if (!req.url.includes('/chat/completions')) { log({ kind: 'other-request', url: req.url }); res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('FETCHED-PAGE'); }
    let body = {};
    try { body = JSON.parse(raw); } catch { /* not json */ }
    n += 1;
    const toolNames = (body.tools ?? []).map((t) => t.function?.name);
    const last = (body.messages ?? []).at(-1);
    log({ kind: 'model-request', n, url: req.url, tools: toolNames, lastRole: last?.role, lastContent: String(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)).slice(0, 300) });
    const step = steps[n - 1];
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const frame = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'stub-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (step?.tool) {
      frame({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) } }] });
      frame({}, 'tool_calls');
    } else { frame({ role: 'assistant', content: 'done' }); frame({}, 'stop'); }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(port, '127.0.0.1', () => log({ kind: 'listening', port }));
// a logging-only proxy
net((sock) => { sock.once('data', (d) => { log({ kind: 'PROXY-CONNECT-ATTEMPT', first: String(d).split('\r\n')[0].slice(0, 200) }); sock.destroy(); }); }).listen(port + 1, '127.0.0.1');
