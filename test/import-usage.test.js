/**
 * Importing history, and seeing what each provider was used for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseImport, parseJson, parseMarkdown } from '../src/server/import.js';
import { startApp, json, post, put, connectProvider } from './helpers.js';

test('a Bunny AI export imports as it is', () => {
  const { messages, title } = parseImport(JSON.stringify({
    title: 'Old chat',
    messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
  }));
  assert.equal(title, 'Old chat');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
});

test('an Anthropic chat export imports as it is', () => {
  const { messages } = parseImport(JSON.stringify({
    name: 'Anthropic chat',
    chat_messages: [
      { sender: 'human', text: [{ type: 'text', text: 'question' }] },
      { sender: 'assistant', text: [{ type: 'text', text: 'answer' }] },
    ],
  }));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'question');
  assert.equal(messages[1].role, 'assistant');
});

test('a ChatGPT export imports in the order it was written', () => {
  const { messages } = parseImport(JSON.stringify({
    mapping: {
      a: { create_time: 2, message: { author: { role: 'assistant' }, content: { parts: ['second'] } } },
      b: { create_time: 1, message: { author: { role: 'user' }, content: { parts: ['first'] } } },
    },
  }));
  assert.deepEqual(messages.map((m) => m.content), ['first', 'second']);
  assert.equal(messages[0].role, 'user');
});

test('a Markdown transcript imports as it is', () => {
  const { messages, title } = parseImport('# My chat\n\n## You\n\nhello\n\n## Assistant\n\nhi there\n');
  assert.equal(title, 'My chat');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'hello');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'hi there');
});

test('a file with nothing in it says so instead of failing', () => {
  const result = parseImport('not a transcript at all');
  assert.equal(result.messages.length, 0);
  assert.ok(result.notes.length);
});

test('broken JSON is reported, not thrown', () => {
  const result = parseImport('{ this is not json');
  assert.equal(result.messages.length, 0);
  assert.match(result.notes[0], /not valid JSON/);
});

test('importing through the API creates a chat', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/import', {
    title: 'From elsewhere',
    content: JSON.stringify({ messages: [{ role: 'user', content: 'remember me' }] }),
  });
  assert.equal(status, 200);
  assert.equal(body.imported, 1);
  assert.equal(body.session.title, 'From elsewhere');

  const { body: session } = await json(base, `/api/sessions/${body.session.id}`);
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, 'remember me');
});

test('importing an empty file is refused', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/import', { content: '   ' });
  assert.equal(status, 400);
  assert.equal(body.code, 'import.empty');
});

test('usage is counted per provider after a reply', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: created } = await post(base, '/api/sessions', { title: 'Counted' });

  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'a question worth counting', providerId: 'anthropic', model }),
  }).then((r) => r.text());

  const { body: usage } = await json(base, '/api/usage');
  const row = usage.providers.find((p) => p.providerId === 'anthropic');
  assert.ok(row, 'the provider should appear in the usage table');
  assert.ok(row.tokens > 0, 'tokens should have been counted');
  assert.equal(row.messages, 2);
  assert.ok(usage.total >= row.tokens);
});

test('usage can be cleared', async (t) => {
  const { base } = await startApp(t);
  const { body: usage } = await json(base, '/api/usage');
  const before = usage.total;

  const res = await fetch(`${base}/api/usage`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const { body: after } = await json(base, '/api/usage');
  assert.equal(after.total, 0);
  assert.ok(before >= 0);
});

test('an alias is resolved to the model it stands for', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);

  await put(base, '/api/settings', { aliases: { fast: model } });

  const { body: created } = await post(base, '/api/sessions', { title: 'Aliased' });
  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'anthropic', model: 'fast' }),
  }).then((r) => r.text());

  const { body: session } = await json(base, `/api/sessions/${created.id}`);
  assert.equal(session.model, model, 'the chat should store the real model, not the alias');
});

test('an allowlist narrows what the picker offers', async (t) => {
  const { base } = await startApp(t);
  await connectProvider(base);

  const { body: before } = await json(base, '/api/models');
  assert.ok(before.length >= 2);

  const keep = before[0].id;
  await put(base, '/api/settings', { allowlist: [keep] });

  const { body: after } = await json(base, '/api/models');
  assert.equal(after.length, 1);
  assert.equal(after[0].id, keep);
});

test('an empty allowlist allows everything', async (t) => {
  const { base } = await startApp(t);
  await connectProvider(base);
  const { body: before } = await json(base, '/api/models');

  await put(base, '/api/settings', { allowlist: [] });
  const { body: after } = await json(base, '/api/models');
  assert.equal(after.length, before.length);
});

test('a Markdown transcript can be imported through the API', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/import', {
    content: '# Imported notes\n\n## You\n\nfirst\n\n## Assistant\n\nsecond\n',
  });
  assert.equal(status, 200);
  assert.equal(body.imported, 2);
  assert.equal(body.session.title, 'Imported notes');
});
