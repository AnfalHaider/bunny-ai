// Setup that runs the same way locally, in every session worktree and in the cloud start hook.
// Lockfile-exact installs only (never updates), real dependency folders (never a link to
// another checkout), then the browsers the end-to-end tests drive.
//
//   node scripts/bootstrap.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')} (exit ${r.status})`); process.exit(r.status || 1); }
};

// The runtime first: the code uses node:test, node:sqlite-era APIs and ESM throughout.
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) { console.error(`Node ${process.versions.node} is too old: install Node 22 or newer (user-level).`); process.exit(1); }

// Two sessions once linked node_modules to another checkout and tested the wrong code.
const nm = join(root, 'node_modules');
if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) { console.error('node_modules is a link to another checkout: delete the link and run this again.'); process.exit(1); }

if (!existsSync(join(root, 'package-lock.json'))) { console.error('package-lock.json is missing: refusing to install unpinned.'); process.exit(1); }
run(win ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund']);
run(win ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium']);
run(process.execPath, ['scripts/build-css.mjs']);

// Git hooks live in the repository so every tool and every human runs them.
const hooks = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (hooks !== '.githooks') console.log('note: core.hooksPath is not .githooks; the owner sets it once with: git config core.hooksPath .githooks');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
console.log(`\nBunny AI ${version} is set up. Prove it with: node scripts/gate.mjs`);
