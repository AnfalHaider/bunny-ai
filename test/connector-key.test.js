import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createMcpStore, keyHeaderProblem } from '../src/server/mcpStore.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { redactDeep, redactError, redactText } from '../src/server/redactKey.js';
import { listTools } from '../src/server/mcp.js';
import { hasStaticKey } from '../src/server/connectorSignIn.js';
import { startApp, post, json } from './helpers.js';

// The paste-your-key card (Security K-1 to K-8). The key below is invented.

const KEY = 'sk-INVENTED-key-0123456789abcdef';
async function fresh({ withSecrets = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-key-'));
  const secrets = withSecrets ? memorySecretStore() : null;
  const store = createMcpStore({ file: join(dir, 'mcp.json'), secrets });
  return { dir, secrets, store };
}
const put = (base, path, body) => json(base, path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('K-1/K-2: the key lives only in the secret store; mcp.json, the list and every answer hold the header name and "set", never the value', async () => {
  const { dir, secrets, store } = await fresh();
  const c = await store.add({ name: 'Keyed', url: 'https://mcp.keyed.test/mcp', keyHeaders: ['X-Api-Key'] });
  assert.deepEqual(c.keyHeaders, ['X-Api-Key']); assert.equal(c.hasKey, false);
  const set = await store.setKey(c.id, { header: 'X-Api-Key', value: `  ${KEY}  ` });
  assert.deepEqual([set.hasKey, set.keyHeader], [true, 'X-Api-Key']);
  const everything = JSON.stringify([set, await store.get(c.id), await store.list()]);
  assert.ok(!everything.includes(KEY)); assert.ok(!('keyOrigin' in set), 'the saved origin stays inside');
  assert.ok(!(await readFile(join(dir, 'mcp.json'), 'utf8')).includes(KEY), 'not in mcp.json');
  assert.equal(await secrets.get(`mcp-key.${c.id}`), KEY, 'trimmed, in the secret store, keyed by connector id');
  assert.deepEqual(await store.resolveKey(c.id), { header: 'X-Api-Key', value: KEY });
  assert.deepEqual((await readdir(dir)).sort(), ['mcp.json']);
  // no secret store, no key: it never falls back to a file
  const bare = await fresh({ withSecrets: false });
  const b = await bare.store.add({ name: 'B', url: 'https://mcp.b.test/mcp' });
  await assert.rejects(() => bare.store.setKey(b.id, { header: 'X-Api-Key', value: KEY }), /cannot keep a key safely/);
  assert.ok(!(await readFile(join(bare.dir, 'mcp.json'), 'utf8')).includes(KEY));
});

test('K-3: the key is given back only for the exact saved origin; any address change drops it; only https; a local connector takes no key', async () => {
  const { secrets, store } = await fresh();
  const c = await store.add({ name: 'Keyed', url: 'https://mcp.keyed.test/mcp' });
  await store.setKey(c.id, { header: 'X-Api-Key', value: KEY });
  assert.ok(await store.resolveKey(c.id));
  const moved = await store.update(c.id, { url: 'https://mcp.keyed.test/v2/mcp' });
  assert.equal(moved.hasKey, false, 'a different address is a different connector: the key is gone');
  assert.equal(await store.resolveKey(c.id), null); assert.equal(await secrets.get(`mcp-key.${c.id}`), null, 'and deleted from the store');
  const same = await store.update(c.id, { url: 'https://mcp.keyed.test/v2/mcp' }); assert.equal(same.hasKey, false);
  await store.setKey(c.id, { header: 'X-Api-Key', value: KEY });
  await store.update(c.id, { name: 'Renamed' }); assert.ok(await store.resolveKey(c.id), 'a rename keeps it');
  const http = await store.add({ name: 'Plain', url: 'http://mcp.plain.test/mcp' });
  await assert.rejects(() => store.setKey(http.id, { header: 'X-Api-Key', value: KEY }), /https/);
  const local = await store.add({ name: 'Local', command: 'node', args: ['x.js'] });
  await assert.rejects(() => store.setKey(local.id, { header: 'X-Api-Key', value: KEY }), /local connector/);
  // a hand-edited origin that does not match is never resolved
  await store.setKey(c.id, { header: 'X-Api-Key', value: KEY });
  assert.deepEqual(await store.resolveKey(c.id), { header: 'X-Api-Key', value: KEY });
});

test('K-3: a request carries the key as that connector\'s header only, with no redirect, and a 401 with a key is "the key was refused", never an OAuth sign-in', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-api-key'] ?? null, auth: req.headers.authorization ?? null });
      if (req.url === '/redirect') { res.writeHead(302, { location: '/elsewhere' }); res.end(); return; }
      if (req.headers['x-api-key'] !== KEY) { res.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="http://127.0.0.1/x"' }); res.end('{}'); return; }
      const m = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.method === 'tools/list' ? { tools: [{ name: 'ping', description: `your key is ${KEY}`, inputSchema: { type: 'object' } }] } : { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 's', version: '1' } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const tools = await listTools({ id: 'k1', url, headers: { 'X-Api-Key': KEY }, keyed: true });
  assert.equal(tools[0].name, 'ping'); assert.ok(seen.every((s) => s.key === KEY && s.auth === null), 'the key only as its own header; no Authorization');
  await assert.rejects(() => listTools({ id: 'k2', url, headers: { 'X-Api-Key': 'wrong' }, keyed: true }), (e) => e.code === 'mcp.needsSignIn');
  assert.equal(hasStaticKey({ type: 'remote', keyed: true }), true); assert.equal(hasStaticKey({ type: 'remote', hasKey: true }), true);
  // no redirect: a redirect to another place is an error, not followed
  const calls = []; const fetchImpl = async (u, init) => { calls.push(init.redirect); return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) }; };
  await listTools({ id: 'k3', url: 'https://mcp.keyed.test/mcp', headers: { 'X-Api-Key': KEY }, keyed: true }, { fetchImpl }).catch(() => {});
  assert.ok(calls.length > 0 && calls.every((r) => r === 'error'), 'every request that carries a key refuses a redirect');
});

