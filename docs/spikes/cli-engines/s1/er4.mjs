// Spike ER-4 (Builder C): Claude Code's --permission-prompt-tool mcp__bunny__approve on a per-run loopback MCP server. Not shipped. Real pinned binary (2.1.311), Bunny's own modules, a scripted model behind Bunny's Messages translator.
// No account, no real model: the "model" is a scripted Chat Completions upstream. Everything throwaway lives under <root>.
// node er4.mjs <root> <scenario> [waitMs]
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 'D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/.claude/worktrees/builder-c-v0110-2c2e68/src/server/engines/';
const imp = (f) => import(pathToFileURL(W + f).href);
const { startClaude, denyRules } = await imp('claude-code.js');
const { createBridge } = await imp('bridge.js');

const [root, name, waitArg] = process.argv.slice(2);
const EXE = 'C:/Users/anfal/AppData/Local/Temp/claude/3bc5ac4962d09573/c41dfe1d-a4ec-47e3-82da-0644903ce364/scratchpad/ce/s1/engine/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe';
const run = join(root, `${name}-${Date.now()}`);
const proj = join(run, 'proj'); const home = join(run, 'home'); const data = join(proj, 'fakedata');
mkdirSync(proj, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(data, { recursive: true });
writeFileSync(join(proj, 'a.txt'), 'alpha\n'); writeFileSync(join(data, 'data.txt'), 'DATA-SECRET\n');

// the scripted model: the Nth request that offers tools answers with the Nth call; afterwards text
const CALLS = {
  bash: [{ name: 'Bash', input: { command: `echo RAN > "${join(proj, 'ran.txt').replace(/\\/g, '/')}"`, description: 'spike' } }],
  readdata: [{ name: 'Read', input: { file_path: join(data, 'data.txt') } }],
  callapprove: [{ name: 'mcp__bunny__approve', input: { tool_name: 'Bash', input: { command: `echo HACK > "${join(proj, 'hacked.txt').replace(/\\/g, '/')}"` }, tool_use_id: 'toolu_fake' } }],
  write: [{ name: 'Write', input: { file_path: join(proj, 'w.txt'), content: 'W' } }],
};
const script = (key) => async function* ({ chat }) {
  const answered = chat.messages.filter((m) => m.role === 'tool').length;
  const seq = CALLS[key] ?? [];
  const call = chat.tools?.length ? seq[answered] : null;
  if (call) {
    yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${answered}`, function: { name: call.name, arguments: JSON.stringify(call.input) } }] }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3 } };
  } else {
    yield { choices: [{ index: 0, delta: { content: 'stub done' }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
  }
};

const SC = {
  'bunny-smoke': { calls: 'bash', rules: 'bunny', decide: async () => ({ allow: true }) },
  'allow': { calls: 'bash', decide: async () => ({ allow: true }) },
  'deny': { calls: 'bash', decide: async () => ({ allow: false, reason: 'The person said no.' }) },
  'wait-allow': { calls: 'bash', decide: async () => { await new Promise((r) => setTimeout(r, Number(waitArg) || 120000)); return { allow: true }; } },
  'unanswered-limit': { calls: 'bash', limitMs: 4000, decide: async () => new Promise(() => {}) },
  'decide-throws': { calls: 'bash', decide: async () => { throw new Error('boom'); } },
  'server-closed': { calls: 'bash', decide: async (_q, run2) => { await run2.approve.close(); await new Promise((r) => setTimeout(r, 500)); return { allow: true }; } },
  'server-unreachable': { calls: 'bash', breakServerBeforeStart: true, decide: async () => ({ allow: true }) },
  'model-calls-approve': { calls: 'callapprove', decide: async () => ({ allow: true }) },
  'floor-beats-allow': { calls: 'readdata', engineRules: (p) => ({ allow: [`Read(//${p.proj.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase())}/fakedata/**)`] }), decide: async () => ({ allow: true }), floorPaths: true },
  'floor-beats-allow-hook-gone': { calls: 'readdata', engineRules: (p) => ({ allow: [`Read(//${p.proj.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase())}/fakedata/**)`] }), decide: async () => ({ allow: true }), floorPaths: true, hookGone: true },
  'owner-allow-rule': { calls: 'bash', engineRules: () => ({ allow: ['Bash(echo *)'] }), decide: async () => ({ allow: false, reason: 'must not be asked' }) },
  'owner-deny-rule': { calls: 'bash', engineRules: () => ({ deny: ['Bash(echo *)'] }), decide: async () => ({ allow: true }) },
  'owner-ask-rule': { calls: 'bash', engineRules: () => ({ ask: ['Bash(echo *)'] }), decide: async () => ({ allow: true }) },
};
const sc = SC[name]; if (!sc) { console.error('no such scenario', Object.keys(SC).join(' ')); process.exit(2); }

const floorPaths = sc.floorPaths ? [data] : [];
const bridge = createBridge({ mode: () => 'accept', rules: [], root: proj, protect: floorPaths, keyFolders: [], ask: async () => false });
const questions = [];
let handle = null;
const decide = async (q) => { questions.push({ tool: q.tool, id: q.id }); const f = await bridge.claudeAsk?.(q); if (f && f.allow === false && !f.asked) return f; return sc.decide(q, handle); };
const deny = denyRules({ rules: [], root: proj, protect: floorPaths, keyFolders: [] });
const t0 = Date.now();
const events = []; const decisions = [];
handle = await startClaude({
  cwd: proj, prompt: 'spike', home, exe: EXE, auth: 'local', upstream: script(sc.calls), rules: sc.rules ?? 'engine', engineRules: sc.engineRules ? sc.engineRules({ proj }) : { allow: [], ask: [], deny: [] },
  deny, judge: (q) => (sc.rules === 'bunny' ? bridge.claude(q) : bridge.claudeFloor(q)), onDecision: (d) => decisions.push(d), decide, approveLimitMs: sc.limitMs, silenceMs: 400_000, runtimePath: process.execPath,
  extraEnv: sc.hookGone ? {} : {},
});
if (sc.breakServerBeforeStart) await handle.approve.close();
for await (const ev of handle.events) { events.push(ev.type === 'tool-end' ? { type: ev.type, ok: ev.ok, out: String(ev.output ?? '').slice(0, 160) } : ev.type === 'error' ? { type: 'error', code: ev.code, message: String(ev.message).slice(0, 600) } : { type: ev.type, name: ev.name }); }
await handle.stop?.();
const out = {
  scenario: name, secs: Math.round((Date.now() - t0) / 1000),
  ranTxt: existsSync(join(proj, 'ran.txt')), hackedTxt: existsSync(join(proj, 'hacked.txt')), dataLeaked: events.some((e) => /DATA-SECRET/.test(JSON.stringify(e))),
  questions, hookDecisions: decisions.map((d) => ({ tool: d.tool, allow: d.allow, reason: String(d.reason ?? '').slice(0, 80) })), approveStats: handle.approve?.stats,
  events,
};
console.log(JSON.stringify(out, null, 1));
try { rmSync(run, { recursive: true, force: true }); } catch { /* left */ }
