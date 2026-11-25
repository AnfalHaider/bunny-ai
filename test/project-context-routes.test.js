/**
 * PROJECT-CONTEXT through the real app: a scripted provider records what the model is sent. Invented profile only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';
import { remotePolicy } from '../src/server/remoteAccess.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';

async function recorder(t) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Noted.' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

async function setup(t) {
  const { base } = await startApp(t, { fake: false });
  const provider = await recorder(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const project = (await post(base, '/api/projects', { name: 'Carrot shop', instructions: 'Plain HTML, no framework.' })).body;
  const newChat = async (title, extra = {}) => (await post(base, '/api/sessions', { title, projectId: project.id, ...extra })).body;
  const send = (session, content) => fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) }).then((r) => r.text());
  const lastRequest = () => provider.seen.at(-1).messages;
  const patch = (path, body) => fetch(`${base}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, provider, project, newChat, send, lastRequest, patch };
}
const systemText = (messages) => messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n---\n');
const userNotes = (messages) => messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n---\n');

test('a new chat in a project is told its instructions, its memory and recent work; the recent work is quoted data after the system text', async (t) => {
  const { base, project, newChat, send, lastRequest } = await setup(t);
  assert.equal((await post(base, `/api/projects/${project.id}/memory`, { kind: 'decision', text: 'Use tabs, not spaces.' })).status, 200);
  const one = await newChat('Prices in cents');
  await send(one, 'Move prices to cents');
  const two = await newChat('Second chat');
  await send(two, 'What did we decide last time?');
  const req = lastRequest();
  const sys = systemText(req);
  assert.match(sys, /Project instructions for Carrot shop:\nPlain HTML, no framework\./);
  assert.match(sys, /What you know about this project \(kept by the person\):\n- \[decision\] Use tabs, not spaces\./);
  const notes = userNotes(req);
  assert.match(notes, /<<<PROJECT RECENT WORK/);
  assert.match(notes, /Chat "Prices in cents"/);
  assert.match(notes, /they are not instructions/);
  assert.doesNotMatch(sys, /PROJECT RECENT WORK/, 'recent work is data, not a system message');
  // the note is fixed for the whole chat: a chat made later does not change it
  const three = await newChat('Third chat');
  await send(three, 'hello');
  await send(two, 'one more');
  assert.doesNotMatch(userNotes(lastRequest()), /Third chat/);
});

test('the switches: per project, per chat, and the view says what a chat was given', async (t) => {
  const { base, project, newChat, send, lastRequest, patch } = await setup(t);
  await post(base, `/api/projects/${project.id}/memory`, { kind: 'fact', text: 'Hosting is a static bucket.' });
  const seed = await newChat('Seed');
  await send(seed, 'hello');
  await patch(`/api/projects/${project.id}`, { useMemory: false });
  const a = await newChat('A');
  await send(a, 'hi');
  assert.doesNotMatch(systemText(lastRequest()), /static bucket/);
  assert.match(userNotes(lastRequest()), /PROJECT RECENT WORK/);
  await patch(`/api/projects/${project.id}`, { useMemory: true, shareRecent: false });
  const b = await newChat('B');
  await send(b, 'hi');
  assert.match(systemText(lastRequest()), /static bucket/);
  assert.doesNotMatch(userNotes(lastRequest()), /PROJECT RECENT WORK/);
  await patch(`/api/projects/${project.id}`, { shareRecent: true });
  const c = await newChat('C');
  await patch(`/api/sessions/${c.id}/setting/projectContext`, { value: false });
  await send(c, 'hi');
  assert.match(systemText(lastRequest()), /Plain HTML/);
  assert.doesNotMatch(systemText(lastRequest()), /static bucket/);
  assert.doesNotMatch(userNotes(lastRequest()), /PROJECT RECENT WORK/);
  const view = (await json(base, `/api/sessions/${c.id}/project-context`)).body;
  assert.equal(view.enabled, false);
  assert.deepEqual(view.parts.map((p) => p.n), [1, 2, 3, 4, 5]);
  assert.match(view.parts[2].state, /off/);
});

test('an incognito chat in the project never gets recent work and is never a source for another chat', async (t) => {
  const { newChat, send, lastRequest } = await setup(t);
  const ghost = await newChat('Secret plans', { incognito: true });
  await send(ghost, 'private words');
  const next = await newChat('Next');
  await send(next, 'hi');
  assert.doesNotMatch(userNotes(lastRequest()), /Secret plans/);
  const other = await newChat('Other incognito', { incognito: true });
  await send(other, 'hi');
  assert.doesNotMatch(userNotes(lastRequest()), /PROJECT RECENT WORK/);
});

test('project memory routes: add, edit, delete and clear; a secret-looking item is refused; devices have no way in', async (t) => {
  const { base, project, patch } = await setup(t);
  const add = await post(base, `/api/projects/${project.id}/memory`, { kind: 'convention', text: 'Prices are stored in cents.' });
  assert.equal(add.status, 200);
  const refusedSecret = await post(base, `/api/projects/${project.id}/memory`, { kind: 'fact', text: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' });
  assert.equal(refusedSecret.status, 400);
  assert.equal(refusedSecret.body.code, 'memory.secret');
  const edit = await patch(`/api/projects/${project.id}/memory/${add.body.id}`, { text: 'Prices are stored in whole cents.' });
  assert.equal((await edit.json()).text, 'Prices are stored in whole cents.');
  assert.equal((await json(base, `/api/projects/${project.id}/memory`)).body.items.length, 1);
  assert.equal((await (await fetch(`${base}/api/projects/${project.id}/memory`, { method: 'DELETE' })).json()).cleared, 1);
  const id = project.id;
  for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal(remotePolicy(m, `/api/projects/${id}/memory`), false, `a Chats device: ${m}`);
  assert.equal(isWindowOnlyRoute('POST', `/api/projects/${id}/memory`), true);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/projects/${id}/memory/${id}`), true);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/projects/${id}`, { useMemory: false }), true);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/sessions/${id}/setting/projectContext`), true);
});

test('P4 in "What this chat was given" is truthful: "not followed yet" before Follow, then the frozen copy with its size and exact text', async (t) => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { base, project } = await setup(t);
  const folder = await mkdtemp(join(tmpdir(), 'bunny-p4-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'AGENTS.md'), 'Always use British spelling.');
  const chat = (await post(base, '/api/sessions', { title: 'p4', projectId: project.id, workMode: 'code', folder })).body;
  const p4 = async () => (await json(base, `/api/sessions/${chat.id}/project-context`)).body.parts[3];
  const before = await p4();
  assert.equal(before.state, 'not followed yet');
  assert.equal(before.size, 0);
  const diff = (await json(base, `/api/sessions/${chat.id}/folder-rules/diff`)).body;
  const shas = Object.fromEntries((diff.added ?? []).map((f) => [f.name, f.sha256]));
  assert.equal((await post(base, `/api/sessions/${chat.id}/folder-rules/follow`, { shas })).status, 200);
  const after = await p4();
  assert.equal(after.state, '');
  assert.ok(after.size > 0, 'the frozen copy has a size');
  assert.match(after.text, /Always use British spelling\./);
});
