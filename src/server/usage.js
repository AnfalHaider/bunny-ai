/**
 * Usage: what each provider has been used for.
 *
 * The numbers are estimates, not invoices: the app counts characters the same
 * way the context meter does, because that is the only number it can honestly
 * produce without asking the provider what it charged.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { estimateTokens } from './sessions.js';

export function createUsageStore({ file }) {
  let usage = {};
  let loaded = false;

  async function load() {
    if (loaded) return usage;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && typeof parsed === 'object') usage = parsed;
    } catch {
      usage = {};
    }
    loaded = true;
    return usage;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(usage, null, 2), 'utf8');
  }

  /** Count one exchange against a provider. */
  async function record({ providerId, model = null, messages = [] }) {
    if (!providerId) return;
    await load();
    const row = usage[providerId] ?? { messages: 0, tokens: 0, sessions: 0, models: {}, lastUsed: null };
    for (const message of messages) {
      const content = Array.isArray(message.content)
        ? message.content.map((part) => part.text ?? '').join(' ')
        : String(message.content ?? '');
      row.tokens += estimateTokens(content) + 4;
      row.messages += 1;
    }
    if (model) {
      row.models[model] = (row.models[model] ?? 0) + 1;
    }
    row.lastUsed = new Date().toISOString();
    usage[providerId] = row;
    await persist();
  }

  /** Count a chat against a provider when it is created or answered. */
  async function recordSession(providerId) {
    if (!providerId) return;
    await load();
    const row = usage[providerId] ?? { messages: 0, tokens: 0, sessions: 0, models: {}, lastUsed: null };
    row.sessions += 1;
    usage[providerId] = row;
    await persist();
  }

  async function list() {
    await load();
    return Object.entries(usage)
      .map(([providerId, row]) => ({ providerId, ...row }))
      .sort((a, b) => b.tokens - a.tokens);
  }

  async function total() {
    const rows = await list();
    return rows.reduce((sum, row) => sum + row.tokens, 0);
  }

  async function reset() {
    await load();
    usage = {};
    await persist();
  }

  return { list, total, record, recordSession, reset };
}
