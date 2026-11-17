/**
 * W6-16: skills, connectors and plugins limited to folders. A skill or connector for folder A is in the prompt for a chat in A and
 * in A\sub, and not for B, for A2 (the prefix trap) or for a chat with no folder. Only a folder the person chose can be added.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inScope, cleanFolders } from '../src/server/scope.js';
import { createSkillStore } from '../src/server/skills.js';
import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };

test('W6-16: inScope compares paths, not text', () => {
  const A = join(tmpdir(), 'scope-A');
  assert.equal(inScope(undefined, null), true, 'no folders: everywhere');
  assert.equal(inScope([], A), true);
  assert.equal(inScope([A], A), true);
  assert.equal(inScope([A], join(A, 'sub', 'deep')), true, 'inside');
  assert.equal(inScope([A], `${A}2`), false, 'the prefix trap: scope-A2 is not inside scope-A');
  assert.equal(inScope([A], join(tmpdir(), 'scope-B')), false);
  assert.equal(inScope([A], null), false, 'a chat with no folder gets only what is for everywhere');
  assert.equal(inScope([join(tmpdir(), 'x'), A], join(A, 'sub')), true, 'any one of several');
  assert.equal(inScope([A], join(A, '..foo')), true, 'a folder whose name starts with two dots is still inside');
});

test('W6-16: cleanFolders keeps strings, drops repeats and stops at 20', () => {
  assert.deepEqual(cleanFolders('x'), []);
  assert.deepEqual(cleanFolders(['a', 'a', 5, '', ' b ']), ['a', 'b']);
  assert.equal(cleanFolders(Array.from({ length: 30 }, (_, i) => `f${i}`)).length, 20);
});

test('W6-16: an old skills.json with no folders loads and behaves as before', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w616-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'skills.json');
  await writeFile(file, JSON.stringify([{ id: '11111111-1111-1111-1111-111111111111', name: 'Old', description: '', instructions: 'be old', enabled: true }]));
  const store = createSkillStore({ file });
  assert.match(await store.context({ folder: null }), /be old/);
  assert.match(await store.context({ folder: join(dir, 'anywhere') }), /be old/);
});

/** An app with a scripted provider that records every request; folders A, A\sub, A2, B. */
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'bunny-w616-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dirs = { A: join(root, 'A'), sub: join(root, 'A', 'sub'), A2: join(root, 'A2'), B: join(root, 'B') };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const { app, base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const choose = (folder) => post(base, '/api/folder/check', { folder }); // in the plain-browser mode, typing a path chooses it
  const say = async (folder) => {
    const { body: s } = await post(base, '/api/sessions', { title: 'scope' });
    if (folder) await fetch(`${base}/api/sessions/${s.id}/setting/folder`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: folder }) });
    const before = seen.length;
    await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o', workMode: folder ? 'code' : 'chat' }) }).then((r) => r.text());
    return seen[before];
  };
  return { app, base, dirs, choose, say, seen };
}

const systemText = (body) => body.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
const toolNames = (body) => (body.tools ?? []).map((d) => d.function.name);

test('W6-16: a skill for folder A is in the prompt in A and A\\sub, not in B, A2 or a chat with no folder; an unscoped skill is everywhere', async (t) => {
  const x = await setup(t);
  await x.app.skills.add({ name: 'Everywhere', instructions: 'EVERYWHERE-SKILL', enabled: true });
  const only = await x.app.skills.add({ name: 'OnlyA', instructions: 'ONLY-A-SKILL', enabled: true });
  await x.app.skills.update(only.id, { folders: [x.dirs.A] });
  for (const [where, folder, expected] of [['A', x.dirs.A, true], ['A\\sub', x.dirs.sub, true], ['B', x.dirs.B, false], ['A2', x.dirs.A2, false], ['no folder', null, false]]) {
    const body = await x.say(folder);
    assert.equal(/ONLY-A-SKILL/.test(systemText(body)), expected, `OnlyA in ${where}`);
    assert.match(systemText(body), /EVERYWHERE-SKILL/, `the unscoped skill in ${where}`);
  }
});

