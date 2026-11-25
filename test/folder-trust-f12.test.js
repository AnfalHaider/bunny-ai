import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFolderTrust, isGitWorkTree, smartMode } from '../src/server/folderTrust.js';
import { startApp, post } from './helpers.js';
import http from 'node:http';
import { WINDOW_ONLY_SETTING_KEYS } from '../src/server/windowOnly.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';

// AGENT-FLOW F12: Smart is Auto only in a trusted git folder with the check on, on the window; everything else is Ask. Trust is by real path and kept apart from any other answer.
const jsonH = { 'content-type': 'application/json' };
const ok = { device: false, folderOk: true, git: true, judgeOn: true, trust: { auto: true } };

test('smartMode: Auto only when every condition holds; each missing one is Ask, with its own words', () => {
  assert.equal(smartMode(ok).mode, 'auto');
  assert.equal(smartMode({ ...ok, device: true }).mode, 'ask');
  assert.equal(smartMode({ ...ok, folderOk: false }).mode, 'ask');
  assert.equal(smartMode({ ...ok, judgeOn: false }).mode, 'ask');
  assert.equal(smartMode({ ...ok, git: false }).mode, 'ask');
  assert.equal(smartMode({ ...ok, trust: { auto: null } }).mode, 'ask');
  assert.equal(smartMode({ ...ok, trust: { auto: false } }).mode, 'ask');
  assert.equal(smartMode({ ...ok, trust: null }).mode, 'ask');
  assert.equal(smartMode({}).mode, 'ask', 'nothing known is Ask');
  assert.match(smartMode({ ...ok, git: false }).why, /git folder/);
});

test('the store: by real path, the two answers kept apart, forgotten on request, never-asked is null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-trust-'));
  const folder = join(dir, 'proj'); await mkdir(folder);
  const file = join(dir, 'folder-trust.json');
  const trust = createFolderTrust({ file });
  assert.deepEqual(await trust.get(folder), { folder: (await trust.get(folder)).folder, auto: null });
  await trust.set(folder, { auto: true });
  assert.equal((await trust.get(folder)).auto, true);
  assert.equal('instructions' in (await trust.get(folder)), false, 'no instructions answer lives here: that is the folder rules record');
  assert.equal((await trust.get(folder)).auto, true, 'the other answer is untouched');
  assert.equal((await trust.get(folder.toUpperCase())).auto, true, 'a different spelling of the same folder (Windows is case-blind)');
  await trust.flush();
  const again = createFolderTrust({ file });
  assert.equal((await again.get(folder)).auto, true, 'kept on disk');
  assert.equal((await again.list()).length, 1);
  await again.forget(folder);
  assert.equal((await again.get(folder)).auto, null);
  assert.equal(await trust.set(join(dir, 'nope'), { auto: true }), null, 'a folder that does not exist is never recorded');
});

test('isGitWorkTree: a repo is yes, a plain folder and a missing folder are no', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-git-'));
  const plain = join(dir, 'plain'); await mkdir(plain);
  const repo = join(dir, 'repo'); await mkdir(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  assert.equal(await isGitWorkTree(repo), true);
  assert.equal(await isGitWorkTree(plain), false);
  assert.equal(await isGitWorkTree(join(dir, 'missing')), false);
});

test('the routes are the window\'s alone and the list is a window-only route', () => {
  assert.equal(isWindowOnlyRoute('PUT', '/api/folder-trust'), true);
  assert.equal(isWindowOnlyRoute('DELETE', '/api/folder-trust'), true);
  assert.ok(WINDOW_ONLY_SETTING_KEYS.includes('defaultPermissionMode'));
});

