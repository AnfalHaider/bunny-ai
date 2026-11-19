/**
 * CLI-ENGINES §1.3 (CE-8): starting an engine's process and ending it.
 *
 * The program starts by ABSOLUTE path (never a bare name), hidden, with `safeEnv` plus only the variables the adapter names, and no handles but the pipes. The prompt never goes on the command
 * line (the caller writes it to stdin). On stop, abort, timeout, or a run that prints nothing for too long, the whole process tree is killed with `taskkill /T /F` (the RUN-1 lesson):
 * no engine process outlives its run, and `stragglers()` lets Bunny check on quit.
 */
import { spawn, execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { safeEnv, taskkillPath } from '../safeExec.js';
import { MAX_LINE_BYTES, EngineEventError } from './events.js';

const alive = new Set();

/** Kill a process and everything it started. Resolves when taskkill is done (or at once where there is none). */
export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) { resolve(); return; }
    const tk = taskkillPath();
    if (tk) execFile(tk, ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } resolve(); }
  });
}

/** The pids of engine processes Bunny started and that are still running (for the check on quit). */
export const stragglers = () => [...alive];
export async function killStragglers() { const list = stragglers(); await Promise.all(list.map((pid) => killTree(pid))); return list.length; }

/**
 * Start a program. `env` is `safeEnv` plus `extraEnv`: nothing else of Bunny's environment is added (the caller names every variable). Returns
 * { child, lines (async iterable of stdout lines), stderr(), write(text), end(), kill(), exited (promise of the exit code) }.
 */
export function spawnEngine({ file, args = [], cwd, extraEnv = {}, baseEnv, maxLine = MAX_LINE_BYTES }) {
  if (!isAbsolute(String(file))) throw new Error('An engine starts by its full path, never by a bare name.');
  const env = safeEnv(extraEnv, baseEnv ?? minimalEnv());
  const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  if (child.pid) alive.add(child.pid);
  let stderr = '';
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-20_000); });
  const exited = new Promise((resolve) => { child.on('close', (code) => { alive.delete(child.pid); resolve(code); }); child.on('error', () => { alive.delete(child.pid); resolve(-1); }); });
  child.stdin.on('error', () => { /* the engine ended first */ });

  async function* lines() {
    let buf = '';
    for await (const chunk of child.stdout) {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (Buffer.byteLength(line) > maxLine) throw new EngineEventError('An engine line was longer than 1 MB: the run was stopped.');
        if (line.trim()) yield line;
      }
      if (Buffer.byteLength(buf) > maxLine) throw new EngineEventError('An engine line was longer than 1 MB: the run was stopped.');
    }
    if (buf.trim()) yield buf.replace(/\r$/, '');
  }
  return {
    child, lines: lines(), stderr: () => stderr, exited,
    write: (text) => { try { child.stdin.write(text); } catch { /* ended */ } },
    end: () => { try { child.stdin.end(); } catch { /* ended */ } },
    kill: () => killTree(child.pid),
  };
}

/** The small environment an engine starts with: only what a program needs to run on Windows. The caller adds the engine's own variables; no key and no token of Bunny's is here. */
export function minimalEnv(from = process.env) {
  const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'PATH', 'Path', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
  const out = {};
  for (const k of keep) if (from[k] !== undefined) out[k] = from[k];
  return out;
}
