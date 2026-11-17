// Shared helpers: project root, policy, role, glob matching, git.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path, { join } from 'node:path';
import { parseFrontmatter } from './fm.mjs';

export const DEFAULT_POLICY = {
  version: 1,
  branches: { live: 'main', dev: 'dev' },
  docs_globs: ['docs/**', '*.md', '**/*.md', 'docs/**/*.png', 'docs/**/*.jpg', 'docs/**/*.webp'],
  // Only the Chief of Staff writes these, on the owner's typed word (AGENTS.md is the standing rules).
  protected_globs: ['.bootstrap/**', '.claude/settings.json', '.githooks/**', 'AGENTS.md', 'CLAUDE.md'],
  signoffs: { dir: 'docs/signoffs', default_required: ['qa', 'tech-lead', 'librarian', 'chief-of-staff'] },
  releases: { dir: 'docs/releases', live_pushers: ['release-ops', 'hotfix', 'chief-of-staff'], exempt_from_signoffs: ['hotfix'] },
  // Regexes. Matched against the whole shell command. Applies to every role.
  deny_all: [
    '\\bgit\\s+push\\b.*\\s(--force|-f|--force-with-lease)(\\s|=|$)',
    '--no-verify\\b',
    '\\bgit\\s+config\\b.*\\bcore\\.hooksPath\\b',
    '\\bgit\\s+reset\\s+--hard\\b',
    '^\\s*(ssh|scp)\\s',
  ],
  // Project-specific destructive commands found in Phase 0H (e.g. a test runner that resets the DB).
  destructive_commands: [],
  // A1: the scope check on changed paths. Pushers listed here move other roles' commits, so are not re-checked at push.
  scope_check: { commit: true, push: true, push_exempt_roles: ['release-ops', 'hotfix', 'chief-of-staff'] },
  // K-1: the record folders are written through the bootstrap command; only these roles write there by hand. In the DEFAULT policy, so a project made by `init` has it too.
  records: { globs: ['docs/signoffs/**', 'docs/releases/**', 'docs/flow-changes/**', 'docs/kit-changes/**'], writers: ['chief-of-staff'] },
};

// K1-5: one decision has a deadline (the host cuts a hook off at 10 s, and a cut-off hook must not become a pass). Every git spawn checks it first and is
// given the time that is left; the guard turns the error into a refusal.
let deadlineAt = Infinity;
export class GuardDeadline extends Error {}
export function setDeadline(ms) { deadlineAt = ms === null || ms === undefined ? Infinity : Date.now() + ms; }
export function checkDeadline() { if (Date.now() > deadlineAt) throw new GuardDeadline('the decision took too long'); }
/** K1-5: true when git itself cannot answer (missing, failing or too slow): then "not in a repository" cannot be told from "git is broken", and the guard must not read silence as a pass. */
export function gitBroken(cwd) {
  const timeout = spawnTimeout(3000);
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore', timeout }); return false; } catch (err) { checkDeadline(); return err?.status !== 128; } // 128 is git saying "not a repository": an answer
}
/** K1-5: every git spawn outside git() asks this first: it throws when the time is up, and caps the spawn's own timeout at what is left. */
export function spawnTimeout(max = 2000) {
  checkDeadline();
  return Number.isFinite(deadlineAt) ? Math.max(50, Math.min(max, deadlineAt - Date.now())) : max;
}

export function git(args, cwd, opts = {}) {
  checkDeadline();
  const left = deadlineAt - Date.now();
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...(Number.isFinite(left) ? { timeout: Math.max(50, left) } : {}), ...opts }).trim();
  } catch {
    checkDeadline();
    return null;
  }
}

