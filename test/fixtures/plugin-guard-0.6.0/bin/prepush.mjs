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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { currentRole, git, loadPolicy, matchesAny, repoRoot } from './lib/policy.mjs';
import { laneOf, loadFlow, requiredFor, wordRecordProblems, wordsFor } from './lib/flow.mjs';
import { hasEvidence } from './lib/ops.mjs';

const ZERO = /^0+$/;

// Files that adopting the kit adds or changes. A push made of only these, onto a branch whose remote
// side has no .bootstrap/policy.json yet, is the adoption itself: the rules are judged from the
// remote side (as the flow is), and before adoption there are none to judge by. After it, changing
// any of these goes through the full flow like any other code.
const KIT_GLOBS = ['.bootstrap/**', '.githooks/**', '.claude/settings.json', '.gitignore', 'AGENTS.md', 'CLAUDE.md',
  'GEMINI.md', '.aider.conf.yml', '.cursor/**', '.codex/**', '.agents/**', '.kiro/**', '.clinerules/**',
  '.github/copilot-instructions.md', '.github/agents/**', 'chatgpt-export/**', 'scripts/bootstrap', 'scripts/bootstrap.*'];

// Flow changes: commits that change only the flow (plus docs) need the owner's recorded word, not a
// piece. The Chief of Staff writes it with `bootstrap flow apply`; it names the sha256 of the exact flow.json
// (and company.json, if any) the owner said yes to, so a later edit is not covered by an old yes.
export const FLOW_FILES = ['.bootstrap/flow.json', '.bootstrap/company.json'];
export const FLOW_CHANGES_DIR = 'docs/flow-changes';
export const hashText = (t) => createHash('sha256').update(String(t ?? '').replace(/\r\n/g, '\n').trimEnd()).digest('hex');
export function flowChangeRecord(root, sha) {
  const flowHash = hashText(show(root, sha, '.bootstrap/flow.json'));
  const comp = show(root, sha, '.bootstrap/company.json');
  for (const f of lsTree(root, sha, FLOW_CHANGES_DIR).filter((x) => x.endsWith('.md'))) {
    const { data } = parseFrontmatter(show(root, sha, f));
    if (!data || data.flow_sha256 !== flowHash) continue;
    if ((data.company_sha256 || '') !== (comp ? hashText(comp) : '')) continue;
    const missing = ['owner_words', 'question', 'said_at'].filter((k) => !data[k]);
    return { file: f, problems: missing };
  }
  return null;
}

// Kit upgrades: the kit's own files (scripts, built-in flow and rules, editor, role briefs, hook, settings)
// change when a newer kit is installed. Commits that change only these (plus docs and the flow) are covered
// by the owner's recorded yes to the upgrade: `bootstrap kit apply` lists every kit file with its sha256,
// and each changed file must match the record at the pushed commit. A later edit needs a new yes.
export const KIT_UPGRADE_GLOBS = ['.bootstrap/bin/**', '.bootstrap/flow/**', '.bootstrap/ui/**', '.bootstrap/roles/**',
  '.bootstrap/kit.json', '.githooks/**', '.claude/settings.json', '.gitignore'];
export const KIT_CHANGES_DIR = 'docs/kit-changes';
export function kitRecordFiles(root, sha) {
  const ok = new Map(); const bad = [];
  for (const f of lsTree(root, sha, KIT_CHANGES_DIR).filter((x) => x.endsWith('.md'))) {
    const { data } = parseFrontmatter(show(root, sha, f));
    if (!data) continue;
    const missing = ['owner_words', 'question', 'said_at'].filter((k) => !data[k]);
    if (missing.length) { bad.push(`${f} is missing: ${missing.join(', ')}`); continue; }
    for (const item of Array.isArray(data.files) ? data.files : []) {
      const i = String(item).lastIndexOf('@');
      if (i > 0) (ok.get(item.slice(0, i)) || ok.set(item.slice(0, i), new Set()).get(item.slice(0, i))).add(item.slice(i + 1));
    }
  }
  return { ok, bad };
}

function adoptedAt(root, remoteSha) {
  const has = (sha) => git(['cat-file', '-e', `${sha}:.bootstrap/policy.json`], root) !== null;
  // An unknown remote tip (not fetched) is treated as adopted: never relax on what we cannot see.
  if (!ZERO.test(remoteSha)) return git(['cat-file', '-e', remoteSha], root) === null || has(remoteSha);
  // A new branch: adopted if any branch the remote already has carries the kit.
  const refs = (git(['for-each-ref', '--format=%(objectname)', 'refs/remotes'], root) || '').split('\n').filter(Boolean);
  return refs.some(has);
}

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

