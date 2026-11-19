/**
 * CLI-ENGINES §3.2: the Claude Code adapter (pin 2.1.311). Everything here is what the S1 spike showed, kept as data and pure functions so the tests can hold it:
 *
 *   full mode (per-call approval) needs ALL of these layers; if any is missing the run is restricted:
 *     CE-1.7   a PreToolUse hook on every tool, wrapped so every failure it can catch is a deny
 *     CE-1.8   --permission-prompts none, --setting-sources user with an isolated empty CLAUDE_CONFIG_DIR, no permissions.allow anywhere, never bypassPermissions / acceptEdits /
 *              --dangerously-skip-permissions / --permission-prompt-tool; in Plan mode also --permission-mode plan
 *     CE-1.9   Bunny's rules copied into --settings as permissions.deny (every deny rule, hidden path, the data folder, engine homes, protected folders, key folders, AND every read-Ask path);
 *              never permissions.ask, never permissions.allow
 *     CE-1.10  the stream watchdog (every tool_use must have a bridge request from the hook before its tool_result)
 *     CE-1.11  a hook timeout above the longest an Ask card waits, and the bridge answers deny itself before that
 *   restricted mode: --restricted (no command tools, no WebFetch, file tools confined to the working folders), the same --disallowedTools, no MCP config; the staged copy and the diff review judge writes.
 */
import { join, resolve } from 'node:path';
import { createEventQueue, EngineEventError, cutResult } from './events.js';
import { HOOK_OWN_LIMIT_MS, HOOK_TIMEOUT_SECONDS } from './bridge-server.js';
import { mapClaudeCall } from './bridge.js';

export const profile = Object.freeze({
  id: 'claude-code', label: 'Claude Code', transport: 'jsonl', approvals: 'per-call', wire: 'messages', auth: ['account', 'local'], resume: true, runtime: 'native',
  recommendedAuth: 'account', recommendedReason: 'Sign in with your own Anthropic account: it is the way Anthropic supports Claude Code. Local mode is not supported by Anthropic.',
  authAvailable: Object.freeze({ account: true, local: true }),
  get expectedTools() { return EXPECTED_TOOLS; },
});

/** The tools Bunny turns off in BOTH modes (S1 addendum 3, proven; plus the agent-control tools named the same way). The subagent tool is `Agent` to the hook and `Task` in the tools list. */
export const DISALLOWED_TOOLS = Object.freeze([
  'WebSearch', 'Agent', 'Task', 'Skill', 'CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'SendMessage', 'ListAgents', 'ScheduleWakeup', 'Workflow', 'ReportFindings', 'Monitor',
]);

/** What `system/init` may list (CE-1.16): the pin's expected set. Anything else stops the run, so a renamed or new tool after an update is caught. */
export const EXPECTED_TOOLS = Object.freeze({
  full: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Bash', 'WebFetch', 'ToolSearch'],
  restricted: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'ToolSearch'],
});

/** The environment variables that switch the engine's own traffic and self-update off (S1 set-up; its proxy check saw no host but the stand-in). */
export const QUIET_ENV = Object.freeze({
  DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
});

const forward = (p) => String(p).replace(/\\/g, '/');

/** A Bunny wildcard command rule as a Claude Code Bash rule. */
const bashRule = (pattern) => `Bash(${String(pattern).trim()})`;

/**
 * The `permissions.deny` list for Bunny's settings (CE-1.9). Inputs: `rules` (permissionRules, already merged for the folder), `root` (the workspace), `protect` (data folder, engine homes, protected
 * folders: absolute), `keyFolders` (absolute), `hidden` (extra hidden absolute paths). Every read-Ask path is denied too: S1 showed a hook allow does not pass a permissions.ask read with
 * --permission-prompts none. The list has only Read(), Edit() and Bash() rules and never anything that allows.
 */
