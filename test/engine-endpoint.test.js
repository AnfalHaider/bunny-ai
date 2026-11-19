import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEndpoint, safeMessage } from '../src/server/engines/endpoint.js';
import { ResponsesRequestError, createResponsesStream, offeredToolNames, responsesFromChat, responsesToChat } from '../src/server/engines/translate/responses.js';

// CLI-ENGINES §2, CE-4, §5.2: the listener is on 127.0.0.1 only and refuses a wrong Host, any Origin, any Sec-Fetch-*, a missing or wrong token, another run's token and any request after the run;
// the model name the CLI sends is ignored; Responses <-> Chat round-trips text, reasoning, tool calls, tool results, the developer role, stop reasons and usage, streamed and not;
// a request that needs stored state is refused; no key appears in anything sent to a CLI.

const chunk = (delta, finish = null, usage = null) => ({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });

// ---------------------------------------------------------------- the translator

test('Responses -> Chat: instructions and the developer role become one system message; messages, images and the user text carry over', () => {
  const { chat } = responsesToChat({
    model: 'gpt-5.5', instructions: 'You are Codex.', store: false,
    input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Be brief.' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }],
    max_output_tokens: 500, temperature: 0.2, reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content'], prompt_cache_key: 'k', client_metadata: {},
  });
  assert.deepEqual(chat.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(chat.messages[0].content, 'You are Codex.\n\nBe brief.');
  assert.equal(chat.messages[2].content, 'hi there');
  assert.deepEqual(chat.messages[3].content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  assert.equal(chat.stream, true); assert.equal(chat.max_tokens, 500); assert.equal(chat.temperature, 0.2);
  for (const dropped of ['reasoning', 'include', 'prompt_cache_key', 'client_metadata', 'model', 'store']) assert.equal(dropped in chat, false, `${dropped} is not sent to the provider`);
  assert.doesNotMatch(JSON.stringify(chat), /developer/);
});

test('Responses -> Chat: a string input; reasoning items are dropped; calls and their outputs pair up, parallel calls share one assistant message, and an unanswered call gets an empty answer', () => {
  assert.deepEqual(responsesToChat({ input: 'just text' }).chat.messages, [{ role: 'user', content: 'just text' }]);
  const { chat } = responsesToChat({
    input: [{ type: 'message', role: 'user', content: 'run it' }, { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }], encrypted_content: 'zz' },
      { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"ls"}' }, { type: 'function_call', call_id: 'c2', name: 'exec_command', arguments: '{"cmd":"pwd"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'a.txt' }, { type: 'function_call_output', call_id: 'c2', output: [{ type: 'input_text', text: '/work' }] },
      { type: 'function_call', call_id: 'c3', name: 'exec_command', arguments: '{}' }],
  });
  assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'tool', 'assistant', 'tool']);
  assert.deepEqual(chat.messages[1].tool_calls.map((c) => [c.id, c.function.name, c.function.arguments]), [['c1', 'exec_command', '{"cmd":"ls"}'], ['c2', 'exec_command', '{"cmd":"pwd"}']]);
  assert.deepEqual(chat.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m.content]), [['c1', 'a.txt'], ['c2', '/work'], ['c3', '']]);
  assert.doesNotMatch(JSON.stringify(chat), /thinking|encrypted/);
});

