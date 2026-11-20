/**
 * The list of MCP servers this app talks to.
 *
 * A server is a name and either an http address (remote) or a command to run
 * (local). A local one is only added when the person confirmed the exact command
 * (the route checks for that), so a configuration cannot start a program by accident.
 */

import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { trustSnapshot } from './mcp.js';
import { randomUUID } from 'node:crypto';
import { cleanFolders } from './scope.js';

/**
 * L-4: with a secret store, the values of a local connector's settings (often API keys) live there, keyed by connector id and variable name,
 * and mcp.json keeps only the NAMES (envNames). Every answer of this store shows names only; resolveEnv gives the values back to start the
 * program. Without a secret store (tests of the plain store) nothing changes.
 */
const secretKey = (id, name) => `mcp-env.${id}.${name}`;
const VAR = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;

/**
 * K-1..K-4 (the paste-your-key card): a remote connector's key (one required header the vendor asks for) lives ONLY in the secret store, keyed by connector id, and mcp.json keeps the header NAME,
 * the origin it was saved for, and a flag. Nothing here ever answers with the value. The key is given back (resolveKey) only for the exact origin it was saved for, and an address change drops it.
 */
const keySecret = (id) => `mcp-key.${id}`;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const NEVER_HEADERS = /^(host|cookie|set-cookie|content-length|content-type|content-encoding|transfer-encoding|connection|origin|referer|user-agent|accept|accept-encoding|te|upgrade|keep-alive|expect|forwarded|via|date|range|trailer|mcp-session-id|mcp-protocol-version|proxy-.*|sec-.*|x-forwarded-.*|if-.*)$/i;
/** Why this header name may not carry a key, or '' (K-4). `authorization` only when the vendor's own entry named it (the connector's keyHeaders). */
export function keyHeaderProblem(name, { allowed = [] } = {}) {
  const n = String(name ?? '');
  if (!HEADER_NAME.test(n)) return 'A header name is letters, digits and hyphens, up to 64 characters.';
  if (NEVER_HEADERS.test(n)) return `${n} is a header Bunny sets itself or one that must not carry a key.`;
  if (/^authorization$/i.test(n) && !allowed.some((a) => /^authorization$/i.test(a))) return 'Authorization is used only when the service itself asks for it. Use the header name the service tells you.';
  return '';
}
const cleanHeaderNames = (list) => [...new Set((Array.isArray(list) ? list : []).map((h) => String(h ?? '')).filter((h) => HEADER_NAME.test(h) && !NEVER_HEADERS.test(h)))].slice(0, 5);
const originOf = (url) => { try { return new URL(String(url)).origin; } catch { return null; } };

