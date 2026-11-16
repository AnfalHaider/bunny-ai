// G1-2 / item 4: sign-off and release records are authenticated where git sees them, at commit and again at push.
//
// Without this, any role with docs/** could hand-write another role's sign-off or the list of required signers, and the
// pre-push check trusted file names. Used by precommit.mjs (the staged paths) and prepush.mjs (the pushed commits).
//
// A "change" is { status: 'A'|'M'|'D', path }; renames arrive as a delete plus an add (git --no-renames), so a rename
// of a sign-off is a delete and is refused like one.
import { parseFrontmatter } from './fm.mjs';
import { matchesAny } from './policy.mjs';

const SIGNOFF = /^docs\/signoffs\/([^/]+)\/([^/]+)\.md$/;
const CHIEF = 'chief-of-staff';
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function front(text) {
  try { return parseFrontmatter(String(text ?? '')).data; } catch { return null; }
}

const rolesOf = (data) => (Array.isArray(data?.roles) ? data.roles.map(String) : []);

/**
 * The reasons a role may not make these record changes, or [].
 *  changes   [{ status, path }] repo-relative
 *  readNew   (path) => text of the file after the change (or '')
 *  readOld   (path) => text before the change (or '')
 *  message   the commit message (push time), for the Chief of Staff's "removed-by" line; null at commit time
 */
export function recordChecks({ changes, role, policy, readNew, readOld, message = null }) {
  const out = [];
  const signDir = norm(policy.signoffs?.dir ?? 'docs/signoffs');
  const relDir = norm(policy.releases?.dir ?? 'docs/releases');
  const ownerPatterns = policy.records?.owner_patterns?.[role] ?? [];
  for (const ch of changes) {
    const path = norm(ch.path);
    if (!path.startsWith(`${signDir}/`) && !path.startsWith(`${relDir}/`)) continue;
    const refuse = (why) => out.push(`${path}: ${why}`);
    if (path.startsWith(`${relDir}/`)) {
      if (role !== CHIEF && !matchesAny(path, ownerPatterns, { ci: true })) refuse(`release records are the Chief of Staff's (role "${role}" may not ${ch.status === 'D' ? 'delete' : 'write'} them).`);
      continue;
    }
    const m = SIGNOFF.exec(path);
    if (!m) { if (role !== CHIEF) refuse('only the Chief of Staff writes other files in the sign-off folder.'); continue; }
    const [, , name] = m;
    if (ch.status === 'D') {
      if (role !== CHIEF) refuse('a sign-off (or its renamed copy) is never deleted or moved by anyone but the Chief of Staff.');
      else if (message !== null && !/^removed-by:\s*chief-of-staff,\s*reason:\s*\S/mi.test(message)) refuse('a deleted sign-off needs the line "removed-by: chief-of-staff, reason: ..." in the commit message.');
      continue;
    }
    const data = front(readNew(path));
    const old = ch.status === 'M' ? front(readOld(path)) : null;
    if (name === '_required' || name === '_piece') {
      if (role === CHIEF) continue;
      if (role === 'security' && name === '_required') {
        const before = new Set(rolesOf(old));
        const after = new Set(rolesOf(data));
        if (old && [...before].every((r) => after.has(r))) continue; // Security may add a required role, never remove one
      }
      refuse(role === 'security' ? 'Security may add a role to _required.md for a piece it names, never remove one, and does not write _piece.md.' : `only the Chief of Staff (or Security, to add a required role) writes ${name}.md.`);
      continue;
    }
    if (!data) { refuse('a sign-off must start with front matter (role, verdict, sha, date).'); continue; }
    if (role !== CHIEF && (name !== role || String(data.role ?? '') !== role)) {
      refuse(`a sign-off is written by its own role: you are "${role}", the file is "${name}" and says role "${data.role ?? ''}".`);
      continue;
    }
    if (role === CHIEF && String(data.role ?? name) !== name) { refuse(`front matter says role "${data.role}" but the file is "${name}": a forged or misnamed sign-off.`); continue; }
    for (const key of ['verdict', 'sha', 'date']) {
      if (!String(data[key] ?? '').trim()) { refuse(`a sign-off needs a "${key}" in its front matter.`); break; }
    }
    // the Chief of Staff records relayed sign-offs, but does not flip another role's verdict or sha after the fact
    if (role === CHIEF && name !== CHIEF && old && (String(old.verdict ?? '') !== String(data.verdict ?? '') || String(old.sha ?? '') !== String(data.sha ?? ''))) {
      refuse(`the Chief of Staff does not change ${name}'s verdict or sha: ask ${name} to sign again.`);
    }
  }
  return out;
}
