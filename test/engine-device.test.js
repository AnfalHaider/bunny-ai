import { test } from 'node:test';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DEVICE_ACCESS_MESSAGE, ENGINE_REFUSED_MESSAGE, deviceRefusal, isDeviceRefused } from '../src/server/remoteAccess.js';
import { WINDOW_ONLY_ROUTES, WINDOW_ONLY_SESSION_SETTINGS, WINDOW_ONLY_SETTING_KEYS, isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { startApp } from './helpers.js';

// CLI-ENGINES, CE-6: a device, at Everything too, never reaches the engines (download, update, rollback, remove, sign-in, sign-out, status), the `engine` and `engines` settings, or `session.engine`.
const PASS = 'correct horse battery staple';
const ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

test('isDeviceRefused: every engines route, the engine settings and session.engine; device access as before; ordinary writes are not touched', () => {
  for (const [m, p] of [['GET', '/api/engines'], ['POST', '/api/engines/codex/download'], ['POST', '/api/engines/claude-code/rollback'], ['DELETE', '/api/engines/codex'], ['PUT', '/api/engines/codex/auth'], ['GET', '/api/engines/'], ['POST', '/api/engines/codex/signin'], ['POST', '/api/engines/codex/signout']]) {
    assert.equal(deviceRefusal(m, p), ENGINE_REFUSED_MESSAGE, `${m} ${p}`);
    assert.equal(isDeviceRefused(m, p), true);
  }
  assert.equal(deviceRefusal('PUT', '/api/settings', { engine: 'codex' }), ENGINE_REFUSED_MESSAGE);
  assert.equal(deviceRefusal('PUT', '/api/settings', { theme: 'dark', engines: { codex: { auth: 'local' } } }), ENGINE_REFUSED_MESSAGE);
  assert.equal(deviceRefusal('POST', '/api/sessions', { title: 'x', engine: { id: 'codex' } }), ENGINE_REFUSED_MESSAGE);
  assert.equal(deviceRefusal('PATCH', `/api/sessions/${ID}`, { engine: { id: 'codex' } }), ENGINE_REFUSED_MESSAGE);
  assert.equal(deviceRefusal('PATCH', `/api/sessions/${ID}/setting/engine`, { value: 'codex' }), ENGINE_REFUSED_MESSAGE);
  assert.equal(deviceRefusal('GET', '/api/remote'), DEVICE_ACCESS_MESSAGE, 'device access keeps its own sentence');
  assert.equal(deviceRefusal('PUT', '/api/remote', {}), DEVICE_ACCESS_MESSAGE);
  for (const [m, p, b] of [['PUT', '/api/settings', { theme: 'dark' }], ['POST', '/api/sessions', { title: 'x' }], ['PATCH', `/api/sessions/${ID}`, { title: 'y' }], ['PATCH', `/api/sessions/${ID}/setting/effort`, { value: 'high' }], ['GET', '/api/engineering'], ['GET', '/api/enginesx'], ['PUT', '/api/settings', null], ['GET', '/api/sessions']]) {
    assert.equal(deviceRefusal(m, p, b), null, `${m} ${p}`);
  }
});

test('the engine settings and routes are window-only too (so the desktop app needs the second secret for them)', () => {
  assert.ok(WINDOW_ONLY_SETTING_KEYS.includes('engine') && WINDOW_ONLY_SETTING_KEYS.includes('engines'));
  assert.ok(WINDOW_ONLY_SESSION_SETTINGS.includes('engine'));
  assert.ok(WINDOW_ONLY_ROUTES.some(([methods, re]) => methods.includes('POST') && new RegExp(re).test('/api/engines/codex/download')));
  assert.equal(isWindowOnlyRoute('PUT', '/api/settings', { engine: 'codex' }), true);
  assert.equal(isWindowOnlyRoute('POST', '/api/sessions', { engine: {} }), true);
  assert.equal(isWindowOnlyRoute('PATCH', `/api/sessions/${ID}`, { engine: {} }), true);
});

// ---------------------------------------------------------------- over real HTTP, at Everything and at Chats
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

async function device(t, level) {
  const started = await startApp(t, { lanAddress: '127.0.0.1' });
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
  return { ...started, call };
}

for (const level of ['everything', 'chats']) {
  test(`over HTTP, a device at ${level} is refused every engines route, the engine settings and session.engine: "Only Bunny's window can change engines."`, async (t) => {
    const d = await device(t, level);
    const made = await (await fetch(`${d.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Window chat' }) })).json();
    const attempts = [
      ['GET', '/api/engines'], ['POST', '/api/engines/codex/download', {}], ['POST', '/api/engines/claude-code/rollback', {}], ['DELETE', '/api/engines/codex'], ['POST', '/api/engines/codex/signin', {}],
      ['PUT', '/api/settings', { engine: 'codex' }], ['PUT', '/api/settings', { theme: 'dark', engines: { codex: { auth: 'account' } } }],
      ['POST', '/api/sessions', { title: 'x', engine: { id: 'codex', auth: 'local' } }],
      ['PATCH', `/api/sessions/${made.id}`, { engine: { id: 'codex', auth: 'local' } }],
      ['PATCH', `/api/sessions/${made.id}/setting/engine`, { value: 'codex' }],
    ];
    for (const [m, p, b] of attempts) {
      const r = await d.call(m, p, b);
      assert.equal(r.status, 403, `${m} ${p} -> ${r.status} ${r.text.slice(0, 120)}`);
      // a Chats device is turned away earlier, by the short allow-list, for the writes that carry the key in the body; the engines routes always get the engines sentence
      const ok = level === 'everything' || /\/api\/engines/.test(p) ? [ENGINE_REFUSED_MESSAGE] : [ENGINE_REFUSED_MESSAGE, "Change this in Bunny's window."];
      assert.ok(ok.includes(r.json()?.message), `${m} ${p}: ${r.json()?.message}`);
    }
    // nothing changed: the setting was never saved, and the chat has no engine
    const settings = await (await fetch(`${d.base}/api/settings`)).json();
    assert.equal(settings.engine, undefined);
    assert.equal(settings.engines, undefined);
    const after = await (await fetch(`${d.base}/api/sessions/${made.id}`)).json();
    assert.equal(after.engine, undefined);
  });
}

test('an Everything device may still make ordinary writes (the refusal is only for the engines), and device access keeps its own sentence', async (t) => {
  const d = await device(t, 'everything');
  const ok = await d.call('PUT', '/api/settings', { theme: 'dark' });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  const admin = await d.call('PUT', '/api/remote', { enabled: false });
  assert.equal(admin.status, 403);
  assert.equal(admin.json()?.message, DEVICE_ACCESS_MESSAGE);
});

test('the window itself (no device) is not refused: it can set the engine settings', async (t) => {
  const { base } = await startApp(t, {});
  const r = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: 'bunny' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).engine, 'bunny');
});

test('EN-7 (CE-6.2, CE-7.2, R-DF2): an Everything device\'s chat on an engine logs each engine tool by name only, as "<engine>:<mapped name>", never its input', async (t) => {
  const keep = { fake: process.env.BUNNY_FAKE_ENGINE, script: process.env.BUNNY_FAKE_ENGINE_SCRIPT };
  process.env.BUNNY_FAKE_ENGINE = '1';
  const { mkdtemp, writeFile } = await import('node:fs/promises'); const { tmpdir } = await import('node:os');
  const folder = await mkdtemp(join(tmpdir(), 'bunny-dev-eng-')); await writeFile(join(folder, 'a.txt'), 'alpha');
  process.env.BUNNY_FAKE_ENGINE_SCRIPT = JSON.stringify({ steps: [{ tool: 'Read', input: { file_path: join(folder, 'a.txt') } }, { say: 'ok' }] });
  t.after(() => { for (const [k, v] of [['BUNNY_FAKE_ENGINE', keep.fake], ['BUNNY_FAKE_ENGINE_SCRIPT', keep.script]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const d = await device(t, 'everything');
  await fetch(`${d.base}/api/providers/openai/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test-000000000000' }) });
  await fetch(`${d.base}/api/engines/claude-code/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  for (let i = 0; i < 100; i += 1) { const s = (await (await fetch(`${d.base}/api/engines`)).json()).engines[0]; if (s.downloaded) break; await new Promise((r) => setTimeout(r, 50)); }
  const made = await (await fetch(`${d.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Dev', workMode: 'code', folder }) })).json();
  await fetch(`${d.base}/api/sessions/${made.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine: { id: 'claude-code', auth: 'account' } }) });
  const reply = await d.call('POST', `/api/sessions/${made.id}/messages`, { content: 'read it', providerId: 'openai', model: 'test-model-1', workMode: 'code' });
  assert.equal(reply.status, 200); assert.match(reply.text, /event: tool/);
  const log = (await (await fetch(`${d.base}/api/remote/log`)).json());
  const entries = (log.log ?? log.entries ?? log).filter?.((e) => e.kind === 'tool') ?? [];
  assert.ok(entries.some((e) => e.tool === 'claude-code:read_file'), JSON.stringify(entries));
  assert.equal(JSON.stringify(entries).includes('a.txt'), false, 'never the input or the path');
});
