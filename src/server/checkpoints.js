/**
 * Undo for the files the model changes.
 *
 * Each reply that writes or edits files gets a checkpoint: before the first
 * change to a file, the file is copied as it was (or noted as not existing yet).
 * Undoing the reply puts every one of those files back. Changes made by commands
 * the model ran are not tracked: only write_file and edit_file are.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FILE = 5 * 1024 * 1024; // larger files are noted, not copied

export function createCheckpoints({ dir }) {
  const fileFor = (sessionId, id) => join(dir, sessionId, `${id}.json`);
  const safe = (v) => /^[a-f0-9-]{36}$/.test(String(v));

  /** Start a checkpoint for one reply. Nothing is written until a file is changed. */
  function begin(sessionId, root, engine = 'bunny') {
    const id = randomUUID();
    const files = new Map();
    let writing = Promise.resolve();
    const persist = () => {
      writing = writing.then(async () => {
        await mkdir(join(dir, sessionId), { recursive: true });
        await writeFile(fileFor(sessionId, id), JSON.stringify({ id, sessionId, root, engine, at: new Date().toISOString(), restored: false, files: [...files.values()] }));
      });
      return writing;
    };
    return {
      id,
      /** Copy the file before its first change in this reply. */
      async capture(abs) {
        if (files.has(abs)) return;
        let entry;
        try {
          const info = await stat(abs);
          entry = info.size > MAX_FILE
            ? { path: abs, existed: true, skipped: true }
            : { path: abs, existed: true, data: (await readFile(abs)).toString('base64') };
        } catch {
          entry = { path: abs, existed: false };
        }
        files.set(abs, entry);
        await persist();
      },
      count: () => files.size,
    };
  }

  async function get(sessionId, id) {
    if (!safe(sessionId) || !safe(id)) return null;
    try { return JSON.parse(await readFile(fileFor(sessionId, id), 'utf8')); } catch { return null; }
  }

  /** Every checkpoint of a chat, oldest first (read-only: the Changes pane). */
  async function list(sessionId) {
    if (!safe(sessionId)) return [];
    let names;
    try { names = await readdir(join(dir, sessionId)); } catch { return []; }
    const all = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try { all.push(JSON.parse(await readFile(join(dir, sessionId, name), 'utf8'))); } catch { /* skip a damaged one */ }
    }
    return all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  /** Put every file the reply changed back the way it was. */
  async function restore(sessionId, id) {
    const cp = await get(sessionId, id);
    if (!cp) throw Object.assign(new Error('That checkpoint is gone.'), { code: 'checkpoint.notFound' });
    if (cp.restored) throw Object.assign(new Error('These changes were already undone.'), { code: 'checkpoint.used' });
    const done = [];
    const skipped = [];
    for (const f of cp.files) {
      if (f.skipped) { skipped.push(f.path); continue; }
      if (f.existed) {
        await mkdir(dirname(f.path), { recursive: true });
        await writeFile(f.path, Buffer.from(f.data, 'base64'));
      } else {
        await rm(f.path, { force: true });
      }
      done.push(f.path);
    }
    cp.restored = true;
    await writeFile(fileFor(sessionId, id), JSON.stringify(cp));
    return { restored: done.length, skipped, files: done };
  }

  return { begin, get, restore, list };
}
