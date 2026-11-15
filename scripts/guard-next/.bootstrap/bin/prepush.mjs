#!/usr/bin/env node
// Git pre-push check. Works with every AI tool and with humans, because git runs it.
// Installed by `bootstrap init` as .githooks/pre-push (core.hooksPath = .githooks).
//
// stdin (from git): "<local ref> <local sha> <remote ref> <remote sha>" per line.
// Rules (AGENTS.md O10, O11, 7E, 7F):
//   * any branch: no conflict markers in added lines
//   * dev and live: every commit touching non-docs files must be covered by a complete sign-off
//     (docs/signoffs/<piece>/<role>.md, verdict PASS, same sha for every required role);
//     the covered commit, or any descendant reached only through docs-only commits, may be pushed
//   * live: only live_pushers roles, and a release record in docs/releases/ naming the pushed sha,
//     the owner's words, the question asked, and a pasted pre-release check
//   * hotfix role is exempt from sign-offs (not from the release record)
//   * deleting live or dev is refused
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { currentRole, git, loadPolicy, matchesAny, repoRoot } from './lib/policy.mjs';

const ZERO = /^0+$/;

function lsTree(root, sha, dir) {
  const out = git(['ls-tree', '-r', '--name-only', sha, '--', dir], root);
  return out ? out.split('\n').filter(Boolean) : [];
}
function show(root, sha, path) {
  return git(['show', `${sha}:${path}`], root) || '';
}
function sameSha(a, b) {
  if (!a || !b) return false;
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

export function completeSignoffs(root, sha, policy) {
  // Returns [{piece, sha}] for every piece whose required roles all signed PASS on one sha.
  const byPiece = new Map();
  for (const f of lsTree(root, sha, policy.signoffs.dir)) {
    const m = new RegExp(`^${policy.signoffs.dir}/([^/]+)/([^/]+)\\.md$`).exec(f);
    if (m) (byPiece.get(m[1]) || byPiece.set(m[1], []).get(m[1])).push([m[2], f]);
  }
  const done = [];
  for (const [piece, files] of byPiece) {
    let required = policy.signoffs.default_required;
    const signed = {};
    for (const [name, f] of files) {
      const { data } = parseFrontmatter(show(root, sha, f));
      if (!data) continue;
      if (name === '_required') { if (Array.isArray(data.roles)) required = data.roles; continue; }
      if (String(data.verdict || '').toUpperCase() === 'PASS' && data.sha) signed[data.role || name] = data.sha;
    }
    const shas = required.map((r) => signed[r]);
    if (shas.every(Boolean) && shas.every((s) => sameSha(s, shas[0]))) done.push({ piece, sha: shas[0] });
  }
  return done;
}

export function releaseRecordFor(root, treeSha, policy, wanted = treeSha) {
  for (const f of lsTree(root, treeSha, policy.releases.dir)) {
    if (!f.endsWith('.md')) continue;
    const { data, body } = parseFrontmatter(show(root, treeSha, f));
    if (!data) continue;
    const shas = Array.isArray(data.shas) ? data.shas : [];
    if (!shas.some((s) => sameSha(s, wanted))) continue;
    const problems = [];
    if (!data.owner_words) problems.push('owner_words');
    if (!data.question) problems.push('question');
    if (!data.said_at) problems.push('said_at');
    const check = /##\s*Pre-release check\s*\n([\s\S]*?)(\n##\s|$)/i.exec(body);
    if (!check || !check[1].trim()) problems.push('pasted "## Pre-release check" section');
    return { file: f, problems };
  }
  return null;
}

export function checkPush({ root, policy, role, localSha, remoteRef, remoteSha }) {
  const errors = [];
  const branch = remoteRef.replace(/^refs\/heads\//, '');
  const guarded = branch === policy.branches.live || branch === policy.branches.dev;

  if (ZERO.test(localSha)) {
    if (guarded) errors.push(`refusing to delete "${branch}"`);
    return errors;
  }

  let range;
  if (!ZERO.test(remoteSha) && git(['cat-file', '-e', remoteSha], root) !== null) range = [`${remoteSha}..${localSha}`];
  else range = [localSha, '--not', '--remotes'];
  const commits = (git(['rev-list', ...range], root) || '').split('\n').filter(Boolean);
  if (!commits.length) return errors;

  // O11: conflict markers in added lines.
  const base = ZERO.test(remoteSha) ? null : remoteSha;
  const diff = base ? git(['diff', `${base}..${localSha}`], root, { maxBuffer: 64 << 20 }) : null;
  if (diff && /^\+(<{7}|>{7})( |$)/m.test(diff)) errors.push('conflict markers in the pushed changes (O11)');

  if (!guarded) return errors;

  const codeCommits = commits.filter((c) => {
    const files = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--root', c], root) || '')
      .split('\n').filter(Boolean);
    return files.some((f) => !matchesAny(f, policy.docs_globs));
  });

  if (branch === policy.branches.live) {
    if (!policy.releases.live_pushers.includes(role)) errors.push(`role "${role}" may not push "${branch}"`);
    if (codeCommits.length) {
      // The record is committed after the code it releases, so it names the newest CODE commit;
      // docs-only commits on top of it (the record itself, logs) ride along.
      const newest = codeCommits[0];
      const rec = releaseRecordFor(root, localSha, policy, newest);
      if (!rec) errors.push(`no release record in ${policy.releases.dir}/ lists ${newest.slice(0, 12)}, the newest code commit (7E)`);
      else if (rec.problems.length) errors.push(`${rec.file} is missing: ${rec.problems.join(', ')}`);
    }
  }

  const exempt = branch === policy.branches.live && policy.releases.exempt_from_signoffs.includes(role);
  if (codeCommits.length && !exempt) {
    const signed = completeSignoffs(root, localSha, policy);
    const unsigned = codeCommits.filter((c) =>
      !signed.some((s) => git(['merge-base', '--is-ancestor', c, s.sha], root) !== null));
    if (unsigned.length) {
      errors.push(`${unsigned.length} code commit(s) have no complete sign-off: ${unsigned.map((c) => c.slice(0, 9)).join(', ')} ` +
        `(need PASS from ${policy.signoffs.default_required.join(', ')} or the piece's _required.md, all on one sha — O10, 7F)`);
    }
  }
  return errors;
}

function main() {
  const root = repoRoot(process.cwd());
  const policy = root && loadPolicy(root);
  if (!policy) process.exit(0);
  const role = currentRole(root);
  const lines = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  let failed = false;
  for (const line of lines) {
    const [, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    for (const e of checkPush({ root, policy, role, localSha, remoteRef, remoteSha })) {
      process.stderr.write(`pre-push: ${remoteRef}: ${e}\n`);
      failed = true;
    }
  }
  if (failed) process.stderr.write('pre-push: push refused. Fix the above; never bypass with --no-verify.\n');
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
