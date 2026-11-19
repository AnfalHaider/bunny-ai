/**
 * CLI-ENGINES §3.3 (CE-2): restricted mode, the staged copy. The engine works in a COPY of the workspace; when the turn ends Bunny diffs the copy against the real folder, judges every changed,
 * added or deleted path with the bridge (as write_file / edit_file), and writes only what is allowed through the workspace's own write path (so checkpoints and the Changes pane work).
 *
 * The copy leaves out: every path the read-deny rules hide, the data folder, every engine home, `.git` (the copy has no worktree link back), `.claude` / `.codex` / `.cline` / `.clinerules` / `.aider*`,
 * and every symlink, junction and reparse point (skipped, never followed).
 *
 * The diff always DISCARDS, and names in the reply: anything under `.git` or an engine-config folder, an alternate data stream (a `:` after the drive), a Windows reserved name, a name ending in a dot or
 * a space, a link, a file over the write limit, and a change of kind (file <-> folder). Files that make something run LATER (package.json, tasks.json, workflows, Makefile, scripts...) are an Ask
 * in EVERY mode, Auto included, marked "runs code later": a restricted turn runs no commands, so it must not plant one silently. Plan mode keeps nothing.
 */
import { copyFile, lstat, mkdir, readFile, readdir, stat, utimes } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { removeTree } from '../toolInstall.js';

export const WRITE_LIMIT_BYTES = 1_000_000_000; // a copy-back is one file of at most this size
export const MAX_COPY_FILES = 50_000;
export const MAX_COPY_BYTES = 2 * 1024 * 1024 * 1024;
const CONFIG_DIRS = new Set(['.claude', '.codex', '.cline', '.clinerules', '.git']);
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Files that make something run later (CE-2.3). Matched on the path inside the workspace. */
export const RUNS_LATER = [/(^|\/)package\.json$/i, /(^|\/)\.vscode\/(tasks|settings|launch)\.json$/i, /(^|\/)\.github\/workflows\//i, /(^|\/)makefile$/i, /\.(ps1|bat|cmd)$/i, /(^|\/)\.husky\//i, /(^|\/)\.pre-commit-config\.yaml$/i, /(^|\/)(pyproject\.toml|setup\.py)$/i];
export const runsLater = (rel) => RUNS_LATER.some((re) => re.test(String(rel).replace(/\\/g, '/')));

const isConfigName = (name) => CONFIG_DIRS.has(name.toLowerCase()) || /^\.aider/i.test(name);
const norm = (p) => String(p).replace(/\\/g, '/');
const lowerNorm = (p) => norm(resolve(p)).toLowerCase();

/** Why a name can never be copied back, or null. */
export function badName(rel) {
  const parts = norm(rel).split('/').filter(Boolean);
  for (const [i, part] of parts.entries()) {
    if (part.includes(':')) return 'an alternate data stream';
    if (RESERVED.test(part)) return 'a reserved Windows name';
    if (/[. ]$/.test(part)) return 'a name ending in a dot or a space';
    if (isConfigName(part)) return i === parts.length - 1 && part.toLowerCase() === '.git' ? 'a .git entry' : 'an engine or git configuration folder';
  }
  return null;
}

/**
 * Make the staged copy. `hidden(rel)` says whether the person's read-deny rules hide a workspace path; `keepOut` are absolute folders that are never copied (the data folder, engine homes).
 * Returns { dir, manifest, skipped, files, bytes } where manifest maps a relative path to { size, mtimeMs }.
 */
export async function stage({ root, dir, hidden = () => false, keepOut = [], maxFiles = MAX_COPY_FILES, maxBytes = MAX_COPY_BYTES }) {
  await removeTree(dir).catch(() => {});
  await mkdir(dir, { recursive: true });
  const out = keepOut.map(lowerNorm);
  const manifest = new Map(); const skipped = []; let files = 0; let bytes = 0;
  const realRoot = resolve(root);
  async function walk(abs) {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      const full = join(abs, e.name);
      const rel = norm(relative(realRoot, full));
      const info = await lstat(full).catch(() => null);
      if (!info) continue;
      if (info.isSymbolicLink() || (info.isDirectory() === false && info.isFile() === false)) { skipped.push({ path: rel, why: 'a link' }); continue; }
      if (isConfigName(e.name)) { skipped.push({ path: rel, why: 'an engine or git configuration folder' }); continue; }
      const low = lowerNorm(full);
      if (out.some((o) => low === o || low.startsWith(`${o}/`))) { skipped.push({ path: rel, why: 'a folder Bunny keeps private' }); continue; }
      if (hidden(rel)) { skipped.push({ path: rel, why: 'hidden by your rules' }); continue; }
      if (badName(rel)) { skipped.push({ path: rel, why: badName(rel) }); continue; }
      const target = join(dir, ...rel.split('/'));
      if (info.isDirectory()) { await mkdir(target, { recursive: true }); await walk(full); continue; }
      files += 1; bytes += info.size;
      if (files > maxFiles || bytes > maxBytes) throw new Error('This folder is too big to give an engine a safe copy of (over 50,000 files or 2 GB). Open a smaller folder, or use Bunny’s own engine.');
      await mkdir(dirname(target), { recursive: true });
      await copyFile(full, target);
      await utimes(target, info.atime, info.mtime).catch(() => {});
      manifest.set(rel, { size: info.size, mtimeMs: Math.trunc((await stat(target)).mtimeMs) });
    }
  }
  await walk(realRoot);
  return { dir, manifest, skipped, files, bytes };
}