// The project's own branch names. Live: the remote's default branch, else the first of the usual
// names that exists, else the current branch. Dev: an integration branch only if one exists (null = none:
// pieces go straight to live through a release, and sign-offs are checked on that push).
export const LIVE_NAMES = ['main', 'master', 'trunk', 'production', 'prod', 'release'];
export const DEV_NAMES = ['develop', 'dev', 'development', 'staging', 'stage', 'next', 'integration'];
export function detectBranches(root) {
  const has = (b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], root) || git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`], root);
  const head = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root);
  const live = (head && head.replace(/^origin\//, '')) || LIVE_NAMES.find(has) || git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root) || 'main';
  const dev = DEV_NAMES.find((b) => b !== live && has(b)) || null;
  return { live, dev };
}

export function repoRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

export function loadPolicy(root) {
  const p = join(root, '.bootstrap', 'policy.json');
  if (!existsSync(p)) return null; // not bootstrapped: every guard is a no-op
  const user = JSON.parse(readFileSync(p, 'utf8'));
  return {
    ...DEFAULT_POLICY,
    ...user,
    branches: { ...DEFAULT_POLICY.branches, ...user.branches },
    signoffs: { ...DEFAULT_POLICY.signoffs, ...user.signoffs },
    releases: { ...DEFAULT_POLICY.releases, ...user.releases },
    scope_check: { ...DEFAULT_POLICY.scope_check, ...user.scope_check },
    records: { ...DEFAULT_POLICY.records, ...user.records },
  };
}

const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export const insideDir = (child, dir) => { const c = norm(child); const d = norm(dir); return c === d || c.startsWith(d + '/'); };

/** The work tree folders git has registered for the repository whose main checkout is `main`: [main, ...linked worktrees]. */
export function worktreeRoots(main) {
  const out = git(['worktree', 'list', '--porcelain'], main) || '';
  const roots = out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length).trim()).filter(Boolean);
  return roots.length ? roots : [main];
}

/**
 * K-2: where is the project, and what is this folder to it?
 *   top        the work tree folder git sees for `cwd` (it can be a planted one)
 *   project    the main checkout of the repository: its policy.json judges everything below it
 *   registered the folder IS the project or a worktree git has registered for it: it may use its own role file. Anything else (a nested
 *              repository, a folder with a planted .git file) is judged by the project's policy with the role "unassigned"
 *   roots      every registered work tree folder, for the protected-path checks
 * `hint` is where the host runs the hook, or the project it names: it finds the project of an INDEPENDENT repository nested inside it (git init sub).
 * Returns null when cwd is not in a repository at all.
 */
export function resolveContext(cwd, hints = [process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
  const top = repoRoot(cwd);
  if (!top) return null;
  const common = (dir) => { const c = git(['rev-parse', '--git-common-dir'], dir); return c ? path.resolve(dir, c) : null; };
  const mainOf = (dir) => {
    const c = common(dir);
    const g = git(['rev-parse', '--absolute-git-dir'], dir);
    if (!c || !g) return null;
    return norm(g) !== norm(c) ? path.dirname(c) : (repoRoot(dir) || dir); // a linked worktree: the main checkout is above the shared .git
  };
  let project = mainOf(top) || top;
  const hasPolicy = (dir) => existsSync(join(dir, '.bootstrap', 'policy.json')); // only whether the file is there: an unreadable one is the caller's to report
  if (!hasPolicy(project)) { // a nested repository with no policy of its own: the nearest folder above it that has one is the project
    for (let d = path.dirname(path.resolve(project)); ; d = path.dirname(d)) { if (existsSync(join(d, '.bootstrap', 'policy.json'))) { project = mainOf(d) || d; break; } if (path.dirname(d) === d) break; }
  }
  for (const h of hints) {
    if (!h) continue;
    const hp = repoRoot(h) ? mainOf(h) : null;
    if (hp && norm(hp) !== norm(project) && insideDir(project, hp) && norm(common(project) ?? '') !== norm(common(hp) ?? '') && hasPolicy(hp)) { project = hp; break; }
  }
  // K2-4: when the host names the project (CLAUDE_PROJECT_DIR) and it has a policy, that project judges EVERY folder: one that is not a registered worktree of it
  // (an independent repository outside it, a planted .git whose commondir points elsewhere) is "unassigned" with the project's policy, wherever it is.
  const named = process.env.CLAUDE_PROJECT_DIR;
  if (named && repoRoot(named) && existsSync(join(named, '.bootstrap', 'policy.json'))) { const np = mainOf(named); if (np) project = np; }
  const roots = worktreeRoots(project);
  if (!roots.some((r) => norm(r) === norm(project))) roots.unshift(project);
  const registered = roots.some((r) => norm(r) === norm(top));
  return { top, project, registered, roots };
}

/** A path that decides what git or the guard believes: a .git file, a planted git directory's commondir or role file, a policy.json under .bootstrap. */
export function plantedGitPath(rel) {
  const p = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  return /(^|\/)\.git(\/|$)/i.test(p) || /(^|\/)(commondir|bootstrap-role|gitdir)$/i.test(p) || /(^|\/)\.bootstrap\/policy\.json$/i.test(p);
}

/**
 * K-2 (K2-3): the file may belong to ANOTHER worktree of the repository (the main checkout's .githooks, .bootstrap/bin, policy, AGENTS.md by absolute path).
 * Protected globs and record folders are matched against every registered root the path is inside of, not only the current one.
 */
export function otherRootsViolation(filePath, cwd, ctx, policy, role) {
  if (!ctx || role === 'chief-of-staff') return null;
  const gitOnly = role === 'release-ops'; // Release Ops moves refs and tags: git's own folders are theirs too, nothing else of this check is
  for (const r of ctx.roots) {
    const rel = toRepoPath(r, filePath, cwd);
    if (rel === null || (typeof rel === 'object' && rel?.refused)) continue;
    const why = scopeViolation(rel, policy, {}, role) ?? recordViolation(rel, policy, role);
    if (why) return why;
  }
  // a planted git file or role file, or anything inside a .git directory, in the project or any of its worktrees
  for (const r of [ctx.project, ...ctx.roots]) {
    const rel = toRepoPath(r, filePath, cwd);
    if (typeof rel === 'string' && plantedGitPath(rel) && !(gitOnly && releaseOpsMayWrite(rel))) return `${rel} decides what git or the guard believes (a .git file or directory, commondir, bootstrap-role, policy.json under .bootstrap). Only the Chief of Staff writes it.`;
  }
  return null;
}

/** The role file the bootstrap command writes into this worktree's private git directory (outside the files a role edits). */
export function roleFile(root) {
  const dir = git(['rev-parse', '--absolute-git-dir'], root);
  return dir ? join(dir, 'bootstrap-role') : null;
}

/** Is this path the role file of some worktree (<git dir>/bootstrap-role)? It sits outside the working files, so toRepoPath calls it "outside"; it is still not a file a role writes. */
export function isRoleFile(text, cwd, p = path, opts = {}) {
  if (typeof text !== 'string' || !text) return false;
  const stripped = stripDevicePrefix(text, p);
  if (stripped === null) return true; // a device path the guard cannot read: treated as the role file, so refused
  const abs = p.normalize(p.isAbsolute(stripped) ? stripped : p.join(cwd || process.cwd(), stripped));
  const clean = (str) => str.replace(/\\/g, '/').split('/').map((seg) => (p === path.win32 ? (seg.split(':')[0].replace(/[. ]+$/, '') || seg) : seg)).join('/');
  const looksLike = (str) => /(^|\/)\.git\/(worktrees\/[^/]+\/)?bootstrap-role$/i.test(clean(str));
  if (looksLike(abs)) return true;
  // links, junctions and 8.3 names: the file the path really leads to
  if (opts.canonical ?? p === path) {
    const real = canonicalPath(abs, p, opts.realpath ?? ((x) => realpathSync.native(x)));
    if (real && looksLike(real)) return true;
  }
  return false;
}

export function currentRole(root) {
  // The private role file wins; the environment is the fallback, and a mismatch is said out loud (item 6, G1-4/G1-5).
  const file = roleFile(root);
  if (file && existsSync(file)) {
    const fromFile = readFileSync(file, 'utf8').trim();
    if (fromFile) {
      if (process.env.BOOTSTRAP_ROLE && process.env.BOOTSTRAP_ROLE !== fromFile) {
        process.stderr.write(`guard: BOOTSTRAP_ROLE says "${process.env.BOOTSTRAP_ROLE}" but this worktree's role file says "${fromFile}"; using the file.\n`);
      }
      return fromFile;
    }
  }
  if (process.env.BOOTSTRAP_ROLE) return process.env.BOOTSTRAP_ROLE;
  const p = join(root, '.bootstrap', 'session.json');
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')).role || 'unassigned'; } catch { /* fall through */ }
  }
  return 'unassigned';
}

