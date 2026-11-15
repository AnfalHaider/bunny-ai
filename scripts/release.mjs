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
import { fileURLToPath } from 'node:url';

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

const extra = process.argv.slice(2);
const notes = extra.includes('--notes-file') ? [] : ['--notes', `Bunny AI ${version}. Installed copies update to it automatically.`];
execFileSync('gh', ['release', 'create', tag, ...files, '--title', `Bunny AI ${version}`, '--latest', ...notes, ...extra], { cwd: root, stdio: 'inherit' });
console.log(`Published ${tag}. Installed copies will find it within a few hours, or at once from Settings, About, Check for updates.`);
