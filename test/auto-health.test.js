import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rankModels, scoreModel, whyPicked } from '../src/ui/model-abilities.js';
import { cooldownFor, failureKind } from '../src/server/unavailable.js';
import { startApp, post, json } from './helpers.js';

const models = (ids) => ids.map((id) => ({ id, providerId: 'p' }));

// W6-5: Auto leaves dead models, rests a provider that refused, and prefers models strong at tool use for Code.
test('rankModels skips an unavailable model and a provider that is cooling down', () => {
  const list = models(['openai/gpt-5', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro']);
  assert.equal(rankModels(list, 'code')[0].id, 'openai/gpt-5');
  list[0].unavailable = "Function 'x': Not found for account";
  assert.ok(!rankModels(list, 'code').some((m) => m.id === 'openai/gpt-5'), 'a dead model is out of Auto');
  list[1].coolingUntil = Date.now() + 60_000;
  assert.deepEqual(rankModels(list, 'code').map((m) => m.id), ['google/gemini-2.5-pro'], 'a cooling provider is out until it is over');
  list[1].coolingUntil = Date.now() - 1;
  assert.ok(rankModels(list, 'code').some((m) => m.id === 'anthropic/claude-sonnet-4'), 'and back when the time is up');
});

test('for Code, strong tool-use models beat small, nano and flash ones, and Auto says why', () => {
  const list = models(['nvidia/nemotron-nano-30b-reasoning', 'google/gemini-2.5-flash', 'meta/llama-3.1-8b-instruct', 'openai/gpt-oss-20b', 'deepseek-ai/deepseek-v3.1', 'openai/gpt-5']);
  const ranked = rankModels(list, 'code').map((m) => m.id);
  assert.deepEqual(ranked.slice(0, 2), ['openai/gpt-5', 'deepseek-ai/deepseek-v3.1']);
  assert.ok(ranked.indexOf('google/gemini-2.5-flash') > ranked.indexOf('deepseek-ai/deepseek-v3.1'));
  assert.ok(scoreModel({ id: 'meta/llama-3.1-8b-instruct' }, 'code') < 0);
  assert.equal(whyPicked({ id: 'openai/gpt-5' }, 'code'), 'strong at coding and tool use');
  assert.equal(whyPicked({ id: 'openai/gpt-5' }, 'chat'), null);
});

test('a usage-limit refusal rests the provider for an hour, a plain 429 for two minutes', () => {
  assert.equal(cooldownFor('The provider answered 429: Free usage limit reached'), 60 * 60_000);
  assert.equal(cooldownFor('The provider answered 429: too many requests'), 2 * 60_000);
  assert.equal(cooldownFor('The provider answered 404: Not found for account'), 0);
  assert.equal(failureKind({ code: 'chat.http', message: 'The provider answered 429: Free usage limit reached' }).reason, 'rate-limit');
  assert.equal(failureKind({ code: 'chat.http', message: 'Free usage limit reached' }).reason, 'rate-limit');
});

test('after a 429 the provider is marked cooling across messages, and the error tells the page', async (t) => {
  const server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Free usage limit reached' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false, discover: null });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  assert.equal((await json(base, '/api/models')).body.find((m) => m.id === 'gpt-4o').coolingUntil, null);
  const { body: session } = await post(base, '/api/sessions', { title: 'Cool' });
  const text = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hi', providerId: 'openai', model: 'gpt-4o' }),
  }).then((r) => r.text());
  assert.match(text, /"coolingUntil":\d+/);
  const until = (await json(base, '/api/models')).body.find((m) => m.id === 'gpt-4o').coolingUntil;
  assert.ok(until > Date.now() + 50 * 60_000, 'about an hour, kept for the next message');
});
