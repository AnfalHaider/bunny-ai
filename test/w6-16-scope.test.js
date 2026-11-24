/**
 * W6-16: skills, connectors and plugins limited to folders. A skill or connector for folder A is in the prompt for a chat in A and
 * in A\sub, and not for B, for A2 (the prefix trap) or for a chat with no folder. Only a folder the person chose can be added.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inScope, cleanFolders } from '../src/server/scope.js';
import { createSkillStore } from '../src/server/skills.js';
import { createMcpStore } from '../src/server/mcpStore.js';
import { createAppTools } from '../src/server/appTools.js';
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
  const queue = []; // tool calls the model makes on its next requests, first in first out
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = queue.shift();
      const delta = call ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } }] } : { content: 'ok' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
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
  return { app, base, dirs, choose, say, seen, queue };
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
  const every = await x.app.mcp.add({ name: 'Everywhere', url: 'http://127.0.0.1:9/every', addedBy: 'person' });
  const only = await x.app.mcp.add({ name: 'OnlyA', url: 'http://127.0.0.1:9/only-a', addedBy: 'person' });
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
  const conn = await x.app.mcp.add({ name: 'C', url: 'http://127.0.0.1:9/c', addedBy: 'person' });
  const patch = (path, body) => fetch(`${x.base}${path}`, { method: 'PATCH', headers: j, body: JSON.stringify(body) });
  // a folder nobody picked
  let r = await patch(`/api/skills/${skill.id}`, { folders: [x.dirs.A] });
  assert.equal(r.status, 403);
  assert.deepEqual((await x.app.skills.list())[0].folders ?? [], [], 'nothing was saved');
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
  const conn = await x.app.mcp.add({ name: 'PC', url: 'http://127.0.0.1:9/pc', addedBy: 'person' });
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

const toolMessage = (body) => String(body.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '');

test('W6-16 (review): read_skill by name refuses a skill that is not for this chat\'s folder, in the same plain words as for a skill that does not exist', async (t) => {
  const x = await setup(t);
  const only = await x.app.skills.add({ name: 'OnlyA', instructions: 'ONLY-A-SKILL-TEXT', enabled: true });
  await x.app.skills.update(only.id, { folders: [x.dirs.A] });
  for (const [where, folder, ok] of [['A', x.dirs.A, true], ['A\\sub', x.dirs.sub, true], ['B', x.dirs.B, false], ['A2', x.dirs.A2, false], ['no folder', null, false]]) {
    x.queue.push({ name: 'read_skill', args: { name: 'OnlyA' } });
    await x.say(folder);
    const answer = toolMessage(x.seen.at(-1));
    if (ok) assert.match(answer, /ONLY-A-SKILL-TEXT/, `readable in ${where}`);
    else assert.match(answer, /There is no skill called OnlyA/, `refused in ${where}: ${answer}`);
  }
});

test('W6-16 (review): a connector tool of another folder cannot be called by its name, directly or through call_connector_tool', async (t) => {
  const x = await setup(t);
  const only = await x.app.mcp.add({ name: 'OnlyA', url: 'http://127.0.0.1:9/only-a', addedBy: 'person' });
  await x.app.mcp.setStatus(only.id, { status: 'ok', tools: [{ name: 'onlyaping', description: 'ping', readOnly: true }] });
  await x.app.mcp.update(only.id, { folders: [x.dirs.A] });
  const inA = await x.say(x.dirs.A);
  const name = toolNames(inA).find((n) => /onlyaping/.test(n));
  assert.ok(name, 'offered in A');
  for (const folder of [x.dirs.B, x.dirs.A2, null]) {
    x.queue.push({ name, args: {} });
    await x.say(folder);
    assert.match(toolMessage(x.seen.at(-1)), /is not available in this reply, so it was not run/, `direct call in ${folder}`);
    x.queue.push({ name: 'call_connector_tool', args: { name, arguments: {} } });
    await x.say(folder);
    assert.doesNotMatch(toolMessage(x.seen.at(-1)), /pong|ping result/, 'never reaches the connector');
    assert.match(toolMessage(x.seen.at(-1)), /not available|no connector tool/i, `through call_connector_tool in ${folder}`);
  }
});

test('W6-16 (review): a helper gets the scoped skills text, never the whole list', async (t) => {
  const x = await setup(t);
  const only = await x.app.skills.add({ name: 'OnlyA', instructions: 'ONLY-A-SKILL-TEXT', enabled: true });
  await x.app.skills.update(only.id, { folders: [x.dirs.A] });
  x.queue.push({ name: 'run_subagent', args: { task: 'look around', label: 'scout' } });
  await x.say(x.dirs.B);
  const helperRequests = x.seen.filter((b) => b.messages.some((m) => m.role === 'system' && /helper agent/.test(String(m.content))));
  assert.ok(helperRequests.length > 0, 'a helper was really started');
  for (const b of helperRequests) assert.doesNotMatch(JSON.stringify(b.messages), /ONLY-A-SKILL-TEXT/, 'not in a helper started from folder B');
});

const skillMd = (name, body) => `---\nname: ${name}\ndescription: about ${name}\n---\n${body}`;
const githubFiles = (files) => async (url) => {
  if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files.current).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
  const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
  if (m && files.current[m[1]] !== undefined) return new Response(files.current[m[1]], { status: 200 });
  return new Response('not found', { status: 404 });
};

test('W616-1: updating a folder-limited plugin keeps its parts limited, and a new skill or connector is limited too', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w616p-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const A = join(dir, 'A'); const B = join(dir, 'B');
  await mkdir(A); await mkdir(B);
  const skills = createSkillStore({ file: join(dir, 'skills.json') });
  const mcp = createMcpStore({ file: join(dir, 'mcp.json') });
  let settings = {};
  const files = { current: {
    'plugin.json': JSON.stringify({ name: 'carrots', description: 'v1' }),
    'skills/grow/SKILL.md': skillMd('grow', 'GROW-V1'),
    '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
  } };
  const tools = createAppTools({ skills, mcp, getSettings: () => settings, saveSettings: async (patch) => { settings = { ...settings, ...patch }; }, fetchImpl: githubFiles(files) });
  const { record } = await tools.installFromGithub('https://github.com/bunny/carrots');
  for (const sk of await skills.list()) await skills.update(sk.id, { enabled: true });
  assert.equal((await tools.setFolders(record.id, [A])).ok, true);
  files.current = {
    'plugin.json': JSON.stringify({ name: 'carrots', description: 'v2' }),
    'skills/grow/SKILL.md': skillMd('grow', 'GROW-V2'),
    'skills/store/SKILL.md': skillMd('store', 'STORE-NEW'),
    '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' }, market: { url: 'https://market.example.com/mcp' } } }),
  };
  const done = await tools.updatePlugin(record.id);
  assert.equal(done.ok, true);
  assert.equal(done.skillsAdded, 1);
  assert.equal(done.connectorsAdded, 1);
  for (const sk of await skills.list()) await skills.update(sk.id, { enabled: true }); // so the scope is the only thing keeping a skill out
  for (const sk of await skills.list()) assert.deepEqual(sk.folders, [A], `${sk.name} is still limited to A`);
  for (const c of await mcp.list()) assert.deepEqual(c.folders, [A], `${c.name} is still limited to A`);
  const inB = await skills.context({ folder: B });
  const none = await skills.context({ folder: null });
  const inA = await skills.context({ folder: A });
  assert.equal(inB, null, 'no skill of the plugin in B');
  assert.equal(none, null, 'none in a chat with no folder');
  assert.match(inA, /STORE-NEW/);
  assert.match(inA, /GROW-V2/);
  const offered = (folder) => mcp.list().then((all) => all.filter((c) => inScope(c.folders, folder)).map((c) => c.name));
  assert.deepEqual(await offered(B), []);
  assert.deepEqual(await offered(null), []);
  assert.deepEqual((await offered(A)).sort(), ['market', 'weather']);
});
