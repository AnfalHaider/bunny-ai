/**
 * Memory: things the person asked to be remembered across chats.
 *
 * A memory is a short statement that is put in front of the model on every
 * message, so the answer can rely on it. Memories are written deliberately
 * (the /remember command or the memory screen), never guessed from a chat,
 * because a guess that is wrong is worse than no memory at all.
 *
 * Every memory can be switched off on its own, and the whole thing can be
 * switched off at once.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MAX_ENTRIES = 200;
const MAX_LENGTH = 400;

export function createMemoryStore({ file }) {
  let memories = [];
  let loaded = false;

  async function load() {
    if (loaded) return memories;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) memories = parsed;
    } catch {
      memories = [];
    }
    loaded = true;
    return memories;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(memories, null, 2), 'utf8');
  }

  async function list({ enabledOnly = false } = {}) {
    await load();
    const rows = enabledOnly ? memories.filter((m) => m.enabled) : memories;
    return [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function add({ text, source = 'manual', chatId = null }) {
    await load();
    const clean = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    if (!clean) throw Object.assign(new Error('A memory needs something to remember'), { code: 'memory.empty' });
    if (memories.length >= MAX_ENTRIES) {
      throw Object.assign(new Error(`There are already ${MAX_ENTRIES} memories`), { code: 'memory.full' });
    }
    const entry = {
      id: randomUUID(),
      text: clean,
      source,
      chatId,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    memories.push(entry);
    await persist();
    return entry;
  }

  async function update(id, patch) {
    await load();
    const entry = memories.find((m) => m.id === id);
    if (!entry) throw Object.assign(new Error('No such memory'), { code: 'memory.notFound' });
    if (patch.text !== undefined) {
      const clean = String(patch.text).trim().slice(0, MAX_LENGTH);
      if (!clean) throw Object.assign(new Error('A memory needs something to remember'), { code: 'memory.empty' });
      entry.text = clean;
    }
    if (patch.enabled !== undefined) entry.enabled = Boolean(patch.enabled);
    await persist();
    return entry;
  }

  async function remove(id) {
    await load();
    const before = memories.length;
    memories = memories.filter((m) => m.id !== id);
    await persist();
    return memories.length !== before;
  }

  /** The block that goes in front of the model, or null when there is none. */
  async function context() {
    const rows = await list({ enabledOnly: true });
    if (!rows.length) return null;
    return ['Things the person asked to be remembered:', ...rows.map((m) => `- ${m.text}`)].join('\n');
  }

  async function clear() {
    await load();
    memories = [];
    await persist();
  }

  return { list, add, update, remove, context, clear };
}
