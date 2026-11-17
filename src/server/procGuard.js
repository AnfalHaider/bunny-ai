/**
 * W4-1d: a small supervisor that sits between Bunny's server and a program the
 * model started. Usage: node procGuard.js <serverPid> <json: [command, ...args]>
 *
 * It runs the program with the same output and working folder, and watches the
 * server. If the server disappears (closed, crashed, killed), the supervisor
 * stops the program's whole process tree and then itself, so nothing is left
 * running after Bunny. Stopping the supervisor's tree from outside works too.
 */
import { spawn, spawnSync } from 'node:child_process';
import { safeEnv, taskkillPath } from './safeExec.js';

const serverPid = Number(process.argv[2]);
const [command, ...args] = JSON.parse(process.argv[3] ?? '[]');
if (!serverPid || !command) process.exit(2);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function killOwnTree() {
  if (process.platform === 'win32') {
    // Kill the program's tree, not ours: taskkill is our own child, so killing us first would cut it short.
    spawnSync(taskkillPath() ?? 'taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000, shell: false, env: safeEnv() });
  } else {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { /* not a group leader */ }
    try { child.kill('SIGKILL'); } catch { /* gone */ }
  }
  process.exit(1);
}

// The guard itself runs as plain Node (ELECTRON_RUN_AS_NODE); the program it starts must not inherit that or other Electron-internal variables.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ELECTRON_/i.test(k)));
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });

// Two ways to notice the server is gone. The pipe the server holds open on our stdin ends when it dies, whatever its pid
// is later reused for; the pid check is the fallback if the pipe is somehow never closed.
process.stdin.on('end', killOwnTree).on('close', killOwnTree).on('error', killOwnTree).resume();
setInterval(() => { if (!alive(serverPid)) killOwnTree(); }, 500);
