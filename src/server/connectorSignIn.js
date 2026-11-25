/**
 * W3-6: the routes behind signing in to a connector (see mcpOAuth.js for the engine).
 *
 *   POST /api/connectors/:id/oauth/start     window-only (the route table); body { clientId?, resourceMetadataUrl? } -> { authUrl, expiresAt }
 *   GET  /api/connectors/oauth/callback      the person's browser coming back; no page token (requestGuard lets it through only for a
 *                                            state that is pending), answers a small page that holds no secret
 *   GET  /api/connectors/:id/oauth           { signedIn, account, expiresAt, pending, error }: what the window polls; never a token
 *   POST /api/connectors/:id/oauth/signout   window-only; -> { revoked, message }
 *
 * The engine is made on first use: its return address needs the port the server really got.
 */
import { McpError } from './mcp.js';
import { createMcpOAuth } from './mcpOAuth.js';

export const NEEDS_SIGN_IN = 'This connector needs you to sign in.';
export const SIGN_IN_EXPIRED = 'Your sign-in expired. Sign in again.';
export const KEY_REFUSED = 'The service refused the key. Check it in Customize.';
/** A connector given a key of its own (a static Authorization or token header) is not signed in to: a 401 means the key is wrong. */
export const hasStaticKey = (server) => server?.type !== 'local' && (server?.hasKey === true || server?.keyed === true || Object.keys(server?.headers ?? {}).some((k) => /authorization|token|api[-_]?key|secret/i.test(k)));
const UUID = '[a-f0-9-]{36}';
const escapeHtml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

/** A message that is safe to show: only the engine's own plain sentences, never raw text from a provider or an exception. */
const plainMessage = (err, fallback) => (err instanceof McpError && /^mcp\./.test(err.code ?? '') ? err.message : fallback);