test('Responses -> Chat: function tools pass, a custom tool (apply_patch) becomes a function with one string argument, hosted tools are not offered; tool_choice maps; none removes the tools', () => {
  const request = { input: 'x', tools: [{ type: 'function', name: 'exec_command', description: 'run', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } }, { type: 'custom', name: 'apply_patch', description: 'patch', format: { type: 'grammar' } }, { type: 'web_search' }, { type: 'tool_search', parameters: {} }], parallel_tool_calls: false };
  const { chat, customNames } = responsesToChat({ ...request, tool_choice: 'auto' });
  assert.deepEqual(chat.tools.map((t) => t.function.name), ['exec_command', 'apply_patch']);
  assert.deepEqual(chat.tools[1].function.parameters.required, ['input']);
  assert.deepEqual([...customNames], ['apply_patch']);
  assert.equal(chat.parallel_tool_calls, false);
  assert.deepEqual(offeredToolNames(request), ['exec_command', 'apply_patch', 'web_search', 'tool_search']);
  assert.equal(responsesToChat({ ...request, tool_choice: 'required' }).chat.tool_choice, 'required');
  assert.deepEqual(responsesToChat({ ...request, tool_choice: { type: 'function', name: 'exec_command' } }).chat.tool_choice, { type: 'function', function: { name: 'exec_command' } });
  assert.equal(responsesToChat({ ...request, tool_choice: 'none' }).chat.tools, undefined);
  // a custom tool call in the history goes back as a function call with the "input" argument
  const back = responsesToChat({ input: [{ type: 'custom_tool_call', call_id: 'p1', name: 'apply_patch', input: '*** Begin Patch' }, { type: 'custom_tool_call_output', call_id: 'p1', output: 'ok' }], tools: request.tools }).chat.messages;
  assert.equal(back[0].tool_calls[0].function.arguments, JSON.stringify({ input: '*** Begin Patch' }));
  assert.deepEqual([back[1].role, back[1].content], ['tool', 'ok']);
});

test('Responses -> Chat: stored state is refused with a plain error', () => {
  for (const bad of [{ input: 'x', previous_response_id: 'resp_1' }, { input: 'x', store: true }]) assert.throws(() => responsesToChat(bad), (e) => e instanceof ResponsesRequestError && /whole conversation each time/.test(e.message));
  assert.throws(() => responsesToChat(null), ResponsesRequestError);
});

function run(chunks, opts) {
  const s = createResponsesStream({ id: 'resp_t', model: 'bunny', now: () => 1, ...opts });
  const events = [];
  for (const c of chunks) events.push(...s.push(c));
  events.push(...s.finish());
  return { events, stream: s };
}

test('Chat -> Responses (streamed): text becomes one message item with deltas, then done events and a completed response with usage', () => {
  const { events, stream } = run([chunk({ role: 'assistant', content: 'Hel' }), chunk({ content: 'lo' }), chunk({}, 'stop', { prompt_tokens: 12, completion_tokens: 3 })]);
  assert.deepEqual(events.map((e) => e.type), ['response.created', 'response.output_item.added', 'response.content_part.added', 'response.output_text.delta', 'response.output_text.delta', 'response.output_text.done', 'response.content_part.done', 'response.output_item.done', 'response.completed']);
  assert.deepEqual(events.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta), ['Hel', 'lo']);
  const done = events.at(-1).response;
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.output[0].content[0].text, 'Hello');
  assert.deepEqual([done.usage.input_tokens, done.usage.output_tokens, done.usage.total_tokens], [12, 3, 15]);
  assert.deepEqual(stream.usage, { input: 12, output: 3 });
  assert.deepEqual(events.map((e) => e.sequence_number), events.map((_, i) => i), 'sequence numbers count up');
});

test('Chat -> Responses (streamed): a tool call arriving in pieces becomes a function_call item; two calls keep their order; text before a call is its own item', () => {
  const { events } = run([
    chunk({ content: 'Let me look.' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'exec_command', arguments: '{"cmd"' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: ':"ls"}' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'write_stdin', arguments: '{}' } }] }),
    chunk({}, 'tool_calls', { prompt_tokens: 5, completion_tokens: 9 }),
  ]);
  const items = events.filter((e) => e.type === 'response.output_item.done').map((e) => e.item);
  assert.deepEqual(items.map((i) => i.type), ['message', 'function_call', 'function_call']);
  assert.deepEqual([items[1].call_id, items[1].name, items[1].arguments], ['call_a', 'exec_command', '{"cmd":"ls"}']);
  assert.deepEqual([items[2].call_id, items[2].arguments], ['call_b', '{}']);
  assert.deepEqual(events.filter((e) => e.type === 'response.function_call_arguments.delta').map((e) => e.delta), ['{"cmd"', ':"ls"}', '{}']);
  assert.equal(events.at(-1).response.status, 'completed');
  assert.deepEqual(events.at(-1).response.output.map((i) => i.type), ['message', 'function_call', 'function_call']);
});

