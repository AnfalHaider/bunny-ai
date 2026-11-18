import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRemoteAccess } from '../src/server/remoteAccess.js';
import { describeAction } from '../src/ui/device-access.js';
import { startApp } from './helpers.js';

// WEBAPP-SIGNIN: a refusal before sign-in says WHY on the sign-in page and is named in Activity (reason + kind of device, never an address or a value).
const PASS = 'correct horse battery staple';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36';

function lan(url, { path = '/', method = 'GET', headers = {}, body } = {}) {
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
async function opened(t) {
  const started = await startApp(t, { lanAddress: '127.0.0.1' });
  const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  t.after(() => started.app.remote.disable());
  const url = on.url.replace(/\/$/, '');
  return { ...started, url, host: new URL(url).host };
}
const refusals = async (app) => (await app.remote.actions()).filter((e) => e.kind === 'refused');
const signin = (url, host, headers = {}, passcode = PASS) => lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}`, 'user-agent': IPHONE, ...headers }, body: { passcode } });

test('another address (a changed or wrong one): the reason is plain, names no address, and Activity says so for an iPhone', async (t) => {
  const { url, host, app } = await opened(t);
  const r = await lan(url, { path: '/', headers: { host: 'evil.example:1234', 'user-agent': IPHONE } });
  assert.equal(r.status, 403);
  const body = r.json();
  assert.equal(body.code, 'request.badHost');
  assert.equal(body.reason, 'address');
  assert.match(body.message, /address .* open the address shown in Bunny on the computer/i);
  assert.ok(!r.text.includes(host.split(':')[0]) && !r.text.includes(host.split(':')[1]) && !r.text.includes('evil.example'), 'the answer holds no address');
  const [entry] = await refusals(app);
  assert.deepEqual([entry.kind, entry.reason, entry.label], ['refused', 'address', 'iPhone or iPad · Safari']);
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'device', 'kind', 'label', 'level', 'reason'], 'only names: no address, path or value');
  assert.match(describeAction(entry).note, /iPhone or iPad · Safari: address not allowed or changed/);
});

test('a page that did not come from the own address (wrong Origin, or another site): refused with its own reason', async (t) => {
  const { url, host, app } = await opened(t);
  const origin = await signin(url, host, { origin: 'http://somewhere.example' });
  assert.equal(origin.status, 403);
  assert.deepEqual([origin.json().code, origin.json().reason], ['request.badOrigin', 'origin']);
  assert.match(origin.json().message, /did not come from Bunny.s own page/);
  const site = await lan(url, { path: '/', headers: { host, 'sec-fetch-site': 'cross-site', 'user-agent': ANDROID } });
  assert.equal(site.json().reason, 'origin');
  assert.deepEqual((await refusals(app)).map((e) => `${e.label}:${e.reason}`).sort(), ['Android · Chrome:origin', 'iPhone or iPad · Safari:origin']);
});

test('a wrong passcode and too many tries say so, and Activity names them (the passcode itself is never kept)', async (t) => {
  const { url, host, app } = await opened(t);
  const wrong = await signin(url, host, {}, 'wrong wrong wrong');
  assert.equal(wrong.status, 401);
  assert.deepEqual([wrong.json().reason, wrong.json().message], ['passcode', 'That passcode is not right.']);
  for (let i = 0; i < 5; i += 1) await signin(url, host, {}, 'wrong wrong wrong');
  const waited = await signin(url, host);
  assert.equal(waited.status, 429);
  assert.equal(waited.json().reason, 'wait');
  assert.match(waited.json().message, /Wait \d+ seconds/);
  const found = await refusals(app);
  assert.deepEqual([...new Set(found.map((e) => e.reason))].sort(), ['passcode', 'wait']);
  assert.ok(!JSON.stringify(found).includes('wrong wrong') && !JSON.stringify(found).includes('correct horse'));
});

test('sharing off: nothing is written to the log', async () => {
  const r = createRemoteAccess({ now: () => 1_000_000 });
  r.logRefusal('address', IPHONE);
  assert.equal((await r.actions()).length, 0);
});

test('a flood of refusals cannot fill the log: once a minute for the same reason and kind of device, 20 in a minute at most', async () => {
  let t = 5_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  for (let i = 0; i < 50; i += 1) r.logRefusal('address', IPHONE);
  assert.equal((await r.actions()).filter((e) => e.kind === 'refused').length, 1);
  for (let i = 0; i < 60; i += 1) r.logRefusal('origin', `Mozilla/5.0 (Windows NT 10.0) Firefox/${i}`);
  assert.ok((await r.actions()).filter((e) => e.kind === 'refused').length <= 21);
  t += 61_000;
  r.logRefusal('address', IPHONE);
  assert.equal((await r.actions()).filter((e) => e.kind === 'refused' && e.reason === 'address').length, 2, 'a minute later it is written again');
  r.logRefusal('not-a-reason', IPHONE);
  assert.equal((await r.actions()).some((e) => e.reason === 'not-a-reason'), false);
});

test('the sign-in page says why: the answer of the server, an address that cannot be reached, a session that ended', async () => {
  const signinJs = await readFile(new URL('../src/ui/signin.js', import.meta.url), 'utf8');
  const remoteJs = await readFile(new URL('../src/ui/remote.js', import.meta.url), 'utf8');
  assert.ok(signinJs.includes('Sign-in did not work (the answer was ${res.status})'));
  assert.ok(signinJs.includes('Bunny could not be reached at this address. If it has changed, open the address shown in Bunny on the computer.'));
  assert.ok(signinJs.includes("has('signedout')"));
  assert.ok(remoteJs.includes("location.replace('/?signedout=1')"));
});

test('refusals have their own share of the log: a flood over days never pushes out a sign-in', async () => {
  let t = 9_000_000;
  const r = createRemoteAccess({ now: () => t });
  await r.enable({ lanHost: '10.0.0.5:5555', lanAddress: '10.0.0.5', passcode: PASS });
  await r.signIn('10.0.0.9', PASS, IPHONE);
  for (let i = 0; i < 200; i += 1) { t += 61_000; r.logRefusal('address', IPHONE); }
  const log = await r.actions();
  assert.equal(log.filter((e) => e.kind === 'refused').length, 50, 'only the newest 50 refusals are kept');
  assert.ok(log.some((e) => e.kind === 'signin'), 'the sign-in is still there');
});
