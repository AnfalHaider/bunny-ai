/**
 * A stand-in for a connector that needs OAuth sign-in: an MCP server, its protected-resource
 * document and a sign-in server, all on one 127.0.0.1 port. Shared by the engine tests, the route tests and the e2e spec.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

/** The stand-in: MCP server + protected-resource metadata + sign-in server. */
export async function startFake(initial = {}, REDIRECT_BASE = 'http://127.0.0.1:45999') {
  const f = {
    opts: { registration: true, revocation: true, expiresIn: 3600, idToken: false, ...initial },
    codes: new Map(), access: new Set(), refresh: new Set(),
    tokenRequests: [], registrations: [], revoked: [], mcpAuth: [],
    seq: 0,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, f.base);
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      if (url.pathname === '/mcp') {
        const header = req.headers.authorization ?? '';
        f.mcpAuth.push(header);
        const token = header.replace(/^Bearer /, '');
        if (!f.access.has(token)) {
          return send(401, { error: 'secret raw 401 text' }, { 'www-authenticate': `Bearer realm="mcp", resource_metadata="${f.base}/.well-known/oauth-protected-resource"` });
        }
        const rpc = JSON.parse(body);
        return send(200, { jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'Ping' }] } : { content: [{ type: 'text', text: 'pong' }] } });
      }
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        if (f.opts.noPrm) return send(404, {});
        return send(200, { resource: `${f.base}/mcp`, authorization_servers: [f.opts.prmIssuer ?? f.base], scopes_supported: ['read', 'write'] });
      }
      if (url.pathname === '/.well-known/oauth-authorization-server' && !f.opts.openidOnly) {
        return send(200, metadata(f));
      }
      if (url.pathname === '/.well-known/openid-configuration' && f.opts.openidOnly) {
        return send(200, metadata(f));
      }
      if (url.pathname === '/register') {
        f.registrations.push(JSON.parse(body));
        return send(201, { client_id: `client-${++f.seq}` });
      }
      if (url.pathname === '/token') return token(f, new URLSearchParams(body), send);
      if (url.pathname === '/revoke') {
        const p = new URLSearchParams(body);
        f.revoked.push({ token: p.get('token'), hint: p.get('token_type_hint') });
        return send(200, {});
      }
      if (url.pathname === '/userinfo') return send(200, { email: 'sam@example.test' });
      if (url.pathname === '/hop') { res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); return res.end(); }
      if (url.pathname === '/big') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"x":"' + 'a'.repeat(1_100_000) + '"}'); }
      return send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  f.base = `http://127.0.0.1:${server.address().port}`;
  f.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  f.server = { id: 'srv-1', name: 'Fake', url: `${f.base}/mcp` };

  /** Play the browser: check the address the app made, hand back a code. */
  f.browse = (authUrl, { deny = false } = {}) => {
    const u = new URL(authUrl);
    const q = u.searchParams;
    assert.equal(u.origin + u.pathname, `${f.base}/authorize`);
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('redirect_uri'), `${REDIRECT_BASE}/api/connectors/oauth/callback`);
    assert.equal(q.get('resource'), `${f.base}/mcp`);
    if (deny) return { error: 'access_denied', state: q.get('state') };
    const code = `code-${++f.seq}`;
    f.codes.set(code, { challenge: q.get('code_challenge'), clientId: q.get('client_id') });
    return { code, state: q.get('state') };
  };
  return f;
}

function metadata(f) {
  return {
    issuer: f.opts.badIssuer ?? f.base,
    authorization_endpoint: f.opts.httpsOnlyBreak ? 'http://example.com/authorize' : `${f.base}/authorize`,
    token_endpoint: `${f.base}/token`,
    ...(f.opts.registration ? { registration_endpoint: `${f.base}/register` } : {}),
    ...(f.opts.revocation ? { revocation_endpoint: `${f.base}/revoke` } : {}),
    ...(f.opts.userinfo ? { userinfo_endpoint: `${f.base}/userinfo` } : {}),
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write'],
    unknown_field: { ignored: true },
  };
}

function token(f, p, send) {
  f.tokenRequests.push(Object.fromEntries(p));
  const issue = () => {
    const access = `at-${randomBytes(12).toString('hex')}`;
    const refresh = `rt-${randomBytes(12).toString('hex')}`;
    f.access.add(access); f.refresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: f.opts.expiresIn, scope: 'read write',
      ...(f.opts.idToken ? { id_token: `x.${Buffer.from(JSON.stringify({ email: 'pat@example.test' })).toString('base64url')}.y` } : {}) };
  };
  if (p.get('grant_type') === 'authorization_code') {
    const entry = f.codes.get(p.get('code'));
    f.codes.delete(p.get('code'));
    if (!entry) return send(400, { error: 'invalid_grant' });
    const check = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
    if (check !== entry.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
    return send(200, issue());
  }
  if (p.get('grant_type') === 'refresh_token') {
    if (f.opts.refreshFails || !f.refresh.has(p.get('refresh_token'))) return send(400, { error: 'invalid_grant' });
    f.refresh.delete(p.get('refresh_token')); // rotate
    return send(200, issue());
  }
  return send(400, { error: 'unsupported_grant_type' });
}

