/**
 * Signing in to MCP connectors that need OAuth: discovery, PKCE sign-in,
 * refresh, sign-out, and the 401 handling in mcp.js. Everything runs against a
 * stand-in server on 127.0.0.1 that plays the connector and the sign-in server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMcpOAuth } from '../src/server/mcpOAuth.js';
import { callTool, listTools } from '../src/server/mcp.js';
import { createMcpStore } from '../src/server/mcpStore.js';
import { memorySecretStore } from '../src/providers/connections.js';

const REDIRECT_BASE = 'http://127.0.0.1:45999';

/** The stand-in: MCP server + protected-resource metadata + sign-in server. */
async function startFake(initial = {}) {
  const f = {
    opts: { registration: true, revocation: true, expiresIn: 3600, idToken: false, ...initial },
    codes: new Map(), access: new Set(), refresh: new Set(),
    tokenRequests: [], registrations: [], revoked: [], mcpAuth: [],
    seq: 0,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, f.base);
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      if (url.pathname === '/mcp') {
        const header = req.headers.authorization ?? '';
        f.mcpAuth.push(header);
        const token = header.replace(/^Bearer /, '');
        if (!f.access.has(token)) {
          return send(401, { error: 'secret raw 401 text' }, { 'www-authenticate': `Bearer realm="mcp", resource_metadata="${f.base}/.well-known/oauth-protected-resource"` });
        }
        const rpc = JSON.parse(body);
        return send(200, { jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'Ping' }] } : { content: [{ type: 'text', text: 'pong' }] } });
      }
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        if (f.opts.noPrm) return send(404, {});
        return send(200, { resource: `${f.base}/mcp`, authorization_servers: [f.opts.prmIssuer ?? f.base], scopes_supported: ['read', 'write'] });
      }
      if (url.pathname === '/.well-known/oauth-authorization-server' && !f.opts.openidOnly) {
        return send(200, metadata(f));
      }
      if (url.pathname === '/.well-known/openid-configuration' && f.opts.openidOnly) {
        return send(200, metadata(f));
      }
      if (url.pathname === '/register') {
        f.registrations.push(JSON.parse(body));
        return send(201, { client_id: `client-${++f.seq}` });
      }
      if (url.pathname === '/token') return token(f, new URLSearchParams(body), send);
      if (url.pathname === '/revoke') {
        const p = new URLSearchParams(body);
        f.revoked.push({ token: p.get('token'), hint: p.get('token_type_hint') });
        return send(200, {});
      }
      if (url.pathname === '/userinfo') return send(200, { email: 'sam@example.test' });
      if (url.pathname === '/hop') { res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); return res.end(); }
      if (url.pathname === '/big') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"x":"' + 'a'.repeat(1_100_000) + '"}'); }
      return send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  f.base = `http://127.0.0.1:${server.address().port}`;
  f.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  f.server = { id: 'srv-1', name: 'Fake', url: `${f.base}/mcp` };

  /** Play the browser: check the address the app made, hand back a code. */
  f.browse = (authUrl, { deny = false } = {}) => {
    const u = new URL(authUrl);
    const q = u.searchParams;
    assert.equal(u.origin + u.pathname, `${f.base}/authorize`);
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('redirect_uri'), `${REDIRECT_BASE}/api/connectors/oauth/callback`);
    assert.equal(q.get('resource'), `${f.base}/mcp`);
    if (deny) return { error: 'access_denied', state: q.get('state') };
    const code = `code-${++f.seq}`;
    f.codes.set(code, { challenge: q.get('code_challenge'), clientId: q.get('client_id') });
    return { code, state: q.get('state') };
  };
  return f;
}

function metadata(f) {
  return {
    issuer: f.opts.badIssuer ?? f.base,
    authorization_endpoint: f.opts.httpsOnlyBreak ? 'http://example.com/authorize' : `${f.base}/authorize`,
    token_endpoint: `${f.base}/token`,
    ...(f.opts.registration ? { registration_endpoint: `${f.base}/register` } : {}),
    ...(f.opts.revocation ? { revocation_endpoint: `${f.base}/revoke` } : {}),
    ...(f.opts.userinfo ? { userinfo_endpoint: `${f.base}/userinfo` } : {}),
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write'],
    unknown_field: { ignored: true },
  };
}

