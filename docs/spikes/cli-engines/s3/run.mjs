// Spike S3 driver (Cline 3.0.74, pinned). Not Bunny code.
// node run.mjs <spikeRoot> <scenario>...   spikeRoot holds engine/ (npm install --ignore-scripts of the pin) and receives runs/.
// Cline runs headless (`--json --auto-approve false`) against a stand-in OpenAI-compatible endpoint that asks for scripted tool calls.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const [root, ...names] = process.argv.slice(2);
const CLINE = join(root, 'engine', 'node_modules', '@cline', 'cli-windows-x64', 'bin', 'cline.exe');
const NODE = process.execPath;
const SECRET = 'SECRET-S3-4be01d'; const CANARY = 'CANARY-S3-a91c72f0';
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

// Tool names are Cline's own; filled in from the discovery run (x-discover shows the list the model is offered).
const TOOLS = (p) => ({
  readSecret: { name: 'read_files', arguments: { files: [{ path: join(p.proj, 'secret.txt') }] } },
  readCanary: { name: 'read_files', arguments: { files: [{ path: p.canary }] } },
  run: { name: 'run_commands', arguments: { commands: ['Set-Content -LiteralPath ran.txt -Value CMD-MARKER'] } },
  write: { name: 'editor', arguments: { path: join(p.proj, 'written.txt'), new_text: 'WRITTEN-MARKER' } },
  writeOutside: { name: 'editor', arguments: { path: join(p.outside, 'planted.txt'), new_text: 'PLANTED-MARKER' } },
  fetch: { name: 'fetch_web_content', arguments: { requests: [{ url: `http://127.0.0.1:${p.port}/fetched`, prompt: 'summarise' }] } },
  search: { name: 'search_codebase', arguments: { queries: ['SECRET-S3'] } },
  agent: { name: 'spawn_agent', arguments: { systemPrompt: 'spike', task: 'read the secret' } },
  ask: { name: 'ask_question', arguments: { question: 'ok?', options: ['yes', 'no'] } },
});

