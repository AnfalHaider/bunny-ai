import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mergeSameRole, streamChat } from '../src/server/chat.js';

// ROLES: two messages of the same role in a row are refused by strict chat templates. The outgoing request is merged; the saved chat is not touched.
const img = (n) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${n}` } });

test('a note and the person\'s message (user + user) become one user message, joined by a blank line; the input is not changed', () => {
  const input = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Task note: be brief.' }, { role: 'user', content: 'Hello' }];
  const copy = JSON.parse(JSON.stringify(input));
  const out = mergeSameRole(input);
  assert.deepEqual(out, [{ role: 'system', content: 'S' }, { role: 'user', content: 'Task note: be brief.\n\nHello' }]);
  assert.deepEqual(input, copy, 'the original list is untouched');
});

test('the screenshot path keeps its pictures, in order, with the text parts', () => {
  const out = mergeSameRole([
    { role: 'user', content: [{ type: 'text', text: 'Look at this' }, img('A')] },
    { role: 'user', content: 'and the note' },
    { role: 'user', content: [img('B')] },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].content, [{ type: 'text', text: 'Look at this' }, img('A'), { type: 'text', text: 'and the note' }, img('B')]);
});

test('assistant + assistant merge too; a string and parts merge into parts', () => {
  assert.deepEqual(mergeSameRole([{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }]), [{ role: 'assistant', content: 'a\n\nb' }]);
  assert.deepEqual(mergeSameRole([{ role: 'user', content: 'x' }, { role: 'user', content: [img('C')] }])[0].content, [{ type: 'text', text: 'x' }, img('C')]);
});

test('a tool round is unchanged: assistant tool_calls, tool results and the user after them stay separate, each tool_call_id next to its result', () => {
  const round = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'r1' },
    { role: 'tool', tool_call_id: 'c2', content: 'r2' },
    { role: 'assistant', content: 'a', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'y', arguments: '{}' } }] },
    { role: 'assistant', content: 'plain' },
    { role: 'system', content: 'S1' },
    { role: 'system', content: 'S2' },
  ];
  assert.deepEqual(mergeSameRole(round), round);
});

test('an alternating history is byte-identical', () => {
  const h = [{ role: 'system', content: 'S' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: [{ type: 'text', text: 'c' }, img('D')] }];
  assert.equal(JSON.stringify(mergeSameRole(h)), JSON.stringify(h));
});

test('what goes out on the wire: the provider receives one user message, never two in a row', async (t) => {
  let seen = null;
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const events = [];
  for await (const e of streamChat({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'sk-test-000000000000', model: 'm', messages: [{ role: 'user', content: 'note' }, { role: 'user', content: 'hello' }] })) events.push(e);
  assert.deepEqual(seen.messages, [{ role: 'user', content: 'note\n\nhello' }]);
  assert.ok(events.length > 0);
});