function token(f, p, send) {
  f.tokenRequests.push(Object.fromEntries(p));
  const issue = () => {
    const access = `at-${randomBytes(12).toString('hex')}`;
    const refresh = `rt-${randomBytes(12).toString('hex')}`;
    f.access.add(access); f.refresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: f.opts.expiresIn, scope: 'read write',
      ...(f.opts.idToken ? { id_token: `x.${Buffer.from(JSON.stringify({ email: 'pat@example.test' })).toString('base64url')}.y` } : {}) };
  };
  if (p.get('grant_type') === 'authorization_code') {
    const entry = f.codes.get(p.get('code'));
    f.codes.delete(p.get('code'));
    if (!entry) return send(400, { error: 'invalid_grant' });
    const check = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
    if (check !== entry.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
    return send(200, issue());
  }
  if (p.get('grant_type') === 'refresh_token') {
    if (f.opts.refreshFails || !f.refresh.has(p.get('refresh_token'))) return send(400, { error: 'invalid_grant' });
    f.refresh.delete(p.get('refresh_token')); // rotate
    return send(200, issue());
  }
  return send(400, { error: 'unsupported_grant_type' });
}

async function setup(opts = {}, { clock = { t: 1_000_000 }, createOpts = {} } = {}) {
  const f = await startFake(opts);
  const secrets = memorySecretStore();
  const oauth = createMcpOAuth({ secrets, redirectBase: REDIRECT_BASE, now: () => clock.t, ...createOpts });
  return { f, secrets, oauth, clock };
}

async function signIn({ f, oauth }, startOpts = {}) {
  const started = await oauth.startSignIn(f.server, startOpts);
  const { code, state } = f.browse(started.authUrl);
  return oauth.completeSignIn({ state, code });
}

const rejectsWith = (promise, code, text) => assert.rejects(promise, (err) => {
  if (code) assert.equal(err.code, code);
  if (text) assert.match(err.message, text);
  return true;
});

test('discovery follows resource_metadata, then falls back to the well-known addresses', async () => {
  const t = await setup();
  try {
    const viaHeader = await t.oauth.discover(t.f.server, { resourceMetadataUrl: `${t.f.base}/.well-known/oauth-protected-resource` });
    assert.equal(viaHeader.meta.authorization_endpoint, `${t.f.base}/authorize`);
    assert.equal(viaHeader.scope, 'read write');
    const viaFallback = await t.oauth.discover(t.f.server);
    assert.equal(viaFallback.meta.token_endpoint, `${t.f.base}/token`);
    // No protected-resource document at all: the connector's own origin is the sign-in server.
    t.f.opts.noPrm = true;
    const origin = await t.oauth.discover(t.f.server);
    assert.equal(origin.issuer, t.f.base);
  } finally { await t.f.close(); }
});

test('discovery falls back to OpenID configuration', async () => {
  const t = await setup({ openidOnly: true });
  try {
    const d = await t.oauth.discover(t.f.server);
    assert.equal(d.meta.token_endpoint, `${t.f.base}/token`);
  } finally { await t.f.close(); }
});

test('an endpoint that is not https (and not this PC) is refused', async () => {
  const t = await setup({ httpsOnlyBreak: true });
  try {
    await rejectsWith(t.oauth.discover(t.f.server), 'mcp.oauth.badUrl', /https/);
  } finally { await t.f.close(); }
});

test('a sign-in server that names a different issuer is refused', async () => {
  const t = await setup({ badIssuer: 'https://evil.example' });
  try {
    await rejectsWith(t.oauth.discover(t.f.server), 'mcp.oauth.issuerMismatch');
  } finally { await t.f.close(); }
});

test('the client registers once as a public client, then the saved client_id is reused', async () => {
  const t = await setup();
  try {
    await t.oauth.startSignIn(t.f.server);
    await t.oauth.startSignIn(t.f.server);
    assert.equal(t.f.registrations.length, 1);
    const r = t.f.registrations[0];
    assert.equal(r.token_endpoint_auth_method, 'none');
    assert.deepEqual(r.redirect_uris, [`${REDIRECT_BASE}/api/connectors/oauth/callback`]);
  } finally { await t.f.close(); }
});

test('with no registration endpoint it says so, and accepts a pasted client id', async () => {
  const t = await setup({ registration: false });
  try {
    await rejectsWith(t.oauth.startSignIn(t.f.server), 'mcp.oauth.needsClientId', /Paste the client ID/);
    const started = await t.oauth.startSignIn(t.f.server, { clientId: 'pasted-id' });
    assert.equal(new URL(started.authUrl).searchParams.get('client_id'), 'pasted-id');
  } finally { await t.f.close(); }
});