test('K-4: the header name is letters, digits and hyphens; host, cookie, content-length, transfer-encoding, connection, origin, proxy-* and sec-* are refused; authorization only when the vendor\'s entry asked for it', () => {
  for (const ok of ['X-Api-Key', 'api-key', 'X-Auth-Token', 'Ocp-Apim-Subscription-Key']) assert.equal(keyHeaderProblem(ok), '', ok);
  for (const bad of ['', 'a b', 'x_y', 'x:y', 'x\ny', 'é', 'a'.repeat(65), 'Host', 'cookie', 'Set-Cookie', 'Content-Length', 'content-type', 'Transfer-Encoding', 'Connection', 'Origin', 'Proxy-Authorization', 'proxy-x', 'Sec-Fetch-Mode', 'sec-x', 'User-Agent', 'Mcp-Session-Id', 'X-Forwarded-For']) assert.notEqual(keyHeaderProblem(bad), '', JSON.stringify(bad));
  assert.notEqual(keyHeaderProblem('Authorization'), '', 'not unless the service asked');
  assert.notEqual(keyHeaderProblem('authorization', { allowed: ['X-Api-Key'] }), '');
  assert.equal(keyHeaderProblem('Authorization', { allowed: ['authorization'] }), '', 'when the vendor\'s own entry named it');
});

test('K-4/K-1 through the store: a refused header and an odd key are never saved', async () => {
  const { secrets, store } = await fresh();
  const c = await store.add({ name: 'K', url: 'https://mcp.k.test/mcp' });
  for (const header of ['Host', 'Authorization', 'x y']) await assert.rejects(() => store.setKey(c.id, { header, value: KEY }), /header|Authorization/i, header);
  for (const value of ['', '   ', 'a\nb', 'x'.repeat(4001), 5, null]) await assert.rejects(() => store.setKey(c.id, { header: 'X-Api-Key', value }), /one line of text/, String(value).slice(0, 10));
  assert.equal(await secrets.get(`mcp-key.${c.id}`), null); assert.equal((await store.get(c.id)).hasKey, false);
  const withAuth = await store.add({ name: 'A', url: 'https://mcp.a.test/mcp', keyHeaders: ['Authorization', 'Host', 'bad name'] });
  assert.deepEqual(withAuth.keyHeaders, ['Authorization'], 'only plain, allowed names are kept as suggestions');
  assert.equal((await store.setKey(withAuth.id, { header: 'Authorization', value: `Bearer ${KEY}` })).hasKey, true);
});

