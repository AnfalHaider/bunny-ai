import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEndpoint } from '../src/server/engines/endpoint.js';
import { MessagesRequestError, createMessagesStream, estimateInputTokens, messagesFromChat, messagesToChat, offeredToolNames } from '../src/server/engines/translate/messages.js';

// CLI-ENGINES §2.2: the Messages translator (Claude Code, local mode): request -> Chat Completions, Chat chunks -> Messages events, the endpoint route, and count_tokens.

const chunk = (delta, finish = null, usage = null) => ({ id: 'c', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });

test('Messages -> Chat: system (string or blocks), text, images, tool_use and tool_result pair up, results come before the person\'s own text, thinking is dropped, an unanswered call gets an empty answer', () => {
  const { chat } = messagesToChat({
    model: 'claude-x', max_tokens: 800, temperature: 0.3, stop_sequences: ['END'], metadata: { user_id: 'u' },
    system: [{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Be brief.' }],
    messages: [
      { role: 'user', content: 'list the files' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'zz' }, { type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a.txt' }] }, { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }, { type: 'text', text: 'now look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Glob', input: {} }] },
    ],
  });
  assert.deepEqual(chat.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user', 'assistant', 'tool']);
  assert.equal(chat.messages[0].content, 'You are Claude Code.\n\nBe brief.');
  assert.equal(chat.messages[2].content, 'On it.');
  assert.deepEqual(chat.messages[2].tool_calls.map((c) => [c.id, c.function.name, c.function.arguments]), [['t1', 'Bash', '{"command":"ls"}'], ['t2', 'Read', '{"file_path":"a"}']]);
  assert.deepEqual([chat.messages[3].tool_call_id, chat.messages[3].content], ['t1', 'a.txt']);
  assert.equal(chat.messages[4].content, 'Error: boom');
  assert.deepEqual(chat.messages[5].content, [{ type: 'text', text: 'now look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  assert.deepEqual([chat.messages[7].tool_call_id, chat.messages[7].content], ['t3', '']);
  assert.equal(chat.stream, true); assert.equal(chat.max_tokens, 800); assert.equal(chat.temperature, 0.3); assert.deepEqual(chat.stop, ['END']);
  for (const dropped of ['model', 'metadata', 'system']) assert.equal(dropped in chat, false, dropped);
  assert.doesNotMatch(JSON.stringify(chat), /hmm|signature|cache_control/);
  assert.throws(() => messagesToChat({}), MessagesRequestError);
});

test('Messages -> Chat: tools use input_schema; server tools have none and are not offered; tool_choice maps (any = required, tool = that function, none removes the tools)', () => {
  const request = { messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }, { type: 'web_search_20250305', name: 'web_search' }] };
  const { chat } = messagesToChat({ ...request, tool_choice: { type: 'auto' } });
  assert.deepEqual(chat.tools.map((t) => t.function.name), ['Read']);
  assert.equal(chat.tools[0].function.parameters.properties.file_path.type, 'string');
  assert.deepEqual(offeredToolNames(request), ['Read', 'web_search']);
  assert.equal(messagesToChat({ ...request, tool_choice: { type: 'any' } }).chat.tool_choice, 'required');
  assert.deepEqual(messagesToChat({ ...request, tool_choice: { type: 'tool', name: 'Read' } }).chat.tool_choice, { type: 'function', function: { name: 'Read' } });
  assert.equal(messagesToChat({ ...request, tool_choice: { type: 'none' } }).chat.tools, undefined);
  assert.equal(messagesToChat({ ...request, tool_choice: { type: 'auto', disable_parallel_tool_use: true } }).chat.parallel_tool_calls, false);
});

test('Chat -> Messages stream: text, then a tool call, with the right event order, block indexes, input_json_delta, stop reason and usage', () => {
  const s = createMessagesStream({ id: 'msg_1', model: 'Auto', inputTokens: 10 });
  const out = [];
  out.push(...s.push(chunk({ content: 'Hel' })), ...s.push(chunk({ content: 'lo' })));
  out.push(...s.push(chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"file' } }] })), ...s.push(chunk({ tool_calls: [{ index: 0, function: { arguments: '_path":"a"}' } }] })));
  out.push(...s.push(chunk({}, 'tool_calls', { prompt_tokens: 7, completion_tokens: 3 })), ...s.finish());
  assert.deepEqual(out.map((e) => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(out[0].message.usage.input_tokens, 10);
  assert.deepEqual(out[1].content_block, { type: 'text', text: '' });
  assert.deepEqual([out[2].delta.text, out[3].delta.text], ['Hel', 'lo']);
  assert.equal(out[5].index, 1); assert.deepEqual(out[5].content_block, { type: 'tool_use', id: 'c1', name: 'Read', input: {} });
  assert.equal(out[6].delta.partial_json + out[7].delta.partial_json, '{"file_path":"a"}');
  assert.deepEqual([out[9].delta.stop_reason, out[9].usage.output_tokens], ['tool_use', 3]);
  assert.deepEqual(s.usage, { input: 7, output: 3 });
});

test('Chat -> Messages stream: reasoning becomes a thinking block (closed with a signature) before the text; length is max_tokens; an error ends with one error event', () => {
  const s = createMessagesStream({ id: 'm' });
  const ev = [...s.push(chunk({ reasoning_content: 'hm' })), ...s.push(chunk({ content: 'yes' })), ...s.push(chunk({}, 'length')), ...s.finish()];
  assert.deepEqual(ev.map((e) => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[2].delta.type, 'thinking_delta'); assert.equal(ev[3].delta.type, 'signature_delta');
  assert.equal(ev.find((e) => e.type === 'message_delta').delta.stop_reason, 'max_tokens');
  const bad = createMessagesStream({ id: 'm' });
  bad.push(chunk({ content: 'a' }));
  const end = bad.finish({ error: 'upstream down' });
  assert.deepEqual(end.map((e) => e.type), ['content_block_stop', 'error']);
  assert.equal(end.at(-1).error.type, 'api_error');
});

test('Chat -> Messages whole: text and tool calls become blocks, usage and the stop reason carry over', () => {
  const m = messagesFromChat({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 'c', function: { name: 'Read', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }, { model: 'Auto' });
  assert.deepEqual(m.content, [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'c', name: 'Read', input: { a: 1 } }]);
  assert.deepEqual([m.stop_reason, m.usage.input_tokens, m.usage.output_tokens, m.model], ['tool_use', 5, 2, 'Auto']);
  assert.ok(estimateInputTokens({ messages: [{ role: 'user', content: 'x'.repeat(400) }] }) >= 100);
});

function call(ep, { path = '/v1/messages', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: ep.port, path, method: 'POST', headers: { host: `127.0.0.1:${ep.port}`, 'x-api-key': ep.token, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text), events: () => text.split('\n\n').filter((b) => b.startsWith('event: ')).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6))) }));
    });
    req.on('error', reject); req.end(data);
  });
}

