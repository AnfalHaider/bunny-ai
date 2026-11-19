/**
 * CLI-ENGINES §3.2: the Codex adapter (pin 0.170.0), full mode with CE-1.12 to CE-1.17. All of it is what spike S2 showed:
 *
 *   CE-1.12  approval_policy is ALWAYS "untrusted" (never on-request, never, granular: with the sandbox on those ask for nothing), no capabilities.experimentalApi, and Bunny answers accept or
 *            decline (cancel on Stop), NEVER acceptForSession. item/permissions/requestApproval, applyPatchApproval and execCommandApproval are always declined.
 *   CE-1.13  item/commandExecution/requestApproval is judged as run_command on its text; item/fileChange/requestApproval is judged per path (the paths come from the item/started that came first).
 *   CE-1.14  features.view_image=false (it reads outside the folder with no ask, even under untrusted) and apps, plugins, remote_plugin, plugin_sharing, tool_suggest, computer_use, image_generation,
 *            goals, hooks off; web_search="disabled" (without these Codex reached github.com and chatgpt.com).
 *   CE-1.15  CODEX_HOME/config.toml is REWRITTEN at every run start with trust_level = "untrusted" for the project (a first run would write "trusted", which loads the project's own config, hooks and rules),
 *            check_for_update_on_startup=false, analytics.enabled=false, thread/start {ephemeral: true}.
 *   CE-1.16  windows.sandbox="unelevated" (writes only; never elevated), readOnly in Plan mode; a fixed model name per pin; the offered tools must be exactly exec_command, write_stdin, apply_patch,
 *            request_user_input and tool_search (checked at the model endpoint, on the request).
 *   CE-1.17  the watchdog: a commandExecution or fileChange item that runs (outputs, or completes) without an accepted approval for that item stops the run at once.
 *   Restricted mode adds features.shell_tool=false, features.unified_exec=false: only apply_patch, request_user_input and tool_search are left; the staged copy and the diff review still apply.
 */
import { join } from 'node:path';
import { createEventQueue, EngineEventError, cutResult } from './events.js';
import { mapCodexChanges } from './bridge.js';
import { createEndpoint } from './endpoint.js';
import { killTree, spawnEngine } from './process.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const profile = Object.freeze({
  id: 'codex', label: 'Codex CLI', transport: 'json-rpc', approvals: 'per-call', wire: 'responses', auth: ['local', 'account'], resume: true, runtime: 'native',
  recommendedAuth: 'local', recommendedReason: 'Local uses your own models through Bunny. Signing in with a ChatGPT account is not available yet.',
  authAvailable: Object.freeze({ local: true, account: false }),
  get expectedTools() { return EXPECTED_TOOLS; },
});

