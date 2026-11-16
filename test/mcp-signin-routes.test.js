/**
 * W3-6: signing in to a connector through the app's routes. A stand-in connector and sign-in server run on 127.0.0.1
 * (test/fake-mcp-oauth.js); the app runs with its request guard ON, so the callback rule is the real one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/server/app.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { startFake } from './fake-mcp-oauth.js';

const TOKEN = 'a'.repeat(64);
const j = { 'content-type': 'application/json' };

async function setup(t, { folderPickerOnly = false, fake: fakeOpts = {}, upstream = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-signin-'));
  const secrets = memorySecretStore();
  const app = await createApp({ dataDir, fake: !upstream, secretStore: secrets, apiToken: TOKEN, folderPickerOnly, probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const f = await startFake({ idToken: true, ...fakeOpts }, base);
  t.after(async () => {
    await f.close();
    await new Promise((r) => { app.server.close(() => r()); app.server.closeAllConnections?.(); });
    await rm(dataDir, { recursive: true, force: true });
  });
  /** A request with the page token only (what any program that read a page could send). */
  const withToken = async (path, init = {}) => {
    const res = await fetch(base + path, { ...init, headers: { ...j, 'x-bunny-token': TOKEN, ...(init.headers ?? {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  /** The main process's request: token and window-only secret. */
  const asWindow = async (path, init = {}) => {
    const res = await app.adminFetch(path, { ...init, headers: { ...j, ...(init.headers ?? {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const call = folderPickerOnly ? asWindow : withToken;
  const added = await call('/api/mcp', { method: 'POST', body: JSON.stringify({ name: 'Fake', url: f.server.url, enabled: true }) });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  return { app, base, dataDir, secrets, f, id: added.body.id, withToken, asWindow, call };
}

/** The system browser returning to the app. No token, as a cross-site navigation. */
const comeBack = (base, params) => fetch(`${base}/api/connectors/oauth/callback?${new URLSearchParams(params)}`, { headers: { 'sec-fetch-site': 'cross-site' } });

async function signIn(s) {
  const started = await s.call(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: '{}' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const { code, state } = s.f.browse(started.body.authUrl);
  const back = await comeBack(s.base, { code, state });
  return { started, back, html: await back.text(), state, code };
}

async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(join(e.parentPath ?? e.path, e.name));
  return out;
}

test('Test on a connector that wants a sign-in says so, with the sign-in address', async (t) => {
  const s = await setup(t);
  const r = await s.withToken(`/api/mcp/${s.id}/tools`);
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'mcp.needsSignIn');
  assert.equal(r.body.message, 'This connector needs you to sign in.');
  assert.equal(r.body.signInUrl, `${s.f.base}/.well-known/oauth-protected-resource`);
  assert.doesNotMatch(JSON.stringify(r.body), /secret raw 401/);
  const { body: list } = await s.withToken('/api/mcp');
  assert.equal(list[0].status, 'needsSignIn');
});

test('start gives an address on the sign-in server; the callback finishes it; the token is only in the secret store', async (t) => {
  const s = await setup(t);
  const { started, back, html } = await signIn(s);
  assert.match(started.body.authUrl, /\/authorize\?/);
  assert.equal(Object.keys(started.body).sort().join(), 'authUrl,expiresAt', 'no state or verifier is handed out separately');
  assert.equal(back.status, 200);
  assert.match(back.headers.get('content-type'), /text\/html/);
  assert.equal(back.headers.get('referrer-policy'), 'no-referrer');
  assert.match(html, /Signed in\. You can close this tab and go back to Bunny AI\./);

  const status = await s.withToken(`/api/connectors/${s.id}/oauth`);
  assert.equal(status.body.signedIn, true);
  assert.equal(status.body.account, 'pat@example.test');
  assert.equal(status.body.pending, false);
  assert.deepEqual(Object.keys(status.body).sort(), ['account', 'error', 'expiresAt', 'pending', 'signedIn']);

  // the tools can now be listed, with the saved sign-in
  const tools = await s.withToken(`/api/mcp/${s.id}/tools`);
  assert.equal(tools.status, 200);
  assert.equal(tools.body.tools[0].name, 'ping');

  // no token anywhere on disk or in what the window can read
  const tokens = [...s.f.access, ...s.f.refresh];
  assert.ok(tokens.length >= 2);
  for (const file of await filesUnder(s.dataDir)) {
    const text = await readFile(file, 'utf8');
    for (const token of tokens) assert.ok(!text.includes(token), `${file} holds a token`);
  }
  for (const token of tokens) {
    assert.ok(!JSON.stringify(status.body).includes(token));
    assert.ok(!JSON.stringify((await s.withToken('/api/mcp')).body).includes(token));
    assert.ok(!html.includes(token));
  }
  assert.ok((await s.secrets.get(`mcp:${s.id}:oauth`)).includes(tokens[0]) || (await s.secrets.get(`mcp:${s.id}:oauth`)).includes(tokens[1]), 'it is in the secret store');
});

test('the callback refuses a wrong, missing or used state, and shows nothing secret', async (t) => {
  const s = await setup(t);
  for (const params of [{ state: 'guess', code: 'x' }, { code: 'x' }, { state: '', code: 'x' }]) {
    const r = await comeBack(s.base, params);
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.code, 'request.badState');
  }
  const { state, code } = await signIn(s);
  const replay = await comeBack(s.base, { state, code });
  assert.equal(replay.status, 403, 'a state works once');
  assert.doesNotMatch(await replay.text(), /at-|rt-/);
});

test('a provider that says no is shown plainly, nothing is saved, and the window can read why', async (t) => {
  const s = await setup(t);
  const started = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: '{}' });
  const { state } = s.f.browse(started.body.authUrl, { deny: true });
  const back = await comeBack(s.base, { state, error: 'access_denied', error_description: '<script>alert(1)</script>' });
  const html = await back.text();
  assert.match(html, /cancelled/);
  assert.doesNotMatch(html, /<script>/);
  const status = await s.withToken(`/api/connectors/${s.id}/oauth`);
  assert.equal(status.body.signedIn, false);
  assert.equal(status.body.pending, false);
  assert.match(status.body.error, /cancelled/);
});

test('only the callback skips the page token: every other connector route needs it, and only as GET on that exact path', async (t) => {
  const s = await setup(t);
  const bare = (path, method = 'GET') => fetch(s.base + path, { method, headers: j, body: method === 'GET' ? undefined : '{}' });
  for (const [path, method] of [[`/api/connectors/${s.id}/oauth`, 'GET'], [`/api/connectors/${s.id}/oauth/start`, 'POST'], [`/api/connectors/${s.id}/oauth/signout`, 'POST'], ['/api/mcp', 'GET']]) {
    const r = await bare(path, method);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal((await r.json()).code, 'request.noToken');
  }
  const started = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: '{}' });
  const { state, code } = s.f.browse(started.body.authUrl);
  for (const [path, method] of [['/api/connectors/oauth/callback/x', 'GET'], ['/api/connectors/oauth/callbackx', 'GET'], ['/api/connectors/oauth/callback', 'POST']]) {
    const r = await fetch(`${s.base}${path}?${new URLSearchParams({ state, code })}`, { method, headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  // and the real return still works afterwards: nothing above used the state up
  assert.equal((await comeBack(s.base, { state, code })).status, 200);
});

test('status and sign-out: sign-out says whether the provider ended the access, and tokens are gone either way', async (t) => {
  const s = await setup(t);
  assert.deepEqual((await s.withToken(`/api/connectors/${s.id}/oauth`)).body, { signedIn: false, account: null, expiresAt: null, pending: false, error: null });
  await signIn(s);
  const out = await s.withToken(`/api/connectors/${s.id}/oauth/signout`, { method: 'POST', body: '{}' });
  assert.equal(out.status, 200);
  assert.equal(out.body.revoked, true);
  assert.match(out.body.message, /was told to end the access/);
  assert.equal(s.f.revoked.length >= 1, true);
  assert.equal(await s.secrets.get(`mcp:${s.id}:oauth`), null);
  assert.equal((await s.withToken(`/api/connectors/${s.id}/oauth`)).body.signedIn, false);

  // a provider with no revocation says so
  const t2 = await setup(t, { fake: { revocation: false } });
  await signIn(t2);
  const out2 = await t2.withToken(`/api/connectors/${t2.id}/oauth/signout`, { method: 'POST', body: '{}' });
  assert.equal(out2.body.revoked, false);
  assert.match(out2.body.message, /has no way to revoke the access/);
});

test('start with no way to register asks for a client id, and a pasted one works', async (t) => {
  const s = await setup(t, { fake: { registration: false } });
  const first = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: '{}' });
  assert.equal(first.status, 400);
  assert.equal(first.body.code, 'mcp.oauth.needsClientId');
  const second = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: JSON.stringify({ clientId: 'my-client' }) });
  assert.equal(second.status, 200);
  assert.equal(new URL(second.body.authUrl).searchParams.get('client_id'), 'my-client');
  // junk in the body is ignored, not trusted
  const odd = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: JSON.stringify({ clientId: { x: 1 }, resourceMetadataUrl: 5 }) });
  assert.equal(odd.status, 200);
});

test('a connector that is not there, or a local one, has no sign-in', async (t) => {
  const s = await setup(t);
  const gone = await s.withToken('/api/connectors/11111111-1111-1111-1111-111111111111/oauth');
  assert.equal(gone.status, 404);
});

test('desktop app: start and sign-out are refused over HTTP with only the token, and work through the window', async (t) => {
  const s = await setup(t, { folderPickerOnly: true });
  for (const sub of ['start', 'signout']) {
    const r = await s.withToken(`/api/connectors/${s.id}/oauth/${sub}`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 403, sub);
    assert.equal(r.body.code, 'request.windowOnly');
  }
  assert.equal((await s.withToken(`/api/connectors/${s.id}/oauth`)).status, 200, 'reading the status is not window-only');
  const { started, back } = await signIn(s); // start through the window, return through the browser
  assert.equal(started.status, 200);
  assert.equal(back.status, 200);
  const out = await s.asWindow(`/api/connectors/${s.id}/oauth/signout`, { method: 'POST', body: '{}' });
  assert.equal(out.status, 200);
});

test('removing a connector signs it out first: the provider is told and the saved sign-in is gone', async (t) => {
  const s = await setup(t);
  await signIn(s);
  assert.ok(await s.secrets.get(`mcp:${s.id}:oauth`));
  const removed = await s.withToken(`/api/mcp/${s.id}`, { method: 'DELETE' });
  assert.equal(removed.body.ok, true);
  assert.ok(s.f.revoked.length >= 1);
  assert.equal(await s.secrets.get(`mcp:${s.id}:oauth`), null);
});

test('a sign-in that finishes after the connector was removed signs straight out again', async (t) => {
  const s = await setup(t);
  const started = await s.withToken(`/api/connectors/${s.id}/oauth/start`, { method: 'POST', body: '{}' });
  const { code, state } = s.f.browse(started.body.authUrl);
  await s.withToken(`/api/mcp/${s.id}`, { method: 'DELETE' });
  const back = await comeBack(s.base, { code, state });
  assert.match(await back.text(), /no longer in Bunny AI/);
  assert.equal(await s.secrets.get(`mcp:${s.id}:oauth`), null);
});

test('in a chat, a tool on a connector that needs a sign-in fails with the exact words and carries needsSignIn', async (t) => {
  const s = await setup(t, { upstream: true });
  await signIn(s);
  assert.equal((await s.withToken(`/api/mcp/${s.id}/tools`)).status, 200); // its tools are on file
  await s.withToken(`/api/connectors/${s.id}/oauth/signout`, { method: 'POST', body: '{}' }); // signed out, still On

  const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
  const seenByModel = [];
  const model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'm1' }] })); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const tool = body.messages.find((m) => m.role === 'tool');
      if (tool) { seenByModel.push(tool.content); res.end(frame({ content: 'ok' }) + 'data: [DONE]\n\n'); return; }
      res.end(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'fake__ping', arguments: '{}' } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  t.after(() => { model.closeAllConnections?.(); model.close(); });

  await s.withToken('/api/providers/openai/connect', { method: 'POST', body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });
  const session = (await s.withToken('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 't', providerId: 'openai', model: 'm1' }) })).body;
  await s.withToken(`/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', body: JSON.stringify({ value: 'auto' }) });
  const res = await fetch(`${s.base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { ...j, 'x-bunny-token': TOKEN }, body: JSON.stringify({ content: 'ping it', providerId: 'openai', model: 'm1', workMode: 'chat' }),
  });
  const text = await res.text();
  const steps = [...text.matchAll(/event: tool\ndata: (.*)/g)].map((m) => JSON.parse(m[1])).filter((x) => x.status === 'failed');
  assert.equal(steps.length, 1, text);
  assert.equal(steps[0].result, 'This connector needs you to sign in.');
  assert.equal(steps[0].needsSignIn, true);
  assert.equal(steps[0].serverId, s.id);
  assert.doesNotMatch(text, /secret raw 401|The tool failed/);
  assert.equal(seenByModel.length, 1);
  assert.match(seenByModel[0], /^This connector needs you to sign in\. Do not call this connector again until the person signs in/);
  // kept in the chat too
  const saved = (await s.withToken(`/api/sessions/${session.id}`)).body;
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  assert.equal(step.result, 'This connector needs you to sign in.');
  assert.equal(step.needsSignIn, true);
  assert.equal(step.serverId, s.id);
});

test('W36-1: changing the address of a connector signs it out first, so its token is not sent to the new place', async (t) => {
  const s = await setup(t);
  await signIn(s);
  assert.ok(await s.secrets.get(`mcp:${s.id}:oauth`));
  const same = await s.withToken(`/api/mcp/${s.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) });
  assert.equal(same.status, 200);
  assert.ok(await s.secrets.get(`mcp:${s.id}:oauth`), 'a rename keeps the sign-in');
  const moved = await s.withToken(`/api/mcp/${s.id}`, { method: 'PATCH', body: JSON.stringify({ url: 'https://elsewhere.example.test/mcp' }) });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(await s.secrets.get(`mcp:${s.id}:oauth`), null);
  assert.ok(s.f.revoked.length >= 1, 'the provider was told');
});