test('W6-16: a connector for folder A offers its tools in A and A\\sub, not in B, A2 or a chat with no folder', async (t) => {
  const x = await setup(t);
  const every = await x.app.mcp.add({ name: 'Everywhere', url: 'http://127.0.0.1:9/every' });
  const only = await x.app.mcp.add({ name: 'OnlyA', url: 'http://127.0.0.1:9/only-a' });
  await x.app.mcp.setStatus(every.id, { status: 'ok', tools: [{ name: 'everyping', description: 'ping', readOnly: true }] });
  await x.app.mcp.setStatus(only.id, { status: 'ok', tools: [{ name: 'onlyaping', description: 'ping', readOnly: true }] });
  await x.app.mcp.update(only.id, { folders: [x.dirs.A] });
  for (const [where, folder, expected] of [['A', x.dirs.A, true], ['A\\sub', x.dirs.sub, true], ['B', x.dirs.B, false], ['A2', x.dirs.A2, false], ['no folder', null, false]]) {
    const body = await x.say(folder);
    assert.equal(toolNames(body).some((n) => /onlyaping/.test(n)), expected, `OnlyA tool in ${where}`);
    assert.ok(toolNames(body).some((n) => /everyping/.test(n)), `the unscoped connector in ${where}`);
  }
});

test('W6-16: the routes accept only a folder the person chose, and save nothing otherwise', async (t) => {
  const x = await setup(t);
  const skill = await x.app.skills.add({ name: 'S', instructions: 'S-TEXT', enabled: true });
  const conn = await x.app.mcp.add({ name: 'C', url: 'http://127.0.0.1:9/c' });
  const patch = (path, body) => fetch(`${x.base}${path}`, { method: 'PATCH', headers: j, body: JSON.stringify(body) });
  // a folder nobody picked
  let r = await patch(`/api/skills/${skill.id}`, { folders: [x.dirs.A] });
  assert.equal(r.status, 403);
  assert.equal((await x.app.skills.list())[0].folders, undefined, 'nothing was saved');
  r = await patch(`/api/mcp/${conn.id}`, { folders: [x.dirs.A] });
  assert.equal(r.status, 403);
  assert.equal(((await x.app.mcp.list())[0].folders ?? []).length, 0);
  // a path that is not a folder at all
  r = await patch(`/api/skills/${skill.id}`, { folders: [join(x.dirs.A, 'nope')] });
  assert.equal(r.status, 403);
  // after choosing it
  await x.choose(x.dirs.A);
  r = await patch(`/api/skills/${skill.id}`, { folders: [x.dirs.A] });
  assert.equal(r.status, 200);
  assert.deepEqual((await x.app.skills.list())[0].folders.length, 1);
  r = await patch(`/api/mcp/${conn.id}`, { folders: [x.dirs.A] });
  assert.equal(r.status, 200);
  // taking a folder out, or all of them, needs no check
  r = await patch(`/api/skills/${skill.id}`, { folders: [] });
  assert.equal(r.status, 200);
  assert.deepEqual((await x.app.skills.list())[0].folders, []);
  // not a list
  assert.equal((await patch(`/api/skills/${skill.id}`, { folders: 'D:\\' })).status, 403);
});

test('W6-16: a plugin carries its folders to its skills and connectors', async (t) => {
  const x = await setup(t);
  const skill = await x.app.skills.add({ name: 'PS', instructions: 'PLUGIN-SKILL', enabled: true });
  const conn = await x.app.mcp.add({ name: 'PC', url: 'http://127.0.0.1:9/pc' });
  const id = '22222222-2222-2222-2222-222222222222';
  await fetch(`${x.base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ plugins: [{ id, name: 'P', description: '', skills: [skill.id], connectors: [conn.id] }] }) });
  const patch = (body) => fetch(`${x.base}/api/plugins/${id}`, { method: 'PATCH', headers: j, body: JSON.stringify(body) });
  assert.equal((await patch({ folders: [x.dirs.A] })).status, 403, 'not chosen yet');
  await x.choose(x.dirs.A);
  const done = await patch({ folders: [x.dirs.A] });
  assert.equal(done.status, 200);
  assert.equal((await x.app.skills.list())[0].folders.length, 1);
  assert.equal((await x.app.mcp.list())[0].folders.length, 1);
  assert.equal((await x.app.getSettings().plugins)[0].folders.length, 1);
  assert.equal((await patch({ folders: [] })).status, 200);
  assert.deepEqual((await x.app.skills.list())[0].folders, []);
});