test('startSignIn builds a PKCE address with state, resource and scope', async () => {
  const t = await setup();
  try {
    const s = await t.oauth.startSignIn(t.f.server);
    const q = new URL(s.authUrl).searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.match(q.get('client_id'), /^client-/);
    assert.equal(q.get('redirect_uri'), `${REDIRECT_BASE}/api/connectors/oauth/callback`);
    assert.ok(q.get('code_challenge'));
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('state'), s.state);
    assert.ok(s.state.length >= 43); // 32 random bytes
    assert.equal(q.get('resource'), `${t.f.base}/mcp`);
    assert.equal(q.get('scope'), 'read write');
    assert.equal(s.expiresAt, t.clock.t + 5 * 60_000);
  } finally { await t.f.close(); }
});

test('sign-in works end to end and no file ever holds the token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-mcp-oauth-'));
  const t = await setup({ idToken: true });
  try {
    const store = createMcpStore({ file: join(dir, 'mcp.json') });
    const added = await store.add({ name: 'Fake', url: t.f.server.url });
    t.f.server.id = added.id;
    const done = await signIn(t);
    assert.deepEqual(done, { serverId: added.id, account: 'pat@example.test' });
    // the verifier went to the token endpoint, and the id of the server stayed with the flow
    assert.equal(t.f.tokenRequests[0].resource, `${t.f.base}/mcp`);
    const stored = JSON.parse(t.secrets.get(`mcp:${added.id}:oauth`));
    assert.equal(stored.account, 'pat@example.test');
    assert.ok(stored.access_token.startsWith('at-'));
    assert.equal(stored.expires_at, t.clock.t + 3600_000);
    await store.setStatus(added.id, { status: 'ok' });
    for (const name of await readdir(dir)) {
      const text = await readFile(join(dir, name), 'utf8');
      assert.ok(!text.includes(stored.access_token) && !text.includes(stored.refresh_token), `${name} holds a token`);
    }
    const shown = JSON.stringify(await t.oauth.status(t.f.server));
    assert.ok(!shown.includes(stored.access_token) && !shown.includes(stored.refresh_token));
    assert.deepEqual(JSON.parse(shown), { signedIn: true, account: 'pat@example.test', expiresAt: stored.expires_at });
  } finally { await t.f.close(); await rm(dir, { recursive: true, force: true }); }
});

test('the account name falls back to userinfo, then to the host', async () => {
  const a = await setup({ userinfo: true });
  try { assert.equal((await signIn(a)).account, 'sam@example.test'); } finally { await a.f.close(); }
  const b = await setup();
  try { assert.equal((await signIn(b)).account, new URL(b.f.base).host); } finally { await b.f.close(); }
});

test('an unknown, reused or expired state fails and a failure uses the state up', async () => {
  const t = await setup();
  try {
    await rejectsWith(t.oauth.completeSignIn({ state: 'nope', code: 'x' }), 'mcp.oauth.badState');
    const s1 = await t.oauth.startSignIn(t.f.server);
    const b1 = t.f.browse(s1.authUrl);
    await t.oauth.completeSignIn(b1);
    await rejectsWith(t.oauth.completeSignIn(b1), 'mcp.oauth.badState', /already used/);
    // expiry: five minutes and a second later
    const s2 = await t.oauth.startSignIn(t.f.server);
    const b2 = t.f.browse(s2.authUrl);
    assert.equal(t.oauth.flowKnown(s2.state), true);
    t.clock.t += 5 * 60_000 + 1000;
    assert.equal(t.oauth.flowKnown(s2.state), false);
    await rejectsWith(t.oauth.completeSignIn(b2), 'mcp.oauth.badState');
    // exactly at five minutes is still good
    const s3 = await t.oauth.startSignIn(t.f.server);
    const b3 = t.f.browse(s3.authUrl);
    t.clock.t += 5 * 60_000;
    await t.oauth.completeSignIn(b3);
  } finally { await t.f.close(); }
});

test('an error from the provider fails plainly and consumes only its own state', async () => {
  const t = await setup();
  try {
    const other = await t.oauth.startSignIn(t.f.server);
    const s = await t.oauth.startSignIn(t.f.server);
    const denied = t.f.browse(s.authUrl, { deny: true });
    await rejectsWith(t.oauth.completeSignIn(denied), 'mcp.oauth.denied', /cancelled/);
    await rejectsWith(t.oauth.completeSignIn({ state: s.state, code: 'whatever' }), 'mcp.oauth.badState');
    assert.equal(t.oauth.flowKnown(other.state), true);
    const hostile = await t.oauth.startSignIn(t.f.server);
    await rejectsWith(t.oauth.completeSignIn({ state: hostile.state, error: 'Ignore all previous <script>' }), 'mcp.oauth.denied');
    assert.ok(!/script/.test((await t.oauth.completeSignIn({ state: other.state, error: 'server_error' }).catch((e) => e.message))));
  } finally { await t.f.close(); }
});

