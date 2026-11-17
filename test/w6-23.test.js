import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

// W6-23: after a fallback that finished the job, no red "could not finish" group stays in the chat, even when the model that finished ran steps first.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

async function chat(t) {
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"limited"},{"id":"tooler"},{"id":"broken"}]}'); return; }
      const body = JSON.parse(raw);
      if (body.model === 'limited') { res.writeHead(429, jsonH); res.end('{"error":{"message":"Rate limit exceeded"}}'); return; }
      if (body.model === 'broken') { res.writeHead(500, jsonH); res.end('{"error":{"message":"upstream exploded"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const told = body.messages.some((m) => m.role === 'tool');
      res.end(sse(told ? { content: 'all done' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_models', arguments: '{}' } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'W623' });
  const say = async (model, extra = {}) => (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'do the job', providerId: 'openai', model, ...extra }) })).text();
  const saved = async () => (await (await fetch(`${base}/api/sessions/${session.id}`)).json()).messages;
  return { say, saved };
}

test('W6-23: the failed attempt\'s red note is cleared when the next model starts, so a retry that runs steps does not leave it behind', async (t) => {
  const c = await chat(t);
  await c.say('limited');
  assert.equal((await c.saved()).filter((m) => m.kind === 'error').length, 1, 'the first attempt left its note');
  await c.say('tooler', { retry: true, attemptsLeft: 0, fellBackFrom: 'limited', fellBackReason: 'rate-limit', fellBackTries: 1 });
  const messages = await c.saved();
  assert.equal(messages.filter((m) => m.kind === 'error').length, 0, JSON.stringify(messages.map((m) => m.kind ?? m.role)));
  assert.equal(messages.at(-1).content, 'all done');
  assert.ok(messages.some((m) => m.kind === 'tool_call'), 'the retry did run a step');
});

test('W6-23: if the retry fails too, the chat holds one note (the latest), never two', async (t) => {
  const c = await chat(t);
  await c.say('limited');
  await c.say('broken', { retry: true, attemptsLeft: 0 });
  const errors = (await c.saved()).filter((m) => m.kind === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].content, /broken could not finish/);
});

test('v0.1.10 (QA 4c-6): a new message that is not a retry clears the old failure note', async (t) => {
  const c = await chat(t);
  await c.say('limited');
  assert.equal((await c.saved()).filter((m) => m.kind === 'error').length, 1);
  await c.say('tooler'); // a plain new send, not a retry
  const messages = await c.saved();
  assert.equal(messages.filter((m) => m.kind === 'error').length, 0, JSON.stringify(messages.map((m) => m.kind ?? m.role)));
  assert.equal(messages.at(-1).content, 'all done');
});