test('Chat -> Responses (streamed): a custom tool call comes back as custom_tool_call with the "input" text; reasoning becomes a reasoning item; a length stop is incomplete', () => {
  const patch = '*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch';
  const custom = run([chunk({ tool_calls: [{ index: 0, id: 'p1', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ input: patch }) } }] }), chunk({}, 'tool_calls')], { customNames: new Set(['apply_patch']) });
  const item = custom.events.find((e) => e.type === 'response.output_item.done').item;
  assert.deepEqual([item.type, item.call_id, item.name, item.input], ['custom_tool_call', 'p1', 'apply_patch', patch]);
  assert.equal(custom.events.some((e) => e.type === 'response.function_call_arguments.delta'), false);
  const thinking = run([chunk({ reasoning_content: 'hm' }), chunk({ reasoning_content: 'mm' }), chunk({ content: 'ok' }), chunk({}, 'length')]);
  assert.deepEqual(thinking.events.filter((e) => e.type === 'response.output_item.done').map((e) => e.item.type), ['reasoning', 'message']);
  assert.equal(thinking.events.find((e) => e.type === 'response.output_item.done').item.summary[0].text, 'hmmm');
  const last = thinking.events.at(-1);
  assert.deepEqual([last.type, last.response.status, last.response.incomplete_details.reason], ['response.incomplete', 'incomplete', 'max_output_tokens']);
});

test('Chat -> Responses: an upstream failure closes the stream with response.failed (never a hang); finish is safe to call twice', () => {
  const s = createResponsesStream({ id: 'r', now: () => 1 });
  s.push(chunk({ content: 'part' }));
  const closing = s.finish({ error: 'boom' });
  assert.equal(closing.at(-1).type, 'response.failed');
  assert.equal(closing.at(-1).response.error.message, 'boom');
  assert.deepEqual(s.finish(), []);
});

test('Chat -> Responses (not streamed): a whole answer with text and a tool call', () => {
  const r = responsesFromChat({ choices: [{ message: { role: 'assistant', content: 'done', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'exec_command', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 4 } }, { id: 'resp_x', model: 'bunny' });
  assert.equal(r.object, 'response'); assert.equal(r.status, 'completed');
  assert.deepEqual(r.output.map((i) => i.type), ['message', 'function_call']);
  assert.deepEqual([r.usage.input_tokens, r.usage.output_tokens], [2, 4]);
});

// ---------------------------------------------------------------- the endpoint

function call(ep, { method = 'POST', path = '/v1/responses', headers = {}, body = null, host = `127.0.0.1:${ep.port}`, token = ep.token, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === null ? null : raw ? body : JSON.stringify(body);
    const h = { host, ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: ep.port, path, method, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => { try { return JSON.parse(text); } catch { return null; } }, events: () => text.split('\n\n').filter((b) => b.startsWith('event: ')).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6))) }));
    });
    req.on('error', reject);
    req.end(data ?? undefined);
  });
}

async function started(opts = {}) {
  const seen = { chats: [], usage: [], tools: [] };
  const upstream = opts.upstream ?? async function* ({ chat }) { seen.chats.push(chat); yield chunk({ content: 'pong' }); yield chunk({}, 'stop', { prompt_tokens: 4, completion_tokens: 2 }); };
  const ep = createEndpoint({ upstream, label: 'Auto', onUsage: (u) => seen.usage.push(u), onToolList: opts.onToolList ?? ((names) => { seen.tools.push(names); return true; }), ...opts.extra });
  await ep.start();
  return { ep, seen };
}
const ok = { input: 'ping', model: 'gpt-5.5', stream: true };

test('the endpoint listens on 127.0.0.1 only, on a port the system chose, and answers a request that carries the run\'s token', async () => {
  const { ep, seen } = await started();
  try {
    assert.ok(ep.port > 0);
    const r = await call(ep, { body: ok });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/event-stream/);
    const events = r.events();
    assert.equal(events.at(-1).type, 'response.completed');
    assert.equal(events.at(-1).response.output[0].content[0].text, 'pong');
    assert.equal(events.at(-1).response.model, 'Auto', 'the chat\'s own model label, not the CLI\'s');
    assert.deepEqual(seen.usage, [{ input: 4, output: 2 }]);
    const base = (await import('node:net')).default;
    assert.ok(base);
  } finally { await ep.close(); }
});