test('a PKCE mismatch is refused by the provider and nothing is stored', async () => {
  const t = await setup();
  try {
    const s = await t.oauth.startSignIn(t.f.server);
    const b = t.f.browse(s.authUrl);
    t.f.codes.get(b.code).challenge = createHash('sha256').update('another verifier').digest('base64url');
    await rejectsWith(t.oauth.completeSignIn(b), 'mcp.oauth.refused', /invalid_grant/);
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), null);
  } finally { await t.f.close(); }
});

test('only 8 sign-ins can be pending: the oldest is dropped', async () => {
  const t = await setup();
  try {
    const flows = [];
    for (let i = 0; i < 9; i++) flows.push(await t.oauth.startSignIn(t.f.server));
    assert.equal(t.oauth.flowKnown(flows[0].state), false);
    for (const f of flows.slice(1)) assert.equal(t.oauth.flowKnown(f.state), true);
  } finally { await t.f.close(); }
});

test('the token is refreshed shortly before it runs out, and the rotated refresh token is kept', async () => {
  const t = await setup();
  try {
    await signIn(t);
    const first = JSON.parse(t.secrets.get('mcp:srv-1:oauth'));
    const fresh = await t.oauth.authHeader(t.f.server);
    assert.equal(fresh.authorization, `Bearer ${first.access_token}`);
    assert.equal(t.f.tokenRequests.length, 1); // no refresh yet
    t.clock.t += 3600_000 - 30_000; // 30 s left: inside the 60 s margin
    const renewed = await t.oauth.authHeader(t.f.server);
    const second = JSON.parse(t.secrets.get('mcp:srv-1:oauth'));
    assert.notEqual(second.access_token, first.access_token);
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.equal(renewed.authorization, `Bearer ${second.access_token}`);
    assert.equal(second.account, first.account);
    assert.equal(t.f.tokenRequests[1].grant_type, 'refresh_token');
  } finally { await t.f.close(); }
});

test('two callers at once share one refresh', async () => {
  const t = await setup();
  try {
    await signIn(t);
    t.clock.t += 3600_000;
    const [a, b] = await Promise.all([t.oauth.authHeader(t.f.server), t.oauth.authHeader(t.f.server)]);
    assert.deepEqual(a, b);
    assert.equal(t.f.tokenRequests.filter((r) => r.grant_type === 'refresh_token').length, 1);
  } finally { await t.f.close(); }
});

test('a refused refresh (invalid_grant) deletes the tokens and the connector asks to sign in', async () => {
  const t = await setup();
  try {
    await signIn(t);
    t.f.opts.refreshFails = true;
    t.clock.t += 3600_000;
    await rejectsWith(callTool(t.f.server, { name: 'ping', auth: t.oauth.authFor(t.f.server) }), 'mcp.needsSignIn', /needs you to sign in/);
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), null);
    assert.equal((await t.oauth.status(t.f.server)).signedIn, false);
    await rejectsWith(callTool(t.f.server, { name: 'ping', auth: t.oauth.authFor(t.f.server) }), 'mcp.needsSignIn');
  } finally { await t.f.close(); }
});

test('a refresh that only failed to connect keeps the tokens', async () => {
  const t = await setup();
  try {
    await signIn(t);
    t.clock.t += 3600_000;
    const before = t.secrets.get('mcp:srv-1:oauth');
    const down = createMcpOAuth({ secrets: t.secrets, redirectBase: REDIRECT_BASE, now: () => t.clock.t, fetchImpl: async () => { throw new Error('offline'); } });
    await rejectsWith(down.authHeader(t.f.server), 'mcp.oauth.refreshFailed');
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), before);
  } finally { await t.f.close(); }
});

