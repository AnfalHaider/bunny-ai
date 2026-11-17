// W2-9 probe (Security): does worktrees.js's runGit (execFile('git', args, { cwd })) start a git.exe that sits in the project folder?
// The "git.exe" planted here is a copy of Windows' whoami.exe, so if it runs, the output is this PC's user name instead of git's answer.
// Usage: node docs/security/w2-9-probe/planted-git.mjs <path to worktrees.js of the commit under review>
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { runGit } = await import(pathToFileURL(process.argv[2]).href);
const project = mkdtempSync(join(tmpdir(), 'sec-w29-project-'));
try {
  copyFileSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'whoami.exe'), join(project, process.argv[3] ?? 'git.exe'));
  let out;
  try { out = await runGit([], { cwd: project }); } catch (err) { out = `git refused: ${err.message.slice(0, 120)}`; }
  console.log(`runGit in a folder holding git.exe (really whoami) answered: ${JSON.stringify(out)}`);
  // whoami prints DOMAIN\user and succeeds; git with no command fails with its usage (the error names the git program it started)
  console.log(/git/i.test(out) ? 'the real git ran' : 'PLANTED program RAN  <-- finding');
} finally { rmSync(project, { recursive: true, force: true }); }