export function loadRole(root, role) {
  for (const dir of [join(root, '.bootstrap', 'roles'), join(root, 'roles')]) {
    const p = join(dir, `${role}.md`);
    if (existsSync(p)) return parseFrontmatter(readFileSync(p, 'utf8')).data || {};
  }
  return null;
}

export function globToRegex(glob, flags = '') {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, flags);
}

/**
 * K-1 (Security K1-1): an id that becomes a folder or file name. Plain letters, digits, dot, dash and underscore; no "..", no trailing dot or space,
 * no Windows reserved device name (con, prn, aux, nul, com1-9, lpt1-9, also with an extension).
 */
export function isPlainId(id) {
  const s = String(id ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && !s.includes('..') && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s);
}

export function matchesAny(file, globs, { ci = false } = {}) {
  const p = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.some((g) => globToRegex(g, ci ? 'i' : '').test(p));
}

/** Returned by toRepoPath when a path cannot be read safely: callers block it ("that path could not be read safely"). */
export const isRefusedPath = (v) => v !== null && typeof v === 'object' && typeof v.refused === 'string';

// Windows reads \\?\D:\x and \\.\D:\x as D:\x, and \\?\UNC\srv\sh as \\srv\sh.
function stripDevicePrefix(text, p) {
  if (p !== path.win32) return text;
  if (/^[\\/]{2}[?.][\\/]UNC[\\/]/i.test(text)) return text.replace(/^[\\/]{2}[?.][\\/]UNC[\\/]/i, '\\\\');
  if (/^[\\/]{2}[?.][\\/][A-Za-z]:([\\/]|$)/.test(text)) return text.replace(/^[\\/]{2}[?.][\\/]/, '');
  if (/^[\\/]{2}[?.][\\/]/.test(text)) return null; // GLOBALROOT, Volume{...}, pipes: not a file path the guard can judge
  return text;
}

