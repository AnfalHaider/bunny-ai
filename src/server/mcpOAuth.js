/**
 * Signing in to MCP connectors that need OAuth.
 *
 * Discovery (RFC 9728 + RFC 8414), a public client (RFC 7591 registration or a
 * pasted client id), the authorization-code flow with PKCE S256 and the
 * resource indicator (RFC 8707), refresh with a single flight, and sign-out
 * with revocation (RFC 7009).
 *
 * Safety habits, copied from accounts.js and tightened:
 *  - the pending sign-in lives only in memory, is one-time, expires, and is capped;
 *  - tokens live only in the secret store (key `mcp:<serverId>:oauth`), never in a
 *    file, a log, an error message or anything the window can read;
 *  - every endpoint must be https (http only for this PC), redirects are refused,
 *    answers are capped at 1 MB and each call times out.
 */
import { createHash, randomBytes } from 'node:crypto';
import { McpError } from './mcp.js';

const FLOW_MS = 5 * 60_000;
const MAX_PENDING = 8;
const MAX_BODY = 1024 * 1024;
const REQUEST_MS = 15_000;
const REFRESH_SKEW_MS = 60_000;
const CALLBACK_PATH = '/api/connectors/oauth/callback';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** An address on this computer or this network (not the internet): loopback in any spelling, 0.0.0.0, private and link-local ranges. */
function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '[::1]' || h === '[::]' || h === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return /^\[(::1|::ffff:|fe80:|fc|fd)/i.test(h);
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
const notRemoteSafe = (url) => { const u = new URL(url); return u.protocol !== 'https:' || isLocalHost(u.hostname); };

const tokenKey = (serverId) => `mcp:${serverId}:oauth`;
const clientKey = (issuer) => `mcp-oauth-client:${issuer}|${CALLBACK_PATH}`; // the port is left out: a new client is not registered at every launch

function fail(message, code = 'mcp.oauth') {
  return new McpError(message, code);
}

/** An endpoint is fine when it is https, or http on this PC; never with a password in it. */
function checkUrl(value, what) {
  let u;
  try { u = new URL(String(value)); } catch { throw fail(`The ${what} address is not a valid address.`, 'mcp.oauth.badUrl'); }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
  if (!ok || u.username || u.password) {
    throw fail(`The ${what} must use https, so Bunny AI will not use it.`, 'mcp.oauth.badUrl');
  }
  return u;
}

/** Only a short, plain error code from a provider is ever repeated. */
function plainCode(value) {
  return typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : null;
}

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
}

