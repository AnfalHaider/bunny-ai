// CLI-ENGINES §5.1: a scripted stand-in for an engine, for tests and the gate (no real CLI, no network, no account). Run as a program: `node fake-engine.mjs <profile> [the CLI's own arguments]`.
// The script comes from the BUNNY_FAKE_SCRIPT environment variable (JSON) or the file named by BUNNY_FAKE_SCRIPT_FILE.
//
// profile `claude-code`: speaks Claude Code's stream-json. It reads the user message on stdin, prints `system/init`, then plays the steps:
//   { say: "text" }                                  an assistant text message
//   { tool: "Read", input: {...}, skipHook?: true }  a tool_use; like Claude Code it runs the PreToolUse hook found in the --settings file (the hook command and its environment) and acts on the answer:
//                                                    allow -> a successful tool_result (and the step's `marker` file is written, to show the tool "ran"); deny -> an is_error tool_result "PreToolUse:<tool> hook error: <reason>".
//                                                    skipHook simulates a dead hook: the tool just runs.
//   { rawLine: "..." }                               a line printed as it is (malformed output tests)
//   { result: { ... } }                              the final `result` (default: success)
//   { exit: 3 }  { hang: true }                      end at once with a code / print nothing and stay alive
// Options in the script object: { tools: [...] } overrides the init tool list; { noInit: true }.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const profile = process.argv[2];
if (process.env.BUNNY_FAKE_SCRIPT || process.env.BUNNY_FAKE_SCRIPT_FILE) { try { const sc0 = JSON.parse(process.env.BUNNY_FAKE_SCRIPT_FILE ? readFileSync(process.env.BUNNY_FAKE_SCRIPT_FILE, 'utf8') : process.env.BUNNY_FAKE_SCRIPT); if (sc0.dumpEnv) writeFileSync(sc0.dumpEnv, JSON.stringify({ env: process.env, argv: process.argv.slice(2) })); } catch { /* no script */ } }
const args = process.argv.slice(3);
const script = JSON.parse(process.env.BUNNY_FAKE_SCRIPT_FILE ? readFileSync(process.env.BUNNY_FAKE_SCRIPT_FILE, 'utf8') : (process.env.BUNNY_FAKE_SCRIPT || '{"steps":[]}'));
const out = (o) => process.stdout.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (profile === 'claude-code') {
  const restricted = args.includes('--restricted');
  const settingsPath = args[args.indexOf('--settings') + 1];
  const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const hookCommand = settings?.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command;
  const sessionId = 'fake-session-1';
  const tools = script.tools ?? (restricted ? ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'ToolSearch'] : ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Bash', 'WebFetch', 'ToolSearch']);

  const runHook = (payload) => new Promise((resolve) => {
    if (!hookCommand) { resolve({ decision: 'allow' }); return; }
    const m = /^"([^"]+)"\s+"([^"]+)"$/.exec(hookCommand);
    if (!m) { resolve({ decision: 'allow', note: 'the hook command could not be read' }); return; }
    const child = spawn(m[1], [m[2]], { env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let text = ''; child.stdout.on('data', (c) => { text += c; });
    child.on('close', (code) => {
      // Claude Code's rule: exit 0 with a JSON decision is honoured; any other exit code is a NON-blocking error and the tool runs
      if (code !== 0) { resolve({ decision: 'allow', note: `the hook exited with ${code}` }); return; }
      try { const j = JSON.parse(text); if (j && typeof j === 'object' && !j.hookSpecificOutput) { resolve({ decision: 'abstain' }); return; } const d = j.hookSpecificOutput; resolve({ decision: d.permissionDecision === 'deny' ? 'deny' : 'allow', reason: d.permissionDecisionReason }); } catch { resolve({ decision: 'allow', note: 'no decision printed' }); }
    });
    child.on('error', () => resolve({ decision: 'allow', note: 'the hook could not start' }));
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload));
  });

  // Bunny's engine off: the hook has no opinion, so the engine's own rules (the settings' permissions) decide, and a question goes to the per-run prompt tool, as Claude Code does.
  const matches = (rule, tool, input) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/.exec(rule); if (!m || m[1] !== tool) return false;
    if (m[2] === undefined) return true;
    const pat = m[2].replace(/:?\*+$/, ''); const subject = String(input?.command ?? input?.file_path ?? input?.path ?? '');
    return subject.startsWith(pat);
  };
  const ownDecision = async (tool, input, id) => {
    const perms = settings?.permissions ?? {};
    if ((perms.deny ?? []).some((r) => matches(r, tool, input))) return { decision: 'deny', reason: 'Denied by a rule.' };
    if ((perms.allow ?? []).some((r) => matches(r, tool, input)) && !(perms.ask ?? []).some((r) => matches(r, tool, input))) return { decision: 'allow' };
    if (!args.includes('--permission-prompt-tool')) return { decision: 'deny', reason: 'It requires approval, and this session has no approval surface.' };
    try {
      const cfg = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')); const url = new URL(cfg.mcpServers.bunny.url);
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: tool, input, tool_use_id: id } } });
      const text = await new Promise((resolve, reject) => { const r = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { host: url.host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${process.env.BUNNY_APPROVE_TOKEN}` } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(t)); }); r.on('error', reject); r.end(body); });
      const verdict = JSON.parse(JSON.parse(text).result.content[0].text);
      return verdict.behavior === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason: verdict.message };
    } catch { return { decision: 'deny', reason: 'The prompt tool could not be reached.' }; }
  };

  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { stdin += c; if (stdin.includes('\n') && !started) { started = true; play(); } });
  process.stdin.on('end', () => { if (!started) { started = true; play(); } });
  let started = false;

  async function play() {
    if (!script.noInit) out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sessionId, tools, mcp_servers: [], model: 'fake', permissionMode: 'default', claude_code_version: '2.1.311' });
    let n = 0; let usage = { input_tokens: 10, output_tokens: 4 };
    for (const step of script.steps ?? []) {
      if (step.exit !== undefined) process.exit(step.exit);
      if (step.hang) { await sleep(60_000); continue; }
      if (step.delay) await sleep(step.delay);
      if (step.rawLine !== undefined) { out(step.rawLine); continue; }
      if (step.say !== undefined) {
        for (const part of String(step.say).match(/.{1,6}/gs) ?? []) out({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
        out({ type: 'assistant', session_id: sessionId, message: { id: `msg_${n}`, role: 'assistant', content: [{ type: 'text', text: String(step.say) }] } });
        continue;
      }
      if (step.tool) {
        n += 1; const id = step.id ?? `toolu_${n}`;
        out({ type: 'assistant', session_id: sessionId, message: { id: `msg_${n}`, role: 'assistant', content: [{ type: 'tool_use', id, name: step.tool, input: step.input ?? {} }] } });
        let verdict = { decision: 'allow' };
        if (!step.skipHook && !step.noResultId) verdict = await runHook({ hook_event_name: 'PreToolUse', tool_name: step.tool, tool_input: step.input ?? {}, tool_use_id: id, session_id: sessionId, cwd: process.cwd() });
        if (verdict.decision === 'abstain') verdict = await ownDecision(step.tool, step.input ?? {}, id);
        if (verdict.decision === 'deny') out({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: `PreToolUse:${step.tool} hook error: ${verdict.reason ?? 'denied'}` }] } });
        else {
          if (step.marker) writeFileSync(step.marker, 'the tool ran');
          const content = step.engineRefusal ? '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>' : (step.output ?? 'ok');
          out({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: step.resultId ?? id, is_error: Boolean(step.engineRefusal), content }] } });
        }
        continue;
      }
      if (step.result) { usage = step.result.usage ?? usage; }
    }
    const last = (script.steps ?? []).find((s) => s.result)?.result ?? {};
    out({ type: 'result', subtype: last.subtype ?? 'success', is_error: Boolean(last.is_error), result: last.result ?? 'done', stop_reason: 'end_turn', session_id: sessionId, usage });
    process.exit(0);
  }
} 
else if (profile === 'codex') {
  // JSON-RPC over stdio, like `codex app-server`. Steps:
  //   { say }  { command, marker?, skipApproval? }  { patch: [changes], marker?, skipApproval? }  { rawLine }  { notify: method, params }  { serverRequest: method, params }  { exit } { hang }
  // Script options: { policy: 'on-request' } makes thread/start answer with another policy; { noInit } never answers initialize.
  let buf = ''; let started = false; const waiters = new Map(); let nextServerId = 100; let threadId = 'thr-1'; let turnId = 'turn-1';
  const send = (o) => out({ jsonrpc: '2.0', ...o });
  const askServer = (method, params) => new Promise((resolve) => { const id = nextServerId++; waiters.set(id, resolve); send({ id, method, params }); });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(JSON.parse(line)); } });
  function onLine(m) {
    if (m.id !== undefined && !m.method && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); return; }
    if (m.method === 'initialize') { if (!script.noInit) send({ id: m.id, result: { userAgent: 'fake/0.170.0', codexHome: process.env.CODEX_HOME } }); process.env.FAKE_INIT_PARAMS = JSON.stringify(m.params); return; }
    if (m.method === 'initialized') return;
    if (m.method === 'thread/start') { threadId = 'thr-1'; if (script.trustProject && process.env.CODEX_HOME) writeFileSync(`${process.env.CODEX_HOME}/config.toml`, `[projects.'x']
trust_level = "trusted"
`); send({ id: m.id, result: { thread: { id: threadId }, approvalPolicy: script.policy ?? m.params.approvalPolicy, sandbox: { type: m.params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite' }, model: m.params.model ?? 'm', modelProvider: m.params.modelProvider ?? 'p', cwd: m.params.cwd } }); if (script.dumpParams) writeFileSync(script.dumpParams, JSON.stringify({ init: JSON.parse(process.env.FAKE_INIT_PARAMS ?? 'null'), thread: m.params, env: { CODEX_HOME: process.env.CODEX_HOME, BUNNY_ENGINE_TOKEN: Boolean(process.env.BUNNY_ENGINE_TOKEN) } })); return; }
    if (m.method === 'turn/start') { send({ id: m.id, result: { turn: { id: turnId, status: 'inProgress' } } }); if (!started) { started = true; play(); } return; }
    if (m.method === 'turn/interrupt') { send({ id: m.id, result: {} }); send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } }); return; }
  }
  async function play() {
    send({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress' } } });
    let n = 0;
    for (const step of script.steps ?? []) {
      if (step.exit !== undefined) process.exit(step.exit);
      if (step.hang) { await sleep(60_000); continue; }
      if (step.rawLine !== undefined) { out(step.rawLine); continue; }
      if (step.notify) { send({ method: step.notify, params: step.params ?? {} }); continue; }
      if (step.serverRequest) { const r = await askServer(step.serverRequest, step.params ?? {}); if (step.recordTo) writeFileSync(step.recordTo, JSON.stringify(r)); continue; }
      if (step.say !== undefined) {
        n += 1; const id = `msg_${n}`;
        send({ method: 'item/started', params: { threadId, turnId, item: { type: 'agentMessage', id, text: '' } } });
        for (const part of String(step.say).match(/.{1,6}/gs) ?? []) send({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: id, delta: part } });
        send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id, text: String(step.say) } } });
        continue;
      }
      if (step.command !== undefined) {
        n += 1; const id = `call_${n}`;
        const item = { type: 'commandExecution', id, command: step.command, cwd: process.cwd(), status: 'inProgress' };
        send({ method: 'item/started', params: { threadId, turnId, item } });
        let ans = { result: { decision: 'accept' } };
        if (!step.skipApproval) ans = await askServer('item/commandExecution/requestApproval', { kind: 'command', threadId, turnId, itemId: id, command: step.command, cwd: process.cwd() });
        if (step.recordTo) writeFileSync(step.recordTo, JSON.stringify(ans));
        if (ans.result?.decision === 'accept' || step.ignoreDecline) {
          if (step.marker) writeFileSync(step.marker, 'the command ran');
          send({ method: 'item/commandExecution/outputDelta', params: { threadId, turnId, itemId: id, delta: step.output ?? 'ok' } });
          send({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: 'completed', aggregatedOutput: step.output ?? 'ok', exitCode: 0 } } });
        } else send({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: 'declined' } } });
        continue;
      }
      if (step.patch) {
        n += 1; const id = `call_${n}`;
        const item = { type: 'fileChange', id, changes: step.patch, status: 'inProgress' };
        send({ method: 'item/started', params: { threadId, turnId, item } });
        let ans = { result: { decision: 'accept' } };
        if (!step.skipApproval) ans = await askServer('item/fileChange/requestApproval', { threadId, turnId, itemId: id, reason: null, grantRoot: null });
        if (step.recordTo) writeFileSync(step.recordTo, JSON.stringify(ans));
        if (ans.result?.decision === 'accept') { if (step.marker) writeFileSync(step.marker, 'the patch applied'); send({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: 'completed' } } }); }
        else send({ method: 'item/completed', params: { threadId, turnId, item: { ...item, status: 'declined' } } });
        continue;
      }
    }
    send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: { total: { inputTokens: 11, outputTokens: 5, totalTokens: 16 } } } });
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: script.turnStatus ?? 'completed', error: script.turnError ?? null } } });
    await sleep(60_000); // a server does not end by itself
  }
}
else {
  console.error(`fake-engine: unknown profile ${profile}`);
  process.exit(2);
}
