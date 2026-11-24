/**
 * REWIND: put the files back to how they were before an earlier reply, across several replies, and Undo of one reply (the same code).
 *
 * plan()  writes nothing. It says, per file, what would happen: restore, delete, changed (changed outside this chat's replies since),
 *         big (never copied), refused (the path is no longer allowed) or same.
 * apply() does it. Every path is checked again right before its own write (no link or junction on the way, inside the chat's folder, never .git,
 *         the person's edit-deny rules), a restore goes through a temp file and a rename, and a rewind makes a checkpoint of "now" first so it can be undone.
 *
 * Commands' changes are never tracked, so the preview says so when a reply ran one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hashOf } from './checkpoints.js';

const GIT_SEGMENT = /^(\.git|git~\d+)(?:[. ]*|:.*)$/i;
const sameFolder = (a, b) => {
  if (!a || !b) return false;
  const x = resolve(String(a));
  const y = resolve(String(b));
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * May this path be written by a rewind right now? Never throws. Walks from the folder down with lstat, so a link or junction that appeared since
 * the checkpoint is found (and never followed).
 * @returns {Promise<{ ok: true } | { ok: false, why: string }>}
 */
export async function pathAllowed({ root, dataDir = null, abs, deny = null }) {
  const base = resolve(String(root ?? ''));
  const target = resolve(String(abs ?? ''));
  const rel = relative(base, target);
  if (!root || !abs || rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, why: 'It is outside this chat\'s folder.' };
  const parts = rel.split(sep);
  if (parts.some((p) => GIT_SEGMENT.test(p))) return { ok: false, why: 'It is inside .git, where Bunny does not write.' };
  if (dataDir) {
    const d = resolve(dataDir);
    if (process.platform === 'win32' ? target.toLowerCase().startsWith(d.toLowerCase() + sep) : target.startsWith(d + sep)) return { ok: false, why: 'Bunny keeps its own data there.' };
  }
  // links: the folder itself, then every folder on the way (a missing one ends the walk: it is made level by level later)
  let cur = base;
  try { if ((await lstat(cur)).isSymbolicLink()) return { ok: false, why: 'The chat\'s folder is a link.' }; } catch { return { ok: false, why: 'The chat\'s folder is not there.' }; }
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part);
    let info;
    try { info = await lstat(cur); } catch { break; }
    if (info.isSymbolicLink()) return { ok: false, why: 'There is a link or junction on the way.' };
    if (!info.isDirectory()) return { ok: false, why: 'A file is where a folder should be.' };
  }
  const slash = parts.join('/');
  const verdict = deny?.(slash);
  if (verdict) return { ok: false, why: verdict };
  return { ok: true };
}

/** What a file is now, without following links: { kind: 'absent' | 'file' | 'refused', hash?, why? }. */
async function currentState(abs) {
  let info;
  try { info = await lstat(abs); } catch (err) { return err.code === 'ENOENT' || err.code === 'ENOTDIR' ? { kind: 'absent', hash: 'absent' } : { kind: 'refused', why: 'It cannot be read.' }; }
  if (info.isSymbolicLink()) return { kind: 'refused', why: 'It is now a link.' };
  if (!info.isFile()) return { kind: 'refused', why: 'It is now a folder.' };
  const h = await hashOf(abs);
  return h ? { kind: 'file', hash: h.hash } : { kind: 'refused', why: 'It cannot be read.' };
}

/**
 * @param {object} o
 * @param {object[]} o.cps  the checkpoints to go back over, oldest first (not yet put back)
 * @param {string} o.root   the chat's folder now
 */
export async function plan({ cps, root, dataDir = null, deny = null, tooOld = false }) {
  // the state to put back is the BEFORE copy in the OLDEST checkpoint that touched the path; "after" is the NEWEST one's
  const first = new Map();
  const last = new Map();
  for (const cp of cps) {
    const rootOk = sameFolder(cp.root, root);
    for (const f of cp.files ?? []) {
      if (!first.has(f.path)) first.set(f.path, { entry: f, cp, rootOk });
      last.set(f.path, { cp, after: cp.after?.[f.path] ?? null, rootOk });
    }
  }
  const files = [];
  for (const [abs, { entry, rootOk }] of first) {
    const rel = relative(resolve(root ?? ''), resolve(abs)).split(sep).join('/');
    const show = rel && !rel.startsWith('..') ? rel : abs;
    const item = { path: show, abs };
    const allowed = rootOk ? await pathAllowed({ root, dataDir, abs, deny }) : { ok: false, why: 'This reply worked in another folder.' };
    if (!allowed.ok) { files.push({ ...item, action: 'refused', why: allowed.why }); continue; }
    const cur = await currentState(abs);
    if (cur.kind === 'refused') { files.push({ ...item, action: 'refused', why: cur.why }); continue; }
    if (entry.skipped) { files.push({ ...item, action: 'big' }); continue; }
    const wanted = entry.existed ? sha(Buffer.from(entry.data, 'base64')) : 'absent';
    if (cur.hash === wanted) { files.push({ ...item, action: 'same' }); continue; }
    const after = last.get(abs).after;
    if (!after || after.hash !== cur.hash) { files.push({ ...item, action: 'changed', why: after ? 'Changed since this chat\'s replies.' : 'Bunny cannot tell whether this changed since.' }); continue; }
    files.push({ ...item, action: entry.existed ? 'restore' : 'delete' });
  }
  return { replies: cps.length, files, commandsRan: cps.some((c) => c.commands === true), tooOld, _entries: first };
}

