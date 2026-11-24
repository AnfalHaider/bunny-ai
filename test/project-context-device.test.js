import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp } from './helpers.js';

// PROJECT-CONTEXT over real HTTP: a Chats device cannot write a project's memory or keep a suggestion, and sees no text of the chat's parts; an Everything device is treated as the window.
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


async function seeded(t, level) {
  const d = await device(t, level);
  const project = await (await fetch(`${d.base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Carrot shop', instructions: 'Secret-ish project words.' }) })).json();
  await fetch(`${d.base}/api/projects/${project.id}/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'fact', text: 'Hosting is a static bucket.' }) });
  const session = await (await fetch(`${d.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Chat', projectId: project.id }) })).json();
  return { ...d, project, session };
}

test('a Chats device: memory routes and Keep are refused (403), the project switches are refused, and the context view shows sizes but no text', async (t) => {
  const d = await seeded(t, 'chats');
  for (const [m, p, b] of [
    ['GET', `/api/projects/${d.project.id}/memory`], ['POST', `/api/projects/${d.project.id}/memory`, { kind: 'fact', text: 'planted' }], ['DELETE', `/api/projects/${d.project.id}/memory`],
    ['POST', `/api/sessions/${d.session.id}/project-memory`, { messageId: 'x', itemId: 'y', action: 'keep' }],
    ['PATCH', `/api/projects/${d.project.id}`, { useMemory: false }], ['PATCH', `/api/sessions/${d.session.id}/setting/projectContext`, { value: false }],
  ]) {
    const r = await d.call(m, p, b ?? null);
    assert.equal(r.status, 403, `${m} ${p} -> ${r.status}`);
  }
  const items = await (await fetch(`${d.base}/api/projects/${d.project.id}/memory`)).json();
  assert.equal(items.items.length, 1, 'nothing was planted');
  const view = await d.call('GET', `/api/sessions/${d.session.id}/project-context`);
  assert.equal(view.status, 200);
  const parts = view.json().parts;
  assert.equal(parts.length, 5);
  assert.ok(parts.every((p) => !('text' in p)), 'a device sees sizes, not the text');
  assert.ok(!view.text.includes('Secret-ish'));
});

test('an Everything device is treated as the window for a project memory write', async (t) => {
  const d = await seeded(t, 'everything');
  const r = await d.call('POST', `/api/projects/${d.project.id}/memory`, { kind: 'fact', text: 'Kept from the phone.' });
  assert.equal(r.status, 200, r.text);
});
