import { test } from 'node:test';
import assert from 'node:assert/strict';

import { streamChat, fakeStream } from '../src/server/chat.js';

/** Build a fake fetch that returns a canned SSE body. */
function sseFetch(frames, { status = 200, headers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return new Response(body, {
      status,
      headers: { 'content-type': 'text/event-stream', ...headers },
    });
  };
  return { fetchImpl, calls };
}

const collect = async (gen) => {
  const out = [];
  for await (const part of gen) out.push(part);
  return out;
};

const frame = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test('deltas are yielded in order and the stream ends at [DONE]', async () => {
  const { fetchImpl } = sseFetch([frame('Hel'), frame('lo'), 'data: [DONE]\n\n', frame('never')]);
  const parts = await collect(streamChat({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
  }));
  assert.deepEqual(parts, ['Hel', 'lo']);
});

test('the request carries the key, the model and stream: true', async () => {
  const { fetchImpl, calls } = sseFetch([frame('ok'), 'data: [DONE]\n\n']);
  await collect(streamChat({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    model: 'model-x',
    messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }],
    fetchImpl,
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-secret');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'model-x');
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'be nice' },
    { role: 'user', content: 'hi' },
  ]);
});

test('no key means no authorization header', async () => {
  const { fetchImpl, calls } = sseFetch([frame('x'), 'data: [DONE]\n\n']);
  await collect(streamChat({
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
  }));
  assert.equal('authorization' in calls[0].init.headers, false);
});

test('a frame split across chunks is reassembled', async () => {
  const whole = frame('split me');
  const cut = Math.floor(whole.length / 2);
  const { fetchImpl } = sseFetch([whole.slice(0, cut), whole.slice(cut), 'data: [DONE]\n\n']);
  const parts = await collect(streamChat({
    baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl,
  }));
  assert.deepEqual(parts, ['split me']);
});

test('comments and keep-alive frames are ignored', async () => {
  const { fetchImpl } = sseFetch([
    ': keep-alive\n\n',
    'event: ping\ndata: not-json\n\n',
    'data: {"choices":[]}\n\n',
    frame('real'),
    'data: [DONE]\n\n',
  ]);
  const parts = await collect(streamChat({
    baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl,
  }));
  assert.deepEqual(parts, ['real']);
});

test('a stream that ends without [DONE] still returns what arrived', async () => {
  const { fetchImpl } = sseFetch([frame('partial')]);
  const parts = await collect(streamChat({
    baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl,
  }));
  assert.deepEqual(parts, ['partial']);
});

test('a rejected key becomes chat.unauthorized', async () => {
  const { fetchImpl } = sseFetch([], { status: 401 });
  await assert.rejects(
    () => collect(streamChat({ baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl })),
    (err) => err.code === 'chat.unauthorized',
  );
});

test('a 403 is treated as a rejected key too', async () => {
  const { fetchImpl } = sseFetch([], { status: 403 });
  await assert.rejects(
    () => collect(streamChat({ baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl })),
    (err) => err.code === 'chat.unauthorized',
  );
});

test('a server error keeps the status in the message', async () => {
  const { fetchImpl } = sseFetch([], { status: 503 });
  await assert.rejects(
    () => collect(streamChat({ baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl })),
    (err) => err.code === 'chat.http' && /503/.test(err.message),
  );
});

test('an unreachable host becomes chat.unreachable', async () => {
  const fetchImpl = async () => { throw new TypeError('getaddrinfo ENOTFOUND'); };
  await assert.rejects(
    () => collect(streamChat({ baseUrl: 'https://nowhere.invalid/v1', model: 'm', messages: [], fetchImpl })),
    (err) => err.code === 'chat.unreachable' && /nowhere\.invalid/.test(err.message),
  );
});

test('aborting mid-request ends the generator quietly', async () => {
  const controller = new AbortController();
  const fetchImpl = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const parts = await collect(streamChat({
    baseUrl: 'https://x/v1', model: 'm', messages: [], fetchImpl, signal: controller.signal,
  }));
  assert.deepEqual(parts, []);
});

test('test mode answers without any network call', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  const parts = await collect(streamChat({
    baseUrl: 'https://x/v1', model: 'test-model', messages: [{ role: 'user', content: 'ping' }],
    fake: true, fetchImpl,
  }));
  const text = parts.join('');
  assert.match(text, /test-model/);
  assert.match(text, /ping/);
});

test('the fake stream echoes only the latest user turn', async () => {
  const parts = await collect(fakeStream('m', [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ]));
  const text = parts.join('');
  assert.match(text, /second/);
  assert.equal(text.includes('first'), false);
});

/** A provider that answers each request with the next canned SSE body. */
function scriptedFetch(bodies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const frames = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    const body = new ReadableStream({ start(c) { const e = new TextEncoder(); for (const f of frames) c.enqueue(e.encode(f)); c.close(); } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetchImpl, calls };
}
const toolFrame = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'look', arguments: '{}' } }] } }] })}\n\n`;
const tools = [{ type: 'function', function: { name: 'look', parameters: { type: 'object', properties: {} } } }];

test('a model that uses a tool and then says nothing is asked once for its answer', async () => {
  const { fetchImpl, calls } = scriptedFetch([[toolFrame, 'data: [DONE]\n\n'], ['data: [DONE]\n\n'], [frame('The title is Example'), 'data: [DONE]\n\n']]);
  const parts = await collect(streamChat({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'go' }],
    fetchImpl, tools, runTool: async () => 'found it',
  }));
  assert.equal(parts.join(''), 'The title is Example');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].tools, undefined, 'the last ask offers no tools');
  assert.match(calls[2].messages.at(-1).content, /Stop using tools now and reply to me. Say briefly what you did/);
});

test('a model that runs out of tool steps still gives an answer', async () => {
  const { fetchImpl, calls } = scriptedFetch([[toolFrame, 'data: [DONE]\n\n'], [toolFrame, 'data: [DONE]\n\n'], [frame('Best so far'), 'data: [DONE]\n\n']]);
  const parts = await collect(streamChat({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'go' }],
    fetchImpl, tools, runTool: async () => 'more', maxToolRounds: 2,
  }));
  assert.equal(parts.join(''), 'Best so far');
  assert.equal(calls.length, 3);
});
