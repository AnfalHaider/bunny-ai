import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COOKIE, FAILS_BEFORE_WAIT, FLOOD_LIMIT, checkPasscodeChoice, createRemoteAccess, deviceLabel, findLanAddress, generatePasscode, hashPasscode, readCookie, remoteBody, remoteException, remotePolicy, verifyPasscode,
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

/** A model stand-in: scripted by what the person's message says (WRITE: write a file; SKILL: add a skill; CAP: ask for computer use). Records the tools it was offered. */
async function scriptedProvider(t) {
  const offered = [];
  const provider = createProvider((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      offered.push((body.tools ?? []).map((d) => d.function.name));
      const last = [...body.messages].reverse().find((m) => m.role === 'user');
      const said = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
      const told = [...body.messages].reverse().find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = /WRITE/.test(said) ? { name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'hello from a device' }) }
        : /SKILL/.test(said) ? { name: 'add_skill', arguments: JSON.stringify({ name: 'tidy', description: 'd', instructions: 'Keep it tidy.' }) }
        : /SCHED/.test(said) ? { name: 'schedule_task', arguments: JSON.stringify({ name: 'nightly', prompt: 'do something every night', every_minutes: 60 }) }
        : /REMEMBER/.test(said) ? { name: 'remember', arguments: JSON.stringify({ text: 'a fact from a device' }) }
        : /CAP/.test(said) ? { name: 'request_capability', arguments: JSON.stringify({ capability: 'computer_use', reason: 'to click' }) } : null;
      const delta = told || !call ? { content: 'got: ' + String(told?.content ?? 'nothing').slice(0, 160) } : { tool_calls: [{ index: 0, id: 'c1', function: call }] };
      res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  return { port: provider.address().port, offered };
}

async function deviceSetup(t) {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const folder = await mkdtemp(join(tmpdir(), 'bunny-remote-folder-'));
  const provider = await scriptedProvider(t);
  const opened_ = await opened(t, { fake: false });
  t.after(() => opened_.app.remote.disable());
  await fetch(opened_.base + '/api/providers/openai/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: 'http://127.0.0.1:' + provider.port + '/v1' }) });
  const { url, host } = opened_;
  const cookie = cookieOf(await signIn(url, host));
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  const w = { host, cookie, origin: 'http://' + host, 'x-bunny-csrf': csrf };
  return { ...opened_, folder, provider, cookie, w };
}
const modelBody = (content) => ({ content, providerId: 'openai', model: 'gpt-4o' });

test('a signed-in device works in a chat of the window\'s (its folder and tools), answers its permission card itself, and the file really is written', async (t) => {
  const d = await deviceSetup(t);
  // a chat made in the window, in Code mode in a folder, asking before it writes
  const made = await (await fetch(d.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Window chat', workMode: 'code', folder: d.folder, permissionMode: 'ask' }) })).json();
  const cards = [];
  const reply = await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please WRITE a note') }, async (name, data) => {
    cards.push(name);
    if (name === 'permission') {
      const answered = await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + data.id, headers: d.w, body: { allowed: true } });
      assert.equal(answered.status, 200, answered.text);
    }
  });
  assert.ok(cards.includes('permission'), 'the permission card reached the device: ' + cards.join(','));
  assert.match(reply.text, /got: /);
  assert.equal(await readFile(join(d.folder, 'note.txt'), 'utf8'), 'hello from a device', 'the tool really ran on this computer, after the device allowed it');
  // a card for another or unknown id is not answered; no cookie 401; no CSRF 403
  const unknown = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  assert.equal((await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + unknown, headers: d.w, body: { allowed: true } })).status, 404);
  assert.equal((await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + unknown, headers: { host: d.host, origin: 'http://' + d.host }, body: {} })).status, 401);
  assert.equal((await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + unknown, headers: { host: d.host, cookie: d.cookie, origin: 'http://' + d.host }, body: {} })).status, 403);
});

test('R2: a device chat, even in Auto, is never offered computer, build, install, connector or skill tools, and cannot call them', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', permissionMode: 'auto' } })).json();
  const reply = await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please SKILL add one') }, async () => {});
  const offered = d.provider.offered.flat();
  assert.ok(offered.length > 0, 'the chat had tools');
  const { REMOTE_TOOLS_ALLOWED } = await import('../src/server/remoteAccess.js');
  for (const name of offered) assert.ok(REMOTE_TOOLS_ALLOWED.includes(name), name + ' is not on the device allow-list');
  assert.match(reply.text, /not available in a chat from another device|no tool called/i, 'a call anyway is refused: ' + reply.text.slice(0, 300));
  assert.equal((await (await fetch(d.base + '/api/skills')).json()).some((x) => x.name === 'tidy'), false, 'no skill was added to this computer');
  // the window's own chat does have that tool
  const own = await (await fetch(d.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Window', permissionMode: 'ask' }) })).json();
  const before = d.provider.offered.length;
  await fetch(d.base + '/api/sessions/' + own.id + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modelBody('hello')) }).then((r) => r.text());
  assert.ok(d.provider.offered.slice(before).flat().includes('add_skill'), 'the window\'s chat still offers add_skill');
});

