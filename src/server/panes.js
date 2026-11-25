/**
 * Read-only data for the Changes and Files panes (D-2).
 *
 * Everything here READS. Nothing writes, and nothing leaves the chat's own folder: every path the page sends is
 * resolved against the folder, its real location (links and junctions followed) must still be inside it, and
 * anything else is refused. Large and binary files are described, never sent.
 */
import { open, readdir, realpath, stat, lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const MAX_READ = 1024 * 1024; // a file bigger than this is cut off
const MAX_ENTRIES = 500;
const MAX_DIFF_LINES = 2000;
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);
const MAX_CHECKPOINTS = 20; // newest first; the answer says when there are more
const MAX_FILES_PER_CHECKPOINT = 40;
const DIFF_BUDGET_LINES = 20_000; // total lines diffed in one answer, so a long chat cannot hold the server for seconds

const refuse = (code, message) => Object.assign(new Error(message), { code });

/** The real path of `rel` inside `root`, or an error: the single gate every read goes through. */
export async function inside(root, rel = '') {
  const text = String(rel ?? '');
  if (text.includes('\0')) throw refuse('path.invalid', 'That path is not valid.');
  if (isAbsolute(text) || /^[A-Za-z]:/.test(text) || text.startsWith('\\\\')) throw refuse('path.outside', 'That path is outside the folder.');
  const base = await realpath(root);
  const target = resolve(base, text);
  const lexical = relative(base, target);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) throw refuse('path.outside', 'That path is outside the folder.');
  let real;
  try {
    real = await realpath(target);
  } catch {
    throw refuse('path.notFound', 'That file or folder is not there.');
  }
  const relation = relative(base, real);
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw refuse('path.outside', 'That path is outside the folder.');
  // The list hides .git and node_modules; reading them is refused too, so the two agree (.git/config can hold a token).
  if (relation.split(sep).some((segment) => HIDDEN_DIRS.has(segment.toLowerCase()))) throw refuse('path.hidden', 'That folder is not shown.');
  return { base, real, rel: relation.split(sep).join('/') };
}

/** The first `length` bytes of a file, and no more. */
async function readHead(path, length) {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** A folder Bunny never browses for the Files pane: its own data, a parent of it, or a drive root. */
export async function neverBrowse(folder, dataDir, { allowed = null } = {}) {
  const real = await realpath(folder);
  if (parse(real).root === real) return 'That is a whole drive, not a project folder.';
  // W2-9: the one exact exception: a chat's own copy of its project (inside <data folder>/worktrees) when `allowed` is that copy's real path.
  // The caller passes it only after the worktree code has checked the recorded path; anything else in the data folder stays refused.
  if (allowed && real.toLowerCase() === String(allowed).toLowerCase()) return null;
  if (dataDir) {
    let data;
    try { data = await realpath(dataDir); } catch { data = resolve(dataDir); }
    const inData = relative(data, real);
    if (inData === '' || (!inData.startsWith('..') && !isAbsolute(inData))) return 'That is where Bunny keeps its own data.';
    const dataIn = relative(real, data);
    if (!dataIn.startsWith('..') && !isAbsolute(dataIn)) return 'That folder contains where Bunny keeps its own data.';
  }
  return null;
}

/** One level of a folder: folders first, then files, by name. */
export async function listFolder(root, rel = '') {
  const { real, rel: at, base } = await inside(root, rel);
  const info = await stat(real);
  if (!info.isDirectory()) throw refuse('path.notFolder', 'That is a file, not a folder.');
  const names = await readdir(real);
  const entries = [];
  for (const name of names) {
    if (entries.length >= MAX_ENTRIES) break;
    try {
      const entryInfo = await lstat(join(real, name));
      const dir = entryInfo.isDirectory();
      if (dir && HIDDEN_DIRS.has(name)) continue;
      entries.push({ name, type: dir ? 'folder' : 'file', size: dir ? null : entryInfo.size, link: entryInfo.isSymbolicLink() });
    } catch { /* gone while listing: skip */ }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
  return { root: basename(base), path: at, entries, truncated: names.length > MAX_ENTRIES };
}

/** A text file, cut off at MAX_READ. Binary files and folders are described, not sent. */
export async function readTextFile(root, rel) {
  const { real, rel: at } = await inside(root, rel);
  const info = await stat(real);
  if (info.isDirectory()) throw refuse('path.notFile', 'That is a folder, not a file.');
  const buf = await readHead(real, Math.min(info.size, MAX_READ)); // never the whole file: a 300 MB file costs 1 MB
  if (buf.subarray(0, 4096).includes(0)) return { path: at, name: basename(real), binary: true, bytes: info.size };
  const truncated = info.size > MAX_READ;
  const text = buf.toString('utf8');
  return { path: at, name: basename(real), binary: false, bytes: info.size, truncated, text, lines: text.split('\n').length };
}

/**
 * A line diff between two texts: hunks of 3 lines of context, lines marked ' ', '+', '-'.
 * Longer than MAX_DIFF_LINES on either side is summarised, not diffed (the answer stays small).
 */
export function lineDiff(before, after) {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return { added: b.length, removed: a.length, lines: [], addedAt: [], tooLarge: true };
  }
  // longest common subsequence table
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i += 1; j += 1; } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) { ops.push(['-', a[i]]); i += 1; } else { ops.push(['+', b[j]]); j += 1; }
  }
  while (i < a.length) { ops.push(['-', a[i]]); i += 1; }
  while (j < b.length) { ops.push(['+', b[j]]); j += 1; }
  const added = ops.filter((o) => o[0] === '+').length;
  const removed = ops.filter((o) => o[0] === '-').length;
  if (!added && !removed) return { added: 0, removed: 0, lines: [], addedAt: [], tooLarge: false };
  const addedAt = [];
  let newLine = 0;
  for (const o of ops) { if (o[0] !== '-') newLine += 1; if (o[0] === '+') addedAt.push(newLine); }
  // keep changed lines with 3 lines of context either side
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let c = Math.max(0, k - 3); c <= Math.min(ops.length - 1, k + 3); c += 1) keep[c] = true; });
  const lines = [];
  let skipped = false;
  ops.forEach((o, k) => {
    if (keep[k]) { lines.push(`${o[0]}${o[1]}`); skipped = false; } else if (!skipped) { lines.push('@@'); skipped = true; }
  });
  return { added, removed, lines, addedAt, tooLarge: false };
}

