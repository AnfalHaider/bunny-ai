// Publishes the installer built by `npm run dist` as a GitHub release, so installed
// copies of Bunny AI find it and update themselves.
//
//   1. Raise "version" in package.json (installed apps only update to a higher number).
//   2. npm run dist
//   3. npm run release            (or: npm run release -- --notes-file notes.md)
//
// Needs the GitHub CLI (gh), signed in with permission to the repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const short = (s) => String(s || '').slice(0, 7);

// W5-8: a release is only ever the commit that is exactly origin/main, built from a clean tree.
// Pure check so tests need no git. target / originMain are shas (full or abbreviated, at least 7 chars).
export function checkTarget({ target, originMain, head, dirty = false, fetchError = null } = {}) {
  if (fetchError) return { ok: false, reason: `Refusing to release: could not fetch origin/main (${fetchError}). Check the network and run "git fetch origin main" first.` };
  if (!target || !/^[0-9a-f]{7,40}$/i.test(target)) return { ok: false, reason: `Refusing to release: the target "${target || ''}" is not a commit. Pass --target <sha|HEAD>.` };
  if (!originMain || !/^[0-9a-f]{7,40}$/i.test(originMain)) return { ok: false, reason: 'Refusing to release: origin/main does not exist here. Run "git fetch origin main", then release only what is on main.' };
  const a = target.toLowerCase(); const b = originMain.toLowerCase();
  if (!(a.startsWith(b) || b.startsWith(a))) return { ok: false, reason: `Refusing to release ${short(target)}: it is not origin/main (${short(originMain)}). Release only what is on main.` };
  // Security W5-8 (1): the installer was built from the checked-out files, so HEAD must be the target, not only the target origin/main
  if (!head || !/^[0-9a-f]{7,40}$/i.test(head)) return { ok: false, reason: 'Refusing to release: could not read the checked-out commit (HEAD).' };
  const h = head.toLowerCase();
  if (!(h.startsWith(a) || a.startsWith(h))) return { ok: false, reason: `Refusing to release ${short(target)}: this folder has ${short(head)} checked out, and dist/ was built from that. Check out the target, rebuild with "npm run dist", then release.` };
  // (2) untracked files count: an untracked file under src/ would ship in the installer
  if (dirty) return { ok: false, reason: 'Refusing to release: the working tree has uncommitted or untracked files. Commit, move or discard them so the release can be rebuilt from the sha.' };
  return { ok: true, reason: '' };
}

// (3) "npm run dist" writes dist/build-sha.txt (scripts/write-build-sha.mjs); an installer from another commit, or none, is refused.
export function checkBuild({ target, builtSha } = {}) {
  const built = String(builtSha ?? '').trim();
  if (!built) return { ok: false, reason: 'Refusing to release: dist/build-sha.txt is missing. Run "npm run dist" on the commit you are releasing.' };
  if (!/^[0-9a-f]{7,40}$/i.test(built)) return { ok: false, reason: `Refusing to release: dist/ was built from a tree with changes (${built.slice(0, 20)}). Run "npm run dist" again on a clean checkout.` };
  const a = String(target ?? '').toLowerCase(); const b = built.toLowerCase();
  if (!a || !(a.startsWith(b) || b.startsWith(a))) return { ok: false, reason: `Refusing to release ${short(target)}: dist/ was built from ${short(built)}. Run "npm run dist" again on the target.` };
  return { ok: true, reason: '' };
}

// (4) only a notes file goes on to gh: no other repository, draft, pre-release or "not latest" can ride along
export function checkGhArgs(extra = []) {
  const out = [];
  for (let i = 0; i < extra.length; i += 1) {
    const a = extra[i];
    if (a === '--notes-file') {
      const v = extra[i + 1];
      if (!v || v.startsWith('-')) return { ok: false, reason: 'Refusing to release: --notes-file needs a file name.' };
      out.push(a, v); i += 1;
    } else if (/^--notes-file=./.test(a)) out.push(a);
    else return { ok: false, reason: `Refusing to release: "${String(a).slice(0, 40)}" is not allowed. Only --notes-file is passed on to gh (no --repo, --draft, --prerelease or --latest=false).` };
  }
  return { ok: true, reason: '', args: out };
}

// Pulls --target / --dry-run out of the arguments; everything else is passed on to gh.
export function parseArgs(argv) {
  const rest = []; let target = 'HEAD'; let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') target = argv[++i] || '';
    else if (argv[i].startsWith('--target=')) target = argv[i].slice(9);
    else if (argv[i] === '--dry-run') dryRun = true;
    else rest.push(argv[i]);
  }
  return { target, dryRun, rest };
}