/** What config.toml turns off in BOTH modes (CE-1.14). */
export const FEATURES_OFF = Object.freeze(['apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'tool_suggest', 'computer_use', 'image_generation', 'goals', 'hooks', 'view_image']);
/** Restricted mode turns the command tools off too. */
export const RESTRICTED_FEATURES_OFF = Object.freeze(['shell_tool', 'unified_exec']);

/** The tools Codex may offer the model (CE-1.16). */
export const EXPECTED_TOOLS = Object.freeze({ full: ['exec_command', 'write_stdin', 'apply_patch', 'request_user_input', 'tool_search'], restricted: ['apply_patch', 'request_user_input', 'tool_search'] });

/** The tool-list check for the endpoint: true, or the sentence for the refusal. */
export function toolListCheck(mode) {
  const allowed = new Set(EXPECTED_TOOLS[mode === 'restricted' ? 'restricted' : 'full']);
  return (names) => {
    const extra = names.filter((n) => !allowed.has(n));
    return extra.length ? `Codex offered a tool Bunny does not allow: ${extra.slice(0, 3).join(', ')}.` : true;
  };
}

const toml = (v) => (typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
const tomlKey = (p) => `'${String(p).toLowerCase().replace(/\\/g, '\\').replace(/'/g, '')}'`;

/**
 * The text of CODEX_HOME/config.toml for one run. Local mode points Codex at Bunny's endpoint (`[model_providers.bunny]`, the token read from the environment by name, no OpenAI account);
 * account mode leaves the model alone (Codex's own sign-in). Never a `trust_level = "trusted"`: the project is written as untrusted.
 */
/** The real path of the project (links, short 8.3 names and case resolved), so the config's project entry names the folder Codex will really see. */
export async function canonicalRoot(root) {
  const { realpath } = await import('node:fs/promises');
  try { return await realpath(root); } catch { return root; }
}

export function configToml({ root, model, auth = 'local', mode = 'full', baseUrl = null }) {
  const lines = ['# Written by Bunny AI at every run start. Do not edit.'];
  if (auth === 'local') {
    lines.push(`model_provider = ${toml('bunny')}`, `model = ${toml(model)}`);
  }
  lines.push('check_for_update_on_startup = false', `web_search = ${toml('disabled')}`);
  if (auth === 'account') lines.push(`cli_auth_credentials_store = ${toml('file')}`); // the sign-in stays in a file inside the isolated CODEX_HOME, never the system credential store
  lines.push('');
  lines.push('[analytics]', 'enabled = false', '');
  lines.push('[windows]', `sandbox = ${toml('unelevated')}`, '');
  lines.push('[features]');
  for (const f of [...FEATURES_OFF, ...(mode === 'restricted' ? RESTRICTED_FEATURES_OFF : [])]) lines.push(`${f} = false`);
  lines.push('');
  if (auth === 'local') {
    if (!baseUrl) throw new Error('Local mode needs the endpoint address.');
    lines.push('[model_providers.bunny]', `name = ${toml('Bunny AI')}`, `base_url = ${toml(baseUrl)}`, `env_key = ${toml('BUNNY_ENGINE_TOKEN')}`, `wire_api = ${toml('responses')}`, 'requires_openai_auth = false', '');
  }
  lines.push(`[projects.${tomlKey(root)}]`, `trust_level = ${toml('untrusted')}`, '');
  return lines.join('\n');
}

/**
 * EN-2 / CE-1.15, after the run: Codex may have written `trust_level = "trusted"` for the project into config.toml (a writable thread does when there is no entry). If it did, put the
 * untrusted entry back at once (so the project's own config, hooks and rules never load next time) and say so. Returns { fixed: boolean }.
 */
export async function ensureUntrusted(configPath, rewrite) {
  let text = '';
  try { text = await readFile(configPath, 'utf8'); } catch { return { fixed: false }; }
  if (!/trust_level\s*=\s*"trusted"/.test(text)) return { fixed: false };
  await writeFile(configPath, rewrite, { mode: 0o600 });
  return { fixed: true };
}

/** The run's command line and environment. The token goes by environment only (CE-4.3); the home is isolated; the person's own ~\.codex is never found. */
export function buildRun({ exe, home, root, model, auth = 'local', mode = 'full', endpoint = null }) {
  const config = configToml({ root, model, auth, mode, baseUrl: endpoint?.base ?? null });
  const env = { CODEX_HOME: join(home, 'codex'), HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local') };
  if (auth === 'local') { if (!endpoint) throw new Error('Local mode needs the endpoint.'); env.BUNNY_ENGINE_TOKEN = endpoint.token; }
  return { file: exe, args: ['app-server'], env, config, configPath: join(home, 'codex', 'config.toml') };
}

/** `thread/start` parameters: ALWAYS untrusted and ephemeral, the pinned model name, and a sandbox that confines writes (read-only in Plan mode). */
export function threadStartParams({ cwd, model, planMode = false, auth = 'local' }) {
  const params = { cwd, approvalPolicy: 'untrusted', sandbox: planMode ? 'read-only' : 'workspace-write', ephemeral: true };
  if (auth === 'local') { params.model = model; params.modelProvider = 'bunny'; }
  return params;
}

// ---------------------------------------------------------------- the pinned protocol

/** Method names from the pinned schema (kept beside the pin): a server request or notification outside them ends the run. */
export async function loadSchema(file = fileURLToPath(new URL('./schemas/codex-app-server-0.170.0.json', import.meta.url))) {
  const j = JSON.parse(await readFile(file, 'utf8'));
  return { requests: new Set(j.serverRequests), notifications: new Set(j.serverNotifications), clientRequests: new Set(j.clientRequests) };
}

const IGNORED_NOTIFICATIONS = /^(configWarning|warning|remoteControl\/|thread\/(status|started|name|goal|archived|unarchived|closed|compacted|metadata|realtime|tokenUsage)|account\/|mcpServer\/|skills\/|app\/|fs\/|hook\/|turn\/(diff|plan)|item\/(reasoning|plan|fileChange\/outputDelta|commandExecution\/(terminalInteraction)|mcpToolCall|autoApprovalReview|guardian)|model\/|externalAgentConfig|windows\/|deprecation|serverRequest\/resolved|command\/exec|fuzzyFileSearch|rawResponseItem|configChanged|guardianWarning|process\/)/;

// ---------------------------------------------------------------- the driver

/**
 * Drives one Codex `app-server` conversation. `send(obj)` writes a JSON-RPC line to Codex. `judgeCommand(params)` and `judgeChanges(changes)` are the bridge's decisions ({ allow, reason, summary }).
 * `feed(line)` reads one line from Codex. The driver keeps what the watchdog needs: the changes of each fileChange item (they arrive in item/started, before the approval request) and the set
 * of item ids Bunny accepted. Anything unknown, malformed or out of order ends the run (M6); `onWatchdog(reason)` is called once for CE-1.17.
 */
export function createCodexDriver({ send, judgeCommand, judgeChanges, schema, queue = createEventQueue(), onWatchdog = () => {}, planMode = false } = {}) {
  const pending = new Map(); let nextId = 1;
  const items = new Map(); const accepted = new Set(); const declined = new Set();
  let tripped = false; let finished = false; let usage = { input: 0, output: 0 }; let threadId = null; let turnId = null; const textOpen = new Map();

  const request = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject, method }); send({ jsonrpc: '2.0', id, method, params }); });
  const notify = (method, params) => send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const refuseRequest = (id, why) => send({ jsonrpc: '2.0', id, error: { code: -32000, message: why } });
  const trip = (reason) => { if (tripped) return; tripped = true; onWatchdog(reason); queue.push({ type: 'error', code: 'watchdog', message: reason }); };
  const fail = (message) => { if (tripped) return; tripped = true; queue.push({ type: 'error', code: 'engine.event', message }); onWatchdog(message); };

  async function onServerRequest(msg) {
    const { id, method, params } = msg;
    if (schema && !schema.requests.has(method)) { fail(`Codex asked for something Bunny does not know ("${String(method).slice(0, 40)}"): the run was stopped.`); refuseRequest(id, 'Unknown request'); return; }
    if (method === 'item/commandExecution/requestApproval') {
      const verdict = await judgeCommand(params ?? {});
      if (verdict.allow) accepted.add(params?.itemId); else declined.add(params?.itemId);
      queue.push({ type: 'approval', requestId: String(params?.itemId ?? id), name: 'run_command' });
      reply(id, { decision: verdict.allow ? 'accept' : 'decline' });
    } else if (method === 'item/fileChange/requestApproval') {
      const item = items.get(params?.itemId);
      const verdict = item?.changes ? await judgeChanges(item.changes) : { allow: false, reason: 'The file change could not be read.' };
      if (verdict.allow) accepted.add(params?.itemId); else declined.add(params?.itemId);
      queue.push({ type: 'approval', requestId: String(params?.itemId ?? id), name: 'edit_file' });
      reply(id, { decision: verdict.allow ? 'accept' : 'decline' });
    } else if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
      reply(id, { decision: 'denied' });
    } else if (method === 'mcpServer/elicitation/request') {
      reply(id, { action: 'decline' });
    } else {
      // item/permissions/requestApproval, item/tool/requestUserInput, item/tool/call, account refresh, attestation: always declined
      refuseRequest(id, 'Bunny does not allow this.');
    }
  }

  function onItem(kind, item) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') throw new EngineEventError('Codex sent an item with no id: the run was stopped.');
    const type = item.type;
    if (type === 'commandExecution' || type === 'fileChange') {
      if (kind === 'started') {
        items.set(item.id, item);
        const mapped = type === 'fileChange' ? mapCodexChanges(item.changes) : [{ name: 'run_command', command: item.command }];
        queue.push({ type: 'tool-start', callId: item.id, name: mapped[0]?.name ?? 'run_command', input: type === 'fileChange' ? { paths: (item.changes ?? []).map((c) => c?.path).filter(Boolean) } : { command: String(item.command ?? '') }, engineTool: type });
        return;
      }
      const ran = item.status === 'completed' || item.status === 'failed';
      if (ran && !accepted.has(item.id)) { trip("stopped: Bunny's check did not run."); return; } // EN-1: also an item Bunny DECLINED that Codex reports as completed
      if (item.status === 'declined' || declined.has(item.id)) { queue.push({ type: 'tool-end', callId: item.id, ok: false, output: 'Not allowed.' }); return; }
      if (type === 'fileChange') for (const c of item.changes ?? []) if (typeof c?.path === 'string') queue.push({ type: 'edit', path: c.path });
      queue.push({ type: 'tool-end', callId: item.id, ok: item.status === 'completed' && !(item.exitCode > 0), output: cutResult(item.aggregatedOutput ?? item.output ?? '', 8000) });
      return;
    }
    if (type === 'agentMessage' && kind === 'completed' && !textOpen.has(item.id) && typeof item.text === 'string' && item.text) queue.push({ type: 'text', delta: item.text });
    // reasoning, user messages, others: nothing to show
  }

  function onNotification(msg) {
    const { method, params } = msg;
    if (schema && !schema.notifications.has(method)) { fail(`Codex sent an event of a kind Bunny does not know ("${String(method).slice(0, 40)}"): the run was stopped.`); return; }
    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') { textOpen.set(params.itemId, true); queue.push({ type: 'text', delta: params.delta }); return; }
    if (method === 'item/commandExecution/outputDelta') {
      if (!accepted.has(params?.itemId)) { trip("stopped: Bunny's check did not run."); return; }
      return;
    }
    if (method === 'item/started') { onItem('started', params?.item); return; }
    if (method === 'item/completed') { onItem('completed', params?.item); return; }
    if (method === 'thread/tokenUsage/updated') { const t = params?.tokenUsage?.total; if (t) usage = { input: Number(t.inputTokens ?? 0), output: Number(t.outputTokens ?? 0) }; return; }
    if (method === 'turn/completed') {
      finished = true;
      const status = params?.turn?.status;
      queue.push({ type: 'usage', input: usage.input, output: usage.output });
      if (status === 'failed') queue.push({ type: 'error', code: 'engine', message: cutResult(String(params?.turn?.error?.message ?? params?.turn?.error ?? 'The turn failed.'), 600) });
      else queue.push({ type: 'done', stopReason: status === 'interrupted' ? 'interrupted' : 'end_turn' });
      return;
    }
    if (method === 'error') { queue.push({ type: 'error', code: 'engine', message: cutResult(String(params?.error?.message ?? params?.message ?? 'Codex reported an error.'), 600) }); return; }
    if (IGNORED_NOTIFICATIONS.test(method) || method === 'turn/started' || method === 'serverRequest/resolved') return;
    // a known name in the schema that Bunny has no use for: ignored; with no schema loaded (tests) an unknown one is an error
    if (!schema) fail(`Codex sent an event of a kind Bunny does not know ("${String(method).slice(0, 40)}"): the run was stopped.`);
  }

  return {
    queue,
    get tripped() { return tripped; },
    get finished() { return finished; },
    get threadId() { return threadId; },
    request, notify,
    /** The handshake and the turn: initialize (no experimentalApi), initialized, thread/start, turn/start. */
    async begin({ cwd, prompt, model, planMode: plan = planMode, auth = 'local' }) {
      const init = await request('initialize', { clientInfo: { name: 'bunny-ai', title: 'Bunny AI', version: '1' } });
      if (init?.error) throw new EngineEventError('Codex did not accept the start.');
      notify('initialized');
      const thread = await request('thread/start', threadStartParams({ cwd, model, planMode: plan, auth }));
      threadId = thread?.result?.thread?.id;
      if (!threadId) throw new EngineEventError('Codex did not start a conversation.');
      const policy = thread.result.approvalPolicy;
      if (policy !== 'untrusted') throw new EngineEventError('Codex did not take the ask-for-everything setting: the run was stopped.');
      queue.push({ type: 'session', engineSessionId: String(threadId) });
      const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: String(prompt) }] });
      turnId = turn?.result?.turn?.id ?? null;
    },
    interrupt() { if (threadId) notify_turn_interrupt(); },
    /** One line from Codex. Throws EngineEventError for anything unreadable. */
    async feed(line) {
      let msg;
      try { msg = JSON.parse(line); } catch { throw new EngineEventError('Codex sent a line that is not JSON: the run was stopped.'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new EngineEventError('Codex sent a line that is not a message: the run was stopped.');
      if (msg.id !== undefined && msg.method) { await onServerRequest(msg); return; }
      if (msg.id !== undefined && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); p.resolve(msg); return; }
      if (msg.method) { onNotification(msg); return; }
      if (msg.id !== undefined) return; // an answer nobody waits for
      throw new EngineEventError('Codex sent a message Bunny cannot read: the run was stopped.');
    },
    failPending(reason) { for (const p of pending.values()) p.reject(new EngineEventError(reason)); pending.clear(); },
    get turnId() { return turnId; },
  };
  function notify_turn_interrupt() { request('turn/interrupt', { threadId, ...(turnId ? { turnId } : {}) }).catch(() => {}); }
}

