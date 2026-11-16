// "npm run dist" calls this twice: "clear" before the build (so a failed build leaves no old stamp) and with no argument after it.
// dist/build-sha.txt names the commit the installer was built from; scripts/release.mjs refuses unless that is the release target.
// A tree with uncommitted or untracked files is stamped "<sha>-dirty", which never matches.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'dist', 'build-sha.txt');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (process.argv[2] === 'clear') {
  rmSync(file, { force: true });
} else {
  const sha = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--untracked-files=all']) !== '';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${sha}${dirty ? '-dirty' : ''}\n`);
  console.log(`dist/build-sha.txt: ${sha}${dirty ? '-dirty' : ''}`);
}
