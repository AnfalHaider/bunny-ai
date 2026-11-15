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
 */
import { spawn, execFile } from 'node:child_process';

const PROTOCOL_VERSION = '2025-06-18';
const START_TIMEOUT_MS = 60_000; // npx may download the server on first run

export class LocalMcpError extends Error {
  constructor(message, code = 'mcp.local') { super(message); this.code = code; }
}

/** Quote an argument for the Windows shell (needed to run npx.cmd and friends). */
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

export function createLocalMcp({ clientVersion = '0.1.0' } = {}) {
  const running = new Map(); // server id -> connection

  function key(server) {
    return JSON.stringify([server.id, server.command, server.args ?? [], server.env ?? {}]);
  }

  function start(server) {
    const windows = process.platform === 'win32';
    const args = (server.args ?? []).map(String);
    const child = spawn(windows ? [server.command, ...args].map(quote).join(' ') : server.command, windows ? [] : args, {
      shell: windows, windowsHide: true, cwd: server.cwd || undefined,
      env: { ...process.env, ...(server.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const conn = { key: key(server), child, pending: new Map(), nextId: 1, buffer: '', stderr: '', exited: false };
    child.stdout.on('data', (chunk) => {
      conn.buffer += chunk.toString();
      let nl;
      while ((nl = conn.buffer.indexOf('\n')) !== -1) {
        const line = conn.buffer.slice(0, nl).trim();
        conn.buffer = conn.buffer.slice(nl + 1);
        if (!line.startsWith('{')) continue; // a log line, not a message
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const waiting = msg.id != null && conn.pending.get(msg.id);
        if (waiting) { conn.pending.delete(msg.id); waiting(msg); }
      }
    });
    child.stderr.on('data', (chunk) => { conn.stderr = (conn.stderr + chunk.toString()).slice(-4000); });
    const fail = (why) => {
      conn.exited = true;
      for (const [, done] of conn.pending) done({ error: { message: why } });
      conn.pending.clear();
      if (running.get(server.id) === conn) running.delete(server.id);
    };
    child.on('exit', (code) => fail(`The connector stopped (exit code ${code}).${conn.stderr ? ` It said: ${conn.stderr.trim().slice(-300)}` : ''}`));
    child.on('error', (err) => fail(`The connector could not start: ${err.message}`));
    conn.request = (method, params, timeoutMs) => new Promise((resolve, reject) => {
      if (conn.exited) { reject(new LocalMcpError('The connector is not running')); return; }
      const id = conn.nextId++;
      const timer = setTimeout(() => { conn.pending.delete(id); reject(new LocalMcpError('The connector did not answer in time', 'mcp.timeout')); }, timeoutMs);
      conn.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new LocalMcpError(msg.error.message ?? 'The connector refused', 'mcp.refused'));
        else resolve(msg.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    conn.ready = (async () => {
      await conn.request('initialize', {
        protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Bunny AI', version: clientVersion },
      }, START_TIMEOUT_MS);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    })();
    return conn;
  }

  async function connection(server) {
    if (!String(server?.command ?? '').trim()) throw new LocalMcpError('This connector has no command', 'mcp.noCommand');
    let conn = running.get(server.id);
    if (conn && (conn.exited || conn.key !== key(server))) { await stop(server.id); conn = null; }
    if (!conn) { conn = start(server); running.set(server.id, conn); }
    try {
      await conn.ready;
    } catch (err) {
      await stop(server.id);
      throw err instanceof LocalMcpError ? err : new LocalMcpError(err.message);
    }
    return conn;
  }

  async function listTools(server, { timeoutMs = 30_000 } = {}) {
    const conn = await connection(server);
    const result = await conn.request('tools/list', {}, timeoutMs);
    return (result?.tools ?? []).map((t) => ({
      name: t.name,
      description: String(t.description ?? '').slice(0, 400),
      inputSchema: t.inputSchema ?? null,
      readOnly: t.annotations?.readOnlyHint === true,
    }));
  }

  async function callTool(server, { name, arguments: args = {}, timeoutMs = 120_000 }) {
    const conn = await connection(server);
    return conn.request('tools/call', { name, arguments: args }, timeoutMs);
  }

  function stop(id) {
    const conn = running.get(id);
    running.delete(id);
    if (!conn || conn.exited) return Promise.resolve();
    conn.exited = true;
    return new Promise((done) => {
      const pid = conn.child.pid;
      if (process.platform === 'win32' && pid) execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
      else { try { conn.child.kill(); } catch { /* gone */ } done(); }
    });
  }

  const stopAll = () => Promise.all([...running.keys()].map(stop));

  return { listTools, callTool, stop, stopAll, running: () => [...running.keys()] };
}
