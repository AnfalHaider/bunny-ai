import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

// W4-1d: a stand-in "Bunny server" starts a program, prints the program's pid, and is then killed hard.
// The program (and the shell that started it) must be gone afterwards.
test('a started program is gone after the server that started it is killed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-guard-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
  const server = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/proc-guard-server.mjs', import.meta.url)), dir], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { try { server.kill('SIGKILL'); } catch { /* gone */ } });
  let out = '';
  server.stdout.on('data', (c) => { out += c; });
  assert.ok(await wait(() => /CHILD \d+/.test(out), 20_000), 'the program started and printed its pid');
  const childPid = Number(/CHILD (\d+)/.exec(out)[1]);
  assert.ok(alive(childPid), 'the program is running while the server is');
  server.kill('SIGKILL'); // no graceful shutdown: nothing in the server runs after this
  assert.ok(await wait(() => !alive(childPid), 15_000), 'the program is gone after the server was killed');
});

// Security review of W4-1d: the program must not inherit Electron's internal variables.
test('a started program does not inherit ELECTRON_RUN_AS_NODE', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-guard-env-'));
  const { createProcessStore } = await import('../src/server/processes.js');
  const store = createProcessStore();
  // Stop the program first: it holds its folder, and removing the folder under it fails with EBUSY.
  t.after(async () => { await store.stopAll(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  process.env.ELECTRON_SOMETHING = 'leak';
  t.after(() => { delete process.env.ELECTRON_SOMETHING; });
  const p = store.start({ command: "node -e \"console.log('ERN=' + process.env.ELECTRON_RUN_AS_NODE + ' ES=' + process.env.ELECTRON_SOMETHING)\"", cwd: dir, owner: 'x' });
  assert.ok(await wait(() => /ERN=/.test(p.out), 20_000), 'the program printed');
  assert.match(p.out, /ERN=undefined ES=undefined/);
});
