/**
 * T-3 (model switching): the server side. A model that does not answer is given up on quickly, every failure says
 * whose fault it is, the failed attempts do not pile up in the chat, and the answer remembers why it moved on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, post } from './helpers.js';
import { streamChat, DEFAULT_STALL_MS, SLOW_FIRST_BYTE_MS, DEFAULT_GAP_MS, firstByteLimit } from '../src/server/chat.js';
import { failureKind } from '../src/server/unavailable.js';

const sse = (delta, finish) => `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
const j = { 'content-type': 'application/json' };

/** A model server with personalities by model id. */
async function modelServer(t) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: ['good', 'limited', 'quiet', 'empty', 'filtered', 'down'].map((id) => ({ id })) })); return; }
      const body = JSON.parse(raw);
      hits.push(body.model);
      if (body.model === 'quiet') return; // accepts the request and never answers
      if (body.model === 'limited') { res.writeHead(429, j); res.end('{"error":{"message":"Rate limit exceeded"}}'); return; }
      if (body.model === 'down') { res.writeHead(500, j); res.end('{"error":{"message":"upstream exploded"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.model === 'empty') { res.end('data: [DONE]\n\n'); return; }
      if (body.model === 'filtered') { res.end(sse({}, 'content_filter') + 'data: [DONE]\n\n'); return; }
      res.end(sse({ content: 'hello from good' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { hits, url: `http://127.0.0.1:${server.address().port}/v1` };
}

async function app(t) {
  const { base } = await startApp(t, { fake: false });
  const { url, hits } = await modelServer(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: url });
  const { body: s } = await post(base, '/api/sessions', { title: 't3', providerId: 'openai', model: 'good' });
  return { base, hits, id: s.id, url };
}
const say = async (base, id, model, extra = {}) => (await fetch(`${base}/api/sessions/${id}/messages`, {
  method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model, workMode: 'chat', ...extra }),
})).text();
const errorEvent = (stream) => JSON.parse(/event: error\ndata: (.*)/.exec(stream)?.[1] ?? 'null');
const saved = async (base, id) => (await (await fetch(`${base}/api/sessions/${id}`)).json()).messages;

test('T3-1: the limits are one place, and a silent model is given up on at the injected limit', async (t) => {
  assert.ok(DEFAULT_STALL_MS <= 30_000 && SLOW_FIRST_BYTE_MS <= 60_000 && DEFAULT_GAP_MS <= 60_000);
  assert.equal(firstByteLimit('gpt-4o'), DEFAULT_STALL_MS);
  assert.equal(firstByteLimit('deepseek-r1'), SLOW_FIRST_BYTE_MS);
  assert.equal(firstByteLimit('some-image-model'), SLOW_FIRST_BYTE_MS);
  const { url } = await modelServer(t);
  const t0 = Date.now();
  await assert.rejects(async () => { for await (const _ of streamChat({ baseUrl: url, apiKey: 'k', model: 'quiet', messages: [{ role: 'user', content: 'hi' }], stallMs: 300 })) { /* nothing */ } },
    (err) => err.code === 'chat.stalled');
  assert.ok(Date.now() - t0 < 3000, 'gave up quickly, not after minutes');
});

test('T3-2/T3-3: each kind of failure says whose fault it is, in the error event', async (t) => {
  const { base, id } = await app(t);
  const cases = { limited: ['model', 'rate-limit'], down: ['model', 'unavailable'], empty: ['model', 'empty'], filtered: ['model', 'refused'] };
  for (const [model, [scope, reason]] of Object.entries(cases)) {
    const err = errorEvent(await say(base, id, model));
    assert.deepEqual([err?.scope, err?.reason], [scope, reason], model);
  }
});

test('failureKind: provider-wide failures, and errors that are not the model\'s fault', () => {
  assert.deepEqual(failureKind({ code: 'chat.unreachable', message: 'Could not reach x' }), { scope: 'provider', reason: 'unreachable' });
  assert.deepEqual(failureKind({ code: 'chat.unauthorized', message: 'rejected' }), { scope: 'provider', reason: 'key' });
  assert.equal(failureKind({ code: 'chat.stalled', message: 'x' }).reason, 'timeout');
  assert.equal(failureKind({ code: 'speech.failed', message: 'x' }).scope, 'other');
  assert.equal(failureKind({ code: 'model.notSelected', message: 'x' }).scope, 'other');
});

test('T3-2/Q2-11: a fallback answer leaves no "could not finish" line, and carries why and how many', async (t) => {
  const { base, id } = await app(t);
  await say(base, id, 'limited', { attemptsLeft: 2 });
  await say(base, id, 'down', { retry: true, attemptsLeft: 1 });
  await say(base, id, 'good', { retry: true, attemptsLeft: 0, fellBackFrom: 'quiet', fellBackReason: 'timeout', fellBackTries: 2 });
  const messages = await saved(base, id);
  assert.equal(messages.filter((m) => m.kind === 'error').length, 0, JSON.stringify(messages.map((m) => m.kind)));
  const answer = messages.findLast((m) => m.role === 'assistant');
  assert.equal(answer.content, 'hello from good');
  assert.deepEqual([answer.fellBackFrom, answer.fellBackReason, answer.fellBackTries], ['quiet', 'timeout', 2]);
});

test('T3-7/T3-8: every failure is saved, but a retry replaces the last note, so the chat holds exactly one', async (t) => {
  const { base, id } = await app(t);
  const notes = async () => (await saved(base, id)).filter((m) => m.kind === 'error');
  await say(base, id, 'limited', { attemptsLeft: 2 });
  assert.equal((await notes()).length, 1, 'a reload would show why the reply stopped');
  await say(base, id, 'down', { retry: true, attemptsLeft: 1 });
  assert.equal((await notes()).length, 1);
  await say(base, id, 'empty', { retry: true, attemptsLeft: 0 });
  const last = await notes();
  assert.equal(last.length, 1);
  assert.match(last[0].content, /^empty could not finish/);
});

test('a provider-wide failure with only one provider connected still leaves exactly one note (nothing else to switch to)', async (t) => {
  const { base, id } = await app(t);
  await say(base, id, 'limited', { attemptsLeft: 1 }); // the page found no next model and stopped here
  const notes = (await saved(base, id)).filter((m) => m.kind === 'error');
  assert.equal(notes.length, 1);
});

test('reasoning models get the longer first-byte limit (o-series, gpt-5)', () => {
  for (const id of ['o1', 'o3-mini', 'openai/o4-mini', 'gpt-5', 'gpt-5-mini', 'deepseek-r1', 'qwq-thinking']) assert.equal(firstByteLimit(id), SLOW_FIRST_BYTE_MS, id);
  for (const id of ['gpt-4o', 'gpt-4.1', 'claude-sonnet', 'llama-3.1-8b', 'solo-model']) assert.equal(firstByteLimit(id), DEFAULT_STALL_MS, id);
});

test('an error that is not about the model is saved even when attempts remain (another model would not help)', async (t) => {
  const { base, id } = await app(t);
  const notConnected = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hi', providerId: 'anthropic', model: 'x', attemptsLeft: 2 }) });
  const body = await notConnected.text();
  assert.ok(notConnected.status >= 400 || /event: error/.test(body), body.slice(0, 200));
});