test('a connector with no token answers needsSignIn with the sign-in address, never raw 401 text', async () => {
  const t = await setup();
  try {
    const auth = t.oauth.authFor(t.f.server);
    for (const run of [() => callTool(t.f.server, { name: 'ping', auth }), () => listTools(t.f.server, { auth })]) {
      await assert.rejects(run(), (err) => {
        assert.equal(err.code, 'mcp.needsSignIn');
        assert.equal(err.message, 'This connector needs you to sign in.');
        assert.equal(err.signInUrl, `${t.f.base}/.well-known/oauth-protected-resource`);
        assert.ok(!/secret raw/.test(err.message));
        return true;
      });
    }
  } finally { await t.f.close(); }
});

test('after sign-in the Bearer header is sent and the tools answer', async () => {
  const t = await setup();
  try {
    await signIn(t);
    const auth = t.oauth.authFor(t.f.server);
    const tools = await listTools(t.f.server, { auth });
    assert.equal(tools[0].name, 'ping');
    const result = await callTool(t.f.server, { name: 'ping', auth });
    assert.equal(result.content[0].text, 'pong');
    const stored = JSON.parse(t.secrets.get('mcp:srv-1:oauth'));
    assert.equal(t.f.mcpAuth.at(-1), `Bearer ${stored.access_token}`);
  } finally { await t.f.close(); }
});

test('a 401 with a token gets one refresh and retry, then needsSignIn', async () => {
  const t = await setup();
  try {
    await signIn(t);
    const stored = JSON.parse(t.secrets.get('mcp:srv-1:oauth'));
    t.f.access.delete(stored.access_token); // the server forgot this token though the clock says it is fine
    const result = await callTool(t.f.server, { name: 'ping', auth: t.oauth.authFor(t.f.server) });
    assert.equal(result.content[0].text, 'pong');
    assert.equal(t.f.tokenRequests.filter((r) => r.grant_type === 'refresh_token').length, 1);
    // now nothing works any more
    t.f.access.clear();
    t.f.refresh.clear(); // the provider no longer honours either token
    await rejectsWith(callTool(t.f.server, { name: 'ping', auth: t.oauth.authFor(t.f.server) }), 'mcp.needsSignIn');
  } finally { await t.f.close(); }
});

test('callers without auth are unchanged: a 401 is still the plain http error', async () => {
  const t = await setup();
  try {
    await rejectsWith(callTool(t.f.server, { name: 'ping' }), 'mcp.http', /401/);
    await rejectsWith(listTools(t.f.server), 'mcp.http', /401/);
    const res = await callTool({ ...t.f.server, headers: { authorization: 'Bearer static' } }, { name: 'ping' }).catch((e) => e);
    assert.equal(res.code, 'mcp.http');
    assert.equal(t.f.mcpAuth.at(-1), 'Bearer static');
  } finally { await t.f.close(); }
});

test('sign-out revokes the refresh token first, then the access token, and forgets both', async () => {
  const t = await setup();
  try {
    await signIn(t);
    const stored = JSON.parse(t.secrets.get('mcp:srv-1:oauth'));
    const out = await t.oauth.signOut(t.f.server);
    assert.equal(out.revoked, true);
    assert.deepEqual(t.f.revoked, [
      { token: stored.refresh_token, hint: 'refresh_token' },
      { token: stored.access_token, hint: 'access_token' },
    ]);
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), null);
    assert.equal((await t.oauth.status(t.f.server)).signedIn, false);
  } finally { await t.f.close(); }
});

test('sign-out without a revocation endpoint says plainly that it cannot revoke', async () => {
  const t = await setup({ revocation: false });
  try {
    await signIn(t);
    const out = await t.oauth.signOut(t.f.server);
    const host = new URL(t.f.base).host;
    assert.deepEqual(out, { revoked: false, message: `Signed out here; ${host} has no way to revoke the access, so remove it in your account there if you want it gone.` });
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), null);
  } finally { await t.f.close(); }
});

test('a discovery redirect to another origin is refused', async () => {
  const t = await setup();
  try {
    await rejectsWith(t.oauth.discover(t.f.server, { resourceMetadataUrl: `${t.f.base}/hop` }), 'mcp.unreachable', /somewhere else/);
  } finally { await t.f.close(); }
});

test('an answer over 1 MB is refused', async () => {
  const t = await setup();
  try {
    await rejectsWith(t.oauth.discover(t.f.server, { resourceMetadataUrl: `${t.f.base}/big` }), 'mcp.oauth.tooLarge');
  } finally { await t.f.close(); }
});

