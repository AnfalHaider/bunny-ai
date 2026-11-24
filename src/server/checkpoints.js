/**
 * Undo and Rewind for the files the model changes.
 *
 * Each reply that writes or edits files gets a checkpoint: before the first change to a file, the file is copied as it was (or noted as
 * not existing yet). When the reply ends, `finish` also records what each file looked like AFTER the reply (a hash), the id of the reply's
 * message and whether the reply ran any command. Rewind (rewind.js) uses those to put files back across several replies and to notice
 * a file that changed outside the chat since. Changes made by commands are never tracked: only the file tools are.
 *
 * Limits (REWIND §4): at most 100 checkpoints per chat and 1 GB across the profile; the oldest go first. Deleting a chat removes its folder.
 */
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILE = 5 * 1024 * 1024; // larger files are noted, not copied
export const MAX_PER_CHAT = 100;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/** sha256 of a file's bytes, streamed ('absent' when nothing is there). A link, folder or anything that is not a plain file gives null (never read through). */
export async function hashOf(abs) {
  let info;
  try { info = await lstat(abs); } catch { return { hash: 'absent', size: 0 }; }
  if (!info.isFile()) return null;
  const h = createHash('sha256');
  await new Promise((resolve, reject) => { createReadStream(abs).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject); });
  return { hash: h.digest('hex'), size: info.size };
}

export function createCheckpoints({ dir, maxPerChat = MAX_PER_CHAT, maxBytes = MAX_TOTAL_BYTES } = {}) {
  const fileFor = (sessionId, id) => join(dir, sessionId, `${id}.json`);
  const safe = (v) => /^[a-f0-9-]{36}$/.test(String(v));
  const live = new Map(); // checkpoints still being written (this reply), by id

  /** Start a checkpoint for one reply (or a rewind: kind 'rewind'). Nothing is written until a file is changed. */
  function begin(sessionId, root, { kind = 'reply' } = {}) {
    const id = randomUUID();
    const files = new Map();
    const state = { id, sessionId, root, at: new Date().toISOString(), restored: false, kind, messageId: null, commands: false, after: null };
    let writing = Promise.resolve();
    const persist = () => {
      writing = writing.then(async () => {
        await mkdir(join(dir, sessionId), { recursive: true });
        await writeFile(fileFor(sessionId, id), JSON.stringify({ ...state, files: [...files.values()] }));
      });
      return writing;
    };
    const handle = {
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
      /** The reply ran a command (Bunny's run_command / start_process, or an engine's command step): rewind warns that it cannot put that back. */
      async markCommands() {
        if (state.commands) return;
        state.commands = true;
        if (files.size) await persist();
      },
      count: () => files.size,
      /** The reply is over (done, stopped or failed): record what every captured file looks like now, and which message holds it. */
      async finish(messageId = null) {
        await writing;
        if (!files.size) { live.delete(id); return null; }
        const after = {};
        for (const f of files.values()) after[f.path] = await hashOf(f.path) ?? { hash: 'refused', size: 0 };
        state.after = after;
        if (messageId) state.messageId = String(messageId);
        await persist();
        live.delete(id);
        await prune(sessionId, id).catch(() => {});
        return id;
      },
    };
    live.set(id, handle);
    return handle;
  }

  /** Finish a reply's checkpoint by id (the message that holds it has just been saved). Quietly nothing for an id this process never began. */
  async function finish(sessionId, id, messageId) {
    const h = live.get(id);
    if (h) return h.finish(messageId);
    // a checkpoint from before this version: only note the message
    const cp = await get(sessionId, id);
    if (cp && messageId && !cp.messageId) { cp.messageId = String(messageId); await writeFile(fileFor(sessionId, id), JSON.stringify(cp)); }
    return null;
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

  /** Mark checkpoints as put back (their rows say "Undone"). */
  async function markRestored(sessionId, ids, value = true) {
    for (const id of ids) {
      const cp = await get(sessionId, id);
      if (!cp) continue;
      cp.restored = value;
      await writeFile(fileFor(sessionId, id), JSON.stringify(cp));
    }
  }

  /** A rewind's safety checkpoint remembers which replies' checkpoints it flagged, so undoing the rewind can un-flag exactly those. */
  async function setRewound(sessionId, id, ids) {
    const cp = await get(sessionId, id);
    if (!cp) return;
    cp.rewound = ids.filter((x) => safe(x));
    await writeFile(fileFor(sessionId, id), JSON.stringify(cp));
  }

  /** Delete a chat's checkpoints (the chat was deleted): its copies of the person's files go with it. */
  async function removeChat(sessionId) {
    if (!safe(sessionId)) return;
    await rm(join(dir, sessionId), { recursive: true, force: true });
  }

  /**
   * Keep within the limits: at most maxPerChat checkpoints in this chat, then at most maxBytes in the whole profile, oldest first.
   * The checkpoint just written (keep) is never the one removed.
   */
  async function prune(sessionId, keep) {
    const mine = await list(sessionId);
    for (const c of mine.slice(0, Math.max(0, mine.length - maxPerChat))) if (c.id !== keep) await rm(fileFor(sessionId, c.id), { force: true });
    let chats;
    try { chats = await readdir(dir); } catch { return; }
    const all = [];
    let total = 0;
    for (const chat of chats) {
      let names;
      try { names = await readdir(join(dir, chat)); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const p = join(dir, chat, name);
        const info = await stat(p).catch(() => null);
        if (!info) continue;
        total += info.size;
        all.push({ p, size: info.size, at: info.mtimeMs, id: name.slice(0, -5) });
      }
    }
    if (total <= maxBytes) return;
    all.sort((a, b) => a.at - b.at);
    for (const f of all) {
      if (total <= maxBytes) break;
      if (f.id === keep) continue;
      await rm(f.p, { force: true });
      total -= f.size;
    }
  }

  return { begin, get, list, finish, markRestored, setRewound, removeChat, prune, dirOf: (sessionId) => join(dir, sessionId), fileFor };
}

