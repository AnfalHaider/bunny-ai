import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { preferLastAnswered } from '../src/ui/model-abilities.js';

// W3-8 (the rest of T-3): a reply that failed part-way is continued by the next model, and Auto starts from the model that answered last.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

test('Auto starts from the model that answered last when it is still among those that can do the job; the others keep their order', () => {
  const a = { providerId: 'p', id: 'a' }; const b = { providerId: 'p', id: 'b' }; const c = { providerId: 'q', id: 'c' };
  assert.deepEqual(preferLastAnswered([a, b, c], { providerId: 'q', id: 'c' }), [c, a, b]);
  assert.deepEqual(preferLastAnswered([a, b, c], { providerId: 'p', id: 'a' }), [a, b, c], 'already first');
  assert.deepEqual(preferLastAnswered([a, b, c], { providerId: 'p', id: 'gone' }), [a, b, c], 'no longer able: ignored');
  assert.deepEqual(preferLastAnswered([a, b, c], { providerId: 'z', id: 'b' }), [a, b, c], 'the same name on another provider is another model');
  assert.deepEqual(preferLastAnswered([a, b], null), [a, b]);
  assert.deepEqual(preferLastAnswered([], { providerId: 'p', id: 'a' }), []);
});

test('a model that dies in the middle of its reply: the words so far are kept, and the model that takes over is told to carry on from them', async (t) => {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"dies"},{"id":"good"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.model === 'dies') {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'First the roots, then ' } }] })}\n\n`);
        setTimeout(() => res.destroy(), 60); // the connection drops mid-reply
        return;
      }
      res.end(sse({ content: 'the leaves.' }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'W38' });
  const say = async (model, extra = {}) => (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'explain carrots', providerId: 'openai', model, ...extra }) })).text();
  await say('dies');
  const afterFailure = (await (await fetch(`${base}/api/sessions/${session.id}`)).json()).messages;
  assert.deepEqual(afterFailure.map((m) => m.kind ?? m.role), ['text', 'partial', 'error'], 'the words so far, then why it stopped');
  assert.equal(afterFailure[1].content.trim(), 'First the roots, then');
  await say('good', { retry: true, attemptsLeft: 0, fellBackFrom: 'dies', fellBackReason: 'unreachable', fellBackTries: 1 });
  const sent = JSON.stringify(seen.at(-1).messages);
  assert.match(sent, /First the roots, then/, 'the next model sees what was already written');
  assert.match(sent, /cut off|stopped before it finished/, 'and is told it was cut off');
  const final = (await (await fetch(`${base}/api/sessions/${session.id}`)).json()).messages;
  assert.deepEqual(final.map((m) => m.kind ?? m.role), ['text', 'partial', 'text'], 'the red note is gone, the partial and the answer stay');
});
