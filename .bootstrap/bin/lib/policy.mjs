// Shared helpers: project root, policy, role, glob matching, git.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
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

export function globToRegex(glob) {
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
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.some((g) => globToRegex(g).test(p));
}

export function toRepoPath(root, filePath, cwd) {
  const abs = isAbsolute(filePath) ? filePath : join(cwd || root, filePath);
  return relative(root, abs).replace(/\\/g, '/');
}
