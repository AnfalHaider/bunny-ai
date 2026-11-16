// W3-6 fix re-check (Security) at 3155e20: token bound to its origin; sign-out versus a renewal in flight.
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const { createMcpOAuth } = await import(`file:///${CO}/src/server/mcpOAuth.js`);
const store = new Map();
const secrets = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
const meta = { issuer: 'https://as.example', authorization_endpoint: 'https://as.example/auth', token_endpoint: 'https://as.example/token', revocation_endpoint: 'https://as.example/revoke' };
let release; let gate = new Promise((r) => { release = r; });
const calls = [];
const fetchImpl = async (url, init) => {
  const u = String(url); calls.push(u + ' ' + (init?.method ?? 'GET'));
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.includes('/.well-known/oauth-authorization-server')) return json(meta);
  if (u === 'https://as.example/token') { await gate; return json({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', token_type: 'bearer', expires_in: 3600 }); }
  if (u === 'https://as.example/revoke') return json({});
  return json({}, 404);
};
const oa = createMcpOAuth({ secrets, redirectBase: 'http://127.0.0.1:4545', fetchImpl });
const id = '11111111-1111-1111-1111-111111111111';
const tok = (over = {}) => JSON.stringify({ access_token: 'OLD-ACCESS', refresh_token: 'OLD-REFRESH', expires_at: Date.now() + 3600_000, issuer: 'https://as.example', client_id: 'c', account: 'a', origin: 'https://c.example', ...over });
const show = async (label, server) => console.log(label.padEnd(58), JSON.stringify(await oa.authHeader(server)), JSON.stringify((await oa.status(server)).signedIn));
store.set(`mcp:${id}:oauth`, tok());
await show('same origin, other path', { id, url: 'https://c.example/other/mcp' });
await show('other host', { id, url: 'https://elsewhere.example/mcp' });
await show('same host over http', { id, url: 'http://c.example/mcp' });
await show('same host, other port', { id, url: 'https://c.example:8443/mcp' });
await show('subdomain', { id, url: 'https://x.c.example/mcp' });
await show('look-alike host', { id, url: 'https://c.example.evil.example/mcp' });
await show('userinfo trick', { id, url: 'https://c.example@evil.example/mcp' });
store.set(`mcp:${id}:oauth`, tok({ origin: undefined }));
await show('a token saved before the fix (no origin)', { id, url: 'https://c.example/mcp' });
// sign out while a renewal is in flight
store.set(`mcp:${id}:oauth`, tok({ expires_at: Date.now() - 1000 }));
const refresh = oa.authHeader({ id, url: 'https://c.example/mcp' }).then((h) => 'refresh answered ' + JSON.stringify(h), (e) => 'refresh ended with ' + e.code);
await new Promise((r) => setTimeout(r, 100));
const out = oa.signOut({ id, url: 'https://c.example/mcp' });
await new Promise((r) => setTimeout(r, 100));
release();
console.log(await refresh); console.log('signOut result:', JSON.stringify(await out));
console.log('token present after both finished:', store.has(`mcp:${id}:oauth`), '| revoke calls:', calls.filter((c) => c.includes('/revoke')).length);