test('a token answer that is not JSON, or not bearer, is refused', async () => {
  const t = await setup();
  try {
    const s = await t.oauth.startSignIn(t.f.server);
    const b = t.f.browse(s.authUrl);
    const odd = createMcpOAuth({ secrets: t.secrets, redirectBase: REDIRECT_BASE, now: () => t.clock.t,
      fetchImpl: async (url, init) => (String(url).endsWith('/token')
        ? new Response('access_token=abc&token_type=bearer', { status: 200, headers: { 'content-type': 'application/x-www-form-urlencoded' } })
        : fetch(url, init)) });
    const s2 = await odd.startSignIn(t.f.server);
    const b2 = t.f.browse(s2.authUrl);
    await rejectsWith(odd.completeSignIn(b2), 'mcp.oauth.badAnswer');
    assert.ok(b);
    const mac = createMcpOAuth({ secrets: t.secrets, redirectBase: REDIRECT_BASE, now: () => t.clock.t,
      fetchImpl: async (url, init) => (String(url).endsWith('/token')
        ? new Response(JSON.stringify({ access_token: 'abc', token_type: 'mac' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : fetch(url, init)) });
    const s3 = await mac.startSignIn(t.f.server);
    await rejectsWith(mac.completeSignIn(t.f.browse(s3.authUrl)), 'mcp.oauth.badAnswer');
    assert.equal(t.secrets.get('mcp:srv-1:oauth'), null);
  } finally { await t.f.close(); }
});

test('a missing or silly expires_in becomes one hour', async () => {
  const t = await setup({ expiresIn: 'soon' });
  try {
    await signIn(t);
    assert.equal(JSON.parse(t.secrets.get('mcp:srv-1:oauth')).expires_at, t.clock.t + 3600_000);
  } finally { await t.f.close(); }
});

test('the return address must be on this PC', () => {
  assert.throws(() => createMcpOAuth({ secrets: memorySecretStore(), redirectBase: 'https://example.com' }), /on this PC/);
});

// ---- review of the engine (automated security review): mix-up protection and loopback discovery

test('RFC 9207: an answer that names a different issuer than the one the sign-in started with is refused, and uses up the state', async () => {
  const t = await setup();
  try {
    const started = await t.oauth.startSignIn(t.f.server);
    const { code, state } = t.f.browse(started.authUrl);
    await rejectsWith(t.oauth.completeSignIn({ state, code, iss: 'https://evil.example' }), 'mcp.oauth.issuerMismatch');
    await rejectsWith(t.oauth.completeSignIn({ state, code }), 'mcp.oauth.badState'); // the state is gone
    // the right issuer (with or without a trailing slash) and no issuer at all are both fine
    const again = await t.oauth.startSignIn(t.f.server);
    const b = t.f.browse(again.authUrl);
    assert.equal((await t.oauth.completeSignIn({ state: b.state, code: b.code, iss: `${again.authUrl.startsWith('http://127.0.0.1') ? new URL(again.authUrl).origin : ''}/` })).serverId, t.f.server.id);
  } finally { await t.f.close(); }
});

test('a connector out on the internet cannot send sign-in to an address on this computer', async () => {
  const seen = [];
  const secrets = memorySecretStore();
  const evil = 'http://127.0.0.1:9';
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth-protected-resource')) return json({ resource: 'https://connector.example.test/mcp', authorization_servers: [evil] });
    return json({ issuer: evil, authorization_endpoint: `${evil}/a`, token_endpoint: `${evil}/t` });
  };
  const oauth = createMcpOAuth({ secrets, redirectBase: REDIRECT_BASE, fetchImpl });
  const server = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'https://connector.example.test/mcp' };
  await rejectsWith(oauth.discover(server), 'mcp.oauth.badUrl', /address on this computer/);
  assert.ok(!seen.some((u) => u.startsWith(evil)), 'nothing was fetched from this computer');
  // resource_metadata given by a remote connector's 401 header, pointing at this computer
  await rejectsWith(oauth.discover(server, { resourceMetadataUrl: `${evil}/prm` }), 'mcp.oauth.badUrl', /address on this computer/);
  // a remote connector whose sign-in server is on https is fine at this step (and the metadata may not mix in loopback endpoints)
  const mixed = async (url) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth-protected-resource')) return json({ resource: 'https://connector.example.test/mcp', authorization_servers: ['https://auth.example.test'] });
    return json({ issuer: 'https://auth.example.test', authorization_endpoint: 'https://auth.example.test/a', token_endpoint: `${evil}/t` });
  };
  await rejectsWith(createMcpOAuth({ secrets, redirectBase: REDIRECT_BASE, fetchImpl: mixed }).discover(server), 'mcp.oauth.badUrl', /address on this computer/);
});