/** Everything under the staged copy (relative paths): { files: Map(rel -> { size, mtimeMs }), links: [rel], dirs: Set(rel) }. */
async function listCopy(dir) {
  const files = new Map(); const links = []; const dirs = new Set();
  async function walk(abs) {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      const full = join(abs, e.name);
      const rel = norm(relative(dir, full));
      const info = await lstat(full).catch(() => null);
      if (!info) continue;
      if (info.isSymbolicLink()) { links.push(rel); continue; }
      if (info.isDirectory()) { dirs.add(rel); await walk(full); continue; }
      if (info.isFile()) files.set(rel, { size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
    }
  }
  await walk(dir);
  return { files, links, dirs };
}

/** What the engine changed: [{ rel, kind: 'add' | 'change' | 'delete' | 'link' | 'type', size? }]. */
export async function diff({ root, dir, manifest }) {
  const now = await listCopy(dir);
  const changes = [];
  for (const rel of now.links) changes.push({ rel, kind: 'link' });
  for (const [rel, info] of now.files) {
    const was = manifest.get(rel);
    if (!was) {
      const real = await lstat(join(root, ...rel.split('/'))).catch(() => null);
      if (real?.isDirectory()) changes.push({ rel, kind: 'type', size: info.size }); else changes.push({ rel, kind: real ? 'change' : 'add', size: info.size });
    } else if (was.size !== info.size || was.mtimeMs !== info.mtimeMs) changes.push({ rel, kind: 'change', size: info.size });
  }
  for (const rel of manifest.keys()) {
    if (now.files.has(rel)) continue;
    if (now.dirs.has(rel)) changes.push({ rel, kind: 'type' }); else changes.push({ rel, kind: 'delete' });
  }
  return changes.sort((a, b) => a.rel.localeCompare(b.rel));
}

const plainKind = (c) => (c.kind === 'add' ? 'added' : c.kind === 'delete' ? 'deleted' : 'changed');

/**
 * Judge every change and apply what is allowed. `judge(call)` is the bridge's judge (createBridge(...).judge) built with an `ask` that records the question and answers no, so an Ask comes back as
 * { allow: false, asked: true }. `ask(summary, detail)` shows the ONE card listing the files; the person takes all or none. `writeReal(rel, buffer | null)` writes (or, with null, deletes) through the
 * workspace's own path with checkpoints. In Plan mode nothing is kept.
 * Returns { applied: [rel], discarded: [{ rel, why }], asked: [rel] }.
 */
export async function review({ root, dir, changes, mode, judge, ask, writeReal, writeLimit = WRITE_LIMIT_BYTES }) {
  const applied = []; const discarded = []; const pending = []; const lines = [];
  if (mode === 'plan') return { applied, discarded: changes.map((c) => ({ rel: c.rel, why: 'Plan mode keeps nothing' })), asked: [] };
  for (const c of changes) {
    if (c.kind === 'link') { discarded.push({ rel: c.rel, why: 'a link is never copied back' }); continue; }
    if (c.kind === 'type') { discarded.push({ rel: c.rel, why: 'a file turned into a folder, or the other way' }); continue; }
    const bad = badName(c.rel);
    if (bad) { discarded.push({ rel: c.rel, why: bad }); continue; }
    if (c.size !== undefined && c.size > writeLimit) { discarded.push({ rel: c.rel, why: 'a file over the size limit' }); continue; }
    const call = { name: c.kind === 'change' ? 'edit_file' : 'write_file', path: join(root, ...c.rel.split('/')), engineTool: 'staged' };
    const verdict = await judge(call);
    const later = runsLater(c.rel);
    if (verdict.allow && !later) { pending.push({ c, later: false }); continue; }
    if (!verdict.allow && !verdict.asked) { discarded.push({ rel: c.rel, why: verdict.reason }); continue; }
    // an Ask (the mode or a rule asks), or a "runs code later" file: one card for all of them
    pending.push({ c, later, asking: true });
    lines.push(`${later ? '[runs code later] ' : ''}${plainKind(c)}: ${c.rel}`);
  }
  const askFiles = pending.filter((p) => p.asking);
  let yes = true;
  if (askFiles.length) yes = (await ask(`Keep ${askFiles.length} change${askFiles.length === 1 ? '' : 's'} from the engine`, `${lines.join('\n')}\n\nThe engine worked in a copy. These need your OK before they reach your folder.`)) === true;
  for (const p of pending) {
    if (p.asking && !yes) { discarded.push({ rel: p.c.rel, why: 'you did not allow it' }); continue; }
    const target = join(dir, ...p.c.rel.split('/'));
    try {
      if (p.c.kind === 'delete') await writeReal(p.c.rel, null);
      else await writeReal(p.c.rel, await readFile(target));
      applied.push(p.c.rel);
    } catch (err) { discarded.push({ rel: p.c.rel, why: `it could not be written (${String(err?.message ?? err).slice(0, 80)})` }); }
  }
  return { applied, discarded, asked: askFiles.map((p) => p.c.rel) };
}

/** Say what happened in a few plain lines for the reply. */
export function describeReview({ applied, discarded }) {
  const parts = [];
  if (applied.length) parts.push(`Kept ${applied.length} change${applied.length === 1 ? '' : 's'}: ${applied.slice(0, 6).join(', ')}${applied.length > 6 ? ', …' : ''}.`);
  if (discarded.length) parts.push(`Not kept (${discarded.length}): ${discarded.slice(0, 6).map((d) => `${d.rel} (${d.why})`).join('; ')}${discarded.length > 6 ? '; …' : ''}.`);
  return parts.join(' ') || 'The engine changed no files.';
}

export const stageDirFor = (dataDir, engineId, chatId) => join(dataDir, 'engines', engineId, 'stage', String(chatId).replace(/[^\w-]/g, '_'));
export async function discard(dir) { await removeTree(dir).catch(() => {}); }
export const _internal = { sep };