test('R9: a device chat\'s scripted schedule_task and remember calls (even in Auto) create no schedule and save no memory; the window\'s chat can', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', permissionMode: 'auto' } })).json();
  const schedules = async () => (await (await fetch(d.base + '/api/schedules')).json());
  const memories = async () => JSON.stringify(await (await fetch(d.base + '/api/memory')).json());
  const before = [(await schedules()).length, await memories()];
  for (const word of ['SCHED', 'REMEMBER']) {
    const reply = await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please ' + word + ' now') }, async () => {});
    assert.match(reply.text, /not available in a chat from another device/, word + ': ' + reply.text.slice(0, 200));
  }
  assert.deepEqual([(await schedules()).length, await memories()], before, 'no schedule was created and nothing was remembered');
  const offered = d.provider.offered.flat();
  for (const name of ['schedule_task', 'list_scheduled_tasks', 'remember', 'start_session', 'message_session', 'move_to_new_chat']) assert.equal(offered.includes(name), false, name + ' is not offered to a device chat');
  // the window's own chat is offered them
  const own = await (await fetch(d.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Window', permissionMode: 'ask' }) })).json();
  const mark = d.provider.offered.length;
  await fetch(d.base + '/api/sessions/' + own.id + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modelBody('hello')) }).then((r) => r.text());
  const ownOffered = d.provider.offered.slice(mark).flat();
  assert.ok(ownOffered.includes('schedule_task') || ownOffered.includes('remember') || ownOffered.includes('start_session'), 'the window chat still has these tools: ' + ownOffered.slice(0, 40).join(','));
});

test('R1: a device answers code_mode and leave_plan_mode cards but never computer_use, custom_tools or switch_on_added: the window still can', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', permissionMode: 'ask' } })).json();
  let refused = null;
  await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please CAP now') }, async (name, data) => {
    if (name !== 'capability') return;
    assert.equal(data.capability, 'computer_use');
    refused = await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/capability/' + data.id, headers: d.w, body: { granted: true } });
    // the window itself may answer it
    const ok = await fetch(d.base + '/api/sessions/' + made.id + '/capability/' + data.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ granted: false }) });
    assert.equal(ok.status, 200);
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.json().message, "Change this in Bunny's window.");
  const { REMOTE_CAPABILITIES } = await import('../src/server/remoteAccess.js');
  assert.deepEqual([...REMOTE_CAPABILITIES], ['code_mode', 'leave_plan_mode']);
});

test('R3: a device cannot attach a folder, project or anything else to a chat; only the chat\'s own title, modes, effort, model and provider change', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', folder: d.folder, projectId: 'p', branch: 'x', pinned: true, agent: 'helper' } })).json();
  assert.deepEqual([made.folder, made.projectId, made.branch, made.pinned, made.agent], [null, null, null, false, undefined]);
  const patched = await lan(d.url, { method: 'PATCH', path: '/api/sessions/' + made.id, headers: d.w, body: { title: 'Renamed', folder: d.folder, projectId: 'p', branch: 'x', pinned: true, archived: true, permissionMode: 'plan', effort: 'high' } });
  assert.equal(patched.status, 200, patched.text);
  const after = await (await fetch(d.base + '/api/sessions/' + made.id)).json();
  assert.deepEqual([after.title, after.permissionMode, after.effort], ['Renamed', 'plan', 'high']);
  assert.deepEqual([after.folder, after.projectId, after.branch, after.pinned, after.archived], [null, null, null, false, false], 'nothing else was changed');
  for (const key of ['folder', 'branch', 'projectId', 'pinned']) {
    const r = await lan(d.url, { method: 'PATCH', path: '/api/sessions/' + made.id + '/setting/' + key, headers: d.w, body: { value: d.folder } });
    assert.equal(r.status, 403, key);
  }
  const mode = await lan(d.url, { method: 'PATCH', path: '/api/sessions/' + made.id + '/setting/permissionMode', headers: d.w, body: { value: 'ask' } });
  assert.equal(mode.status, 200);
  // a message body is an allow-list too: a folder or a scheduled-task switch in it changes nothing
  const { remoteBody } = await import('../src/server/remoteAccess.js');
  assert.deepEqual(Object.keys(remoteBody('/api/sessions/x/messages', { content: 'hi', folder: 'C:\\', scheduledTask: 'x', textOnly: true, browserControl: true, vision: false, useSkill: 'a', model: 'm', providerId: 'p', workMode: 'chat', retry: true, attachments: [] })).sort(), ['attachments', 'content', 'model', 'providerId', 'retry', 'useSkill', 'vision', 'workMode']);
});

