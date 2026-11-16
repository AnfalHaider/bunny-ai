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
export function checkTarget({ target, originMain, dirty = false, fetchError = null } = {}) {
  if (fetchError) return { ok: false, reason: `Refusing to release: could not fetch origin/main (${fetchError}). Check the network and run "git fetch origin main" first.` };
  if (!target || !/^[0-9a-f]{7,40}$/i.test(target)) return { ok: false, reason: `Refusing to release: the target "${target || ''}" is not a commit. Pass --target <sha|HEAD>.` };
  if (!originMain || !/^[0-9a-f]{7,40}$/i.test(originMain)) return { ok: false, reason: 'Refusing to release: origin/main does not exist here. Run "git fetch origin main", then release only what is on main.' };
  const a = target.toLowerCase(); const b = originMain.toLowerCase();
  if (!(a.startsWith(b) || b.startsWith(a))) return { ok: false, reason: `Refusing to release ${short(target)}: it is not origin/main (${short(originMain)}). Release only what is on main.` };
  if (dirty) return { ok: false, reason: 'Refusing to release: the working tree has uncommitted changes to tracked files. Commit or discard them so the release can be rebuilt from the sha.' };
  return { ok: true, reason: '' };
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
  let resolved = ''; let originMain = ''; let dirty = false;
  try { resolved = git(['rev-parse', '--verify', `${target}^{commit}`]).trim(); } catch { resolved = ''; }
  try { originMain = git(['rev-parse', '--verify', 'origin/main^{commit}']).trim(); } catch { originMain = ''; }
  try { dirty = git(['status', '--porcelain', '--untracked-files=no']).trim() !== ''; } catch { dirty = true; }
  return { target: resolved, originMain, dirty, fetchError };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const tag = `v${version}`;
  const files = [`Bunny-AI-Setup-${version}.exe`, `Bunny-AI-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join(root, 'dist', f));

  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`Missing ${f}. Run "npm run dist" first (the version in package.json is ${version}).`);
      process.exit(1);
    }
  }
  const yml = readFileSync(files[2], 'utf8');
  if (!yml.includes(`version: ${version}`)) {
    console.error(`dist/latest.yml is for another version. Run "npm run dist" again.`);
    process.exit(1);
  }

  // One key to live (AGENTS.md O4, 7E): a release reaches every installed copy, so only Release Ops
  // or Hotfix publish one, and only with a written release record that names this version.
  const role = process.env.BOOTSTRAP_ROLE || (() => {
    try { return JSON.parse(readFileSync(join(root, '.bootstrap', 'session.json'), 'utf8')).role; } catch { return 'unassigned'; }
  })();
  if (!['release-ops', 'hotfix'].includes(role)) {
    console.error(`Only Release Ops or Hotfix publish a release (this session is "${role}"). The owner types "release <scope>" in Release Ops' chat.`);
    process.exit(1);
  }
  const records = existsSync(join(root, 'docs', 'releases')) ? readdirSync(join(root, 'docs', 'releases')) : [];
  const record = records.find((f) => f.endsWith('.md') && readFileSync(join(root, 'docs', 'releases', f), 'utf8').includes(`scope: ${tag}`));
  if (!record) {
    console.error(`No release record for ${tag} in docs/releases. Write it first: node .bootstrap/bin/bootstrap.mjs release ${tag} --shas ... --words "..." --question "..." --said-at "..." --check <gate output file>`);
    process.exit(1);
  }

  const { target: targetArg, dryRun, rest: extra } = parseArgs(process.argv.slice(2));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = gatherGitState({ git, target: targetArg });
  const verdict = checkTarget(state);
  if (!verdict.ok) {
    console.error(verdict.reason);
    process.exit(1);
  }
  console.log(`Release target: ${state.target} (origin/main ${state.originMain}), tag ${tag}, record ${record}`);
  if (dryRun) {
    console.log(`Dry run: would publish ${tag} from ${state.target} with ${files.length} files. Nothing was published.`);
    return;
  }

  const notes = extra.includes('--notes-file') ? [] : ['--notes', `Bunny AI ${version}. Installed copies update to it automatically.`];
  execFileSync('gh', ['release', 'create', tag, ...files, '--title', `Bunny AI ${version}`, '--latest', ...notes, '--target', state.target, ...extra], { cwd: root, stdio: 'inherit' });
  console.log(`Published ${tag}. Installed copies will find it within a few hours, or at once from Settings, About, Check for updates.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