/** The preview as the route sends it: paths and actions only, never contents and never an absolute path of a file outside the folder. */
export const publicPlan = (p) => ({ replies: p.replies, files: p.files.map(({ path, action, why }) => ({ path, action, ...(why ? { why } : {}) })), commandsRan: p.commandsRan, tooOld: p.tooOld });

/**
 * Do it. `include` names the `changed` paths the person ticked (anything else in it is ignored and counted).
 * ops can replace the file operations (tests make a write fail).
 */
export async function apply({ cps, root, dataDir = null, deny = null, include = [], checkpoints, sessionId, ops = {} }) {
  const fsOps = { rename, writeFile, rm, mkdir, lstat, ...ops };
  const p = await plan({ cps, root, dataDir, deny });
  const ticked = new Set((Array.isArray(include) ? include : []).map(String));
  const changedPaths = new Set(p.files.filter((f) => f.action === 'changed').map((f) => f.path));
  const ignored = [...ticked].filter((x) => !changedPaths.has(x)).length;
  const todo = p.files.filter((f) => f.action === 'restore' || f.action === 'delete' || (f.action === 'changed' && ticked.has(f.path)));
  const left = p.files.filter((f) => f.action === 'changed' && !ticked.has(f.path)).map((f) => f.path);
  const refused = p.files.filter((f) => f.action === 'refused').map((f) => ({ path: f.path, why: f.why }));
  const result = { done: [], failed: [], refused, left, big: p.files.filter((f) => f.action === 'big').map((f) => f.path), same: p.files.filter((f) => f.action === 'same').map((f) => f.path), ignored, putBack: 0, removed: 0, undoId: null, commandsRan: p.commandsRan };

  // a checkpoint of how things are now, before anything changes, so the rewind can be undone
  let undo = null;
  if (todo.length) {
    undo = checkpoints.begin(sessionId, root, { kind: 'rewind' });
    for (const f of todo) await undo.capture(f.abs);
    result.undoId = undo.id;
  }
  let stopped = false;
  for (const f of todo) {
    if (stopped) { result.failed.push({ path: f.path, why: 'Not tried: an earlier file failed.' }); continue; }
    const entry = p._entries.get(f.abs).entry;
    try {
      // again, right before this path's own write: a link that appeared since the preview stops it here
      const ok = await pathAllowed({ root, dataDir, abs: f.abs, deny });
      if (!ok.ok) { result.refused.push({ path: f.path, why: ok.why }); continue; }
      if (entry.existed) {
        await ensureFolders(root, dirname(f.abs), fsOps);
        const tmp = `${f.abs}.bunny-rewind-${randomBytes(6).toString('hex')}`;
        await fsOps.writeFile(tmp, Buffer.from(entry.data, 'base64'), { flag: 'wx' });
        try {
          const again = await pathAllowed({ root, dataDir, abs: f.abs, deny });
          if (!again.ok) throw Object.assign(new Error(again.why), { refusal: true });
          await fsOps.rename(tmp, f.abs); // over a link this replaces the link itself, never what it points to
        } catch (err) { await fsOps.rm(tmp, { force: true }).catch(() => {}); throw err; }
        result.putBack += 1;
      } else {
        const info = await fsOps.lstat(f.abs).catch(() => null);
        if (info && !info.isFile()) { result.refused.push({ path: f.path, why: 'It is a folder or a link, not a file Bunny made.' }); continue; }
        if (info) await fsOps.rm(f.abs); // one file: never recursive
        result.removed += 1;
      }
      result.done.push(f.path);
    } catch (err) {
      if (err.refusal) { result.refused.push({ path: f.path, why: err.message }); continue; }
      result.failed.push({ path: f.path, why: String(err.message ?? err).slice(0, 160) });
      stopped = true;
    }
  }
  if (undo) await undo.finish(null); // "after" is taken once the writes are done
  // a checkpoint counts as handled when every file in it was put back, was already right, or was left by the person's choice
  const bad = new Set([...result.failed.map((x) => x.path), ...result.refused.map((x) => x.path)]);
  const rel = (abs) => relative(resolve(root ?? ''), resolve(abs)).split(sep).join('/');
  result.handled = cps.filter((cp) => (cp.files ?? []).every((f) => !bad.has(rel(f.path)) && !bad.has(f.path))).map((cp) => cp.id);
  return result;
}

/** Make missing folders one level at a time inside the chat's folder, checking each new level (not a link) before the next. */
async function ensureFolders(root, dir, fsOps) {
  const base = resolve(root);
  const rel = relative(base, resolve(dir));
  if (rel === '') return;
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('outside the chat\'s folder');
  let cur = base;
  for (const part of rel.split(sep)) {
    cur = join(cur, part);
    let info = await fsOps.lstat(cur).catch(() => null);
    if (!info) {
      await fsOps.mkdir(cur);
      info = await fsOps.lstat(cur);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('There is a link or junction on the way.'), { refusal: true });
  }
}