/**
 * The canonical form of `abs`: links, junctions and 8.3 names resolved. A path that does not exist yet is canonicalised
 * through its nearest existing parent (a junction in the middle is followed). Returns the path, or null when nothing
 * on the way can be read (permission, a broken link, a loop): the caller fails closed.
 */
function canonicalPath(abs, p, realpath) {
  const rest = [];
  let cur = abs;
  for (let guard = 0; guard < 256; guard += 1) {
    try {
      const real = realpath(cur);
      return rest.length ? p.join(real, ...rest.reverse()) : real;
    } catch (err) {
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') return null; // EACCES, ELOOP, ...: cannot be read safely
      const up = p.dirname(cur);
      if (up === cur) return null;
      rest.push(p.basename(cur));
      cur = up;
    }
  }
  return null;
}

/**
 * Canonical form of `text` taken one segment at a time, so a ".." that follows a link or junction is applied to the link's
 * target (as the file system does), not to the link's own name. `from` is the folder a relative text starts in. null = unreadable.
 */
function walkCanonical(p, from, text, realpath) {
  const parsed = p.parse(text);
  const absolute = p.isAbsolute(text);
  let cur = absolute ? canonicalPath(parsed.root || p.sep, p, realpath) : canonicalPath(from, p, realpath);
  if (cur === null) return null;
  const segs = (absolute ? text.slice(parsed.root.length) : text).split(/[\\/]+/).filter((s) => s && s !== '.');
  for (const seg of segs) {
    if (seg === '..') { cur = p.dirname(cur); continue; }
    const next = canonicalPath(p.join(cur, seg), p, realpath);
    if (next === null) return null;
    cur = next;
  }
  return cur;
}

/**
 * The repo-relative form of a path ("docs/a.md"); null when the path canonicalises to somewhere outside the repo
 * (another drive, a sibling folder, a UNC share, "..\x"): not ours to police; or { refused } when it cannot be read
 * safely (NUL, a drive-relative "C:x", a link loop, a folder with no read permission): the caller blocks it.
 * An in-repo file whose NAME starts with two dots ("..foo.md") is inside, and is policed.
 *
 * Links, junctions, 8.3 names and case are resolved through the file system (the path and then its nearest existing
 * parent), so "docs/j/x" where "docs/j" is a junction to ".bootstrap" is read as ".bootstrap/x".
 * `p` is the path module (win32 or posix); `opts.canonical` turns the file-system step on or off (default: on for the
 * real path module when the root exists, so tests that use an invented root and a foreign path module stay text-only);
 * `opts.realpath` replaces realpathSync.native in tests.
 */