test('R4: a device reads display settings only: no instructions, no keys or secrets, no memory, no skills', async (t) => {
  const d = await deviceSetup(t);
  await fetch(d.base + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'dark', instructions: 'private standing instructions', branchPrefix: 'secretprefix', defaultPermissionMode: 'auto' }) });
  const seen = await lan(d.url, { path: '/api/settings', headers: { host: d.host, cookie: d.cookie } });
  assert.equal(seen.status, 200);
  assert.equal(seen.json().theme, 'dark');
  assert.doesNotMatch(seen.text, /private standing|secretprefix|googleClientSecret|clientSecret|defaultPermissionMode|permissionRules|apiKey|token/i);
  for (const path of ['/api/memory', '/api/skills', '/api/mcp', '/api/hooks', '/api/schedules']) assert.equal((await lan(d.url, { path, headers: { host: d.host, cookie: d.cookie } })).status, 403, path);
});

test('R6: a chat a device puts on Auto is marked in the window and goes back to Ask when that device signs out, when the setting is turned off, and when Bunny starts again', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone Auto', permissionMode: 'auto' } })).json();
  const fetchJson = async (path) => (await fetch(d.base + path)).json();
  assert.equal((await fetchJson('/api/sessions/' + made.id)).permissionMode, 'auto');
  const status = await fetchJson('/api/remote');
  assert.deepEqual(status.autoChats.map((c) => c.id), [made.id], 'the window\'s status shows it');
  assert.ok((await fetchJson('/api/sessions')).find((s) => s.id === made.id).remoteAuto, 'and the chat list marks it');
  // an Auto chat made in the window is not touched
  const mine = await (await fetch(d.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Mine', permissionMode: 'auto' }) })).json();
  // sign out the device
  const device = status.devices[0];
  await fetch(d.base + '/api/remote/devices/' + device.id + '/signout', { method: 'POST' });
  await new Promise((r) => setTimeout(r, 100));
  const back = await fetchJson('/api/sessions/' + made.id);
  assert.equal(back.permissionMode, 'ask');
  assert.equal(back.remoteAuto, undefined);
  assert.equal((await fetchJson('/api/sessions/' + mine.id)).permissionMode, 'auto', 'the window\'s own Auto chat stays');
  // switching it back to Ask from the device clears the mark; turning the setting off puts a new Auto chat back too
  const cookie2 = cookieOf(await signIn(d.url, d.host));
  const page2 = await lan(d.url, { path: '/src/ui/index.html', headers: { host: d.host, cookie: cookie2 } });
  const w2 = { host: d.host, cookie: cookie2, origin: 'http://' + d.host, 'x-bunny-csrf': /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page2.text)[1] };
  const second = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: w2, body: { title: 'Again', permissionMode: 'auto' } })).json();
  await fetch(d.base + '/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await fetchJson('/api/sessions/' + second.id)).permissionMode, 'ask', 'turning it off puts it back');
});

test('R7: a device that is idle for two hours is signed out', async () => {
  let t = 1;
  const ended = [];
  const r = createRemoteAccess({ now: () => t, onEnd: (ids) => ended.push(ids) });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  const a = await r.signIn('10.0.0.2', PASS);
  t += 119 * 60 * 1000;
  assert.ok(r.sessionFor(COOKIE + '=' + a.secret), 'still in after 119 minutes (and this use renews it)');
  t += 121 * 60 * 1000;
  assert.equal(r.sessionFor(COOKIE + '=' + a.secret), null, 'out after 2 hours without use');
  assert.equal(ended.length, 1, 'the app is told, so the device\'s Auto chats go back to Ask');
  // and with nobody calling again, a count or the sweep (a timer in the app) still ends an idle session and tells the app
  await r.signIn('10.0.0.3', PASS);
  t += 121 * 60 * 1000;
  assert.equal(r.count(), 0, 'a count never includes an idle session');
  assert.equal(ended.length, 2);
  await r.signIn('10.0.0.4', PASS);
  t += 121 * 60 * 1000;
  assert.equal(r.sweep(), 1);
  assert.equal(ended.length, 3);
});

