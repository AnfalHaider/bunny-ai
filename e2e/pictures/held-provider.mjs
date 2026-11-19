// PICTURE-CHECK: a model stand-in for the scenes that draw a LIVE screen (the working line, a card waiting for an answer, a program running). It speaks the OpenAI streaming shape and plays
// a script, one step for each request the app makes:
//   { think: 'text' }            the model's thinking, then the stream is HELD open (the reply never ends: the screen stays as it is)
//   { say: 'text' }              some words, then the stream is HELD open
//   { tool: [name, args] }       a tool call, then the stream ends: the app runs the tool (or asks a card) and asks again with the answer
//   { tool: [...], hold: true }  a tool call, then the stream is held
//   { final: 'text' }            the last words, the stream ends
// A held stream ends only when the scene is over (close()). It is a real HTTP server on 127.0.0.1, connected to the app as a custom provider, so the app does exactly what it does for a person.
import { createServer } from 'node:http';

export async function heldProvider(steps) {
  const requests = [];
  const open = new Set();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'picture-model' }] })); }
      let body = {};
      try { body = JSON.parse(raw); } catch { /* not a chat request */ }
      requests.push(body);
      const step = steps[requests.length - 1] ?? { final: 'Done.' };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const frame = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
      if (step.think) frame({ reasoning_content: step.think });
      if (step.say) frame({ content: step.say });
      if (step.tool) frame({ tool_calls: [{ index: 0, id: `call_${requests.length}`, function: { name: step.tool[0], arguments: JSON.stringify(step.tool[1] ?? {}) } }] });
      if (step.final) frame({ content: step.final }, 'stop');
      if (step.hold || step.think || step.say) { open.add(res); res.on('close', () => open.delete(res)); return; } // held: no end, no [DONE]
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((r) => { for (const res of open) res.destroy(); server.closeAllConnections?.(); server.close(r); }),
  };
}