export function toRepoPath(root, filePath, cwd, p = path, opts = {}) {
  if (typeof filePath !== 'string' || !filePath) return null;
  if (filePath.includes('\0') || String(cwd ?? '').includes('\0')) return { refused: 'the path has a NUL character in it' };
  const realpath = opts.realpath ?? ((x) => realpathSync.native(x));
  const text = stripDevicePrefix(filePath, p);
  const rootText = stripDevicePrefix(String(root), p);
  const cwdText = cwd ? stripDevicePrefix(String(cwd), p) : rootText;
  if (text === null || rootText === null || cwdText === null) return { refused: 'a Windows device path (\\\\?\\ or \\\\.\\ other than a drive or a UNC share) cannot be judged' };
  if (p === path.win32 && /^[A-Za-z]:(?![\\/])/.test(text)) return { refused: 'a drive-relative path (C:x) cannot be resolved' };
  let abs = p.isAbsolute(text) ? text : p.join(cwdText, text);
  let base = rootText;
  const canonical = opts.canonical ?? (p === path && existsSync(rootText));
  if (canonical) {
    base = canonicalPath(rootText, p, realpath);
    abs = base === null ? null : walkCanonical(p, p.isAbsolute(text) ? null : cwdText, text, realpath);
    if (base === null || abs === null) return { refused: 'the path or the repository folder could not be read' };
  }
  let rel = p.relative(base, abs).replace(/\\/g, '/');
  if (rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
  if (p === path.win32) {
    // Windows reads ".bootstrap." and ".bootstrap " as ".bootstrap", and "x::$DATA" / "x:stream" as "x" (the file system does not
    // fold these for names that do not exist yet).
    rel = rel.split('/').map((seg) => seg.split(':')[0].replace(/[. ]+$/, '') || seg).join('/');
  }
  return rel;
}

/**
 * The one scope rule, used by the file-tool guard, the pre-commit hook and the pre-push check.
 * Returns a reason string when `role` may not write `rel`, else null.
 * Protected paths are compared case-insensitively: Windows file systems are.
 */
/** The literal folder or file each protected glob starts at (".bootstrap/**" -> ".bootstrap"; ".git/config" -> ".git/config"). */
function protectedRoots(globs) {
  return (globs || []).map((g) => String(g).replace(/\\/g, '/').split(/[*?[]/)[0].replace(/\/+$/, '')).filter(Boolean);
}

/** Is rel a protected folder itself, or a folder above one ("." , ".git", ".bootstrap")? Removing or moving it takes the protected files with it. */
export function holdsProtected(rel, policy) {
  const r = String(rel).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  if (r === '' || r === '.') return false; // the repository root itself: too common a target (git restore .) to refuse here
  return protectedRoots(policy.protected_globs).some((root) => {
    const lower = root.toLowerCase();
    return lower === r || lower.startsWith(`${r}/`);
  });
}

export function scopeViolation(rel, policy, brief, role) {
  if (role === 'chief-of-staff' && holdsProtected(rel, policy)) return null; // protected folders are the Chief of Staff's, whatever its write_globs
  if (role !== 'chief-of-staff' && holdsProtected(rel, policy)) {
    return `${rel || '.'} is, or contains, protected toolkit config (the hooks, the policy, the rules). Removing or moving it is the Chief of Staff's, on the owner's typed word.`;
  }
  if (matchesAny(rel, policy.protected_globs || [], { ci: true })) {
    // Protected paths are the Chief of Staff's by definition, so the role's own write_globs do not apply to them.
    return role === 'chief-of-staff' ? null
      : `${rel} is protected toolkit config. Only the Chief of Staff changes it, on the owner's typed word.`;
  }
  const scope = brief?.write_globs;
  if (Array.isArray(scope) && scope.length && !matchesAny(rel, scope)) {
    return `role "${role}" writes only ${scope.join(', ')}; ${rel} is outside that. File a board row for the role that owns it.`;
  }
  return null;
}

/**
 * Sign-off and release records are written through the bootstrap command (which checks the role and the ids),
 * not by hand. Only `policy.records.writers` write there directly. Not part of the commit-time check:
 * a role commits its own record file after the command wrote it.
 */
export function recordViolation(rel, policy, role) {
  const r = policy.records;
  if (!r || !Array.isArray(r.globs) || !r.globs.length) return null;
  if (!matchesAny(rel, r.globs, { ci: true }) || (r.writers || []).includes(role)) return null;
  return `${rel} is a sign-off or release record. Only ${(r.writers || []).join(' / ') || 'nobody'} writes there directly; everyone else uses the bootstrap command ("bootstrap signoff <piece> --verdict PASS").`;
}

/** scopeViolation over a list of repo-relative paths: ["src/a.js: role ... is outside that", ...]. */
export function scopeViolations(paths, policy, brief, role) {
  const out = [];
  for (const rel of paths) {
    const why = scopeViolation(rel.replace(/\\/g, '/'), policy, brief, role);
    if (why) out.push(why);
  }
  return out;
}

// Release Ops moves branches and tags: only ref storage is theirs, never the trust anchors (commondir, gitdir, bootstrap-role, config, hooks, worktrees/*)
const REF_STORAGE = /(^|\/)\.git\/(refs\/(heads|tags)\/|packed-refs$|ORIG_HEAD$|FETCH_HEAD$)/i;
const TRUST_ANCHOR = /(^|\/)(commondir|bootstrap-role|gitdir|config|hooks(\/|$))/i;
function releaseOpsMayWrite(rel) {
  return REF_STORAGE.test(rel) && !TRUST_ANCHOR.test(rel.replace(/^.*?\.git\//i, ""));
}