test('R2 (allow-list): every tool Bunny has is classified for devices (allowed or denied) so a new tool cannot be added without a decision; what was denied stays denied; unknown tools are denied', async () => {
  const { REMOTE_TOOLS_ALLOWED, REMOTE_TOOLS_DENIED, remoteToolBlocked } = await import('../src/server/remoteAccess.js');
  const at = await import('../src/server/agentTools.js');
  const ap = await import('../src/server/appTools.js');
  const { browserToolDefinitions } = await import('../src/server/browserTools.js');
  const { githubToolDefinitions } = await import('../src/server/github.js');
  const { googleToolDefinitions } = await import('../src/server/google.js');
  const { workspaceToolDefinitions } = await import('../src/server/workspace.js');
  const all = ['read', 'edit', 'run', 'build', 'send'];
  const names = new Set();
  const add = (defs) => defs.forEach((d) => names.add(d.function.name));
  add(at.artifactToolDefinitions()); add(at.processToolDefinitions(all)); add(at.computerToolDefinitions(all)); add(at.teamToolDefinitions({ canDelegate: true })); add(at.memoryToolDefinitions({ memory: true }));
  add(ap.appToolDefinitions(all)); add(browserToolDefinitions(all)); add(githubToolDefinitions(all, { canClone: true })); add(googleToolDefinitions(all)); add(workspaceToolDefinitions(all));
  // every single-definition export of the agent tools too (a new "...ToolDefinition" function is picked up by this loop)
  for (const [key, fn] of Object.entries(at)) if (/ToolDefinition$/.test(key) && typeof fn === 'function') add([fn()]);
  assert.ok(names.size > 50, 'the registry was read: ' + names.size + ' tools');
  const allowed = new Set(REMOTE_TOOLS_ALLOWED);
  const denied = new Set(REMOTE_TOOLS_DENIED);
  assert.deepEqual([...allowed].filter((n) => denied.has(n)), [], 'no tool is on both lists');
  const undecided = [...names].filter((n) => !allowed.has(n) && !denied.has(n));
  assert.deepEqual(undecided, [], 'a tool was added without a decision for devices: add it to REMOTE_TOOLS_ALLOWED or REMOTE_TOOLS_DENIED in src/server/remoteAccess.js');
  for (const n of names) assert.equal(remoteToolBlocked(n), !allowed.has(n), n);
  // what was denied before stays denied
  for (const n of ['computer_click', 'computer_key', 'computer_type', 'create_tool', 'install_plugin', 'install_from_github', 'add_connector', 'add_skill', 'schedule_task', 'list_scheduled_tasks', 'start_session', 'message_session', 'move_to_new_chat', 'remember']) assert.equal(remoteToolBlocked(n), true, n);
  // anything not named (a connector's tool, a tool the model built, a future tool) is denied by default
  for (const n of ['my_tool', 'notes__search', 'some_future_tool', 'call_connector_tool', 'list_connector_tools', '', null, undefined]) assert.equal(remoteToolBlocked(n), true, String(n));
  // and the ordinary work tools are allowed
  for (const n of ['web_search', 'read_url', 'read_file', 'write_file', 'run_command', 'ask_user', 'create_artifact', 'request_capability', 'run_subagent']) assert.equal(remoteToolBlocked(n), false, n);
});

