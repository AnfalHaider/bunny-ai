/**
 * The list of MCP servers this app talks to.
 *
 * A server is a name and either an http address (remote) or a command to run
 * (local). A local one is only added when the person confirmed the exact command
 * (the route checks for that), so a configuration cannot start a program by accident.
 */

import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * L-4: with a secret store, the values of a local connector's settings (often API keys) live there, keyed by connector id and variable name,
 * and mcp.json keeps only the NAMES (envNames). Every answer of this store shows names only; resolveEnv gives the values back to start the
 * program. Without a secret store (tests of the plain store) nothing changes.
 */
const secretKey = (id, name) => `mcp-env.${id}.${name}`;
const VAR = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;

export function createMcpStore({ file, secrets = null }) {
  let servers = [];
  let loaded = false;

  /** A copy for the outside: the settings' values are never in it, only their names. */
  const view = (s) => {
    if (!s) return null;
    const { env, ...rest } = s;
    return s.type === 'local' ? { ...rest, envNames: s.envNames ?? Object.keys(env ?? {}) } : { ...rest };
  };

  // Atomic: a temp file, then a rename, so a crash never leaves half a file; a failed write leaves no temp behind.
  async function persist() {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(servers, null, 2), 'utf8');
      await rename(temp, file);
    } catch (err) {
      await rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** Remove one stored setting; a store that has none of it is not an error. */
  const dropSecret = async (id, name) => { try { await secrets.delete(secretKey(id, name)); } catch { /* already gone */ } };

  /** Put a value in the secret store and read it back; throws if either fails (so a value is never lost or half-kept). */
  async function putSecret(id, name, value) {
    await secrets.set(secretKey(id, name), value);
    if ((await secrets.get(secretKey(id, name))) !== value) throw Object.assign(new Error('The secret store did not keep a setting. Nothing was changed.'), { code: 'mcp.secretStore' });
  }

  /** Old connectors have their values in plain text in mcp.json: move each to the secret store, check it reads back, and only then rewrite the file. */
  async function migrate() {
    if (!secrets) return;
    let changed = false;
    for (const s of servers) {
      if (s.type !== 'local' || !s.env || !Object.keys(s.env).length) continue;
      try {
        for (const [k, v] of Object.entries(s.env)) await putSecret(s.id, k, String(v));
        s.envNames = Object.keys(s.env);
        delete s.env;
        changed = true;
      } catch { /* the store is not available: this connector keeps its plain values and works as before */ }
    }
    if (changed) await persist().catch(() => {});
  }

  async function load() {
    if (loaded) return servers;
    loaded = true;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) servers = parsed;
    } catch {
      servers = [];
    }
    await migrate();
    return servers;
  }

  async function list() {
    await load();
    return servers.map(view).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    await load();
    return view(servers.find((s) => s.id === id));
  }

  /** The settings of a local connector with their values, for starting it. Never shown, never logged. */
  async function resolveEnv(id) {
    await load();
    const s = servers.find((x) => x.id === id);
    if (!s) return {};
    const out = { ...(s.env ?? {}) }; // not moved yet (no store, or it was unavailable)
    for (const name of s.envNames ?? []) {
      const value = secrets ? await secrets.get(secretKey(id, name)) : null;
      if (typeof value === 'string') out[name] = value;
    }
    return out;
  }

  async function add({ name, url, command, args = [], env = {}, cwd = null, enabled = true }) {
    await load();
    const clean = String(name ?? '').trim();
    const address = String(url ?? '').trim();
    if (!clean) throw Object.assign(new Error('A server needs a name'), { code: 'mcp.nameRequired' });
    if (String(command ?? '').trim()) {
      const local = cleanLocal({ command, args, env, cwd });
      const server = { id: randomUUID(), name: clean.slice(0, 60), type: 'local', ...local, enabled: Boolean(enabled), status: 'unknown', tools: [], lastError: null, createdAt: new Date().toISOString() };
      if (secrets && Object.keys(local.env).length) {
        try {
          for (const [k, v] of Object.entries(local.env)) await putSecret(server.id, k, v);
        } catch (err) {
          for (const k of Object.keys(local.env)) await dropSecret(server.id, k);
          throw err;
        }
        server.envNames = Object.keys(local.env);
        delete server.env;
      }
      servers.push(server);
      await persist();
      return view(server);
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
    return view(server);
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
      // RO-1: trust was given to the connector at its old address; a different address is a different connector
      if (address.slice(0, 500) !== server.url) server.trustReadOnly = false;
      server.url = address.slice(0, 500);
    }
    if (patch.enabled !== undefined) server.enabled = Boolean(patch.enabled);
    if (patch.trustReadOnly !== undefined) server.trustReadOnly = patch.trustReadOnly === true; // RO-1: trust this connector's own read-only labels
    // L-4: a setting named with a value is set; named with a blank value it is cleared; a name not mentioned keeps its stored value
    if (server.type === 'local' && patch.env && typeof patch.env === 'object') {
      const names = new Set(server.envNames ?? Object.keys(server.env ?? {}));
      for (const [k, v] of Object.entries(patch.env).slice(0, 30)) {
        if (!VAR.test(k)) continue;
        if (v === '' || v === null) {
          names.delete(k);
          if (server.env) delete server.env[k];
          if (secrets) await dropSecret(id, k);
        } else if (secrets) {
          await putSecret(id, k, String(v).slice(0, 2000));
          names.add(k);
        } else {
          server.env = { ...(server.env ?? {}), [k]: String(v).slice(0, 2000) };
          names.add(k);
        }
      }
      server.envNames = [...names];
      if (secrets && server.env) { for (const k of Object.keys(server.env)) delete server.env[k]; delete server.env; }
    }
    await persist();
    return view(server);
  }

  async function remove(id) {
    await load();
    const before = servers.length;
    // L-4: a connector's settings leave the secret store with it
    const leaving = servers.find((s) => s.id === id);
    if (leaving && secrets) for (const name of leaving.envNames ?? []) await dropSecret(id, name);
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
    return view(server);
  }

  return { list, get, add, update, remove, setStatus, resolveEnv };
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
