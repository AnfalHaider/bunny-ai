// Spike S2 stand-in for the model endpoint (OpenAI Responses wire, what Codex speaks). Not Bunny code.
// Usage: node stub-responses.mjs <port> <scenario.json> <log.jsonl>
// scenario.json: { "calls": [ { "type": "function_call", "name": "shell_command", "arguments": {...} } | { "type": "custom_tool_call", "name": "apply_patch", "input": "..." } ] }
// Each model request returns the NEXT scripted call; then plain text. Every request is logged whole (the canary string is searched for in these logs).
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';

const [port, scenarioPath, logPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
let next = 0;
const log = (o) => appendFileSync(logPath, JSON.stringify(o) + '\n');
const send = (res, events) => { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); res.end(); };

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    log({ t: new Date().toISOString(), method: req.method, url: req.url, host: req.headers.host, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/authorization|api-key/i.test(k))), body });
    if (req.method === 'POST' && /\/responses/.test(req.url)) {
      const id = `resp_${next}`;
      const call = scenario.calls[next];
      const created = { type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } };
      let item;
      if (call) {
        next += 1;
        item = call.type === 'custom_tool_call'
          ? { type: 'custom_tool_call', id: `ctc_${next}`, call_id: `call_${next}`, name: call.name, input: call.input }
          : { type: 'function_call', id: `fc_${next}`, call_id: `call_${next}`, name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) };
      } else {
        item = { type: 'message', id: `msg_${next}`, role: 'assistant', content: [{ type: 'output_text', text: 'stub done' }] };
      }
      send(res, [created, { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } }]);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`stub listening 127.0.0.1:${port}`));
