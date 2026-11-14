/**
 * Bunny AI application server.
 *
 * Owns everything a browser cannot do safely: holding secrets, talking to
 * providers, and persisting transcripts. Zero dependencies.
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProviderRegistry } from '../providers/connections.js';
import { findProvider } from '../providers/catalog.js';
import { startDeviceFlow, waitForToken } from '../providers/oauth.js';
import { dpapiSecretStore } from '../providers/secretStore.js';
import { ConnectError } from '../providers/errors.js';
import { offlineProbe, offlineDiscover } from '../providers/offline.js';
import { createSessionStore } from './sessions.js';
import { createProjectStore } from './projects.js';
import { createArtifactStore } from './artifacts.js';
import { normaliseAttachments, toModelMessage } from './attachments.js';
import { parseImport } from './import.js';
import { createUsageStore } from './usage.js';
import { createUnavailableStore, modelSpecificFailure, affordableTokens, notProvisioned } from './unavailable.js';
import { appVersion, checkForUpdate } from './updates.js';
import { suggestMemories } from './suggestions.js';
import { createMemoryStore } from './memory.js';
import { createMcpStore } from './mcpStore.js';
import { createScheduleStore } from './scheduler.js';
import { createHookStore, EVENTS as HOOK_EVENTS } from './hooks.js';
import { createSkillStore } from './skills.js';
import { listTools as mcpListTools, callTool as mcpCallTool, toToolDefinitions, toolPrefix } from './mcp.js';
import { createComputerStore } from './computer.js';
import { createTerminalStore } from './terminal.js';
import { streamChat } from './chat.js';

// The project root, found from this file rather than the working directory, so the
// server also finds its UI when it runs inside the packaged desktop app.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Only the UI directory is public. Secrets and transcripts live in the data
// directory, but there is no reason to expose source files either.
const UI_ROOT = normalize(join(ROOT, 'src', 'ui'));
const MAX_BODY = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ConnectError('request.tooLarge', 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ConnectError('request.invalidJson', 'Body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ dataDir: string, fake?: boolean, secretStore?: any, probe?: any, discover?: any }} options
 */