test('R5: the turn-on warning says plainly that this is plain HTTP, home networks only, and Private networks only at the firewall', async () => {
  const page = await readFile(new URL('../src/ui/settings.html', import.meta.url), 'utf8');
  assert.match(page, /plain HTTP/);
  assert.match(page, /could take over a signed-in device and run programs on this computer/);
  assert.match(page, /only on your own home network, never on public or shared Wi-Fi/);
  assert.match(page, /Private networks only<\/b>, never Public/);
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

test('a device picks a model for ITS chat through the chat\'s own routes (PATCH setting/providerId and /model), and cannot write the app\'s default model', async (t) => {
  const d = await deviceSetup(t);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone' } })).json();
  const a = await lan(d.url, { method: 'PATCH', path: '/api/sessions/' + made.id + '/setting/providerId', headers: d.w, body: { value: 'openai' } });
  const b = await lan(d.url, { method: 'PATCH', path: '/api/sessions/' + made.id + '/setting/model', headers: d.w, body: { value: 'gpt-4o' } });
  assert.deepEqual([a.status, b.status], [200, 200], a.text + b.text);
  const after = await (await fetch(d.base + '/api/sessions/' + made.id)).json();
  assert.deepEqual([after.providerId, after.model], ['openai', 'gpt-4o'], 'that chat now uses the model the device chose');
  // the app's default model is a settings write: still the window's
  const settingsBefore = await (await fetch(d.base + '/api/settings')).json();
  const put = await lan(d.url, { method: 'PUT', path: '/api/settings', headers: d.w, body: { providerId: 'openai', model: 'other-model' } });
  assert.equal(put.status, 403);
  assert.equal((await (await fetch(d.base + '/api/settings')).json()).model, settingsBefore.model, 'the default model did not change');
});

test('RA-1: tries that arrive together count together: 60 parallel wrong passcodes from one device get at most 5 checks, the rest wait; a right one still works after the wait', async () => {
  let t = 9_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  const results = await Promise.all(Array.from({ length: 60 }, () => r.signIn('10.0.0.9', 'wrong wrong wrong')));
  const checked = results.filter((x) => x.status === 401);
  const waiting = results.filter((x) => x.status === 429);
  assert.equal(checked.length, FAILS_BEFORE_WAIT, 'only the 5 tries the device has were checked');
  assert.equal(waiting.length, 55);
  assert.ok(waiting.every((x) => x.waitSeconds > 0));
  // the device is now waiting; even the right passcode waits; another device is not affected
  assert.equal((await r.signIn('10.0.0.9', PASS)).status, 429);
  assert.equal((await r.signIn('10.0.0.77', PASS)).ok, true);
  t += 31_000;
  assert.equal((await r.signIn('10.0.0.9', PASS)).ok, true, 'a right passcode after the wait works');
});

test('RA-1: fewer in flight than the limit: the first few parallel tries are all checked (a right one among them signs in), none more than the limit', async () => {
  const r = createRemoteAccess({ now: () => 1 });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  const results = await Promise.all([r.signIn('10.0.0.4', 'wrong wrong wrong'), r.signIn('10.0.0.4', PASS), r.signIn('10.0.0.4', 'wrong wrong wrong')]);
  assert.deepEqual(results.map((x) => x.status ?? 200), [401, 200, 401]);
  assert.equal(results[1].ok, true);
});

test('RA-1: the flood limit counts tries in flight too: 60 parallel wrong tries from 60 devices get at most 31 checks; after the minute a right one works', async () => {
  let t = 7_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  const results = await Promise.all(Array.from({ length: 60 }, (_, i) => r.signIn(`10.0.1.${i}`, 'wrong wrong wrong')));
  const checked = results.filter((x) => x.status === 401).length;
  assert.ok(checked <= FLOOD_LIMIT + 1, `at most ${FLOOD_LIMIT + 1} tries were checked, not ${checked}`);
  assert.ok(checked >= FLOOD_LIMIT, `and the first ones were not refused early (${checked})`);
  assert.equal(results.filter((x) => x.status === 429).length, 60 - checked);
  assert.equal((await r.signIn('10.0.2.1', PASS)).status, 429, 'everyone waits');
  t += 61_000;
  assert.equal((await r.signIn('10.0.2.1', PASS)).ok, true, 'after the minute a right passcode works');
});

// ---------------------------------------------------------------- DEVICE-FULL: the level a device is given (only by the window)
const deviceId = (d) => d.app.remote.list()[0].id;
const setLevel = (d, level, id = deviceId(d)) => fetch(`${d.base}/api/remote/devices/${id}/level`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level }) });

test('DEVICE-FULL: a new device starts at Chats; only the window sets a level (a device cannot, with or without the CSRF token); a bad level or an unknown device is refused', async (t) => {
  const d = await deviceSetup(t);
  const status = await (await fetch(d.base + '/api/remote')).json();
  assert.deepEqual([status.devices[0].level, status.anyEverything], ['chats', false]);
  for (const withCsrf of [false, true]) {
    const r = await lan(d.url, { method: 'PATCH', path: `/api/remote/devices/${deviceId(d)}/level`, headers: withCsrf ? d.w : { host: d.host, cookie: d.cookie, origin: 'http://' + d.host }, body: { level: 'everything' } });
    assert.equal(r.status, 403, 'csrf ' + withCsrf);
  }
  assert.equal(d.app.remote.list()[0].level, 'chats', 'still Chats');
  assert.equal((await setLevel(d, 'root')).status, 400);
  assert.equal((await setLevel(d, 'everything', 'abababababababab')).status, 404);
  const ok = await setLevel(d, 'everything');
  assert.equal(ok.status, 200);
  const after = await ok.json();
  assert.deepEqual([after.devices[0].level, after.anyEverything], ['everything', true], 'the window is told');
  assert.equal((await (await setLevel(d, 'chats')).json()).anyEverything, false);
});

test('DEVICE-FULL: a device at Chats is unchanged (settings, installs and /api/remote stay refused)', async (t) => {
  const d = await deviceSetup(t);
  for (const [method, path, body] of [['PUT', '/api/settings', { defaultPermissionMode: 'auto' }], ['POST', '/api/skills', { name: 'x', instructions: 'y' }], ['GET', '/api/remote', null]]) {
    assert.equal((await lan(d.url, { method, path, headers: d.w, body })).status, 403, method + ' ' + path);
  }
});