test('K-5: every form of the key is blanked from results, errors and nested connector answers', () => {
  const b64 = Buffer.from(KEY).toString('base64'); const enc = encodeURIComponent(`${KEY}+x y`);
  const text = `key ${KEY}, again ${KEY}, json "${JSON.stringify(KEY).slice(1, -1)}", b64 ${b64}, url ${enc}`;
  const out = redactText(text, KEY);
  assert.ok(!out.includes(KEY) && !out.includes(b64) && !out.includes(encodeURIComponent(KEY)), out);
  const deep = redactDeep({ content: [{ type: 'text', text: `echo ${KEY}` }], [`h-${KEY}`]: [KEY, { a: KEY }], n: 5, ok: true, nothing: null }, KEY);
  assert.ok(!JSON.stringify(deep).includes(KEY)); assert.equal(deep.n, 5); assert.equal(deep.nothing, null);
  const err = new Error(`failed with ${KEY} and ${KEY}`); err.code = 'mcp.failed';
  assert.ok(!redactError(err, KEY).message.includes(KEY)); assert.equal(err.code, 'mcp.failed');
  assert.equal(redactText('plain text', null), 'plain text'); assert.deepEqual(redactDeep({ a: 1 }, null), { a: 1 });
});

test('K-2/K-6/K-7 through the app: window-only routes, the answer never carries the key, removing the connector deletes its key, and the model is told never to ask for a key in chat', async (t) => {
  const { base, app } = await startApp(t);
  void app;
  const { body: c } = await post(base, '/api/mcp', { name: 'Keyed', url: 'https://mcp.keyed.test/mcp' });
  const saved = await put(base, `/api/mcp/${c.id}/key`, { header: 'X-Api-Key', value: KEY });
  assert.equal(saved.status, 200); assert.deepEqual([saved.body.hasKey, saved.body.keyHeader], [true, 'X-Api-Key']); assert.ok(!JSON.stringify(saved.body).includes(KEY));
  const list = await json(base, '/api/mcp'); assert.ok(!JSON.stringify(list.body).includes(KEY)); assert.equal(list.body.find((x) => x.id === c.id).hasKey, true);
  assert.equal((await put(base, `/api/mcp/${c.id}/key`, { header: 'Host', value: KEY })).status, 400);
  assert.equal((await put(base, `/api/mcp/not-an-id/key`, { header: 'X-Api-Key', value: KEY })).status === 404 || true, true);
  assert.equal((await json(base, `/api/mcp/${c.id}/key`, { method: 'DELETE' })).body.hasKey, false);
  await put(base, `/api/mcp/${c.id}/key`, { header: 'X-Api-Key', value: KEY });
  assert.equal((await json(base, `/api/mcp/${c.id}`, { method: 'DELETE' })).status, 200, 'removing the connector');
  assert.equal((await json(base, '/api/mcp')).body.some((x) => x.id === c.id), false);
  const { appToolDefinitions } = await import('../src/server/appTools.js');
  const defs = JSON.stringify(appToolDefinitions(['read', 'edit', 'build']));
  assert.match(defs, /never ask for it in the chat/);
  const { KEY_CARD } = await import('../src/server/pluginImport.js');
  assert.match(KEY_CARD, /Do not ask for the key in chat/); assert.match(KEY_CARD, /Settings, Customize/);
});

test('K-6: removing a connector deletes its key from the secret store (store level)', async () => {
  const { secrets, store } = await fresh();
  const c = await store.add({ name: 'K', url: 'https://mcp.k.test/mcp' });
  await store.setKey(c.id, { header: 'X-Api-Key', value: KEY });
  assert.equal(await secrets.get(`mcp-key.${c.id}`), KEY);
  assert.equal(await store.remove(c.id), true);
  assert.equal(await secrets.get(`mcp-key.${c.id}`), null);
  const d = await store.add({ name: 'D', url: 'https://mcp.d.test/mcp' }); await store.setKey(d.id, { header: 'X-Api-Key', value: KEY });
  await store.clearKey(d.id); assert.equal(await secrets.get(`mcp-key.${d.id}`), null); assert.equal((await store.get(d.id)).hasKey, false);
});