export function denyRules({ rules = [], root, protect = [], keyFolders = [], hidden = [] } = {}) {
  const out = new Set();
  // EN-3 (spike S1): on Windows Claude Code honours an absolute deny rule written as `//c/Users/...` (drive letter, no colon) or `C:/Users/...`; the form `//C:/Users/...` is NOT honoured. Both working forms are written.
  const absForms = (p) => {
    const f = forward(resolve(p));
    const m = /^([A-Za-z]):(\/.*)?$/.exec(f);
    return m ? [`//${m[1].toLowerCase()}${m[2] ?? ''}`, `${m[1].toUpperCase()}:${m[2] ?? '/'}`] : [`//${f.replace(/^\/+/, '')}`];
  };
  for (const p of [...protect, ...keyFolders, ...hidden]) {
    if (!p) continue;
    for (const form of absForms(p)) for (const tool of ['Read', 'Edit']) { out.add(`${tool}(${form})`); out.add(`${tool}(${form.replace(/\/$/, '')}/**)`); }
  }
  for (const r of rules) {
    if (!r || (r.effect !== 'deny' && !(r.effect === 'ask' && r.kind === 'path' && r.ops === 'reads'))) continue;
    if (r.kind === 'command') { if (r.effect === 'deny') out.add(bashRule(r.pattern)); continue; }
    if (r.kind === 'path') {
      const pattern = forward(r.pattern).replace(/^\.\//, '');
      const rel = `./${pattern}`;
      if (r.ops === 'reads') { out.add(`Read(${rel})`); if (!/[*?]/.test(pattern)) out.add(`Read(${rel}/**)`); }
      else if (r.effect === 'deny') { out.add(`Edit(${rel})`); if (!/[*?]/.test(pattern)) out.add(`Edit(${rel}/**)`); }
    }
  }
  void root;
  return [...out].sort();
}

/** Bunny's `--settings` file content: the hook on every tool and the deny list. No allow, no ask, no other key. */
export function buildSettings({ hookCommand, deny }) {
  return {
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand, timeout: HOOK_TIMEOUT_SECONDS }] }] },
    permissions: { deny: [...deny] },
  };
}

/** The hook command: the absolute path of Bunny's own runtime and of the script, quoted, never a bare `node` (the W29-1 lesson). The runtime runs the script as Node (ELECTRON_RUN_AS_NODE=1 is in the environment). */
export function hookCommandLine(runtimePath, hookPath) {
  const q = (p) => `"${forward(p)}"`;
  return `${q(runtimePath)} ${q(hookPath)}`;
}

/** The command line (no prompt in it): the prompt goes to stdin as stream-json. */
export function buildArgs({ mode = 'full', planMode = false, settingsPath, resumeId = null, model = null }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-prompts', 'none', '--setting-sources', 'user', '--settings', settingsPath, '--strict-mcp-config', '--disallowedTools', ...DISALLOWED_TOOLS];
  if (planMode) args.push('--permission-mode', 'plan');
  if (mode === 'restricted') args.push('--restricted');
  if (resumeId) args.push('--resume', resumeId);
  if (model) args.push('--model', model);
  return args;
}

/** The vendor's own sign-in commands, run in the account config folder only (spec 7.1). Bunny reads only the answer 'signed in or not', never the credential. */
export const AUTH_COMMANDS = Object.freeze({ status: ['auth', 'status', '--json'], login: ['auth', 'login'], logout: ['auth', 'logout'] });

/**
 * Everything one run needs: { file, args, env, settings, expectedTools }. `home` is the isolated folder for this engine, mode and chat (CLAUDE_CONFIG_DIR, and HOME/USERPROFILE/APPDATA so the person's own
 * ~\.claude is never found). Local mode carries the endpoint's address and the run's token and nothing of a vendor; account mode carries no endpoint token (§7.3).
 */