function decodeIdToken(idToken) {
  try {
    const part = String(idToken).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {{get: Function, set: Function, delete: Function}} o.secrets
 * @param {string} o.redirectBase e.g. http://127.0.0.1:4545
 */
export function createMcpOAuth({ secrets, redirectBase, now = () => Date.now(), fetchImpl = globalThis.fetch, requestMs = REQUEST_MS, clientName = 'Bunny AI' }) {
  const base = checkUrl(redirectBase, 'redirect address');
  if (!LOOPBACK.has(base.hostname)) throw fail('The sign-in return address must be on this PC.', 'mcp.oauth.badUrl');
  const redirectUri = `${base.origin}${CALLBACK_PATH}`;

  const pending = new Map(); // state -> flow, oldest first
  const refreshing = new Map(); // serverId -> promise
  const metaCache = new Map(); // issuer -> authorization-server metadata

  // ---- one safe request ----

  async function request(url, { method = 'GET', headers = {}, body = undefined, what = 'server' } = {}) {
    const u = checkUrl(url, what);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestMs);
    try {
      let res;
      try {
        res = await fetchImpl(u.href, { method, headers, body, redirect: 'error', signal: controller.signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw fail(`${u.host} did not answer in time.`, 'mcp.timeout');
        throw fail(`Could not reach ${u.host}, or it tried to send Bunny AI somewhere else (which is refused).`, 'mcp.unreachable');
      }
      const text = await readLimited(res, u.host);
      return { status: res.status, ok: res.status >= 200 && res.status < 300, type: res.headers.get('content-type') ?? '', text };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readLimited(res, host) {
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BODY) throw fail(`${host} sent an answer that is too large.`, 'mcp.oauth.tooLarge');
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body ?? []) {
        size += chunk.length;
        if (size > MAX_BODY) throw fail(`${host} sent an answer that is too large.`, 'mcp.oauth.tooLarge');
        chunks.push(chunk);
      }
    } catch (err) {
      if (err instanceof McpError) { try { await res.body?.cancel?.(); } catch { /* done */ } throw err; }
      throw fail(`The answer from ${host} was cut short.`, 'mcp.unreachable');
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const parseJson = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };

  async function getJson(url, what) {
    const r = await request(url, { headers: { accept: 'application/json' }, what });
    if (!r.ok) return null;
    return parseJson(r.text);
  }

  // ---- discovery ----

  /** A connector out on the internet may not point sign-in at an address on this computer: everything discovered must then be https. */
  function assertScope(meta, serverUrl) {
    if (!serverUrl || LOOPBACK.has(new URL(serverUrl).hostname)) return meta;
    for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint', 'userinfo_endpoint']) {
      if (meta[field] && notRemoteSafe(meta[field])) throw fail('This connector pointed sign-in at an address on this computer, so Bunny AI refuses it.', 'mcp.oauth.badUrl');
    }
    return meta;
  }

  async function authServerMetadata(issuerUrl, serverUrl = null) {
    const issuer = checkUrl(issuerUrl, 'sign-in server');
    const key = issuer.origin + (issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, ''));
    if (metaCache.has(key)) return assertScope(metaCache.get(key), serverUrl);
    const path = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '');
    const candidates = [
      `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
      `${issuer.origin}/.well-known/openid-configuration${path}`,
      `${issuer.origin}${path}/.well-known/openid-configuration`,
    ];
    let meta = null;
    for (const url of candidates) {
      meta = await getJson(url, 'sign-in server information');
      if (meta) break;
    }
    if (!meta) throw fail(`${issuer.host} does not describe how to sign in, so Bunny AI cannot sign in to this connector.`, 'mcp.oauth.noMetadata');
    if (meta.issuer !== undefined && String(meta.issuer).replace(/\/$/, '') !== key) {
      throw fail(`${issuer.host} described a different sign-in server than the one it named, so Bunny AI refuses it.`, 'mcp.oauth.issuerMismatch');
    }
    const clean = { issuer: key };
    for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint', 'userinfo_endpoint']) {
      if (meta[field] === undefined) continue;
      clean[field] = checkUrl(meta[field], field.replace(/_/g, ' ')).href;
    }
    if (!clean.authorization_endpoint || !clean.token_endpoint) {
      throw fail(`${issuer.host} does not offer the sign-in Bunny AI needs.`, 'mcp.oauth.noMetadata');
    }
    if (Array.isArray(meta.code_challenge_methods_supported) && !meta.code_challenge_methods_supported.includes('S256')) {
      throw fail(`${issuer.host} does not support the safe sign-in method (PKCE) Bunny AI requires.`, 'mcp.oauth.noPkce');
    }
    if (Array.isArray(meta.scopes_supported)) clean.scopes_supported = meta.scopes_supported.filter((s) => typeof s === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s)).slice(0, 50);
    metaCache.set(key, clean);
    return assertScope(clean, serverUrl);
  }

  /** Find how to sign in to a server. Returns { issuer, meta, scope }. */
  async function discover(server, { resourceMetadataUrl = null } = {}) {
    const target = checkUrl(server?.url, 'connector address');
    const remote = !LOOPBACK.has(target.hostname);
    if (remote && resourceMetadataUrl && notRemoteSafe(resourceMetadataUrl)) throw fail('This connector pointed sign-in at an address on this computer, so Bunny AI refuses it.', 'mcp.oauth.badUrl');
    const prmUrl = resourceMetadataUrl ? checkUrl(resourceMetadataUrl, 'protected-resource information').href : `${target.origin}/.well-known/oauth-protected-resource`;
    const prm = await getJson(prmUrl, 'protected-resource information');
    let issuerUrl;
    let scopes = null;
    if (prm && Array.isArray(prm.authorization_servers) && typeof prm.authorization_servers[0] === 'string') {
      issuerUrl = prm.authorization_servers[0];
      if (Array.isArray(prm.scopes_supported)) scopes = prm.scopes_supported;
    } else if (resourceMetadataUrl) {
      throw fail('This connector did not say which server to sign in with.', 'mcp.oauth.noMetadata');
    } else {
      issuerUrl = target.origin; // fall back to the connector's own origin
    }
    if (remote && notRemoteSafe(issuerUrl)) throw fail('This connector pointed sign-in at an address on this computer, so Bunny AI refuses it.', 'mcp.oauth.badUrl');
    const meta = await authServerMetadata(issuerUrl, target.href);
    const list = (scopes ?? meta.scopes_supported ?? []).filter((s) => typeof s === 'string');
    return { issuer: meta.issuer, meta, scope: list.length ? list.join(' ') : null };
  }

  // ---- the client ----

  async function clientFor(meta, pastedClientId) {
    const given = String(pastedClientId ?? '').trim();
    const key = clientKey(meta.issuer);
    if (given) {
      if (given.length > 300 || /[\s"]/.test(given)) throw fail('That client ID does not look right.', 'mcp.oauth.badClient');
      await secrets.set(key, JSON.stringify({ client_id: given }));
      return given;
    }
    const saved = parseJson(await secrets.get(key));
    if (saved && typeof saved.client_id === 'string' && saved.client_id) return saved.client_id;
    const host = new URL(meta.issuer).host;
    if (!meta.registration_endpoint) {
      throw fail(`${host} does not let apps register themselves. Paste the client ID from ${host}'s developer settings to continue.`, 'mcp.oauth.needsClientId');
    }
    const r = await request(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      what: 'registration address',
    });
    const answer = parseJson(r.text);
    if (!r.ok || !answer || typeof answer.client_id !== 'string' || !answer.client_id) {
      throw fail(`${host} would not register Bunny AI. Paste a client ID from its developer settings to continue.`, 'mcp.oauth.registerFailed');
    }
    await secrets.set(key, JSON.stringify({ client_id: answer.client_id }));
    return answer.client_id;
  }

  // ---- sign in ----

  function dropExpired() {
    for (const [state, flow] of pending) if (now() > flow.expiresAt) pending.delete(state);
  }

  /** Begin a sign-in. Returns the address to open in the person's browser. */
  async function startSignIn(server, { clientId = null, resourceMetadataUrl = null } = {}) {
    if (!server?.id) throw fail('Unknown connector.', 'mcp.notFound');
    const { issuer, meta, scope } = await discover(server, { resourceMetadataUrl });
    const client = await clientFor(meta, clientId);
    const verifier = randomBytes(48).toString('base64url'); // 64 characters
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const expiresAt = now() + FLOW_MS;
    dropExpired();
    pending.set(state, { serverId: server.id, serverUrl: new URL(server.url).href, issuer, client, verifier, expiresAt });
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
    const url = new URL(meta.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', client);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('resource', new URL(server.url).href);
    if (scope) url.searchParams.set('scope', scope);
    return { authUrl: url.href, state, expiresAt };
  }

  /** Is this a sign-in Bunny started and nobody has finished? (peek: does not use it up) */
  function flowKnown(state) {
    const flow = pending.get(String(state ?? ''));
    return Boolean(flow) && now() <= flow.expiresAt;
  }

  /** The person came back from the provider. One use only. */
  async function completeSignIn({ state, code, error, iss } = {}) {
    const key = String(state ?? '');
    const flow = pending.get(key);
    pending.delete(key); // used up, whatever happens next
    if (!flow || now() > flow.expiresAt) throw fail('This sign-in link has expired or was already used. Start again from Bunny AI.', 'mcp.oauth.badState');
    // RFC 9207: a provider that names itself in the answer must name the one this sign-in started with (mix-up protection)
    if (iss !== undefined && iss !== null && String(iss).replace(/\/$/, '') !== String(flow.issuer).replace(/\/$/, '')) {
      throw fail('The answer came from a different sign-in server than the one Bunny AI started with, so it was ignored.', 'mcp.oauth.issuerMismatch');
    }
    if (error) {
      const why = plainCode(error);
      throw fail(why === 'access_denied' ? 'The sign-in was cancelled, so nothing was connected.' : `The provider did not finish the sign-in${why ? ` (${why})` : ''}.`, 'mcp.oauth.denied');
    }
    if (typeof code !== 'string' || !code || code.length > 2000) throw fail('The provider did not send a sign-in code.', 'mcp.oauth.noCode');
    const meta = await authServerMetadata(flow.issuer, flow.serverUrl);
    const tokens = await tokenRequest(meta, {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: flow.client, code_verifier: flow.verifier, resource: flow.serverUrl,
    });
    const account = await accountName(meta, tokens);
    await secrets.set(tokenKey(flow.serverId), JSON.stringify({
      access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null, expires_at: tokens.expires_at,
      scope: tokens.scope ?? null, account, issuer: flow.issuer, client_id: flow.client, origin: new URL(flow.serverUrl).origin,
    }));
    return { serverId: flow.serverId, account };
  }

  async function tokenRequest(meta, params) {
    const host = new URL(meta.token_endpoint).host;
    const r = await request(meta.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      what: 'token address',
    });
    const answer = /json/i.test(r.type) ? parseJson(r.text) : null;
    if (!answer) throw fail(`${host} answered in a way Bunny AI cannot use.`, 'mcp.oauth.badAnswer');
    if (!r.ok) {
      const err = fail(`${host} refused the sign-in${plainCode(answer.error) ? ` (${plainCode(answer.error)})` : ''}.`, 'mcp.oauth.refused');
      err.oauthError = plainCode(answer.error);
      throw err;
    }
    if (typeof answer.access_token !== 'string' || !answer.access_token || answer.access_token.length > 20_000
      || String(answer.token_type ?? '').toLowerCase() !== 'bearer') {
      throw fail(`${host} answered in a way Bunny AI cannot use.`, 'mcp.oauth.badAnswer');
    }
    const lifetime = Number(answer.expires_in);
    const seconds = Number.isFinite(lifetime) && lifetime > 0 && lifetime <= 31_536_000 ? lifetime : 3600;
    return {
      access_token: answer.access_token,
      refresh_token: typeof answer.refresh_token === 'string' && answer.refresh_token ? answer.refresh_token : null,
      expires_at: now() + seconds * 1000,
      scope: typeof answer.scope === 'string' ? answer.scope.slice(0, 1000) : null,
      id_token: typeof answer.id_token === 'string' ? answer.id_token : null,
    };
  }

  async function accountName(meta, tokens) {
    const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : null; // display only, not trusted for anything else
    let name = cleanName(claims?.email || claims?.name || claims?.preferred_username);
    if (!name && meta.userinfo_endpoint) {
      try {
        const r = await request(meta.userinfo_endpoint, { headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` }, what: 'account address' });
        const info = r.ok ? parseJson(r.text) : null;
        name = cleanName(info?.email || info?.name || info?.preferred_username);
      } catch { /* the host name will do */ }
    }
    return name || new URL(meta.issuer).host;
  }

  // ---- tokens ----

  async function readTokens(serverId) {
    const raw = await secrets.get(tokenKey(serverId));
    return raw ? parseJson(raw) : null;
  }

  /** W36-1: a token is only ever sent to the origin it was given for, and only over https (or this PC). A changed address gets nothing. */
  function belongsTo(saved, server) {
    try {
      const u = new URL(server?.url);
      return typeof saved?.origin === 'string' && saved.origin === u.origin && (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname)));
    } catch { return false; }
  }

  /** Headers for a request to the connector. Refreshes first when the token is about to run out. */
  async function authHeader(server, { refresh = false } = {}) {
    const id = server?.id;
    if (!id) return {};
    let saved = await readTokens(id);
    if (!saved?.access_token || !belongsTo(saved, server)) return {};
    if (refresh || saved.expires_at - now() < REFRESH_SKEW_MS) saved = await refreshOnce(id, saved, server);
    return { authorization: `Bearer ${saved.access_token}` };
  }

  /** The function mcp.js wants as `auth`. */
  const authFor = (server) => (opts) => authHeader(server, opts);

  function refreshOnce(id, saved, server) {
    if (!refreshing.has(id)) {
      const run = doRefresh(id, saved, server).finally(() => refreshing.delete(id));
      refreshing.set(id, run);
    }
    return refreshing.get(id);
  }

  async function doRefresh(id, saved, server) {
    const needsSignIn = () => new McpError('This connector needs you to sign in.', 'mcp.needsSignIn', { signInUrl: null });
    if (!saved.refresh_token) {
      await secrets.delete(tokenKey(id));
      throw needsSignIn();
    }
    let tokens;
    try {
      const meta = await authServerMetadata(saved.issuer, server?.url);
      tokens = await tokenRequest(meta, {
        grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.client_id,
        ...(server?.url ? { resource: new URL(server.url).href } : {}),
      });
    } catch (err) {
      if (err?.oauthError === 'invalid_grant' || err?.oauthError === 'invalid_client') {
        await secrets.delete(tokenKey(id));
        throw needsSignIn();
      }
      throw fail('Bunny AI could not renew the sign-in just now. Try again in a moment.', 'mcp.oauth.refreshFailed');
    }
    // re-read: the person may have signed out (or in again) while the provider was answering; then this answer is dropped
    const now_ = await readTokens(id);
    if (!now_?.access_token || now_.refresh_token !== saved.refresh_token || now_.client_id !== saved.client_id) throw needsSignIn();
    const next = {
      ...saved,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? saved.refresh_token, // a rotated one replaces the old
      expires_at: tokens.expires_at,
      scope: tokens.scope ?? saved.scope,
    };
    await secrets.set(tokenKey(id), JSON.stringify(next));
    return next;
  }

  /** What the window may know. Never a token. */
  async function status(server) {
    const saved = server?.id ? await readTokens(server.id) : null;
    if (!saved?.access_token || !belongsTo(saved, server)) return { signedIn: false, account: null, expiresAt: null };
    return { signedIn: true, account: saved.account ?? null, expiresAt: saved.expires_at ?? null };
  }

  // ---- sign out ----

  async function signOut(server) {
    if (server?.id && refreshing.has(server.id)) await refreshing.get(server.id).catch(() => {}); // a renewal in flight finishes first, then the token is removed
    const saved = server?.id ? await readTokens(server.id) : null;
    if (!server?.id) return { revoked: false, message: 'Nothing to sign out of.' };
    let revoked = false;
    let host = null;
    let hadEndpoint = false;
    try {
      if (saved) {
        host = new URL(saved.issuer).host;
        const meta = await authServerMetadata(saved.issuer, server?.url).catch(() => null);
        if (meta?.revocation_endpoint) {
          hadEndpoint = true;
          const attempts = [];
          if (saved.refresh_token) attempts.push(['refresh_token', saved.refresh_token]);
          if (saved.access_token) attempts.push(['access_token', saved.access_token]);
          for (const [hint, token] of attempts) {
            try {
              const r = await request(meta.revocation_endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
                body: new URLSearchParams({ token, token_type_hint: hint, client_id: saved.client_id }).toString(),
                what: 'revoke address',
              });
              if (r.ok) revoked = true;
            } catch { /* try the next one */ }
          }
        }
      }
    } finally {
      await secrets.delete(tokenKey(server.id)); // gone here whatever the provider said
    }
    if (!saved) return { revoked: false, message: 'You were not signed in.' };
    if (revoked) return { revoked: true, message: `Signed out, and ${host} was told to end the access.` };
    if (hadEndpoint) return { revoked: false, message: `Signed out here; ${host} did not confirm it ended the access, so remove it in your account there if you want it gone.` };
    return { revoked: false, message: `Signed out here; ${host} has no way to revoke the access, so remove it in your account there if you want it gone.` };
  }

  return { discover, startSignIn, completeSignIn, flowKnown, authHeader, authFor, status, signOut, redirectUri };
}
