import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

// QA-ANSWERS (server side): a Quick ask question is answered as text only, and its chat is tagged.
const jsonH = { 'content-type': 'application/json' };
const sse = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;

async function setup(t, reply = 'Hello there.') {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"m1"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(reply));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  return { base, seen };
}
const ask = async (base, id, extra) => (await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'what is 429?', providerId: 'openai', model: 'm1', workMode: 'chat', ...extra }) })).text();

test('a text-only question offers the model NO tools and says why; a normal one still does', async (t) => {
  const { base, seen } = await setup(t);
  const { body: a } = await post(base, '/api/sessions', { title: 'q', workMode: 'chat', origin: 'quick-ask' });
  await ask(base, a.id, { textOnly: true });
  assert.equal('tools' in seen.at(-1), false, 'no tools field at all');
  assert.match(JSON.stringify(seen.at(-1).messages), /\[\[NEEDS_BUNNY_WINDOW\]\]/);
  const { body: b } = await post(base, '/api/sessions', { title: 'q2', workMode: 'chat' });
  await ask(base, b.id, {});
  assert.ok(Array.isArray(seen.at(-1).tools) && seen.at(-1).tools.length > 0, 'an ordinary chat message still has its tools');
  assert.doesNotMatch(JSON.stringify(seen.at(-1).messages), /NEEDS_BUNNY_WINDOW/);
});

test('a chat that began in the bar carries the origin and the list shows it; nothing else can set it', async (t) => {
  const { base } = await setup(t);
  const { body: a } = await post(base, '/api/sessions', { title: 'q', origin: 'quick-ask' });
  const { body: b } = await post(base, '/api/sessions', { title: 'q', origin: 'something-else' });
  const list = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(list.find((s) => s.id === a.id).origin, 'quick-ask');
  assert.equal(list.find((s) => s.id === b.id).origin, null);
});
