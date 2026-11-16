// W5-1b: what Tech Lead's review (W5-1b rows) and Security's follow-ups W5S-1 and W5S-2 added, for roles that may not push live.
// Used by lib/shellrules.mjs: tags and bare-URL pushes, remote URLs, moving the live branch label, and the gh allowlist.
import { execFileSync } from 'node:child_process';

/** A long option, or any unique prefix git accepts of it: isLong("--ta", "--tags") with a minimum length. */
export function isLong(arg, full, min = 4) {
  const name = String(arg).split('=')[0];
  return name.startsWith('--') && name.length >= min && full.startsWith(name);
}

const URLISH = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/|[^\s/@]+@[^\s/:]+:|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|~)/;
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

/** `git push` args as { remote, refspecs, repoGiven }: --repo (either form, or a unique prefix) replaces the remote word. */
export function pushShape(args) {
  const positional = [];
  let repo = null;
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === '--') { positional.push(...args.slice(k + 1)); break; }
    if (/^--rep(o)?=/.test(a)) { repo = a.slice(a.indexOf('=') + 1); continue; }
    if (isLong(a, '--repo', 5) && !a.includes('=')) { repo = args[k + 1] ?? ''; k += 1; continue; }
    if (PUSH_VALUE_OPTS.has(a)) { k += 1; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  return repo !== null ? { remote: repo, refspecs: positional, repoGiven: true, positional } : { remote: positional[0] ?? null, refspecs: positional.slice(1), repoGiven: false, positional };
}

const refExists = (ref, cwd) => {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: cwd ?? process.cwd(), timeout: 2000, stdio: 'ignore' }); return true; } catch { return false; }
};

/** Why this `git push` is refused (tags, a bare URL), or null. `cwd` is where git will run, to look short names up. */
export function refusePush(args, cwd = null) {
  const { remote, refspecs, repoGiven, positional } = pushShape(args);
  // git takes a remote word on the command line over --repo, so BOTH readings are judged: --repo's value and the first word
  const firstWord = positional[0] ?? null;
  if (args.some((a) => isLong(a, '--tags') || isLong(a, '--follow-tags', 4))) return 'pushing tags (--tags, --follow-tags) publishes releases and versions outside the live-branch rules; name a branch.';
  if (refspecs.includes('tag') || refspecs.some((r) => /(^|:|\+)refs\/tags\//.test(r))) return 'pushing a tag is refused for this role: a tag can mark a release.';
  // a short name that is a tag and not a branch (git push origin v1)
  for (const r of refspecs) {
    const src = r.replace(/^\+/, '').split(':')[0];
    if (/(^|[:+])(refs\/)?tags\//.test(r)) return `"${r}" names a tag; pushing a tag is refused for this role.`;
    if (src && src !== 'HEAD' && !src.includes('*') && refExists(`refs/tags/${src}`, cwd) && !refExists(`refs/heads/${src}`, cwd)) return `"${src}" is a tag here; pushing a tag is refused for this role.`;
  }
  if ((remote && URLISH.test(remote)) || (repoGiven && firstWord && URLISH.test(firstWord))) return 'pushing to a web address or a folder (not a named remote) skips the remote\'s rules; push to origin by name.';
  return null;
}

/** Why this `git remote ...` is refused (a remote's address added or changed), or null. */
export function refuseRemote(args) {
  const sub = args.find((a) => !a.startsWith('-'));
  if (sub === 'add' || sub === 'set-url') return `"git remote ${sub}" adds or changes where pushes go; the Chief of Staff sets remotes.`;
  return null;
}

/** Why this branch/checkout/switch call moves the live branch's label by force, or null. `live` is the policy's live branch name. */
export function refuseLabelMove(sub, args, live) {
  if (!live) return null;
  const names = args.filter((a) => !a.startsWith('-')).map((a) => a.replace(/^refs\/heads\//, ''));
  const touchesLive = names.includes(live);
  if (!touchesLive) return null;
  const flags = args.filter((a) => a.startsWith('-'));
  const short = (letters) => flags.some((f) => /^-[A-Za-z]+$/.test(f) && [...f.slice(1)].some((c) => letters.includes(c)));
  if (sub === 'branch' && (short('fMCmDd') || flags.some((f) => isLong(f, '--force', 4) || isLong(f, '--move', 4) || isLong(f, '--delete', 4)))) {
    return `moving, renaming or deleting the "${live}" branch label is not allowed for this role.`;
  }
  if ((sub === 'checkout' && short('B')) || (sub === 'switch' && (short('C') || flags.some((f) => isLong(f, '--force-create', 4))))) {
    return `resetting the "${live}" branch label with checkout -B or switch -C is not allowed for this role.`;
  }
  return null;
}

// ---- gh: an allowlist for roles that may not publish. Everything not listed is refused.
const GH_READ_SUBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'download']);
const GH_CLAUDE_BRANCH = /^claude\//;

function currentBranch(cwd) {
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cwd ?? process.cwd(), encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

/** Is this `gh pr create` for a claude/* branch (--head, else the current branch)? */
function prCreateOnClaudeBranch(words, cwd) {
  let head = null;
  for (let i = 1; i < words.length; i += 1) {
    const t = words[i].text;
    let w = null;
    if (t === '--head' || t === '-H') w = words[i + 1] ?? { text: '' };
    else if (t.startsWith('--head=')) w = { text: t.slice('--head='.length), dynamic: words[i].dynamic };
    else if (t.startsWith('-H') && t.length > 2) w = { text: t.slice(2).replace(/^=/, ''), dynamic: words[i].dynamic };
    if (w) head = w.dynamic ? '' : w.text; // a variable as the head cannot be read: refused
  }
  const branch = (head ?? currentBranch(cwd)).replace(/^[^:]*:/, '');
  return GH_CLAUDE_BRANCH.test(branch);
}

/** Why a non-live role may not run this gh command (not on the allowlist), or null. `group`/`sub` as shellrules' ghCall found them. */
export function ghNotAllowed(words, group, sub, ctx) {
  const offer = 'Ask release-ops (npm run release) or the Chief of Staff.';
  if (group === null || group === 'help' || group === 'version' || group === 'status' || group === 'search') return null;
  if (group === 'auth') return sub === 'status' ? null : `"gh auth ${sub ?? ''}" is not allowed (it can print or change a sign-in token).`;
  if (group === 'pr' && sub === 'comment') return null;
  if (group === 'pr' && sub === 'create') {
    return prCreateOnClaudeBranch(words, ctx.cwd) ? null : `"gh pr create" is allowed only for a claude/* branch (the head here is not one). ${offer}`;
  }
  if (sub !== null && GH_READ_SUBS.has(sub)) return null;
  return `"gh ${group}${sub ? ` ${sub}` : ''}" is not on the list of gh commands this role may run (reads: view, list, status, diff, checks; pr comment; pr create on a claude/* branch). It could publish files or change the repository. ${offer}`;
}
