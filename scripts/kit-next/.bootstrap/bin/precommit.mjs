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
import { recordChecks } from './lib/records.mjs';
import { DEFAULT_POLICY, currentRole, git, loadPolicy, loadRole, repoRoot, resolveContext, scopeViolations } from './lib/policy.mjs';

/** Staged paths, renames reported as both sides (so moving a file out of scope is caught). */
export function stagedPaths(root) {
  const out = git(['diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRD'], root);
  if (out === null) throw new Error('git diff --cached failed');
  return out.split('\0').filter(Boolean);
}

/** Staged changes as [{ status, path }], renames as a delete plus an add. */
export function stagedChanges(root) {
  const out = git(['diff', '--cached', '--name-status', '-z', '--no-renames', '--diff-filter=ACMRD'], root);
  if (out === null) throw new Error('git diff --cached failed');
  const parts = out.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i][0] === 'C' ? 'A' : parts[i][0], path: parts[i + 1] });
  return changes;
}

function main() {
  let root = null;
  let role = 'unassigned';
  try {
    const ctx = resolveContext(process.cwd());
    root = ctx ? ctx.top : null;
    let policy;
    let degraded = false;
    try {
      policy = ctx && loadPolicy(ctx.project);
      if (ctx && !policy) { process.stderr.write('pre-commit: the project has no .bootstrap/policy.json: refused.\n'); return process.exit(1); } // K-2: no policy means refuse
    } catch (err) {
      // The policy file exists but cannot be read: say so loudly, and still hold the built-in
      // protected paths (never the role scopes, which come from that same policy).
      process.stderr.write(`pre-commit: internal error (${err.message}); .bootstrap/policy.json is unreadable, so only the built-in protected paths are checked.\n`);
      policy = { ...DEFAULT_POLICY };
      degraded = true;
    }
    if (!policy || policy.scope_check?.commit === false) return process.exit(0);
    role = ctx.registered ? currentRole(root) : 'unassigned';
    const brief = degraded ? {} : loadRole(root, role) || {};
    const bad = scopeViolations(stagedPaths(root), policy, brief, role);
    if (policy.records_check !== false && !degraded) {
      // G1-2: sign-off and release records are written by the role they name (see lib/records.mjs)
      const readNew = (p) => git(['show', `:${p}`], root) ?? '';
      const readOld = (p) => git(['show', `HEAD:${p}`], root) ?? '';
      bad.push(...recordChecks({ changes: stagedChanges(root), role, policy, readNew, readOld }));
    }
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