export function piecesAt(root, sha, policy) {
  // [{piece, lane, extra, required (legacy _required roles or null), signed: {role: sha}}]
  const byPiece = new Map();
  for (const f of lsTree(root, sha, policy.signoffs.dir)) {
    const m = new RegExp(`^${policy.signoffs.dir}/([^/]+)/([^/]+)\\.md$`).exec(f);
    if (m) (byPiece.get(m[1]) || byPiece.set(m[1], []).get(m[1])).push([m[2], f]);
  }
  const out = [];
  for (const [piece, files] of byPiece) {
    const p = { piece, lane: null, extra: [], required: null, signed: {}, words: {} };
    for (const [name, f] of files) {
      const { data, body } = parseFrontmatter(show(root, sha, f));
      if (!data) continue;
      if (name === '_required') { if (Array.isArray(data.roles)) { p.required = data.roles; p.extra = data.roles; } continue; }
      if (name === '_piece') { p.lane = data.lane || null; continue; }
      if (name === '_approve' || name === '_go') { p.words[name.slice(1)] = data; continue; }
      if (name.startsWith('_')) continue;
      // A PASS counts only with evidence in the body (a command and its output, or file:line).
      if (String(data.verdict || '').toUpperCase() === 'PASS' && data.sha) {
        if (hasEvidence(body, policy)) p.signed[data.role || name] = data.sha; else (p.weak ||= []).push(data.role || name);
      }
    }
    out.push(p);
  }
  return out;
}

