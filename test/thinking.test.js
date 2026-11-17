import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { thinkingBody, thinkingLevels, THINKING_LEVELS } from '../src/providers/thinking.js';
import { refusesThinking } from '../src/server/chat.js';

// W4-13b: the Thinking choice: only for providers whose field is known, in that provider's own field; a refusal is asked again without it.
const jsonH = { 'content-type': 'application/json' };

test('known providers get their own field; unknown providers (and a level they do not take) get nothing', () => {
  assert.deepEqual(thinkingBody('openai', 'high'), { reasoning_effort: 'high' });
  assert.deepEqual(thinkingBody('google', 'low'), { reasoning_effort: 'low' });
  assert.deepEqual(thinkingBody('openrouter', 'medium'), { reasoning: { effort: 'medium' } });
  assert.deepEqual(thinkingBody('groq', 'low'), { reasoning_effort: 'low' });
  assert.deepEqual(thinkingBody('moonshot', 'high'), { reasoning_effort: 'high' });
  for (const p of ['nvidia', 'modelscope', 'gitee-ai', 'anthropic', 'zhipu', 'dashscope', 'ollama', 'made-up']) {
    assert.deepEqual(thinkingLevels(p), [], p);
    assert.equal(thinkingBody(p, 'high'), null, p);
  }
  assert.deepEqual(thinkingLevels('cerebras'), ['low', 'high'], 'Cerebras and Kimi have no medium');
  assert.equal(thinkingBody('cerebras', 'medium'), null);
  assert.equal(thinkingBody('openai', 'max'), null, 'only the levels every model of the provider takes');
  assert.equal(thinkingBody('openai', null), null, 'Default sends nothing');
  assert.deepEqual(THINKING_LEVELS, ['low', 'medium', 'high']);
});

test('the page has its own copy of the table (the browser can only import from src/ui) and it says the same', async () => {
  const ui = await import('../src/ui/thinking.js');
  for (const p of ['openai', 'google', 'openrouter', 'groq', 'xai', 'deepseek', 'together', 'fireworks', 'cerebras', 'moonshot', 'anthropic', 'nvidia', 'zhipu', 'made-up']) {
    assert.deepEqual(ui.thinkingLevels(p), thinkingLevels(p), p);
  }
});

test('only a refusal ABOUT the thinking field counts, and only when the request carries one', () => {
  const say = (m) => ({ code: 'chat.http', message: `The provider answered 400: ${m}` });
  const withField = { reasoning_effort: 'high' };
  assert.equal(refusesThinking(say('reasoning_effort is not supported by this model'), withField), true);
  assert.equal(refusesThinking(say('Unrecognized request argument supplied: reasoning'), withField), true);
  assert.equal(refusesThinking(say('thinking is not allowed for this model'), { thinking: { type: 'enabled' } }), true);
  assert.equal(refusesThinking(say('max_tokens is too large for a model that thinks'), withField), false);
  assert.equal(refusesThinking(say('reasoning_effort is not supported'), {}), false, 'nothing of the kind was sent');
  assert.equal(refusesThinking({ code: 'chat.http', message: 'The provider answered 500: reasoning is not available' }, withField), false);
});

async function setup(t, providerId, { refuse = false } = {}) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"some-model"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      if (refuse && 'reasoning_effort' in body) { res.writeHead(400, jsonH); res.end('{"error":{"message":"reasoning_effort is not supported by this model"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'plain' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, `/api/providers/${providerId}/connect`, { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'W413b' });
  const say = async (extra) => (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'think', providerId, model: 'some-model', ...extra }) })).text();
  return { seen, say };
}

test('through a real reply: the chosen level goes in the provider\'s own field; Default and an unchosen level send nothing', async (t) => {
  const s = await setup(t, 'openai');
  await s.say({ thinking: 'high' });
  assert.equal(s.seen.at(-1).reasoning_effort, 'high');
  await s.say({});
  assert.ok(!('reasoning_effort' in s.seen.at(-1)) && !('reasoning' in s.seen.at(-1)), 'Default sends nothing');
  await s.say({ thinking: 'extreme' });
  assert.ok(!('reasoning_effort' in s.seen.at(-1)), 'a level that is not one of ours is ignored');
});

test('through a real reply: a provider whose field is not known is sent nothing, even if the page asks', async (t) => {
  const s = await setup(t, 'mistral');
  await s.say({ thinking: 'high' });
  assert.ok(!('reasoning_effort' in s.seen.at(-1)) && !('reasoning' in s.seen.at(-1)) && !('thinking' in s.seen.at(-1)));
});

test('through a real reply: a model that refuses the field is asked again without it, and the person is told', async (t) => {
  const s = await setup(t, 'openai', { refuse: true });
  const text = await s.say({ thinking: 'low' });
  assert.equal(s.seen.length, 2, 'asked with the field, then without');
  assert.ok('reasoning_effort' in s.seen[0] && !('reasoning_effort' in s.seen[1]));
  assert.match(text, /plain/);
  assert.match(text, /Thinking setting not used/);
});
