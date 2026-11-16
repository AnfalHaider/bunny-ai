/**
 * Signing in with GitHub or Google.
 *
 * Bunny AI has no cloud account of its own: signing in links your GitHub or Google
 * identity to this copy of Bunny AI. The name, picture and email are kept in
 * account.json; the tokens go to the same Windows credential store the provider
 * keys use, and never come back out through the API.
 *
 * GitHub also gives the model its GitHub tools. Google is sign-in only for now
 * (name, email, picture), with the openid, email and profile scopes.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ghCliToken, githubClient } from './github.js';
import { GOOGLE_WORKSPACE_SCOPES } from './google.js';

// A Google sign-in return is honoured for a few minutes after it started, once.
const GOOGLE_FLOW_MS = 10 * 60_000;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER = 'https://openidconnect.googleapis.com/v1/userinfo';

export function createAccounts({ file, secrets, getSettings, fetchImpl = globalThis.fetch, cliToken = ghCliToken }) {
  const googleFlows = new Map(); // state -> { verifier, redirectUri, at }

  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
  }
  async function write(data) {
    await writeFile(file, JSON.stringify(data, null, 2));
  }

  /** What the window may know: profiles and which ways in are ready, never a token. */
  async function status() {
    const data = await read();
    const s = getSettings();
    return {
      github: data.github ?? null,
      google: data.google ?? null,
      githubDeviceReady: Boolean(s.githubClientId),
      googleReady: Boolean(s.googleClientId),
      googleWorkspaceOn: s.googleWorkspace === true,
    };
  }

  // ---- GitHub ----

  async function saveGithub(token, method) {
    const user = await githubClient(token, { fetchImpl }).user();
    await secrets.set('account:github', token);
    const data = await read();
    data.github = { login: user.login, name: user.name ?? user.login, avatar: user.avatar_url, email: user.email ?? null, url: user.html_url, method, connectedAt: new Date().toISOString() };
    await write(data);
    return data.github;
  }

  async function githubFromCli() {
    const token = await cliToken();
    if (!token) throw Object.assign(new Error('The GitHub CLI is not installed or not signed in. Run "gh auth login" first, or paste a token.'), { code: 'github.noCli' });
    return saveGithub(token, 'GitHub CLI');
  }

  async function githubFromToken(token) {
    const value = String(token ?? '').trim();
    if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(value)) {
      throw Object.assign(new Error('That does not look like a GitHub token (they start with ghp_, github_pat_ or gho_).'), { code: 'github.badToken' });
    }
    return saveGithub(value, 'Personal access token');
  }

  /** Device flow, with the client id of an OAuth app the person registered. */
  function githubDeviceConfig() {
    const clientId = getSettings().githubClientId;
    if (!clientId) throw Object.assign(new Error('Set a GitHub OAuth app client id in Settings first.'), { code: 'github.noClientId' });
    return {
      oauth: {
        clientId,
        deviceCodeUrl: 'https://github.com/login/device/code',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        verificationUri: 'https://github.com/login/device',
        scopes: 'repo read:user user:email',
      },
    };
  }

  async function githubToken() {
    return (await secrets.get('account:github')) ?? null;
  }

  async function signOut(which) {
    await secrets.delete(`account:${which}`);
    const data = await read();
    delete data[which];
    await write(data);
  }

  // ---- Google: OAuth for desktop apps, with PKCE, back to this app's own address ----

  function googleStart(origin) {
    const s = getSettings();
    if (!s.googleClientId) throw Object.assign(new Error('Set a Google OAuth client id in Settings first.'), { code: 'google.noClientId' });
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = `${origin}/api/account/google/callback`;
    googleFlows.set(state, { verifier, redirectUri, at: Date.now() });
    for (const [k, v] of googleFlows) if (Date.now() - v.at > GOOGLE_FLOW_MS) googleFlows.delete(k);
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: s.googleClientId, redirect_uri: redirectUri, response_type: 'code',
      // Gmail, Calendar and Drive only when the person switched them on; offline for a refresh token.
      scope: ['openid', 'email', 'profile', ...(s.googleWorkspace ? GOOGLE_WORKSPACE_SCOPES : [])].join(' '),
      access_type: 'offline', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent select_account',
    }).toString();
    return { url: url.toString() };
  }

  /** Is this `state` a sign-in Bunny started a few minutes ago and nobody has finished? (peek: does not use it up) */
  function googleFlowKnown(state) {
    const flow = googleFlows.get(String(state ?? ''));
    return Boolean(flow) && Date.now() - flow.at <= GOOGLE_FLOW_MS;
  }

  async function googleFinish({ code, state }) {
    const flow = googleFlows.get(String(state ?? ''));
    if (flow && Date.now() - flow.at > GOOGLE_FLOW_MS) googleFlows.delete(String(state));
    if (!googleFlowKnown(state)) throw new Error('This sign-in link has expired. Start again from Bunny AI.');
    googleFlows.delete(state);
    const s = getSettings();
    const res = await fetchImpl(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code ?? ''), client_id: s.googleClientId, ...(s.googleClientSecret ? { client_secret: s.googleClientSecret } : {}),
        redirect_uri: flow.redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier,
      }).toString(),
    });
    const tokens = await res.json().catch(() => ({}));
    if (!res.ok || !tokens.access_token) throw new Error(`Google did not finish the sign-in: ${tokens.error_description ?? tokens.error ?? res.status}`);
    const who = await fetchImpl(GOOGLE_USER, { headers: { authorization: `Bearer ${tokens.access_token}` } }).then((r) => r.json());
    await secrets.set('account:google', JSON.stringify({ refresh: tokens.refresh_token ?? null, access: tokens.access_token, expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 }));
    const data = await read();
    const granted = String(tokens.scope ?? '').split(' ');
    data.google = { name: who.name ?? who.email, email: who.email ?? null, avatar: who.picture ?? null, connectedAt: new Date().toISOString(),
      workspace: GOOGLE_WORKSPACE_SCOPES.every((sc) => granted.includes(sc)) };
    await write(data);
    return data.google;
  }

  /** A current access token for Gmail, Calendar and Drive, refreshed when it has run out; null when not signed in. */
  async function googleAccessToken() {
    const raw = await secrets.get('account:google');
    if (!raw) return null;
    let saved;
    try { saved = JSON.parse(raw); } catch { saved = { refresh: raw, access: null, expires: 0 }; }
    if (saved.access && saved.expires - Date.now() > 60_000) return saved.access;
    if (!saved.refresh) return null;
    const s = getSettings();
    const res = await fetchImpl(GOOGLE_TOKEN, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: s.googleClientId ?? '', ...(s.googleClientSecret ? { client_secret: s.googleClientSecret } : {}), refresh_token: saved.refresh, grant_type: 'refresh_token' }).toString(),
    });
    const fresh = await res.json().catch(() => ({}));
    if (!res.ok || !fresh.access_token) throw new Error(`Google would not renew the sign-in (${fresh.error ?? res.status}). Sign in again in Settings, Profile.`);
    await secrets.set('account:google', JSON.stringify({ ...saved, access: fresh.access_token, expires: Date.now() + (Number(fresh.expires_in) || 3600) * 1000 }));
    return fresh.access_token;
  }

  return { googleAccessToken, status, githubFromCli, githubFromToken, githubDeviceConfig, saveGithub, githubToken, signOut, googleStart, googleFinish, googleFlowKnown };
}
