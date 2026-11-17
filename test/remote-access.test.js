import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COOKIE, FAILS_BEFORE_WAIT, checkPasscodeChoice, createRemoteAccess, deviceLabel, findLanAddress, generatePasscode, hashPasscode, readCookie, remoteBody, remoteException, remotePolicy, verifyPasscode,
} from '../src/server/remoteAccess.js';
import { startApp } from './helpers.js';

// BROWSER step 2: open to other devices on the local network. Unit rules first, then the real thing over HTTP (the "LAN" is 127.0.0.1 on a second port).
const PASS = 'correct horse battery staple';

test('a generated passcode is long and readable; a chosen one needs 12 characters', () => {
  const p = generatePasscode();
  assert.match(p, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
  assert.notEqual(generatePasscode(), p);
  assert.equal(checkPasscodeChoice('short').ok, false);
  assert.equal(checkPasscodeChoice('      eleven    ').ok, false, 'spaces at the ends do not count');
  assert.equal(checkPasscodeChoice('twelve chars').ok, true);
  assert.equal(checkPasscodeChoice(undefined).ok, false);
  assert.equal(checkPasscodeChoice('x'.repeat(201)).ok, false);
});

test('the passcode is kept only as a salted scrypt hash; a wrong one never verifies', async () => {
  const a = await hashPasscode(PASS);
  const b = await hashPasscode(PASS);
  assert.equal(a.kdf, 'scrypt');
  assert.notEqual(a.salt, b.salt, 'a new salt every time');
  assert.notEqual(a.hash, b.hash);
  assert.doesNotMatch(JSON.stringify(a), /correct horse|battery/);
  assert.equal(await verifyPasscode(PASS, a), true);
  assert.equal(await verifyPasscode(PASS + ' ', a), false);
  assert.equal(await verifyPasscode('', a), false);
  assert.equal(await verifyPasscode(PASS, null), false);
  assert.equal(await verifyPasscode(PASS, { ...a, hash: 'zz' }), false);
});

test('lockout: five wrong tries in a row make THAT device wait, longer each time; another device is not affected; a right one resets', async () => {
  let t = 1_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  for (let i = 1; i < FAILS_BEFORE_WAIT; i += 1) assert.equal((await r.signIn('10.0.0.9', 'wrong wrong wrong')).status, 401, `try ${i}`);
  const fifth = await r.signIn('10.0.0.9', 'wrong wrong wrong');
  assert.equal(fifth.status, 401);
  assert.equal(fifth.waitSeconds, 30);
  const during = await r.signIn('10.0.0.9', PASS); // even the right passcode waits
  assert.deepEqual([during.status, during.waitSeconds], [429, 30]);
  assert.equal((await r.signIn('10.0.0.77', PASS)).ok, true, 'another device signs in at once');
  t += 31_000;
  const sixth = await r.signIn('10.0.0.9', 'wrong wrong wrong');
  assert.equal(sixth.waitSeconds, 60, 'longer each time');
  t += 61_000;
  assert.equal((await r.signIn('10.0.0.9', PASS)).ok, true);
  const again = await r.signIn('10.0.0.9', 'wrong wrong wrong');
  assert.equal(again.waitSeconds, undefined, 'a right one reset the count');
});

test('a flood of wrong tries from many devices makes everyone wait a minute', async () => {
  let t = 5_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  for (let i = 0; i < 40; i += 1) await r.signIn(`10.0.1.${i}`, 'wrong wrong wrong');
  const blocked = await r.signIn('10.0.2.1', PASS);
  assert.equal(blocked.status, 429);
  t += 61_000;
  assert.equal((await r.signIn('10.0.2.1', PASS)).ok, true);
});

test('sessions: found by cookie, gone after idle time, signed out one by one or all; the list never shows a secret; turning off ends all', async () => {
  let t = 1;
  const r = createRemoteAccess({ now: () => t });
  assert.equal((await r.signIn('1.1.1.1', PASS)).status, 403, 'off by default');
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  const a = await r.signIn('10.0.0.2', PASS, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Safari/604.1');
  const b = await r.signIn('10.0.0.3', PASS, 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120');
  assert.equal(r.sessionFor(`${COOKIE}=${a.secret}`).label, 'iPhone or iPad · Safari');
  assert.equal(r.sessionFor(`x=1; ${COOKIE}=${b.secret}`).label, 'Windows · Edge');
  assert.equal(r.sessionFor(`${COOKIE}=nope`), null);
  assert.doesNotMatch(JSON.stringify(r.list()), new RegExp(`${a.secret}|${b.secret}`));
  assert.equal(r.count(), 2);
  assert.equal(r.signOutDevice(r.list()[0].id), true);
  assert.equal(r.sessionFor(`${COOKIE}=${a.secret}`), null);
  t += 13 * 60 * 60 * 1000;
  assert.equal(r.sessionFor(`${COOKIE}=${b.secret}`), null, 'idle for more than 12 hours');
  const c = await r.signIn('10.0.0.4', PASS);
  r.disable();
  assert.equal(r.sessionFor(`${COOKIE}=${c.secret}`), null, 'turning it off ends every session');
  assert.equal(r.enabled, false);
});

test('the cookie is HttpOnly and SameSite=Strict; readCookie finds it among others', () => {
  const r = createRemoteAccess();
  const c = r.cookieFor('abc');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Path=\//);
  assert.doesNotMatch(c, /Domain=/);
  assert.equal(readCookie('a=1; bunny_remote=zzz; b=2'), 'zzz');
  assert.equal(readCookie('nothing=1'), '');
  assert.match(r.clearCookie(), /Max-Age=0/);
});

test('the local-network address is a private IPv4 on a real interface, never loopback or a public one', () => {
  assert.equal(findLanAddress({ lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], wifi: [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), '192.168.1.20');
  assert.equal(findLanAddress({ e: [{ family: 'IPv4', address: '203.0.113.5', internal: false }] }), null, 'a public address is not "local network"');
  assert.equal(findLanAddress({ e: [{ family: 'IPv6', address: 'fe80::1', internal: false }] }), null);
  assert.equal(findLanAddress({ e: [{ family: 'IPv4', address: '172.20.0.4', internal: false }] }), '172.20.0.4');
  assert.equal(findLanAddress({ e: [{ family: 'IPv4', address: '172.32.0.4', internal: false }] }), null);
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari'), 'Android · Chrome');
});

test('what another device may do: ordinary chats (their cards and modes too); never what runs things outside a chat or changes what Bunny may do', () => {
  const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  for (const [m, p] of [['GET', '/api/sessions'], ['GET', `/api/sessions/${id}`], ['GET', `/api/sessions/${id}/files`], ['GET', '/api/models'], ['GET', '/api/settings'], ['POST', '/api/sessions'], ['POST', `/api/sessions/${id}/messages`], ['POST', `/api/sessions/${id}/permission/${id}`], ['POST', `/api/sessions/${id}/question/${id}`], ['POST', `/api/sessions/${id}/capability/${id}`], ['PATCH', `/api/sessions/${id}`], ['PATCH', `/api/sessions/${id}/setting/permissionMode`], ['DELETE', `/api/sessions/${id}`], ['GET', '/src/ui/index.html'], ['GET', `/api/artifacts/${id}/raw`]]) assert.equal(remotePolicy(m, p), true, `${m} ${p}`);
  for (const [m, p] of [
    ['PUT', '/api/settings'], ['PUT', '/api/permission-rules'], ['POST', '/api/mcp'], ['POST', '/api/plugins/install'], ['POST', '/api/skills'], ['POST', '/api/schedules'], ['POST', '/api/hooks'],
    ['POST', '/api/terminal/create'], ['GET', '/api/terminal/read'], ['POST', '/api/computer/click'], ['POST', '/api/folder/check'], ['GET', '/api/remote'], ['PUT', '/api/remote'], ['POST', '/api/remote/signout-all'],
    ['GET', '/api/account'], ['POST', '/api/import'], ['POST', '/api/providers/openai/connect'], ['PUT', '/api/network'], ['POST', '/api/update/check'], ['DELETE', '/api/tools/x_tool'],
  ]) assert.equal(remotePolicy(m, p), false, `${m} ${p}`);
});

test('the few window-only routes a device may still use: a chat\'s own cards and its mode; nothing else that is window-only rides along', () => {
  const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  assert.equal(remoteException('POST', `/api/sessions/${id}/permission/${id}`), true);
  assert.equal(remoteException('POST', `/api/sessions/${id}/question/${id}`), true);
  assert.equal(remoteException('POST', `/api/sessions/${id}/capability/${id}`), true);
  assert.equal(remoteException('PATCH', `/api/sessions/${id}/setting/permissionMode`), true);
  assert.equal(remoteException('POST', '/api/sessions', { title: 'x', permissionMode: 'auto' }), true);
  assert.equal(remoteException('PATCH', `/api/sessions/${id}`, { permissionMode: 'ask' }), true);
  assert.equal(remoteException('PUT', '/api/settings', { defaultPermissionMode: 'auto' }), false, 'the default mode is the window\'s');
  assert.equal(remoteException('PUT', '/api/permission-rules', {}), false);
  assert.equal(remoteException('POST', '/api/mcp', {}), false);
  assert.equal(remoteException('POST', '/api/sessions', { title: 'x' }), false, 'no mode in it: nothing to allow');
  assert.equal(remoteException('POST', '/api/sessions', { permissionMode: 'auto', instructions: 'x' }), true, 'instructions on a chat are not window-only here');
});

test('a message or a new chat from another device: what the app\'s page sends, minus what only the window or the scheduler may say (no folder, no scheduled-task mode, no browser control, no text-only switch)', () => {
  const m = remoteBody('/api/sessions/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/messages', { content: 'hi', workMode: 'code', folder: 'C:\\x', scheduledTask: 'x', browserControl: true, textOnly: true, providerId: 'p', model: 'm', useSkill: 'a' });
  assert.deepEqual(m, { content: 'hi', workMode: 'code', providerId: 'p', model: 'm', useSkill: 'a' });
  const s = remoteBody('/api/sessions', { title: 'x'.repeat(200), folder: 'C:\\x', permissionMode: 'auto', workMode: 'code', origin: 'quick-ask', agent: 'helper', branch: 'main' });
  assert.deepEqual(Object.keys(s).sort(), ['permissionMode', 'title', 'workMode']);
  assert.equal(s.title.length, 80);
  assert.deepEqual(remoteBody('/api/sessions', null), {});
});
// ---------------------------------------------------------------- over real HTTP

/** A request with a Host header and cookie of our choosing (fetch will not let a test set Host). */
function lan(url, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => { try { return JSON.parse(text); } catch { return null; } } }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const put = (base, body) => fetch(`${base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function opened(t, extra = {}) {
  const started = await startApp(t, { lanAddress: '127.0.0.1', ...extra });
  const on = await (await put(started.base, { enabled: true, passcode: PASS })).json();
  assert.ok(on.url, JSON.stringify(on));
  const url = on.url.replace(/\/$/, '');
  return { ...started, url, host: new URL(url).host };
}
const signIn = async (url, host, passcode = PASS) => lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode } });
const cookieOf = (res) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];

test('off by default: nothing listens; turning it on needs a passcode of 12+ characters; a generated one is shown once', async (t) => {
  const { base, app } = await startApp(t, { lanAddress: '127.0.0.1' });
  const status = await (await fetch(`${base}/api/remote`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.url, null);
  const none = await put(base, { enabled: true });
  assert.equal(none.status, 400);
  assert.match((await none.json()).message, /Choose a passcode/);
  const short = await put(base, { enabled: true, passcode: 'short' });
  assert.equal(short.status, 400);
  assert.match((await short.json()).message, /at least 12/);
  const made = await (await put(base, { enabled: true, generate: true })).json();
  assert.match(made.generatedPasscode, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
  const again = await (await fetch(`${base}/api/remote`)).json();
  assert.equal(again.generatedPasscode, undefined, 'never shown again');
  assert.equal(app.remote.enabled, true);
  await put(base, { enabled: false });
});

test('the passcode is saved only as a hash, and "on" is never read back: a new app starts OFF', async (t) => {
  const { base, dataDir } = await startApp(t, { lanAddress: '127.0.0.1' });
  await put(base, { enabled: true, passcode: PASS });
  const file = await readFile(join(dataDir, 'remote-access.json'), 'utf8');
  assert.doesNotMatch(file, /correct horse|battery|staple/);
  assert.match(file, /"kdf":"scrypt"/);
  await put(base, { enabled: false });
  const second = await startApp(t, { lanAddress: '127.0.0.1', dataDir });
  const status = await (await fetch(`${second.base}/api/remote`)).json();
  assert.equal(status.enabled, false, 'off after a restart');
  assert.equal(status.hasPasscode, true, 'the hash is kept so "turn on" can reuse the passcode');
});

test('before signing in a device gets only the sign-in page: no token, no API, no other page', async (t) => {
  const { url, host, app } = await opened(t);
  t.after(() => app.remote.disable());
  const page = await lan(url, { path: '/', headers: { host } });
  assert.equal(page.status, 200);
  assert.match(page.text, /Sign in to Bunny AI/);
  assert.doesNotMatch(page.text, /bunny-token|x-bunny/);
  assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
  assert.equal((await lan(url, { path: '/src/ui/signin.js', headers: { host } })).status, 200);
  for (const path of ['/src/ui/index.html', '/src/ui/chat.js', '/src/ui/token.js', '/src/ui/settings.html', '/x']) {
    const r = await lan(url, { path, headers: { host } });
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.location, '/');
    assert.doesNotMatch(r.text, /bunny-token/);
  }
  for (const path of ['/api/sessions', '/api/health', '/api/models', '/api/settings', '/api/remote', '/api/remote/me']) {
    const r = await lan(url, { path, headers: { host } });
    assert.equal(r.status, 401, path);
    assert.equal(r.json().code, 'remote.signin');
  }
  const write = await lan(url, { method: 'POST', path: '/api/sessions', headers: { host, origin: `http://${host}` }, body: { title: 'x' } });
  assert.equal(write.status, 401);
});

test('Host and Origin: exactly the local-network address and port; nothing wider', async (t) => {
  const { url, host, app } = await opened(t);
  t.after(() => app.remote.disable());
  const port = new URL(url).port;
  for (const bad of [`localhost:${port}`, `127.0.0.2:${port}`, `${new URL(url).hostname}:${Number(port) + 1}`, new URL(url).hostname, `evil.example:${port}`, `${host}.evil.example`]) {
    const r = await lan(url, { path: '/', headers: { host: bad } });
    assert.equal(r.status, 403, `Host ${bad}`);
    assert.equal(r.json().code, 'request.badHost');
  }
  for (const origin of ['http://evil.example', 'null', `https://${host}`, `http://localhost:${port}`]) {
    const r = await signIn(url, host).then(() => lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin }, body: { passcode: PASS } }));
    assert.equal(r.status, 403, `Origin ${origin}`);
    assert.equal(r.json().code, 'request.badOrigin');
  }
  const cross = await lan(url, { path: '/', headers: { host, 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.equal((await lan(url, { path: '/', headers: { host, 'sec-fetch-site': 'none' } })).status, 200, 'a typed address is fine');
});

test('signing in: a wrong passcode is refused, five in a row make the device wait, and nothing is handed out on failure', async (t) => {
  const { url, host, app } = await opened(t);
  t.after(() => app.remote.disable());
  for (let i = 0; i < 4; i += 1) {
    const r = await signIn(url, host, 'wrong wrong wrong');
    assert.equal(r.status, 401);
    assert.equal(r.headers['set-cookie'], undefined);
  }
  const fifth = await signIn(url, host, 'wrong wrong wrong');
  assert.equal(fifth.status, 401);
  assert.ok(Number(fifth.headers['retry-after']) > 0);
  const waiting = await signIn(url, host, PASS);
  assert.equal(waiting.status, 429, 'the right passcode waits too');
  assert.equal(waiting.json().code, 'remote.wait');
  assert.equal(waiting.headers['set-cookie'], undefined);
});

test('signed in: a HttpOnly SameSite=Strict cookie, the app\'s pages WITHOUT the launch token, reads work, writes need the CSRF token', async (t) => {
  const { url, host, app, base } = await opened(t);
  t.after(() => app.remote.disable());
  const ok = await signIn(url, host);
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers['set-cookie'][0]), /HttpOnly/);
  assert.match(String(ok.headers['set-cookie'][0]), /SameSite=Strict/);
  const cookie = cookieOf(ok);
  const authed = { host, cookie };
  const page = await lan(url, { path: '/src/ui/index.html', headers: authed });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /name="bunny-token"/, 'no launch token for another device');
  assert.match(page.text, /name="bunny-csrf" content="[a-f0-9]{48}"/);
  assert.match(page.text, /\/src\/ui\/remote\.js/);
  const localToken = /name="bunny-token" content="([a-f0-9]+)"/.exec(await (await fetch(`${base}/src/ui/index.html`)).text())?.[1];
  if (localToken) assert.doesNotMatch(page.text, new RegExp(localToken));
  assert.equal((await lan(url, { path: '/api/sessions', headers: authed })).status, 200);
  assert.equal((await lan(url, { path: '/', headers: authed })).status, 302, 'the signed-in "/" goes to the app');
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const noCsrf = await lan(url, { method: 'POST', path: '/api/sessions', headers: { ...authed, origin: `http://${host}` }, body: { title: 'x' } });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.json().code, 'request.csrf');
  const wrongCsrf = await lan(url, { method: 'POST', path: '/api/sessions', headers: { ...authed, origin: `http://${host}`, 'x-bunny-csrf': 'f'.repeat(48) }, body: { title: 'x' } });
  assert.equal(wrongCsrf.status, 403);
  const made = await lan(url, { method: 'POST', path: '/api/sessions', headers: { ...authed, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body: { title: 'From my phone', folder: 'C:\\Users', permissionMode: 'auto', workMode: 'code' } });
  assert.equal(made.status, 200);
  assert.equal(made.json().workMode, 'code', 'the device chooses the work mode');
  assert.equal(made.json().folder, null, 'but never a folder: only the window picks one');
  assert.equal(made.json().permissionMode, 'auto', 'and the mode of its own chat');
});