// ---- in the real app: a stand-in provider asks to run one command; a stand-in judge answers (or is down) ----
test('Smart in the real app: untrusted or non-git folders ask; a trusted git folder is Auto; the check off is Ask; PUT trust refuses a non-git folder', async (t) => {
  const { createServer } = await import('node:http');
  const seen = [];
  const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (String(body.messages?.[0]?.content ?? '').startsWith('You check one action')) { res.end(sse({ content: '{"verdict":"allow","reason":"Fine."}' })); return; }
      const told = body.messages.filter((m) => m.role === 'tool');
      res.end(sse(told.length ? { content: 'done' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo hi' }) } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const root = await mkdtemp(join(tmpdir(), 'bunny-smart-'));
  const repo = join(root, 'repo'); const plain = join(root, 'plain');
  await mkdir(repo); await mkdir(plain);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  await writeFile(join(repo, 'a.txt'), 'a');

  const put = (body) => fetch(`${base}/api/folder-trust`, { method: 'PUT', headers: jsonH, body: JSON.stringify(body) });
  assert.equal((await put({ folder: plain, auto: true })).status, 400, 'a folder that is not git cannot be trusted for Auto');
  assert.equal((await put({ folder: repo, auto: 'yes' })).status, 400);
  const asked = await (await fetch(`${base}/api/folder-trust?folder=${encodeURIComponent(repo)}`)).json();
  assert.deepEqual([asked.git, asked.auto, asked.judgeOn], [true, null, true], 'unseen: the judge is on by default, nothing is trusted');

  // does a command in this folder need a card? (a card is an `event: permission` in the stream)
  async function cardFor(folder) {
    const { body: session } = await post(base, '/api/sessions', { title: 'smart' });
    for (const [k, v] of [['folder', folder], ['workMode', 'code'], ['permissionMode', 'smart']]) await fetch(`${base}/api/sessions/${session.id}/setting/${k}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: v }) });
    const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'run echo hi', providerId: 'openai', model: 'gpt-4o' }) });
    const reader = res.body.getReader();
    let text = ''; let card = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      const m = !card && /event: permission\ndata: (.*)\n/.exec(text);
      if (m) { card = JSON.parse(m[1]); await post(base, `/api/sessions/${session.id}/permission/${card.id}`, { allowed: false }); }
    }
    return { card, text };
  }
  assert.ok((await cardFor(repo)).card, 'a git folder nobody trusted asks');
  assert.ok((await cardFor(plain)).card, 'a folder that is not git asks');

  assert.equal((await put({ folder: repo, auto: true })).status, 200);
  const before = seen.length;
  const trusted = await cardFor(repo);
  assert.equal(trusted.card, null, 'a trusted git folder runs in Auto: no card');
  assert.ok(seen.slice(before).some((b) => String(b.messages?.[0]?.content ?? '').startsWith('You check one action')), 'and the check looked at it');

  assert.equal((await fetch(`${base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ autoJudgeEnabled: false }) })).status, 200);
  assert.ok((await cardFor(repo)).card, 'with the check off Smart asks, even in a trusted folder');
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ autoJudgeEnabled: true }) });

  const gone = await fetch(`${base}/api/folder-trust`, { method: 'DELETE', headers: jsonH, body: JSON.stringify({ folder: repo }) });
  assert.equal(gone.status, 200);
  assert.ok((await cardFor(repo)).card, 'removed: asks again');
});

test('the judge is on by default: nothing saved means on; only an explicit off turns it off (static check of the three places)', async () => {
  const app = await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8');
  const svc = await readFile(new URL('../src/server/engines/service.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
  assert.match(app, /permissionMode === 'auto' && settings\.autoJudgeEnabled !== false && !textOnly/);
  assert.match(svc, /settings\.autoJudgeEnabled !== false \? rulesWithoutBroadAllow/);
  assert.doesNotMatch(html, /data-cap="autoJudgeEnabled" data-cap-default="off"/);
});

test('F12 gap: a new chat starts in the default mode from Settings; a device\'s chat is Ask', async (t) => {
  const { base } = await startApp(t, { fake: true });
  const mode = async () => (await post(base, '/api/sessions', { title: 'm' })).body.permissionMode;
  assert.equal(await mode(), 'ask', 'nothing set: as before');
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ defaultPermissionMode: 'smart' }) });
  assert.equal(await mode(), 'smart');
  assert.equal((await post(base, '/api/sessions', { title: 'm', permissionMode: 'plan' })).body.permissionMode, 'plan', 'an explicit mode wins');
});

const PASS = 'correct horse battery staple';
function lan(url, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => { try { return JSON.parse(text); } catch { return null; } }, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function device(t, level, opts = {}) {
  const started = await startApp(t, { lanAddress: '127.0.0.1', ...opts });
  const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  assert.ok(on.url, JSON.stringify(on));
  t.after(() => started.app.remote.disable());
  const url = on.url.replace(/\/$/, '');
  const host = new URL(url).host;
  const signin = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  const cookie = String(signin.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  if (level === 'everything') {
    const id = started.app.remote.list()[0].id;
    assert.equal((await fetch(`${started.base}/api/remote/devices/${id}/level`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'everything' }) })).status, 200);
  }
  const w = { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf };
  const call = (method, path, body = null) => lan(url, { method, path, headers: w, body });
  return { ...started, call, url, w };
}


