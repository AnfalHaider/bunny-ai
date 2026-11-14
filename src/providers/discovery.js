/**
 * Model discovery.
 *
 * Every provider worth supporting publishes a model list, but never in quite
 * the same shape. This normalises them into one record and refuses to invent
 * fields that the provider did not send.
 */

import { ConnectError } from './connections.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {{ id: string, displayName: string, ownedBy: string|null, contextLength: number|null }} Model
 */

/**
 * Turn whatever the provider sent into a stable, de-duplicated, sorted list.
 * @param {unknown} payload
 * @returns {Model[]}
 */
export function normalizeModels(payload) {
  const rows =
    Array.isArray(payload) ? payload
      : Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.models) ? payload.models
          : null;

  if (!rows) throw new ConnectError('discovery.malformed', 'The provider returned an unexpected model list');

  const seen = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    // Google names its models "models/gemini-..."; the chat API wants the
    // bare name.
    const raw = String(row.id ?? row.name ?? row.model ?? '').trim();
    const id = raw.replace(/^models\//, '');
    if (!id) continue;

    seen.set(id, {
      id,
      displayName: String(row.display_name ?? row.displayName ?? row.name ?? id),
      ownedBy: row.owned_by ?? row.owner ?? null,
      contextLength: numberOrNull(row.context_length ?? row.max_context_length ?? row.context_window),
      free: isFree(row, id),
      // What goes in and comes out (OpenRouter publishes this); kept only when the provider says.
      ...(Array.isArray(row.architecture?.input_modalities) ? { inputModalities: row.architecture.input_modalities } : {}),
      ...(Array.isArray(row.architecture?.output_modalities) ? { outputModalities: row.architecture.output_modalities } : {}),
    });
  }

  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A model costs nothing when the provider prices it at zero (OpenRouter publishes
 * prompt and completion prices) or names it as free (":free", "-free").
 */
function isFree(row, id) {
  if (/(?::|-)free$/i.test(id)) return true;
  const price = row.pricing;
  if (!price || typeof price !== 'object') return false;
  const parts = ['prompt', 'completion'].filter((k) => price[k] !== undefined);
  return parts.length > 0 && parts.every((k) => Number(price[k]) === 0);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Where a local server may keep its model list.
 *
 * Ollama serves /api/tags at the root and its OpenAI-compatible API under
 * /v1, so both are tried before the server is called unreachable.
 */
export function localCandidates(baseUrl) {
  const root = String(baseUrl).replace(/\/v1$/, '');
  return [`${root}/api/tags`, `${root}/v1/models`, `${baseUrl}/models`];
}

/**
 * Ask a provider which models it serves.
 *
 * A local server usually speaks its own dialect, so a local provider is asked
 * at more than one address.
 *
 * @param {{ baseUrl: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number, local?: boolean }} opts
 * @returns {Promise<Model[]>}
 */
export async function discoverModels({
  baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, local = false, auth = null,
}) {
  const headers = { accept: 'application/json' };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    // Some providers keep their model list behind their own header.
    if (auth?.header) headers[auth.header] = apiKey;
    if (auth?.extra) Object.assign(headers, auth.extra);
  }

  const candidates = local ? localCandidates(baseUrl) : [`${baseUrl}/models`];
  let lastError = null;

  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      lastError = err?.name === 'AbortError'
        ? new ConnectError('discovery.timeout', 'The provider did not answer in time')
        : new ConnectError('discovery.unreachable', `Could not reach ${baseUrl}`);
      continue;
    }
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      throw new ConnectError('discovery.unauthorized', 'The provider rejected that key');
    }
    if (!res.ok) {
      lastError = new ConnectError('discovery.http', `The provider answered ${res.status}`);
      continue;
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      lastError = new ConnectError('discovery.malformed', 'The provider did not return JSON');
      continue;
    }
    return normalizeModels(payload);
  }

  throw lastError ?? new ConnectError('discovery.unreachable', `Could not reach ${baseUrl}`);
}
