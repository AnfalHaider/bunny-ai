import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitShell, findGitBash, looksLikeServer } from '../src/server/shellFit.js';
import { createWorkspace } from '../src/server/workspace.js';

const windows = process.platform === 'win32';

test('W6-7: run_command runs a cmd line in cmd and a missing POSIX command gets its hint', { skip: !windows && 'Windows only' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-shellfit-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await writeFile(join(folder, 'notes.txt'), 'hello from cmd\n');
  const ws = createWorkspace(folder);
  const typed = await ws.run('run_command', { command: 'type notes.txt' });
  assert.match(typed, /hello from cmd/);
  const cmdSet = await ws.run('run_command', { command: 'set SHELLFIT_TEST=ok && set SHELLFIT_TEST' });
  assert.match(cmdSet, /SHELLFIT_TEST=ok/);
  const posix = await ws.run('run_command', { command: 'grep -n nothing-here-zz notes.txt' });
  // With Git for Windows installed grep really runs, so the hint only shows when it cannot.
  if (!findGitBash()) {
    assert.match(posix, /\[exit code [1-9]/);
    assert.match(posix, /\[hint: .*grep -> findstr/);
  }
});

const win = { platform: 'win32', hasGitBash: false };
const gitBash = { platform: 'win32', hasGitBash: true };

test('W6-7: cmd-written commands run through cmd', () => {
  assert.equal(fitShell('dir', win).shell, 'cmd');
  assert.equal(fitShell('dir /b', win).shell, 'cmd');
  assert.equal(fitShell('type notes.txt', win).shell, 'cmd');
  assert.equal(fitShell('copy a.txt b.txt', win).shell, 'cmd');
  assert.equal(fitShell('set MY_VAR=1', win).shell, 'cmd');
  assert.equal(fitShell('set MY_VAR=1 && dir', win).shell, 'cmd');
});

test('W6-7: the cmd line is passed through unchanged (no PowerShell rewrite)', () => {
  assert.deepEqual(fitShell('  dir /b && type a.txt  ', win), { shell: 'cmd', command: 'dir /b && type a.txt', hint: null });
});

test('W6-7: POSIX-style commands run through Git Bash when it is installed', () => {
  assert.deepEqual(fitShell('ls -la', gitBash), { shell: 'bash', command: 'ls -la', hint: null });
  assert.equal(fitShell('cat package.json', gitBash).shell, 'bash');
  assert.equal(fitShell('export NODE_ENV=test && npm test', gitBash).shell, 'bash');
  assert.equal(fitShell('mkdir -p out/deep', gitBash).shell, 'bash');
  assert.equal(fitShell('grep -r TODO src | head -5', gitBash).shell, 'bash');
});

test('W6-7: without Git Bash a POSIX command stays in PowerShell and gets a translation hint', () => {
  const ls = fitShell('ls', win);
  assert.equal(ls.shell, 'powershell');
  assert.match(ls.hint, /ls -> dir/);
  assert.match(fitShell('cat notes.txt', win).hint, /cat -> type/);
  assert.match(fitShell('rm old.txt', win).hint, /rm -> del/);
  assert.match(fitShell('grep -n foo a.txt', win).hint, /grep -> findstr/);
  assert.match(fitShell('touch new.txt', win).hint, /touch/);
  assert.match(fitShell('mkdir -p a/b', win).hint, /mkdir -p/);
  assert.match(fitShell('export X=1', win).hint, /export/);
});

test('W6-7: a PowerShell command and quoted text do not change the shell', () => {
  assert.equal(fitShell('Get-ChildItem -Name', win).shell, 'powershell');
  assert.equal(fitShell('$env:X = "1"; npm test', win).shell, 'powershell');
  assert.equal(fitShell('echo "ls dir"', win).shell, 'powershell');
  assert.equal(fitShell('echo one && echo two', win).shell, 'powershell');
  assert.equal(fitShell('npm test', win).hint, null);
});

test('W6-7: outside Windows the line stays in PowerShell, as before', () => {
  assert.deepEqual(fitShell('ls -la', { platform: 'linux', hasGitBash: true }), { shell: 'powershell', command: 'ls -la', hint: null });
  assert.deepEqual(fitShell('dir', { platform: 'darwin' }), { shell: 'powershell', command: 'dir', hint: null });
});

test('W6-8: a trailing & is a background job, so it is a server command', () => {
  assert.equal(looksLikeServer('npx serve -l 3001 &'), true);
  assert.equal(looksLikeServer('npx serve&'), true);
  assert.equal(looksLikeServer('echo "a &"'), false);
  assert.equal(looksLikeServer('a && b'), false);
});

test('W6-8: well-known long-running server commands are caught', () => {
  for (const c of [
    'npm start', 'npm run dev', 'npm run serve', 'npx vite', 'npx serve', 'node server.js',
    'python -m http.server 8000', 'flask run', 'uvicorn main:app --reload', 'next dev', 'nodemon app.js',
  ]) assert.equal(looksLikeServer(c), true, c);
});

test('W6-8: run_command refuses a server command and names start_process with the command', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-server-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const ws = createWorkspace(folder);
  await assert.rejects(() => ws.run('run_command', { command: 'npm run dev' }), /start_process with command "npm run dev" instead/);
  await assert.rejects(() => ws.run('run_command', { command: 'npx serve -l 3001 &' }), /start_process with command "npx serve -l 3001" instead/);
});

test('W6-8: one-shot commands are not servers', () => {
  for (const c of ['npm test', 'npm install', 'npm run build', 'node scripts/build.js', 'npx tsc --noEmit', 'npm run lint']) {
    assert.equal(looksLikeServer(c), false, c);
  }
});
