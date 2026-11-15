/**
 * S-1: the local API answers only Bunny AI's own pages.
 * Unit cases call the guard with plain objects; route cases run the real server
 * with the guard ON (test/helpers.js turns it off for every other suite).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp } from './helpers.js';
import { createRequestGuard } from '../src/server/requestGuard.js';
import { createApp } from '../src/server/app.js';
import { memorySecretStore } from '../src/providers/connections.js';

const TOKEN = 'unit-test-token';
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const P = 4321;

const req = (headers = {}) => ({ headers, socket: { localPort: P } });
const guard = createRequestGuard({ token: TOKEN });
const ok = (h, path = '/api/settings', method = 'GET') => guard.check(req(h), path, method);
const good = { host: `127.0.0.1:${P}`, 'x-bunny-token': TOKEN };

// ---------- the guard function ----------

test('T-1 a plain call with the right host and token is allowed', () => {
  assert.equal(ok(good).ok, true);
});

test('T-2 a page-style call is allowed', () => {
  const h = { host: `localhost:${P}`, origin: `http://localhost:${P}`, 'sec-fetch-site': 'same-origin', 'x-bunny-token': TOKEN };
  assert.equal(ok(h, '/api/settings', 'PUT').ok, true);
});

test('T-3 a static page needs no token (Sec-Fetch-Site none is a typed address)', () => {
  assert.equal(ok({ host: `127.0.0.1:${P}`, 'sec-fetch-site': 'none' }, '/src/ui/index.html').ok, true);
});

test('T-4 header-less loads skip the token only', () => {
  for (const path of ['/api/health', '/api/profile/photo', `/api/screens/${UUID}.png`, `/api/artifacts/${UUID}/raw`]) {
    assert.equal(ok({ host: `127.0.0.1:${P}`, 'sec-fetch-site': 'same-origin' }, path).ok, true, path);
    assert.equal(ok({ host: `evil.example:${P}` }, path).code, 'request.badHost', `${path} still checks Host`);
    assert.equal(ok({ host: `127.0.0.1:${P}`, 'sec-fetch-site': 'cross-site' }, path).code, 'request.badOrigin', `${path} still checks Sec-Fetch-Site`);
  }
  assert.equal(ok({ host: `127.0.0.1:${P}` }, '/api/profile/photo', 'POST').code, 'request.noToken', 'only GET is header-less');
});

test('T-5 a cross-origin call is refused even with the right token', () => {
  const r = ok({ ...good, origin: 'http://evil.example' }, '/api/mcp', 'POST');
  assert.deepEqual([r.ok, r.code], [false, 'request.badOrigin']);
});

test('T-6 cross-site and same-site fetch metadata are refused on the API', () => {
  for (const site of ['cross-site', 'same-site']) {
    assert.equal(ok({ ...good, 'sec-fetch-site': site }, '/api/mcp', 'POST').code, 'request.badOrigin', site);
  }
  assert.equal(ok({ ...good, 'sec-fetch-site': 'none' }, '/api/settings').code, 'request.badOrigin', 'none is for typed pages, not the API');
});

test('T-7 Origin null (sandboxed frame) is refused', () => {
  assert.equal(ok({ ...good, origin: 'null' }, '/api/settings', 'PUT').code, 'request.badOrigin');
});

test('T-8 Origin on another port of the same host is refused', () => {
  assert.equal(ok({ ...good, origin: 'http://127.0.0.1:9999' }).code, 'request.badOrigin');
});

test('T-9 a missing token is refused', () => {
  const r = ok({ host: `127.0.0.1:${P}` }, '/api/mcp', 'POST');
  assert.deepEqual([r.ok, r.code], [false, 'request.noToken']);
  assert.match(r.message, /out of date/);
});

test('T-10 a wrong or short token is refused without throwing', () => {
  assert.equal(ok({ ...good, 'x-bunny-token': 'x'.repeat(TOKEN.length) }).code, 'request.noToken');
  assert.equal(ok({ ...good, 'x-bunny-token': 'short' }).code, 'request.noToken');
  assert.equal(ok({ ...good, 'x-bunny-token': '' }).code, 'request.noToken');
});

test('T-11 DNS-rebinding Host values are refused', () => {
  for (const host of [`attacker.example:${P}`, 'attacker.example', undefined, '127.0.0.1', `127.0.0.1:${P + 1}`, `[::1]:${P}`, `localhost.evil.example:${P}`]) {
    const h = { ...good, host };
    if (host === undefined) delete h.host;
    const r = ok(h, '/api/sessions');
    assert.equal(r.code, 'request.badHost', String(host));
    assert.ok(!JSON.stringify(r).includes(String(P)) && !JSON.stringify(r).includes(TOKEN), 'the refusal reveals neither port nor token');
  }
});

test('T-19 malformed headers never throw', () => {
  assert.equal(ok({ ...good, host: `LOCALHOST:${P}` }).ok, true, 'mixed-case host passes');
  assert.equal(typeof ok({ ...good, host: `127.0.0.1:${P} ` }).ok, 'boolean', 'trailing space: either verdict, no throw');
  assert.equal(ok({ ...good, origin: ['http://a', 'http://b'] }).ok, false, 'two Origin headers');
  assert.equal(ok({ ...good, origin: 'a'.repeat(10_000) }).ok, false, 'huge Origin');
  assert.equal(ok({ ...good, 'x-bunny-token': 'tokén-ünicöde-€'.padEnd(TOKEN.length, 'é') }).ok, false, 'non-ASCII token');
  assert.equal(ok({}).ok, false, 'no headers at all');
});

// ---------- the real server, guard on ----------

function raw(base, path, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const r = request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

const MCP_BODY = JSON.stringify({ command: 'calc', confirmLocal: true });

test('T-5/T-9 route: a cross-site or token-less POST /api/mcp stores nothing', async (t) => {
  const { app, base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const h = { host: new URL(base).host, 'content-type': 'text/plain' };

  const evil = await raw(base, '/api/mcp', { method: 'POST', headers: { ...h, origin: 'http://evil.example', 'x-bunny-token': TOKEN }, body: MCP_BODY });
  assert.equal(evil.status, 403);
  assert.equal(JSON.parse(evil.text).code, 'request.badOrigin');

  const bare = await raw(base, '/api/mcp', { method: 'POST', headers: h, body: MCP_BODY });
  assert.equal(bare.status, 403);
  assert.equal(JSON.parse(bare.text).code, 'request.noToken');

  assert.deepEqual(await app.mcp.list(), []);
});

test('T-1 route: the right token works; T-11 route: a rebinding Host is refused', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const host = new URL(base).host;
  assert.equal((await raw(base, '/api/settings', { headers: { host, 'x-bunny-token': TOKEN } })).status, 200);
  const rebound = await raw(base, '/api/sessions', { headers: { host: 'attacker.example:' + new URL(base).port, 'x-bunny-token': TOKEN } });
  assert.equal(rebound.status, 403);
  assert.equal(JSON.parse(rebound.text).code, 'request.badHost');
  assert.ok(!rebound.text.includes(new URL(base).port) && !rebound.text.includes(TOKEN));
});

test('T-3 route: a served page carries the token, a no-store header and the wrapper script', async (t) => {
  const { app, base } = await startApp(t, { localGuard: true });
  const host = new URL(base).host;
  for (const page of ['index', 'providers', 'settings', 'automation', 'customize']) {
    const res = await raw(base, `/src/ui/${page}.html`, { headers: { host, 'sec-fetch-site': 'none' } });
    assert.equal(res.status, 200, page);
    assert.ok(res.text.includes(`<meta name="bunny-token" content="${app.apiToken}">`), page);
    assert.ok(res.text.includes('<script src="/src/ui/token.js"></script>'), page);
    assert.equal(res.headers['cache-control'], 'no-store', page);
  }
  const js = await raw(base, '/src/ui/token.js', { headers: { host } });
  assert.equal(js.status, 200);
  assert.ok(!js.text.includes(app.apiToken), 'the script file itself never holds the token');
});

test('T-4 route: the header-less loads pass the guard', async (t) => {
  const { base } = await startApp(t, { localGuard: true });
  const headers = { host: new URL(base).host, 'sec-fetch-site': 'same-origin' };
  assert.equal((await raw(base, '/api/health', { headers })).status, 200);
  assert.equal((await raw(base, '/api/profile/photo', { headers })).status, 404); // none set, but not 403
  assert.notEqual((await raw(base, `/api/screens/${UUID}.png`, { headers })).status, 403);
});

test('T-13 a preflight from another origin is refused and grants nothing', async (t) => {
  const { base } = await startApp(t, { localGuard: true, apiToken: TOKEN });
  const res = await raw(base, '/api/settings', { method: 'OPTIONS', headers: { host: new URL(base).host, origin: 'http://evil.example', 'access-control-request-method': 'PUT' } });
  assert.equal(res.status, 403);
  assert.ok(!Object.keys(res.headers).some((k) => k.startsWith('access-control-')));
});

test('T-12 the scheduler sends the token on its own call', () => {
  const src = readFileSync(new URL('../src/server/app.js', import.meta.url), 'utf8');
  const at = src.indexOf('/messages`, {', src.indexOf('runDueSchedules'));
  assert.ok(at > 0 && /x-bunny-token/i.test(src.slice(at, at + 400)), 'the self-call to /api/sessions/:id/messages carries x-bunny-token');
});

test('the guard is ON by default: createApp({ dataDir }) refuses a tokenless call', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-guard-'));
  const app = await createApp({ dataDir, fake: true, secretStore: memorySecretStore() });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => { app.server.close(() => r()); app.server.closeAllConnections?.(); });
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await raw(base, '/api/settings', { headers: { host: new URL(base).host } })).status, 403);
  assert.equal(typeof app.apiToken, 'string');
  assert.ok(app.apiToken.length >= 64);
});

test('localGuard:false appears only under test/ in non-test code', () => {
  for (const f of ['src/server/app.js', 'src/server/main.js', 'electron/main.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/localGuard\s*:\s*false/.test(src), `${f} must not turn the guard off`);
  }
});

test('BUNNY_API_TOKEN is honoured only in fake-upstream mode', () => {
  const src = readFileSync(new URL('../src/server/main.js', import.meta.url), 'utf8');
  assert.match(src, /BUNNY_FAKE_UPSTREAM === '1'[\s\S]{0,160}BUNNY_API_TOKEN|BUNNY_API_TOKEN[\s\S]{0,160}BUNNY_FAKE_UPSTREAM === '1'/);
});
