import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublicAddress, publicFetch, PUBLIC_ONLY, guarded } from '../src/server/publicFetch.js';
import { createMcpStore } from '../src/server/mcpStore.js';
import { listTools } from '../src/server/mcp.js';
import { startApp, post, json } from './helpers.js';

// IA-0 (Security, install-anywhere review): a connector the model (or a device) adds is reached only at a public https address, checked when added and at every call; the person's own Customize add may use a private address and http.
const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const priv = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }];

test('when added: https only, no password in it, and no host that is or resolves to a private address', async () => {
  assert.equal(await checkPublicAddress('https://mcp.example.com/mcp', { lookupImpl: pub }), 'https://mcp.example.com/mcp');
  for (const bad of ['http://mcp.example.com/mcp', 'ftp://x.example.com', 'https://user:pw@mcp.example.com/mcp', 'https://127.0.0.1/mcp', 'https://[::1]/mcp', 'https://10.0.0.5/mcp', 'https://192.168.1.1/mcp', 'https://169.254.169.254/latest', 'https://100.64.0.1/mcp', 'https://0.0.0.0/mcp', 'https://[fd00::1]/mcp', 'https://[::ffff:127.0.0.1]/mcp', 'https://localhost/mcp', 'https://thing.localhost/mcp', 'https://nas.local/mcp', 'https://intranet/mcp', 'not a url']) {
    await assert.rejects(checkPublicAddress(bad, { lookupImpl: pub }), (e) => e.message === PUBLIC_ONLY && e.code === 'mcp.publicOnly', bad);
  }
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.9', '::1', 'fe80::1']) await assert.rejects(checkPublicAddress('https://looks-public.example.com/mcp', { lookupImpl: priv(ip) }), /public https address/, `a name that resolves to ${ip}`);
  assert.ok(await checkPublicAddress('https://not-yet.example.com/mcp', { lookupImpl: async () => { throw new Error('ENOTFOUND'); } }), 'a name that does not resolve yet is checked again at every call');
});

test('the store: a model-added or device-added connector must be public https; the person\'s own may be private and http, and is marked by having no addedBy', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-ia0-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMcpStore({ file: join(dir, 'mcp.json'), lookupImpl: pub });
  await assert.rejects(store.add({ name: 'A', url: 'http://127.0.0.1:9/mcp', addedBy: 'model' }), /public https address/);
  await assert.rejects(store.add({ name: 'B', url: 'http://192.168.1.2/mcp', addedBy: 'device' }), /public https address/);
  await assert.rejects(store.add({ name: 'C', url: 'https://10.0.0.1/mcp', addedBy: 'model' }), /public https address/);
  const own = await store.add({ name: 'Mine', url: 'http://192.168.1.2:8080/mcp', addedBy: 'person' });
  assert.equal(own.addedBy, 'person');
  await assert.rejects(store.add({ name: 'Default', url: 'http://192.168.1.3/mcp' }), /public https address/, 'with nothing said, a connector is the models own');
  const found = await store.add({ name: 'Found', url: 'https://mcp.example.com/mcp', addedBy: 'model', enabled: false });
  assert.equal(found.addedBy, 'model');
  assert.equal(guarded(found), true); assert.equal(guarded(own), false);
  await assert.rejects(store.update(found.id, { url: 'http://127.0.0.1/mcp' }), /public https address/, 'a changed address obeys the same rule');
  assert.equal((await store.update(own.id, { url: 'http://10.0.0.7/mcp' })).url, 'http://10.0.0.7/mcp');
  const again = createMcpStore({ file: join(dir, 'mcp.json'), lookupImpl: pub });
  assert.equal((await again.list()).find((s) => s.name === 'Found').addedBy, 'model', 'it is remembered');
  const odd = await store.add({ name: 'Odd', url: 'https://odd.example.com/mcp', addedBy: 'anything-else' });
  assert.equal(odd.addedBy, 'model', 'anything but the exact words person or device is the models own');
});

