import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';

/** A provider that plays one tool call per request, then answers "done". */
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

async function setup(t, steps, { folder = null, mode = 'auto' } = {}) {
  const { base } = await startApp(t, { fake: false });
  const provider = await scripted(t, steps);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Gaps' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', mode);
  if (folder) await set('folder', folder);
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: folder ? 'code' : 'chat' }),
  }).then((r) => r.text());
  return { base, provider, session, send };
}

const exists = (p) => stat(p).then(() => true, () => false);

test('the file changes of a reply can be undone, once', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-undo-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'notes.txt'), 'first line\n');
  const { base, session, send } = await setup(t, [
    { name: 'edit_file', args: { path: 'notes.txt', old_text: 'first line', new_text: 'changed line' } },
    { name: 'write_file', args: { path: 'src/new.js', content: 'export const x = 1;\n' } },
    { name: 'edit_file', args: { path: 'notes.txt', old_text: 'changed line', new_text: 'changed twice' } },
  ], { folder });
  await send('change things');
  assert.equal(await readFile(join(folder, 'notes.txt'), 'utf8'), 'changed twice\n');
  assert.ok(await exists(join(folder, 'src/new.js')));

  const { body } = await json(base, `/api/sessions/${session.id}`);
  const reply = body.messages.at(-1);
  assert.equal(reply.checkpoint.files, 2, 'two files, however many times each was changed');
  const undone = await post(base, `/api/sessions/${session.id}/checkpoints/${reply.checkpoint.id}/restore`, {});
  assert.equal(undone.status, 200);
  assert.equal(undone.body.restored, 2);
  assert.equal(await readFile(join(folder, 'notes.txt'), 'utf8'), 'first line\n', 'back to before the reply, not to the middle');
  assert.ok(!(await exists(join(folder, 'src/new.js'))), 'a file the reply made is removed');
  assert.equal((await json(base, `/api/sessions/${session.id}`)).body.messages.at(-1).checkpoint.restored, true);
  assert.equal((await post(base, `/api/sessions/${session.id}/checkpoints/${reply.checkpoint.id}/restore`, {})).status, 409);
});

test('a reply that changes no files offers no undo', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-undo-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { base, session, send } = await setup(t, [{ name: 'list_files', args: {} }], { folder });
  await send('look');
  assert.equal((await json(base, `/api/sessions/${session.id}`)).body.messages.at(-1).checkpoint, undefined);
});

test('the AI can remember a fact and schedule a task; both ask first in Manual', async (t) => {
  const { base, send, session } = await setup(t, [
    { name: 'remember', args: { text: 'The person likes short answers.' } },
    { name: 'schedule_task', args: { name: 'Morning issues', prompt: 'Summarise new issues.', every_minutes: 1440 } },
    { name: 'list_scheduled_tasks', args: {} },
  ], { mode: 'ask' });
  const answered = [];
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'remember and schedule', providerId: 'openai', model: 'gpt-4o' }),
  });
  const reader = res.body.getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    for (const m of buffer.matchAll(/event: permission\ndata: (.*)\n/g)) {
      const card = JSON.parse(m[1]);
      if (answered.includes(card.id)) continue;
      answered.push(card.id);
      await post(base, `/api/sessions/${session.id}/permission/${card.id}`, { allowed: true });
    }
  }
  assert.equal(answered.length, 2, 'remembering and scheduling each asked');
  const memories = (await json(base, '/api/memory')).body;
  assert.ok(memories.some((m) => m.text === 'The person likes short answers.' && m.source === 'assistant'));
  const tasks = (await json(base, '/api/schedules')).body;
  assert.equal(tasks[0].name, 'Morning issues');
  assert.equal(tasks[0].everyMinutes, 1440);
  assert.equal(tasks[0].model, 'gpt-4o');
  void send;
});