test('the endpoint answers /v1/messages (streamed and whole) with the x-api-key token, ignores the model name, counts usage, checks the tool list, and answers count_tokens', async () => {
  const seen = { chats: [], usage: [], tools: [] };
  const upstream = async function* ({ chat }) { seen.chats.push(chat); yield chunk({ content: 'pong' }); yield chunk({}, 'stop', { prompt_tokens: 4, completion_tokens: 2 }); };
  const ep = createEndpoint({ upstream, label: 'Auto', onUsage: (u) => seen.usage.push(u), onToolList: (names) => { seen.tools.push(names); return names.includes('Evil') ? 'no Evil here' : true; } });
  await ep.start();
  try {
    const body = { model: 'claude-opus-x', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'ping' }], tools: [{ name: 'Read', input_schema: { type: 'object' } }] };
    const r = await call(ep, { body });
    assert.equal(r.status, 200);
    const events = r.events();
    assert.deepEqual([events[0].type, events.at(-1).type], ['message_start', 'message_stop']);
    assert.equal(events[0].message.model, 'Auto');
    assert.equal(seen.chats[0].model, undefined, 'the CLI\'s model name is ignored');
    assert.deepEqual(seen.usage, [{ input: 4, output: 2 }]);
    const whole = await call(ep, { body: { ...body, stream: false } });
    assert.equal(whole.json().content[0].text, 'pong');
    const bad = await call(ep, { body: { ...body, tools: [{ name: 'Evil', input_schema: { type: 'object' } }] } });
    assert.equal(bad.status, 400); assert.match(bad.text, /no Evil here/);
    const count = await call(ep, { path: '/v1/messages/count_tokens', body: { messages: [{ role: 'user', content: 'x'.repeat(40) }] } });
    assert.equal(count.status, 200); assert.ok(count.json().input_tokens >= 10);
    const wrong = await call(ep, { headers: { 'x-api-key': 'nope' }, body });
    assert.equal(wrong.status, 403);
    const sec = await call(ep, { headers: { 'sec-fetch-mode': 'cors' }, body });
    assert.equal(sec.status, 403);
  } finally { await ep.close(); }
});