export function buildRun({ exe, home, hookPath, runtimePath, bridge, endpoint = null, auth = 'account', mode = 'full', planMode = false, resumeId = null, deny = [], model = null, usePowerShell = false, configDir = null }) {
  const settingsPath = join(home, 'bunny-settings.json');
  const settings = buildSettings({ hookCommand: hookCommandLine(runtimePath, hookPath), deny });
  const env = {
    ...QUIET_ENV,
    CLAUDE_CONFIG_DIR: configDir ?? join(home, 'config'), HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    ELECTRON_RUN_AS_NODE: '1', BUNNY_BRIDGE_PORT: String(bridge.port), BUNNY_BRIDGE_TOKEN: bridge.token, BUNNY_HOOK_LIMIT_MS: String(HOOK_OWN_LIMIT_MS),
  };
  if (auth === 'local') {
    if (!endpoint) throw new Error('Local mode needs the endpoint.');
    env.ANTHROPIC_BASE_URL = endpoint.base.replace(/\/v1$/, ''); env.ANTHROPIC_API_KEY = endpoint.token; env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  }
  if (usePowerShell) env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1';
  const tools = [...EXPECTED_TOOLS[mode === 'restricted' ? 'restricted' : 'full']];
  if (usePowerShell && mode !== 'restricted') tools.push('PowerShell');
  return { file: exe, args: buildArgs({ mode, planMode, settingsPath, resumeId, model }), env, settings, settingsPath, expectedTools: tools };
}

// ---------------------------------------------------------------- reading the stream

const TOP_TYPES = new Set(['system', 'assistant', 'user', 'result', 'stream_event', 'rate_limit_event', 'keep_alive', 'tool_progress', 'control_response']);
/** A tool_result that the ENGINE refused before running anything (validation, "no such tool", a permission it could not ask): no bridge request is expected for these (S1). */
const ENGINE_REFUSAL = /^(<tool_use_error>|Permission for this tool use was denied|Claude requested permissions|PreToolUse:[A-Za-z_]+ hook error)/;

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '');

/**
 * The reader for one run. `feed(line)` takes a stdout line and pushes events into the queue; it throws EngineEventError for anything that cannot be read (M6).
 * `bridge.seen(id)` says whether the hook asked about a tool_use id. The watchdog (CE-1.10): a tool_result for a tool that the hook never asked about means the hook is not working;
 * `onWatchdog(reason)` is called ONCE and the run must be stopped by the caller. A tool_result for an id that was never a tool_use also trips it.
 */
