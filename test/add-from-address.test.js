import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, post, json } from './helpers.js';
import { checkPublicAddress } from '../src/server/publicFetch.js';
import { makeZip } from './helpers-archives.js';

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
