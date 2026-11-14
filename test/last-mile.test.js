/**
 * The last pieces: charts in artifacts, update checks, and the memories the
 * app suggests from a chat.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, json, post, put } from './helpers.js';
import { chartSpec } from '../src/ui/chart.js';
import { compareVersions, checkForUpdate } from '../src/server/updates.js';
import { suggestMemories } from '../src/server/suggestions.js';

// ---------------------------------------------------------------- charts

test('content that describes a chart is recognised', () => {
  const spec = chartSpec(JSON.stringify({
    type: 'bar', title: 'Spending', labels: ['Jan', 'Feb'], values: [10, 24],
  }));
  assert.ok(spec);
  assert.equal(spec.type, 'bar');
  assert.equal(spec.values.length, 2);
  assert.equal(spec.labels[1], 'Feb');
});

test('content that is not a chart is left alone', () => {
  assert.equal(chartSpec('just some text'), null);
  assert.equal(chartSpec('{ not json'), null);
  assert.equal(chartSpec(JSON.stringify({ type: 'bar' })), null);
  assert.equal(chartSpec(JSON.stringify({ type: 'spreadsheet', values: [1] })), null);
});

// ---------------------------------------------------------------- updates

test('versions are compared part by part', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.ok(compareVersions('0.1.9', '0.2.0') < 0);
  assert.ok(compareVersions('1.0', '0.9.9') > 0);
});

test('with no update source the app says so instead of pretending', async () => {
  const result = await checkForUpdate({ url: '' });
  assert.equal(result.updateAvailable, false);
  assert.match(result.message, /no update source/i);
});

test('an update feed that is unreachable is reported', async () => {
  const result = await checkForUpdate({ url: 'http://127.0.0.1:9/version.json' });
  assert.equal(result.updateAvailable, false);
  assert.ok(result.message);
});

test('a newer version in the feed is found', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '99.0.0', url: 'https://example.com/download' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/version.json`;

  const result = await checkForUpdate({ url });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latest, '99.0.0');
  await new Promise((r) => server.close(r));
});

test('the version route says what is running', async (t) => {
  const { base } = await startApp(t);
  const { body } = await json(base, '/api/version');
  assert.match(body.version, /^\d+\.\d+\.\d+/);
});

test('the update check works through the API', async (t) => {
  const { base } = await startApp(t);
  await put(base, '/api/settings', { updateUrl: 'http://127.0.0.1:9/version.json' });
  const { body } = await post(base, '/api/update/check');
  assert.equal(body.updateAvailable, false);
  assert.ok(body.message);
});

// ---------------------------------------------------------------- suggestions

test('a chat that says who you are suggests a memory', () => {
  const suggestions = suggestMemories([
    { role: 'user', content: 'By the way, my name is Ada Lovelace.' },
    { role: 'assistant', content: 'Nice to meet you, Ada.' },
  ]);
  assert.ok(suggestions.length >= 1);
  assert.ok(suggestions.some((s) => s.text.includes('Ada Lovelace')));
});

test('suggestions only come from what the person said', () => {
  const suggestions = suggestMemories([
    { role: 'assistant', content: 'My name is Ada Lovelace.' },
  ]);
  assert.equal(suggestions.length, 0);
});

test('the same thing is not suggested twice', () => {
  const suggestions = suggestMemories([
    { role: 'user', content: 'My name is Ada.' },
    { role: 'user', content: 'my name is Ada.' },
  ]);
  assert.equal(suggestions.length, 1);
});

test('suggestions can be asked for through the API', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'About me' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'remember that I work in Lisbon', providerId: 'anthropic', model: 'offline/bunny-code',
  }).catch(() => {});

  const { body } = await post(base, '/api/memory/suggestions', { sessionId: created.id });
  assert.ok(Array.isArray(body));
});
