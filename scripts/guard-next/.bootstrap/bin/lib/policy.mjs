// Shared helpers: project root, policy, role, glob matching, git.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { parseFrontmatter } from './fm.mjs';

export const DEFAULT_POLICY = {
  version: 1,
  branches: { live: 'main', dev: 'dev' },
  docs_globs: ['docs/**', '*.md', '**/*.md', 'docs/**/*.png', 'docs/**/*.jpg', 'docs/**/*.webp'],
  // Only the Chief of Staff writes these, on the owner's typed word (AGENTS.md is the standing rules).
  protected_globs: ['.bootstrap/**', '.claude/settings.json', '.githooks/**', 'AGENTS.md', 'CLAUDE.md'],
  signoffs: { dir: 'docs/signoffs', default_required: ['qa', 'tech-lead', 'librarian', 'chief-of-staff'] },
  releases: { dir: 'docs/releases', live_pushers: ['release-ops', 'hotfix'], exempt_from_signoffs: ['hotfix'] },
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
};

export function git(args, cwd, opts = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch {
    return null;
  }
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
  };
}

export function currentRole(root) {
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

export function matchesAny(file, globs, { ci = false } = {}) {
  const p = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.some((g) => globToRegex(g, ci ? 'i' : '').test(p));
}

/**
 * The repo-relative form of a path ("docs/a.md"), or null when the path is outside the repo
 * (another drive, a sibling folder, a UNC share, "..\x"). Null means "not ours to police".
 * An in-repo file whose NAME starts with two dots ("..foo.md") is inside, and is policed.
 * `p` is the path module (win32 or posix), so the rules can be tested on any machine.
 */
export function toRepoPath(root, filePath, cwd, p = path) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return null;
  const abs = p.isAbsolute(filePath) ? filePath : p.join(cwd || root, filePath);
  const rel = p.relative(root, abs).replace(/\\/g, '/');
  if (rel === '..' || rel.startsWith('../') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
  return rel;
}

/**
 * The one scope rule, used by the file-tool guard, the pre-commit hook and the pre-push check.
 * Returns a reason string when `role` may not write `rel`, else null.
 * Protected paths are compared case-insensitively: Windows file systems are.
 */
export function scopeViolation(rel, policy, brief, role) {
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

/** scopeViolation over a list of repo-relative paths: ["src/a.js: role ... is outside that", ...]. */
export function scopeViolations(paths, policy, brief, role) {
  const out = [];
  for (const rel of paths) {
    const why = scopeViolation(rel.replace(/\\/g, '/'), policy, brief, role);
    if (why) out.push(why);
  }
  return out;
}