test('DEVICE-FULL: a device at Everything does what the window does (every setting, installs, every tool in a chat), but never /api/remote*', async (t) => {
  const d = await deviceSetup(t);
  assert.equal((await setLevel(d, 'everything')).status, 200);
  // settings, including the keys that are the window's
  const saved = await lan(d.url, { method: 'PUT', path: '/api/settings', headers: d.w, body: { defaultPermissionMode: 'auto', theme: 'dark' } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal((await (await fetch(d.base + '/api/settings')).json()).defaultPermissionMode, 'auto', 'it really changed on this computer');
  const full = await lan(d.url, { path: '/api/settings', headers: { host: d.host, cookie: d.cookie } });
  const windowKeys = Object.keys(await (await fetch(d.base + '/api/settings')).json()).sort();
  assert.deepEqual(Object.keys(full.json()).sort(), windowKeys, 'all settings are read, the same as the window');
  assert.equal(full.json().defaultPermissionMode, 'auto', 'a setting that is only the window has is readable');
  // an install-class route
  const skill = await lan(d.url, { method: 'POST', path: '/api/skills', headers: d.w, body: { name: 'from-device', description: 'd', instructions: 'Keep it tidy.' } });
  assert.ok([200, 201].includes(skill.status), skill.status + ' ' + skill.text);
  // a tool the allow-list denies, in a chat in Auto, really runs
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', permissionMode: 'auto' } })).json();
  const deviceChat = d.provider.offered.length;
  const cards = [];
  await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please SKILL add one') }, async (name, data) => {
    cards.push(name);
    if (name === 'permission') assert.equal((await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + data.id, headers: d.w, body: { allowed: true } })).status, 200);
    if (name === 'capability') assert.equal((await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/capability/' + data.id, headers: d.w, body: { allowed: true } })).status, 200, 'the device answers the card: ' + JSON.stringify(data));
  });
  assert.equal((await (await fetch(d.base + '/api/skills')).json()).some((x) => x.name === 'tidy'), true, 'add_skill ran for the device');
  const deviceTools = [...new Set(d.provider.offered[deviceChat])].sort();
  // it is offered exactly the tools the window's own chat is offered (connector, computer_*, install_*, schedules, memory ...)
  const own = await (await fetch(d.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Window', permissionMode: 'auto' }) })).json();
  const before = d.provider.offered.length;
  await fetch(d.base + '/api/sessions/' + own.id + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modelBody('hello')) }).then((r) => r.text());
  const windowTools = [...new Set(d.provider.offered[before])].sort();
  for (const n of ['add_skill', 'schedule_task', 'remember']) assert.ok(deviceTools.includes(n), n + ' is offered to the device');
  assert.deepEqual(deviceTools, windowTools, 'the same tools as the window\'s chat');
});

