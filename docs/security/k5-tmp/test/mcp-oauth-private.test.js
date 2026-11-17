/**
 * S-OAUTH (Security): sign-in discovery resolves every host it is about to call, refuses a private address, and connects only to
 * the address it checked, on every request: the connector, the sign-in server, registration, token, userinfo and revocation endpoints.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMcpOAuth, pinnedFetch } from '../src/server/mcpOAuth.js';
import { memorySecretStore } from '../src/providers/connections.js';

const REDIRECT_BASE = 'http://127.0.0.1:45999';
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

/** A stand-in for the internet: answers the discovery documents for https://mcp.example.com, and counts the calls it receives. */
function internet() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/.well-known/oauth-protected-resource') return json({ resource: u.origin, authorization_servers: [`${u.origin}`] });
    if (u.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      return json({ issuer: u.origin, authorization_endpoint: `${u.origin}/authorize`, token_endpoint: `${u.origin}/token`, code_challenge_methods_supported: ['S256'] });
    }
    return new Response('', { status: 404 });
  };
  return { calls, fetchImpl };
}

const engine = (net, lookupImpl) => createMcpOAuth({ secrets: memorySecretStore(), redirectBase: REDIRECT_BASE, fetchImpl: net.fetchImpl, lookupImpl });
const server = { id: 'srv-1', url: 'https://mcp.example.com/mcp' };

test('S-OAUTH: a connector name that resolves to 127.0.0.1 is refused before anything is sent', async () => {
  const net = internet();
  const oauth = engine(net, async () => [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(oauth.discover(server), (err) => err.code === 'mcp.oauth.badUrl' && /private network|this computer/.test(err.message));
  assert.deepEqual(net.calls, [], 'no request left Bunny AI');
});

test('S-OAUTH: a name that resolves to a 10.x address, a link-local address or an IPv6 loopback is refused too', async () => {
  for (const address of ['10.1.2.3', '169.254.169.254', '192.168.0.9', '172.16.5.5', '::1', 'fe80::1', '::ffff:127.0.0.1']) {
    const net = internet();
    const oauth = engine(net, async () => [{ address, family: address.includes(':') ? 6 : 4 }]);
    await assert.rejects(oauth.discover(server), (err) => err.code === 'mcp.oauth.badUrl', address);
    assert.deepEqual(net.calls, [], address);
  }
});

test('S-OAUTH: one private address among several answers is enough to refuse', async () => {
  const net = internet();
  const oauth = engine(net, async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }]);
  await assert.rejects(oauth.discover(server), (err) => err.code === 'mcp.oauth.badUrl');
  assert.deepEqual(net.calls, []);
});

test('S-OAUTH: a public address goes through, and a sign-in server discovered on another name is checked on its own', async () => {
  const net = internet();
  const asked = [];
  const oauth = engine(net, async (host) => { asked.push(host); return PUBLIC; });
  const found = await oauth.discover(server);
  assert.equal(found.meta.token_endpoint, 'https://mcp.example.com/token');
  assert.ok(asked.length >= 2, 'the name was resolved for each request, not once for the whole sign-in');
  assert.ok(net.calls.length >= 2);
});

test('S-OAUTH: the answer is checked on EVERY request: a name that turns private after the first request is refused on the next', async () => {
  const net = internet();
  let n = 0;
  const oauth = engine(net, async () => (n++ === 0 ? PUBLIC : [{ address: '10.0.0.5', family: 4 }]));
  await assert.rejects(oauth.discover(server), (err) => err.code === 'mcp.oauth.badUrl');
  assert.equal(net.calls.length, 1, 'only the first, public, request was made');
});

test('S-OAUTH: an address that cannot be resolved is an error, not a request', async () => {
  const net = internet();
  const oauth = engine(net, async () => { throw new Error('ENOTFOUND'); });
  await assert.rejects(oauth.discover(server), (err) => err.code === 'mcp.unreachable');
  assert.deepEqual(net.calls, []);
});

test('S-OAUTH: a literal private address in the connector address is refused without a lookup', async () => {
  const net = internet();
  let looked = 0;
  const oauth = engine(net, async () => { looked += 1; return PUBLIC; });
  await assert.rejects(oauth.discover({ id: 's', url: 'https://10.0.0.5/mcp' }), (err) => err.code === 'mcp.oauth.badUrl');
  await assert.rejects(oauth.discover({ id: 's', url: 'https://[fd00::1]/mcp' }), (err) => err.code === 'mcp.oauth.badUrl');
  assert.equal(looked, 0);
  assert.deepEqual(net.calls, []);
});

test('S-OAUTH: this PC itself (http on 127.0.0.1) is how a local connector signs in and is not refused', async () => {
  const net = internet();
  const oauth = engine(net, async () => { throw new Error('never asked for this PC'); });
  const found = await oauth.discover({ id: 's', url: 'http://127.0.0.1:5000/mcp' }).catch((err) => err);
  assert.ok(!(found?.code === 'mcp.oauth.badUrl'), 'not refused as private');
});

test('S-OAUTH: the connection goes to the address that was checked, whatever the name would resolve to now', async (t) => {
  const seen = [];
  const local = createServer((req, res) => { seen.push(req.headers.host); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  t.after(() => local.close());
  const port = local.address().port;
  // The name "pinned.invalid" cannot be resolved by anyone: the only way this request arrives is by the address it was handed.
  const res = await pinnedFetch(new URL(`http://pinned.invalid:${port}/x`), { headers: { accept: 'application/json' } }, { address: '127.0.0.1', family: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  let text = '';
  for await (const chunk of res.body) text += chunk;
  assert.equal(text, '{"ok":true}');
  assert.deepEqual(seen, [`pinned.invalid:${port}`], 'the Host header still carries the name');
});

test('S-OAUTH: a redirect from the pinned connection is refused, not followed', async (t) => {
  const local = createServer((req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  t.after(() => local.close());
  await assert.rejects(pinnedFetch(new URL(`http://pinned.invalid:${local.address().port}/`), {}, { address: '127.0.0.1', family: 4 }), /redirect refused/);
});
