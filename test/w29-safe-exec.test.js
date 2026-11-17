import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { findOnPath, gitPath, powershellPath, safeEnv } from '../src/server/safeExec.js';
import { cloneCommand } from '../src/server/github.js';
import { createWorktrees } from '../src/server/worktrees.js';

// W29-1 / W29-2 (Security, W2-9 review): programs are found by absolute path, never from the project folder; a repository's own hooks and fsmonitor never run when Bunny asks git something;
// the GitHub token never sits on a command line.
const windows = process.platform === 'win32';
const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
const tmp = (name) => realpathSync(mkdtempSync(join(tmpdir(), `bunny-w29-${name}-`)));
const clean = (t, ...dirs) => t.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* gone */ } } });
const ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function repoWith(t) {
  const dir = tmp('repo');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  clean(t, dir);
  return dir;
}

test('W29-1: programs are absolute paths found in PATH folders only; the current folder and relative PATH entries are never searched', (t) => {
  assert.ok(isAbsolute(gitPath()), String(gitPath()));
  if (windows) assert.ok(isAbsolute(powershellPath()) && /System32/i.test(powershellPath()));
  const planted = tmp('planted');
  clean(t, planted);
  writeFileSync(join(planted, windows ? 'tool.exe' : 'tool'), 'x');
  assert.equal(findOnPath([windows ? 'tool.exe' : 'tool'], planted.length ? `.${windows ? ';' : ':'}relative${windows ? ';' : ':'}` : ''), null, 'relative and empty entries are skipped');
  assert.equal(findOnPath([windows ? 'tool.exe' : 'tool'], planted), join(planted, windows ? 'tool.exe' : 'tool'), 'an absolute PATH folder is searched');
  assert.equal(safeEnv({ A: '1' }).NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(safeEnv({}, { X: '1' }).X, '1');
});

test('W29-1: a git.exe planted in the project folder is not run, even when the child has no NoDefaultCurrentDirectoryInExePath at all', { skip: !windows }, (t) => {
  const repo = repoWith(t);
  const marker = join(repo, 'PLANTED-RAN.txt');
  // a program called git.exe in the project, with a script that would leave a marker if it were started with git's arguments
  copyFileSync(process.execPath, join(repo, 'git.exe'));
  writeFileSync(join(repo, 'rev-parse'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  writeFileSync(join(repo, '-c'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const scratch = tmp('child');
  clean(t, scratch);
  const script = join(scratch, 'ask.mjs');
  writeFileSync(script, `import { runGit } from ${JSON.stringify(pathToFileURL(join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'server', 'worktrees.js')).href)};\nconst out = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ${JSON.stringify(repo)} });\nconsole.log('BRANCH=' + out);\n`);
  const childEnv = { ...process.env };
  delete childEnv.NoDefaultCurrentDirectoryInExePath; // the variable is deleted: the fix must not depend on it being present in the parent
  const r = spawnSync(process.execPath, [script], { cwd: repo, env: childEnv, encoding: 'utf8' });
  assert.match(r.stdout, /BRANCH=main/, `${r.stdout}${r.stderr}`);
  assert.equal(existsSync(marker), false, 'the planted program did not run');
});

test('W29-2: a repository\'s own hooks and fsmonitor program never run when Bunny asks git something or makes a copy', async (t) => {
  const repo = repoWith(t);
  const data = tmp('data');
  const marks = tmp('marks');
  clean(t, data, marks);
  const hook = join(repo, '.git', 'hooks', 'post-checkout');
  const markHook = join(marks, 'hook-ran.txt');
  const markMon = join(marks, 'fsmonitor-ran.txt');
  writeFileSync(hook, `#!/bin/sh\necho ran > "${markHook.split('\\').join('/')}"\n`);
  try { execFileSync('chmod', ['+x', hook]); } catch { /* not on Windows */ }
  const monitor = join(marks, 'monitor.js');
  writeFileSync(monitor, `require('fs').writeFileSync(${JSON.stringify(markMon)}, 'ran'); process.stdout.write('\\0');\n`);
  git(repo, 'config', 'core.fsmonitor', `"${process.execPath.split('\\').join('/')}" "${monitor.split('\\').join('/')}"`);
  const wt = createWorktrees({ dataDir: data });
  const made = await wt.create({ sessionId: ID, folder: repo, prefix: 'bunny/', title: 'hooks' });
  writeFileSync(join(made.path, 'new.txt'), 'x\n');
  await wt.status(made);
  await wt.finish(made, { action: 'keep' });
  assert.equal(existsSync(markHook), false, 'the repository\'s post-checkout hook did not run');
  assert.equal(existsSync(markMon), false, 'the repository\'s fsmonitor program did not run');
  assert.ok(existsSync(join(data, 'empty-hooks')), 'git was given an empty hooks folder of Bunny\'s');
});

test('W29 (pre-existing MEDIUM): the GitHub token is passed to git in its environment, never in the arguments', () => {
  const token = 'ghp_TESTTOKEN0000000000000000000000000000';
  const run = cloneCommand({ token, full: 'octo/repo', target: join(tmpdir(), 'x'), program: '/usr/bin/git' });
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  assert.ok(!run.args.join(' ').includes(token) && !run.args.join(' ').includes(basic), 'not in the arguments');
  assert.ok(!run.args.some((a) => /extraheader|Authorization/i.test(a)), 'no header in the arguments');
  assert.equal(run.env.GIT_CONFIG_COUNT, '2');
  assert.equal(run.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.ok(run.env.GIT_CONFIG_VALUE_0.includes(basic), 'the header is in the environment');
  assert.equal(run.env.GIT_CONFIG_KEY_1, 'core.fsmonitor');
  assert.equal(run.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.deepEqual(run.args.slice(0, 3), ['clone', '--depth', '50']);
});
