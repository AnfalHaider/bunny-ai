// AGENT-FLOW F12: which folders the person trusted for Auto. A small file in Bunny's data folder, keyed by the folder's REAL path (a junction or a different spelling of the same
// folder is the same key). Only the Auto answer lives here; trust in a folder's instruction files is FOLDER-RULES' own record (Follow, with the shas of the text shown), never this file.
// A folder never seen has no entry, which is "never asked", not "no".
import { execFile } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { gitPath, safeEnv } from './safeExec.js';

const key = (folder) => String(folder).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Is this folder inside a git working tree? Git by its absolute path, no project fsmonitor, a short wait; any failure is "no" (fails closed). */
export function isGitWorkTree(folder) {
  return new Promise((done) => {
    const program = gitPath();
    if (!program) { done(false); return; }
    execFile(program, ['-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree'], { cwd: folder, timeout: 5000, windowsHide: true, shell: false, env: safeEnv() }, (err, stdout) => {
      done(!err && String(stdout).trim() === 'true');
    });
  });
}

/** @param {{ file: string }} options */
export function createFolderTrust({ file }) {
  let entries = null;
  let queue = Promise.resolve();
  const load = async () => {
    if (entries) return entries;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      entries = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { entries = {}; }
    return entries;
  };
  const save = () => {
    queue = queue.then(async () => {
      const temp = `${file}.${process.pid}.tmp`;
      try { await writeFile(temp, JSON.stringify(entries, null, 2), 'utf8'); await rename(temp, file); } catch { await rm(temp, { force: true }).catch(() => {}); }
    });
    return queue;
  };
  const real = async (folder) => { try { return await realpath(String(folder)); } catch { return null; } };
  return {
    /** The answer for a folder: { folder, auto: true|false|null } (null = never asked). */
    async get(folder) {
      const r = await real(folder);
      if (!r) return { folder: null, auto: null };
      const e = (await load())[key(r)];
      return { folder: r, auto: typeof e?.auto === 'boolean' ? e.auto : null };
    },
    /** Record the Auto answer for a folder. */
    async set(folder, answer) {
      const r = await real(folder);
      if (!r) return null;
      const all = await load();
      const prev = all[key(r)] ?? {};
      const next = { path: r, auto: prev.auto ?? null, at: new Date().toISOString() };
      if (typeof answer?.auto === 'boolean') next.auto = answer.auto;
      all[key(r)] = next;
      await save();
      return { folder: r, auto: next.auto };
    },
    /** Forget a folder: it is asked about again the next time. */
    async forget(folder) {
      const all = await load();
      const r = (await real(folder)) ?? String(folder);
      const had = Object.hasOwn(all, key(r)) || Object.hasOwn(all, key(folder));
      delete all[key(r)]; delete all[key(folder)];
      await save();
      return had;
    },
    /** Every folder with an answer (for Settings). */
    async list() {
      return Object.values(await load()).map((e) => ({ folder: e.path, auto: e.auto ?? null, at: e.at ?? null })).sort((a, b) => String(a.folder).localeCompare(String(b.folder)));
    },
    async flush() { await queue; },
  };
}

/**
 * What Smart does for this chat: 'auto' only when every condition holds, otherwise 'ask' (never anything looser). Pure.
 * `why` names the first reason it stayed in Ask, for the chip's tooltip.
 */
export function smartMode({ device = false, folderOk = false, git = false, trust = null, judgeOn = false, judgeDown = false } = {}) {
  if (device) return { mode: 'ask', why: 'Smart asks on a phone or another device.' };
  if (!folderOk) return { mode: 'ask', why: 'Smart asks until the chat has a folder.' };
  if (!judgeOn) return { mode: 'ask', why: "Smart starts in Ask while Bunny's check is off or can't be reached." };
  if (judgeDown) return { mode: 'ask', why: "Smart starts in Ask while Bunny's check is off or can't be reached." };
  if (!git) return { mode: 'ask', why: 'Smart asks outside a git folder.' };
  if (trust?.auto !== true) return { mode: 'ask', why: 'Smart asks in a folder you have not trusted for Auto.' };
  return { mode: 'auto', why: 'Smart runs in Auto here, with the check on.' };
}
