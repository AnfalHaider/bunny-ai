// Spike S3/S4 stand-in for the model endpoint (OpenAI chat-completions wire, what Cline's and Aider's OpenAI-compatible providers speak). Not Bunny code.
// Usage: node stub-chat.mjs <port> <scenario.json> <log.jsonl>
// scenario.json: { "calls": [ { "name": "read_file", "arguments": {...} }, ... ], "text": [ "reply for non-tool requests" ] }
// With tools offered in the request, every request returns the NEXT scripted call as a tool_calls delta; when used up (or when no tools are offered) it returns plain text
// (the text may carry an edit block for Aider via scenario.reply). Every request is logged whole.
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';

const [port, scenarioPath, logPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
let next = 0; let textNext = 0;
const log = (o) => appendFileSync(logPath, JSON.stringify(o) + '\n');
const chunk = (o) => `data: ${JSON.stringify({ id: 'chatcmpl-spike', object: 'chat.completion.chunk', created: 1, model: 'stub-model', ...o })}\n\n`;

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    log({ t: new Date().toISOString(), method: req.method, url: req.url, host: req.headers.host, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/authorization|api-key/i.test(k))), body });
    if (req.method === 'GET' && /\/models/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] })); return; }
    if (req.method === 'POST' && /\/chat\/completions/.test(req.url)) {
      let parsed = {}; try { parsed = JSON.parse(body); } catch { /* not json */ }
      const wantsTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
      const call = wantsTools ? scenario.calls?.[next] : undefined;
      const stream = parsed.stream !== false;
      let message;
      if (call) {
        next += 1;
        message = { role: 'assistant', content: null, tool_calls: [{ id: `call_${next}`, type: 'function', function: { name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments) } }] };
      } else {
        const replies = scenario.text ?? ['stub done'];
        message = { role: 'assistant', content: replies[Math.min(textNext, replies.length - 1)] };
        textNext += 1;
      }
      if (!stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'chatcmpl-spike', object: 'chat.completion', created: 1, model: 'stub-model', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (message.tool_calls) {
        res.write(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: message.tool_calls.map((t, i) => ({ index: i, ...t })) }, finish_reason: null }] }));
        res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      } else {
        res.write(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: message.content }, finish_reason: null }] }));
        res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`stub listening 127.0.0.1:${port}`));
