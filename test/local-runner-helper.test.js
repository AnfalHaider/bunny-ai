/**
 * LOCAL-MODELS Security's SP-6: the Low helper is itself in a kill-on-close job and the server it starts is a child inside that job, and killing Bunny's process HARD
 * (a crash, not a normal exit) ends the server. Windows only (the helper is Windows' own API); a stand-in node script plays the server.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRunnerHelper, RUNNER_SOURCE } from '../src/server/localRunnerHelper.js';

const win = process.platform === 'win32';
const alive = (pid) => execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes(`"${pid}"`);
const wait = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };

test('the helper source has the job, the kill-on-close flag, the parent wait and the Low label, and no breakaway', () => {
  assert.match(RUNNER_SOURCE, /CreateJobObject/);
  assert.match(RUNNER_SOURCE, /LimitFlags = 0x2000/);
  assert.match(RUNNER_SOURCE, /AssignProcessToJobObject\(job, GetCurrentProcess\(\)\)/);
  assert.match(RUNNER_SOURCE, /WaitForMultipleObjects/);
  assert.match(RUNNER_SOURCE, /S-1-16-4096/);
  assert.doesNotMatch(RUNNER_SOURCE, /0x01000000/, 'CREATE_BREAKAWAY_FROM_JOB is never used: the server is never started outside the job');
});

test('SP-6: Bunny gone (hard kill) means the server is gone: the helper is in the job and the Low server is inside it', { skip: !win && 'Windows only', timeout: 180000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-job-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const helper = createRunnerHelper({ dataDir: dir });
  const built = await helper.use();
  assert.equal(built.ok, true, built.why);
  assert.equal((await helper.verify()).ok, true);

  // the stand-in server: prints its pid and its integrity label, then idles
  const server = join(dir, 'server.mjs');
  await writeFile(server, `import { writeFileSync } from 'node:fs';
let wrote = 'denied'; try { writeFileSync(${JSON.stringify(join(dir, 'probe.txt'))}, 'x'); wrote = 'allowed'; } catch {}
console.log('SERVER ' + process.pid + ' ' + wrote);
setInterval(() => {}, 1000);
`);
  // the stand-in "Bunny": a separate node process that starts the helper the way the runtime code does, tells us the pids, and idles
  const bunny = join(dir, 'bunny.mjs');
  const wrap = await helper.wrap({ cwd: dir, commandLine: `"${process.execPath}" "${server}"`, bunnyPid: 0 });
  assert.equal(wrap.ok, true);
  await writeFile(bunny, `import { spawn } from 'node:child_process';
const h = spawn(${JSON.stringify(wrap.file)}, [String(process.pid), ${JSON.stringify(dir)}, ${JSON.stringify(`"${process.execPath}" "${server}"`)}], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
console.log('HELPER ' + h.pid);
h.stdout.on('data', (d) => process.stdout.write(d));
setInterval(() => {}, 1000);
`);
  const parent = spawn(process.execPath, [bunny], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  parent.stdout.on('data', (d) => { out += d; });
  t.after(() => { try { process.kill(parent.pid); } catch { /* gone */ } for (const m of out.matchAll(/(?:HELPER|SERVER) (\d+)/g)) { try { process.kill(Number(m[1])); } catch { /* gone */ } } });
  const seen = await wait(() => /HELPER (\d+)/.test(out) && /SERVER (\d+) (\S+)/.test(out) && out);
  assert.ok(seen, `the stand-in server came up: ${out}`);
  const helperPid = Number(/HELPER (\d+)/.exec(out)[1]);
  const [, serverPid, label] = /SERVER (\d+) (\S+)/.exec(out);
  assert.equal(label, 'denied', 'the server runs at Low integrity: it cannot write where a Medium process can');
  assert.equal(alive(helperPid), true);
  assert.equal(alive(Number(serverPid)), true);

  // a hard kill of "Bunny": no chance to clean up (no /T: the helper and the server are not touched directly)
  execFileSync('taskkill', ['/PID', String(parent.pid), '/F']);
  const gone = await wait(() => !alive(Number(serverPid)) && !alive(helperPid), 20000);
  assert.equal(gone, true, 'the server and the helper both ended with Bunny');
});
