// Spike S2 driver (Codex CLI 0.170.0, pinned). Not Bunny code.
// node run.mjs <spikeRoot> <scenario>...    spikeRoot holds engine/ (the unzipped, sha256-checked release) and receives runs/.
// Talks to `codex app-server` over stdio (JSON-RPC lines), with a stand-in Responses endpoint on 127.0.0.1 that asks for scripted tool calls.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const [root, ...names] = process.argv.slice(2);
const CODEX = join(root, 'engine', 'codex-x86_64-pc-windows-msvc.exe');
const NODE = process.execPath;
const SECRET = 'SECRET-S2-5c0e7a'; const CANARY = 'CANARY-S2-31bd9f02';
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const ps = (cmd) => ({ type: 'function_call', name: 'exec_command', arguments: { cmd: 'powershell -NoProfile -Command "' + cmd.replace(/"/g, '\"') + '"', yield_time_ms: 15000 } });

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const read2 = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const patchFor = (file, text) => `*** Begin Patch\n*** Add File: ${file}\n+${text}\n*** End Patch`;

const TOOLS = (p) => ({
  readSecret: ps(`Get-Content -LiteralPath '${join(p.proj, 'secret.txt')}'`),
  readCanary: ps(`Get-Content -LiteralPath '${p.canary}'`),
  inSandboxEcho: ps(`Set-Content -LiteralPath '${join(p.proj, 'ran.txt')}' -Value RAN-MARKER`),
  listDir: ps(`Get-ChildItem -LiteralPath '${p.proj}' | Select-Object -ExpandProperty Name`),
  patchViaExec: { type: 'function_call', name: 'exec_command', arguments: { cmd: 'apply_patch "*** Begin Patch\n*** Add File: patched-exec.txt\n+PATCHED-VIA-EXEC\n*** End Patch"', yield_time_ms: 15000 } },
  viewPng: { type: 'function_call', name: 'view_image', arguments: { path: '__PNG__' } },
  viewCanary: { type: 'function_call', name: 'view_image', arguments: { path: '__CANARY__' } },
  patchOutside: { type: 'custom_tool_call', name: 'apply_patch', input: '__PATCHOUT__' },
  patchUpdateCanary: { type: 'custom_tool_call', name: 'apply_patch', input: '__PATCHUPD__' },
  patch: { type: 'custom_tool_call', name: 'apply_patch', input: patchFor(join(p.proj, 'patched.txt'), 'PATCHED-MARKER') },
});

// policy: the value given as approvalPolicy; sandbox: thread sandbox; decide: what the harness answers to an approval request
const SCENARIOS = {
  'x-discover-tools': { calls: [], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline' },
  'x-patch-via-exec': { calls: ['patchViaExec'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline' },
  'f-unelevated-on-request': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], note: 'R14: the unelevated sandbox; what does on-request ask?' },
  'f-unelevated-granular': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: { granular: { sandbox_approval: true, rules: true, mcp_elicitations: true, request_permissions: true, skill_approval: true } }, sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'] },
  'f-unelevated-untrusted': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'] },
  'g-accept-granular-with-canary': { calls: ['inSandboxEcho', 'patch', 'readCanary'], policy: { granular: { sandbox_approval: true, rules: true, mcp_elicitations: true, request_permissions: true, skill_approval: true } }, sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"'], note: 'control: Bunny says accept to everything: the tools run only after the ask, and the canary read (outside the folder) also asks' },
  'g-canary-on-request-sandbox': { calls: ['readCanary'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], note: 'R23: with the sandbox and no ask, can a command read the canary outside the folder?' },
  'g-canary-granular-decline': { calls: ['readCanary'], policy: { granular: { sandbox_approval: true, rules: true, mcp_elicitations: true, request_permissions: true, skill_approval: true } }, sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'] },
  'd-commands-off-on-request': { calls: ['inSandboxEcho', 'readCanary', 'patch'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false', 'features.computer_use=false', 'features.image_generation=false', 'web_search="disabled"'], note: 'R23: shell_tool and unified_exec off; what tools are left, does a command run, can the canary be read?' },
  'd-commands-off-untrusted': { calls: ['inSandboxEcho', 'readCanary', 'patch'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false', 'features.computer_use=false', 'features.image_generation=false', 'web_search="disabled"'], note: 'same, every ask answered accept' },
  'c-untrusted-accept-sandbox': { calls: ['inSandboxEcho', 'patch', 'readCanary'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"'], note: 'control: untrusted asks for each and accept lets it run' },
  'h-off-on-request-reads-writes': { calls: ['viewCanary', 'viewPng', 'patchOutside'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false', 'features.computer_use=false', 'features.image_generation=false', 'web_search="disabled"'], note: 'commands off, no ask configured: view_image of the canary, a patch that ADDS a file outside the folder, a patch that UPDATES the canary' },
  'h-off-untrusted-decline-reads-writes': { calls: ['viewCanary', 'viewPng', 'patchOutside'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false', 'features.computer_use=false', 'features.image_generation=false', 'web_search="disabled"'] },
  'i-all-off-view-image': { calls: ['viewPng', 'patchOutside', 'patch'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"', 'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false', 'features.computer_use=false', 'features.image_generation=false', 'features.view_image=false', 'features.goals=false', 'features.hooks=false', 'web_search="disabled"'], note: 'R23: view_image also off: is the outside read path closed? what tools are left?' },
  'j-control-home-forbidden': { calls: ['inSandboxEcho', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], homeRules: 'forbidden' },
  'j-control-home-allow-onrequest': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], homeRules: 'allow' },
  'k-nosandbox-onrequest-baseline': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', note: 'no sandbox configured, so on-request asks for everything unless a rule allows' },
  'k-nosandbox-onrequest-home-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', homeRules: 'allow', note: 'no sandbox configured, so on-request asks for everything unless a rule allows' },
  'k-nosandbox-onrequest-trusted-project-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', trust: 'trusted', rules: 'allow', note: 'no sandbox configured, so on-request asks for everything unless a rule allows' },
  'k-nosandbox-onrequest-untrusted-project-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', trust: 'untrusted', rules: 'allow', note: 'no sandbox configured, so on-request asks for everything unless a rule allows' },
  'm-broken-home-control': { calls: ['inSandboxEcho'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', brokenRules: 'home', note: 'is the rule file read? a file with a syntax error is reported only if it is read' },
  'm-broken-project-trusted': { calls: ['inSandboxEcho'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', trust: 'trusted', brokenRules: 'project', note: 'is the rule file read? a file with a syntax error is reported only if it is read' },
  'm-broken-project-untrusted': { calls: ['inSandboxEcho'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', trust: 'untrusted', brokenRules: 'project', note: 'is the rule file read? a file with a syntax error is reported only if it is read' },
  'm-broken-project-no-config': { calls: ['inSandboxEcho'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', brokenRules: 'project', note: 'is the rule file read? a file with a syntax error is reported only if it is read' },
  'j-untrusted-trusted-forbidden': { calls: ['inSandboxEcho', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'trusted', rules: 'forbidden' },
  'j-untrusted-trusted-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'trusted', rules: 'allow' },
  'j-untrusted-untrusted-forbidden': { calls: ['inSandboxEcho', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'untrusted', rules: 'forbidden' },
  'j-untrusted-untrusted-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'untrusted', rules: 'allow' },
  'j-on-request-trusted-forbidden': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'trusted', rules: 'forbidden' },
  'j-on-request-trusted-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'trusted', rules: 'allow' },
  'j-on-request-untrusted-forbidden': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'untrusted', rules: 'forbidden' },
  'j-on-request-untrusted-allow': { calls: ['inSandboxEcho', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline', cfg: ['windows.sandbox="unelevated"'], trust: 'untrusted', rules: 'allow' },
  'k-network-proxy': { calls: ['listDir'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"'], proxy: true, note: 'any outbound attempt that honours the proxy variables is logged; only the stand-in should be contacted' },
  'k-network-proxy-features-off': { calls: ['listDir'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"', 'features.apps=false', 'features.plugins=false', 'features.remote_plugin=false', 'features.plugin_sharing=false', 'features.tool_suggest=false', 'features.computer_use=false', 'features.image_generation=false', 'web_search="disabled"'], proxy: true },
  'k-network-proxy-more-off': { calls: ['listDir'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept', cfg: ['windows.sandbox="unelevated"', 'features.apps=false', 'features.plugins=false', 'features.remote_plugin=false', 'features.plugin_sharing=false', 'features.tool_suggest=false', 'features.computer_use=false', 'features.image_generation=false', 'features.memories=false', 'features.goals=false', 'features.hooks=false', 'features.recommended_plugins=false', 'web_search="disabled"', 'chatgpt_base_url="http://127.0.0.1:9"'], proxy: true },
  'a-untrusted-decline': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'decline' },
  'a-on-request-control': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: 'on-request', sandbox: 'workspace-write', decide: 'decline' },
  'a-granular-decline': { calls: ['listDir', 'inSandboxEcho', 'patch', 'readSecret'], policy: { granular: { sandbox_approval: true, rules: true, mcp_elicitations: true, request_permissions: true, skill_approval: true } }, sandbox: 'workspace-write', decide: 'decline' },
  'c-untrusted-accept-control': { calls: ['inSandboxEcho', 'patch'], policy: 'untrusted', sandbox: 'workspace-write', decide: 'accept' },
};

function jsonl(stream, onMessage) { let buf = ''; stream.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { try { onMessage(JSON.parse(line)); } catch { onMessage({ unparsed: line }); } } } }); }

async function run(name) {
  const sc = SCENARIOS[name]; if (!sc) throw new Error(`unknown scenario ${name}`);
  const dir = join(root, 'runs', name); rmSync(dir, { recursive: true, force: true });
  const p = { proj: join(dir, 'proj'), outside: join(dir, 'outside'), home: join(dir, 'fakehome'), iso: join(dir, 'codex-home'), canary: join(dir, 'outside', 'canary.txt'), port: await freePort() };
  for (const d of [p.proj, join(p.proj, 'protected'), join(p.proj, '.codex'), p.outside, join(p.home, '.codex'), join(p.home, '.claude'), join(p.home, '.cline'), join(p.home, 'AppData/Roaming'), join(p.home, 'AppData/Local'), p.iso, join(dir, 'tmp')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.proj, 'secret.txt'), `${SECRET}\n`); writeFileSync(join(p.proj, 'protected', 'x.txt'), 'protected\n'); writeFileSync(p.canary, `${CANARY}\n`);
  // hostile configs of the person and of the project: never ask, full access
  writeFileSync(join(p.home, '.codex', 'config.toml'), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
  writeFileSync(join(p.proj, '.codex', 'config.toml'), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
  writeFileSync(join(p.home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['*'] } }));
  writeFileSync(join(p.home, '.cline', 'settings.json'), JSON.stringify({ autoApprove: true }));
  if (sc.trust) { // what the isolated home says about this project before the run: 'trusted' (a first run leaves that) or 'untrusted' (Bunny rewrites config.toml like this before each run)
    const NL = String.fromCharCode(10);
    writeFileSync(join(p.iso, 'config.toml'), `[projects.'${p.proj.toLowerCase()}']${NL}trust_level = "${sc.trust}"${NL}`);
  }
  if (sc.brokenRules) { // a rule file that cannot be parsed: if Codex reads it, it says so; if it does not read it, it says nothing
    const NL = String.fromCharCode(10);
    const dirs = sc.brokenRules === 'home' ? [join(p.iso, 'rules')] : [join(p.proj, '.codex', 'rules')];
    for (const d of dirs) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'default.rules'), 'prefix_rule(pattern=[BROKEN-MARKER-xyz' + NL); }
  }
  if (sc.homeRules) { // control: the same rule file in the rules folder of the isolated Codex home, where Codex reads rules
    mkdirSync(join(p.iso, 'rules'), { recursive: true });
    const B = String.fromCharCode(92); const pw = ['C:', 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'].join(B + B);
    writeFileSync(join(p.iso, 'rules', 'default.rules'), `prefix_rule(pattern=["${pw}"], decision="${sc.homeRules}")` + String.fromCharCode(10));
  }
  if (sc.rules) {
    mkdirSync(join(p.proj, '.codex', 'rules'), { recursive: true });
    const B = String.fromCharCode(92); const pw = ['C:', 'Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'].join(B + B);
    writeFileSync(join(p.proj, '.codex', 'rules', 'default.rules'), `prefix_rule(pattern=["${pw}"], decision="${sc.rules}")` + String.fromCharCode(10));
  }
  const tools = TOOLS(p);
  tools.viewCanary.arguments.path = p.canary;
  tools.viewPng.arguments.path = join(p.outside, 'canary.png');
  writeFileSync(join(p.outside, 'canary.png'), Buffer.from(PNG_B64, 'base64'));
  tools.patchOutside.input = patchFor(join(p.outside, 'planted.txt'), 'PLANTED-OUTSIDE');
  tools.patchUpdateCanary.input = ['*** Begin Patch', `*** Update File: ${p.canary}`, '@@', '-CANARY-S2-31bd9f02', '+CHANGED', '*** End Patch'].join(String.fromCharCode(10));
  const log = { stub: join(dir, 'stub.jsonl'), rpc: join(dir, 'rpc.jsonl') };
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ calls: sc.calls.map((k) => tools[k]) }));
  let proxyServer; const proxySeen = [];
  if (sc.proxy) { const pp = await freePort(); proxyServer = createServer((c) => { c.once('data', (d) => { proxySeen.push(String(d).split(String.fromCharCode(13))[0]); c.destroy(); }); }); await new Promise((r) => proxyServer.listen(pp, '127.0.0.1', r)); sc.proxyUrl = `http://127.0.0.1:${pp}`; }
  const stub = spawn(NODE, [join(here, 'stub-responses.mjs'), String(p.port), join(dir, 'scenario.json'), log.stub], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => setTimeout(r, 600));
  const env = { SystemRoot: process.env.SystemRoot, PATH: `${join(root, 'engine', 'codex-path')};${join(process.env.SystemRoot, 'System32')};${join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')}`, TEMP: join(dir, 'tmp'), TMP: join(dir, 'tmp'),
    USERPROFILE: p.home, HOME: p.home, APPDATA: join(p.home, 'AppData/Roaming'), LOCALAPPDATA: join(p.home, 'AppData/Local'), CODEX_HOME: p.iso, STUB_KEY: 'sk-fake-spike', ...(sc.proxy ? { HTTP_PROXY: sc.proxyUrl, HTTPS_PROXY: sc.proxyUrl, ALL_PROXY: sc.proxyUrl, NO_PROXY: '127.0.0.1' } : {}) };
  const base = `http://127.0.0.1:${p.port}/v1`;
  const args = ['app-server',
    '-c', 'model_provider="stub"', '-c', 'model="' + (process.env.SPIKE_MODEL || 'gpt-5.5') + '"',
    '-c', `model_providers.stub={name="stub",base_url="${base}",env_key="STUB_KEY",wire_api="responses"}`,
    '-c', 'include_apply_patch_tool=true', '-c', 'analytics.enabled=false', '-c', 'check_for_update_on_startup=false', ...(sc.cfg ?? []).flatMap((c) => ['-c', c])];
  const child = spawn(CODEX, args, { cwd: p.proj, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const seen = []; let nextId = 1; const waiters = new Map(); const approvals = [];
  const write = (o) => { appendFileSync(log.rpc, JSON.stringify({ dir: 'out', ...o }) + '\n'); child.stdin.write(JSON.stringify(o) + '\n'); };
  const request = (method, params) => new Promise((res) => { const id = nextId++; waiters.set(id, res); write({ jsonrpc: '2.0', id, method, params }); });
  let turnDone; const turnEnded = new Promise((r) => { turnDone = r; });
  jsonl(child.stdout, (m) => {
    appendFileSync(log.rpc, JSON.stringify({ dir: 'in', ...m }) + '\n'); seen.push(m);
    if (m.id !== undefined && m.method) { // a request from the server: an approval, or something else we must answer
      if (/requestApproval|applyPatchApproval|execCommandApproval/.test(m.method)) { approvals.push({ method: m.method, params: m.params }); write({ jsonrpc: '2.0', id: m.id, result: { decision: sc.decide === 'accept' ? 'accept' : sc.decide === 'cancel' ? 'cancel' : 'decline' } }); }
      else write({ jsonrpc: '2.0', id: m.id, result: {} });
    } else if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    if (m.method === 'turn/completed') turnDone();
  });
  let stderr = ''; child.stderr.on('data', (c) => { stderr += c; });
  const killer = setTimeout(() => { appendFileSync(join(dir, 'TIMEOUT'), 'limit\n'); spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }, 120000);
  const started = Date.now();
  const init = await request('initialize', { clientInfo: { name: 'bunny-spike', title: 'spike', version: '0' }, capabilities: { experimentalApi: true } });
  write({ jsonrpc: '2.0', method: 'initialized' });
  const thread = await request('thread/start', { cwd: p.proj, approvalPolicy: sc.policy, sandbox: sc.sandbox, ephemeral: true, model: '' + (process.env.SPIKE_MODEL || 'gpt-5.5') + '', modelProvider: 'stub' });
  const threadId = thread.result?.thread?.id;
  const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: 'Spike: do the scripted tool calls.' }] });
  await Promise.race([turnEnded, new Promise((r) => setTimeout(r, 90000))]);
  await new Promise((r) => setTimeout(r, 500));
  clearTimeout(killer);
  spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  stub.kill(); proxyServer?.close();
  writeFileSync(join(dir, 'engine-stderr.txt'), stderr);
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const stubText = read(log.stub);
  const outputs = []; for (const l of stubText.split(String.fromCharCode(10)).filter(Boolean)) { try { const r = JSON.parse(l); if (!/responses/.test(r.url)) continue; for (const it of JSON.parse(r.body).input ?? []) if (/_output$/.test(it.type ?? '')) outputs.push(JSON.stringify(it)); } catch { /* skip */ } }
  const outText = outputs.join(String.fromCharCode(10));
  const rpcText = read(log.rpc);
  const walk = (d, acc = []) => { try { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f, acc); else acc.push(f.slice(d.length - 0)); } } catch { /* none */ } return acc; };
  const homeFiles = []; const w2 = (d, base) => { try { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) w2(f, base); else homeFiles.push(f.slice(base.length + 1)); } } catch { /* none */ } }; w2(p.iso, p.iso);
  const lines = [];
  lines.push(`scenario: ${name}   seconds: ${((Date.now() - started) / 1000).toFixed(1)}`);
  lines.push(`command: codex app-server ${args.slice(1).join(' ')}   (then thread/start approvalPolicy=${JSON.stringify(sc.policy)} sandbox=${sc.sandbox} ephemeral=true)`);
  lines.push(`initialize result: ${JSON.stringify(init.result ?? init.error).slice(0, 240)}`);
  lines.push(`thread/start: ${thread.error ? 'ERROR ' + JSON.stringify(thread.error) : 'ok'}   turn/start: ${turn.error ? 'ERROR ' + JSON.stringify(turn.error) : 'ok'}`);
  lines.push(`scripted calls: ${sc.calls.join(', ') || '(none)'}   harness answer to every approval: ${sc.decide}`);
  lines.push(`effective thread sandbox/policy: ${JSON.stringify({ policy: thread.result?.approvalPolicy, sandbox: thread.result?.sandbox })}`);
  lines.push(`approval requests from codex (${approvals.length}): ${approvals.map((a) => `${a.method}${a.params?.command ? ' [' + String(a.params.command).slice(0, 70) + ']' : ''}${a.params?.reason ? ' reason=' + String(a.params.reason).slice(0, 50) : ''}`).join(' | ') || '(none)'}`);
  lines.push(`ran.txt exists: ${existsSync(join(p.proj, 'ran.txt'))}   patched.txt exists: ${existsSync(join(p.proj, 'patched.txt'))}   patched-exec.txt exists: ${existsSync(join(p.proj, 'patched-exec.txt'))}   OUTSIDE planted.txt exists: ${existsSync(join(p.outside, 'planted.txt'))}   canary file now: ${JSON.stringify(read2(p.canary).trim())}`);
  lines.push(`secret.txt content reached the model (in a tool output): ${outText.includes(SECRET)}   canary text reached the model (in a tool output): ${outText.includes(CANARY)}   canary.png bytes reached the model (any request): ${stubText.includes(PNG_B64.slice(40, 70))}`);
  const reqs = stubText.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => /responses/.test(r.url));
  if (reqs[0]) { try { const b = JSON.parse(reqs[0].body); lines.push(`tools offered to the model: ${JSON.stringify((b.tools ?? []).map((t) => (t.name ?? '?') + ':' + t.type))}`); } catch { /* not json */ } }
  lines.push(`files Codex left in its isolated CODEX_HOME (${homeFiles.length}): ${JSON.stringify(homeFiles.slice(0, 25))}`);
  if (sc.proxy) lines.push(`connections that went to the proxy instead of the stand-in (${proxySeen.length}): ${JSON.stringify(proxySeen)}`);
  lines.push(`Codex stderr mentions the broken rule file (BROKEN-MARKER, rules, parse or starlark): ${/BROKEN-MARKER|default\.rules|starlark|execpolicy|exec policy/i.test(stderr) ? JSON.stringify(stderr.replace(/\[[0-9;]*m/g, '').split(String.fromCharCode(10)).filter((l) => /BROKEN-MARKER|default\.rules|starlark|execpolicy|exec policy|rules/i.test(l)).slice(0, 3)).slice(0, 500) : 'no'}`);
  lines.push(`config.toml in the isolated home after the run: ${JSON.stringify(read2(join(p.iso, 'config.toml')).trim())}`);
  lines.push(`hosts contacted at the stand-in: ${[...new Set(stubText.split('\n').filter(Boolean).map((l) => JSON.parse(l).host))].join(', ')}`);
  const out = lines.join('\n'); writeFileSync(join(dir, 'SUMMARY.txt'), out + '\n'); console.log(out + '\n');
}
for (const n of names) await run(n);
