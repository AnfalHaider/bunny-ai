/**
 * Projects: named folders of conversations with standing instructions.
 *
 * Stored as one small JSON file rather than a directory of files, because a
 * project is a handful of fields and is always read all at once.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

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

  async function create({ name, instructions = '' }) {
    await load();
    const clean = String(name ?? '').trim();
    if (!clean) throw Object.assign(new Error('A project needs a name'), { code: 'project.nameRequired' });
    const project = {
      id: randomUUID(),
      name: clean.slice(0, 80),
      instructions: String(instructions ?? '').slice(0, 8000),
      createdAt: new Date().toISOString(),
    };
    projects.push(project);
    await persist();
    return project;
  }

  async function update(id, patch) {
    await load();
    const project = projects.find((p) => p.id === id);
    if (!project) throw Object.assign(new Error('No such project'), { code: 'project.notFound' });
    if (patch.name !== undefined) {
      const clean = String(patch.name).trim();
      if (!clean) throw Object.assign(new Error('A project needs a name'), { code: 'project.nameRequired' });
      project.name = clean.slice(0, 80);
    }
    if (patch.instructions !== undefined) project.instructions = String(patch.instructions).slice(0, 8000);
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

  return { list, get, create, update, remove };
}
