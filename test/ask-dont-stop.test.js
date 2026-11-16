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
    'Phase 1 is done. Let me know if you want me to continue.',
    'The folders are ready. When you are ready, say the word and I will build the pages.',
    'I can do the CSS next if you would like.',
  ]) assert.equal(asksPermissionToContinue(t), true, t);
  for (const t of [
    'Done. The site builds and all 12 checks pass.',
    'The build failed with exit code 1; I fixed the import and it passes now.',
    'Which database do you want, Postgres or SQLite?',
    '',
  ]) assert.equal(asksPermissionToContinue(t), false, t);
});

/** One Code chat against a scripted provider: each entry is a tool call ({ name, args }) or a text reply. */
async function run(t, script) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-ask-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const step = script[seen.length - 1] ?? 'All done.';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = typeof step === 'string' ? { content: step }
        : { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
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
  return seen;
}
const ASK = 'Folders are ready. Please confirm that you would like me to build the pages?';

test('with open plan steps, a reply that stops to ask permission is told to carry on', async (t) => {
  const seen = await run(t, [
    { name: 'update_tasks', args: { tasks: [{ text: 'Folders', done: true }, { text: 'Pages' }] } },
    ASK,
    'All pages are built and checked.',
  ]);
  assert.equal(seen.length, 3, 'asked again instead of ending on the question');
  assert.match(seen[0].messages[0].content, /Never stop to ask permission for work the person already asked for/);
  assert.match(seen[0].messages[0].content, /Bunny runs commands, installs packages and starts servers itself/);
  assert.match(seen[2].messages.at(-1).content, /Your plan still has 1 open step\. Carry on/);
});

test('with no open plan steps, a closing offer is left alone', async (t) => {
  const done = await run(t, [{ name: 'update_tasks', args: { tasks: [{ text: 'Pages', done: true }] } }, ASK]);
  assert.equal(done.length, 2, 'the finished job ended on its question');
  const none = await run(t, [ASK]);
  assert.equal(none.length, 2, 'a reply with no plan at all is nudged once to make a list or say it is finished (W6-3b)');
});

test('with open plan steps, a closing statement that hands the turn back is nudged too; without them it is left alone', async (t) => {
  const HANDBACK = 'Phase 1 is done. Let me know if you want me to continue.';
  const open = await run(t, [{ name: 'update_tasks', args: { tasks: [{ text: 'Phase 1', done: true }, { text: 'Phase 2' }] } }, HANDBACK, 'Phase 2 is built and checked.']);
  assert.equal(open.length, 3, 'nudged and carried on');
  assert.match(open[2].messages.at(-1).content, /Do not stop to ask permission/);
  const closed = await run(t, [{ name: 'update_tasks', args: { tasks: [{ text: 'Phase 1', done: true }] } }, HANDBACK]);
  assert.equal(closed.length, 2, 'a finished plan is not nudged');
});

// W6-3b: a model that stops mid-job with no plan at all is asked to make one or say it is finished.
test('with no plan, a reply that hands the turn back is nudged once to make a task list or say it is finished', async (t) => {
  const seen = await run(t, ['Phase 1 is done. Let me know if you want me to continue.', 'Everything is finished and checked.']);
  assert.equal(seen.length, 2);
  assert.match(seen[1].messages.at(-1).content, /make a task list with update_tasks and carry on; if it is finished, say so plainly/);
});

test('the no-plan nudge counts toward the same limit of three', async (t) => {
  const seen = await run(t, Array.from({ length: 6 }, () => 'Shall I continue?'));
  assert.equal(seen.length, 4, 'three nudges, then the reply is allowed to end');
});

test('the Code prompt asks long jobs to keep a task list (W6-12)', async (t) => {
  const seen = await run(t, ['Done.']);
  assert.match(seen[0].messages[0].content, /about ten steps or more[\s\S]*task list with update_tasks/);
});
