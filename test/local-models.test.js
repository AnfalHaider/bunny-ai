/**
 * A local model server: Ollama on this machine, no key, no account.
 *
 * The point of these tests is that the app talks to a real local server the
 * way it talks to any other provider, rather than assuming one shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, json, post } from './helpers.js';
import { localCandidates, normalizeModels } from '../src/providers/discovery.js';

/** A stand-in for Ollama: /api/tags lists models, /v1/chat/completions answers. */
async function startOllama({ models = ['llama3.2:latest', 'qwen2.5-coder:latest'] } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url, body });
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          models: models.map((name) => ({ name, model: name, size: 1234 })),
        }));
        return;
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'from my own machine' } }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      res.writeHead(404).end('not found');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

test('a local server is asked for its models where it keeps them', () => {
  assert.deepEqual(localCandidates('http://127.0.0.1:11434/v1'), [
    'http://127.0.0.1:11434/api/tags',
    'http://127.0.0.1:11434/v1/models',
    'http://127.0.0.1:11434/v1/models',
  ]);
});

test('the model list of a local server is understood', () => {
  const models = normalizeModels({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5-coder:latest' }] });
  assert.equal(models.length, 2);
  assert.equal(models[0].id, 'llama3.2:latest');
});

test('a local server connects with no key and offers its models', async (t) => {
  // Real probe and real discovery: this talks to the stand-in server itself.
  const { base } = await startApp(t, { probe: null, discover: null, fake: false });
  const ollama = await startOllama();
  t.after(() => new Promise((r) => ollama.server.close(r)));

  const connected = await post(base, '/api/providers/ollama/connect', { baseUrl: ollama.url });
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.equal(connected.body.status, 'connected');
  assert.equal(connected.body.maskedKey, '', 'a local server needs no key');

  const { body: models } = await json(base, '/api/providers/ollama/models');
  assert.equal(models.length, 2);
  assert.ok(models.some((m) => m.id === 'llama3.2:latest'));
  // The server was asked at the address it actually uses.
  assert.ok(ollama.seen.some((call) => call.url === '/api/tags'));
});

test('a local server answers a chat', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const ollama = await startOllama();
  t.after(() => new Promise((r) => ollama.server.close(r)));

  await post(base, '/api/providers/ollama/connect', { baseUrl: ollama.url });
  const { body: created } = await post(base, '/api/sessions', { title: 'Local' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'ollama', model: 'llama3.2:latest' }),
  });
  const text = await res.text();
  assert.match(text, /from my own machine/);
});

test('a local server that is not running is reported, not hidden', async (t) => {
  // The real probe: nothing is stubbed, so the server really is unreachable.
  const { base } = await startApp(t, { probe: null, fake: false });
  const connected = await post(base, '/api/providers/ollama/connect', { baseUrl: 'http://127.0.0.1:9/v1' });
  assert.equal(connected.status, 400);
  assert.ok(connected.body.message);
});
