// EN-9 spike (Builder C): what does Codex 0.170.0 do after `acceptForSession`? A raw JSON-RPC driver with NO watchdog, so the whole session can be observed. Not shipped.
// Real pinned binary, Bunny's own endpoint + Responses translator, scripted Chat upstream, invented project/home/data folders, seeded sandbox home. No account.
// node cx-grant.mjs <absRoot> <seedHome>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = 'D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/.claude/worktrees/builder-c-v0110-2c2e68/src/server/engines/';
const imp = (f) => import(pathToFileURL(W + f).href);
const { buildRun, threadStartParams } = await imp('codex.js');
const { createEndpoint } = await imp('endpoint.js');
const [root, seed] = process.argv.slice(2);
const EXE = 'C:/Users/anfal/AppData/Local/Temp/claude/3bc5ac4962d09573/c41dfe1d-a4ec-47e3-82da-0644903ce364/scratchpad/ce/s2/engine/codex-x86_64-pc-windows-msvc.exe';
const run = join(root, `grant-${Date.now()}`); const proj = join(run, 'proj'); const home = join(run, 'home'); const data = join(run, 'data');
mkdirSync(proj, { recursive: true }); mkdirSync(join(home, 'codex'), { recursive: true }); mkdirSync(data, { recursive: true });
for (const f of ['cap_sid', '.sandbox_migration']) cpSync(join(seed, 'codex', f), join(home, 'codex', f));
const fwd = (p) => p.split(String.fromCharCode(92)).join('/');
const patch = (path) => ['*** Begin Patch', `*** Add File: ${path}`, '+hello', '*** End Patch'].join(String.fromCharCode(10));
const shell = (cmd) => ({ name: 'exec_command', args: { cmd, workdir: proj } });
const SEQ = [
  ['cmd1', shell('echo ONE > one.txt')],
  ['cmd1-same', shell('echo ONE > one.txt')],
  ['cmd1-other-args', shell('echo TWO > two.txt')],
  ['other-program', shell('dir')],
  ['patch-in-project', { name: 'apply_patch', args: { input: patch('p1.txt') } }],
  ['patch-floor-abs', { name: 'apply_patch', args: { input: patch(`${fwd(data)}/floor.txt`) } }],
  ['patch-floor-rel', { name: 'apply_patch', args: { input: patch('../data/floor2.txt') } }],
  ['cmd-names-floor', shell(`echo F > "${fwd(data)}/viaCmd.txt"`)],
  ['cmd1-again', shell('echo ONE > one.txt')],
];
const upstream = async function* ({ chat }) {
  const answered = chat.messages.filter((m) => m.role === 'tool').length;
  const step = chat.tools?.length ? SEQ[answered] : null;
  if (step) {
    yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${answered}`, function: { name: step[1].name, arguments: JSON.stringify(step[1].args) } }] }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3 } };
  } else {
    yield { choices: [{ index: 0, delta: { content: 'stub done' }, finish_reason: null }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
  }
};
const ep = createEndpoint({ upstream, label: 'gpt-5.5' });
const started = await ep.start();
const plan = buildRun({ exe: EXE, home, root: proj, model: 'gpt-5.5', auth: 'local', mode: 'full', endpoint: { base: started.base, token: started.token } });
writeFileSync(plan.configPath, plan.config);
const child = spawn(EXE, plan.args, { cwd: proj, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...plan.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const send = (o) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
let id = 1; const waiters = new Map(); const t0 = Date.now();
const call = (method, params) => new Promise((resolve) => { const i = id++; waiters.set(i, resolve); send({ id: i, method, params }); });
const asks = []; const items = []; let nextGrant = true; let done;
const finished = new Promise((r) => { done = r; });
let buf = '';
child.stdout.on('data', (c) => {
  buf += c; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && !m.method) { waiters.get(m.id)?.(m); waiters.delete(m.id); continue; }
    if (m.method?.endsWith('requestApproval')) {
      const p = m.params ?? {};
      const what = m.method.includes('commandExecution') ? `cmd: ${String(p.command ?? '').slice(-50)}` : `patch item ${p.itemId}`;
      const decision = nextGrant && m.method.includes('commandExecution') ? 'acceptForSession' : 'accept';
      if (decision === 'acceptForSession') nextGrant = false;
      asks.push({ t: Math.round((Date.now() - t0) / 1000), method: m.method, what, decision, keys: Object.keys(p).join(',') });
      send({ id: m.id, result: { decision } });
    } else if (m.method === 'item/completed') {
      const it = m.params?.item ?? {};
      if (['commandExecution', 'fileChange'].includes(it.type)) items.push({ t: Math.round((Date.now() - t0) / 1000), type: it.type, status: it.status, what: it.type === 'commandExecution' ? String(it.command ?? '').slice(-40) : JSON.stringify((it.changes ?? []).map((c) => c.path)).slice(0, 120) });
    } else if (m.method === 'turn/completed') done();
    else if (m.id !== undefined && m.method) send({ id: m.id, result: { decision: 'decline' } });
  }
});
child.stderr.on('data', () => {});
await call('initialize', { clientInfo: { name: 'bunny-ai', title: 'Bunny AI', version: '1' } }); send({ method: 'initialized' });
const th = await call('thread/start', threadStartParams({ cwd: proj, model: 'gpt-5.5', planMode: false, auth: 'local' }));
const threadId = th.result.thread.id;
await call('turn/start', { threadId, input: [{ type: 'text', text: 'spike' }] });
await Promise.race([finished, new Promise((r) => setTimeout(r, 240000))]);
console.log(JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), asks, items, files: { one: existsSync(join(proj, 'one.txt')), two: existsSync(join(proj, 'two.txt')), p1: existsSync(join(proj, 'p1.txt')), floorAbs: existsSync(join(data, 'floor.txt')), floorRel: existsSync(join(data, 'floor2.txt')), viaCmd: existsSync(join(data, 'viaCmd.txt')) } }, null, 1));
child.kill(); await ep.close();
if (!process.env.KEEP) { try { rmSync(run, { recursive: true, force: true }); } catch { /* left */ } }
