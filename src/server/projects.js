/**
 * Projects: named folders of conversations with standing instructions, an optional folder, and memory of their own.
 *
 * Stored as one small JSON file rather than a directory of files, because a project is a handful of fields and is always read all at once.
 *
 * PROJECT-CONTEXT: a project may have a folder (new chats there start in Code mode in it), a memory (decisions, conventions, facts and open work
 * the person kept: never written without their yes, see app.js), and two switches (use the memory, share recent work between chats).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { looksSecret } from './secretLike.js';

export const MEMORY_KINDS = ['decision', 'convention', 'open', 'fact'];
export const MAX_PROJECT_MEMORY = 100;
export const MAX_MEMORY_TEXT = 1000; // PC-6: what Keep may store; the model's own suggestions are cut to 400 before they reach a card

const refused = (message, code) => Object.assign(new Error(message), { code });

export function createProjectStore({ file }) {
  let projects = [];
  let loaded = false;

  async function load() {
    if (loaded) return projects;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) projects = parsed;
    } catch {
      projects = [];
    }
    loaded = true;
    return projects;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(projects, null, 2), 'utf8');
  }

  async function list() {
    await load();
    return [...projects].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    await load();
    return projects.find((p) => p.id === id) ?? null;
  }

  const cleanFolder = (v) => String(v ?? '').trim().slice(0, 500);

  async function create({ name, instructions = '', folder = '' }) {
    await load();
    const clean = String(name ?? '').trim();
    if (!clean) throw refused('A project needs a name', 'project.nameRequired');
    const project = {
      id: randomUUID(),
      name: clean.slice(0, 80),
      instructions: String(instructions ?? '').slice(0, 8000),
      ...(cleanFolder(folder) ? { folder: cleanFolder(folder) } : {}),
      createdAt: new Date().toISOString(),
    };
    projects.push(project);
    await persist();
    return project;
  }

  async function update(id, patch) {
    await load();
    const project = projects.find((p) => p.id === id);
    if (!project) throw refused('No such project', 'project.notFound');
    if (patch.name !== undefined) {
      const clean = String(patch.name).trim();
      if (!clean) throw refused('A project needs a name', 'project.nameRequired');
      project.name = clean.slice(0, 80);
    }
    if (patch.instructions !== undefined) project.instructions = String(patch.instructions).slice(0, 8000);
    if (patch.folder !== undefined) { if (cleanFolder(patch.folder)) project.folder = cleanFolder(patch.folder); else delete project.folder; }
    // the two switches are on unless the person turned them off
    if (patch.useMemory !== undefined) project.useMemory = patch.useMemory !== false;
    if (patch.shareRecent !== undefined) project.shareRecent = patch.shareRecent !== false;
    await persist();
    return project;
  }

  async function remove(id) {
    await load();
    const before = projects.length;
    projects = projects.filter((p) => p.id !== id);
    await persist();
    return projects.length !== before;
  }

  // ---- project memory (PROJECT-CONTEXT §3) ----
  const need = async (id) => {
    await load();
    const project = projects.find((p) => p.id === id);
    if (!project) throw refused('No such project', 'project.notFound');
    project.memory ??= [];
    return project;
  };

  /** Exactly the text given is stored (PC-6): trimmed, never re-worded. A secret-looking item is refused. */
  function checkText(text) {
    const clean = String(text ?? '').trim();
    if (!clean) throw refused('A memory needs something to remember', 'memory.empty');
    if (clean.length > MAX_MEMORY_TEXT) throw refused(`That is longer than ${MAX_MEMORY_TEXT} characters`, 'memory.tooLong');
    if (looksSecret(clean, '')) throw refused("This looks like a secret, so it isn't kept", 'memory.secret');
    return clean;
  }

  async function memoryList(id) {
    return [...((await need(id)).memory)];
  }

  async function memoryAdd(id, { kind = 'fact', text, source = 'person', chatId = null, replaces = null }) {
    const project = await need(id);
    if (!MEMORY_KINDS.includes(kind)) throw refused('That kind of item is not known', 'memory.kind');
    const clean = checkText(text);
    if (replaces) project.memory = project.memory.filter((m) => m.id !== replaces);
    if (project.memory.length >= MAX_PROJECT_MEMORY) throw refused(`This project already keeps ${MAX_PROJECT_MEMORY} items`, 'memory.full');
    const entry = { id: randomUUID(), text: clean, kind, source: source === 'suggested' ? 'suggested' : 'person', ...(chatId ? { chatId } : {}), at: new Date().toISOString(), enabled: true };
    project.memory.push(entry);
    await persist();
    return entry;
  }

  async function memoryUpdate(id, itemId, patch) {
    const project = await need(id);
    const entry = project.memory.find((m) => m.id === itemId);
    if (!entry) throw refused('No such item', 'memory.notFound');
    if (patch.text !== undefined) entry.text = checkText(patch.text);
    if (patch.kind !== undefined) { if (!MEMORY_KINDS.includes(patch.kind)) throw refused('That kind of item is not known', 'memory.kind'); entry.kind = patch.kind; }
    if (patch.enabled !== undefined) entry.enabled = patch.enabled !== false;
    if (patch.done !== undefined) { if (patch.done) entry.doneAt = new Date().toISOString(); else delete entry.doneAt; }
    await persist();
    return entry;
  }

  async function memoryRemove(id, itemId) {
    const project = await need(id);
    const before = project.memory.length;
    project.memory = project.memory.filter((m) => m.id !== itemId);
    await persist();
    return project.memory.length !== before;
  }

  async function memoryClear(id) {
    const project = await need(id);
    const n = project.memory.length;
    project.memory = [];
    await persist();
    return n;
  }

  return { list, get, create, update, remove, memoryList, memoryAdd, memoryUpdate, memoryRemove, memoryClear };
}
