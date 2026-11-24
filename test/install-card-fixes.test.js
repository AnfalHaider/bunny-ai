import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { createAppTools } from '../src/server/appTools.js';

// Security's review of F10: F10-4 (a device cannot answer the install card), F10-5 (nothing already installed is read or imported again), and the two LOWs (the commit the card read is the commit installed; a local connector's name is listed).
const PASS = 'correct horse battery staple';
const J = { 'content-type': 'application/json' };

function lan(url, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? J : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => { try { return JSON.parse(text); } catch { return null; } }, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

for (const level of ['chats', 'everything']) test(`F10-4: a ${level} device ${level === 'chats' ? 'cannot answer the install card (403) and the card keeps waiting for the window' : 'may answer the install card, and the answer is in the device log by choice and item name'}`, async (t) => {
  const started = await startApp(t, { lanAddress: '127.0.0.1', fake: false });
  const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: J, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  t.after(() => started.app.remote.disable());
  const url = on.url.replace(/\/$/, ''); const host = new URL(url).host;
  const signin = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  const cookie = String(signin.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  if (level === 'everything') assert.equal((await fetch(`${started.base}/api/remote/devices/${started.app.remote.list()[0].id}/level`, { method: 'PATCH', headers: J, body: JSON.stringify({ level: 'everything' }) })).status, 200);
  const device = (method, path, body) => lan(url, { method, path, headers: { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body });

  const upstream = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = done === 0 ? { tool_calls: [{ index: 0, id: 'c0', function: { name: 'add_connector', arguments: JSON.stringify({ name: 'Notion', url: 'https://mcp.example-notion.test/mcp' }) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(r); }));
  await post(started.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  const { body: session } = await post(started.base, '/api/sessions', { title: 'F10-4' });
  await fetch(`${started.base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: J, body: JSON.stringify({ value: 'ask' }) });
  const res = await fetch(`${started.base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ content: 'add it', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let deviceStatus = null; let deviceStatus2 = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!/^event: permission/m.test(block)) continue;
      const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
      deviceStatus = (await device('POST', `/api/sessions/${session.id}/permission/${card.id}`, { choice: 'off', allowed: true })).status;
      deviceStatus2 = level === 'chats' ? (await device('POST', `/api/sessions/${session.id}/permission/${card.id}`, { allowed: true })).status : 403;
      if (level === 'chats') await fetch(`${started.base}/api/sessions/${session.id}/permission/${card.id}`, { method: 'POST', headers: J, body: JSON.stringify({ choice: 'no', allowed: false }) }); // the window says no
    }
  }
  if (level === 'chats') { assert.equal(deviceStatus, 403); assert.equal(deviceStatus2, 403); assert.equal((await (await fetch(`${started.base}/api/mcp`)).json()).length, 0, 'nothing was installed by the device'); }
  else {
    assert.equal(deviceStatus, 200); assert.equal((await (await fetch(`${started.base}/api/mcp`)).json()).length, 1, 'the Everything device answered: installed (kept off)');
    const log = JSON.stringify(await (await fetch(`${started.base}/api/remote/log`)).json());
    assert.match(log, /"kind":"install"/); assert.match(log, /"choice":"off"/); assert.match(log, /"item":"Notion"/); assert.ok(!/mcp\.example-notion/.test(log), 'never the address');
  }
});

const REPO = { 'plugin.json': JSON.stringify({ name: 'notes', description: 'd' }), 'skills/a/SKILL.md': '---\nname: a\ndescription: A\n---\nDo a.' };
const SHA = 'a'.repeat(40);
function fakeGithub(files, seen = []) {
  return async (url) => {
    const u = String(url); seen.push(u);
    const raw = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/.exec(u);
    if (/\/commits\//.test(u)) return { ok: true, status: 200, json: async () => ({ sha: SHA }) };
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/trees/.test(u)) return { ok: true, status: 200, json: async () => ({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }) };
    if (raw && files[raw[2]] !== undefined) return { ok: true, status: 200, text: async () => files[raw[2]], json: async () => JSON.parse(files[raw[2]]) };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };
}
const memory = () => {
  const state = { plugins: [], skills: [] };
  return {
    state,
    deps: {
      skills: { add: async (s) => { const x = { id: `s${state.skills.length}`, ...s }; state.skills.push(x); return x; }, remove: async () => {}, list: async () => state.skills, find: async () => null },
      mcp: { add: async () => ({ id: 'c0' }), remove: async () => {}, list: async () => [] },
      getSettings: () => ({ plugins: state.plugins }), saveSettings: async (p) => { if (p.plugins) state.plugins = p.plugins; return {}; },
    },
  };
};

test('F10-5: a plugin that is already installed is not read or imported again (no fetch, nothing replaced)', async () => {
  const seen = []; const m = memory();
  const tools = createAppTools({ ...m.deps, fetchImpl: fakeGithub(REPO, seen) });
  await tools.run('install_plugin', { url: 'https://github.com/someone/notes' }, { chatId: 'c' });
  assert.equal(m.state.plugins.length, 1); const before = seen.length; const skillText = JSON.stringify(m.state.skills);
  const again = await tools.run('install_plugin', { url: 'https://github.com/someone/notes' }, { chatId: 'c' });
  assert.match(again, /already installed/); assert.equal(seen.length, before, 'no request was made'); assert.equal(JSON.stringify(m.state.skills), skillText);
});

test('LOW: the card reads one commit and the install reads exactly that commit', async () => {
  const seen = []; const m = memory();
  const tools = createAppTools({ ...m.deps, fetchImpl: fakeGithub(REPO, seen) });
  const card = await tools.previewPluginCard('https://github.com/someone/notes');
  assert.equal(card.commit, SHA); assert.match(card.text, /commit aaaaaaa/);
  assert.ok(seen.filter((u) => /raw\.githubusercontent/.test(u)).every((u) => u.includes(`/${SHA}/`)), 'the card read the pinned commit');
  seen.length = 0;
  await tools.run('install_plugin', { url: 'https://github.com/someone/notes' }, { chatId: 'c', expectCommit: card.commit });
  assert.ok(seen.filter((u) => /raw\.githubusercontent|git\/trees/.test(u)).every((u) => u.includes(SHA)), 'the install read the same commit');
});

test('F10-5: add_connector at an address that is already installed adds no second copy and says so', async () => {
  const added = [];
  const tools = createAppTools({ skills: {}, mcp: { list: async () => [{ id: 'x', url: 'https://mcp.example.test/mcp/' }], add: async (c) => { added.push(c); return { id: 'n', ...c }; } }, getSettings: () => ({}), saveSettings: async () => ({}) });
  const said = await tools.run('add_connector', { name: 'Again', url: 'https://MCP.example.test/mcp' }, { chatId: 'c' });
  assert.match(said, /already installed/); assert.equal(added.length, 0);
});

test("LOW: a local connector's own name on the card lets switchOn match it (no wrong 'not switched on')", async () => {
  const state = { mcp: [{ id: 'c1', name: 'files', enabled: false }] };
  const tools = createAppTools({ skills: { list: async () => [] }, mcp: { get: async (id) => state.mcp.find((s) => s.id === id), update: async (id, p) => Object.assign(state.mcp.find((s) => s.id === id), p) }, getSettings: () => ({}), saveSettings: async () => ({}) });
  const out = await tools.switchOn({ skillIds: [], connectorIds: ['c1'] }, { skills: [], connectors: ['files'] });
  assert.deepEqual(out.left, []); assert.equal(state.mcp[0].enabled, true);
});