test('the plan is shown as a live checklist and kept with the reply, without a step line per update', async (t) => {
  const { base, session, send } = await setup(t, [
    { name: 'update_tasks', args: { tasks: [{ text: 'Read the files' }, { text: 'Write the summary' }] } },
    { name: 'update_tasks', args: { tasks: [{ text: 'Read the files', done: true }, { text: 'Write the summary' }] } },
  ]);
  const stream = await send('plan it');
  assert.equal((stream.match(/event: tasks/g) ?? []).length, 2);
  assert.doesNotMatch(stream, /"tool":"Plan/);
  const reply = (await json(base, `/api/sessions/${session.id}`)).body.messages.at(-1);
  assert.deepEqual(reply.tasks, [{ text: 'Read the files', done: true }, { text: 'Write the summary', done: false }]);
});

test('step text for the person is short; the model still gets the details', async (t) => {
  const { provider, send } = await setup(t, [{ name: 'create_artifact', args: { title: 'Page', kind: 'html', content: '<h1>Hi</h1>' } }]);
  const stream = await send('make a page');
  assert.match(stream, /"result":"Opened in the Artifacts panel\."/);
  assert.match(provider.seen.at(-1).messages.find((m) => m.role === 'tool').content, /\(id [a-f0-9-]{36}\)/);
});

test('programs the AI started are listed for the Terminal pane, with their output, and can be stopped', { skip: process.platform !== 'win32' && 'PowerShell only' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-proc-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { base, session, send } = await setup(t, [
    { name: 'start_process', args: { command: 'node -e "console.log(\'serving on http://localhost:4999\'); setInterval(() => {}, 1000)"', wait_seconds: 5 } },
  ], { folder });
  await send('start it');
  const list = (await json(base, `/api/processes?sessionId=${session.id}`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].running, true);
  const log = (await json(base, `/api/processes/${list[0].id}/log`)).body;
  assert.match(log.output, /serving on http:\/\/localhost:4999/);
  assert.equal((await post(base, `/api/processes/${list[0].id}/stop`, {})).status, 200);
  assert.equal((await json(base, `/api/processes?sessionId=${session.id}`)).body[0].running, false);
  assert.deepEqual((await json(base, '/api/processes?sessionId=00000000-0000-0000-0000-000000000000')).body, []);
});

test('incognito chats and scheduled tasks send the key in the provider header; scheduled runs get tools', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-team-key'], body: raw ? JSON.parse(raw) : null });
      if (req.headers['x-team-key'] !== 'team-key-123456') { res.writeHead(401).end('{}'); return; }
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"m1"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'header ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { app, base } = await startApp(t, { fake: false, probe: null, discover: null });
  const added = await post(base, '/api/providers/custom', { name: 'Team', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'team-key-123456', authHeader: 'x-team-key' });
  assert.equal(added.status, 200, JSON.stringify(added.body));

  const incognito = await fetch(`${base}/api/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'custom-team', model: 'm1', messages: [{ role: 'user', content: 'hi' }] }),
  }).then((r) => r.text());
  assert.match(incognito, /header ok/);

  await post(base, '/api/schedules', { name: 'Daily', prompt: 'Say hi', everyMinutes: 60, providerId: 'custom-team', model: 'm1' });
  const runs = await app.runDueSchedules();
  assert.equal(runs[0]?.text, 'header ok');
  const scheduled = seen.filter((s) => s.body?.messages).at(-1);
  assert.match(scheduled.body.messages[0].content, /Today is [\s\S]*This is the scheduled task "Daily", running on its own/);
  const names = (scheduled.body.tools ?? []).map((d) => d.function.name);
  assert.ok(names.includes('web_search'), 'a scheduled run has tools');
  assert.ok(!names.includes('request_capability'), 'but no card nobody could answer');
  assert.ok(!names.includes('remember'), 'and it only looks (Plan) unless set up to change things');
});

test('compacting uses a summary the model writes, and the plain one when the model cannot', async (t) => {
  const { createSessionStore } = await import('../src/server/sessions.js');
  const dir = await mkdtemp(join(tmpdir(), 'bunny-compact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSessionStore({ dir });
  const make = async () => {
    const s = await store.create({ title: 'Long' });
    for (let i = 0; i < 4; i += 1) {
      await store.append(s.id, { role: 'user', content: `question ${i} about carrots` });
      await store.append(s.id, { role: 'assistant', content: `answer ${i}` });
    }
    return s.id;
  };
  let seen = null;
  const written = await store.compact(await make(), { summarize: async (session) => { seen = session.messages.length; return 'The person grows carrots and wants a watering plan.'; } });
  assert.equal(seen, 8, 'the model saw the whole conversation');
  assert.match(written.session.messages.at(-1).content, /The person grows carrots and wants a watering plan\.[\s\S]*summarised by the model/);
  const plain = await store.compact(await make(), { summarize: async () => { throw new Error('offline'); } });
  assert.match(plain.session.messages.at(-1).content, /Started with: question 0 about carrots/);
  assert.equal(plain.session.messages.length, 9, 'the eight messages stay, with the summary after them');
});