test('the window\'s POST makes the person\'s record; a posted addedBy is ignored; the model tool is refused at a private address', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const r = await post(base, '/api/mcp', { name: 'Local', url: 'http://127.0.0.1:9/mcp', addedBy: 'model' });
  assert.equal(r.status, 200); assert.equal(r.body.addedBy, 'person');
  const { body: list } = await json(base, '/api/mcp');
  assert.equal(list.length, 1);
});

test('at every call: a model-added connector refuses a private address, http, and a redirect; the person\'s own is untouched', async (t) => {
  await assert.rejects(publicFetch('http://127.0.0.1:1/mcp', {}), /public https address/);
  await assert.rejects(publicFetch('https://127.0.0.1/mcp', {}), /public https address/);
  await assert.rejects(publicFetch('https://rebinding.example.com/mcp', {}, { lookupImpl: priv('169.254.169.254') }), /public https address/, 'the name now resolves to the metadata address');
  // loopback stand-ins (allowed only through the test switches): a redirect is an error; the socket goes to the address that was checked
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, host: req.headers.host }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const port = server.address().port;
  const opts = { allowHttp: true, allowPrivate: true, lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] };
  await assert.rejects(publicFetch(`http://pinned.example.test:${port}/redirect`, {}, opts), /somewhere else/);
  const ok = await publicFetch(`http://pinned.example.test:${port}/ok`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, opts);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).host, `pinned.example.test:${port}`, 'the name is kept for Host while the socket used the checked address');
  // DNS rebinding: public at the add, private at the call
  let calls = 0;
  const rebinding = async () => { calls += 1; return calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.9', family: 4 }]; };
  await checkPublicAddress('https://rebind.example.com/mcp', { lookupImpl: rebinding });
  await assert.rejects(publicFetch('https://rebind.example.com/mcp', {}, { lookupImpl: rebinding }), /public https address/);
  assert.ok(hits >= 1);
});

test('mcp.js uses the guard for a model-added connector (an http loopback server is refused) and not for the person\'s own', async (t) => {
  const server = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { const m = JSON.parse(raw || '{}'); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id ?? 0, result: m.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object' } }] } : {} })); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  await assert.rejects(listTools({ id: 'm1', name: 'x', url, addedBy: 'model' }), /public https address|Could not|refused/);
  await assert.rejects(listTools({ id: 'm2', name: 'x', url, addedBy: 'device' }), /public https address|Could not|refused/);
  const tools = await listTools({ id: 'p1', name: 'mine', url });
  assert.equal(tools[0].name, 'ping');
});

test("the model's add_connector tool is refused at a private or http address, with the one sentence, and nothing is stored", async (t) => {
  const { createAppTools } = await import('../src/server/appTools.js');
  const dir = await mkdtemp(join(tmpdir(), 'bunny-ia0b-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMcpStore({ file: join(dir, 'mcp.json'), lookupImpl: pub });
  const tools = createAppTools({ skills: {}, mcp: store, getSettings: () => ({}), saveSettings: async () => ({}) });
  for (const url of ['http://example.com/mcp', 'https://127.0.0.1/mcp', 'https://169.254.169.254/x']) await assert.rejects(tools.run('add_connector', { name: 'X', url }, { chatId: 'c' }), /public https address/, url);
  assert.deepEqual(await store.list(), []);
  const ok = await tools.run('add_connector', { name: 'Fine', url: 'https://mcp.example.com/mcp' }, { chatId: 'c' });
  assert.match(ok, /remote connector Fine/);
  assert.equal((await store.list())[0].addedBy, 'model');
});

test('IA0-a: a swapped globalThis.fetch does not let a guarded connector reach a private address', async (t) => {
  const real = globalThis.fetch; let reached = false;
  globalThis.fetch = async () => { reached = true; return new Response('{}', { status: 200 }); };
  t.after(() => { globalThis.fetch = real; });
  await assert.rejects(listTools({ id: 'g1', name: 'x', url: 'https://127.0.0.1/mcp', addedBy: 'model' }), /public https address|refused|Could not/);
  assert.equal(reached, false);
});