// ---------------------------------------------------------------- one run

/**
 * Start one Codex run. `judge` is the bridge (createBridge): { codexCommand(params), codexChanges(changes) }. In local mode `upstream` serves the model endpoint. Resolves { events, stop(), endpoint }.
 */
export async function startCodex({ cwd, prompt, home, exe, auth = 'local', mode = 'full', planMode = false, model, bridge, upstream = null, endpointOptions = {}, signal = null, launcher = null, silenceMs = 0, extraEnv = {}, schema = null, onEndpointUsage = null }) {
  const queue = createEventQueue();
  let plan = null;
  let stopped = false; let endpoint = null; let run = null; let driver = null; let started = null;
  const closeEndpoint = async () => { await endpoint?.close().catch(() => {}); };
  try {
    if (auth === 'local') {
      endpoint = createEndpoint({ upstream, label: model ?? 'bunny', onUsage: onEndpointUsage, onToolList: (names) => { const v = toolListCheck(mode)(names); if (v !== true && driver) { driver.queue.push({ type: 'error', code: 'engine.tools', message: v }); stopRun(); } return v; }, ...endpointOptions });
      started = await endpoint.start();
    }
    plan = buildRun({ exe, home, root: await canonicalRoot(cwd), model, auth, mode, endpoint: started ? { base: started.base, token: started.token } : null });
    await mkdir(join(home, 'codex'), { recursive: true });
    await writeFile(plan.configPath, plan.config, { mode: 0o600 });
    const file = launcher ? launcher[0] : plan.file;
    const args = launcher ? [...launcher.slice(1), plan.file, ...plan.args] : plan.args;
    run = spawnEngine({ file, args, cwd, extraEnv: { ...plan.env, ...extraEnv } });
  } catch (err) { await closeEndpoint(); throw err; }

  async function stopRun() { stopped = true; try { driver?.interrupt(); } catch { /* going down */ } try { run.end(); } catch { /* ended */ } await run.kill(); }
  driver = createCodexDriver({ queue, planMode, schema, send: (o) => run.write(`${JSON.stringify(o)}\n`), judgeCommand: (p) => bridge.codexCommand(p), judgeChanges: (c) => bridge.codexChanges(c), onWatchdog: () => { stopped = true; run.kill(); } });
  signal?.addEventListener?.('abort', () => { stopRun(); }, { once: true });

  (async () => {
    let timer = null;
    const arm = () => { if (!silenceMs) return; clearTimeout(timer); timer = setTimeout(() => { if (!stopped) { stopped = true; queue.push({ type: 'error', code: 'silent', message: 'Codex printed nothing for too long: the run was stopped.' }); run.kill(); } }, silenceMs); };
    arm();
    const reading = (async () => {
      for await (const line of run.lines) {
        arm();
        await driver.feed(line);
        if (driver.tripped || driver.finished) break; // app-server is a server: it does not end by itself, so Bunny ends it when the turn is over
      }
    })();
    let failure = null;
    const handshake = driver.begin({ cwd, prompt, model, planMode, auth }).catch(async (err) => { failure ??= err; stopped = true; await run.kill(); });
    try { await reading; } catch (err) { failure ??= err; stopped = true; await run.kill(); }
    if (failure && !driver.tripped) queue.push({ type: 'error', code: failure.code ?? 'engine.event', message: failure.message });
    else if (!failure && !driver.tripped && !driver.finished && !stopped && !queue.hadError) queue.push({ type: 'error', code: 'engine.ended', message: 'Codex stopped before the turn was finished.' });
    clearTimeout(timer);
    driver.failPending('closed');
    await handshake;
    try { run.end(); } catch { /* ended */ }
    await run.kill();
    await Promise.race([run.exited, new Promise((r) => setTimeout(r, 3000))]);
    if (!queue.ended) queue.end();
    await closeEndpoint();
    try { const fixed = await ensureUntrusted(plan.configPath, plan.config); if (fixed.fixed) queue.afterNote = 'Codex marked the project as trusted while it ran. Bunny set it back to untrusted, so the project own Codex settings are still never loaded.'; } catch { /* the next run rewrites it anyway */ }
  })();

  return { events: queue, stop: stopRun, endpoint, pid: run.child.pid, get stopped() { return stopped; } };
}

export { killTree };