test('the endpoint refuses, with a bare 403: a wrong Host, any Origin, any Sec-Fetch-* header, a missing token, a wrong token, and another run\'s token; no detail, no CORS, no-store', async () => {
  const a = await started(); const b = await started();
  try {
    const attempts = [
      { host: 'localhost:' + a.ep.port }, { host: `127.0.0.1:${a.ep.port + 1}` }, { host: '127.0.0.1' }, { host: 'evil.example' },
      { headers: { origin: 'http://127.0.0.1:5173' } }, { headers: { origin: 'null' } }, { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { 'sec-fetch-mode': 'cors' } }, { headers: { 'sec-fetch-dest': 'empty' } },
      { token: null }, { token: 'wrong' }, { token: '' }, { token: b.ep.token }, { token: a.ep.token.slice(0, -1) }, { token: `${a.ep.token}x` },
    ];
    for (const extra of attempts) {
      const r = await call(a.ep, { body: ok, ...extra });
      assert.equal(r.status, 403, JSON.stringify(extra));
      assert.equal(r.text, '{}', 'no detail');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')), 'no CORS headers');
    }
    // a token in x-api-key works too (Claude Code and Aider send it that way); it never counts for a different run
    assert.equal((await call(a.ep, { body: ok, token: null, headers: { 'x-api-key': a.ep.token } })).status, 200);
    assert.equal((await call(a.ep, { body: ok, token: null, headers: { 'x-api-key': b.ep.token } })).status, 403);
    assert.equal(a.ep.stats.refused, attempts.length + 1);
    assert.equal(a.seen.chats.length, 1, 'nothing refused reached the provider');
  } finally { await a.ep.close(); await b.ep.close(); }
});

test('after the run, the listener is closed: no request is answered', async () => {
  const { ep } = await started();
  const port = ep.port;
  await ep.close();
  assert.equal(ep.closed, true);
  await assert.rejects(() => call({ port, token: ep.token }, { body: ok }), /ECONNREFUSED|ECONNRESET/);
});

test('only the listed paths are answered (404 after authentication); GET /v1/models gives one entry, the chat\'s model label', async () => {
  const { ep } = await started();
  try {
    for (const [method, path] of [['GET', '/'], ['POST', '/v1/embeddings'], ['GET', '/v1/responses'], ['POST', '/v1/models'], ['DELETE', '/v1/chat/completions'], ['GET', '/api/settings'], ['POST', '/v1/messages']]) assert.equal((await call(ep, { method, path, body: method === 'POST' ? {} : null })).status, 404, `${method} ${path}`);
    const models = (await call(ep, { method: 'GET', path: '/v1/models' })).json();
    assert.deepEqual(models.data.map((m) => m.id), ['Auto']);
  } finally { await ep.close(); }
});

test('a body that is not JSON, or too big, is refused; a stored-state request gets a plain 400; the model name the CLI sends is ignored', async () => {
  const { ep, seen } = await started({ extra: { maxBytes: 2000 } });
  try {
    assert.equal((await call(ep, { body: 'not json', raw: true })).status, 400);
    assert.equal((await call(ep, { body: JSON.stringify({ input: 'x'.repeat(5000) }), raw: true })).status, 413);
    const stored = await call(ep, { body: { input: 'x', previous_response_id: 'r1' } });
    assert.equal(stored.status, 400); assert.match(stored.json().error.message, /whole conversation each time/);
    assert.equal(seen.chats.length, 0);
    await call(ep, { body: { input: 'hi', model: 'o3-super-secret-model' } });
    assert.equal('model' in seen.chats[0], false, 'the provider is never told the CLI\'s model name');
  } finally { await ep.close(); }
});