for (const level of ['everything', 'chats']) {
  test(`F12 over real HTTP: a device at ${level} cannot change trusted folders or the check (403), and its new chat starts in Ask even when the default is an explicit auto`, async (t) => {
    const d = await device(t, level);
    const win = (path, method, body) => fetch(`${d.base}${path}`, { method, headers: jsonH, body: JSON.stringify(body) });
    const repo = await mkdtemp(join(tmpdir(), 'bunny-f12-dev-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    for (const [m, p, b] of [['PUT', '/api/folder-trust', { folder: repo, auto: true }], ['DELETE', '/api/folder-trust', { folder: repo }], ['GET', '/api/folder-trust'], ['PUT', '/api/settings', { autoJudgeEnabled: false }]]) {
      const r = await d.call(m, p, b ?? null);
      assert.equal(r.status, 403, `${m} ${p} -> ${r.status} ${r.text.slice(0, 120)}`);
    }
    assert.equal((await (await win(`/api/folder-trust?folder=${encodeURIComponent(repo)}`, 'GET')).json()).auto, null, 'nothing was trusted by the refused writes');
    for (const mode of ['auto', 'smart']) {
      assert.equal((await win('/api/settings', 'PUT', { defaultPermissionMode: mode })).status, 200);
      const made = await d.call('POST', '/api/sessions', { title: 'from a device' });
      assert.equal(made.status, 200, made.text.slice(0, 120));
      assert.equal(made.json().permissionMode, 'ask', `a device's new chat is Ask when the default is ${mode}`);
      assert.equal((await (await win(`/api/sessions/${made.json().id}`, 'GET')).json()).permissionMode, 'ask', 'and it is stored as Ask, not left to the default');
      const own = await (await win('/api/sessions', 'POST', { title: 'from the window' })).json();
      assert.equal(own.permissionMode, mode, 'the window own new chat takes the default');
    }
  });
}

test('F12-6 live: with the default set to auto, a message from a device in a chat with no stored mode runs as Ask: run_command shows a card', async (t) => {
  const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
  const provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const told = body.messages.filter((m) => m.role === 'tool');
      res.end(sse(told.length ? { content: 'done' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo hi' }) } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const d = await device(t, 'everything', { fake: false });
  const win = (path, method, body) => fetch(`${d.base}${path}`, { method, headers: jsonH, body: JSON.stringify(body) });
  await win('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  assert.equal((await win('/api/settings', 'PUT', { defaultPermissionMode: 'auto', autoJudgeEnabled: false })).status, 200);
  const folder = await mkdtemp(join(tmpdir(), 'bunny-f12-dev-run-'));
  const made = (await d.call('POST', '/api/sessions', { title: 'made by a device' })).json(); // the device chose no mode: it is stored as Ask
  for (const [k, v] of [['folder', folder], ['workMode', 'code']]) await fetch(`${d.base}/api/sessions/${made.id}/setting/${k}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: v }) });
  const url = new URL(d.url);
  const sawCard = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: 'run echo hi', providerId: 'openai', model: 'gpt-4o', workMode: 'code' });
    const req = http.request({ host: url.hostname, port: url.port, path: `/api/sessions/${made.id}/messages`, method: 'POST', headers: { ...d.w, 'content-type': 'application/json' } }, (res) => {
      let text = ''; let done = false;
      res.on('data', async (c) => {
        text += c;
        const m = !done && /event: permission\ndata: (.*)\n/.exec(text);
        if (m) { done = true; const card = JSON.parse(m[1]); await win(`/api/sessions/${made.id}/permission/${card.id}`, 'POST', { allowed: false }); }
      });
      res.on('end', () => resolve(done));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(sawCard, true, 'a command from a device shows a card even though the default is auto');
});

test('F12-6 live: with the default set to auto, a message from a device in a chat with NO stored mode (cleared by the window) runs as Ask: run_command shows a card', async (t) => {
  const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
  const provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const told = body.messages.filter((m) => m.role === 'tool');
      res.end(sse(told.length ? { content: 'done' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo hi' }) } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const d = await device(t, 'everything', { fake: false });
  const win = (path, method, body) => fetch(`${d.base}${path}`, { method, headers: jsonH, body: JSON.stringify(body) });
  await win('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  assert.equal((await win('/api/settings', 'PUT', { defaultPermissionMode: 'auto', autoJudgeEnabled: false })).status, 200);
  const folder = await mkdtemp(join(tmpdir(), 'bunny-f12-dev-run-'));
  const made = await (await win('/api/sessions', 'POST', { title: 'a window chat with its mode cleared' })).json();
  assert.equal((await fetch(`${d.base}/api/sessions/${made.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: null }) })).status, 200);
  // NOTE: the session store fills a missing or cleared mode with 'ask' when it reads a chat, so through the API the route's own fallback line is not reachable; this test proves the outcome (Ask), the source line is the second lock.
  for (const [k, v] of [['folder', folder], ['workMode', 'code']]) await fetch(`${d.base}/api/sessions/${made.id}/setting/${k}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: v }) });
  const url = new URL(d.url);
  const sawCard = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ content: 'run echo hi', providerId: 'openai', model: 'gpt-4o', workMode: 'code' });
    const req = http.request({ host: url.hostname, port: url.port, path: `/api/sessions/${made.id}/messages`, method: 'POST', headers: { ...d.w, 'content-type': 'application/json' } }, (res) => {
      let text = ''; let done = false;
      res.on('data', async (c) => {
        text += c;
        const m = !done && /event: permission\ndata: (.*)\n/.exec(text);
        if (m) { done = true; const card = JSON.parse(m[1]); await win(`/api/sessions/${made.id}/permission/${card.id}`, 'POST', { allowed: false }); }
      });
      res.on('end', () => resolve(done));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(sawCard, true, 'a command from a device shows a card even though the default is auto');
});