export async function createApp({ dataDir, fake = process.env.BUNNY_FAKE_UPSTREAM === '1', secretStore, probe, discover } = {}) {
  await mkdir(dataDir, { recursive: true });

  const secrets = secretStore ?? dpapiSecretStore({ dir: join(dataDir, 'secrets') });
  const connectionsFile = join(dataDir, 'connections.json');
  const settingsFile = join(dataDir, 'settings.json');

  // Test mode has to be usable end to end, otherwise it only proves the page
  // renders. It gets offline stand-ins for the two network calls, so connect +
  // pick a model + chat works with no provider and no key.
  const offline = fake
    ? { probe: offlineProbe, discover: offlineDiscover }
    : {};

  const registry = createProviderRegistry({
    secrets,
    ...offline,
    ...(probe ? { probe } : {}),
    ...(discover ? { discover } : {}),
  });
  const sessions = createSessionStore({ dir: join(dataDir, 'sessions') });
  const projects = createProjectStore({ file: join(dataDir, 'projects.json') });
  const artifacts = createArtifactStore({ dir: join(dataDir, 'artifacts') });
  const usage = createUsageStore({ file: join(dataDir, 'usage.json') });
  const unavailable = createUnavailableStore({ file: join(dataDir, 'unavailable.json') });
  // Sign-in flows waiting for a person to finish. In memory only: a device
  // code is a short-lived secret and has no business on disk.
  const oauthFlows = new Map();
  const memory = createMemoryStore({ file: join(dataDir, 'memory.json') });
  const mcp = createMcpStore({ file: join(dataDir, 'mcp.json') });
  const schedules = createScheduleStore({ file: join(dataDir, 'schedules.json') });
  const hooks = createHookStore({ file: join(dataDir, 'hooks.json') });
  const skills = createSkillStore({ file: join(dataDir, 'skills.json') });
  const computer = createComputerStore();
  const terminals = createTerminalStore();


  registry.hydrate(await readJson(connectionsFile, []));
  let settings = await readJson(settingsFile, {
    providerId: null,
    model: null,
    theme: 'system',
    aliases: {},        // short name -> real model id
    allowlist: [],      // model ids the picker is allowed to offer
  });

  /** Resolve an alias to the model it stands for. */
  function resolveModel(model) {
    if (!model) return model;
    const aliases = settings.aliases ?? {};
    return aliases[model] ?? model;
  }

  /** The models the picker may offer, honouring the allowlist. */
  function allowedModels(models) {
    const allowlist = settings.allowlist ?? [];
    if (!allowlist.length) return models;
    const set = new Set(allowlist.map((id) => resolveModel(id)));
    return models.filter((m) => set.has(m.id));
  }

  async function persistConnections() {
    const rows = registry
      .list()
      .filter((p) => p.status === 'connected')
      .map((p) => ({ id: p.id, baseUrl: p.baseUrl, maskedKey: p.maskedKey, keyVerified: p.keyVerified, connectedAt: p.connectedAt }));
    await writeJson(connectionsFile, rows);
  }

  /**
   * The context window of a model, when the provider says. The meter and the
   * automatic compaction both work from this number, so a small-window model
   * is compacted long before a large-window one.
   */
  async function modelContextLimit(providerId, model) {
    try {
      const models = await registry.models(providerId);
      const found = models.find((m) => m.id === model);
      return found?.contextLength ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Run the hooks waiting for an event.
   *
   * A hook is a command, so it is run in a shell and its output is kept. It
   * never blocks the chat: a failing hook is recorded and the chat carries on.
   */
  async function runHooks(event, payload = {}) {
    const waiting = await hooks.forEvent(event);
    for (const hook of waiting) {
      try {
        const output = await runCommand(hook.command, {
          BUNNY_EVENT: event,
          BUNNY_PAYLOAD: JSON.stringify(payload).slice(0, 4000),
        });
        await hooks.markRun(hook.id, output);
      } catch (err) {
        await hooks.markRun(hook.id, `failed: ${err.message}`);
      }
    }
    return waiting.length;
  }

  /** Run a command line and return what it printed. */
  function runCommand(command, env = {}) {
    return new Promise((resolve, reject) => {
      exec(command, {
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...env },
      }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
          return;
        }
        resolve(`${stdout ?? ''}${stderr ?? ''}`.trim());
      });
    });
  }

  /**
   * Run the schedules that are due.
   *
   * Each one is an ordinary chat: it is stored like any other conversation, so
   * the result can be read later.
   */
  async function runDueSchedules() {
    const due = await schedules.due();
    const results = [];
    for (const schedule of due) {
      try {
        const providerId = schedule.providerId ?? settings.providerId;
        const model = schedule.model ?? settings.model;
        if (!providerId || !model) {
          await schedules.markRun(schedule.id, 'no provider or model chosen');
          continue;
        }
        const provider = registry.list().find((p) => p.id === providerId);
        if (!provider || provider.status !== 'connected') {
          await schedules.markRun(schedule.id, 'the provider is not connected');
          continue;
        }
        const session = await sessions.create({ title: schedule.name, providerId, model });
        await sessions.append(session.id, { role: 'user', content: schedule.prompt });
        const history = [{ role: 'user', content: schedule.prompt }];
        const apiKey = await secrets.get(`provider:${providerId}`);
        let assembled = '';
        for await (const delta of streamChat({
          baseUrl: provider.baseUrl, apiKey: apiKey ?? undefined, model, messages: history, fake,
        })) {
          assembled += delta;
        }
        await sessions.append(session.id, { role: 'assistant', content: assembled });
        await schedules.markRun(schedule.id, assembled.slice(0, 500));
        results.push({ schedule: schedule.id, session: session.id, text: assembled });
      } catch (err) {
        await schedules.markRun(schedule.id, `failed: ${err.message}`);
      }
    }
    return results;
  }

  /** All models across connected providers, for the picker. */
  async function allModels({ refresh = false } = {}) {
    const connected = registry.list().filter((p) => p.status === 'connected');
    const out = [];
    for (const provider of connected) {
      try {
        const models = await registry.models(provider.id, { refresh });
        const known = await unavailable.forProvider(provider.id);
        for (const m of models) {
          out.push({
            providerId: provider.id,
            providerName: provider.name,
            ...m,
            // Models this account cannot reach are marked, not hidden: the
            // person may fix the account and want them back.
            unavailable: known[m.id]?.reason ?? null,
          });
        }
      } catch {
        // One dead provider must not empty the picker.
      }
    }
    return allowedModels(out);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const method = req.method ?? 'GET';

    if (path === '/api/health') return sendJson(res, 200, { ok: true, fake });

    if (path === '/api/providers' && method === 'GET') {
      return sendJson(res, 200, registry.list());
    }

    const connectMatch = path.match(/^\/api\/providers\/([a-z0-9-]+)\/connect$/);
    if (connectMatch && method === 'POST') {
      try {
        const body = await readBody(req);
        const result = await registry.connect(connectMatch[1], body);
        await persistConnections();
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'connect.failed', message: err.message, field: err.field });
      }
    }

    const disconnectMatch = path.match(/^\/api\/providers\/([a-z0-9-]+)\/disconnect$/);
    if (disconnectMatch && method === 'POST') {
      try {
        const result = await registry.disconnect(disconnectMatch[1]);
        await persistConnections();
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'disconnect.failed', message: err.message });
      }
    }

    const modelsMatch = path.match(/^\/api\/providers\/([a-z0-9-]+)\/models$/);
    if (modelsMatch && method === 'GET') {
      try {
        const models = await registry.models(modelsMatch[1], { refresh: url.searchParams.get('refresh') === '1' });
        return sendJson(res, 200, models);
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'models.failed', message: err.message });
      }
    }

    if (path === '/api/models' && method === 'GET') {
      const models = await allModels({ refresh: url.searchParams.get('refresh') === '1' });
      return sendJson(res, 200, models);
    }

    // Model ability labels, for the picker to group by ability.
    if (path === '/api/abilities' && method === 'GET') {
      const { PROVIDERS } = await import('../providers/catalog.js');
      return sendJson(res, 200, PROVIDERS.map((p) => ({ id: p.id, name: p.name, abilities: p.abilities ?? [] })));
    }

    if (path === '/api/settings' && method === 'GET') return sendJson(res, 200, settings);
    if (path === '/api/settings' && method === 'PUT') {
      const body = await readBody(req);
      settings = { ...settings, ...body };
      await writeJson(settingsFile, settings);
      return sendJson(res, 200, settings);
    }

    // ---- version and updates ----
    if (path === '/api/version' && method === 'GET') {
      return sendJson(res, 200, { version: await appVersion(), updateUrl: settings.updateUrl ?? '' });
    }
    if (path === '/api/update/check' && method === 'POST') {
      const result = await checkForUpdate({ url: settings.updateUrl ?? '' });
      return sendJson(res, 200, result);
    }

    // ---- usage ----
    if (path === '/api/usage' && method === 'GET') {
      return sendJson(res, 200, { providers: await usage.list(), total: await usage.total() });
    }
    if (path === '/api/usage' && method === 'DELETE') {
      await usage.reset();
      return sendJson(res, 200, { ok: true });
    }

    // ---- import ----
    if (path === '/api/import' && method === 'POST') {
      const body = await readBody(req);
      const content = String(body.content ?? '');
      if (!content.trim()) {
        return sendJson(res, 400, { code: 'import.empty', message: 'There is nothing to import' });
      }
      const parsed = parseImport(content, { title: body.title ?? null });
      if (!parsed.messages.length) {
        return sendJson(res, 400, {
          code: 'import.nothingFound',
          message: parsed.notes[0] ?? 'No messages were found in that file.',
        });
      }
      const session = await sessions.create({
        title: parsed.title || body.title || 'Imported chat',
        providerId: body.providerId ?? settings.providerId,
        model: body.model ?? settings.model,
        messages: parsed.messages,
      });
      return sendJson(res, 200, { session, imported: parsed.messages.length });
    }

    // ---- sessions ----
    if (path === '/api/sessions' && method === 'GET') {
      const rows = await sessions.list({
        includeArchived: url.searchParams.get('archived') === '1',
        q: url.searchParams.get('q') ?? '',
        projectId: url.searchParams.get('projectId'),
      });
      return sendJson(res, 200, rows);
    }
    if (path === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      const session = await sessions.create(body);
      await runHooks('chat.created', { sessionId: session.id, title: session.title });
      return sendJson(res, 200, session);
    }

    /** Search runs over titles and message bodies. */
    if (path === '/api/search' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      if (!q.trim()) return sendJson(res, 200, []);
      return sendJson(res, 200, await sessions.list({ includeArchived: true, q }));
    }

    // ---- projects ----
    if (path === '/api/projects' && method === 'GET') return sendJson(res, 200, await projects.list());
    if (path === '/api/projects' && method === 'POST') {
      try {
        return sendJson(res, 200, await projects.create(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'project.failed', message: err.message });
      }
    }
    const projectMatch = path.match(/^\/api\/projects\/([a-f0-9-]{36})$/);
    if (projectMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await projects.update(projectMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'project.failed', message: err.message });
      }
    }
    if (projectMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await projects.remove(projectMatch[1]) });
    }

    // ---- artifacts ----
    if (path === '/api/artifacts' && method === 'GET') {
      return sendJson(res, 200, await artifacts.list({ sessionId: url.searchParams.get('sessionId') }));
    }
    if (path === '/api/artifacts' && method === 'POST') {
      try {
        return sendJson(res, 200, await artifacts.create(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'artifact.failed', message: err.message });
      }
    }
    const artifactMatch = path.match(/^\/api\/artifacts\/([a-f0-9-]{36})$/);
    if (artifactMatch && method === 'GET') {
      const artifact = await artifacts.get(artifactMatch[1]);
      return artifact ? sendJson(res, 200, artifact) : sendJson(res, 404, { code: 'artifact.notFound', message: 'No such artifact' });
    }
    if (artifactMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await artifacts.update(artifactMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'artifact.failed', message: err.message });
      }
    }
    if (artifactMatch && method === 'DELETE') {
      await artifacts.remove(artifactMatch[1]);
      return sendJson(res, 200, { ok: true });
    }
    const artifactRawMatch = path.match(/^\/api\/artifacts\/([a-f0-9-]{36})\/raw$/);
    if (artifactRawMatch && method === 'GET') {
      const artifact = await artifacts.get(artifactRawMatch[1]);
      if (!artifact) return sendJson(res, 404, { code: 'artifact.notFound', message: 'No such artifact' });
      const current = artifact.versions.at(-1);
      const type = artifact.kind === 'html' ? 'text/html; charset=utf-8'
        : artifact.kind === 'markdown' ? 'text/markdown; charset=utf-8'
          : 'text/plain; charset=utf-8';
      res.writeHead(200, { 'content-type': type });
      return res.end(current?.content ?? '');
    }

    const restoreMatch = path.match(/^\/api\/artifacts\/([a-f0-9-]{36})\/restore$/);
    if (restoreMatch && method === 'POST') {
      const body = await readBody(req);
      try {
        return sendJson(res, 200, await artifacts.restore(restoreMatch[1], Number(body.version ?? -1)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'artifact.failed', message: err.message });
      }
    }

    // ---- memory ----
    if (path === '/api/memory' && method === 'GET') {
      return sendJson(res, 200, await memory.list());
    }
    if (path === '/api/memory' && method === 'POST') {
      try {
        return sendJson(res, 200, await memory.add(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'memory.failed', message: err.message });
      }
    }
    if (path === '/api/memory/suggestions' && method === 'POST') {
      const body = await readBody(req);
      const session = body.sessionId ? await sessions.get(body.sessionId) : null;
      const messages = session?.messages ?? (Array.isArray(body.messages) ? body.messages : []);
      const suggestions = suggestMemories(messages);
      const known = new Set((await memory.list()).map((m) => m.text.toLowerCase()));
      return sendJson(res, 200, suggestions.filter((s) => !known.has(s.text.toLowerCase())));
    }
    const memoryMatch = path.match(/^\/api\/memory\/([a-f0-9-]{36})$/);
    if (memoryMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await memory.update(memoryMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'memory.failed', message: err.message });
      }
    }
    if (memoryMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await memory.remove(memoryMatch[1]) });
    }

    // ---- MCP servers ----
    if (path === '/api/mcp' && method === 'GET') return sendJson(res, 200, await mcp.list());
    if (path === '/api/mcp' && method === 'POST') {
      try {
        return sendJson(res, 200, await mcp.add(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'mcp.failed', message: err.message });
      }
    }
    const mcpMatch = path.match(/^\/api\/mcp\/([a-f0-9-]{36})$/);
    if (mcpMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await mcp.update(mcpMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'mcp.failed', message: err.message });
      }
    }
    if (mcpMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await mcp.remove(mcpMatch[1]) });
    }
    const mcpToolsMatch = path.match(/^\/api\/mcp\/([a-f0-9-]{36})\/tools$/);
    if (mcpToolsMatch && method === 'GET') {
      const server = await mcp.get(mcpToolsMatch[1]);
      if (!server) return sendJson(res, 404, { code: 'mcp.notFound', message: 'No such server' });
      try {
        const tools = await mcpListTools(server);
        await mcp.setStatus(server.id, { status: 'connected', tools, error: null });
        return sendJson(res, 200, { status: 'connected', tools });
      } catch (err) {
        await mcp.setStatus(server.id, { status: 'error', error: err.message });
        return sendJson(res, 502, { code: err.code ?? 'mcp.failed', message: err.message });
      }
    }
    const mcpCallMatch = path.match(/^\/api\/mcp\/([a-f0-9-]{36})\/call$/);
    if (mcpCallMatch && method === 'POST') {
      const server = await mcp.get(mcpCallMatch[1]);
      if (!server) return sendJson(res, 404, { code: 'mcp.notFound', message: 'No such server' });
      const body = await readBody(req);
      try {
        const result = await mcpCallTool(server, { name: body.name, arguments: body.arguments ?? {} });
        return sendJson(res, 200, { result });
      } catch (err) {
        return sendJson(res, 502, { code: err.code ?? 'mcp.failed', message: err.message });
      }
    }

    // ---- schedules ----
    if (path === '/api/schedules' && method === 'GET') return sendJson(res, 200, await schedules.list());
    if (path === '/api/schedules' && method === 'POST') {
      try {
        return sendJson(res, 200, await schedules.add(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'schedule.failed', message: err.message });
      }
    }
    const scheduleMatch = path.match(/^\/api\/schedules\/([a-f0-9-]{36})$/);
    if (scheduleMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await schedules.update(scheduleMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'schedule.failed', message: err.message });
      }
    }
    if (scheduleMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await schedules.remove(scheduleMatch[1]) });
    }

    // ---- hooks ----
    if (path === '/api/hooks' && method === 'GET') return sendJson(res, 200, await hooks.list());
    if (path === '/api/hooks' && method === 'POST') {
      try {
        return sendJson(res, 200, await hooks.add(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'hook.failed', message: err.message });
      }
    }
    const hookMatch = path.match(/^\/api\/hooks\/([a-f0-9-]{36})$/);
    if (hookMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await hooks.update(hookMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'hook.failed', message: err.message });
      }
    }
    if (hookMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await hooks.remove(hookMatch[1]) });
    }

    // ---- skills ----
    if (path === '/api/skills' && method === 'GET') return sendJson(res, 200, await skills.list());
    if (path === '/api/skills' && method === 'POST') {
      try {
        return sendJson(res, 200, await skills.add(await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'skill.failed', message: err.message });
      }
    }
    const skillMatch = path.match(/^\/api\/skills\/([a-f0-9-]{36})$/);
    if (skillMatch && method === 'PATCH') {
      try {
        return sendJson(res, 200, await skills.update(skillMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'skill.failed', message: err.message });
      }
    }
    if (skillMatch && method === 'DELETE') {
      return sendJson(res, 200, { ok: await skills.remove(skillMatch[1]) });
    }

    // ---- sign-in (OAuth device flow) ----

    // ---- computer use ----
    if (path.startsWith('/api/computer/') && settings.computerUseEnabled === false) {
      return sendJson(res, 403, { code: 'computer.disabled', message: 'Computer use is switched off in Settings, Capabilities.' });
    }
    if (path === '/api/computer/screenshot' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      if (!sessionId) return sendJson(res, 400, { code: 'computer.sessionRequired', message: 'sessionId is required' });
      try {
        const result = await computer.screenshot(sessionId);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }
    if (path === '/api/computer/click' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      const x = Number(body.x);
      const y = Number(body.y);
      const button = String(body.button ?? 'left');
      const count = Number(body.count ?? 1);
      if (!sessionId || !Number.isFinite(x) || !Number.isFinite(y)) {
        return sendJson(res, 400, { code: 'computer.invalid', message: 'sessionId, x and y are required' });
      }
      try {
        const result = await computer.click(sessionId, { x, y, button, count });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }
    if (path === '/api/computer/type' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      const text = String(body.text ?? '');
      if (!sessionId) return sendJson(res, 400, { code: 'computer.sessionRequired', message: 'sessionId is required' });
      try {
        const result = await computer.type(sessionId, { text });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }
    if (path === '/api/computer/key' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      const keys = Array.isArray(body.keys) ? body.keys : [String(body.key ?? '')];
      if (!sessionId || !keys.length) return sendJson(res, 400, { code: 'computer.invalid', message: 'sessionId and keys are required' });
      try {
        const result = await computer.key(sessionId, { keys });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }
    if (path === '/api/computer/wait' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      const ms = Number(body.ms ?? 1000);
      if (!sessionId) return sendJson(res, 400, { code: 'computer.sessionRequired', message: 'sessionId is required' });
      try {
        const result = await computer.wait(sessionId, { ms });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }
    if (path === '/api/computer/reset' && method === 'POST') {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? '');
      if (!sessionId) return sendJson(res, 400, { code: 'computer.sessionRequired', message: 'sessionId is required' });
      try {
        const result = await computer.reset(sessionId);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'computer.failed', message: err.message });
      }
    }

    // ---- terminal ----
    if (path === '/api/terminal/create' && method === 'POST') {
      const body = await readBody(req);
      try {
        const result = terminals.create({
          shell: String(body.shell ?? 'powershell.exe'),
          cwd: String(body.cwd ?? process.cwd()),
          rows: Number(body.rows ?? 40),
          cols: Number(body.cols ?? 120),
        });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { code: 'terminal.failed', message: err.message });
      }
    }
    if (path === '/api/terminal/write' && method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id ?? '');
      const text = String(body.text ?? '');
      if (!id) return sendJson(res, 400, { code: 'terminal.invalid', message: 'id is required' });
      try {
        terminals.write(id, text);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 404, { code: 'terminal.notFound', message: err.message });
      }
    }
    if (path === '/api/terminal/read' && method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      if (!id) return sendJson(res, 400, { code: 'terminal.invalid', message: 'id is required' });
      try {
        const result = terminals.read(id);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 404, { code: 'terminal.notFound', message: err.message });
      }
    }
    if (path === '/api/terminal/resize' && method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id ?? '');
      try {
        const result = terminals.resize(id, { rows: body.rows, cols: body.cols });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 404, { code: 'terminal.notFound', message: err.message });
      }
    }
    if (path === '/api/terminal/kill' && method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id ?? '');
      if (!id) return sendJson(res, 400, { code: 'terminal.invalid', message: 'id is required' });
      terminals.kill(id);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/terminal/list' && method === 'GET') {
      return sendJson(res, 200, { terminals: terminals.list() });
    }

    // ---- session settings (folder, branch, permission mode, effort) ----
    const sessionSettingMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/setting\/([a-z-]+)$/);
    if (sessionSettingMatch && method === 'PATCH') {
      try {
        const session = await sessions.update(sessionSettingMatch[1], { [sessionSettingMatch[2]]: (await readBody(req)).value });
        return sendJson(res, 200, { ...session, context: sessions.context(session) });
      } catch (err) {
        return sendJson(res, 404, { code: 'session.failed', message: err.message });
      }
    }

    // ---- sign-in (OAuth device flow) ----
    const oauthStartMatch = path.match(/^\/api\/oauth\/([a-z0-9-]+)\/start$/);
    if (oauthStartMatch && method === 'POST') {
      const provider = findProvider(oauthStartMatch[1]);
      if (!provider) return sendJson(res, 404, { code: 'unknownProvider', message: 'No such provider' });
      if (provider.kind !== 'oauth') {
        return sendJson(res, 400, { code: 'oauth.notApplicable', message: `${provider.name} is connected with a key` });
      }
      try {
        const flow = await startDeviceFlow(provider);
        // The device code is held in memory only: it is a short-lived secret.
        oauthFlows.set(provider.id, { ...flow, startedAt: Date.now() });
        return sendJson(res, 200, {
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          verificationUriComplete: flow.verificationUriComplete,
          interval: flow.interval,
          expiresIn: flow.expiresIn,
        });
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'oauth.failed', message: err.message });
      }
    }

    const oauthFinishMatch = path.match(/^\/api\/oauth\/([a-z0-9-]+)\/finish$/);
    if (oauthFinishMatch && method === 'POST') {
      const provider = findProvider(oauthFinishMatch[1]);
      if (!provider) return sendJson(res, 404, { code: 'unknownProvider', message: 'No such provider' });
      const body = await readBody(req);

      // A token can be pasted in, or the device flow can be waited out.
      let token = String(body.token ?? '').trim();
      if (!token) {
        const flow = oauthFlows.get(provider.id);
        if (!flow) {
          return sendJson(res, 400, { code: 'oauth.notStarted', message: 'Start the sign-in first' });
        }
        try {
          const result = await waitForToken(provider, flow.deviceCode, {
            interval: flow.interval,
            expiresIn: Math.min(flow.expiresIn, 300),
          });
          token = result.token ?? '';
        } catch (err) {
          oauthFlows.delete(provider.id);
          return sendJson(res, 400, { code: err.code ?? 'oauth.failed', message: err.message });
        }
      }
      if (!token) {
        return sendJson(res, 400, { code: 'oauth.noToken', message: 'The provider did not give a token' });
      }
      oauthFlows.delete(provider.id);
      try {
        const result = await registry.connectWithToken(provider.id, token);
        await persistConnections();
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'oauth.failed', message: err.message });
      }
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})$/);
    if (sessionMatch && method === 'GET') {
      const session = await sessions.get(sessionMatch[1]);
      return session
        ? sendJson(res, 200, { ...session, context: sessions.context(session) })
        : sendJson(res, 404, { code: 'session.notFound', message: 'No such session' });
    }
    if (sessionMatch && method === 'PATCH') {
      try {
        const session = await sessions.update(sessionMatch[1], await readBody(req));
        return sendJson(res, 200, { ...session, context: sessions.context(session) });
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'session.failed', message: err.message });
      }
    }
    if (sessionMatch && method === 'DELETE') {
      await sessions.remove(sessionMatch[1]);
      return sendJson(res, 200, { ok: true });
    }

    const forkMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/fork$/);
    if (forkMatch && method === 'POST') {
      try {
        return sendJson(res, 200, await sessions.fork(forkMatch[1], await readBody(req)));
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'fork.failed', message: err.message });
      }
    }

    const compactMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/compact$/);
    if (compactMatch && method === 'POST') {
      try {
        const result = await sessions.compact(compactMatch[1]);
        return sendJson(res, 200, {
          ok: true,
          summary: result.session.messages[0]?.content ?? '',
          before: result.before,
          after: result.after,
        });
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'compact.failed', message: err.message });
      }
    }

    const exportMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/export$/);
    if (exportMatch && method === 'GET') {
      const wanted = url.searchParams.get('format') === 'json' ? 'json' : 'markdown';
      try {
        const result = await sessions.exportSession(exportMatch[1]);
        const body = result[wanted];
        const ext = wanted === 'json' ? 'json' : 'md';
        const type = wanted === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8';
        res.writeHead(200, {
          'content-type': type,
          'content-disposition': `attachment; filename="${result.session.id}.${ext}"`,
        });
        return res.end(body);
      } catch (err) {
        return sendJson(res, 404, { code: err.code ?? 'export.failed', message: err.message });
      }
    }

    const messageItemMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/messages\/([a-f0-9-]{36})$/);
    if (messageItemMatch && method === 'PATCH') {
      const body = await readBody(req);
      try {
        const session = await sessions.editMessage(messageItemMatch[1], messageItemMatch[2], body.content);
        return sendJson(res, 200, { ...session, context: sessions.context(session) });
      } catch (err) {
        const status = err.code === 'message.notFound' ? 404 : 400;
        return sendJson(res, status, { code: err.code ?? 'message.failed', message: err.message });
      }
    }
    if (messageItemMatch && method === 'DELETE') {
      try {
        const session = await sessions.truncateFrom(messageItemMatch[1], messageItemMatch[2]);
        return sendJson(res, 200, { ...session, context: sessions.context(session) });
      } catch (err) {
        const status = err.code === 'message.notFound' ? 404 : 400;
        return sendJson(res, status, { code: err.code ?? 'message.failed', message: err.message });
      }
    }

    const messageMatch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/messages$/);
    if (messageMatch && method === 'POST') {
      const id = messageMatch[1];
      let session = await sessions.get(id);
      if (!session) return sendJson(res, 404, { code: 'session.notFound', message: 'No such session' });

      const body = await readBody(req);
      const retry = body.retry === true;
      const content = String(body.content ?? '').trim();
      if (!retry && !content) return sendJson(res, 400, { code: 'message.empty', message: 'Message cannot be empty' });
      if (retry && !session.messages.length) {
        return sendJson(res, 400, { code: 'message.empty', message: 'There is nothing to retry yet' });
      }

      let attachments = [];
      try {
        attachments = normaliseAttachments(body.attachments);
      } catch (err) {
        return sendJson(res, 400, { code: err.code ?? 'attachment.invalid', message: err.message });
      }

      const providerId = body.providerId ?? session.providerId ?? settings.providerId;
      const model = resolveModel(body.model ?? session.model ?? settings.model);
      if (!providerId || !model) {
        return sendJson(res, 400, { code: 'model.notSelected', message: 'Choose a provider and model first' });
      }

      const provider = registry.list().find((p) => p.id === providerId);
      if (!provider || provider.status !== 'connected') {
        return sendJson(res, 400, { code: 'provider.notConnected', message: 'That provider is not connected' });
      }

      // Compact automatically before the window fills, so a long thread keeps
      // working instead of failing at the provider's limit.
      const compacted = await sessions.compactIfFull(id).catch(() => null);

      if (!retry) await sessions.append(id, { role: 'user', content, attachments });
      await runHooks('message.sent', { sessionId: id, content });
      await sessions.update(id, {
        providerId,
        model,
        contextLimit: await modelContextLimit(providerId, model),
      });
      session = await sessions.get(id);

      // Project instructions ride in front of the transcript, never into it.
      const project = session.projectId ? await projects.get(session.projectId) : null;
      const history = session.messages.map((m) => toModelMessage(m));
      if (project?.instructions) {
        history.unshift({ role: 'system', content: `Project instructions for ${project.name}:\n${project.instructions}` });
      }
      // Memory and skills are standing context, and are never stored as turns.
      const memoryText = settings.memoryEnabled === false ? null : await memory.context();
      if (memoryText) history.unshift({ role: 'system', content: memoryText });
      // Settings, Capabilities: skills and connectors can be switched off for every chat.
      const skillText = settings.skillsEnabled === false ? null : await skills.context();
      if (skillText) history.unshift({ role: 'system', content: skillText });

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      // Tools from the MCP servers the person has switched on.
      const servers = settings.connectorsEnabled === false ? [] : (await mcp.list()).filter((s) => s.enabled);
      const toolDefinitions = [];
      const toolIndex = new Map();
      for (const server of servers) {
        const prefix = toolPrefix(server.name);
        for (const tool of server.tools ?? []) {
          const definition = toToolDefinitions([tool], { prefix })[0];
          toolDefinitions.push(definition);
          toolIndex.set(definition.function.name, { server, tool });
        }
      }
      const runTool = async ({ name, arguments: args }) => {
        const entry = toolIndex.get(name);
        if (!entry) throw new Error(`There is no tool called ${name}`);
        let parsed = {};
        try { parsed = JSON.parse(args || '{}'); } catch { parsed = {}; }
        const result = await mcpCallTool(entry.server, { name: entry.tool.name, arguments: parsed });
        return JSON.stringify(result ?? null).slice(0, 8000);
      };

      // When the person presses Stop, the browser closes the connection. What
      // already arrived is kept, so a stopped reply is still a reply.
      const controller = new AbortController();
      let clientGone = false;
      res.on('close', () => {
        if (!res.writableEnded) clientGone = true;
        controller.abort();
      });

      let assembled = '';
      let maxTokens = Number(settings.maxTokens) || 4096;
      const apiKey = await secrets.get(`provider:${providerId}`);

      // Two things can be wrong with a first attempt, and both are worth one
      // more go: a model that is not provisioned for this account yet, and a
      // request that asks for more tokens than the balance covers.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          if (attempt === 1 && compacted) send('compacted', { before: compacted.before, after: compacted.after });
          for await (const delta of streamChat({
            baseUrl: provider.baseUrl,
            apiKey: apiKey ?? undefined,
            model,
            messages: history,
            fake,
            signal: controller.signal,
            tools: toolDefinitions,
            runTool,
            maxTokens,
            auth: provider.auth ?? null,
          })) {
            assembled += delta;
            send('delta', { text: delta });
          }

          if (clientGone) {
            // Stopped: keep what arrived, and do not pretend there was a reply
            // when nothing had arrived yet.
            if (assembled.trim()) {
              await sessions.append(id, { role: 'assistant', content: assembled, kind: 'partial' });
            }
          } else {
            const savedSession = await sessions.append(id, { role: 'assistant', content: assembled });
            session = await sessions.get(id);
            send('done', { sessionId: id, model, messageId: savedSession.messages.at(-1)?.id, context: sessions.context(session) });
          }
          await usage.record({
            providerId,
            model,
            messages: [{ role: 'user', content }, { role: 'assistant', content: assembled }],
          });
          break;
        } catch (err) {
          if (clientGone) {
            if (assembled.trim()) {
              await sessions.append(id, { role: 'assistant', content: assembled, kind: 'partial' });
            }
            break;
          }

          // The provider said how many tokens the balance covers: ask for
          // that many and try again.
          const affordable = affordableTokens(err.message);
          if (attempt === 1 && affordable && affordable < maxTokens) {
            maxTokens = affordable;
            continue;
          }

          // Nvidia provisions a model on first use: the first call answers
          // "not found for account" and a short wait later the same call
          // works. One retry before giving up on the model.
          if (attempt === 1 && notProvisioned(err.message)) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }

          // Some providers publish models their account cannot reach. When
          // that is the reason, remember it so the picker can say so next
          // time instead of offering it again.
          const shape = modelSpecificFailure(err.message);
          if (shape) await unavailable.mark(providerId, model, err.message);
          send('error', {
            code: err.code ?? 'chat.failed',
            message: err.message,
            modelUnavailable: Boolean(shape),
          });
          break;
        }
      }
      res.end();
      return;
    }

    /**
     * One-shot completion with no storage. This is what incognito mode uses:
     * the transcript lives in the page, so nothing incognito can reach disk.
     */
    if (path === '/api/complete' && method === 'POST') {
      const body = await readBody(req);
      const providerId = body.providerId ?? settings.providerId;
      const model = body.model ?? settings.model;
      if (!providerId || !model) {
        return sendJson(res, 400, { code: 'model.notSelected', message: 'Choose a provider and model first' });
      }
      const provider = registry.list().find((p) => p.id === providerId);
      if (!provider || provider.status !== 'connected') {
        return sendJson(res, 400, { code: 'provider.notConnected', message: 'That provider is not connected' });
      }
      const messages = Array.isArray(body.messages)
        ? body.messages
          .filter((m) => m && ['user', 'assistant', 'system'].includes(m.role))
          .map((m) => ({ role: m.role, content: String(m.content ?? '') }))
        : [];
      if (!messages.length) return sendJson(res, 400, { code: 'message.empty', message: 'Message cannot be empty' });

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      let assembled = '';
      try {
        const apiKey = await secrets.get(`provider:${providerId}`);
        for await (const delta of streamChat({
          baseUrl: provider.baseUrl, apiKey: apiKey ?? undefined, model, messages, fake,
        })) {
          assembled += delta;
          send('delta', { text: delta });
        }
        send('done', { model, incognito: true, context: { used: Math.ceil(assembled.length / 4), limit: 200_000 } });
      } catch (err) {
        send('error', { code: err.code ?? 'chat.failed', message: err.message });
      } finally {
        res.end();
      }
      return;
    }

    // --- static files (the UI ships as plain files; nothing else is exposed) ---
    if (path === '/') {
      res.writeHead(302, { location: '/src/ui/index.html' }).end();
      return;
    }

    if (!path.startsWith('/src/ui/')) {
      res.writeHead(404).end('not found');
      return;
    }

    const target = normalize(join(UI_ROOT, path.slice('/src/ui'.length)));
    if (target !== UI_ROOT && !target.startsWith(UI_ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { code: 'server.error', message: err.message });
      else res.end();
    });
  });

  return {
    server, registry, sessions, projects, artifacts, memory, mcp, schedules, hooks, skills, usage,
    computer, terminals,
    getSettings: () => settings,
    dataDir,
    runHooks,
    runDueSchedules,
  };
}
