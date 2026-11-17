/**
 * Local connectors: MCP servers that run as a program on this computer (most
 * published ones do: "npx -y @modelcontextprotocol/server-filesystem C:\\notes").
 *
 * They speak JSON-RPC over the program's stdin and stdout, one message per line.
 * A program is started on first use, kept running for the next call, and stopped
 * when Bunny AI closes or the connector is removed or changed.
 *
 * Safety: a local connector runs a program, so one is only added when the person
 * confirms the exact command (in Automation, or on a card the model cannot skip).
 * Nothing starts a program from a file the person did not confirm.
 *
 * W6-14: the first start in a run may take up to five minutes (npx and uvx download the
 * server first) and reports progress; later starts and calls keep the short limits.
 */
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cleanSchema, MAX_PAGES, MAX_TOOLS } from './mcp.js';

const PROTOCOL_VERSION = '2025-06-18';
const START_TIMEOUT_MS = 60_000; // a start of a program that has already started once in this run
const FIRST_START_MS = 5 * 60_000; // the first start in this run: npx or uvx may download the server first

/** The programs a connector proposed by the model may run. A person adding one in the window is not held to this list. */
export const LOCAL_COMMANDS = ['npx', 'node', 'uvx', 'python', 'python3', 'docker'];

export class LocalMcpError extends Error {
  constructor(message, code = 'mcp.local') { super(message); this.code = code; }
}

/**
 * Check a command the model proposed: a bare program name from LOCAL_COMMANDS (no path, no shell text),
 * and arguments that are a list of plain strings. Throws a LocalMcpError that says why in plain words.
 */
export function checkProposedCommand(command, args) {
  const program = String(command ?? '').trim();
  if (!LOCAL_COMMANDS.includes(program)) {
    throw new LocalMcpError(`A connector added from the chat can only run one of: ${LOCAL_COMMANDS.join(', ')}. "${program.slice(0, 60)}" is not one of them. Add it yourself in Settings, Customize.`, 'mcp.commandNotAllowed');
  }
  if (args != null && !Array.isArray(args)) throw new LocalMcpError('The arguments must be a list of separate pieces of text, not one command line.', 'mcp.badArgs');
  if ((args ?? []).some((a) => typeof a !== 'string')) throw new LocalMcpError('Each argument must be plain text.', 'mcp.badArgs');
  return { command: program, args: [...(args ?? [])] };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** The last line of a program's output for the chat: no colour codes, no secrets, at most 200 characters. */
export function progressLine(text, secrets = []) {
  let line = String(text ?? '').replace(ANSI, '').replace(CONTROL, '')
    .split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).pop() ?? '';
  for (const secret of secrets) if (secret.length >= 4) line = line.split(secret).join('***');
  line = line.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b([A-Za-z0-9_-]*(?:key|token|secret|password|passwd)[A-Za-z0-9_-]*)\s*[=:]\s*\S+/gi, '$1=***');
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** Quote an argument for the Windows shell (needed to run npx.cmd and friends). */
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

