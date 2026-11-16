/**
 * Read-only data for the Changes and Files panes (D-2).
 *
 * Everything here READS. Nothing writes, and nothing leaves the chat's own folder: every path the page sends is
 * resolved against the folder, its real location (links and junctions followed) must still be inside it, and
 * anything else is refused. Large and binary files are described, never sent.
 */
import { readdir, readFile, realpath, stat, lstat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_READ = 1024 * 1024; // a file bigger than this is cut off
const MAX_ENTRIES = 500;
const MAX_DIFF_LINES = 2000;
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);

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
  return { base, real, rel: relation.split(sep).join('/') };
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
  const buf = await readFile(real);
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) return { path: at, name: basename(real), binary: true, bytes: info.size };
  const truncated = buf.length > MAX_READ;
  const text = buf.subarray(0, MAX_READ).toString('utf8');
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
 * folder, git or not). One entry per checkpoint; each file says new or edited, how many lines, and the diff
 * against the file as it is now. Files outside the folder are left out.
 */
export async function changesFor(root, checkpointList) {
  const out = [];
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const cp of checkpointList) {
    const entry = { id: cp.id, at: cp.at, restored: Boolean(cp.restored), files: [] };
    for (const f of cp.files ?? []) {
      let rel;
      try {
        const base = await realpath(root);
        rel = relative(base, resolve(f.path));
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        rel = rel.split(sep).join('/');
      } catch { continue; }
      if (f.skipped) { entry.files.push({ path: rel, status: 'edited', added: 0, removed: 0, lines: [], tooLarge: true }); continue; }
      const before = f.existed ? Buffer.from(f.data ?? '', 'base64').toString('utf8') : '';
      let after = '';
      let gone = false;
      try { after = (await readFile(resolve(f.path))).toString('utf8'); } catch { gone = true; }
      const d = lineDiff(before, after);
      entry.files.push({ path: rel, status: !f.existed ? 'new' : gone ? 'removed' : 'edited', added: d.added, removed: d.removed, lines: d.lines, addedAt: d.addedAt, tooLarge: d.tooLarge });
      added += d.added; removed += d.removed; files += 1;
    }
    out.push(entry);
  }
  return { checkpoints: out, totals: { files, added, removed } };
}
