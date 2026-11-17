// W6-7 (hints only, PowerShell always) and W6-8 (a server command goes to start_process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellHint, looksLikeServer } from '../src/server/shellFit.js';
import { createWorkspace } from '../src/server/workspace.js';

test('W6-7: a command written for a POSIX shell or cmd gets the PowerShell way to say it', () => {
  assert.match(shellHint('ls -la'), /ls -> dir/);
  assert.match(shellHint('cat notes.txt'), /cat -> type/);
  assert.match(shellHint('rm old.txt'), /rm -> del/);
  assert.match(shellHint('grep -n foo a.txt | head -5'), /grep -> findstr.*head -> Get-Content/);
  assert.match(shellHint('mkdir -p a/b'), /mkdir -p/);
  assert.match(shellHint('export X=1'), /export -> \$env:NAME/);
  assert.match(shellHint('set MY_VAR=1 && dir'), /set NAME=value -> \$env:NAME/);
});

test('W6-7: a PowerShell command, quoted text and plain mkdir get no hint', () => {
  for (const c of ['Get-ChildItem -Name', '$env:X = "1"; npm test', 'echo "ls dir"', 'echo one && echo two', 'npm test', 'mkdir out', 'set']) {
    assert.equal(shellHint(c), null, c);
  }
});

test('W6-7: run_command never changes shell; a failed POSIX command says so and how to write it', { skip: process.platform !== 'win32' && 'PowerShell only' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-shellfit-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const ws = createWorkspace(folder);
  const r = await ws.run('run_command', { command: 'export SHELLFIT_X=1' });
  assert.match(r, /\[hint: This runs in PowerShell\. export -> \$env:NAME/);
  const ok = await ws.run('run_command', { command: 'echo fine' });
  assert.doesNotMatch(ok, /hint/);
});

test('W6-8: a trailing & is a background job, so it is a server command', () => {
  assert.equal(looksLikeServer('npx serve -l 3001 &'), true);
  assert.equal(looksLikeServer('npx serve&'), true);
  assert.equal(looksLikeServer('echo "a &"'), false);
  assert.equal(looksLikeServer('a && b'), false);
});

test('W6-8: well-known long-running server commands are caught, one-shot commands are not', () => {
  for (const c of ['npm start', 'npm run dev', 'npm run serve', 'npx vite', 'npx serve', 'node server.js', 'python -m http.server 8000', 'flask run', 'uvicorn main:app --reload', 'next dev', 'nodemon app.js']) assert.equal(looksLikeServer(c), true, c);
  for (const c of ['npm test', 'npm install', 'npm run build', 'node scripts/build.js', 'npx tsc --noEmit', 'npm run lint']) assert.equal(looksLikeServer(c), false, c);
});

test('W6-8: run_command refuses a server command and names start_process with the command', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-server-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const ws = createWorkspace(folder);
  await assert.rejects(() => ws.run('run_command', { command: 'npm run dev' }), /start_process with command "npm run dev" instead/);
  await assert.rejects(() => ws.run('run_command', { command: 'npx serve -l 3001 &' }), /start_process with command "npx serve -l 3001" instead/);
});