const waitText = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minute(s)` : `${Math.max(1, Math.round(ms / 1000))} second(s)`);

export function createLocalMcp({ clientVersion = '0.1.0', firstStartMs = FIRST_START_MS, startMs = START_TIMEOUT_MS } = {}) {
  const running = new Map(); // server id -> connection
  const everReady = new Set(); // keys (id + command + arguments + settings) that have started once in this run

  function key(server) {
    // L-4: the settings' values are hashed, so the key that tells whether a value changed (and the program must restart) never holds them
    return createHash('sha256').update(JSON.stringify([server.id, server.command, server.args ?? [], server.env ?? {}])).digest('hex');
  }

  function start(server) {
    const windows = process.platform === 'win32';
    const args = (server.args ?? []).map(String);
    const child = spawn(windows ? [server.command, ...args].map(quote).join(' ') : server.command, windows ? [] : args, {
      shell: windows, windowsHide: true, cwd: server.cwd || undefined,
      detached: !windows, // its own process group, so stop() can end the program and its children together
      env: { ...process.env, ...(server.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const conn = { key: key(server), child, pending: new Map(), nextId: 1, buffer: '', stderr: '', exited: false, lastLine: '', readyDone: false };
    conn.first = !everReady.has(conn.key);
    const secrets = Object.values(server.env ?? {}).map(String);
    conn.say = (text) => progressLine(text, secrets);
    child.stdout.on('data', (chunk) => {
      conn.buffer += chunk.toString();
      let nl;
      while ((nl = conn.buffer.indexOf('\n')) !== -1) {
        const line = conn.buffer.slice(0, nl).trim();
        conn.buffer = conn.buffer.slice(nl + 1);
        if (!line.startsWith('{')) continue; // a log line, not a message
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        // L-5: a message with an id AND a method is the connector asking us something: answer ping and roots/list, refuse the rest plainly
        if (msg.id != null && typeof msg.method === 'string') {
          const answer = msg.method === 'ping' ? { result: {} } : msg.method === 'roots/list' ? { result: { roots: [] } } : { error: { code: -32601, message: 'Bunny AI does not answer that' } };
          try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...answer })}\n`); } catch { /* the program is gone */ }
          continue;
        }
        const waiting = msg.id != null && conn.pending.get(msg.id);
        if (waiting) { conn.pending.delete(msg.id); waiting(msg); }
      }
    });
    child.stderr.on('data', (chunk) => {
      conn.stderr = (conn.stderr + chunk.toString()).slice(-4000);
      const line = conn.say(chunk.toString());
      if (line) conn.lastLine = line;
    });
    const fail = (why) => {
      conn.exited = true;
      for (const [, done] of conn.pending) done({ error: { message: why } });
      conn.pending.clear();
      if (running.get(server.id) === conn) running.delete(server.id);
    };
    child.on('exit', (code) => fail(`The connector stopped (exit code ${code}).${conn.stderr ? ` It said: ${conn.say(conn.stderr.slice(-300))}` : ''}`));
    child.on('error', (err) => fail(`The connector could not start: ${err.message}`));
    conn.request = (method, params, timeoutMs, signal = null) => new Promise((resolve, reject) => {
      if (conn.exited) { reject(new LocalMcpError('The connector is not running')); return; }
      if (signal?.aborted) { reject(new LocalMcpError('Stopped.', 'mcp.cancelled')); return; }
      const id = conn.nextId++;
      // R-7: Stop ends the wait now and tells the connector to give up on that request
      const onAbort = () => {
        if (!conn.pending.has(id)) return;
        conn.pending.delete(id);
        clearTimeout(timer);
        try { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'The person pressed Stop' } })}\n`); } catch { /* the program is gone */ }
        reject(new LocalMcpError('Stopped.', 'mcp.cancelled'));
      };
      const timer = setTimeout(() => { conn.pending.delete(id); signal?.removeEventListener('abort', onAbort); reject(new LocalMcpError('The connector did not answer in time', 'mcp.timeout')); }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      conn.pending.set(id, (msg) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (msg.error) reject(new LocalMcpError(msg.error.message ?? 'The connector refused', 'mcp.refused'));
        else resolve(msg.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    const limit = conn.first ? firstStartMs : startMs;
    conn.ready = (async () => {
      try {
        const init = await conn.request('initialize', {
          protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Bunny AI', version: clientVersion },
        }, limit);
        conn.instructions = String(init?.instructions ?? '').slice(0, 2000); // L-1: what the connector says about itself, for the model
      } catch (err) {
        if (err.code !== 'mcp.timeout') throw err;
        const said = conn.lastLine ? ` The last thing it said: ${conn.lastLine}` : '';
        throw new LocalMcpError(`${server.name ?? 'The connector'} did not finish starting within ${waitText(limit)}, so it was stopped.${said}`, 'mcp.startTimeout');
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      conn.readyDone = true;
      everReady.add(conn.key);
    })();
    conn.ready.catch(() => {}); // the caller waiting on it reports the failure
    return conn;
  }

  /**
   * `onProgress(text)` is called about once a second while the program is still starting;
   * `signal` ends the start (the program and its children are killed) when it aborts.
   */
  async function connection(server, { onProgress = null, signal = null } = {}) {
    if (!String(server?.command ?? '').trim()) throw new LocalMcpError('This connector has no command', 'mcp.noCommand');
    if (signal?.aborted) throw new LocalMcpError('Stopped before the connector started.', 'mcp.cancelled');
    let conn = running.get(server.id);
    if (conn && (conn.exited || conn.key !== key(server))) { await stop(server.id); conn = null; }
    if (!conn) { conn = start(server); running.set(server.id, conn); }
    let ticker = null;
    let onAbort = null;
    try {
      const waits = [conn.ready];
      if (!conn.readyDone) {
        const began = Date.now();
        if (onProgress) {
          const tick = () => {
            const seconds = Math.round((Date.now() - began) / 1000);
            const head = `Starting ${server.name ?? 'the connector'}${conn.first ? ' (first start can take a few minutes)' : ''}… ${seconds}s`;
            try { onProgress(conn.lastLine ? `${head}\n${conn.lastLine}` : head); } catch { /* a broken listener must not stop the start */ }
          };
          tick();
          ticker = setInterval(tick, 1000);
        }
        if (signal) {
          waits.push(new Promise((_, reject) => {
            onAbort = () => reject(new LocalMcpError('Stopped while the connector was starting.', 'mcp.cancelled'));
            signal.addEventListener('abort', onAbort, { once: true });
          }));
        }
      }
      await Promise.race(waits);
    } catch (err) {
      await stop(server.id);
      throw err instanceof LocalMcpError ? err : new LocalMcpError(err.message);
    } finally {
      if (ticker) clearInterval(ticker);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    return conn;
  }

  async function listTools(server, { timeoutMs = 30_000, onProgress = null, signal = null } = {}) {
    const conn = await connection(server, { onProgress, signal });
    // R-5: follow nextCursor (at most 20 pages)
    const all = [];
    let cursor = null;
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await conn.request('tools/list', cursor ? { cursor } : {}, timeoutMs);
      all.push(...(result?.tools ?? []));
      cursor = result?.nextCursor || null;
      if (!cursor) break;
      if (all.length >= MAX_TOOLS || page === MAX_PAGES - 1) { truncated = true; break; }
    }
    const cleaned = all.slice(0, MAX_TOOLS).map((t) => ({
      name: t.name,
      description: String(t.description ?? '').slice(0, 1000),
      inputSchema: cleanSchema(t.inputSchema),
      readOnlyHint: t.annotations?.readOnlyHint === true, // what the connector SAYS: a suggestion only (RO-1)
      readOnly: false,
    }));
    if (truncated) Object.defineProperty(cleaned, 'truncated', { value: true });
    return cleaned;
  }

  async function callTool(server, { name, arguments: args = {}, timeoutMs = 120_000, onProgress = null, signal = null }) {
    const conn = await connection(server, { onProgress, signal });
    return conn.request('tools/call', { name, arguments: args }, timeoutMs, signal);
  }

  /** The instructions the connector gave when it started (empty if none, or if it is not running). */
  const instructions = (id) => running.get(id)?.instructions ?? '';

  function stop(id) {
    const conn = running.get(id);
    running.delete(id);
    if (!conn || conn.exited) return Promise.resolve();
    conn.exited = true;
    return new Promise((done) => {
      const pid = conn.child.pid;
      if (process.platform === 'win32' && pid) execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
      else {
        try { process.kill(-pid, 'SIGKILL'); } catch { try { conn.child.kill('SIGKILL'); } catch { /* gone */ } }
        done();
      }
    });
  }

  const stopAll = () => Promise.all([...running.keys()].map(stop));

  return { listTools, callTool, instructions, stop, stopAll, running: () => [...running.keys()] };
}