const SCENARIOS = {
  'x-discover': { calls: [], hookMode: 'log' },
  'z-acp-reject': { calls: ['readSecret', 'run', 'write'], hookMode: 'allow', acp: true, decide: 'reject' },
  'z-acp-allow': { calls: ['readSecret', 'run', 'write'], hookMode: 'allow', acp: true, decide: 'allow' },
  'y-aa-true-hook-allow': { calls: ['readSecret', 'run', 'write', 'writeOutside', 'fetch', 'search', 'agent', 'ask'], hookMode: 'allow', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false }, killMs: 60000 },
  'y-aa-true-hook-deny': { calls: ['readSecret', 'run', 'write', 'writeOutside', 'fetch', 'search', 'agent', 'ask'], hookMode: 'deny', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-aa-true-crash': { calls: ['readSecret', 'run'], hookMode: 'crash', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-aa-true-exit1': { calls: ['readSecret', 'run'], hookMode: 'exit1', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-aa-true-garbage': { calls: ['readSecret', 'run'], hookMode: 'garbage', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-aa-true-killed': { calls: ['readSecret', 'run'], hookMode: 'killed', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-aa-true-missing-runtime': { calls: ['readSecret', 'run'], hookMode: 'deny', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false }, noNodeOnPath: true },
  'y-aa-true-timeout': { calls: ['readSecret', 'run'], hookMode: 'hang', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false }, killMs: 100000 },
  'y-aa-true-no-hook': { calls: ['readSecret', 'run', 'write'], hookMode: 'deny', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false }, noHook: true },
  'y-aa-true-canary-allow': { calls: ['readCanary', 'writeOutside'], hookMode: 'allow', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'y-off-tools': { calls: ['run', 'fetch', 'agent', 'readCanary', 'write'], hookMode: 'allow', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false, disabledTools: ['run_commands', 'fetch_web_content', 'spawn_agent', 'skills', 'teams', 'ask_question'] } },
  'y-off-tools-2': { calls: ['readCanary', 'writeOutside', 'write'], hookMode: 'allow', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false, disabledTools: ['run_commands', 'fetch_web_content', 'spawn_agent', 'skills', 'ask_question', 'team_spawn_teammate', 'team_shutdown_teammate', 'team_status', 'team_task', 'team_run_task', 'team_cancel_run', 'team_list_runs', 'team_await_runs', 'team_send_message', 'team_broadcast', 'team_read_mailbox', 'team_mission_log', 'team_cleanup', 'team_create_outcome', 'team_attach_outcome_fragment', 'team_review_outcome_fragment', 'team_finalize_outcome', 'team_list_outcomes'] } },
  'y-off-tools-2-killed': { calls: ['readCanary', 'writeOutside', 'write'], hookMode: 'killed', autoApprove: 'true', settings: { telemetryOptOut: true, autoUpdateEnabled: false, disabledTools: ['run_commands', 'fetch_web_content', 'spawn_agent', 'skills', 'ask_question', 'team_spawn_teammate', 'team_shutdown_teammate', 'team_status', 'team_task', 'team_run_task', 'team_cancel_run', 'team_list_runs', 'team_await_runs', 'team_send_message', 'team_broadcast', 'team_read_mailbox', 'team_mission_log', 'team_cleanup', 'team_create_outcome', 'team_attach_outcome_fragment', 'team_review_outcome_fragment', 'team_finalize_outcome', 'team_list_outcomes'] } },
  'k-network-proxy-default': { calls: ['readSecret'], hookMode: 'allow', autoApprove: 'true', proxy: true, note: 'default settings (telemetry and auto-update left as they come)' },
  'k-network-proxy-optout': { calls: ['readSecret'], hookMode: 'allow', autoApprove: 'true', proxy: true, settings: { telemetryOptOut: true, autoUpdateEnabled: false } },
  'k-network-proxy-env': { calls: ['readSecret'], hookMode: 'allow', autoApprove: 'true', proxy: true, settings: { telemetryOptOut: true, autoUpdateEnabled: false }, extraEnv: { DISABLE_TELEMETRY: '1', OTEL_TELEMETRY_ENABLED: '0', CLINE_TELEMETRY_DISABLED: '1', CLINE_DISABLE_TELEMETRY: '1', TELEMETRY_SERVICE_API_KEY: '' }, note: 'settings opt-out plus every telemetry-looking environment variable found in the binary' },
  'a-all-tools-deny': { calls: ['readSecret', 'run', 'write', 'writeOutside', 'fetch', 'search', 'agent', 'ask'], hookMode: 'deny' },
  'a-control-allow': { calls: ['readSecret', 'run', 'write', 'writeOutside', 'fetch', 'search', 'agent', 'ask'], hookMode: 'allow' },
  'c-crash': { calls: ['readSecret'], hookMode: 'crash' },
  'c-exit1': { calls: ['readSecret'], hookMode: 'exit1' },
  'c-garbage': { calls: ['readSecret'], hookMode: 'garbage' },
  'c-killed': { calls: ['readSecret'], hookMode: 'killed' },
  'c-missing-runtime': { calls: ['readSecret'], hookMode: 'deny', noNodeOnPath: true },
  'c-timeout': { calls: ['readSecret'], hookMode: 'hang', killMs: 120000 },
  'c-no-hook': { calls: ['readSecret', 'run', 'write'], hookMode: 'deny', noHook: true },
  'd-canary-deny': { calls: ['readCanary'], hookMode: 'deny' },
  'd-canary-allow': { calls: ['readCanary'], hookMode: 'allow' },
};

