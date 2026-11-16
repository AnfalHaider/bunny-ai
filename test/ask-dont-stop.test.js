import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asksPermissionToContinue } from '../src/server/chat.js';
import { startApp, post } from './helpers.js';

// W6-3: ask, don't stop.
test('a closing "please confirm" is recognised; a finished report and a real question are not', () => {
  for (const t of [
    'I have set up the folders. Please confirm that you would like me to proceed with the next phase?',
    'Phase 1 is done.\n\nShould I proceed with building the pages?',
    'Do you want me to continue with the CSS?',
    'Shall I start on the scripts now?',
  ]) assert.equal(asksPermissionToContinue(t), true, t);
  for (const t of [
    'Done. The site builds and all 12 checks pass.',
    'The build failed with exit code 1; I fixed the import and it passes now.',
    'Which database do you want, Postgres or SQLite?',
    '',
  ]) assert.equal(asksPermissionToContinue(t), false, t);
});

test('in Code mode a reply that stops to ask permission is told to carry on, once the model answers it finishes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-ask-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const content = seen.length === 1 ? 'Folders are ready. Please confirm that you would like me to build the pages?' : 'All pages are built and checked.';
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Ask' });
  const patch = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await patch('permissionMode', 'auto');
  await patch('folder', folder);
  await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'build the site', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }),
  }).then((r) => r.text());
  assert.equal(seen.length, 2, 'the model was asked again instead of the reply ending on the question');
  assert.match(seen[0].messages[0].content, /Never stop to ask permission for work the person already asked for/);
  assert.match(seen[0].messages[0].content, /Bunny runs commands, installs packages and starts servers itself/);
  assert.match(seen[1].messages.at(-1).content, /Do not stop to ask permission/);
});