export function createMcpStore({ file, secrets = null }) {
  let servers = [];
  let loaded = false;

  /** A copy for the outside: the settings' values are never in it, only their names. */
  const view = (s) => {
    if (!s) return null;
    const { env, ...rest } = s;
    const { keyOrigin: _origin, keySet, ...shown } = rest; // the origin stays inside; the outside learns only the header name and whether a key is set
    return s.type === 'local' ? { ...shown, envNames: s.envNames ?? Object.keys(env ?? {}) } : { ...shown, hasKey: keySet === true };
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

  /** W6-6: where an installed tool came from: the repository, the commit and the one folder name inside Bunny AI's tools folder. Nothing else is kept. */
  function cleanSource(source) {
    if (!source || typeof source !== 'object') return {};
    const repo = String(source.repo ?? '');
    const sha = String(source.sha ?? '');
    const folder = String(source.folder ?? '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha) || !/^[\w.-]{1,200}$/.test(folder)) return {};
    return { source: { repo, sha, folder } };
  }

  async function add({ name, url, command, args = [], env = {}, cwd = null, enabled = true, folders = [], source = null, keyHeaders = [] }) {
    await load();
    const clean = String(name ?? '').trim();
    const address = String(url ?? '').trim();
    if (!clean) throw Object.assign(new Error('A server needs a name'), { code: 'mcp.nameRequired' });
    if (String(command ?? '').trim()) {
      const local = cleanLocal({ command, args, env, cwd });
      const server = { id: randomUUID(), name: clean.slice(0, 60), type: 'local', ...local, enabled: Boolean(enabled), folders: cleanFolders(folders), ...cleanSource(source), status: 'unknown', tools: [], lastError: null, createdAt: new Date().toISOString() };
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
      folders: cleanFolders(folders), // W6-16: [] = everywhere
      status: 'unknown',
      tools: [],
      lastError: null,
      createdAt: new Date().toISOString(),
      ...(cleanHeaderNames(keyHeaders).length ? { keyHeaders: cleanHeaderNames(keyHeaders) } : {}), // the header names the vendor's own entry asked for: suggestions for the key card
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
      if (address.slice(0, 500) !== server.url) { server.trustReadOnly = false; delete server.trustedTools; server.tools = []; server.status = 'unknown'; } // a new address is a new list
      if (address.slice(0, 500) !== server.url && server.keySet) { await dropKeyOf(server); } // K-3: a key belongs to the address it was saved for
      server.url = address.slice(0, 500);
    }
    if (patch.enabled !== undefined) server.enabled = Boolean(patch.enabled);
    if (patch.folders !== undefined) server.folders = cleanFolders(patch.folders); // W6-16: the route has already checked each folder
    // L-5: the command of a local connector can be changed (the route asks for the same confirmation as adding); trust given to the old program is gone
    if (server.type === 'local' && (patch.command !== undefined || patch.args !== undefined || patch.cwd !== undefined)) {
      const next = cleanLocal({ command: patch.command ?? server.command, args: patch.args ?? server.args, env: {}, cwd: patch.cwd !== undefined ? patch.cwd : server.cwd });
      if (next.command !== server.command || JSON.stringify(next.args) !== JSON.stringify(server.args ?? []) || (next.cwd ?? null) !== (server.cwd ?? null)) { server.trustReadOnly = false; delete server.trustedTools; }
      server.command = next.command;
      server.args = next.args;
      server.cwd = next.cwd;
      server.tools = [];
      server.status = 'unknown';
    }
    // RO-1: trust this connector's own read-only labels, for the tools it has NOW. A connector that has not listed its tools yet has nothing to trust.
    if (patch.trustReadOnly !== undefined) {
      if (patch.trustReadOnly === true) {
        if (!server.tools?.length) throw Object.assign(new Error('Check the connector first (Test), so Bunny knows what it offers, then trust its labels.'), { code: 'mcp.listFirst' });
        server.trustReadOnly = true;
        server.trustedTools = trustSnapshot(server.tools);
      } else {
        server.trustReadOnly = false;
        delete server.trustedTools;
      }
    }
    // L-4: a setting named with a value is set; named with a blank value it is cleared; a name not mentioned keeps its stored value
    if (server.type === 'local' && patch.env && typeof patch.env === 'object') {
      if (secrets && server.env && Object.keys(server.env).length) {
        try { for (const [k, v] of Object.entries(server.env)) await putSecret(id, k, String(v)); server.envNames = [...new Set([...(server.envNames ?? []), ...Object.keys(server.env)])]; delete server.env; } catch { /* the store cannot keep them yet: they stay as they are */ }
      }
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
      if (secrets && server.env && !Object.keys(server.env).length) delete server.env;
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
    if (leaving?.keySet && secrets) { try { await secrets.delete(keySecret(id)); } catch { /* already gone */ } } // K-6: the key leaves with its connector
    servers = servers.filter((s) => s.id !== id);
    await persist();
    return servers.length !== before;
  }

  async function dropKeyOf(server) {
    if (secrets) { try { await secrets.delete(keySecret(server.id)); } catch { /* already gone */ } }
    delete server.keyHeader; delete server.keyOrigin; server.keySet = false;
  }

  /** K-1/K-2: save a key for a REMOTE connector. The value is checked, put in the secret store and read back; only the header name, the origin and a flag go in mcp.json. Answers a view (no value). */
  async function setKey(id, { header, value }) {
    await load();
    if (!secrets) throw Object.assign(new Error('Bunny cannot keep a key safely on this computer right now, so it was not saved.'), { code: 'mcp.noSecretStore' });
    const server = servers.find((s) => s.id === id);
    if (!server) throw Object.assign(new Error('No such server'), { code: 'mcp.notFound' });
    if (server.type === 'local') throw Object.assign(new Error('A local connector takes its settings in the settings list, not a key.'), { code: 'mcp.notRemote' });
    const origin = originOf(server.url);
    if (!origin || !/^https:$/.test(new URL(server.url).protocol)) throw Object.assign(new Error('A key is sent only over https, so this connector\'s address must be an https address.'), { code: 'mcp.keyNeedsHttps' });
    const why = keyHeaderProblem(header, { allowed: server.keyHeaders ?? [] });
    if (why) throw Object.assign(new Error(why), { code: 'mcp.badHeader' });
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v || v.length > 4000 || /[\r\n\0]/.test(v)) throw Object.assign(new Error('The key is one line of text, up to 4,000 characters.'), { code: 'mcp.badKey' });
    await secrets.set(keySecret(id), v);
    if ((await secrets.get(keySecret(id))) !== v) { try { await secrets.delete(keySecret(id)); } catch { /* nothing kept */ } throw Object.assign(new Error('The secret store did not keep the key. Nothing was saved.'), { code: 'mcp.secretStore' }); }
    server.keyHeader = String(header); server.keyOrigin = origin; server.keySet = true;
    server.status = 'unknown'; server.lastError = null;
    await persist();
    return view(server);
  }

  async function clearKey(id) {
    await load();
    const server = servers.find((s) => s.id === id);
    if (!server) throw Object.assign(new Error('No such server'), { code: 'mcp.notFound' });
    await dropKeyOf(server);
    server.status = 'unknown';
    await persist();
    return view(server);
  }

  /** The key for a request, { header, value }, only for the exact origin it was saved for; otherwise null. Never shown, never logged. */
  async function resolveKey(id) {
    await load();
    const server = servers.find((s) => s.id === id);
    if (!server?.keySet || !secrets || server.type === 'local') return null;
    const origin = originOf(server.url);
    if (!origin || origin !== server.keyOrigin || !/^https:/.test(server.url)) return null;
    let value = null;
    try { value = await secrets.get(keySecret(id)); } catch { value = null; }
    return typeof value === 'string' && value ? { header: server.keyHeader, value } : null;
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

  return { list, get, add, update, remove, setStatus, resolveEnv, setKey, clearKey, resolveKey };
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
