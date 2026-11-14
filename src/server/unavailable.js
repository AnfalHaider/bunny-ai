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

  return { mark, forProvider, clear, all };
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