export function createClaudeReader({ queue = createEventQueue(), bridge, mode = 'full', expectedTools = EXPECTED_TOOLS.full, onWatchdog = () => {}, toolIsChecked = () => true } = {}) {
  const calls = new Map(); // tool_use id -> { name, input }
  let sawDelta = false; let tripped = false; let initSeen = false; let resultSeen = false;
  const trip = (reason) => { if (tripped) return; tripped = true; onWatchdog(reason); queue.push({ type: 'error', code: 'watchdog', message: reason }); };

  function onAssistant(msg) {
    const blocks = Array.isArray(msg?.message?.content) ? msg.message.content : [];
    for (const b of blocks) {
      if (b?.type === 'tool_use' && typeof b.id === 'string') {
        calls.set(b.id, { name: b.name, input: b.input });
        queue.push({ type: 'tool-start', callId: b.id, name: mapClaudeCall(b.name, b.input).name ?? 'run_command', input: b.input && typeof b.input === 'object' ? b.input : {}, engineTool: b.name });
      } else if (b?.type === 'text' && typeof b.text === 'string' && b.text && !sawDelta) queue.push({ type: 'text', delta: b.text });
      else if (b?.type === 'thinking' && typeof b.thinking === 'string' && b.thinking && !sawDelta) queue.push({ type: 'thinking', delta: b.thinking });
    }
  }
  function onUser(msg) {
    const blocks = Array.isArray(msg?.message?.content) ? msg.message.content : [];
    for (const b of blocks) {
      if (b?.type !== 'tool_result') continue;
      const id = String(b.tool_use_id ?? '');
      const call = calls.get(id);
      const body = textOf(b.content);
      if (!call) { trip('stopped: a tool finished that Bunny never saw start.'); return; }
      const refusedByEngine = Boolean(b.is_error) && ENGINE_REFUSAL.test(body);
      if (!refusedByEngine && toolIsChecked(call.name) && !bridge.seen(id)) { trip("stopped: Bunny's check did not run."); return; }
      queue.push({ type: 'tool-end', callId: id, ok: !b.is_error, output: cutResult(body, 8000) });
    }
  }

  return {
    queue,
    get tripped() { return tripped; },
    feed(line) {
      let msg;
      try { msg = JSON.parse(line); } catch { throw new EngineEventError('Claude Code sent a line that is not JSON: the run was stopped.'); }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new EngineEventError('Claude Code sent a line with no type: the run was stopped.');
      if (!TOP_TYPES.has(msg.type)) throw new EngineEventError(`Claude Code sent an event of a kind Bunny does not know ("${msg.type.slice(0, 30)}"): the run was stopped.`);
      if (typeof msg.session_id === 'string' && msg.session_id && !calls.has('__session')) { calls.set('__session', true); queue.push({ type: 'session', engineSessionId: msg.session_id }); }
      if (msg.type === 'system' && msg.subtype === 'init') {
        initSeen = true;
        const listed = Array.isArray(msg.tools) ? msg.tools.map(String) : null;
        if (!listed) throw new EngineEventError('Claude Code did not list its tools: the run was stopped.');
        const allowed = new Set(expectedTools);
        const extra = listed.filter((t) => !allowed.has(t) && !t.startsWith('mcp__bunny'));
        if (extra.length) throw new EngineEventError(`Claude Code offers a tool Bunny does not expect (${extra.slice(0, 3).join(', ')}): the run was stopped.`);
        if (mode === 'restricted' && listed.some((t) => ['Bash', 'PowerShell', 'WebFetch'].includes(t))) throw new EngineEventError('Claude Code offers a command tool in restricted mode: the run was stopped.');
      } else if (msg.type === 'stream_event') {
        const d = msg.event?.delta;
        if (d?.type === 'text_delta' && typeof d.text === 'string') { sawDelta = true; queue.push({ type: 'text', delta: d.text }); }
        else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') { sawDelta = true; queue.push({ type: 'thinking', delta: d.thinking }); }
      } else if (msg.type === 'assistant') { onAssistant(msg); sawDelta = false; }
      else if (msg.type === 'user') onUser(msg);
      else if (msg.type === 'result') {
        resultSeen = true;
        const u = msg.usage ?? {};
        queue.push({ type: 'usage', input: Number(u.input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0), output: Number(u.output_tokens ?? 0) });
        if (msg.is_error || String(msg.subtype ?? '').startsWith('error')) queue.push({ type: 'error', code: 'engine', message: cutResult(String(msg.result ?? msg.subtype ?? 'The engine ended with an error.'), 600) });
        else queue.push({ type: 'done', stopReason: String(msg.stop_reason ?? msg.subtype ?? 'end_turn') });
      }
    },
    /** Called when the process has ended: a run that never printed `system/init` or a `result` is an error (M6). */
    ended({ code, stderr = '' }) {
      if (tripped) { queue.end(); return; }
      if (!initSeen) queue.push({ type: 'error', code: 'engine.start', message: `Claude Code did not start (${cutResult(stderr.trim() || `exit code ${code}`, 300)}).` });
      else if (!resultSeen && !queue.hadError) queue.push({ type: 'error', code: 'engine.ended', message: 'Claude Code stopped before it finished.' });
      queue.end();
    },
  };
}

// ---------------------------------------------------------------- one run