test('DEVICE-FULL: even at Everything a device cannot touch /api/remote* (no level, not even its own; no turning access off; no list; no signing out other devices); it can sign itself out', async (t) => {
  const d = await deviceSetup(t);
  assert.equal((await setLevel(d, 'everything')).status, 200);
  assert.equal((await signIn(d.url, d.host)).status, 200); // a second device
  const me = deviceId(d);
  const otherId = d.app.remote.list().find((x) => x.id !== me).id;
  for (const [method, path, body] of [
    ['PATCH', `/api/remote/devices/${me}/level`, { level: 'everything' }], ['PATCH', `/api/remote/devices/${otherId}/level`, { level: 'everything' }], ['PATCH', `/api/remote/devices/${me}/level`, { level: 'chats' }],
    ['PUT', '/api/remote', { enabled: false }], ['PUT', '/api/remote', { enabled: true, passcode: 'another passcode 12' }], ['POST', '/api/remote/signout-all', {}], ['POST', `/api/remote/devices/${otherId}/signout`, {}], ['GET', '/api/remote', null], ['DELETE', '/api/remote', {}],
  ]) {
    const r = await lan(d.url, { method, path, headers: d.w, body });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  assert.equal(d.app.remote.enabled, true);
  assert.equal(d.app.remote.list().length, 2, 'nobody was signed out');
  assert.equal(d.app.remote.list().find((x) => x.id === me).level, 'everything', 'the level is as the window set it');
  // it may sign itself out
  const out = await lan(d.url, { method: 'POST', path: '/api/remote/signout', headers: d.w, body: {} });
  assert.equal(out.status, 200);
  assert.equal(d.app.remote.list().some((x) => x.id === me), false);
});

test('DEVICE-FULL: the level ends with sign-out and with turning device access off: the next sign-in is at Chats again', async (t) => {
  const d = await deviceSetup(t);
  assert.equal((await setLevel(d, 'everything')).status, 200);
  d.app.remote.signOutDevice(deviceId(d));
  assert.equal((await signIn(d.url, d.host)).status, 200);
  assert.equal(d.app.remote.list()[0].level, 'chats', 'a new sign-in is Chats');
  assert.equal((await setLevel(d, 'everything')).status, 200);
  d.app.remote.disable();
  assert.equal(d.app.remote.anyEverything(), false, 'no session, no level');
});

test('DEVICE-FULL: the level route is window-only (in the server\'s list and the page\'s copy), and what even Everything never reaches is exactly /api/remote*', async () => {
  const { isWindowOnlyRoute } = await import('../src/server/windowOnly.js');
  const { isRemoteAdminPath } = await import('../src/server/remoteAccess.js');
  const page = await import('../src/ui/api.js').catch(() => null);
  const path = '/api/remote/devices/0123456789abcdef/level';
  assert.equal(isWindowOnlyRoute('PATCH', path), true);
  if (page?.isWindowOnlyRoute) assert.equal(page.isWindowOnlyRoute('PATCH', path), true, 'the page\'s copy agrees');
  for (const p of ['/api/remote', '/api/remote/', path, '/api/remote/signout-all', '/api/remote/devices/0123456789abcdef/signout']) assert.equal(isRemoteAdminPath(p), true, p);
  for (const p of ['/api/remotely', '/api/settings', '/api/sessions', '/api/remoteX/y']) assert.equal(isRemoteAdminPath(p), false, p);
});

// ---------------------------------------------------------------- DEVICE-FULL: Security's R-DF1 / R-DF2 / R-DF3
test('R-DF3: the encoded spelling of /api/remote is refused like the plain one, for a device at Everything', async (t) => {
  const d = await deviceSetup(t);
  assert.equal((await setLevel(d, 'everything')).status, 200);
  for (const [method, path, body] of [
    ['PATCH', `/api/%72emote/devices/${deviceId(d)}/level`, { level: 'chats' }], ['PUT', '/api/%72emote', { enabled: false }], ['POST', '/api/%72emote/signout-all', {}], ['GET', '/api/%72emote/log', null], ['GET', '/api/remote%2Flog', null], ['GET', '/api/%72emote', null],
  ]) assert.equal((await lan(d.url, { method, path, headers: d.w, body })).status, 403, `${method} ${path}`);
  assert.equal(d.app.remote.enabled, true);
  assert.equal(d.app.remote.list()[0].level, 'everything', 'nothing changed');
});

test('R-DF2: the window reads what devices did (sign-in, level changes, tool names, window-only routes: no arguments, no bodies); a device at either level cannot read it', async (t) => {
  const d = await deviceSetup(t);
  const log = async () => (await (await fetch(d.base + '/api/remote/log')).json()).entries;
  // a device at Chats, then at Everything
  assert.equal((await setLevel(d, 'everything')).status, 200);
  const made = await (await lan(d.url, { method: 'POST', path: '/api/sessions', headers: d.w, body: { title: 'Phone', permissionMode: 'auto' } })).json();
  await lanStream(d.url, { path: '/api/sessions/' + made.id + '/messages', headers: d.w, body: modelBody('please WRITE a note SECRET-ARGUMENT') }, async (name, data) => {
    if (name === 'permission') await lan(d.url, { method: 'POST', path: '/api/sessions/' + made.id + '/permission/' + data.id, headers: d.w, body: { allowed: true } });
  });
  await lan(d.url, { method: 'PUT', path: '/api/settings', headers: d.w, body: { theme: 'dark', instructions: 'SECRET-BODY' } });
  const entries = await log();
  const kinds = entries.map((e) => e.kind);
  for (const k of ['signin', 'level', 'tool', 'route']) assert.ok(kinds.includes(k), k + ' is logged: ' + kinds.join(','));
  assert.ok(entries.some((e) => e.kind === 'tool' && e.tool === 'write_file'), 'the tool name');
  assert.ok(entries.some((e) => e.kind === 'route' && e.method === 'PUT' && e.path === '/api/settings'), 'the route and its method');
  assert.ok(entries.every((e) => e.device === deviceId(d) && e.label && e.at), 'time and device on each');
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|hello from a device|note\.txt/, 'no arguments, no body, no text');
  assert.ok(entries[0].at >= entries.at(-1).at, 'newest first');
  // a device cannot read it, at Everything or at Chats, plain or encoded
  for (const level of ['everything', 'chats']) {
    assert.equal((await setLevel(d, level)).status, 200);
    for (const path of ['/api/remote/log', '/api/%72emote/log']) assert.equal((await lan(d.url, { path, headers: { host: d.host, cookie: d.cookie } })).status, 403, level + ' ' + path);
  }
  assert.equal((await lan(d.url, { path: '/api/remote/log', headers: { host: d.host } })).status, 401, 'not signed in');
  // the page's and the server's window-only lists both name it
  const { isWindowOnlyRoute } = await import('../src/server/windowOnly.js');
  assert.equal(isWindowOnlyRoute('GET', '/api/remote/log'), true);
});

