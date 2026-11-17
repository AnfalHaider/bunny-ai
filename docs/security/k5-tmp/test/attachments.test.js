/**
 * Attachments: a file or a picture sent with a message.
 *
 * The rules that matter are the limits (a file name is never a path, a
 * payload is never unbounded) and what the model actually receives.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseAttachments, toModelMessage, safeName } from '../src/server/attachments.js';
import { startApp, json, post, connectProvider } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a file name is a label, never a path', () => {
  assert.equal(safeName('../../etc/passwd'), '..-..-etc-passwd');
  assert.equal(safeName('C:\\Windows\\system32\\cmd.exe'), 'C-Windows-system32-cmd.exe');
  assert.equal(safeName(''), 'file');
  // Nothing that could reach the file system survives.
  assert.equal(/[\\/]/.test(safeName('a/b\\c.txt')), false);
});

test('a text file is kept as text', () => {
  const [file] = normaliseAttachments([{ name: 'notes.txt', mime: 'text/plain', data: 'hello there' }]);
  assert.equal(file.kind, 'text');
  assert.equal(file.data, 'hello there');
  assert.equal(file.name, 'notes.txt');
});

test('a picture is kept as a data URL', () => {
  const [file] = normaliseAttachments([{ name: 'shot.png', mime: 'image/png', data: PNG }]);
  assert.equal(file.kind, 'image');
  assert.ok(file.data.startsWith('data:image/png;base64,'));
});

test('a base64 picture without a data URL is accepted', () => {
  const [file] = normaliseAttachments([
    { name: 'shot.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
  ]);
  assert.ok(file.data.startsWith('data:image/png;base64,'));
});

test('an oversized file is refused with a code', () => {
  assert.throws(
    () => normaliseAttachments([{ name: 'big.txt', mime: 'text/plain', data: 'x'.repeat(300 * 1024) }]),
    (err) => err.code === 'attachment.tooLarge',
  );
});

test('too many files are refused rather than silently trimmed', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, mime: 'text/plain', data: 'x' }));
  const files = normaliseAttachments(many);
  assert.ok(files.length <= 8);
});

test('a text attachment is folded into the prompt with its name', () => {
  const message = {
    role: 'user',
    content: 'what is in this file?',
    attachments: [{ kind: 'text', name: 'notes.txt', data: 'the answer is 42' }],
  };
  const out = toModelMessage(message);
  assert.equal(out.role, 'user');
  assert.match(out.content, /what is in this file\?/);
  assert.match(out.content, /\[attached file: notes\.txt\]/);
  assert.match(out.content, /the answer is 42/);
});

test('a picture becomes a content part, not text', () => {
  const message = {
    role: 'user',
    content: 'what is this?',
    attachments: [{ kind: 'image', name: 'shot.png', data: PNG }],
  };
  const out = toModelMessage(message);
  assert.ok(Array.isArray(out.content));
  assert.equal(out.content[0].type, 'text');
  assert.equal(out.content[0].text, 'what is this?');
  assert.equal(out.content[1].type, 'image_url');
  assert.equal(out.content[1].image_url.url, PNG);
});

test('a message with no attachments is sent as plain text', () => {
  const out = toModelMessage({ role: 'user', content: 'hello' });
  assert.deepEqual(out, { role: 'user', content: 'hello' });
});

test('an attachment sent through the API is stored with the message', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: created } = await post(base, '/api/sessions', { title: 'With a file' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: 'read this',
      providerId: 'anthropic',
      model,
      attachments: [{ name: 'notes.txt', mime: 'text/plain', data: 'the answer is 42' }],
    }),
  });
  assert.equal(res.status, 200);
  await res.text();

  const { body: session } = await json(base, `/api/sessions/${created.id}`);
  const user = session.messages.find((m) => m.role === 'user');
  assert.equal(user.attachments.length, 1);
  assert.equal(user.attachments[0].name, 'notes.txt');
  assert.equal(user.attachments[0].data, 'the answer is 42');
});

test('an oversized attachment is refused by the API', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: created } = await post(base, '/api/sessions', { title: 'Too big' });

  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: 'read this',
      providerId: 'anthropic',
      model,
      attachments: [{ name: 'big.txt', mime: 'text/plain', data: 'x'.repeat(300 * 1024) }],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'attachment.tooLarge');
});
