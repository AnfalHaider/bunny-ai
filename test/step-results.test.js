import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksSecret } from '../src/server/secretLike.js';
import { startApp, post, json } from './helpers.js';

/** One chat that reads a 10,800-character file with read_file; returns what it needs to look at the result. */
async function readBig(t, { mode = 'auto', prepare = async () => {}, file = 'big.txt', content = 'row of data\n'.repeat(900) } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-notes-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, file), content);
  await prepare(folder);
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = seen.length === 1
        ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: JSON.stringify({ path: file }) } }] }
        : { content: 'ok' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Notes' });
  const patch = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await patch('permissionMode', mode);
  await patch('folder', folder);
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }),
  }).then((r) => r.text());
  await send('read the big file');
  const step = (await json(base, `/api/sessions/${session.id}`)).body.messages.find((m) => m.kind === 'tool_call');
  return { folder, send, seen, step };
}

// W6-18: a big tool result is kept whole for the model: saved in .bunny/notes, path and text kept with the step.
test('a large tool result is saved in .bunny/notes and read back by the next turn', async (t) => {
  const { folder, send, seen, step } = await readBig(t);
  assert.match(step.resultFile ?? '', /^\.bunny\/notes\/step-[a-z0-9-]+\.txt$/);
  assert.ok((await readFile(join(folder, step.resultFile), 'utf8')).length > 6000, 'the whole result is on disk');
  assert.ok(step.result.length <= 1300, 'the chat still shows a short result');
  assert.ok(step.modelResult.length > 3000, 'the model-facing result is far longer than 300');
  await send('now summarise it');
  const sent = JSON.stringify(seen.at(-1).messages);
  assert.match(sent, /full output saved in \.bunny\/notes\/step-/, 'the next turn is told where the whole result is');
  assert.ok((sent.match(/row of data/g) ?? []).length > 100, 'and reads far more than 300 characters of it');
  assert.equal(await readFile(join(folder, '.bunny', '.gitignore'), 'utf8'), '*', 'notes stay out of the person\'s repository');
});

// Security review of W6-18: nothing is written in Plan mode or through a linked folder.
test('the saved note is skipped in Plan mode and through a linked .bunny folder', async (t) => {
  const plan = await readBig(t, { mode: 'plan' });
  assert.equal(plan.step.resultFile, undefined, 'Plan mode is read-only: nothing is written');
  assert.ok(plan.step.modelResult.length > 3000, 'the model still gets the long result');

  const outside = await mkdtemp(join(tmpdir(), 'bunny-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const linked = await readBig(t, { prepare: (folder) => symlink(outside, join(folder, '.bunny'), 'junction') });
  assert.equal(linked.step.resultFile, undefined, 'a linked .bunny is not written through');
  assert.deepEqual(await readdir(outside), [], 'nothing landed outside the workspace');
});

test('results that look like secrets are neither saved nor replayed in full; old notes are pruned', async (t) => {
  const env = await readBig(t, { file: '.env', content: `API_KEY=abcdef0123456789abcdef\n${'X=1\n'.repeat(3000)}` });
  assert.equal(env.step.resultFile, undefined, 'an .env read is not saved');
  assert.equal(env.step.modelResult, undefined, 'and not replayed in full to a model taking over');

  const pruned = await readBig(t, {
    prepare: async (folder) => {
      await mkdir(join(folder, '.bunny', 'notes'), { recursive: true });
      await writeFile(join(folder, '.bunny', 'notes', 'step-old-1.txt'), 'old');
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      await utimes(join(folder, '.bunny', 'notes', 'step-old-1.txt'), tenDaysAgo, tenDaysAgo);
    },
  });
  assert.ok(pruned.step.resultFile, 'a normal result is still saved');
  assert.ok(!(await readdir(join(pruned.folder, '.bunny', 'notes'))).includes('step-old-1.txt'), 'a note over a week old was removed');
});

test('looksSecret: keys, tokens, .env and the environment are caught; ordinary output is not', () => {
  for (const t of ['key sk-abcdefghijklmnopqrstuvwx', `ghp_${'a'.repeat(30)}`, 'password = hunter2hunter2', 'https://u:pw123@host/x', 'https://x.test/a?token=abcdef123456', '-----BEGIN RSA PRIVATE KEY-----']) assert.equal(looksSecret(t), true, t);
  assert.equal(looksSecret('', 'Read .env'), true);
  assert.equal(looksSecret('', 'Run printenv'), true);
  for (const t of ['row of data\n'.repeat(50), 'Built 12 files in 3 s', 'function token() {}']) assert.equal(looksSecret(t, 'Read src/a.js'), false, t);
});

test('looksSecret keeps its reach: aligned and multiline YAML, long keys, and too-big text fail closed', () => {
  assert.equal(looksSecret('database:\n  password:            hunter2hunter2\n'), true, 'aligned YAML');
  assert.equal(looksSecret(`${'x'.repeat(120)}_api_key = abcdefgh12345678`), true, 'a long variable name');
  assert.equal(looksSecret('SECRET_TOKEN   =   "abcdefgh1234"'), true, 'spaces around the sign');
  assert.equal(looksSecret(`${'a'.repeat(200_000)}`), true, 'too big to scan: treated as secret');
  const start = Date.now();
  looksSecret(`${'token '.repeat(20_000)}`);
  assert.ok(Date.now() - start < 1000, 'and a worst-case input is still quick');
});
