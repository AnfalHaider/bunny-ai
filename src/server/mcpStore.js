/**
 * The list of MCP servers this app talks to.
 *
 * A server is a name and an http address. There is deliberately no "run this
 * command" field: a configuration file that could start a process would be a
 * way to run code by accident.
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

  async function add({ name, url, enabled = true }) {
    await load();
    const clean = String(name ?? '').trim();
    const address = String(url ?? '').trim();
    if (!clean) throw Object.assign(new Error('A server needs a name'), { code: 'mcp.nameRequired' });
    if (!/^https?:\/\//i.test(address)) {
      throw Object.assign(new Error('A server must be reached over http or https'), { code: 'mcp.badUrl' });
    }
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
