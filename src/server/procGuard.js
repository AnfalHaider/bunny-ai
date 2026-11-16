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

const serverPid = Number(process.argv[2]);
const [command, ...args] = JSON.parse(process.argv[3] ?? '[]');
if (!serverPid || !command) process.exit(2);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function killOwnTree() {
  if (process.platform === 'win32') {
    // Kill the program's tree, not ours: taskkill is our own child, so killing us first would cut it short.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
  } else {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { /* not a group leader */ }
    try { child.kill('SIGKILL'); } catch { /* gone */ }
  }
  process.exit(1);
}

const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });

setInterval(() => { if (!alive(serverPid)) killOwnTree(); }, 500);
