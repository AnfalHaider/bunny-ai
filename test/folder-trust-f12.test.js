import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFolderTrust, isGitWorkTree, smartMode } from '../src/server/folderTrust.js';
import { startApp, post } from './helpers.js';
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

test('F12: a chat a device starts is Ask even when the default is an explicit auto or smart; Smart starts in Ask while the check is off or was down', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8');
  assert.match(src, /body\.permissionMode === undefined && !req\.bunnyRemote && !req\.bunnyDevice && \['smart', 'ask', 'accept', 'plan', 'auto'\]\.includes\(settings\.defaultPermissionMode\)/);
  assert.equal(smartMode({ ...ok, judgeOn: false }).mode, 'ask');
  assert.equal(smartMode({ ...ok, judgeDown: true }).mode, 'ask');
  assert.match(smartMode({ ...ok, judgeDown: true }).why, /Smart starts in Ask while Bunny's check is off or can't be reached/);
  assert.match(src, /judgeDown: Date\.now\(\) < judgeDownUntil/);
});

test('F12: every place that refuses a device uses a message that exists (a device\'s folder-trust or judge write is a clean 403, never a 500)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bDEVICE_ACCESS_MESSAGE\b[^}]*\} from '\.\/remoteAccess\.js'/, 'the constant the refusals use is imported');
  const { DEVICE_ACCESS_MESSAGE } = await import('../src/server/remoteAccess.js');
  assert.ok(typeof DEVICE_ACCESS_MESSAGE === 'string' && DEVICE_ACCESS_MESSAGE.length > 5);
});