import { mkdir, writeFile } from 'node:fs/promises';
import { createBridgeServer } from './bridge-server.js';
import { hookIntact, writeHook } from './hook-script.js';
import { killTree, spawnEngine } from './process.js';
import { createBridge } from './bridge.js';

/**
 * Start one Claude Code run. Resolves { events, stop(), bridge } once the process has been started; events end with `done` or `error`.
 *
 * `judge({ tool, input, id, agent })` is the bridge's decision (createBridge(...).claude). `launcher` is an optional program and arguments put in front of the CLI's own (tests run a fake engine
 * through node). The prompt goes to stdin as one stream-json user message and never on the command line (CE-8). On stop, on a watchdog trip, on an error, and at the end the whole process tree is killed
 * and the bridge listener is closed: no engine process outlives its run.
 */
export async function startClaude({ cwd, prompt, home, exe, runtimePath = process.execPath, auth = 'account', endpoint = null, mode = 'full', planMode = false, resumeId = null, deny = [], judge, onDecision = null, signal = null, usePowerShell = false, model = null, launcher = null, silenceMs = 0, extraEnv = {}, configDir = null }) {
  const queue = createEventQueue();
  const bridgeServer = createBridgeServer({ judge, onDecision });
  const { port } = await bridgeServer.start();
  let run = null; let stopped = false;
  const finish = async () => { await bridgeServer.close().catch(() => {}); };
  try {
    await mkdir(configDir ?? join(home, 'config'), { recursive: true });
    const hook = await writeHook(join(home, 'hook'));
    if (!(await hookIntact(hook.path))) throw new Error('The check script could not be written.');
    const plan = buildRun({ exe, home, hookPath: hook.path, runtimePath, bridge: { port, token: bridgeServer.token }, endpoint, auth, mode, planMode, resumeId, deny, model, usePowerShell, configDir });
    await writeFile(plan.settingsPath, JSON.stringify(plan.settings, null, 1), { mode: 0o600 });
    const file = launcher ? launcher[0] : plan.file;
    const args = launcher ? [...launcher.slice(1), plan.file, ...plan.args] : plan.args;
    run = spawnEngine({ file, args, cwd, extraEnv: { ...plan.env, ...extraEnv } });
  } catch (err) { await finish(); throw err; }

  const reader = createClaudeReader({ queue, bridge: bridgeServer, mode, expectedTools: planExpected(mode, usePowerShell), onWatchdog: () => { stopped = true; run.kill(); } });
  const stop = async () => { stopped = true; try { run.end(); } catch { /* ended */ } await run.kill(); };
  signal?.addEventListener?.('abort', () => { stop(); }, { once: true });
  run.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: String(prompt) }] } })}\n`);

  (async () => {
    let timer = null;
    const arm = () => { if (!silenceMs) return; clearTimeout(timer); timer = setTimeout(() => { if (!stopped) { stopped = true; queue.push({ type: 'error', code: 'silent', message: 'Claude Code printed nothing for too long: the run was stopped.' }); run.kill(); } }, silenceMs); };
    arm();
    try {
      for await (const line of run.lines) {
        arm();
        reader.feed(line);
        if (reader.tripped) break;
        // a `result` ends the turn: close stdin so the process ends by itself
        if (line.includes('"type":"result"')) run.end();
      }
    } catch (err) {
      queue.push({ type: 'error', code: err.code ?? 'engine.event', message: err.message });
      stopped = true;
      await run.kill();
    }
    clearTimeout(timer);
    const code = await Promise.race([run.exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (code === null) await run.kill();
    reader.ended({ code, stderr: run.stderr() });
    await finish();
  })();

  return { events: queue, stop, bridge: bridgeServer, pid: run.child.pid, get stopped() { return stopped; } };
}

const planExpected = (mode, usePowerShell) => { const t = [...EXPECTED_TOOLS[mode === 'restricted' ? 'restricted' : 'full']]; if (usePowerShell && mode !== 'restricted') t.push('PowerShell'); return t; };

export { createBridge, killTree };
