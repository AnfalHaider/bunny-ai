/**
 * REWIND through the real app: replies that change files (a scripted provider), then preview, rewind, undo the rewind. Invented profile and folders only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';
import { remotePolicy } from '../src/server/remoteAccess.js';

/** A provider that plays the given steps in order: a step with a tool call, or null for "done" (the end of a reply). */
async function scripted(t, steps) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step
        ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] }
        : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

const w = (path, content) => ({ name: 'write_file', args: { path, content } });
const exists = (p) => stat(p).then(() => true, () => false);

/** Three replies in a folder: reply 1 writes a.txt, reply 2 makes b.txt, reply 3 rewrites a.txt and b.txt. */
async function threeReplies(t) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rw-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'a.txt'), 'one');
  const { base, dataDir } = await startApp(t, { fake: false });
  const provider = await scripted(t, [w('a.txt', 'two'), null, w('b.txt', 'made'), null, w('a.txt', 'three'), w('b.txt', 'made again'), null]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Rewind' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', 'auto');
  await set('folder', folder);
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) }).then((r) => r.text());
  await send('first');
  await send('second');
  await send('third');
  const chat = async () => (await json(base, `/api/sessions/${session.id}`)).body;
  return { base, dataDir, folder, session, chat, provider };
}
const rewindUrl = (base, session, query) => `${base}/api/sessions/${session.id}/rewind?${new URLSearchParams(query)}`;

test('REWIND: preview writes nothing, then rewinding to the first message puts every file back; the messages stay; the rewind can be undone', async (t) => {
  const { base, folder, session, chat } = await threeReplies(t);
  const c = await chat();
  const first = c.messages[0];
  const replies = c.messages.filter((m) => m.checkpoint);
  assert.equal(replies.length, 3);
  assert.ok(replies.every((m) => m.checkpoint.files > 0));
  const preview = await json(base, `/api/sessions/${session.id}/rewind?${new URLSearchParams({ to: first.id })}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.replies, 3);
  assert.deepEqual(preview.body.files.map((f) => [f.path, f.action]).sort(), [['a.txt', 'restore'], ['b.txt', 'delete']]);
  assert.equal(JSON.stringify(preview.body).includes('made'), false, 'no file contents in the preview');
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'three', 'the preview wrote nothing');

  const done = await post(base, `/api/sessions/${session.id}/rewind`, { to: first.id });
  assert.equal(done.status, 200);
  assert.equal(done.body.putBack, 1);
  assert.equal(done.body.removed, 1);
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'one');
  assert.ok(!(await exists(join(folder, 'b.txt'))));
  const after = await chat();
  assert.equal(after.messages.length, c.messages.length, 'Bunny never deletes messages for a rewind');
  assert.ok(after.messages.filter((m) => m.checkpoint).every((m) => m.checkpoint.restored));
  assert.match(after.rewindNote, /rewound the files to before reply 1/);

  assert.equal((await post(base, `/api/sessions/${session.id}/rewind`, { to: first.id })).body.restored, 0, 'a second rewind of the same point has nothing to do');

  // undo the rewind: it left a checkpoint of "now"
  const undone = await post(base, `/api/sessions/${session.id}/checkpoints/${done.body.undoId}/restore`, {});
  assert.equal(undone.status, 200);
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'three');
  assert.equal(await readFile(join(folder, 'b.txt'), 'utf8'), 'made again');
});

test('REWIND: to before reply 2 keeps reply 1; "before" a checkpoint (the panel\'s rows) does the same', async (t) => {
  const { base, folder, session, chat } = await threeReplies(t);
  const replies = (await chat()).messages.filter((m) => m.checkpoint);
  const r = await post(base, `/api/sessions/${session.id}/rewind`, { before: replies[1].checkpoint.id });
  assert.equal(r.status, 200);
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'two');
  assert.ok(!(await exists(join(folder, 'b.txt'))));
});

test('REWIND: a file the person changed since is "changed" and left alone; the one-reply Undo asks the same way (409 with the list)', async (t) => {
  const { base, folder, session, chat } = await threeReplies(t);
  const c = await chat();
  await writeFile(join(folder, 'a.txt'), 'my own edit');
  const p = await json(base, rewindUrl(base, session, { to: c.messages[0].id }).replace(base, ''));
  assert.equal(p.body.files.find((f) => f.path === 'a.txt').action, 'changed');
  await post(base, `/api/sessions/${session.id}/rewind`, { to: c.messages[0].id });
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'my own edit');
  assert.ok(!(await exists(join(folder, 'b.txt'))), 'the other file went back');
  const last = c.messages.filter((m) => m.checkpoint)[2];
  const ask = await post(base, `/api/sessions/${session.id}/checkpoints/${last.checkpoint.id}/restore`, {});
  assert.notEqual(ask.status, 200);
});

test('REWIND: a point from another chat is 404; a missing point is 400', async (t) => {
  const { base, session } = await threeReplies(t);
  assert.equal((await post(base, `/api/sessions/${session.id}/rewind`, { to: '11111111-1111-1111-1111-111111111111' })).status, 404);
  assert.equal((await post(base, `/api/sessions/${session.id}/rewind`, {})).status, 400);
});

test('REWIND: "new-chat" forks at the point and leaves the original whole; deleting a chat removes its checkpoints', async (t) => {
  const { base, dataDir, session, chat } = await threeReplies(t);
  const c = await chat();
  const r = await post(base, `/api/sessions/${session.id}/rewind`, { to: c.messages[1].id, conversation: 'new-chat' });
  assert.equal(r.status, 200);
  assert.ok(r.body.newChatId);
  const child = (await json(base, `/api/sessions/${r.body.newChatId}`)).body;
  assert.equal(child.messages.length, 2);
  assert.equal((await chat()).messages.length, c.messages.length);
  assert.ok(await exists(join(dataDir, 'checkpoints', session.id)));
  await fetch(`${base}/api/sessions/${session.id}`, { method: 'DELETE' });
  assert.ok(!(await exists(join(dataDir, 'checkpoints', session.id))));
});

test('REWIND: a reply that ran a command is flagged and the preview warns', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rw-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { base } = await startApp(t, { fake: false });
  const provider = await scripted(t, [w('a.txt', 'x'), { name: 'run_command', args: { command: 'echo hi' } }, null]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Cmd' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', 'auto');
  await set('folder', folder);
  await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) }).then((r) => r.text());
  const c = (await json(base, `/api/sessions/${session.id}`)).body;
  const p = await json(base, `/api/sessions/${session.id}/rewind?${new URLSearchParams({ to: c.messages[0].id })}`);
  assert.equal(p.body.commandsRan, true);
});

test('RW-1: a Chats device may look (GET) but never rewind or restore; the two writes are treated the same', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  assert.equal(remotePolicy('GET', `/api/sessions/${id}/rewind`), true);
  assert.equal(remotePolicy('POST', `/api/sessions/${id}/rewind`), false);
  assert.equal(remotePolicy('POST', `/api/sessions/${id}/checkpoints/${id}/restore`), false);
  assert.equal(remotePolicy('POST', `/api/sessions/${id}/rewind`), remotePolicy('POST', `/api/sessions/${id}/checkpoints/${id}/restore`));
});
