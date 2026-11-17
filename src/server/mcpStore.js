/**
 * The list of MCP servers this app talks to.
 *
 * A server is a name and either an http address (remote) or a command to run
 * (local). A local one is only added when the person confirmed the exact command
 * (the route checks for that), so a configuration cannot start a program by accident.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function createMcpStore({ file }) {
  let servers = [];
  let loaded = false;

  async function load() {
    if (loaded) return servers;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) servers = parsed;
    } catch {
      servers = [];
    }
    loaded = true;
    return servers;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(servers, null, 2), 'utf8');
  }

  async function list() {
    await load();
    return [...servers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    await load();
    return servers.find((s) => s.id === id) ?? null;
  }

  async function add({ name, url, command, args = [], env = {}, cwd = null, enabled = true }) {
    await load();
    const clean = String(name ?? '').trim();
    const address = String(url ?? '').trim();
    if (!clean) throw Object.assign(new Error('A server needs a name'), { code: 'mcp.nameRequired' });
    if (String(command ?? '').trim()) {
      const local = cleanLocal({ command, args, env, cwd });
      const server = { id: randomUUID(), name: clean.slice(0, 60), type: 'local', ...local, enabled: Boolean(enabled), status: 'unknown', tools: [], lastError: null, createdAt: new Date().toISOString() };
      servers.push(server);
      await persist();
      return server;
    }
    if (!/^https?:\/\//i.test(address)) {
      throw Object.assign(new Error('A server must be reached over http or https'), { code: 'mcp.badUrl' });
    }
    // W4-11 R-4: the same address twice would offer every tool twice
    const same = servers.find((s) => s.url && String(s.url).trim().toLowerCase().replace(/\/+$/, '') === address.toLowerCase().replace(/\/+$/, ''));
    if (same) throw Object.assign(new Error(`That address is already a connector (${same.name}).`), { code: 'mcp.duplicate', existing: same.id });
    const server = {
      id: randomUUID(),
      name: clean.slice(0, 60),
      url: address.slice(0, 500),
      enabled: Boolean(enabled),
      status: 'unknown',
      tools: [],
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    servers.push(server);
    await persist();
    return server;
  }

  async function update(id, patch) {
    await load();
    const server = servers.find((s) => s.id === id);
    if (!server) throw Object.assign(new Error('No such server'), { code: 'mcp.notFound' });
    if (patch.name !== undefined) server.name = String(patch.name).trim().slice(0, 60) || server.name;
    if (patch.url !== undefined) {
      const address = String(patch.url).trim();
      if (!/^https?:\/\//i.test(address)) {
        throw Object.assign(new Error('A server must be reached over http or https'), { code: 'mcp.badUrl' });
      }
      server.url = address.slice(0, 500);
    }
    if (patch.enabled !== undefined) server.enabled = Boolean(patch.enabled);
    if (patch.trustReadOnly !== undefined) server.trustReadOnly = patch.trustReadOnly === true; // RO-1: trust this connector's own read-only labels
    await persist();
    return server;
  }

  async function remove(id) {
    await load();
    const before = servers.length;
    servers = servers.filter((s) => s.id !== id);
    await persist();
    return servers.length !== before;
  }

  /** Record what happened when the server was last asked for its tools. */
  async function setStatus(id, { status, tools = null, error = null }) {
    await load();
    const server = servers.find((s) => s.id === id);
    if (!server) return null;
    server.status = status;
    server.lastError = error;
    if (tools) server.tools = tools;
    server.checkedAt = new Date().toISOString();
    await persist();
    return server;
  }

  return { list, get, add, update, remove, setStatus };
}

/** A local connector's command, checked: one program, plain arguments, text variables. */
function cleanLocal({ command, args, env, cwd }) {
  const program = String(command).trim();
  if (/[\r\n]/.test(program) || program.length > 300) throw Object.assign(new Error('The command must be one line'), { code: 'mcp.badCommand' });
  const list = (Array.isArray(args) ? args : []).slice(0, 40).map((a) => String(a));
  if (list.some((a) => /[\r\n]/.test(a) || a.length > 1000)) throw Object.assign(new Error('Each argument must be one line'), { code: 'mcp.badCommand' });
  const vars = {};
  for (const [k, v] of Object.entries(env && typeof env === 'object' ? env : {}).slice(0, 30)) {
    if (/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(k)) vars[k] = String(v).slice(0, 2000);
  }
  return { command: program, args: list, env: vars, cwd: cwd ? String(cwd).slice(0, 500) : null };
}
