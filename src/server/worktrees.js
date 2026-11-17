/**
 * W2-9: a git worktree per code chat (ADR-002, docs/adr/ADR-002-worktree-per-chat.md).
 *
 * A chat can have its own copy of the project: a git worktree on a new branch, kept in Bunny's data folder
 *   <data folder>/worktrees/<repo-slug>-<hash6>/<chat id, first 8>
 * never inside or beside the person's project. Two chats can then edit one repository at the same time without clashing.
 *
 * The record `session.worktree = { path, branch, base, baseSha, repo }` is written only by the server through this module
 * (create and finish); no route, patch, import or fork can set it. The effective root of a chat is that path while the record is
 * valid, else the folder the person picked.
 *
 * Nothing is ever lost silently: finishing keeps the branch by default (uncommitted work becomes one "Bunny: work in progress" commit),
 * merging is fast-forward only and only into a clean folder on the base branch, and discarding is the only thing that deletes work.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { access, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { gitPath, safeEnv } from './safeExec.js';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const GIT_TIMEOUT_MS = 120_000;
const WIP_MESSAGE = 'Bunny: work in progress';

/**
 * The only filter settings let through: EXACTLY what `git lfs install` writes (Security, w2-9-lows). Git runs a filter command through a shell, so "starts with git-lfs" would let a
 * project add a command separator and a command of its own. Any other value, or these with anything after them, refuses the copy.
 */
const LFS_FILTERS = { 'filter.lfs.clean': 'git-lfs clean -- %f', 'filter.lfs.smudge': 'git-lfs smudge -- %f', 'filter.lfs.process': 'git-lfs filter-process' };

const refuse = (code, message) => Object.assign(new Error(message), { code });

/**
 * The real git: found once as an absolute path in the PATH folders (W29-1: never a bare name, which Windows would look up in the project folder first), arguments only (never a shell),
 * no prompts, the current folder never searched for programs, and (W29-2) the project's own hooks and fsmonitor never run: hooksDir is an empty folder of Bunny's.
 */
/** The stand-in for every signing program: an ABSOLUTE path (under the data folder, beside the empty hooks folder) to a file that does not exist, so git never looks a bare name up on PATH. */
export function noSignerPath(hooksDir = null) {
  return join(hooksDir ? resolve(hooksDir, '..') : tmpdir(), 'bunny-no-such-signer').split(String.fromCharCode(92)).join('/');
}

