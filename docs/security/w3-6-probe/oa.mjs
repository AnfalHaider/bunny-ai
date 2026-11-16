// W3-6 probe (Security): token bound to its connector URL? sign-out during a refresh? Usage: node oa.mjs <checkout of 1a1c364>
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const { createMcpOAuth } = await import(`file:///${CO}/src/server/mcpOAuth.js`);
const store = new Map();
const secrets = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
const meta = { issuer: 'https://as.example', authorization_endpoint: 'https://as.example/auth', token_endpoint: 'https://as.example/token', revocation_endpoint: 'https://as.example/revoke' };
let release;
const gate = new Promise((r) => { release = r; });
const fetchImpl = async (url, init) => {
  const u = String(url);
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.includes('/.well-known/oauth-authorization-server')) return json(meta);
  if (u === 'https://as.example/token') { await gate; return json({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', token_type: 'bearer', expires_in: 3600 }); }
  if (u === 'https://as.example/revoke') return json({});
  return json({}, 404);
};
const oa = createMcpOAuth({ secrets, redirectBase: 'http://127.0.0.1:4545', fetchImpl });
const id = '11111111-1111-1111-1111-111111111111';
const tok = (over = {}) => JSON.stringify({ access_token: 'OLD-ACCESS', refresh_token: 'OLD-REFRESH', expires_at: Date.now() + 3600_000, issuer: 'https://as.example', client_id: 'c', account: 'a', ...over });
// 1. the token goes to whichever URL the connector now has
store.set(`mcp:${id}:oauth`, tok());
console.log('token sent for a connector whose address was changed to another host:', JSON.stringify(await oa.authHeader({ id, url: 'https://elsewhere.example/mcp' })));
// 2. sign out while a refresh is in flight
store.set(`mcp:${id}:oauth`, tok({ expires_at: Date.now() - 1000 }));
const refresh = oa.authHeader({ id, url: 'https://c.example/mcp' });
await new Promise((r) => setTimeout(r, 100));
await oa.signOut({ id, url: 'https://c.example/mcp' });
console.log('after sign-out, token present:', store.has(`mcp:${id}:oauth`));
release();
await refresh.catch((e) => console.log('refresh ended with', e.code));
console.log('after the refresh finished, token present:', store.has(`mcp:${id}:oauth`), store.has(`mcp:${id}:oauth`) ? '(signed-out connector holds a live token again)' : '');
