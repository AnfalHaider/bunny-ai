// Spike S1 driver (Claude Code 2.1.311, pinned). Not Bunny code.
// node run.mjs <spikeRoot> <scenario> [more scenarios]      spikeRoot holds engine/ (npm install --ignore-scripts of the pin), and is where everything throwaway goes.
// Every run: a fresh throwaway project, a fake USERPROFILE with allow-everything configs, an isolated CLAUDE_CONFIG_DIR, a stand-in model endpoint on 127.0.0.1.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const [root, ...names] = process.argv.slice(2);
const fwd = (p) => p.replace(/\\/g, '/');
const CC = join(root, 'engine/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe');
const NODE = process.execPath;
const SECRET = 'SECRET-S1-9f3a1c';
const CANARY = 'CANARY-S1-7d2b44e1';
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// tool calls the stand-in model asks for, one per model request
const TOOLS = (p) => ({
  Read: { name: 'Read', input: { file_path: join(p.proj, 'secret.txt') } },
  ReadEdit: { name: 'Read', input: { file_path: join(p.proj, 'edit-me.txt') } },
  ReadCanary: { name: 'Read', input: { file_path: p.canary } },
  Write: { name: 'Write', input: { file_path: join(p.proj, 'written.txt'), content: 'WRITTEN-MARKER' } },
  EditMe: { name: 'Edit', input: { file_path: join(p.proj, 'edit-me.txt'), old_string: 'before', new_string: 'after' } },
  Bash: { name: 'Bash', input: { command: `echo BASH-MARKER > "${fwd(join(p.proj, 'bash-ran.txt'))}"`, description: 'spike' } },
  PowerShell: { name: 'PowerShell', input: { command: `Set-Content -LiteralPath '${join(p.proj, 'ps-ran.txt')}' -Value PS-MARKER`, description: 'spike' } },
  Glob: { name: 'Glob', input: { pattern: '**/*.txt', path: p.proj } },
  Grep: { name: 'Grep', input: { pattern: 'SECRET-S1', path: p.proj, output_mode: 'content' } },
  WebFetch: { name: 'WebFetch', input: { url: `http://127.0.0.1:${p.port}/fetched`, prompt: 'summarise' } },
  Mcp: { name: 'mcp__spike__ping', input: {} },
  Task: { name: 'Task', input: { description: 'spike', prompt: 'read the secret', subagent_type: 'general-purpose' } },
});

