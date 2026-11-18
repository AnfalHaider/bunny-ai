import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { NOT_OPENED_NETWORK, NOT_OPENED_NO_NETWORK, canReopen, networkProfileOf } from '../src/server/remoteAccess.js';

// REMOTE-STAY (HIGH; the owner: "stay after restart"): once device access is on it stays on across restarts until the person turns it off. Security's RS-1..RS-6.
const PASS = 'correct horse battery staple';

/** Bunny started: the window's server on `port` (0 = any), the way the shell does, then resumeRemote(). */
async function start(t, dataDir, { port = 0, resume = true, lanAddress = '127.0.0.2', networkProfile = async () => null } = {}) {
  const app = await createApp({ dataDir, fake: true, secretStore: memorySecretStore(), localGuard: false, lanAddress, networkProfile });
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { app.remote.disable(); app.server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const resumed = resume ? await app.resumeRemote() : null;
  return { app, base, port: app.server.address().port, resumed };
}
const stop = (s) => new Promise((resolve) => s.app.server.close(() => resolve())); // Bunny closed: a restart is a close and a new start (nothing here turns access off)
const put = (base, body) => fetch(`${base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const status = async (base) => (await fetch(`${base}/api/remote`)).json();
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
const signIn = (url, passcode = PASS) => { const host = new URL(url).host; return lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode } }); };

test('REMOTE-STAY: on stays on after Bunny is closed and started again, on the same address when the window\'s port is the same; a device signs in again, at Chats; the passcode is the one chosen before', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const first = await start(t, dataDir);
  const on = await (await put(first.base, { enabled: true, passcode: PASS })).json();
  assert.ok(on.url);
  const before = await signIn(on.url.replace(/\/$/, ''));
  assert.equal(before.status, 200);
  assert.equal((await status(first.base)).devices[0].level, 'chats');
  await first.app.remote.flushLog?.();
  await stop(first);

  const second = await start(t, dataDir, { port: first.port }); // "Keep the same address": the window's port is the same
  assert.equal(second.resumed.resumed, true, JSON.stringify(second.resumed));
  const now = await status(second.base);
  assert.equal(now.enabled, true, 'still on');
  assert.equal(now.url, on.url, 'the same address');
  assert.equal(now.notOpened, '');
  assert.equal(now.signedIn, 0, 'RS-2: nobody stays signed in');
  const again = await signIn(now.url.replace(/\/$/, ''));
  assert.equal(again.status, 200, 'the saved passcode still works');
  assert.equal((await status(second.base)).devices[0].level, 'chats', 'RS-2: a new sign-in is at Chats');
});

test('REMOTE-STAY RS-6: turning it off (the window\'s Turn off, the Settings switch) is saved at once: after a restart it stays off, and the passcode is still kept for the next time', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const first = await start(t, dataDir);
  await put(first.base, { enabled: true, passcode: PASS });
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'remote-state.json'), 'utf8')).enabled, true);
  await put(first.base, { enabled: false });
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'remote-state.json'), 'utf8')), { enabled: false }, 'saved before the answer');
  await stop(first);
  const second = await start(t, dataDir);
  assert.equal(second.resumed.resumed, false);
  const s = await status(second.base);
  assert.deepEqual([s.enabled, s.hasPasscode, s.notOpened], [false, true, '']);
});

test('REMOTE-STAY: closing Bunny (not turning it off) does not turn it off; a fresh profile starts off', async (t) => {
  const fresh = await start(t, await mkdtemp(join(tmpdir(), 'bunny-stay-')));
  assert.equal(fresh.resumed.resumed, false);
  assert.equal((await status(fresh.base)).enabled, false);
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const a = await start(t, dataDir);
  await put(a.base, { enabled: true, passcode: PASS });
  await stop(a); // the server's close() ends the LAN server but must not save "off"
  assert.equal(JSON.parse(await readFile(join(dataDir, 'remote-state.json'), 'utf8')).enabled, true);
});

test('REMOTE-STAY RS-1: only the scrypt hash and salt are kept, never the passcode; neither /api/remote nor the settings hand out the hash or the saved address file', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const s = await start(t, dataDir);
  const on = await (await put(s.base, { enabled: true, passcode: PASS })).json();
  for (const name of await readdir(dataDir)) {
    const text = await readFile(join(dataDir, name), 'utf8').catch(() => '');
    assert.doesNotMatch(text, /correct horse|battery|staple/, name + ' holds no passcode');
  }
  const record = JSON.parse(await readFile(join(dataDir, 'remote-access.json'), 'utf8'));
  assert.equal(record.kdf, 'scrypt');
  const said = JSON.stringify(on) + JSON.stringify(await status(s.base)) + JSON.stringify(await (await fetch(s.base + '/api/settings')).json());
  assert.ok(!said.includes(record.hash) && !said.includes(record.salt), 'the hash and salt are not handed out');
  // changing the passcode replaces the saved record
  await put(s.base, { enabled: true, passcode: 'another passcode entirely' });
  const changed = JSON.parse(await readFile(join(dataDir, 'remote-access.json'), 'utf8'));
  assert.notEqual(changed.hash, record.hash);
  // a device at Everything cannot read the hash either: /api/remote* is refused to every device (device-full tests); the file is not under /src/ui
  assert.equal((await fetch(s.base + '/remote-access.json')).status, 404);
});

test('REMOTE-STAY RS-3: right after a restart a flood of wrong passcodes is counted from the first request (the try is reserved before scrypt), so a guess run cannot get past the limit', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const first = await start(t, dataDir);
  const on = await (await put(first.base, { enabled: true, passcode: PASS })).json();
  await stop(first);
  const second = await start(t, dataDir);
  const url = (await status(second.base)).url.replace(/\/$/, '');
  assert.equal(url, on.url.replace(/\/$/, '').replace(/:\d+$/, '') + ':' + new URL(url).port);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn(url, 'wrong passcode number ' + i)));
  const refused = results.filter((r) => r.status === 429).length;
  assert.ok(refused >= 6, 'at most five tries are checked at once from one device, the rest wait: ' + results.map((r) => r.status).join(','));
  assert.equal((await signIn(url)).status, 429, 'and the right passcode has to wait too');
});

test('REMOTE-STAY RS-4: Bunny opens again only on the network it was turned on with, or one Windows calls Private; otherwise it stays closed and says why in one sentence', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const home = async () => ({ name: 'Home Wi-Fi', category: 'Public' });
  const first = await start(t, dataDir, { networkProfile: home });
  await put(first.base, { enabled: true, passcode: PASS });
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'remote-state.json'), 'utf8')).network, { name: 'Home Wi-Fi', category: 'Public' });
  await stop(first);
  // a different, public network: closed, and the row says why
  const cafe = await start(t, dataDir, { networkProfile: async () => ({ name: 'Cafe', category: 'Public' }) });
  assert.equal(cafe.resumed.resumed, false);
  const s = await status(cafe.base);
  assert.deepEqual([s.enabled, s.notOpened], [false, NOT_OPENED_NETWORK]);
  assert.equal(NOT_OPENED_NETWORK, "Not opened: this network isn't the one you turned it on with. Turn it on again to allow it here.");
  await stop(cafe);
  // the saved state is kept: back on the home network it opens again
  const backHome = await start(t, dataDir, { networkProfile: home });
  assert.equal(backHome.resumed.resumed, true);
  assert.equal((await status(backHome.base)).notOpened, '');
  await stop(backHome);
  // a network Windows calls Private is fine even if it is another one
  const office = await start(t, dataDir, { networkProfile: async () => ({ name: 'Office', category: 'Private' }) });
  assert.equal(office.resumed.resumed, true);
});

test('REMOTE-STAY RS-4: canReopen, the rules: same network name (closed when it cannot be read), Private, no network, or (no name ever known) the same /24', () => {
  const saved = { address: '192.168.1.24', network: { name: 'Home', category: 'Public' } };
  assert.equal(canReopen(saved, '192.168.1.30', { name: 'Home', category: 'Public' }).ok, true);
  assert.equal(canReopen(saved, '10.0.0.5', { name: 'Elsewhere', category: 'Public' }).ok, false);
  assert.equal(canReopen(saved, '10.0.0.5', { name: 'Elsewhere', category: 'DomainAuthenticated' }).ok, false);
  assert.equal(canReopen(saved, '10.0.0.5', { name: 'Elsewhere', category: 'Private' }).ok, true);
  assert.equal(canReopen(saved, null, null).reason, NOT_OPENED_NO_NETWORK);
  assert.equal(canReopen(saved, '192.168.1.99', null).ok, false, 'a saved name that cannot be read now: closed, even on the same /24');
  assert.equal(canReopen({ address: '192.168.1.24', network: null }, '192.168.1.99', null).ok, true, 'no name was ever known (not Windows): the same /24');
  assert.equal(canReopen({ address: '192.168.1.24', network: null }, '192.168.7.99', null).ok, false);
  assert.equal(canReopen({}, '192.168.1.99', null).ok, false, 'nothing known about the saved network: closed');
});

test('REMOTE-STAY: what Windows calls the network is read for the interface that has the address (numbers or words), and nothing is asked on another system or when it cannot be read', async () => {
  const interfaces = { 'Wi-Fi': [{ address: '192.168.1.24', family: 'IPv4', internal: false }], Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] };
  const run = (answer) => async (alias) => { assert.equal(alias, 'Wi-Fi'); return answer; };
  assert.deepEqual(await networkProfileOf('192.168.1.24', { interfaces, platform: 'win32', run: run('{"Name":"Home","NetworkCategory":1}') }), { name: 'Home', category: 'Private' });
  assert.deepEqual(await networkProfileOf('192.168.1.24', { interfaces, platform: 'win32', run: run('{"Name":"Cafe","NetworkCategory":"Public"}') }), { name: 'Cafe', category: 'Public' });
  assert.equal(await networkProfileOf('192.168.1.24', { interfaces, platform: 'linux', run: run('{}') }), null);
  assert.equal(await networkProfileOf('192.168.1.24', { interfaces, platform: 'win32', run: run('not json') }), null);
  assert.equal(await networkProfileOf('192.168.9.9', { interfaces, platform: 'win32', run: run('{}') }), null, 'no interface has that address');
});

test('REMOTE-STAY: a saved "on" with no passcode file stays closed and says so; the sentence is plain', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-stay-'));
  const first = await start(t, dataDir);
  await put(first.base, { enabled: true, passcode: PASS });
  await stop(first);
  const { rm } = await import('node:fs/promises');
  await rm(join(dataDir, 'remote-access.json'));
  const second = await start(t, dataDir);
  assert.equal(second.resumed.resumed, false);
  assert.match((await status(second.base)).notOpened, /^Not opened: the saved passcode was not found\./);
});