export function runGit(args, { cwd, timeout = GIT_TIMEOUT_MS, hooksDir = null } = {}) {
  return new Promise((done, fail) => {
    const program = gitPath();
    if (!program) { fail(Object.assign(new Error('git was not found on this computer. Install Git for Windows to give a chat its own copy of a project.'), { code: 'git.missing' })); return; }
    const noSigner = noSignerPath(hooksDir);
    // commit.gpgSign and tag.gpgSign off: a project's own signing setting would start the signing program it names (gpg.program, gpg.ssh.program), and skipping hooks does not skip signing
    const safe = ['-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'rebase.gpgSign=false', '-c', 'merge.verifySignatures=false', '-c', 'log.showSignature=false', '-c', `gpg.program=${noSigner}`, '-c', `gpg.ssh.program=${noSigner}`, '-c', `gpg.x509.program=${noSigner}`, ...(hooksDir ? ['-c', `core.hooksPath=${hooksDir}`] : [])];
    execFile(program, [...safe, ...args], { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: false, env: safeEnv({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }) }, (err, stdout, stderr) => {
      if (err) fail(Object.assign(new Error(String(stderr || err.message).trim().slice(0, 600)), { code: 'git.failed', exit: err.code }));
      else done(String(stdout).trim());
    });
  });
}

const slugOf = (text, max) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'chat';
/** The branch prefix from Settings, made safe for a git branch name: letters, digits, "-", "_" and "/". */
const prefixOf = (prefix) => { const p = String(prefix ?? 'bunny/').replace(/[^A-Za-z0-9/_-]+/g, '-').replace(/\/{2,}/g, '/').replace(/^[/-]+/, '').slice(0, 30); return p ? (p.endsWith('/') ? p : `${p}/`) : 'bunny/'; };
const within = (base, target) => { const rel = relative(base, target); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };

export function createWorktrees({ dataDir, git: gitOverride = null, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const root = join(dataDir, 'worktrees');
  // W29-2: an empty folder as the hooks folder, so a repository's own hooks never run when Bunny asks git something
  const hooksDir = join(dataDir, 'empty-hooks');
  try { mkdirSync(hooksDir, { recursive: true }); } catch { /* git then runs without the setting only if the folder cannot be made: refuse instead */ }
  const git = gitOverride ?? ((args, o = {}) => runGit(args, { ...o, hooksDir }));
  const queues = new Map(); // git takes locks inside the shared .git: one worktree add/remove/prune at a time per repository

  /** Run `task` after everything already queued for this repository. */
  function serial(repoKey, task) {
    const run = (queues.get(repoKey) ?? Promise.resolve()).catch(() => {}).then(task);
    queues.set(repoKey, run);
    run.catch(() => {}).finally(() => { if (queues.get(repoKey) === run) queues.delete(repoKey); });
    return run;
  }

  async function realRoot() {
    await mkdir(root, { recursive: true });
    return realpath(root);
  }

  /**
   * W2-9 (Security LOW): a repository can name a program in its own .git/config that git runs when it checks files out or looks at them (filter.<name>.smudge, .clean, .process).
   * Bunny's own git calls cannot switch those off, so a project that defines one gets no copy of its own, with a plain reason.
   * @returns {Promise<string|null>} the reason, or null
   */
  async function filterDrivers(folder) {
    // The settings as git will read them when it checks files out: the project's .git/config AND everything it includes (include.path, includeIf), its worktree config and a -c on the
    // command line all count. --show-scope tells where each came from: only the person's own global and system settings (Git LFS is installed there) are theirs and are let through.
    // Only "nothing found" (exit 1) is read as none: any other failure of git refuses the copy.
    let found = '';
    try { found = await git(['config', '--show-scope', '-z', '--get-regexp', '^filter[.].*[.](smudge|clean|process)$'], { cwd: folder }); } catch (err) {
      if (err?.exit === 1) return null;
      return 'Git could not say whether this project runs its own programs when files are checked out, so Bunny will not make a copy of it.';
    }
    // An include whose CONDITION is not met here may be met where git checks the files out (a gitdir: or onbranch: condition is judged where git runs, and the copy is another folder): so any
    // include.path or includeIf.*.path in the project's own settings refuses the copy, whether or not it matches now. (--no-includes: list the keys, do not follow them.)
    let includes = '';
    try { includes = await git(['config', '--show-scope', '--no-includes', '-z', '--get-regexp', '^include(if)?[.]'], { cwd: folder }); } catch (err) {
      if (err?.exit !== 1) return 'Git could not say whether this project runs its own programs when files are checked out, so Bunny will not make a copy of it.';
    }
    const includeParts = includes.split(String.fromCharCode(0)).map((x) => x.trim()).filter(Boolean);
    for (let k = 0; k + 1 < includeParts.length; k += 2) {
      if (includeParts[k] !== 'global' && includeParts[k] !== 'system') return 'The git settings of this project include other settings files, which could name programs git runs when files are checked out, so Bunny will not make a copy of it.';
    }
    // -z with --show-scope: for each setting, the scope, a NUL, then "<key><NEWLINE><value>", a NUL. A value that itself holds a line break is refused (a shell would run each line).
    const NL = String.fromCharCode(10);
    const parts = found.split(String.fromCharCode(0));
    const own = [];
    for (let k = 0; k + 1 < parts.length; k += 2) {
      const scope = parts[k].trim();
      const record = parts[k + 1];
      const at = record.indexOf(NL);
      if (at < 0) { own.push(record); continue; }
      if (scope === 'global' || scope === 'system') continue;
      const value = record.slice(at + 1);
      if (/[\r\n]/.test(value) || LFS_FILTERS[record.slice(0, at).toLowerCase()] !== value.trim()) own.push(record);
    }
    if (parts.filter((x) => x.trim().length > 0).length % 2 === 1) own.push('unreadable'); // a record that does not pair up is not understood: refuse
    return own.length ? 'This project runs its own programs when git checks files out (a filter in its git settings), so Bunny will not make a copy of it.' : null;
  }

  /** May this chat's folder get its own copy? Said plainly when not (the switch is then dimmed with the reason). */
  async function eligibility(folder) {
    let top;
    try { top = await git(['rev-parse', '--show-toplevel'], { cwd: folder }); } catch { return { ok: false, reason: 'Needs a git folder. This folder is not one.' }; }
    let realTop;
    let realFolder;
    try { realTop = await realpath(resolve(top)); realFolder = await realpath(folder); } catch { return { ok: false, reason: 'That folder is not reachable.' }; }
    const filter = await filterDrivers(realTop);
    if (filter) return { ok: false, reason: filter };
    if (realTop.toLowerCase() !== realFolder.toLowerCase()) return { ok: false, reason: 'Choose the top folder of the project (the one that holds .git) to give a chat its own copy.' };
    try { if ((await git(['rev-parse', '--is-bare-repository'], { cwd: folder })) === 'true') return { ok: false, reason: 'A bare repository has no files to copy.' }; } catch { /* not bare */ }
    try { await access(join(realTop, '.gitmodules')); return { ok: false, reason: 'This project uses submodules, which do not work well with a separate copy.' }; } catch { /* none */ }
    let sha;
    try { sha = await git(['rev-parse', 'HEAD'], { cwd: folder }); } catch { return { ok: false, reason: 'This project has no commits yet, so there is nothing to copy.' }; }
    let base = null;
    try { const name = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: folder }); base = name && name !== 'HEAD' ? name : null; } catch { /* detached */ }
    return { ok: true, repo: realTop, base, baseSha: sha };
  }

  /** Make the copy. Throws (and leaves nothing behind) when it cannot. */
  async function create({ sessionId, folder, prefix, title }) {
    if (!/^[a-f0-9-]{36}$/.test(String(sessionId))) throw refuse('worktree.badId', 'That chat has no usable id.');
    const info = await eligibility(folder);
    if (!info.ok) throw refuse('worktree.notEligible', info.reason);
    const id8 = String(sessionId).slice(0, 8);
    const repoDir = `${slugOf(basename(info.repo), 24)}-${createHash('sha1').update(info.repo.toLowerCase()).digest('hex').slice(0, 6)}`;
    const parent = join(await realRoot(), repoDir);
    const path = join(parent, id8);
    return serial(info.repo, async () => {
      await mkdir(parent, { recursive: true });
      let branch = `${prefixOf(prefix)}${slugOf(title, 30)}-${id8}`;
      for (let n = 2; ; n += 1) { // a name that exists gets a counter
        try { await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: info.repo }); } catch { break; }
        branch = `${prefixOf(prefix)}${slugOf(title, 30)}-${id8}-${n}`;
        if (n > 50) throw refuse('worktree.name', 'Could not find a free branch name.');
      }
      try {
        await git(['-c', 'core.longpaths=true', 'worktree', 'add', '-b', branch, path, 'HEAD'], { cwd: info.repo });
        await git(['config', '--local', 'core.longpaths', 'true'], { cwd: path }).catch(() => {});
      } catch (err) {
        // half-made: remove the copy and the branch, then say what went wrong
        await git(['worktree', 'remove', '--force', path], { cwd: info.repo }).catch(() => {});
        await rm(path, { recursive: true, force: true }).catch(() => {});
        await git(['worktree', 'prune'], { cwd: info.repo }).catch(() => {});
        await git(['branch', '-D', branch], { cwd: info.repo }).catch(() => {});
        throw refuse('worktree.failed', `The copy could not be made: ${err.message}. If the path is too long, choose a shorter folder name or turn on long paths in Windows.`);
      }
      return { path: await realpath(path), branch, base: info.base, baseSha: info.baseSha, repo: info.repo };
    });
  }

  /**
   * Is this recorded copy still usable as a chat's root? It must sit inside <data folder>/worktrees (checked with real paths, so a junction out of it fails) and exist.
   * @returns {Promise<string|null>} the real path, or null
   */
  async function usable(worktree) {
    if (!worktree || typeof worktree.path !== 'string') return null;
    try {
      const base = await realRoot();
      const real = await realpath(worktree.path);
      if (!within(base, real)) return null;
      if (!(await stat(real)).isDirectory()) return null;
      return real;
    } catch { return null; }
  }

  /** What is in the copy, for the card and the finish dialog: files changed since the last commit, and commits the base lacks. Throws when git cannot be asked (never "no changes"). */
  async function status(worktree) {
    const real = await usable(worktree);
    if (!real) throw refuse('worktree.gone', `This chat's copy is gone; the branch ${worktree?.branch ?? ''} still has the work.`);
    const refused = (await filterDrivers(worktree.repo)) ?? (await filterDrivers(real)); // the project, and the copy (an include judged by where it sits)
    if (refused) throw refuse('worktree.filter', refused);
    const dirty = (await git(['status', '--porcelain'], { cwd: real })).split(/\r?\n/).filter(Boolean).length;
    let ahead = 0;
    try { ahead = Number(await git(['rev-list', '--count', `${worktree.baseSha}..HEAD`], { cwd: real })) || 0; } catch { /* base not reachable */ }
    return { dirty, ahead, branch: worktree.branch, base: worktree.base, baseSha: worktree.baseSha };
  }

  /** Take the copy away (3 tries on "in use", as Windows will not remove a folder something runs in). The path must be the recorded one, inside the worktrees folder. */
  async function removeCopy(worktree, { force = false } = {}) {
    const real = await usable(worktree);
    if (!real) { await git(['worktree', 'prune'], { cwd: worktree.repo }).catch(() => {}); return; }
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await git(['worktree', 'remove', ...(force ? ['--force'] : []), real], { cwd: worktree.repo });
        return;
      } catch (err) {
        lastError = err;
        if (!/busy|permission|denied|in use|EBUSY|EPERM/i.test(err.message)) break;
        await wait(500);
      }
    }
    if (force) { // git would not (a folder it cannot delete): clear what is left, never outside the worktrees folder
      if (!within(await realRoot(), real)) throw refuse('worktree.outside', 'That path is not inside Bunny\'s copies folder.');
      await rm(real, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      await git(['worktree', 'prune'], { cwd: worktree.repo }).catch(() => {});
      return;
    }
    throw lastError ?? refuse('worktree.failed', 'The copy could not be removed.');
  }

  /**
   * Finish the copy. action: 'keep' (default; uncommitted work becomes one commit, the copy goes, the branch stays),
   * 'merge' (fast-forward into the person's folder when it is clean and on the base branch; then the copy and the branch go),
   * 'discard' (the copy and the branch go, with everything on them).
   * @returns {Promise<{ok: boolean, action: string, branch?: string, reason?: string}>} ok false with a reason when nothing was changed
   */
  async function finish(worktree, { action = 'keep' } = {}) {
    if (!['keep', 'merge', 'discard'].includes(action)) throw refuse('worktree.action', 'Choose keep, merge or discard.');
    return serial(worktree.repo, async () => {
      const refused = await filterDrivers(worktree.repo);
      if (refused && action !== 'discard') return { ok: false, action, reason: `${refused} Nothing was changed; keep the branch by hand.` };
      if (action === 'discard') {
        await removeCopy(worktree, { force: true });
        await git(['branch', '-D', worktree.branch], { cwd: worktree.repo }).catch(() => {});
        return { ok: true, action };
      }
      const real = await usable(worktree);
      if (real) { // work done in the copy is kept first, in both other choices
        const changed = await git(['status', '--porcelain'], { cwd: real });
        if (changed) {
          await git(['add', '-A'], { cwd: real });
          await git(['-c', 'user.name=Bunny', '-c', 'user.email=bunny@localhost', 'commit', '--no-verify', '-m', WIP_MESSAGE], { cwd: real });
        }
      }
      if (action === 'merge') {
        if (!worktree.base) return { ok: false, action, reason: 'The project was not on a branch when the copy was made, so there is nothing to merge into. Keep the branch.' };
        let current;
        try { current = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree.repo }); } catch { return { ok: false, action, reason: 'Your project folder is not reachable. Keep the branch.' }; }
        if (current !== worktree.base) return { ok: false, action, reason: `Your project folder is on ${current}, not ${worktree.base}. Keep the branch, or switch the folder back to ${worktree.base}.` };
        if (await git(['status', '--porcelain'], { cwd: worktree.repo })) return { ok: false, action, reason: 'Your project folder has changes of its own. Keep the branch and merge it yourself.' };
        try { await git(['merge', '--ff-only', '--no-verify-signatures', worktree.branch], { cwd: worktree.repo }); } catch (err) { return { ok: false, action, reason: `It cannot be merged cleanly (${err.message.split('\n')[0]}). Nothing was changed. Keep the branch and merge it yourself.` }; }
        await removeCopy(worktree);
        await git(['branch', '-d', worktree.branch], { cwd: worktree.repo }).catch(() => {});
        return { ok: true, action };
      }
      await removeCopy(worktree);
      return { ok: true, action, branch: worktree.branch };
    });
  }

  /** Copies under the worktrees folder that no saved chat names: listed for the person, never removed by themselves. */
  async function leftovers(knownPaths) {
    const known = new Set((await Promise.all([...knownPaths].map((p) => realpath(p).catch(() => null)))).filter(Boolean).map((p) => p.toLowerCase()));
    const found = [];
    let base;
    try { base = await realRoot(); } catch { return found; }
    for (const repo of await readdir(base).catch(() => [])) {
      for (const chat of await readdir(join(base, repo)).catch(() => [])) {
        const real = await realpath(join(base, repo, chat)).catch(() => null);
        if (real && within(base, real) && !known.has(real.toLowerCase())) found.push({ path: real, repo, chat });
      }
    }
    return found;
  }

  /** Remove one listed leftover. Only a path directly under <worktrees>/<repo>/ that no saved chat names (the caller passes the same known set). */
  async function removeLeftover(path, knownPaths) {
    const real = await realpath(path).catch(() => null);
    const base = await realRoot();
    if (!real || !within(base, real) || relative(base, real).split(sep).length !== 2) throw refuse('worktree.outside', 'That is not one of Bunny\'s leftover copies.');
    const listed = await leftovers(knownPaths);
    if (!listed.some((l) => l.path.toLowerCase() === real.toLowerCase())) throw refuse('worktree.inUse', 'A saved chat still uses that copy.');
    await rm(real, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    return { ok: true };
  }

  /** Total size in bytes of the copies folder, for Settings. */
  async function sizeBytes() {
    let total = 0;
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(p); else total += (await stat(p).catch(() => ({ size: 0 }))).size;
      }
    };
    await walk(root);
    return total;
  }

  return { root, git, eligibility, create, usable, status, finish, leftovers, removeLeftover, sizeBytes };
}
