/**
 * Provider connection registry: validation, probing, and secret handling.
 *
 * Rules this enforces, because they are the ones that bite later:
 *  - a secret is never returned by list(); callers get a masked preview
 *  - a failed probe stores nothing, so a bad key cannot look "connected"
 *  - plain http is refused except for loopback/local providers
 *  - every provider id must exist in the catalogue
 */

import { findProvider, PROVIDERS } from './catalog.js';
import { ConnectError } from './errors.js';
import { discoverModels, localCandidates } from './discovery.js';

export { ConnectError, defaultProbe };

/** @typedef {'disconnected'|'connecting'|'connected'|'error'} Status */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** @param {string} value */
export function maskSecret(value) {
  if (!value) return '';
  const tail = value.slice(-4);
  const dash = value.indexOf('-');
  const prefix = dash > 0 && dash <= 10 ? value.slice(0, dash + 1) : '';
  return `${prefix}…${tail}`;
}

/**
 * @param {string} raw
 * @param {{ allowHttp?: boolean, field?: string }} [opts]
 */
export function parseBaseUrl(raw, opts = {}) {
  const field = opts.field ?? 'baseUrl';
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new ConnectError('baseUrl.invalid', 'Enter a full URL, for example https://api.example.com/v1', field);
  }
  if (url.protocol === 'http:' && !opts.allowHttp && !LOOPBACK.has(url.hostname)) {
    throw new ConnectError('baseUrl.insecure', 'Use https, or keep the server on this machine', field);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectError('baseUrl.scheme', 'Only http and https URLs are supported', field);
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * Validate one provider's form input into a storable config.
 * Pure: no network, no storage.
 */
export function validateInput(provider, input = {}) {
  if (provider.kind === 'oauth') {
    // A sign-in provider takes no typed secret: the token arrives from the
    // device flow, not from the form.
    return { baseUrl: provider.oauth?.baseUrl ?? provider.defaultBaseUrl ?? '' };
  }

  /** @type {{ baseUrl: string, apiKey?: string }} */
  const config = { baseUrl: '' };

  if (provider.kind === 'local') {
    const raw = String(input.baseUrl ?? provider.defaultBaseUrl ?? '').trim();
    if (!raw) throw new ConnectError('baseUrl.required', 'Server URL is required', 'baseUrl');
    config.baseUrl = parseBaseUrl(raw, { allowHttp: true });
    return config;
  }

  // apiKey providers
  const key = String(input.apiKey ?? '').trim();
  if (!key) throw new ConnectError('apiKey.required', 'API key is required', 'apiKey');
  if (key.length < 8) throw new ConnectError('apiKey.short', 'That key looks too short', 'apiKey');
  if (/\s/.test(key)) throw new ConnectError('apiKey.whitespace', 'Remove spaces or line breaks from the key', 'apiKey');
  config.apiKey = key;

  const rawUrl = String(input.baseUrl ?? provider.defaultBaseUrl ?? '').trim();
  if (!rawUrl) throw new ConnectError('baseUrl.required', 'Base URL is required', 'baseUrl');
  config.baseUrl = parseBaseUrl(rawUrl);
  return config;
}

/**
 * Default probe.
 *
 * A 200 on /models does not prove the key is good: some providers publish their
 * model list publicly (Nvidia does), so a bad key looks identical to a good one.
 * So: ask anonymously first. If the endpoint demands auth, test the key against
 * it. If it answers anyone, the connection is real but the key stays unverified.
 */
async function defaultProbe({ baseUrl, apiKey, local = false, auth = null }, fetchImpl = globalThis.fetch) {
  const call = async (key) => {
    const headers = { accept: 'application/json' };
    if (key) {
      // Most providers want a bearer token; some want their own header.
      headers.authorization = `Bearer ${key}`;
      if (auth?.header) headers[auth.header] = key;
      if (auth?.extra) Object.assign(headers, auth.extra);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetchImpl(`${baseUrl}/models`, { headers, signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw new ConnectError('probe.timeout', 'Provider did not answer within 10s');
      throw new ConnectError('probe.failed', `Could not reach ${baseUrl}`);
    } finally {
      clearTimeout(timer);
    }
  };

  // A local server has no key to check: it is enough that it answers at all.
  if (local) {
    for (const url of localCandidates(baseUrl)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
        if (res.status < 500) return { ok: true, keyVerified: false };
      } catch {
        // Try the next address.
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ConnectError('probe.failed', `Could not reach ${baseUrl}`);
  }

  const anonymous = await call(undefined);
  const guarded = [400, 401, 403].includes(anonymous.status);

  // A 404 on the anonymous call is ambiguous: Google's OpenAI-compatible
  // model list answers 404 without a key and 400 "please pass a valid API
  // key" with a bad one. So a 404 with a key in hand is worth testing too.
  const ambiguous = anonymous.status === 404 && Boolean(apiKey);

  if (!guarded && !ambiguous) {
    if (anonymous.status >= 500) throw new ConnectError('probe.unavailable', `Provider returned ${anonymous.status}`);
    // Public list: reachable, key genuinely untested.
    return { ok: true, keyVerified: false };
  }

  if (!apiKey) throw new ConnectError('probe.unauthorized', 'This provider needs an API key');

  const signed = await call(apiKey);
  if (signed.status === 401 || signed.status === 403 || signed.status === 400) {
    throw new ConnectError('probe.unauthorized', 'The provider rejected that key');
  }
  if (signed.status >= 500) throw new ConnectError('probe.unavailable', `Provider returned ${signed.status}`);
  if (guarded) return { ok: true, keyVerified: true };
  // The anonymous list was 404 and the signed one was not a clear yes or no:
  // the key may still be fine, so connect without claiming it was verified.
  return { ok: true, keyVerified: false };
}

/**
 * @param {{
 *   secrets: { set(k: string, v: string): Promise<void>|void, get(k: string): Promise<string|null>|string|null, delete(k: string): Promise<void>|void },
 *   probe?: (config: { baseUrl: string, apiKey?: string }) => Promise<unknown>,
 *   catalog?: ReadonlyArray<any>
 * }} deps
 */
export function createProviderRegistry({ secrets, probe = defaultProbe, catalog: builtIn = PROVIDERS, discover = discoverModels, modelTtlMs = 5 * 60_000 }) {
  // The built-in providers, then any the person added (custom: true).
  const catalog = [...builtIn];
  /** @type {Map<string, { status: Status, baseUrl: string, maskedKey: string, lastError: string|null, connectedAt: string|null }>} */
  const state = new Map();
  /** @type {Map<string, { at: number, models: any[] }>} */
  const modelCache = new Map();

  const blank = (provider) => ({
    status: /** @type {Status} */ ('disconnected'),
    baseUrl: provider?.defaultBaseUrl ?? '',
    maskedKey: '',
    lastError: null,
    connectedAt: null,
    keyVerified: false,
  });

  /** Public projection: never includes the secret. */
  function list() {
    return catalog.map((provider) => {
      const s = state.get(provider.id) ?? blank(provider);
      return {
        id: provider.id,
        name: provider.name,
        tagline: provider.tagline,
        kind: provider.kind,
        recommended: Boolean(provider.recommended),
        custom: Boolean(provider.custom),
        docsUrl: provider.docsUrl ?? '',
        defaultBaseUrl: provider.defaultBaseUrl ?? '',
        // Which header the key belongs in. Names only, never the key itself.
        auth: provider.auth ?? null,
        status: s.status,
        baseUrl: s.baseUrl,
        maskedKey: s.status === 'connected' ? s.maskedKey : '',
        lastError: s.lastError,
        connectedAt: s.connectedAt,
        keyVerified: s.status === 'connected' ? s.keyVerified : false,
      };
    });
  }

  function requireProvider(id) {
    const provider = catalog.find((p) => p.id === id);
    if (!provider) throw new ConnectError('provider.unknown', `No provider with id "${id}"`);
    return provider;
  }

  async function connect(id, input) {
    const provider = requireProvider(id);
    const config = validateInput(provider, input);

    state.set(id, { ...blank(provider), baseUrl: config.baseUrl, status: 'connecting' });

    let probeResult;
    try {
      // A local server is probed differently: there is no key to verify.
      // Some providers want the key in their own header.
      probeResult = await probe({
        ...config,
        local: provider?.kind === 'local',
        auth: provider?.auth ?? null,
      });
    } catch (err) {
      const message = err instanceof ConnectError ? err.message : 'Could not verify this provider';
      state.set(id, { ...blank(provider), baseUrl: config.baseUrl, status: 'error', lastError: message });
      throw err instanceof ConnectError ? err : new ConnectError('probe.failed', message);
    }

    // Probe passed: only now does the secret exist.
    if (config.apiKey) await secrets.set(`provider:${id}`, config.apiKey);

    state.set(id, {
      status: 'connected',
      baseUrl: config.baseUrl,
      maskedKey: config.apiKey ? maskSecret(config.apiKey) : '',
      lastError: null,
      connectedAt: new Date().toISOString(),
      keyVerified: Boolean(probeResult?.keyVerified),
    });
    modelCache.delete(id);

    return list().find((p) => p.id === id);
  }

  async function disconnect(id) {
    const provider = requireProvider(id);
    await secrets.delete(`provider:${id}`);
    modelCache.delete(id);
    state.set(id, blank(provider));
    return list().find((p) => p.id === id);
  }

  /**
   * Connect a provider that signs in with a token.
   *
   * The token has just been issued by the provider, so there is nothing to
   * probe: it is stored, and the provider is connected.
   */
  async function connectWithToken(id, token) {
    const provider = requireProvider(id);
    if (provider.kind !== 'oauth') {
      throw new ConnectError('oauth.notApplicable', `${provider.name} is connected with a key, not a sign-in`);
    }
    const value = String(token ?? '').trim();
    if (!value) throw new ConnectError('oauth.noToken', 'No token was given', 'token');

    const baseUrl = provider.oauth?.baseUrl ?? provider.defaultBaseUrl ?? '';
    await secrets.set(`provider:${id}`, value);
    state.set(id, {
      ...blank(provider),
      baseUrl,
      status: 'connected',
      maskedKey: maskSecret(value),
      lastError: null,
      connectedAt: new Date().toISOString(),
      keyVerified: true,
    });
    modelCache.delete(id);
    return list().find((p) => p.id === id);
  }

  /**
   * Models this provider serves. Cached briefly, because every provider rate
   * limits model lists and the list rarely changes.
   */
  async function models(id, { refresh = false } = {}) {
    const provider = requireProvider(id);
    const current = state.get(id);

    if (!current || current.status !== 'connected') {
      throw new ConnectError('models.notConnected', `${provider.name} is not connected`);
    }

    const cached = modelCache.get(id);
    if (!refresh && cached && Date.now() - cached.at < modelTtlMs) return cached.models;

    const apiKey = await secrets.get(`provider:${id}`);
    const list = await discover({
      baseUrl: current.baseUrl,
      apiKey: apiKey ?? undefined,
      // A local server speaks its own dialect, so it is asked in more than one way.
      local: provider?.kind === 'local',
      auth: provider?.auth ?? null,
    });

    modelCache.set(id, { at: Date.now(), models: list });
    return list;
  }

  /**
   * Restore connections saved by a previous run, without re-probing.
   * The secret itself is already in the credential store; only metadata lives here.
   */
  function hydrate(entries = []) {
    for (const entry of entries) {
      const provider = catalog.find((p) => p.id === entry?.id);
      if (!provider) continue;
      state.set(entry.id, {
        status: 'connected',
        baseUrl: entry.baseUrl || provider.defaultBaseUrl || '',
        maskedKey: entry.maskedKey ?? '',
        lastError: null,
        connectedAt: entry.connectedAt ?? new Date().toISOString(),
        keyVerified: Boolean(entry.keyVerified),
      });
    }
  }

  /**
   * Add a provider the person describes: any server that speaks the OpenAI shape.
   * Replaces an earlier custom one with the same id; built-in ids are refused.
   */
  function addProvider(def) {
    const existing = catalog.findIndex((p) => p.id === def.id);
    if (existing >= 0 && !catalog[existing].custom) throw new ConnectError('provider.taken', 'That name belongs to a built-in provider', 'name');
    const provider = Object.freeze({ ...def, custom: true });
    if (existing >= 0) catalog.splice(existing, 1, provider); else catalog.push(provider);
    return provider;
  }

  async function removeProvider(id) {
    const at = catalog.findIndex((p) => p.id === id);
    if (at < 0 || !catalog[at].custom) throw new ConnectError('provider.notCustom', 'Only providers you added can be removed');
    await secrets.delete(`provider:${id}`);
    modelCache.delete(id);
    state.delete(id);
    catalog.splice(at, 1);
  }

  const find = (id) => catalog.find((p) => p.id === id) ?? null;

  return { list, connect, connectWithToken, disconnect, models, hydrate, addProvider, removeProvider, find };
}

/** Dev/test store. Not for real keys: process memory only. */
export function memorySecretStore() {
  const map = new Map();
  return {
    set: (k, v) => void map.set(k, v),
    get: (k) => map.get(k) ?? null,
    delete: (k) => void map.delete(k),
    _dump: () => [...map.keys()],
  };
}
