import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHistory } from '../src/server/history.js';
import { startApp, post } from './helpers.js';

const plain = (m) => ({ role: m.role, content: String(m.content ?? '') });
const user = (content) => ({ role: 'user', content });
const reply = (content, kind = 'text') => ({ role: 'assistant', content, kind });
const step = (tool, result) => ({ role: 'assistant', kind: 'tool_call', tool, status: 'done', result, content: '' });

test('the steps of a turn go back in front of its reply, a very long result shortened', () => {
  const { history, interrupted } = buildHistory([
    user('add a test'),
    step('Write test/a.test.js', 'Wrote test/a.test.js (12 lines)'),
    step('Run node --test', 'x'.repeat(20000)),
    reply('Added the test; it passes.'),
    user('thanks'),
  ], plain);
  assert.equal(history.length, 3);
  assert.match(history[1].content, /^\[Steps taken for this reply:\n- Write test\/a\.test\.js \(done\) → Wrote test\/a\.test\.js \(12 lines\)\n- Run node --test \(done\) → x{2000}\n… \(\d+ characters left out\) …\nx+\]\n\nAdded the test; it passes\.$/);
  assert.equal(interrupted, false, 'that turn finished');
});

test('a turn cut off in the middle of its steps is marked, and the next message continues it', () => {
  const { history, interrupted } = buildHistory([
    user('build the page'),
    step('Write index.html', 'Wrote index.html (40 lines)'),
    user('continue'),
  ], plain);
  assert.equal(history[1].role, 'assistant');
  assert.match(history[1].content, /cut off before it finished\. Steps already done:\n- Write index\.html/);
  assert.equal(history[2].content, 'continue');
  assert.equal(interrupted, true);
});

test('a stopped reply, or no reply at all, also counts as cut off', () => {
  const stopped = buildHistory([user('write a story'), reply('Once upon a', 'partial'), user('go on')], plain);
  assert.match(stopped.history[1].content, /Once upon a\n\n\[This reply was stopped before it finished\.\]/);
  assert.equal(stopped.interrupted, true);
  const dropped = buildHistory([user('hello?'), user('hello again')], plain);
  assert.equal(dropped.interrupted, true);
  const first = buildHistory([user('first message')], plain);
  assert.equal(first.interrupted, false);
});

test('after a summary, the model reads the summary instead of the messages above it', () => {
  const { history } = buildHistory([
    user('old question'), reply('old answer'),
    { role: 'assistant', kind: 'summary', content: 'They asked about carrots.' },
    user('new question'),
  ], plain);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'system');
  assert.match(history[0].content, /They asked about carrots\./);
  assert.ok(!JSON.stringify(history).includes('old question'));
});

test('on the next message the model is told what it already did, and to carry on after a cut-off', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-history-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'notes.txt'), 'hello');
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const tools = body.messages.filter((m) => m.role === 'tool').length;
      // First message: read a file, then answer. Later messages: just answer.
      const frame = seen.length === 1 && tools === 0
        ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"notes.txt"}' } }] }
        : { content: 'ok' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta: frame }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Remember' });
  const set = (k, v) => fetch(`${base}/api/sessions/${session.id}/setting/${k}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: v }) });
  await set('folder', folder);
  await set('permissionMode', 'auto');
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }),
  }).then((r) => r.text());

  await send('what is in notes.txt?');
  await send('and now?');
  const later = seen.at(-1).messages;
  const remembered = later.find((m) => m.role === 'assistant' && /Steps taken for this reply/.test(m.content));
  assert.ok(remembered, 'the earlier step is in what the model reads');
  assert.match(remembered.content, /Read notes\.txt \(done\) → hello/);
  assert.doesNotMatch(later.filter((m) => m.role === 'system').map((m) => m.content).join('\n'), /cut off/, 'a finished turn is not called cut off');
  assert.match(later.filter((m) => m.role === 'system').map((m) => m.content).join('\n'), /\.bunny\/progress\.md/, 'Code mode keeps a progress file for long jobs');
});

test('when another model takes over mid-work, the steps go in as a note, never as a last assistant turn', () => {
  const step = (tool) => ({ role: 'assistant', kind: 'tool_call', tool, status: 'done', result: 'ok' });
  const { history } = buildHistory([user('build it'), step('Run npm install'), step('Write a.js')], plain);
  assert.equal(history.at(-1).role, 'user');
  assert.match(history.at(-1).content, /already started[\s\S]*Run npm install[\s\S]*Write a\.js[\s\S]*Do not redo them/);
  assert.equal(history.filter((m) => m.role === 'assistant').length, 0);
});

test('W6-18: the model that takes over still reads what was read: full results, the saved-file path, the plan', () => {
  const read = 'line of the file\n'.repeat(120); // about 2,000 characters, far more than the old 300
  const { history, interrupted, pictures } = buildHistory([
    user('port the page'),
    { ...step('Read index.html', 'short'), modelResult: read },
    { ...step('Run the build', 'short'), modelResult: 'tail of build', resultFile: '.bunny/notes/step-a-1.txt', tasks: [{ text: 'Read', done: true }, { text: 'Port', done: false }],
      attachments: [{ kind: 'image', name: 'Screenshot.png', data: '/api/screens/00000000-0000-0000-0000-000000000000.png' }] },
    user('continue'),
  ], plain);
  assert.equal(interrupted, true);
  const text = history.map((h) => h.content).join('\n');
  assert.ok(text.includes('line of the file line of the file'.slice(0, 16)), 'the read result is in what the model reads');
  assert.ok(text.split('line of the file').length - 1 >= 100, 'all of its lines, not the first 300 characters');
  assert.match(text, /full output saved in \.bunny\/notes\/step-a-1\.txt/);
  assert.match(text, /\[x\] Read\n\[ \] Port/);
  assert.equal(pictures.length, 1);
});

test('W6-18: a very long turn keeps its newest steps whole and shortens the older ones within the budget', () => {
  const steps = Array.from({ length: 40 }, (_, i) => ({ ...step(`Step ${i}`, 'r'), modelResult: `${i}:` + 'y'.repeat(3000) }));
  const { history } = buildHistory([user('big job'), ...steps, user('continue')], plain);
  const note = history.find((h) => /cut off/.test(h.content)).content;
  assert.ok(note.length < 65_000, `kept within the budget (was ${note.length})`);
  assert.match(note, /Step 39 \(done\) → 39:y{3000}/, 'the newest step is whole');
});
