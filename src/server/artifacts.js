/**
 * Artifacts: a document or piece of code the model produced, kept beside the
 * chat instead of scrolling away in it.
 *
 * Each artifact owns an ordered list of versions. Editing an artifact appends a
 * version rather than overwriting, so "restore" is a matter of pointing at an
 * older entry.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveArtifact, artifactName } from '../ui/artifact-content.js';

const ID_PATTERN = /^[a-f0-9-]{36}$/;
const KINDS = new Set(['html', 'code', 'markdown']);

export function createArtifactStore({ dir }) {
  const fileFor = (id) => join(dir, `${id}.json`);

  function requireId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw Object.assign(new Error('Invalid artifact id'), { code: 'artifact.invalidId' });
    }
    return id;
  }

  async function save(artifact) {
    await mkdir(dir, { recursive: true });
    const target = fileFor(artifact.id);
    const temp = `${target}.${process.pid}.tmp`;
    artifact.updatedAt = new Date().toISOString();
    await writeFile(temp, JSON.stringify(artifact, null, 2), 'utf8');
    await rename(temp, target);
  }

  function normalise(artifact) {
    artifact.versions ??= [];
    artifact.starred ??= false;
    artifact.language ??= '';
    artifact.kind = KINDS.has(artifact.kind) ? artifact.kind : 'markdown';
    return artifact;
  }

  async function get(id) {
    try {
      return normalise(JSON.parse(await readFile(fileFor(requireId(id)), 'utf8')));
    } catch {
      return null;
    }
  }

  function summary(artifact) {
    const current = artifact.versions.at(-1);
    return {
      id: artifact.id,
      sessionId: artifact.sessionId ?? null,
      title: artifact.title,
      kind: artifact.kind,
      language: artifact.language,
      starred: Boolean(artifact.starred),
      versionCount: artifact.versions.length,
      preview: String(current?.content ?? '').replace(/\s+/g, ' ').slice(0, 120),
      // what the content really is, and a readable name for lists
      shownKind: resolveArtifact(current?.content ?? '', artifact.kind).kind,
      name: artifactName(current?.content ?? '', artifact.title),
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
  }

  async function list({ sessionId = null } = {}) {
    await mkdir(dir, { recursive: true });
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
    const out = [];
    for (const file of files) {
      try {
        const artifact = normalise(JSON.parse(await readFile(join(dir, file), 'utf8')));
        if (sessionId && artifact.sessionId !== sessionId) continue;
        out.push(summary(artifact));
      } catch {
        // One unreadable file must not hide the rest.
      }
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create({ sessionId = null, title, kind = 'markdown', language = '', content = '' }) {
    const clean = String(title ?? '').trim();
    if (!clean) throw Object.assign(new Error('An artifact needs a title'), { code: 'artifact.titleRequired' });
    if (!String(content ?? '').trim()) throw Object.assign(new Error('An artifact needs content'), { code: 'artifact.contentRequired' });
    const now = new Date().toISOString();
    const artifact = normalise({
      id: randomUUID(),
      sessionId,
      title: clean.slice(0, 120),
      kind,
      language: String(language ?? '').slice(0, 40),
      starred: false,
      createdAt: now,
      versions: [{ at: now, content: String(content) }],
    });
    await save(artifact);
    return artifact;
  }

  async function update(id, patch) {
    const artifact = await get(requireId(id));
    if (!artifact) throw Object.assign(new Error('No such artifact'), { code: 'artifact.notFound' });
    if (patch.title !== undefined) artifact.title = String(patch.title).trim().slice(0, 120) || artifact.title;
    if (patch.kind !== undefined && KINDS.has(patch.kind)) artifact.kind = patch.kind;
    if (patch.language !== undefined) artifact.language = String(patch.language).slice(0, 40);
    if (patch.starred !== undefined) artifact.starred = Boolean(patch.starred);
    if (patch.content !== undefined) {
      const content = String(patch.content);
      if (!content.trim()) throw Object.assign(new Error('An artifact needs content'), { code: 'artifact.contentRequired' });
      artifact.versions.push({ at: new Date().toISOString(), content });
    }
    await save(artifact);
    return artifact;
  }

  /** Point the artifact back at an older version, keeping the newer one in the list. */
  async function restore(id, versionIndex) {
    const artifact = await get(requireId(id));
    if (!artifact) throw Object.assign(new Error('No such artifact'), { code: 'artifact.notFound' });
    const chosen = artifact.versions[versionIndex];
    if (!chosen) throw Object.assign(new Error('No such version'), { code: 'artifact.noVersion' });
    artifact.versions.push({ at: new Date().toISOString(), content: chosen.content, restoredFrom: versionIndex });
    await save(artifact);
    return artifact;
  }

  async function remove(id) {
    await rm(fileFor(requireId(id)), { force: true });
  }

  return { list, get, create, update, restore, remove };
}
