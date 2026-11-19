/**
 * Providers that do not speak plain OpenAI.
 *
 * Each of these was a real failure with a real key:
 *   - Anthropic's model list wants the key in x-api-key, and its OpenAI shape
 *     lives under /v1.
 *   - Gemini's OpenAI-compatible API lives under /openai, and its model list
 *     names models "models/gemini-...".
 *   - A provider that publishes models your account cannot reach answers 404,
 *     and says so.
 *   - A provider that bills by the token refuses a request it thinks is huge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, json, post, put } from './helpers.js';
import { findProvider } from '../src/providers/catalog.js';
import { normalizeModels } from '../src/providers/discovery.js';
import { affordableTokens, modelSpecificFailure } from '../src/server/unavailable.js';

// ---------------------------------------------------------------- catalogue

test('Anthropic points at the OpenAI shape and uses its own header', () => {
  const provider = findProvider('anthropic');
  assert.equal(provider.defaultBaseUrl, 'https://api.anthropic.com/v1');
  assert.equal(provider.auth.header, 'x-api-key');
  assert.equal(provider.auth.extra['anthropic-version'], '2023-06-01');
});

test('Google points at the OpenAI-compatible address', () => {
  const provider = findProvider('google');
  assert.equal(provider.defaultBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
});

test('the other providers keep the plain OpenAI default', () => {
  for (const id of ['openai', 'nvidia', 'openrouter', 'vercel']) {
    const provider = findProvider(id);
    assert.equal(provider.auth, undefined, `${id} needs no special header`);
    assert.match(provider.defaultBaseUrl, /^https:\/\//);
  }
});

// ---------------------------------------------------------------- discovery

test('a model list that names models "models/x" is understood', () => {
  const models = normalizeModels({ models: [{ name: 'models/gemini-3.0-pro' }] });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'gemini-3.0-pro');
});

test('a provider whose list is empty is not a crash', () => {
  const models = normalizeModels({ data: [] });
  assert.deepEqual(models, []);
});

// ---------------------------------------------------------------- failures

test('the affordable token count is read from what the provider said', () => {
  assert.equal(
    affordableTokens('You requested up to 4096 tokens, but can only afford 1599.'),
    1599,
  );
  assert.equal(affordableTokens('You requested up to 65,536 tokens, but can only afford 1,000.'), 1000);
  assert.equal(affordableTokens('something else entirely'), null);
});

test('a failure about the model itself is recognised', () => {
  assert.ok(modelSpecificFailure("Function 'abc': Not found for account 'xyz'"));
  assert.ok(modelSpecificFailure('The model has reached its end of life and is no longer available'));
  assert.equal(modelSpecificFailure('Rate limit exceeded'), null);
});

// ---------------------------------------------------------------- live routes

/** A stub provider that answers the way we tell it to. */
async function startStub(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url, body: body ? JSON.parse(body) : null, headers: req.headers });
      handler(req, res, seen.length);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

test('a request that asks for more than the balance covers is retried smaller', async (t) => {
  let calls = 0;
  const stub = await startStub((req, res, count) => {
    calls = count;
    if (count === 1) {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'This request requires more credits. You requested up to 4096 tokens, but can only afford 100.' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'short enough' } }] })}\n\ndata: [DONE]\n\n`);
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'retry' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }),
  });
  const text = await res.text();

  assert.match(text, /short enough/);
  assert.equal(calls, 2, 'the request should have been tried twice');
  // The second try asked for what the balance covers.
  const second = stub.seen.find((s) => s.url.endsWith('/chat/completions') && s.body.max_tokens === 100);
  assert.ok(second, 'the retry should ask for the affordable number of tokens');
});

test('a request always carries a token limit', async (t) => {
  const stub = await startStub((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'limit' });
  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }),
  }).then((r) => r.text());

  const call = stub.seen.find((s) => s.url.endsWith('/chat/completions'));
  assert.ok(call.body.max_tokens > 0, 'the request should carry a limit');
});

test('a model the account cannot reach is remembered and marked', async (t) => {
  // The catalogue is public, but the chat endpoint refuses this model.
  const stub = await startStub((req, res) => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: "Function 'abc-123': Not found for account 'xyz'" } }));
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false, discover: null });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'unavailable' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }),
  });
  const text = await res.text();
  assert.match(text, /modelUnavailable/);

  // The picker now says the model cannot be used, and why.
  const { body: models } = await json(base, '/api/models');
  const model = models.find((m) => m.id === 'gpt-4o');
  assert.ok(model);
  assert.match(model.unavailable, /Not found for account/);
});

test('a model that is not provisioned yet is retried and works', async (t) => {
  // Nvidia provisions a model on first use: 404 first, then it serves it.
  let calls = 0;
  const stub = await startStub((req, res, count) => {
    calls = count;
    if (count === 1) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: "Function 'abc': Not found for account 'xyz'" } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'provisioned now' } }] })}\n\ndata: [DONE]\n\n`);
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'provision' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'test-model-1' }),
  });
  const text = await res.text();

  assert.match(text, /provisioned now/);
  assert.equal(calls, 2, 'the request should have been tried twice');
});

test('a model that stays unreachable is marked after the retry', async (t) => {
  let calls = 0;
  const stub = await startStub((req, res, count) => {
    calls = count;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: "Function 'abc': Not found for account 'xyz'" } }));
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'unavailable' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'test-model-1' }),
  });
  const text = await res.text();

  assert.match(text, /modelUnavailable/);
  assert.equal(calls, 2, 'one retry before giving up');
});

test('a provider that goes silent is reported instead of hanging', async (t) => {
  // Accepts the request, sends one chunk, then never another byte.
  const stub = await startStub((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first' } }] })}\n\n`);
    // res deliberately never ends.
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { streamChat } = await import('../src/server/chat.js');
  const chunks = [];
  await assert.rejects(
    (async () => {
      for await (const delta of streamChat({
        baseUrl: stub.url, apiKey: 'sk-test', model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        stallMs: 250,
      })) chunks.push(delta);
    })(),
    (err) => err.code === 'chat.stalled',
  );
  assert.deepEqual(chunks, ['first'], 'what arrived before the silence is kept');
});

test('the google 404-on-models quirk does not wave a bad key through', async (t) => {
  // Google's OpenAI-compatible list answers 404 without a key and 400 with
  // a bad one. Connecting with a bad key must fail, not "connect unverified".
  const stub = await startStub((req, res, count) => {
    if (req.headers.authorization) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Please pass a valid API key' } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.' } }));
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false, probe: null });
  const { status, body } = await post(base, '/api/providers/google/connect', { apiKey: 'AIzaSyDUMMYKEY000000000000000000000', baseUrl: stub.url }); // the stub above, not the real Google (TEST-DNS: a unit test never leaves this computer)
  assert.equal(status, 400);
  assert.equal(body.code, 'probe.unauthorized');
  // And nothing was saved: the provider stays disconnected.
  const { body: providers } = await json(base, '/api/providers');
  assert.equal(providers.find((p) => p.id === 'google').status, 'error');
});

test('the provider explanation reaches the person', async (t) => {
  const stub = await startStub((req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day.' } }));
  });
  t.after(() => new Promise((r) => stub.server.close(r)));

  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: stub.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'rate limited' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }),
  });
  const text = await res.text();
  // The provider's own words, not "the provider answered 429".
  assert.match(text, /free-models-per-day/);
});