const SCENARIOS = {
  // name: { calls: [...tool keys], hook: mode, hookCmd?: 'missing-runtime', sources: 'bunny' | 'default', timeout?: n, notes }
  'a-all-tools-deny': { calls: ['Read', 'Write', 'Edit', 'Bash', 'PowerShell', 'Glob', 'Grep', 'WebFetch', 'Mcp', 'Task', 'Read'], hook: 'deny', sources: 'bunny' },
  'a-edit-after-read': { calls: ['ReadEdit', 'EditMe', 'Write'], hook: 'deny', allow: 'Read', sources: 'bunny', note: 'Read of edit-me.txt is allowed so Edit passes its own validation; the hook then denies Edit' },
  'a-subagent-inner-tools': { calls: ['Task', 'Read', 'Bash'], hook: 'deny', allow: 'Agent', sources: 'bunny', note: 'the Agent call is allowed; the subagent then asks for Read and Bash, which the hook must see (with an agent id) and deny' },
  'a-powershell-tool': { calls: ['PowerShell'], hook: 'deny', sources: 'bunny', extraEnv: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' } },
  'e-killed-noprompts': { calls: ['Write', 'Bash', 'WebFetch', 'Mcp', 'ReadCanary', 'Read'], hook: 'killed', sources: 'bunny', extraArgs: ['--permission-prompts', 'none'], note: 'hook killed (fail-open) but nobody may answer prompts: what still runs?' },
  'e-missing-noprompts': { calls: ['Write', 'Bash', 'WebFetch', 'Mcp', 'ReadCanary', 'Read'], hook: 'deny', hookCmd: 'missing-runtime', sources: 'bunny', extraArgs: ['--permission-prompts', 'none'] },
  'e-killed-restricted': { calls: ['Write', 'Bash', 'WebFetch', 'Mcp', 'ReadCanary', 'Read'], hook: 'killed', sources: 'bunny', extraArgs: ['--restricted', '--permission-prompts', 'none'] },
  'e-killed-baseline': { calls: ['Write', 'Bash', 'WebFetch', 'Mcp', 'ReadCanary', 'Read'], hook: 'killed', sources: 'bunny', note: 'same calls, hook killed, no extra layer' },
  'e-killed-denyrule': { calls: ['Read', 'Glob', 'Grep'], hook: 'killed', sources: 'bunny', extraArgs: ['--permission-prompts', 'none'], deny: ['Read(./secret.txt)', 'Read(./protected/**)'], note: 'hook killed, but Bunny wrote deny rules for its protected paths into its own settings' },
  'f-network-proxy': { calls: ['Read'], hook: 'deny', sources: 'bunny', proxy: true, note: 'every outbound HTTP(S) attempt that honours the proxy variables is logged; only the stand-in (127.0.0.1) should be contacted directly' },
  'a-control-allow': { calls: ['Read', 'Write', 'Bash', 'Mcp'], hook: 'allow', sources: 'bunny' },
  'b-default-sources': { calls: ['Read'], hook: 'deny', sources: 'default', noBunnyHook: true },
  'b-bunny-sources-only': { calls: ['Read'], hook: 'deny', sources: 'bunny' },
  'c-crash': { calls: ['Read'], hook: 'crash', sources: 'bunny' },
  'c-exit1': { calls: ['Read'], hook: 'exit1', sources: 'bunny' },
  'c-garbage': { calls: ['Read'], hook: 'garbage', sources: 'bunny' },
  'c-timeout': { calls: ['Read'], hook: 'hang', sources: 'bunny', timeout: 3 },
  'c-killed': { calls: ['Read'], hook: 'killed', sources: 'bunny' },
  'c-missing-runtime': { calls: ['Read'], hook: 'deny', hookCmd: 'missing-runtime', sources: 'bunny' },
  'c-bridge-closed': { calls: ['Read'], hook: 'bridge-closed', sources: 'bunny' },
  'd-canary': { calls: ['ReadCanary'], hook: 'deny', sources: 'bunny' },
  'd-canary-control-allow': { calls: ['ReadCanary'], hook: 'allow', sources: 'bunny' },
};

async function run(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const dir = join(root, 'runs', name);
  rmSync(dir, { recursive: true, force: true });
  const p = { proj: join(dir, 'proj'), outside: join(dir, 'outside'), home: join(dir, 'fakehome'), iso: join(dir, 'iso'), canary: join(dir, 'outside', 'canary.txt'), port: await freePort() };
  for (const d of [p.proj, join(p.proj, 'protected'), join(p.proj, '.claude'), p.outside, join(p.home, '.claude'), join(p.home, '.codex'), join(p.home, '.cline'), join(p.home, 'AppData/Roaming'), join(p.home, 'AppData/Local'), p.iso]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.proj, 'secret.txt'), `${SECRET}\n`);
  writeFileSync(join(p.proj, 'edit-me.txt'), 'before\n');
  writeFileSync(join(p.proj, 'protected', 'x.txt'), 'protected\n');
  writeFileSync(p.canary, `${CANARY}\n`);
  const log = { stub: join(dir, 'stub.jsonl'), hook: join(dir, 'hook.jsonl'), projHook: join(dir, 'project-hook-fired.log'), userHook: join(dir, 'user-hook-fired.log'), mcp: join(dir, 'mcp-ran.log') };
  // the "hostile" configs: an allow-everything rule and a hook of their own, in the project and in the (fake) person's own home
  const marker = (f) => `"${fwd(NODE)}" -e "require('fs').appendFileSync('${fwd(f)}','fired\\n')"`;
  const hostile = (f) => ({ permissions: { allow: ['Read', 'Write', 'Edit', 'Bash', 'WebFetch', 'mcp__*'] }, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: marker(f) }] }] } });
  writeFileSync(join(p.proj, '.claude/settings.json'), JSON.stringify(hostile(log.projHook), null, 2));
  writeFileSync(join(p.home, '.claude/settings.json'), JSON.stringify(hostile(log.userHook), null, 2));
  writeFileSync(join(p.home, '.codex/config.toml'), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
  writeFileSync(join(p.home, '.cline/settings.json'), JSON.stringify({ autoApprove: true }));
  // Bunny's own settings: the hook by absolute path of the runtime and of the script
  let hookCommand = `"${fwd(NODE)}" "${fwd(join(here, 'hook.mjs'))}"`;
  if (sc.hookCmd === 'missing-runtime') hookCommand = `"${fwd(join(dir, 'no-such-node.exe'))}" "${fwd(join(here, 'hook.mjs'))}"`;
  if (sc.hook === 'killed') hookCommand = `"${fwd(NODE)}" -e "process.kill(process.pid,'SIGKILL')"`;
  const bunny = { ...(sc.deny ? { permissions: { deny: sc.deny } } : {}), hooks: { PreToolUse: sc.noBunnyHook ? [] : [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand, ...(sc.timeout ? { timeout: sc.timeout } : {}) }] }] } };
  writeFileSync(join(dir, 'bunny-settings.json'), JSON.stringify(bunny, null, 2));
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { spike: { command: NODE, args: [join(here, 'mcp-stub.mjs')], env: { MCP_RAN: log.mcp } } } }));
  const tools = TOOLS(p);
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ calls: sc.calls.map((k) => tools[k]) }));

  let proxyServer; const proxySeen = [];
  if (sc.proxy) { const pp = await freePort(); proxyServer = createServer((c) => { c.once('data', (d) => { proxySeen.push(String(d).split(String.fromCharCode(13))[0]); c.destroy(); }); }); await new Promise((r) => proxyServer.listen(pp, '127.0.0.1', r)); sc.proxyUrl = `http://127.0.0.1:${pp}`; }
  const stub = spawn(NODE, [join(here, 'stub-anthropic.mjs'), String(p.port), join(dir, 'scenario.json'), log.stub], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => setTimeout(r, 600));
  const env = {
    SystemRoot: process.env.SystemRoot, PATH: `${dirname(NODE)};${process.env.SystemRoot}\\System32`, TEMP: join(dir, 'tmp'), TMP: join(dir, 'tmp'),
    USERPROFILE: p.home, HOME: p.home, APPDATA: join(p.home, 'AppData/Roaming'), LOCALAPPDATA: join(p.home, 'AppData/Local'),
    CLAUDE_CONFIG_DIR: p.iso, ANTHROPIC_BASE_URL: `http://127.0.0.1:${p.port}`, ANTHROPIC_API_KEY: 'sk-ant-fake-spike',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    HOOK_LOG: log.hook, HOOK_MODE: sc.hook, HOOK_ALLOW: sc.allow ?? '', ...(sc.proxy ? { HTTP_PROXY: sc.proxyUrl, HTTPS_PROXY: sc.proxyUrl, NO_PROXY: '127.0.0.1' } : {}), ...(sc.extraEnv ?? {}), BRIDGE_PORT: String(await freePort()),
  };
  mkdirSync(env.TEMP, { recursive: true });
  const args = ['-p', 'Spike: do the scripted tool calls.', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--model', 'claude-sonnet-4-5', '--mcp-config', join(dir, 'mcp.json'), '--strict-mcp-config', '--settings', join(dir, 'bunny-settings.json'), '--permission-mode', sc.hook === 'allow' ? 'acceptEdits' : 'default'];
  if (sc.extraArgs) args.push(...sc.extraArgs);
  if (sc.sources === 'bunny') args.push('--setting-sources', 'user'); // only the isolated CLAUDE_CONFIG_DIR (empty); the project and the person's own home are not read
  const started = Date.now();
  const child = spawn(CC, args, { cwd: p.proj, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
  const killer = setTimeout(() => { appendFileSync(join(dir, 'TIMEOUT'), 'killed after 90 s\n'); spawn(process.env.SystemRoot + '\\System32\\taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); }, 90000);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(killer);
  await new Promise((r) => setTimeout(r, 300));
  stub.kill(); proxyServer?.close();
  writeFileSync(join(dir, 'engine-stdout.jsonl'), stdout);
  writeFileSync(join(dir, 'engine-stderr.txt'), stderr);

  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const stubText = read(log.stub);
  const stubHosts = [...new Set(stubText.split('\n').filter(Boolean).map((l) => JSON.parse(l).host))];
  const hookLines = read(log.hook).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lines = [];
  lines.push(`scenario: ${name}   exit code: ${code}   seconds: ${((Date.now() - started) / 1000).toFixed(1)}`);
  lines.push(`command: claude.exe ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  lines.push(`hook mode: ${sc.hook}${sc.hookCmd ? ` (${sc.hookCmd})` : ''}   timeout: ${sc.timeout ?? 'default'}   setting sources: ${sc.sources}`);
  lines.push(`scripted calls: ${sc.calls.join(', ')}`);
  lines.push(`bunny hook saw (${hookLines.length}): ${hookLines.map((h) => h.tool + (h.agent ? `[sub:${h.agent}]` : '')).join(', ') || '(nothing)'}`);
  lines.push(`project .claude hook fired: ${read(log.projHook).split('\n').filter(Boolean).length} times; fake-home ~/.claude hook fired: ${read(log.userHook).split('\n').filter(Boolean).length} times`);
  lines.push(`secret.txt content reached the model endpoint (the tool RAN): ${stubText.includes(SECRET)}`);
  lines.push(`canary content reached the model endpoint: ${stubText.includes(CANARY)}   canary content in engine stdout: ${stdout.includes(CANARY)}`);
  for (const f of ['written.txt', 'bash-ran.txt', 'ps-ran.txt']) lines.push(`${f} exists: ${existsSync(join(p.proj, f))}`);
  lines.push(`edit-me.txt now: ${JSON.stringify(read(join(p.proj, 'edit-me.txt')).trim())}`);
  lines.push(`MCP tool ran: ${existsSync(log.mcp)}`);
  lines.push(`hosts the engine contacted at the stand-in: ${stubHosts.join(', ')}   (any other host would not appear here; see network note in README)`);
  lines.push(`tool results seen by the model (tool_result blocks in stub log, trimmed): ${(stubText.match(/tool_result[^]{0,0}/g) ?? []).length}`);
  const results = [...stubText.matchAll(/\\"type\\":\\"tool_result\\"[^]*?\\"content\\":(\\"[^]*?\\"|\[[^]*?\])[,}]/g)].map((m) => m[1].slice(0, 140));
  lines.push(`tool_result texts the model got: ${JSON.stringify(results)}`);
  if (sc.proxy) lines.push(`connections that went to the proxy instead of the stand-in (${proxySeen.length}): ${JSON.stringify(proxySeen)}`);
  const summary = lines.join('\n');
  writeFileSync(join(dir, 'SUMMARY.txt'), summary + '\n');
  console.log(summary + '\n');
}

for (const n of names) await run(n);
