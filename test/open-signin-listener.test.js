import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { memorySecretStore } from '../src/providers/connections.js';

// OPEN-SIGNIN step 3 (OS-1, OS-4, OS-6): the internet listener of the real app, on your own HTTPS address. The proxy is played by this test (a plain request to 127.0.0.1 with the pinned Host).
const PASS = 'a long passcode, sixteen plus';
const NAME = 'bunny.example.com';

async function start(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-net-'));
  const app = await createApp({ dataDir, fake: true, secretStore: memorySecretStore(), localGuard: false, lanAddress: '127.0.0.2', networkProfile: async () => ({ name: 'Test', category: 'Public' }) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { app.remote.disable(); app.internet.disable(); app.server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, dataDir };
}
const json = (base, method, path, body) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const settings = (base, body) => json(base, 'PUT', '/api/settings', body);
/** A request as the proxy would forward it: to the loopback listener, with the pinned Host. */
function viaProxy(target, { method = 'GET', path = '/', headers = {}, body = null, host = NAME } = {}) {
  const u = new URL(target);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { host, origin: `https://${host}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => { try { return JSON.parse(text); } catch { return null; } } }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function turnOn(base, extra = {}) {
  assert.equal((await settings(base, { internetRoute: 'https', internetHttpsHost: NAME })).status, 200);
  return json(base, 'POST', '/api/remote/internet', { on: true, passcode: PASS, ...extra });
}
const signIn = (target, passcode = PASS) => viaProxy(target, { method: 'POST', path: '/api/remote/signin', body: { passcode } });
const cookieOf = (r) => String(r.headers['set-cookie']?.[0] ?? '').split(';')[0];

test('OS-1: the listener binds 127.0.0.1 only, on a port that is neither the window\'s nor the home network\'s, and is open only while the route is on', async (t) => {
  const { app, base } = await start(t);
  assert.equal((await (await json(base, 'GET', '/api/remote/internet')).json()).on, false);
  assert.equal((await turnOn(base)).status, 200);
  const status = await (await json(base, 'GET', '/api/remote/internet')).json();
  assert.equal(status.on, true);
  assert.equal(status.address, `https://${NAME}/`);
  const target = new URL(status.proxyTarget);
  assert.equal(target.hostname, '127.0.0.1');
  assert.notEqual(Number(target.port), app.server.address().port, 'never the window\'s port');
  const address = app.internet; // the instance exists beside the home network one
  assert.equal(address.via, 'internet');
  // the proxy path works with the pinned Host; the sign-in page is what a visitor gets
  const page = await viaProxy(status.proxyTarget);
  assert.ok([200, 302].includes(page.status), `the pinned Host reaches Bunny, got ${page.status}`);
  // off: the listener closes
  assert.equal((await json(base, 'POST', '/api/remote/internet', { on: false })).status, 200);
  await assert.rejects(viaProxy(status.proxyTarget), /ECONNREFUSED/, 'nothing listens when the route is off');
});

test('OS-2/OS-6: a direct request with Host 127.0.0.1:<port> and a DNS-rebinding Host are refused; a wrong Origin is refused', async (t) => {
  const { base } = await start(t);
  await turnOn(base);
  const target = (await (await json(base, 'GET', '/api/remote/internet')).json()).proxyTarget;
  const port = new URL(target).port;
  for (const host of [`127.0.0.1:${port}`, 'evil.example.com', `${NAME}:9999`]) {
    const r = await viaProxy(target, { host, path: '/api/remote/me' });
    assert.equal(r.status, 403, `Host ${host} is refused`);
  }
  assert.equal((await viaProxy(target, { headers: { origin: 'https://evil.example.com' }, path: '/api/remote/me' })).status, 403);
  assert.equal((await viaProxy(target, { headers: { 'sec-fetch-site': 'cross-site' }, path: '/api/remote/me' })).status, 403);
});

test('OS-1/OS-5: signing in sets the internet cookie (__Host-, Secure, HttpOnly, SameSite=Strict, Path=/), and that cookie is not a home-network session', async (t) => {
  const { app, base } = await start(t);
  await turnOn(base);
  const target = (await (await json(base, 'GET', '/api/remote/internet')).json()).proxyTarget;
  const bad = await signIn(target, 'not the passcode at all');
  assert.equal(bad.status, 401);
  const good = await signIn(target);
  assert.equal(good.status, 200);
  const header = String(good.headers['set-cookie']);
  assert.match(header, /^__Host-bunny_remote=[0-9a-f]{64}; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=1800/);
  assert.ok(!/Domain/i.test(header));
  const me = await viaProxy(target, { path: '/api/remote/me', headers: { cookie: cookieOf(good) } });
  assert.equal(me.status, 200);
  assert.equal(me.json().level, 'chats', 'an internet device starts at Chats');
  // the same value under the home network's cookie name is nothing
  const wrongName = await viaProxy(target, { path: '/api/remote/me', headers: { cookie: cookieOf(good).replace('__Host-bunny_remote', 'bunny_remote') } });
  assert.equal(wrongName.status, 401);
  assert.equal(app.remote.count(), 0, 'the home-network instance has no sessions');
  const list = (await (await json(base, 'GET', '/api/remote')).json()).devices;
  assert.deepEqual(list.map((d) => d.via), ['internet']);
});

test('OS-4: the internet route needs 16+ characters, saves the passcode at N=65536, and one passcode serves both listeners (a change ends the home-network sessions)', async (t) => {
  const { app, base, dataDir } = await start(t);
  await settings(base, { internetRoute: 'https', internetHttpsHost: NAME });
  assert.equal((await json(base, 'POST', '/api/remote/internet', { on: true })).status, 400, 'no passcode saved yet');
  assert.equal((await json(base, 'POST', '/api/remote/internet', { on: true, passcode: 'only twelve!!' })).status, 400, 'under 16 characters');
  assert.equal((await json(base, 'POST', '/api/remote/internet', { on: true, passcode: PASS })).status, 200);
  const record = JSON.parse(await readFile(join(dataDir, 'remote-access.json'), 'utf8'));
  assert.equal(record.N, 65536);
  assert.ok(!JSON.stringify(record).includes(PASS), 'the passcode itself is never saved');
  // the home network opens with the same passcode record
  assert.equal(await app.remote.verify(PASS), true);
});

test('OS-1: the home network instance and the internet instance are separate; turning the internet off does not close the home network', async (t) => {
  const { app, base } = await start(t);
  await json(base, 'PUT', '/api/remote', { enabled: true, passcode: 'twelve chars ok' });
  assert.equal(app.remote.enabled, true);
  await turnOn(base);
  assert.equal(app.remote.enabled && app.internet.enabled, true);
  await json(base, 'POST', '/api/remote/internet', { on: false });
  assert.equal(app.internet.enabled, false);
  assert.equal(app.remote.enabled, true);
});

test('OS-6: a bad own-HTTPS name is refused when saved and when turning on; the route Funnel says it is not here yet', async (t) => {
  const { base } = await start(t);
  for (const host of ['localhost', '192.168.1.5', '*.example.com', 'https://a.example.com', 'a.example.com/x']) {
    assert.equal((await settings(base, { internetHttpsHost: host })).status, 400, host);
  }
  assert.equal((await json(base, 'POST', '/api/remote/internet', { on: true, passcode: PASS })).status, 400, 'no name saved');
  assert.equal((await settings(base, { internetRoute: 'sepia' })).status, 400);
  assert.equal((await settings(base, { internetPort: 80 })).status, 400);
  assert.equal((await settings(base, { keepSignedIn: 'yes' })).status, 400);
});

test('OS-7/OS-8: a device cannot reach the internet routes or change the options, at Chats or at Everything', async (t) => {
  const { app, base } = await start(t);
  await turnOn(base);
  const target = (await (await json(base, 'GET', '/api/remote/internet')).json()).proxyTarget;
  const s = await signIn(target);
  const cookie = cookieOf(s);
  const csrf = (await viaProxy(target, { path: '/api/remote/me', headers: { cookie } })).json().csrf;
  const device = (path, method = 'GET', body = null) => viaProxy(target, { method, path, body, headers: { cookie, 'x-bunny-csrf': csrf } });
  const attempts = () => Promise.all([
    device('/api/remote/internet'), device('/api/remote/internet', 'POST', { on: false }), device('/api/remote/internet/reset-wait', 'POST', {}), device('/api/remote/internet/keep-off', 'POST', {}),
    device('/api/settings', 'PUT', { keepSignedIn: true }), device('/api/settings', 'PUT', { everythingStaysOn: true }), device('/api/settings', 'PUT', { internetStayOpen: true }),
    device('/api/settings', 'PUT', { internetHttpsHost: 'evil.example.com' }),
  ]);
  for (const r of await attempts()) assert.equal(r.status, 403, 'a Chats device is refused');
  // the window raises it to Everything; the options and the routes are still refused
  const id = (await (await json(base, 'GET', '/api/remote')).json()).devices[0].id;
  assert.equal((await json(base, 'PATCH', `/api/remote/devices/${id}/level`, { level: 'everything' })).status, 200);
  for (const r of await attempts()) assert.equal(r.status, 403, 'an Everything device is refused too');
  assert.equal(app.internet.enabled, true, 'nothing it tried changed the route');
  assert.equal((await (await json(base, 'GET', '/api/settings')).json()).keepSignedIn, undefined, 'nor the options');
  // and a level change from the device is refused
  assert.equal((await device(`/api/remote/devices/${id}/level`, 'PATCH', { level: 'chats' })).status, 403);
});

test('OS-3: Reset and Keep it off are the window\'s; the shut-off notice stands across a restart until the window clears it', async (t) => {
  const { app, base, dataDir } = await start(t);
  await turnOn(base);
  app.internet.setShutoff(Date.now());
  await json(base, 'POST', '/api/remote/internet', { on: false }); // writes the state with the shut-off
  const saved = JSON.parse(await readFile(join(dataDir, 'remote-internet.json'), 'utf8'));
  assert.ok(saved.shutoffAt, 'the shut-off is saved');
  assert.equal((await (await json(base, 'POST', '/api/remote/internet/reset-wait', {})).json()).wait, 0);
  const kept = await (await json(base, 'POST', '/api/remote/internet/keep-off', {})).json();
  assert.equal(kept.shutoff, false);
  assert.equal(kept.on, false, 'Keep it off leaves the route closed');
  assert.equal(JSON.parse(await readFile(join(dataDir, 'remote-internet.json'), 'utf8')).shutoffAt, null);
});