test('the engine\'s tool list is checked on the request: an unexpected tool refuses the request (CE-1.16)', async () => {
  const { ep, seen } = await started({ onToolList: (names) => (names.every((n) => ['exec_command', 'apply_patch'].includes(n)) ? true : `The engine offered a tool Bunny does not allow: ${names.find((n) => !['exec_command', 'apply_patch'].includes(n))}.`) });
  try {
    assert.equal((await call(ep, { body: { input: 'x', tools: [{ type: 'function', name: 'exec_command', parameters: {} }] } })).status, 200);
    const bad = await call(ep, { body: { input: 'x', tools: [{ type: 'function', name: 'view_image', parameters: {} }] } });
    assert.equal(bad.status, 400); assert.match(bad.json().error.message, /view_image/);
    assert.equal(seen.chats.length, 1);
  } finally { await ep.close(); }
});

test('an upstream failure comes back as response.failed; text that looks like a key is never passed on; nothing sensitive is in the headers', async () => {
  const { ep } = await started({ upstream: async function* () { yield chunk({ content: 'part' }); throw new Error('401 Unauthorized for key sk-live-0123456789abcdef0123456789abcdef'); } });
  try {
    const r = await call(ep, { body: ok });
    const last = r.events().at(-1);
    assert.equal(last.type, 'response.failed');
    assert.doesNotMatch(r.text, /sk-live|0123456789abcdef/);
    assert.match(last.response.error.message, /details are not passed on/);
    for (const h of ['set-cookie', 'authorization', 'x-api-key', 'www-authenticate', 'server']) assert.equal(r.headers[h], undefined, h);
  } finally { await ep.close(); }
  assert.match(safeMessage(new Error('plain trouble')), /plain trouble/);
  assert.match(safeMessage(new Error('Bearer sk-abcdefghijklmnopqrstu')), /not passed on/);
});

test('POST /v1/responses without streaming returns one Responses object; POST /v1/chat/completions passes a chat on (stream and not), dropping the model', async () => {
  const { ep, seen } = await started();
  try {
    const whole = (await call(ep, { body: { ...ok, stream: false } })).json();
    assert.equal(whole.object, 'response'); assert.equal(whole.output[0].content[0].text, 'pong');
    const chatBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], stream_options: { include_usage: true } };
    const plain = (await call(ep, { path: '/v1/chat/completions', body: chatBody })).json();
    assert.equal(plain.choices[0].message.content, 'pong'); assert.equal(plain.model, 'Auto'); assert.equal(plain.usage.completion_tokens, 2);
    const streamed = await call(ep, { path: '/v1/chat/completions', body: { ...chatBody, stream: true } });
    assert.match(streamed.text, /^data: \{/); assert.match(streamed.text, /data: \[DONE\]\n\n$/);
    assert.equal(seen.chats.at(-1).stream, true); assert.equal('model' in seen.chats.at(-1), false); assert.equal('stream_options' in seen.chats.at(-1), false);
    assert.equal((await call(ep, { path: '/v1/chat/completions', body: { model: 'x' } })).status, 400, 'no messages');
  } finally { await ep.close(); }
});

test('at most 4 requests at once per run (the fifth gets 429); closing the endpoint ends the ones in flight', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let arrived = 0;
  const { ep } = await started({ upstream: async function* () { arrived += 1; await gate; yield chunk({ content: 'late' }); yield chunk({}, 'stop'); } });
  try {
    const four = [1, 2, 3, 4].map(() => call(ep, { body: ok }));
    while (arrived < 4) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await call(ep, { body: ok })).status, 429);
    release();
    assert.deepEqual((await Promise.all(four)).map((r) => r.status), [200, 200, 200, 200]);
  } finally { await ep.close(); }
  let started2; const hang = new Promise((r) => { started2 = r; });
  const second = await started({ upstream: async function* ({ signal }) { started2(); await new Promise((r) => signal.addEventListener('abort', r)); } });
  const pending = call(second.ep, { body: ok }).catch((e) => e);
  await hang;
  await second.ep.close();
  const ended = await pending;
  assert.ok(ended instanceof Error || ended.status === 200, 'the request in flight ended when the endpoint closed');
});
