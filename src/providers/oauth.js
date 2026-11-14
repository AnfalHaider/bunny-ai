/**
 * OAuth: signing in to a provider without typing a key.
 *
 * The device-code flow is the one that fits a local app: the app asks the
 * provider for a code, the person types it on the provider's own page, and
 * the app waits for the token.
 *
 * The endpoints live in the provider catalogue, so a person can point Bunny AI
 * at a different authorisation server in Settings.
 */

import { ConnectError } from '../providers/errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Ask the provider for a code the person can type.
 *
 * @param {{oauth: object}} provider
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 */
export async function startDeviceFlow(provider, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const config = provider?.oauth;
  if (!config?.deviceCodeUrl) {
    throw new ConnectError('oauth.notConfigured', 'This provider has no sign-in address configured', 'oauth');
  }

  const body = new URLSearchParams({
    client_id: config.clientId ?? 'bunny-ai',
    scope: config.scopes ?? '',
  });
  if (config.deviceCodeUrl.includes('github.com')) {
    // GitHub wants the client id in the body and nothing else.
    body.delete('scope');
    body.set('scope', config.scopes ?? 'read:user');
  }

  const res = await fetchJson(config.deviceCodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  }, { fetchImpl, timeoutMs });

  if (!res.device_code && !res.deviceCode) {
    throw new ConnectError('oauth.noCode', 'The provider did not give a sign-in code', 'oauth');
  }

  return {
    deviceCode: res.device_code ?? res.deviceCode,
    userCode: res.user_code ?? res.userCode ?? '',
    verificationUri: res.verification_uri ?? res.verificationUri ?? config.verificationUri ?? '',
    verificationUriComplete: res.verification_uri_complete ?? '',
    interval: Math.max(1, Number(res.interval ?? 5)),
    expiresIn: Number(res.expires_in ?? 900),
  };
}

/**
 * Ask for the token, once.
 *
 * @returns {Promise<{done: boolean, token?: string, error?: string}>}
 */
export async function pollForToken(provider, deviceCode, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const config = provider?.oauth;
  if (!config?.tokenUrl) {
    throw new ConnectError('oauth.notConfigured', 'This provider has no sign-in address configured', 'oauth');
  }

  const body = new URLSearchParams({
    client_id: config.clientId ?? 'bunny-ai',
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  let res;
  try {
    res = await fetchJson(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    }, { fetchImpl, timeoutMs });
  } catch (err) {
    if (err instanceof ConnectError && err.code === 'oauth.http') return { done: false, error: 'not ready' };
    throw err;
  }

  if (res.access_token) return { done: true, token: res.access_token };
  if (res.error === 'authorization_pending' || res.error === 'slow_down') return { done: false };
  if (res.error) throw new ConnectError('oauth.denied', `The provider said: ${res.error}`, 'oauth');
  return { done: false };
}

/** Wait for the token, up to the time the provider allowed. */
export async function waitForToken(provider, deviceCode, { interval = 5, expiresIn = 900, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const deadline = now() + expiresIn * 1000;
  while (now() < deadline) {
    const result = await pollForToken(provider, deviceCode, { fetchImpl });
    if (result.done) return result;
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
  throw new ConnectError('oauth.timeout', 'The sign-in was not finished in time', 'oauth');
}

/** Read JSON, whatever content type the provider used. */
async function fetchJson(url, options, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ConnectError('oauth.timeout', 'The provider did not answer in time', 'oauth');
    throw new ConnectError('oauth.unreachable', `Could not reach ${url}`, 'oauth');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new ConnectError('oauth.http', `The provider answered ${res.status}`, 'oauth');

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Some providers answer as form-encoded text.
    const params = new URLSearchParams(text);
    const out = {};
    for (const [key, value] of params) out[key] = value;
    if (Object.keys(out).length) return out;
    throw new ConnectError('oauth.malformed', 'The provider sent something unexpected', 'oauth');
  }
}
