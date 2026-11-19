// Real-binary smoke for Codex local mode (Builder C). Not shipped. Real pinned Codex 0.170.0, Bunny's own startCodex/endpoint/Responses translator, a scripted Chat upstream, invented project, isolated home. No account.
// node cx-smoke.mjs <absRoot> <scenario>
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 'D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/.claude/worktrees/builder-c-v0110-2c2e68/src/server/engines/';
const imp = (f) => import(pathToFileURL(W + f).href);
const { startCodex, loadSchema } = await imp('codex.js');
const { createBridge } = await imp('bridge.js');
const [root, name] = process.argv.slice(2);
const EXE = 'C:/Users/anfal/AppData/Local/Temp/claude/3bc5ac4962d09573/c41dfe1d-a4ec-47e3-82da-0644903ce364/scratchpad/ce/s2/engine/codex-x86_64-pc-windows-msvc.exe';
const run = join(root, `${name}-${Date.now()}`);
const proj = join(run, 'proj'); const home = join(run, 'home'); const data = join(run, 'data');
mkdirSync(proj, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(data, { recursive: true });
writeFileSync(join(proj, 'a.txt'), 'alpha\n'); writeFileSync(join(data, 'keys.bin'), 'SECRET');

const shell = (cmd) => ({ name: 'exec_command', args: { cmd, workdir: proj } });
const CALLS = {
  cmd: [shell('echo RAN > ran.txt')],
  none: [],
};
const script = (key) => async function* ({ chat }) {
  if (process.env.CX_DUMP) console.error('TOOLS', (chat.tools ?? []).map((t) => t.function.name).join(','), 'MSGS', chat.messages.map((m) => m.role).join(','));
  const answered = chat.messages.filter((m) => m.role === 'tool').length;
  const call = chat.tools?.length ? CALLS[key][answered] : null;
  if (call) {
    yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${answered}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3 } };
  } else {
    yield { choices: [{ index: 0, delta: { content: 'stub done' }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
  }
};
const SC = { 'cmd-allow': { calls: 'cmd', answer: true }, 'cmd-deny': { calls: 'cmd', answer: false }, 'text-only': { calls: 'none', answer: true } };
const sc = SC[name]; if (!sc) { console.error('no such scenario'); process.exit(2); }

const asked = [];
const bridge = createBridge({ mode: () => 'accept', rules: [], root: proj, protect: [data], keyFolders: [], ask: async (s, d) => { asked.push({ s, d: String(d).slice(0, 80) }); return sc.answer; } });
const events = [];
const t0 = Date.now();
const r = await startCodex({ cwd: proj, prompt: 'spike', home, exe: EXE, auth: 'local', mode: 'full', model: 'gpt-5.5', bridge: { codexCommand: (p) => bridge.codexCommand(p), codexChanges: (c) => bridge.codexChanges(c) }, upstream: script(sc.calls), schema: await loadSchema(), silenceMs: Number(process.env.CX_SILENCE) || 90_000 });
for await (const ev of r.events) events.push(ev.type === 'tool-end' ? { type: ev.type, ok: ev.ok, out: String(ev.output ?? '').slice(0, 140) } : ev.type === 'error' ? { type: 'error', code: ev.code, message: String(ev.message).slice(0, 400) } : { type: ev.type, name: ev.name });
await r.stop?.();
console.log(JSON.stringify({ scenario: name, secs: Math.round((Date.now() - t0) / 1000), ranTxt: existsSync(join(proj, 'ran.txt')), asked, events }, null, 1));
if (!process.env.KEEP) try { rmSync(run, { recursive: true, force: true }); } catch { /* left */ }
