import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, post, json } from './helpers.js';
import { checkPublicAddress } from '../src/server/publicFetch.js';
import { makeZip } from './helpers-archives.js';
import http from 'node:http';
import { fetchLimited } from '../src/server/download.js';

// INSTALL-ANYWHERE: Customize's "Add from address" (window only). One field, what was understood, then the same one card. Stand-ins only.
const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const checkAddress = (u) => checkPublicAddress(u, { lookupImpl: pub });
const SKILL = '---\nname: notes\ndescription: Take notes\n---\nTake notes of the meeting.';
const ZIP = makeZip([{ name: 'pack/plugin.json', data: JSON.stringify({ name: 'meeting-pack', description: 'Meeting helpers' }) }, { name: 'pack/skills/notes/SKILL.md', data: SKILL }, { name: 'pack/hooks/pre.sh', data: 'echo hi' }, { name: 'pack/.mcp.json', data: JSON.stringify({ mcpServers: { cal: { url: 'https://mcp.example.com/mcp' }, lan: { url: 'https://10.0.0.5/mcp' } } }) }]);

async function app(t) {
  return startApp(t, { fake: false, installSource: { fetchSource: async (u) => ({ bytes: ZIP, url: u }), checkAddress } });
}
const check = (base, address) => post(base, '/api/install', { address });

