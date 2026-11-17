import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const put = (base, body) => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

test('a profile photo is saved, served and removed; other files are refused', async (t) => {
  const { base } = await startApp(t);
  const saved = await post(base, '/api/profile/photo', { data: png });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profilePhoto.mime, 'image/png');
  const got = await fetch(`${base}/api/profile/photo`);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.ok((await got.arrayBuffer()).byteLength > 20);
  const bad = await post(base, '/api/profile/photo', { data: 'data:image/gif;base64,R0lGOD' });
  assert.equal(bad.status, 400);
  await fetch(`${base}/api/profile/photo`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/api/profile/photo`)).status, 404);
});

test('Bunny is told what to call the person', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  await put(base, { displayName: 'Sam Example', callName: 'Sammy' });
  const { body: session } = await post(base, '/api/sessions', { title: 'Name' });
  await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }) })).text();
  assert.match(JSON.stringify(seen[0].messages), /likes to be called Sammy/);
});

test('the greeting uses the name, fits the time of day, and sometimes is an any-time or grumpy line', async () => {
  const { pickGreeting, GREETINGS } = await import('../src/ui/greetings.js');
  const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
  const morning = pickGreeting({ name: 'Sam', hour: 8, random: seq(0.9, 0) });
  assert.equal(morning.title, GREETINGS.morning[0].replaceAll('{name}', 'Sam'));
  assert.equal(pickGreeting({ name: 'Sam', hour: 2, random: seq(0.9, 0) }).title, GREETINGS.night[0].replaceAll('{name}', 'Sam'));
  assert.equal(pickGreeting({ name: 'Sam', hour: 14, random: seq(0.01, 0) }).title, GREETINGS.grumpy[0].replaceAll('{name}', 'Sam'));
  assert.match(pickGreeting({ name: '', hour: 20, random: seq(0.9, 0) }).title, /friend/);
});