export function createConnectorSignIn({ secrets, mcp, getBase, now = () => Date.now(), createEngine = createMcpOAuth, engineOptions = {} }) {
  let engine = null;
  const oauth = () => (engine ??= createEngine({ secrets, redirectBase: getBase(), ...engineOptions }));
  const started = new Map();  // serverId -> { expiresAt }: a sign-in waiting for the person's browser
  const byState = new Map();  // state -> serverId, so a failed return can be told to the right connector
  const outcome = new Map();  // serverId -> message of the last failed return, until the next start
  const hints = new Map();    // serverId -> the resource_metadata address its last 401 named

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  };
  const failure = (res, err, status = 400) => json(res, status, { code: /^mcp\./.test(err?.code ?? '') ? err.code : 'mcp.oauth', message: plainMessage(err, 'The sign-in did not work. Try again.') });

  function page(res, ok, message) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(`<!doctype html><meta charset="utf-8"><title>Bunny AI</title><body style="font:16px system-ui;margin:48px;color:#222"><p>${escapeHtml(message)}</p></body>`);
    return true;
  }

  async function callback(res, query) {
    const state = query.get('state') ?? '';
    const waiting = byState.get(state);
    byState.delete(state);
    try {
      if (!oauth().flowKnown(state)) throw new McpError('This sign-in link has expired or was already used. Start again from Bunny AI.', 'mcp.oauth.badState');
      const done = await oauth().completeSignIn({ state, code: query.get('code') ?? undefined, error: query.get('error') ?? undefined, iss: query.get('iss') ?? undefined });
      started.delete(done.serverId);
      outcome.delete(done.serverId);
      if (!(await mcp.get(done.serverId))) {
        await oauth().signOut({ id: done.serverId }).catch(() => {}); // the connector was removed while the person was away
        return page(res, false, 'That connector is no longer in Bunny AI, so nothing was signed in.');
      }
      await mcp.setStatus(done.serverId, { status: 'unknown', error: null }); // its tools are asked for again with the new sign-in
      return page(res, true, 'Signed in. You can close this tab and go back to Bunny AI.');
    } catch (err) {
      const message = plainMessage(err, 'The sign-in did not finish. Start again from Bunny AI.');
      if (waiting) { outcome.set(waiting, message); started.delete(waiting); } // the window shows why
      return page(res, false, message);
    }
  }

  /** Handle one request; true when it was one of ours. `body` reads the JSON body. */
  async function handle(req, res, path, method, url, body) {
    if (path === '/api/connectors/oauth/callback' && method === 'GET') return callback(res, url.searchParams);
    const m = new RegExp(`^/api/connectors/(${UUID})/oauth(/start|/signout)?$`).exec(path);
    if (!m) return false;
    const server = await mcp.get(m[1]);
    if (!server) return json(res, 404, { code: 'mcp.notFound', message: 'No such connector' });
    if (server.type === 'local') return json(res, 400, { code: 'mcp.oauth.local', message: 'A local connector does not sign in this way.' });

    if (!m[2] && method === 'GET') {
      const status = await oauth().status(server);
      const wait = started.get(server.id);
      const pending = Boolean(wait) && now() <= wait.expiresAt && !status.signedIn;
      return json(res, 200, { ...status, pending, error: outcome.get(server.id) ?? null });
    }
    if (m[2] === '/start' && method === 'POST') {
      const b = (await body()) ?? {};
      const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      try {
        const out = await oauth().startSignIn(server, { clientId: text(b.clientId), resourceMetadataUrl: text(b.resourceMetadataUrl) ?? hints.get(server.id) ?? null });
        started.set(server.id, { expiresAt: out.expiresAt });
        byState.set(out.state, server.id);
        while (byState.size > 16) byState.delete(byState.keys().next().value);
        outcome.delete(server.id);
        return json(res, 200, { authUrl: out.authUrl, expiresAt: out.expiresAt });
      } catch (err) {
        return failure(res, err);
      }
    }
    if (m[2] === '/signout' && method === 'POST') {
      const out = await oauth().signOut(server);
      started.delete(server.id); outcome.delete(server.id); hints.delete(server.id);
      await mcp.setStatus(server.id, { status: 'unknown', error: null });
      return json(res, 200, out);
    }
    return false;
  }

  return {
    handle,
    flowKnown: (state) => engine?.flowKnown(state) === true,
    /** The `auth` argument for mcp.js; nothing for a local connector. */
    authFor: (server) => (server?.type === 'local' ? undefined : oauth().authFor(server)),
    /** A connector answered 401: remember where its sign-in starts, mark it, and say it in the shape the window and the chat use. */
    async needsSignIn(server, err) {
      if (hasStaticKey(server)) { // it has its own key: signing in would not help, so say the key was refused and offer no Sign in
        await mcp.setStatus(server.id, { status: 'error', error: KEY_REFUSED }).catch(() => {});
        return { code: 'mcp.keyRefused', message: KEY_REFUSED, signInUrl: null, serverId: server.id };
      }
      if (err?.signInUrl) hints.set(server.id, err.signInUrl);
      await mcp.setStatus(server.id, { status: 'needsSignIn', error: err?.expired ? SIGN_IN_EXPIRED : NEEDS_SIGN_IN }).catch(() => {});
      return { code: 'mcp.needsSignIn', message: NEEDS_SIGN_IN, signInUrl: err?.signInUrl ?? null, serverId: server.id, ...(err?.expired ? { expired: true } : {}) };
    },
    /** Deleting a connector ends its sign-in first. Best effort, and the stored token goes whatever the provider says. */
    async signOutQuietly(server) {
      try {
        await Promise.race([oauth().signOut(server), new Promise((resolve) => setTimeout(resolve, 5000).unref?.())]);
      } catch { /* the token is removed below */ }
      try { await secrets.delete(`mcp:${server.id}:oauth`); } catch { /* nothing saved */ } // the engine's key, in case the provider was slow
      started.delete(server.id); outcome.delete(server.id); hints.delete(server.id);
    },
  };
}
