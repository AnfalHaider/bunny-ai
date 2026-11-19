// Spike S1 stand-in for the model endpoint (Anthropic Messages wire). Not Bunny code, not built into the app.
// Usage: node stub-anthropic.mjs <port> <scenario.json> <log.jsonl>
// scenario.json: { "calls": [ { "name": "Read", "input": { ... } }, ... ] }  -> every model request returns the NEXT scripted tool_use; when the list is used up it returns plain text.
// Every request (path, headers, body) is appended to the log, so the canary string can be searched for in what the engine sent upstream.
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';

const [port, scenarioPath, logPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
let next = 0;
const log = (o) => appendFileSync(logPath, JSON.stringify(o) + '\n');

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.end();
}

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    log({ t: new Date().toISOString(), method: req.method, url: req.url, host: req.headers.host, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/authorization|x-api-key/i.test(k))), body });
    if (req.method === 'POST' && /\/v1\/messages\/count_tokens/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 10 })); return; }
    if (req.method === 'POST' && /\/v1\/messages/.test(req.url)) {
      let parsed = {}; try { parsed = JSON.parse(body); } catch { /* not json */ }
      const model = parsed.model ?? 'stub';
      const head = ['message_start', { message: { id: `msg_${next}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
      // small helper requests (titles, topic checks) have no tools or are tiny: answer them with text so they do not consume the script
      const wantsTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
      const call = wantsTools ? scenario.calls[next] : undefined;
      if (call) {
        next += 1;
        sse(res, [head,
          ['content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${next}`, name: call.name, input: {} } }],
          ['content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } }],
          ['content_block_stop', { index: 0 }],
          ['message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }],
          ['message_stop', {}]]);
      } else {
        sse(res, [head,
          ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'stub done' } }],
          ['content_block_stop', { index: 0 }],
          ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }],
          ['message_stop', {}]]);
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`stub listening 127.0.0.1:${port}`));