/**
 * What a chat changed, from the copies Bunny saved before each reply's first change to a file (works in any
 * folder, git or not). One entry per checkpoint (newest 20); each file says new or edited, how many lines, and
 * the diff against the file as it is now. Every path goes through inside(): a file whose real location leaves the
 * folder (a link) is left out, and nothing is read beyond MAX_READ.
 */
export async function changesFor(root, checkpointList) {
  const base = await realpath(root);
  const all = checkpointList.slice(-MAX_CHECKPOINTS);
  const out = [];
  let files = 0;
  let added = 0;
  let removed = 0;
  let budget = DIFF_BUDGET_LINES;
  for (const cp of all) {
    const entry = { id: cp.id, at: cp.at, restored: Boolean(cp.restored), kind: cp.kind === 'rewind' ? 'rewind' : 'reply', files: [] };
    for (const f of (cp.files ?? []).slice(0, MAX_FILES_PER_CHECKPOINT)) {
      let rel = relative(base, resolve(f.path));
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      rel = rel.split(sep).join('/');
      // where is the file now? Its real location must be inside the folder; a file that is gone must at least sit in a real folder inside it.
      let real = null;
      let gone = false;
      try {
        real = (await inside(root, rel)).real;
      } catch (err) {
        if (err.code !== 'path.notFound') continue; // outside, hidden, invalid: left out
        try { await inside(root, dirname(rel) === '.' ? '' : dirname(rel)); gone = true; } catch { continue; }
      }
      if (f.skipped) { entry.files.push({ path: rel, status: 'edited', added: 0, removed: 0, lines: [], addedAt: [], tooLarge: true }); continue; }
      const before = f.existed ? Buffer.from(f.data ?? '', 'base64').toString('utf8') : '';
      let after = '';
      if (real) {
        try { const info = await stat(real); after = (await readHead(real, Math.min(info.size, MAX_READ))).toString('utf8'); } catch { gone = true; }
      }
      const size = before.split('\n').length + after.split('\n').length;
      const d = budget - size < 0 ? { added: 0, removed: 0, lines: [], addedAt: [], tooLarge: true } : lineDiff(before, after);
      budget -= size;
      entry.files.push({ path: rel, status: !f.existed ? 'new' : gone ? 'removed' : 'edited', added: d.added, removed: d.removed, lines: d.lines, addedAt: d.addedAt, tooLarge: d.tooLarge });
      added += d.added; removed += d.removed; files += 1;
    }
    out.push(entry);
  }
  return { checkpoints: out, totals: { files, added, removed }, more: checkpointList.length > all.length };
}
