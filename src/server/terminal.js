/**
 * Terminal sessions for Bunny AI.
 *
 * Creates and manages local shell processes (PowerShell by default on
 * Windows) that the agent and the person can both interact with. Each
 * terminal has an id, a writable stdin pipe and a readable stdout/stderr
 * buffer. Used by the Terminal side pane.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** @typedef {{ id: string, proc: any, buffer: string[], rows: number, cols: number, cwd: string }} Terminal */

export function createTerminalStore() {
  const terminals = new Map();

  /** Create a new terminal running the given shell. */
  function create({ shell = 'powershell.exe', cwd = process.cwd(), rows = 40, cols = 120 } = {}) {
    const id = randomUUID();
    const proc = spawn(shell, [], {
      cwd,
      windowsHide: false,
      env: { ...process.env },
    });

    const buffer = [];
    proc.stdout.on('data', (chunk) => { buffer.push(chunk.toString()); });
    proc.stderr.on('data', (chunk) => { buffer.push(chunk.toString()); });
    proc.on('close', () => { buffer.push('[process exited]'); });

    terminals.set(id, { id, proc, buffer, rows, cols, cwd });
    return { id };
  }

  /** Write input to a terminal's stdin. */
  function write(id, text) {
    const t = terminals.get(id);
    if (!t) throw new Error(`No such terminal: ${id}`);
    if (!t.proc.stdin.writable) throw new Error(`Terminal ${id} is not writable`);
    t.proc.stdin.write(text);
    return { ok: true };
  }

  /** Read the current buffer of a terminal. */
  function read(id) {
    const t = terminals.get(id);
    if (!t) throw new Error(`No such terminal: ${id}`);
    return { id, text: t.buffer.join(''), rows: t.rows, cols: t.cols };
  }

  /** Resize a terminal. */
  function resize(id, { rows, cols }) {
    const t = terminals.get(id);
    if (!t) throw new Error(`No such terminal: ${id}`);
    if (rows) t.rows = rows;
    if (cols) t.cols = cols;
    return { ok: true, rows: t.rows, cols: t.cols };
  }

  /** Kill a terminal process. */
  function kill(id) {
    const t = terminals.get(id);
    if (!t) return { ok: false };
    try { t.proc.kill(); } catch { /* best effort */ }
    terminals.delete(id);
    return { ok: true };
  }

  /** List all terminal ids. */
  function list() {
    return [...terminals.keys()];
  }

  return { create, write, read, resize, kill, list };
}
