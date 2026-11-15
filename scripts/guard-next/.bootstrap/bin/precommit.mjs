#!/usr/bin/env node
// Git pre-commit check (A1). Runs for every tool and every human, because git runs it.
//
// A command string cannot be parsed reliably for what it writes (sed -i, >, tee, node -e, a script
// the agent just wrote...), but git always knows what actually changed. So the role's limits are
// enforced here, on the STAGED paths, with the same rule the file-tool guard uses:
//   * protected_globs (.bootstrap/**, .githooks/**, AGENTS.md, ...) only the Chief of Staff
//   * write_globs     the role's own scope, when its brief declares one
//
// Fails OPEN, loudly, on an internal error (a bug here must not stop every commit);
// fails CLOSED only on a definite violation.
import { pathToFileURL } from 'node:url';
import { currentRole, git, loadPolicy, loadRole, repoRoot, scopeViolations } from './lib/policy.mjs';

/** Staged paths, renames reported as both sides (so moving a file out of scope is caught). */
export function stagedPaths(root) {
  const out = git(['diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRD'], root);
  if (out === null) throw new Error('git diff --cached failed');
  return out.split('\0').filter(Boolean);
}

function main() {
  try {
    const root = repoRoot(process.cwd());
    const policy = root && loadPolicy(root);
    if (!policy || policy.scope_check?.commit === false) return process.exit(0);
    const role = currentRole(root);
    const brief = loadRole(root, role) || {};
    const bad = scopeViolations(stagedPaths(root), policy, brief, role);
    if (!bad.length) return process.exit(0);
    for (const b of bad) process.stderr.write(`pre-commit: ${b}\n`);
    process.stderr.write(`pre-commit: commit refused for role "${role}". Unstage those paths, or file a board row for the role that owns them. Never bypass the hook.\n`);
    return process.exit(1);
  } catch (err) {
    process.stderr.write(`pre-commit: internal error (${err.message}); the scope check did NOT run and the commit is not blocked. Tell the Chief of Staff.\n`);
    return process.exit(0);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
