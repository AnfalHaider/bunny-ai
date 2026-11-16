import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat } from '../src/server/chat.js';

const sse = (frames) => new Response(new ReadableStream({
  start(c) { const e = new TextEncoder(); for (const f of frames) c.enqueue(e.encode(f)); c.close(); },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const text = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const tools = [{ type: 'function', function: { name: 'run_command', description: 'run', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }];
const collect = async (gen) => { let s = ''; for await (const p of gen) s += p; return s; };
const base = { baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], tools };

// W6-4: a call the model wrote out as text is run (or answered), never left on screen.
test('a written-out call, even split across chunks and missing its closing tags, is run and never shown', async () => {
  let n = 0;
  const ran = [];
  const fetchImpl = async () => { n += 1; return sse(n === 1
    ? [text('Checking the folder. <tool'), text('_call><function=run_com'), text('mand><parameter=command>dir /b'), done]
    : [text('It has two files.'), done]); };
  const out = await collect(streamChat({ ...base, fetchImpl, runTool: async (c) => { ran.push(JSON.parse(c.arguments)); return 'a.txt b.txt'; } }));
  assert.deepEqual(ran, [{ command: 'dir /b' }], 'run with its parameter, though the closing tags never came');
  assert.equal(out, 'Checking the folder. It has two files.');
  assert.doesNotMatch(out, /tool_call|function=|parameter/);
});

test('a written-out call to a tool that is not offered is answered with an error, not shown', async () => {
  let n = 0;
  const seen = [];
  const fetchImpl = async (_u, init) => { n += 1; seen.push(JSON.parse(init.body)); return sse(n === 1
    ? [text('<tool_call><function=format_disk><parameter=drive>C</parameter></function></tool_call>'), done]
    : [text('I will use run_command instead.'), done]); };
  const ran = [];
  const out = await collect(streamChat({ ...base, fetchImpl, runTool: async (c) => { ran.push(c.name); return 'x'; } }));
  assert.deepEqual(ran, [], 'nothing ran');
  assert.equal(out, 'I will use run_command instead.');
  const toolMsg = seen[1].messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /There is no tool called format_disk here\. The tools you have: run_command/);
  assert.ok(!JSON.stringify(seen[1].messages).includes('unoffered'), 'the private flag is not sent to the provider');
});

test('in the last round (step budget used up) a written call is not shown either', async () => {
  let n = 0;
  const fetchImpl = async (_u, init) => {
    n += 1;
    const b = JSON.parse(init.body);
    if (b.tools) return sse([`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"command":"ls"}' } }] } }] })}\n\n`, done]);
    return sse([text('Done so far. <tool_call><function=run_command><parameter=command>ls</parameter></function></tool_call>'), done]);
  };
  const out = await collect(streamChat({ ...base, fetchImpl, runTool: async () => 'ok', maxToolRounds: 1 }));
  assert.equal(out.trim(), 'Done so far.');
});

test('text that only mentions a tag is not swallowed when no call can be read from it', async () => {
  const fetchImpl = async () => sse([text('Use the <function= syntax like this: <function=x'), done]);
  const out = await collect(streamChat({ ...base, fetchImpl, runTool: async () => 'x' }));
  assert.match(out, /Use the <function= syntax/);
});