test('another device still never changes what Bunny may do: rules, the default mode, connectors, installs, skills, schedules, providers, the terminal, computer, folders and /api/remote are refused with the window sentence', async (t) => {
  const { url, host, app } = await opened(t);
  t.after(() => app.remote.disable());
  const ok = await signIn(url, host);
  const authed = { host, cookie: cookieOf(ok), origin: `http://${host}` };
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie: cookieOf(ok) } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  for (const [method, path, body] of [
    ['PUT', '/api/settings', { permissionRules: {} }], ['PUT', '/api/settings', { defaultPermissionMode: 'auto' }], ['PUT', '/api/settings', { theme: 'dark' }], ['PUT', '/api/permission-rules', { global: {} }],
    ['POST', '/api/mcp', { name: 'x', url: 'https://x.test/mcp' }], ['POST', '/api/plugins/install', { url: 'a/b' }], ['POST', '/api/skills', { name: 'x', instructions: 'y' }], ['POST', '/api/schedules', {}], ['POST', '/api/hooks', {}],
    ['POST', '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000' }], ['POST', '/api/terminal/create', {}], ['POST', '/api/computer/click', { x: 1, y: 1 }],
    ['PUT', '/api/remote', { enabled: false }], ['POST', '/api/remote/signout-all', {}], ['POST', '/api/folder/check', { folder: 'C:\\' }], ['POST', '/api/update/check', {}],
  ]) {
    for (const withCsrf of [false, true]) {
      const r = await lan(url, { method, path, headers: { ...authed, ...(withCsrf ? { 'x-bunny-csrf': csrf } : {}) }, body });
      assert.equal(r.status, 403, `${method} ${path} ${withCsrf}`);
      if (withCsrf) assert.equal(r.json().message, "Change this in Bunny's window.", `${method} ${path}`);
    }
  }
  for (const path of ['/api/terminal/read', '/api/account', '/api/remote', '/api/computer/screenshot']) assert.equal((await lan(url, { path, headers: { host, cookie: cookieOf(ok) } })).status, 403, path);
  void id;
});
test('the window can see who is signed in and end sessions; ending one signs that device out at once; turning it off closes the port and ends all', async (t) => {
  const { url, host, base, app } = await opened(t);
  const first = cookieOf(await signIn(url, host));
  const second = cookieOf(await signIn(url, host));
  let status = await (await fetch(`${base}/api/remote`)).json();
  assert.equal(status.signedIn, 2);
  assert.equal(status.devices.length, 2);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(first.split('=')[1]));
  const gone = await fetch(`${base}/api/remote/devices/${status.devices[0].id}/signout`, { method: 'POST' });
  assert.equal(gone.status, 200);
  assert.equal((await lan(url, { path: '/api/sessions', headers: { host, cookie: first } })).status, 401, 'the first device is signed out');
  assert.equal((await lan(url, { path: '/api/sessions', headers: { host, cookie: second } })).status, 200);
  // a device can sign itself out too
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie: second } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const out = await lan(url, { method: 'POST', path: '/api/remote/signout', headers: { host, cookie: second, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body: {} });
  assert.equal(out.status, 200);
  assert.match(String(out.headers['set-cookie'][0]), /Max-Age=0/);
  assert.equal((await lan(url, { path: '/api/sessions', headers: { host, cookie: second } })).status, 401);
  // sign out all, then off
  await signIn(url, host);
  const all = await fetch(`${base}/api/remote/signout-all`, { method: 'POST' });
  assert.equal((await all.json()).signedIn, 0);
  await signIn(url, host);
  const off = await (await put(base, { enabled: false })).json();
  assert.equal(off.enabled, false);
  await assert.rejects(() => lan(url, { path: '/', headers: { host } }), /ECONNREFUSED|ECONNRESET/, 'the port is closed');
  assert.equal(app.remote.count(), 0);
});

