/**
 * Models a provider offers but cannot actually serve.
 *
 * Some providers publish a whole catalogue and let each account use a subset:
 * Nvidia lists every model it has ever hosted, and answers "not found for
 * account" for the ones your key cannot reach. Remembering that keeps the
 * picker honest instead of offering a model that will only fail.
 */

import { readFile, writeFile } from 'node:fs/promises';

const MAX_PER_PROVIDER = 400;

export function createUnavailableStore({ file }) {
  let byProvider = {};
  let loaded = false;

  async function load() {
    if (loaded) return byProvider;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && typeof parsed === 'object') byProvider = parsed;
    } catch {
      byProvider = {};
    }
    loaded = true;
    return byProvider;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(byProvider, null, 2), 'utf8');
  }

  /** Remember that a model cannot be served. */
  async function mark(providerId, model, reason) {
    if (!providerId || !model) return null;
    await load();
    const rows = byProvider[providerId] ?? {};
    rows[model] = { reason: String(reason ?? '').slice(0, 300), at: new Date().toISOString() };
    const entries = Object.entries(rows).slice(-MAX_PER_PROVIDER);
    byProvider[providerId] = Object.fromEntries(entries);
    await persist();
    return rows[model];
  }

  async function forProvider(providerId) {
    await load();
    return byProvider[providerId] ?? {};
  }

  /** Forget one model, so a fixed account can use it again. */
  async function clear(providerId, model) {
    await load();
    const rows = byProvider[providerId];
    if (!rows?.[model]) return false;
    delete rows[model];
    await persist();
    return true;
  }

  async function all() {
    await load();
    return byProvider;
  }

  // W6-5: a provider that said "too many requests" or "free usage limit reached" is left alone for a while, across messages.
  const cooling = new Map();
  /** Leave a provider alone for `ms`; returns the time it is free again (ms since 1970). */
  function cool(providerId, ms) {
    if (!providerId || !(ms > 0)) return 0;
    const until = Math.max(cooling.get(providerId) ?? 0, Date.now() + ms);
    cooling.set(providerId, until);
    return until;
  }
  /** When the provider is free again, or 0 when it is not cooling. */
  function coolingUntil(providerId) {
    const until = cooling.get(providerId) ?? 0;
    if (until <= Date.now()) { cooling.delete(providerId); return 0; }
    return until;
  }

  return { mark, forProvider, clear, all, cool, coolingUntil };
}

/**
 * How many tokens the balance covers, when the provider says.
 *
 * OpenRouter answers "you requested up to 4096 tokens, but can only afford
 * 1599". Asking for 1599 works, so the number is worth using.
 */
export function affordableTokens(message) {
  const text = String(message ?? '');
  const match = text.match(/can only afford\s+(\d[\d,]*)/i);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Is this the "the model is being prepared for your account" case?
 *
 * Nvidia answers 404 "Not found for account" the first time a model is used,
 * and serves it on a later call. It is worth one retry, not a mark of shame.
 */
export function notProvisioned(message) {
  return String(message ?? '').toLowerCase().includes('not found for account');
}

/**
 * Does this failure mean the model itself is the problem?
 *
 * The wording differs per provider, so the shapes that matter are matched:
 * "not found for account", "end of life", "no longer available", "model is
 * unavailable", "does not exist".
 */
export function modelSpecificFailure(message) {
  const text = String(message ?? '').toLowerCase();
  if (!text) return null;
  const shapes = [
    'not found for account',
    'has reached its end of life',
    'no longer available',
    'model is unavailable',
    'model not found',
    'does not exist',
    'model_deprecated',
  ];
  return shapes.find((shape) => text.includes(shape)) ?? null;
}

/**
 * Sort a failed reply into who is at fault, so the page knows what to do next (T-3):
 *   model    this model did not work: try the next one          (timeout, rate-limit, unavailable, empty, refused)
 *   provider the whole provider is the problem: try another one (unreachable, key)
 *   other    not the model's fault (speech, no model chosen...): another model would not help
 */
export function failureKind(err, unavailable = false) {
  const code = err?.code ?? '';
  const message = String(err?.message ?? '');
  if (code === 'chat.stalled') return { scope: 'model', reason: 'timeout' };
  if (code === 'chat.unreachable') return { scope: 'provider', reason: 'unreachable' };
  if (code === 'chat.unauthorized') return { scope: 'provider', reason: 'key' };
  if (code === 'chat.empty') return { scope: 'model', reason: 'empty' };
  if (code === 'chat.refused') return { scope: 'model', reason: 'refused' };
  if (unavailable) return { scope: 'model', reason: 'unavailable' };
  if (/\b429\b|rate.?limit|overload|too many requests|busy|capacity|usage limit|quota/i.test(message)) return { scope: 'model', reason: 'rate-limit' };
  if (/\b5\d\d\b/.test(message)) return { scope: 'model', reason: 'unavailable' };
  if (/^(speech\.|model\.notSelected|provider\.notConnected|request\.)/.test(code)) return { scope: 'other', reason: 'other' };
  return { scope: 'model', reason: 'unavailable' };
}

/**
 * How long to leave a provider alone after it refused for rate or usage reasons (W6-5).
 * "Free usage limit reached" means the allowance is spent: an hour. A plain 429 or "busy" is a short breather.
 */
export function cooldownFor(message) {
  const text = String(message ?? '');
  if (/free (usage|tier)|usage limit|quota|exceeded your|credits? (have )?(run|ran) out/i.test(text)) return 60 * 60_000;
  if (/\b429\b|rate.?limit|too many requests|overload|capacity|busy/i.test(text)) return 2 * 60_000;
  return 0;
}