import { execFileSync } from 'node:child_process';
function leftovers() { // processes of this engine still alive after the run (the hub daemon), then stopped here so the spike leaves nothing behind
  try {
    const out = execFileSync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='cline.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], { encoding: 'utf8', windowsHide: true }).split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
    const rows = out.map((l) => ({ pid: l.split('|')[0], cmd: l.slice(l.indexOf('|') + 1) })).filter((r) => r.cmd.toLowerCase().includes('scratchpad'));
    for (const r of rows) execFileSync(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', r.pid, '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return rows.map((r) => (r.cmd.includes('--cline-hub-daemon') ? 'cline.exe --cline-hub-daemon --host 127.0.0.1 (hub daemon)' : 'cline.exe (other)'));
  } catch (e) { return [`(could not list: ${e.message.slice(0, 80)})`]; }
}
async function run(name) {
  const sc = SCENARIOS[name]; if (!sc) throw new Error(`unknown scenario ${name}`);
  const dir = join(root, 'runs', name); rmSync(dir, { recursive: true, force: true });
  const p = { proj: join(dir, 'proj'), outside: join(dir, 'outside'), home: join(dir, 'fakehome'), iso: join(dir, 'cline-home'), canary: join(dir, 'outside', 'canary.txt'), port: await freePort() };
  for (const d of [p.proj, join(p.proj, 'protected'), join(p.proj, '.cline', 'hooks'), p.outside, join(p.home, '.cline', 'hooks'), join(p.home, '.claude'), join(p.home, '.codex'), join(p.home, 'AppData/Roaming'), join(p.home, 'AppData/Local'), join(p.iso, 'hooks'), join(p.iso, 'data'), join(dir, 'tmp')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.proj, 'secret.txt'), `${SECRET}\n`); writeFileSync(join(p.proj, 'protected', 'x.txt'), 'protected\n'); writeFileSync(p.canary, `${CANARY}\n`);
  const log = { stub: join(dir, 'stub.jsonl'), hook: join(dir, 'hook.jsonl'), projHook: join(dir, 'project-hook-fired.log'), userHook: join(dir, 'user-hook-fired.log') };
  // hostile hooks: one in the project, one in the (fake) person's own folders; each only records that it ran
  const hostile = (f) => `process.stdin.resume();process.stdin.on('end',()=>{require('fs').appendFileSync(${JSON.stringify(f)},'fired\\n');});`;
  writeFileSync(join(p.proj, '.cline', 'hooks', 'PreToolUse.js'), hostile(log.projHook));
  writeFileSync(join(p.home, '.cline', 'hooks', 'PreToolUse.js'), hostile(log.userHook));
  // Bunny's hook in the isolated CLINE_DIR/hooks
  if (!sc.noHook) writeFileSync(join(p.iso, 'hooks', 'PreToolUse.js'), readFileSync(join(here, 'hook.js'), 'utf8'));
  const tools = TOOLS(p);
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ calls: sc.calls.map((k) => tools[k]), text: sc.text }));
  let proxyServer; const proxySeen = [];
  if (sc.proxy) { const pp = await freePort(); proxyServer = createServer((c) => { c.once('data', (d) => { proxySeen.push(String(d).split(String.fromCharCode(13))[0]); c.destroy(); }); }); await new Promise((r) => proxyServer.listen(pp, '127.0.0.1', r)); sc.proxyUrl = `http://127.0.0.1:${pp}`; }
  const stub = spawn(NODE, [join(here, 'stub-chat.mjs'), String(p.port), join(dir, 'scenario.json'), log.stub], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => setTimeout(r, 600));
  const env = { SystemRoot: process.env.SystemRoot, PATH: [...(sc.noNodeOnPath ? [] : [dirname(NODE)]), join(process.env.SystemRoot, 'System32'), join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'), TEMP: join(dir, 'tmp'), TMP: join(dir, 'tmp'),
    USERPROFILE: p.home, HOME: p.home, APPDATA: join(p.home, 'AppData/Roaming'), LOCALAPPDATA: join(p.home, 'AppData/Local'),
    CLINE_DIR: p.iso, CLINE_DATA_DIR: join(p.iso, 'data'), ...(sc.proxy ? { HTTP_PROXY: sc.proxyUrl, HTTPS_PROXY: sc.proxyUrl, ALL_PROXY: sc.proxyUrl, NO_PROXY: '127.0.0.1' } : {}), HOOK_LOG: log.hook, HOOK_MODE: sc.hookMode ?? 'deny', HOOK_ALLOW: sc.allow ?? '', ...(sc.extraEnv ?? {}) };
  // configure the provider offline into the isolated data dir (no account sign-in): base URL, a fake key, a model name
  const cfg = spawn(CLINE, ['auth', 'openai-compatible', '-k', 'sk-fake-spike', '-m', 'stub-model', '-b', `http://127.0.0.1:${p.port}/v1`, '--config', p.iso, '--data-dir', join(p.iso, 'data')], { env, cwd: p.proj, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let cfgOut = ''; cfg.stdout.on('data', (c) => { cfgOut += c; }); cfg.stderr.on('data', (c) => { cfgOut += c; });
  await new Promise((r) => cfg.on('close', r));
  if (sc.acp) { // Agent Client Protocol over stdio: the host answers session/request_permission
    const acpArgs = ['--acp', '--auto-approve', sc.autoApprove ?? 'false', '--cwd', p.proj, '--config', p.iso, '--data-dir', join(p.iso, 'data'), ...(sc.extraArgs ?? [])];
    const child = spawn(CLINE, acpArgs, { cwd: p.proj, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const rpc = join(dir, 'rpc.jsonl'); let nextId = 1; const waiters = new Map(); const asks = []; let buf = ''; let stderr2 = '';
    const write = (o) => { appendFileSync(rpc, JSON.stringify({ dir: 'out', ...o }) + String.fromCharCode(10)); child.stdin.write(JSON.stringify(o) + String.fromCharCode(10)); };
    const request = (method, params) => new Promise((res) => { const id = nextId++; waiters.set(id, res); write({ jsonrpc: '2.0', id, method, params }); });
    child.stderr.on('data', (c) => { stderr2 += c; });
    child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; let m; try { m = JSON.parse(line); } catch { appendFileSync(rpc, JSON.stringify({ dir: 'in-unparsed', line }) + String.fromCharCode(10)); continue; }
      appendFileSync(rpc, JSON.stringify({ dir: 'in', ...m }) + String.fromCharCode(10));
      if (m.method === 'session/request_permission') { asks.push(m.params); const opts = m.params?.options ?? []; const pick = sc.decide === 'allow' ? opts.find((o) => /allow/.test(o.kind)) : opts.find((o) => /reject/.test(o.kind)); write({ jsonrpc: '2.0', id: m.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } }); }
      else if (m.id !== undefined && m.method) write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported by the spike client' } });
      else if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } });
    const t0 = Date.now();
    const killer2 = setTimeout(() => { appendFileSync(join(dir, 'TIMEOUT'), 'limit' + String.fromCharCode(10)); spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }, sc.killMs ?? 60000);
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'bunny-spike', version: '0' } });
    const sess = await request('session/new', { cwd: p.proj, mcpServers: [] });
    const sessionId = sess.result?.sessionId;
    const prompted = await Promise.race([request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Spike: do the scripted tool calls.' }] }), new Promise((r) => setTimeout(() => r({ timeout: true }), (sc.killMs ?? 60000) - 2000))]);
    await new Promise((r) => setTimeout(r, 400)); clearTimeout(killer2);
    spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); stub.kill();
    writeFileSync(join(dir, 'engine-stderr.txt'), stderr2);
    const stubText2 = read(log.stub); let toolText2 = ''; for (const l of stubText2.split(String.fromCharCode(10)).filter(Boolean)) { try { const r = JSON.parse(l); if (!/chat/.test(r.url)) continue; for (const m of JSON.parse(r.body).messages ?? []) if (m.role === 'tool') toolText2 += JSON.stringify(m.content); } catch { /* skip */ } }
    const hl = read(log.hook).split(String.fromCharCode(10)).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const L2 = [];
    L2.push(`scenario: ${name} (ACP)   seconds: ${((Date.now() - t0) / 1000).toFixed(1)}   timed out: ${existsSync(join(dir, 'TIMEOUT'))}`);
    L2.push(`command: cline ${acpArgs.join(' ')}   (then JSON-RPC: initialize, session/new, session/prompt; the harness answers every session/request_permission with: ${sc.decide ?? 'reject'})`);
    L2.push(`initialize result: ${JSON.stringify(init.result ?? init.error).slice(0, 400)}`);
    L2.push(`session/new: ${sess.error ? 'ERROR ' + JSON.stringify(sess.error) : 'ok'}   session/prompt result: ${JSON.stringify(prompted.result ?? prompted.error ?? prompted).slice(0, 200)}`);
    L2.push(`permission requests from cline (${asks.length}): ${asks.map((a) => `${a.toolCall?.title ?? a.toolCall?.kind ?? '?'}[${(a.options ?? []).map((o) => o.kind).join('/')}]`).join(' | ') || '(none)'}`);
    L2.push(`bunny hook saw (${hl.length}): ${hl.map((h) => h.tool ?? h.event).join(', ') || '(nothing)'}`);
    L2.push(`project .cline/hooks hook fired: ${read(log.projHook).split(String.fromCharCode(10)).filter(Boolean).length} times; fake-home .cline/hooks hook fired: ${read(log.userHook).split(String.fromCharCode(10)).filter(Boolean).length} times`);
    for (const f of ['ran.txt', 'written.txt']) L2.push(`${f} exists: ${existsSync(join(p.proj, f))}`);
    L2.push(`OUTSIDE planted.txt exists: ${existsSync(join(p.outside, 'planted.txt'))}`);
    L2.push(`secret.txt content reached the model (in a tool result): ${toolText2.includes(SECRET)}   canary reached the model (in a tool result): ${toolText2.includes(CANARY)}`);
    const o2 = L2.join(String.fromCharCode(10)); writeFileSync(join(dir, 'SUMMARY.txt'), o2 + String.fromCharCode(10)); console.log(o2 + String.fromCharCode(10)); return;
  }
  if (sc.settings) { mkdirSync(join(p.iso, 'data', 'settings'), { recursive: true }); writeFileSync(join(p.iso, 'data', 'settings', 'global-settings.json'), JSON.stringify(sc.settings, null, 1)); }
  const args = ['--json', '--auto-approve', sc.autoApprove ?? 'false', '-P', 'openai-compatible', '-m', 'stub-model', '--cwd', p.proj, '--config', p.iso, '--data-dir', join(p.iso, 'data'), ...(sc.extraArgs ?? []), 'Spike: do the scripted tool calls.'];
  const started = Date.now();
  const child = spawn(CLINE, args, { cwd: p.proj, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  const killer = setTimeout(() => { appendFileSync(join(dir, 'TIMEOUT'), 'limit\n'); spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }, sc.killMs ?? 60000);
  const code = await new Promise((r) => child.on('close', r)); clearTimeout(killer);
  await new Promise((r) => setTimeout(r, 400));
  stub.kill(); proxyServer?.close();
  writeFileSync(join(dir, 'engine-stdout.txt'), stdout); writeFileSync(join(dir, 'engine-stderr.txt'), stderr);
  const stubText = read(log.stub);
  const hookLines = read(log.hook).split(String.fromCharCode(10)).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  let toolText = ''; for (const l of stubText.split(String.fromCharCode(10)).filter(Boolean)) { try { const r = JSON.parse(l); if (!/chat/.test(r.url)) continue; for (const m of JSON.parse(r.body).messages ?? []) if (m.role === 'tool') toolText += JSON.stringify(m.content); } catch { /* skip */ } }
  const alive = leftovers();
  const lines = [];
  lines.push(`engine processes still alive after the run (then stopped by the harness): ${alive.length} ${JSON.stringify(alive)}`);
  lines.push(`scenario: ${name}   exit code: ${code}   seconds: ${((Date.now() - started) / 1000).toFixed(1)}   timed out: ${existsSync(join(dir, 'TIMEOUT'))}`);
  lines.push(`auth step (offline provider config): ${cfgOut.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 200)}`);
  lines.push(`command: cline ${args.slice(0, -1).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')} "<prompt>"`);
  for (const f of ['ran.txt', 'written.txt']) lines.push(`${f} exists: ${existsSync(join(p.proj, f))}`);
  lines.push(`OUTSIDE planted.txt exists: ${existsSync(join(p.outside, 'planted.txt'))}`);
  lines.push(`secret.txt content reached the model (in a tool result): ${toolText.includes(SECRET)}   canary reached the model (in a tool result): ${toolText.includes(CANARY)}`);
  lines.push(`bunny hook saw (${hookLines.length}): ${hookLines.map((h) => h.tool ?? h.event).join(', ') || '(nothing)'}`);
  lines.push(`project .cline/hooks hook fired: ${read(log.projHook).split(String.fromCharCode(10)).filter(Boolean).length} times; fake-home .cline/hooks hook fired: ${read(log.userHook).split(String.fromCharCode(10)).filter(Boolean).length} times`);
  const reqs = stubText.split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => /chat\/completions/.test(r.url));
  if (reqs[0]) { try { const b = JSON.parse(reqs[0].body); lines.push(`tools offered to the model: ${JSON.stringify((b.tools ?? []).map((t) => t.function?.name ?? t.type))}`); } catch { /* not json */ } }
  if (sc.proxy) lines.push(`connections that went to the proxy instead of the stand-in (${proxySeen.length}): ${JSON.stringify(proxySeen)}`);
  lines.push(`hosts contacted at the stand-in: ${[...new Set(stubText.split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l).host))].join(', ')}`);
  lines.push(`engine stdout (first 600 chars): ${stdout.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 600).replace(/\s+/g, ' ')}`);
  lines.push(`engine stderr (first 300 chars): ${stderr.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300).replace(/\s+/g, ' ')}`);
  const out = lines.join(String.fromCharCode(10)); writeFileSync(join(dir, 'SUMMARY.txt'), out + String.fromCharCode(10)); console.log(out + String.fromCharCode(10));
}
for (const n of names) await run(n);