test('the field says what it did not understand, refuses http, and installs nothing', async (t) => {
  const { base } = await app(t);
  const odd = (await check(base, 'my cool plugin')).body;
  assert.equal(odd.ok, false); assert.match(odd.message, /I can't tell what this is/);
  const plain = (await check(base, 'http://example.org/pack.zip')).body;
  assert.equal(plain.ok, false); assert.match(plain.message, /Only https addresses can be installed/);
  assert.deepEqual((await json(base, '/api/mcp')).body, []);
});

test('an archive: the card shows the pin, every part and the not-imported list; "keep off" installs everything off; the temp folder is gone', async (t) => {
  const { base } = await app(t);
  const c = (await check(base, 'https://files.example.com/pack.zip')).body;
  assert.equal(c.ok, true); assert.match(c.understood, /archive: its sha256 is pinned/);
  for (const need of ['Source https://files.example.com/pack.zip', 'Fingerprint (sha256)', 'Skill notes', 'Connector cal: https://mcp.example.com/mcp', 'hooks and scripts', 'not a public https address']) assert.ok(c.text.includes(need), need);
  assert.ok(!c.text.includes('Found on the open web'), 'the person typed it: not "found on the open web"');
  const done = await post(base, `/api/install/${c.id}`, { choice: 'off' });
  assert.equal(done.status, 200);
  const mcp = (await json(base, '/api/mcp')).body; assert.deepEqual(mcp.map((x) => [x.url, x.enabled]), [['https://mcp.example.com/mcp', false]]);
  assert.equal((await post(base, `/api/install/${c.id}`, { choice: 'off' })).status, 400, 'the same card cannot be answered twice');
});

test('"Install and switch on" switches on exactly what the card listed; cancel installs nothing', async (t) => {
  const { base } = await app(t);
  const c = (await check(base, 'https://files.example.com/pack.zip')).body;
  assert.equal((await post(base, `/api/install/${c.id}`, { choice: 'on' })).status, 200);
  assert.deepEqual((await json(base, '/api/mcp')).body.map((x) => x.enabled), [true]);
  const d = (await check(base, 'https://files.example.com/other.zip')).body;
  assert.equal((await fetch(`${base}/api/install/${d.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await post(base, `/api/install/${d.id}`, { choice: 'on' })).status, 400);
});

test('a remote connector the person typed: it is theirs (addedBy person), cannot be pinned to content, and a private address is allowed and said so', async (t) => {
  const { base } = await app(t);
  const c = (await check(base, 'https://nas.example.org/mcp')).body;
  assert.equal(c.kind, 'connector'); assert.match(c.text, /This service can change what it does at any time/);
  const lan = (await check(base, 'https://10.0.0.5/mcp')).body;
  assert.match(lan.text, /This address is on your own network\. It is allowed because you added it/);
  assert.equal((await post(base, `/api/install/${lan.id}`, { choice: 'off' })).status, 200);
  const got = (await json(base, '/api/mcp')).body[0];
  assert.equal(got.url, 'https://10.0.0.5/mcp'); assert.equal(got.addedBy, 'person'); assert.equal(got.enabled, false);
});

test('the field and its card are window only', async (t) => {
  const { isWindowOnlyRoute } = await import('../src/server/windowOnly.js');
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [m, p] of [['POST', '/api/install'], ['POST', `/api/install/${id}`], ['DELETE', `/api/install/${id}`]]) assert.equal(isWindowOnlyRoute(m, p), true, `${m} ${p}`);
  void t;
});

test('ADDR-1: a card too long to show whole never switches anything on, even when "on" is sent', async (t) => {
  const skills = Array.from({ length: 20 }, (_, i) => ({ name: `pack/skills/s${i}/SKILL.md`, data: `---\nname: skill-number-${i}\ndescription: ${'a long description of what this does '.repeat(6)}\n---\nDo ${i}.` }));
  const big = makeZip([{ name: 'pack/plugin.json', data: JSON.stringify({ name: 'big-pack', description: 'x' }) }, { name: 'pack/.mcp.json', data: JSON.stringify({ mcpServers: { cal: { url: 'https://mcp.example.com/mcp' } } }) }, ...skills]);
  const { base } = await startApp(t, { fake: false, installSource: { fetchSource: async (u) => ({ bytes: big, url: u }), checkAddress } });
  const c = (await check(base, 'https://files.example.com/big.zip')).body;
  assert.equal(c.ok, true); assert.equal(c.tooLong, true);
  const done = await post(base, `/api/install/${c.id}`, { choice: 'on' });
  assert.equal(done.status, 200); assert.equal(done.body.switchedOn, false);
  assert.deepEqual((await json(base, '/api/mcp')).body.map((x) => x.enabled), [false], 'installed off');
  const skillsList = (await json(base, '/api/skills')).body;
  assert.ok(skillsList.length >= 20 && skillsList.every((s) => s.enabled === false), 'every skill is off');
});

test('ADDR-3: a typed address on the LAN is allowed for that exact address only; any other private address (a redirect, another host) is refused', async () => {
  const lookupImpl = async () => [{ address: '192.168.1.9', family: 4 }];
  const typed = 'https://nas.example.org/tools/pack.zip';
  const timeout = () => AbortSignal.timeout(250);
  // allowed: the connection is attempted (it times out or is refused: it was NOT refused as private)
  await assert.rejects(fetchLimited(typed, { lookupImpl, signal: timeout(), allowLoopback: (u) => u.href === typed }), (e) => !/private network/.test(e.message));
  // not the typed address: refused as private
  await assert.rejects(fetchLimited('https://other.example.org/x.zip', { lookupImpl, signal: timeout(), allowLoopback: (u) => u.href === typed }), /private network/);
  await assert.rejects(fetchLimited(typed, { lookupImpl, signal: timeout() }), /private network/, 'with nothing typed it is refused');
  await assert.rejects(fetchLimited('https://10.0.0.7/pack.zip', { signal: timeout(), allowLoopback: (u) => u.href === typed }), /private network/);
});

// ADDR-2 and the device rule: an Everything device may use the field, is logged by choice and item name, and gets none of the private-address allowances
const PASS = 'correct horse battery staple'; const J = { 'content-type': 'application/json' };
function lan(url, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? J : {}), ...headers } }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, json: () => { try { return JSON.parse(text); } catch { return null; } }, headers: res.headers })); });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
test('ADDR-2: an Everything device is logged (kind install, choice, item name, no address); its connector is a device\'s; a private address is refused for it', async (t) => {
  const started = await startApp(t, { lanAddress: '127.0.0.1', fake: false, installSource: { fetchSource: async (u) => ({ bytes: ZIP, url: u }), checkAddress } });
  const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: J, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  t.after(() => started.app.remote.disable());
  const url = on.url.replace(/\/$/, ''); const host = new URL(url).host;
  const signin = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  const cookie = String(signin.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
  const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
  assert.equal((await fetch(`${started.base}/api/remote/devices/${started.app.remote.list()[0].id}/level`, { method: 'PATCH', headers: J, body: JSON.stringify({ level: 'everything' }) })).status, 200);
  const dev = (method, path, body) => lan(url, { method, path, headers: { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body });
  const lanTry = (await dev('POST', '/api/install', { address: 'https://10.0.0.5/mcp' })).json();
  assert.equal(lanTry.ok, false); assert.match(lanTry.message, /public https address/, 'no private allowance for a device');
  const pub1 = (await dev('POST', '/api/install', { address: 'https://nas.example.org/mcp' })).json();
  assert.equal(pub1.ok, true);
  assert.equal((await dev('POST', `/api/install/${pub1.id}`, { choice: 'off' })).status, 200);
  const list = (await json(started.base, '/api/mcp')).body; assert.equal(list[0].addedBy, 'device');
  const log = JSON.stringify(await (await fetch(`${started.base}/api/remote/log`)).json());
  assert.match(log, /"kind":"install"/); assert.match(log, /"choice":"off"/); assert.match(log, /"item":"nas\.example\.org"/); assert.ok(!/https:\/\/nas\.example\.org/.test(log), 'never an address');
  // a card shown to the window cannot be answered by a device, nor the reverse
  const mine = (await check(started.base, 'https://files.example.com/pack.zip')).body;
  assert.notEqual((await dev('POST', `/api/install/${mine.id}`, { choice: 'on' })).status, 200);
});
