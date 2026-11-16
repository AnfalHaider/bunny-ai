/**
 * Programs the model starts and leaves running: a dev server, a watcher, a
 * long build. run_command waits for a command to finish; these keep going, and
 * the model reads their output when it wants and stops them when it is done.
 *
 * Every process belongs to the chat that started it and runs inside that
 * chat's folder. They all stop when Bunny AI closes.
 */
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POWERSHELL_PRELUDE, NON_INTERACTIVE, translateChains } from './workspace.js';

const GUARD = fileURLToPath(new URL('./procGuard.js', import.meta.url));
const MAX_KEPT = 40_000;       // characters of output kept per process
const MAX_RUNNING = 6;         // per chat

export function createProcessStore() {
  const procs = new Map();
  let counter = 0;

  function start({ command, cwd, owner }) {
    const running = [...procs.values()].filter((p) => p.owner === owner && p.exitCode === null);
    if (running.length >= MAX_RUNNING) {
      throw new Error(`${MAX_RUNNING} programs are already running in this chat. Stop one first.`);
    }
    counter += 1;
    const id = `p${counter}`;
    // W4-1d: run it under procGuard, which stops the program's whole tree if this server ever disappears. It is detached so Windows does not end it together with the server (a job object would, before it could clean up).
    const win = process.platform === 'win32';
    const inner = win
      ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `${POWERSHELL_PRELUDE}
${translateChains(command)}`]
      : ['sh', '-c', command];
    const child = spawn(process.execPath, [GUARD, String(process.pid), JSON.stringify(inner)],
      { cwd, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(win ? NON_INTERACTIVE : {}), ELECTRON_RUN_AS_NODE: '1' } });
    const p = { id, command, cwd, owner, child, out: '', read: 0, exitCode: null, started: Date.now() };
    const add = (chunk) => {
      p.out += chunk.toString();
      if (p.out.length > MAX_KEPT * 2) {
        const cut = p.out.length - MAX_KEPT;
        p.out = p.out.slice(cut);
        p.read = Math.max(0, p.read - cut);
      }
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    child.on('exit', (code) => { if (p.exitCode === null) p.exitCode = code ?? -1; });
    child.on('error', (err) => { add(`\n${err.message}\n`); p.exitCode = -1; });
    procs.set(id, p);
    return p;
  }

  function get(id, owner) {
    const p = procs.get(String(id ?? '').trim());
    if (!p || (owner && p.owner !== owner)) throw new Error(`No program called ${id} in this chat. list_processes shows them.`);
    return p;
  }

  /** What the program printed since the last read. */
  function read(id, owner) {
    const p = get(id, owner);
    const fresh = p.out.slice(p.read);
    p.read = p.out.length;
    return { id: p.id, command: p.command, running: p.exitCode === null, exitCode: p.exitCode, output: fresh };
  }

  /** Wait until the program prints something that settles, finishes, or the time is up. */
  async function settle(id, owner, seconds = 5) {
    const p = get(id, owner);
    const until = Date.now() + Math.max(1, Math.min(30, Number(seconds) || 5)) * 1000;
    let lastLength = -1;
    let quietSince = Date.now();
    while (Date.now() < until && p.exitCode === null) {
      await new Promise((r) => setTimeout(r, 250));
      if (p.out.length !== lastLength) { lastLength = p.out.length; quietSince = Date.now(); }
      // A server that has printed its address and gone quiet is ready.
      if (p.out.length && Date.now() - quietSince > 1500 && /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i.test(p.out)) break;
    }
    return read(id, owner);
  }

  async function stop(id, owner) {
    const p = get(id, owner);
    if (p.exitCode === null) await killTree(p);
    return { id: p.id, stopped: true };
  }

  function list(owner) {
    return [...procs.values()].filter((p) => !owner || p.owner === owner).map((p) => ({
      id: p.id, command: p.command, running: p.exitCode === null, exitCode: p.exitCode, started: p.started,
    }));
  }

  async function stopAll() {
    await Promise.all([...procs.values()].filter((p) => p.exitCode === null).map((p) => killTree(p).catch(() => {})));
  }

  /** Everything kept from a program's output, for the person to look at; the model's place is not moved. */
  function log(id) {
    const p = procs.get(String(id ?? ''));
    if (!p) throw new Error('No such program.');
    return { id: p.id, command: p.command, running: p.exitCode === null, exitCode: p.exitCode, owner: p.owner, output: p.out };
  }

  return { start, read, settle, stop, list, stopAll, log };
}

/** A shell starts children of its own: stop the whole tree, not just the shell. */
function killTree(p) {
  return new Promise((resolve) => {
    const pid = p.child.pid;
    if (!pid) { resolve(); return; }
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { if (p.exitCode === null) p.exitCode = -1; resolve(); });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { try { p.child.kill('SIGTERM'); } catch { /* gone */ } }
      if (p.exitCode === null) p.exitCode = -1;
      resolve();
    }
  });
}
