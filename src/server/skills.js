/**
 * Skills: a short written instruction that can be switched on for a chat.
 *
 * A skill is a name, a description and some instructions. When it is on, its
 * instructions ride in front of the model like a project would, and it appears
 * as a slash command so it can be switched on and off from the composer.
 *
 * Skills live in the profile, not in the repository, so a person can write one
 * without touching the code.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { cleanFolders, inScope } from './scope.js';
import { SKILL_NAMING_NOTE, bunnyText } from './bunnyText.js';

// Long skills (imported plugins with reference files) are kept whole and loaded on demand.
const MAX_LENGTH = 120_000;
const INLINE_LIMIT = 3000;

export function createSkillStore({ file }) {
  let skills = [];
  let loaded = false;

  async function load() {
    if (loaded) return skills;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) skills = parsed;
    } catch {
      skills = [];
    }
    loaded = true;
    return skills;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(skills, null, 2), 'utf8');
  }

  async function list({ enabledOnly = false } = {}) {
    await load();
    const rows = enabledOnly ? skills.filter((s) => s.enabled) : skills;
    return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function add({ name, description = '', instructions = '', enabled = false, folders = [] }) {
    await load();
    const clean = String(name ?? '').trim();
    if (!clean) throw Object.assign(new Error('A skill needs a name'), { code: 'skill.nameRequired' });
    if (!String(instructions).trim()) {
      throw Object.assign(new Error('A skill needs instructions'), { code: 'skill.instructionsRequired' });
    }
    const skill = {
      id: randomUUID(),
      name: clean.slice(0, 60),
      description: String(description).trim().slice(0, 200),
      instructions: String(instructions).trim().slice(0, MAX_LENGTH),
      enabled: Boolean(enabled),
      folders: cleanFolders(folders), // W6-16: [] = everywhere
      createdAt: new Date().toISOString(),
    };
    skills.push(skill);
    await persist();
    return skill;
  }

  async function update(id, patch) {
    await load();
    const skill = skills.find((s) => s.id === id);
    if (!skill) throw Object.assign(new Error('No such skill'), { code: 'skill.notFound' });
    if (patch.name !== undefined) skill.name = String(patch.name).trim().slice(0, 60) || skill.name;
    if (patch.description !== undefined) skill.description = String(patch.description).trim().slice(0, 200);
    if (patch.instructions !== undefined) {
      const text = String(patch.instructions).trim().slice(0, MAX_LENGTH);
      if (!text) throw Object.assign(new Error('A skill needs instructions'), { code: 'skill.instructionsRequired' });
      skill.instructions = text;
    }
    if (patch.enabled !== undefined) skill.enabled = Boolean(patch.enabled);
    if (patch.folders !== undefined) skill.folders = cleanFolders(patch.folders); // W6-16: the route has already checked each folder
    await persist();
    return skill;
  }

  async function remove(id) {
    await load();
    const before = skills.length;
    skills = skills.filter((s) => s.id !== id);
    await persist();
    return skills.length !== before;
  }

  /** The block that goes in front of the model, or null when there is none. */
  /**
   * What the model is told about the skills that are on. Short skills ride along
   * whole; a long one is named and summarised, and the model loads it with the
   * read_skill tool when the task needs it.
   */
  async function context({ folder = null } = {}) {
    // W6-16: a skill limited to some folders is only for chats in them; a chat with no folder gets the skills for everywhere
    const rows = (await list({ enabledOnly: true })).filter((s) => inScope(s.folders, folder));
    if (!rows.length) return null;
    // Many skills: a compact index only, so every message stays small.
    // BRAND-BUNNY: a skill written for another app is said in Bunny's words when it is handed over (the stored text stays as it was imported)
    if (rows.length > 12) {
      return [
        `Skills that are switched on (${rows.length}). ${SKILL_NAMING_NOTE} When one fits the task, call read_skill with its name first, then follow it:`,
        ...rows.map((s) => `- ${s.name}: ${bunnyText(String(s.description || ''))}`),
      ].join('\n');
    }
    return [
      `Skills that are switched on. ${SKILL_NAMING_NOTE}`,
      ...rows.map((s) => (s.instructions.length <= INLINE_LIMIT
        ? `## ${s.name}\n${bunnyText(s.instructions)}`
        : `## ${s.name}\n${bunnyText(s.description || '(no summary)')}\n(Long skill: call read_skill with name "${s.name}" to load its full instructions when the task needs it.)`)),
    ].join('\n');
  }

  /** One skill by name (case-insensitive) or id. */
  async function find(nameOrId) {
    const key = String(nameOrId ?? '').trim().toLowerCase();
    return (await list()).find((s) => s.id === nameOrId || s.name.toLowerCase() === key) ?? null;
  }

  return { list, add, update, remove, context, find };
}