export function completeSignoffs(root, sha, policy, { flow = null, codeCommits = [], role = '', notes = [] } = {}) {
  // Returns [{piece, sha}] for every piece whose required roles all signed PASS on one sha.
  // Without a flow: the required roles are _required.md or the policy default (legacy).
  // With a flow: the piece must have a lane set by the Chief of Staff (_piece.md); then lane gate +
  //   conditions matched by the files the piece changed + _required.md (add-only) + company floor, and
  //   the owner's words the lane/conditions need (_approve.md, _go.md). Only Hotfix may use an exempt lane.
  //   `notes` collects why each piece did not count, for the error message.
  const done = [];
  for (const p of piecesAt(root, sha, policy)) {
    if (!flow) {
      const required = p.required || policy.signoffs.default_required;
      const shas = required.map((r) => p.signed[r]);
      if (shas.every(Boolean) && shas.every((s) => sameSha(s, shas[0]))) done.push({ piece: p.piece, sha: shas[0] });
      continue;
    }
    if (!p.lane) { notes.push(`${p.piece}: no lane set (the Chief of Staff runs \`bootstrap piece ${p.piece} --lane <lane>\`)`); continue; }
    let lane = flow.lanes.find((l) => l.id === p.lane);
    if (!lane) { notes.push(`${p.piece}: lane "${p.lane}" is not in the flow`); continue; }
    if (lane.live_exempt_signoffs && role !== 'hotfix') lane = laneOf(flow, 'normal');
    let why = '';
    if (!Object.keys(p.signed).length) {
      const files = codeCommits.flatMap((c) => (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--root', c], root) || '').split('\n').filter(Boolean));
      const weak = (p.weak || []).length ? ` (PASS without evidence from ${p.weak.join(', ')})` : '';
      notes.push(`${p.piece} (lane ${lane.id}): no sign-offs yet${weak}; needs ${requiredFor(flow, lane.id, files, p.extra).join(', ')}`);
      continue;
    }
    for (const S of [...new Set(Object.values(p.signed))]) {
      const covered = codeCommits.filter((c) => git(['merge-base', '--is-ancestor', c, S], root) !== null);
      const files = covered.flatMap((c) => (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--root', c], root) || '').split('\n').filter(Boolean));
      const required = requiredFor(flow, lane.id, files, p.extra);
      const missing = required.filter((r) => !sameSha(p.signed[r], S)).map((r) => ((p.weak || []).includes(r) ? `${r} (PASS without evidence)` : r));
      const wordIssues = wordsFor(flow, lane.id, files).flatMap((w) => wordRecordProblems(p.words[w], w, flow).map((x) => `${w}: ${x}`));
      if (!missing.length && !wordIssues.length) { done.push({ piece: p.piece, sha: S, required }); why = ''; break; }
      why = `${p.piece} @ ${S.slice(0, 9)}: ${[missing.length ? `missing sign-off from ${missing.join(', ')}` : '', wordIssues.length ? `owner's word ${wordIssues.join('; ')}` : ''].filter(Boolean).join('; ')}`;
    }
    if (why) notes.push(why);
  }
  return done;
}

export function flowFor(root, baseSha, localSha) {
  // The flow that judges a push is the one ALREADY accepted (the remote side), so a commit that
  // loosens the flow cannot use its own looser flow to get through. New branch: the pushed tree.
  const ref = baseSha && git(['cat-file', '-e', `${baseSha}:.bootstrap/flow.json`], root) !== null ? baseSha
    : git(['cat-file', '-e', `${localSha}:.bootstrap/flow.json`], root) !== null ? localSha : null;
  return ref ? loadFlow(root, { ref }).flow : null;
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
  const guarded = branch === policy.branches.live || (!!policy.branches.dev && branch === policy.branches.dev);

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

  const filesOf = (c) => (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--root', c], root) || '')
    .split('\n').filter(Boolean);
  let codeCommits = commits.filter((c) => filesOf(c).some((f) => !matchesAny(f, policy.docs_globs)));

  // Adoption: the first push of the kit itself, before the remote side has any rules.
  if (codeCommits.length && !adoptedAt(root, remoteSha)) {
    const outside = [...new Set(codeCommits.flatMap(filesOf)
      .filter((f) => !matchesAny(f, policy.docs_globs) && !matchesAny(f, KIT_GLOBS)))];
    if (!outside.length) return errors;
    errors.push(`the kit is not on "${branch}" yet, so this push adopts it: push the kit on its own first, then the rest goes through the flow. ` +
      `Outside the kit: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ` and ${outside.length - 5} more` : ''}`);
    return errors;
  }

  // Commits that change only the flow and/or the kit are covered by the owner's recorded yes instead of a piece.
  const isFlow = (f) => FLOW_FILES.includes(f), isKit = (f) => matchesAny(f, KIT_UPGRADE_GLOBS);
  const configOnly = codeCommits.filter((c) => filesOf(c).every((f) => matchesAny(f, policy.docs_globs) || isFlow(f) || isKit(f)));
  if (configOnly.length) {
    const changed = [...new Set(configOnly.flatMap(filesOf))];
    const short = configOnly.map((c) => c.slice(0, 9)).join(', ');
    if (changed.some(isFlow)) {
      const rec = flowChangeRecord(root, localSha);
      if (!rec) errors.push(`${configOnly.length} commit(s) change the flow (${short}) with no record of the owner's yes for this exact flow in ${FLOW_CHANGES_DIR}/. The Chief of Staff reads the change back to the owner and runs \`bootstrap flow apply\``);
      else if (rec.problems.length) errors.push(`${rec.file} is missing: ${rec.problems.join(', ')}`);
      else {
        const { findings } = loadFlow(root, { ref: localSha });
        const bad = findings.filter((f) => f.level === 'error');
        if (bad.length) errors.push(`the new flow has errors: ${bad.map((f) => f.msg).join(' | ')}`);
      }
    }
    const kitFiles = changed.filter((f) => isKit(f) && !matchesAny(f, policy.docs_globs));
    if (kitFiles.length) {
      const { ok, bad } = kitRecordFiles(root, localSha);
      errors.push(...bad);
      const exists = (f) => git(['cat-file', '-e', `${localSha}:${f}`], root) !== null;
      const uncovered = kitFiles.filter((f) => !(ok.get(f) || new Set()).has(exists(f) ? hashText(show(root, localSha, f)) : 'deleted'));
      if (uncovered.length) errors.push(`${uncovered.length} kit file(s) changed (${short}) with no record of the owner's yes for these exact files in ${KIT_CHANGES_DIR}/: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ` and ${uncovered.length - 5} more` : ''}. The Chief of Staff tells the owner what the upgrade changes and runs \`bootstrap kit apply\``);
    }
    codeCommits = codeCommits.filter((c) => !configOnly.includes(c));
    if (errors.length) return errors;
  }

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
    const flow = flowFor(root, ZERO.test(remoteSha) ? null : remoteSha, localSha);
    const notes = [];
    const signed = completeSignoffs(root, localSha, policy, { flow, codeCommits, role, notes });
    const unsigned = codeCommits.filter((c) =>
      !signed.some((s) => git(['merge-base', '--is-ancestor', c, s.sha], root) !== null));
    if (unsigned.length) {
      const need = flow ? "a piece with a lane set by the Chief of Staff, its lane's sign-offs plus any its files' conditions add, and any owner's word they need"
        : `${policy.signoffs.default_required.join(', ')} or the piece's _required.md`;
      errors.push(`${unsigned.length} code commit(s) have no complete sign-off: ${unsigned.map((c) => c.slice(0, 9)).join(', ')} ` +
        `(need ${need}, all on one sha — O10, 7F)${notes.length ? `. Pieces: ${notes.join(' | ')}` : '. No piece covers them yet'}`);
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