test('R-DF2: the log keeps the last 500 entries or 30 days', async () => {
  let t = Date.UTC(2026, 10, 1);
  const access = createRemoteAccess({ now: () => t });
  const device = { deviceId: 'abababababababab', label: 'Phone', level: 'chats' };
  for (let i = 0; i < 520; i += 1) access.logAction(device, { kind: 'tool', tool: 'read_file' });
  assert.equal((await access.actions()).length, 500);
  t += 29 * 86_400_000;
  assert.equal((await access.actions()).length, 500, 'still inside 30 days');
  t += 2 * 86_400_000;
  assert.equal((await access.actions()).length, 0, 'older than 30 days is gone');
  access.logAction(device, { kind: 'tool', tool: 'x', arguments: 'SECRET', body: 'SECRET' });
  assert.doesNotMatch(JSON.stringify(await access.actions()), /SECRET/, 'only the known fields are kept');
});

test('R-DF1: a device at Everything is signed out after 30 minutes idle; a device at Chats keeps its 2 hours', async () => {
  let t = Date.UTC(2026, 10, 1);
  const access = createRemoteAccess({ now: () => t });
  await access.enable({ lanHost: '127.0.0.1:1', lanAddress: '127.0.0.1', passcode: PASS });
  const a = await access.signIn('1.1.1.1', PASS, 'Mozilla/5.0 (iPhone)');
  const b = await access.signIn('2.2.2.2', PASS, 'Mozilla/5.0 (Android)');
  access.setLevel(a.session.deviceId, 'everything');
  t += 29 * 60_000;
  assert.ok(access.sessionFor(access.cookieFor(a.secret).split(';')[0]), 'inside 30 minutes it is signed in (and counts as use)');
  t += 31 * 60_000;
  assert.equal(access.sessionFor(access.cookieFor(a.secret).split(';')[0]), null, 'idle past 30 minutes at Everything: signed out');
  assert.ok(access.sessionFor(access.cookieFor(b.secret).split(';')[0]), 'a Chats device is still signed in after an hour');
  t += 3 * 60 * 60_000;
  assert.equal(access.sessionFor(access.cookieFor(b.secret).split(';')[0]), null, 'and after two idle hours it is not');
  assert.ok((await access.actions()).some((e) => e.kind === 'idle-signout'), 'the idle sign-out is logged');
});

test('R-DF2: after a restart a new entry is added to the saved log, never written over it', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'bunny-actions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logFile = join(dir, 'remote-actions.json');
  const device = { deviceId: 'abababababababab', label: 'Phone', level: 'chats' };
  const first = createRemoteAccess({ logFile });
  first.logAction(device, { kind: 'tool', tool: 'read_file' });
  first.logAction(device, { kind: 'tool', tool: 'list_files' });
  await first.flushLog();
  const second = createRemoteAccess({ logFile }); // Bunny restarted; nobody has read the log yet
  second.logAction(device, { kind: 'tool', tool: 'write_file' });
  await second.flushLog();
  assert.deepEqual((await second.actions()).map((e) => e.tool).sort(), ['list_files', 'read_file', 'write_file'], 'read in the same run: kept, and no entry twice');
  const names = (await createRemoteAccess({ logFile }).actions()).map((e) => e.tool).sort();
  assert.deepEqual(names, ['list_files', 'read_file', 'write_file'], 'and after another restart');
});

// ---------------------------------------------------------------- DEVICE-FULL: what the window's screens read
test('DEVICE-FULL: a device is asked about once (the window answers by setting a level, Chats too); the device learns its own level from /api/remote/me; reaching for device access at Everything says the drawn sentence', async (t) => {
  const d = await deviceSetup(t);
  const me = async () => (await lan(d.url, { path: '/api/remote/me', headers: { host: d.host, cookie: d.cookie } })).json();
  assert.equal((await (await fetch(d.base + '/api/remote')).json()).devices[0].asked, false, 'a new device has not been asked about');
  assert.equal((await me()).level, 'chats');
  assert.equal((await setLevel(d, 'chats')).status, 200); // "Keep Chats"
  assert.equal((await (await fetch(d.base + '/api/remote')).json()).devices[0].asked, true);
  assert.equal(((await d.app.remote.actions()).filter((e) => e.kind === 'level')).length, 0, 'Chats to Chats is not a change, so it is not logged');
  assert.equal((await setLevel(d, 'everything')).status, 200);
  assert.equal((await me()).level, 'everything', 'the device is told by the server, never by its page');
  const refused = await lan(d.url, { path: '/api/remote', headers: { host: d.host, cookie: d.cookie } });
  assert.equal(refused.status, 403);
  assert.equal(refused.json().message, "Only Bunny's window can change device access.");
});