test('the 127.0.0.1 server keeps its own rules: with the guard on, a request for the LAN host is still refused there, and window-only still needs the window', async (t) => {
  const started = await startApp(t, { lanAddress: '127.0.0.1', localGuard: true, folderPickerOnly: true });
  const local = new URL(started.base);
  const bad = await lan(started.base, { path: '/api/health', headers: { host: '192.168.1.20:' + local.port } });
  assert.equal(bad.status, 403);
  assert.equal(bad.json().code, 'request.badHost');
  const put403 = await lan(started.base, { method: 'PUT', path: '/api/remote', headers: { host: `127.0.0.1:${local.port}` }, body: { enabled: true, passcode: PASS } });
  assert.equal(put403.status, 403, 'no launch token: refused');
});

// ---------------------------------------------------------------- full chats from another device (the owner's decision, 2026-11-18)
import { createServer as createProvider } from 'node:http';

/** A request whose answer is read as it arrives (a reply stream), so a card can be answered while the reply is still open. */
function lanStream(url, { path, headers, body }, onEvent) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let buf = '';
      let all = '';
      res.on('data', async (c) => {
        buf += c; all += c;
        for (;;) {
          const end = buf.indexOf('\n\n');
          if (end < 0) break;
          const block = buf.slice(0, end); buf = buf.slice(end + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name) { try { await onEvent(name, data ? JSON.parse(data) : null); } catch (e) { reject(e); } }
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, text: all }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('a signed-in device runs a tool call in its chat, answers the permission and capability cards itself, and chooses the mode of its chat', async (t) => {
  const provider = createProvider((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const told = body.messages.find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = told ? { content: `got: ${String(told.content).slice(0, 120)}` } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_skill', arguments: JSON.stringify({ name: 'tidy', description: 'd', instructions: 'Keep it tidy.' }) } }] };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { url, host, base, app } = await opened(t, { fake: false });
  t.after(() => app.remote.disable());
  await fetch(`${base}/api/providers/openai/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` }) });
  const ok = await signIn(url, host);
  const cookie = cookieOf(ok);
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const w = { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf };
  // it starts a chat in Ask mode, then switches the mode of that chat (a per-chat choice a device may make)
  const made = await lan(url, { method: 'POST', path: '/api/sessions', headers: w, body: { title: 'Phone chat', permissionMode: 'ask' } });
  const id = made.json().id;
  const mode = await lan(url, { method: 'PATCH', path: `/api/sessions/${id}/setting/permissionMode`, headers: w, body: { value: 'ask' } });
  assert.equal(mode.status, 200, mode.text);
  // it sends a message; the reply asks for permission; the device itself answers the card
  const seen = [];
  const reply = await lanStream(url, { path: `/api/sessions/${id}/messages`, headers: w, body: { content: 'add a skill called tidy', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' } }, async (name, data) => {
    seen.push(name);
    if (name === 'permission') {
      const answered = await lan(url, { method: 'POST', path: `/api/sessions/${id}/permission/${data.id}`, headers: w, body: { allowed: true } });
      assert.equal(answered.status, 200, answered.text);
    }
    if (name === 'capability') {
      const answered = await lan(url, { method: 'POST', path: `/api/sessions/${id}/capability/${data.id}`, headers: w, body: { granted: false } });
      assert.equal(answered.status, 200, answered.text);
    }
  });
  assert.ok(seen.includes('permission'), `a permission card was shown to the device: ${seen.join(',')}`);
  assert.match(reply.text, /got: /, 'the tool ran after the device allowed it');
  assert.equal((await fetch(`${base}/api/skills`).then((r) => r.json())).some((s) => s.name === 'tidy'), true, 'the tool really ran on this computer');
  // a card for a chat that does not exist, or one that is not waiting, is not answered
  const none = await lan(url, { method: 'POST', path: `/api/sessions/${id}/permission/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f`, headers: w, body: { allowed: true } });
  assert.equal(none.status, 404);
  // and it cannot change what Bunny may do: the default mode, rules and connectors stay the window's
  for (const [method, path, body] of [['PUT', '/api/settings', { defaultPermissionMode: 'auto' }], ['PUT', '/api/permission-rules', { global: { allow: ['run_command'] } }], ['POST', '/api/mcp', { name: 'x', url: 'https://x.test/mcp' }]]) {
    const r = await lan(url, { method, path, headers: w, body });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.json().message, "Change this in Bunny's window.");
  }
  // with no cookie none of this is possible
  const stranger = await lan(url, { method: 'POST', path: `/api/sessions/${id}/permission/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f`, headers: { host, origin: `http://${host}` }, body: { allowed: true } });
  assert.equal(stranger.status, 401);
  const noCsrf = await lan(url, { method: 'POST', path: `/api/sessions/${id}/permission/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f`, headers: { host, cookie, origin: `http://${host}` }, body: { allowed: true } });
  assert.equal(noCsrf.status, 403);
});

test('a signed-in device can answer a question card of a chat too (the route is not refused for it)', async (t) => {
  const { url, host, app } = await opened(t);
  t.after(() => app.remote.disable());
  const cookie = cookieOf(await signIn(url, host));
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  const r = await lan(url, { method: 'POST', path: `/api/sessions/${id}/question/${id}`, headers: { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body: { choices: ['x'] } });
  assert.equal(r.status, 404, 'answered by the route (nothing is waiting there), not refused as window-only');
  assert.notEqual(r.json()?.message, "Change this in Bunny's window.");
});