// git is injectable (fake in tests). Returns what checkTarget needs plus the resolved full sha.
export function gatherGitState({ git, target }) {
  let fetchError = null;
  try { git(['fetch', 'origin', 'main']); } catch (e) { fetchError = String(e.message || e).split(/\r?\n/)[0]; }
  let resolved = ''; let originMain = ''; let head = ''; let dirty = false;
  try { resolved = git(['rev-parse', '--verify', `${target}^{commit}`]).trim(); } catch { resolved = ''; }
  try { originMain = git(['rev-parse', '--verify', 'origin/main^{commit}']).trim(); } catch { originMain = ''; }
  try { head = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim(); } catch { head = ''; }
  try { dirty = git(['status', '--porcelain', '--untracked-files=all']).trim() !== ''; } catch { dirty = true; }
  return { target: resolved, originMain, head, dirty, fetchError };
}

// Every failing check, git ones first (they need nothing built), then the installer, the role and the record. A dry run lists them all.
export function releaseProblems({ gitChecks = [], later = [] } = {}) {
  return [...gitChecks, ...later].filter((c) => c && c.ok === false).map((c) => c.reason);
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tag = `v${version}`;
  const files = [`Bunny-AI-Setup-${version}.exe`, `Bunny-AI-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join(root, 'dist', f));
  const { target: targetArg, dryRun, rest: extra } = parseArgs(process.argv.slice(2));

  // 1. git and build checks first: anyone can run them, and a dry run reports them all at once
  const ghArgs = checkGhArgs(extra);
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = gatherGitState({ git, target: targetArg });
  let builtSha = '';
  try { builtSha = readFileSync(join(root, 'dist', 'build-sha.txt'), 'utf8'); } catch { builtSha = ''; }
  const gitChecks = [checkTarget(state), checkBuild({ target: state.target, builtSha }), ghArgs];

  // 2. the installer, the role and the written record
  const later = [];
  for (const f of files) if (!existsSync(f)) later.push({ ok: false, reason: `Missing ${f}. Run "npm run dist" first (the version in package.json is ${version}).` });
  if (!later.length && !readFileSync(files[2], 'utf8').includes(`version: ${version}`)) later.push({ ok: false, reason: 'dist/latest.yml is for another version. Run "npm run dist" again.' });
  // One key to live (AGENTS.md O4, 7E): a release reaches every installed copy, so only Release Ops
  // or Hotfix publish one, and only with a written release record that names this version.
  const role = process.env.BOOTSTRAP_ROLE || (() => {
    try { return JSON.parse(readFileSync(join(root, '.bootstrap', 'session.json'), 'utf8')).role; } catch { return 'unassigned'; }
  })();
  const roleCheck = ['release-ops', 'hotfix'].includes(role) ? { ok: true } : { ok: false, reason: `Only Release Ops or Hotfix publish a release (this session is "${role}"). The owner types "release <scope>" in Release Ops' chat.` };
  const records = existsSync(join(root, 'docs', 'releases')) ? readdirSync(join(root, 'docs', 'releases')) : [];
  const record = records.find((f) => f.endsWith('.md') && readFileSync(join(root, 'docs', 'releases', f), 'utf8').includes(`scope: ${tag}`));
  if (!record) later.push({ ok: false, reason: `No release record for ${tag} in docs/releases. Write it first: node .bootstrap/bin/bootstrap.mjs release ${tag} --shas ... --words "..." --question "..." --said-at "..." --check <gate output file>` });
  // a dry run publishes nothing, so the role is only a note there
  if (dryRun) { if (!roleCheck.ok) console.log(`Note: ${roleCheck.reason} (not needed for a dry run)`); } else later.push(roleCheck);

  const problems = releaseProblems({ gitChecks, later });
  if (problems.length) {
    for (const reason of problems) console.error(reason);
    process.exit(1);
  }
  console.log(`Release target: ${state.target} (origin/main ${state.originMain}), tag ${tag}, record ${record}`);
  if (dryRun) {
    console.log(`Dry run: would publish ${tag} from ${state.target} with ${files.length} files. Nothing was published.`);
    return;
  }

  const notes = ghArgs.args.length ? [] : ['--notes', `Bunny AI ${version}. Installed copies update to it automatically.`];
  execFileSync('gh', ['release', 'create', tag, ...files, '--title', `Bunny AI ${version}`, '--latest', ...notes, '--target', state.target, ...ghArgs.args], { cwd: root, stdio: 'inherit' });
  console.log(`Published ${tag}. Installed copies will find it within a few hours, or at once from Settings, About, Check for updates.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
