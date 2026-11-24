// Canaries E1, E2, OI-1 and spike S-F13B on the PINNED engine binaries, offline, no account, no sign-in (second run, Security's requests of 2026-11-24).
//   node scripts/canary-engines.mjs <base> <out.json>   (use <base> = docs/security/canary-out (git-ignored) and copy the JSON to docs/security/canary-YYYY-MM-DD.json; never test-results/, Playwright empties that folder)
// <base> holds cc/package/claude.exe and cx/codex-x86_64-pc-windows-msvc.exe (each file's sha256 is checked against src/server/engines/pins.json by whoever unpacked them).
// A local stub endpoint records every request body; the fixture files carry unique marker text. Claude Code gets a dummy API key; Codex a dummy token.
//   Static runs:   Claude Code under --setting-sources user and with default sources (control); Codex with project_doc_max_bytes = 0 and with the default (control), fixture is a git repo.
//   Lazy run:      the stub answers Claude Code's first request with one tool_use Read of sub/x.txt and its next with end_turn; the SECOND request is checked for the subfolder CLAUDE.md.
//   S-F13B:        `codex app-server` command/exec under windows.sandbox = "unelevated" with a CODEX_HOME outside %TEMP%: what a command may write, with and without a sandboxPolicy.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = resolve(process.argv[2]);
const outFile = resolve(process.argv[3] ?? join(base, 'canary.json'));
const CLAUDE = join(base, 'cc/package/claude.exe');
const CODEX = join(base, 'cx/codex-x86_64-pc-windows-msvc.exe');
const work = join(base, 'work');
rmSync(work, { recursive: true, force: true });

const MARKS = ['MARK_ROOT_CLAUDE_MD', 'MARK_DOTCLAUDE_CLAUDE_MD', 'MARK_SUB_CLAUDE_MD', 'MARK_ROOT_AGENTS_MD', 'MARK_SUB_AGENTS_MD'];
const bodies = [];
let script = null; // (reqIndexInRun, body) => SSE answer for Claude Code, or null for a plain 400

const sse = (events) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const msgStart = { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-stub', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } };
const toolUseAnswer = (name, input) => sse([['message_start', msgStart], ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_stub1', name, input: {} } }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }], ['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]]);
const textAnswer = (text) => sse([['message_start', msgStart], ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }], ['content_block_stop', { type: 'content_block_stop', index: 0 }], ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', { type: 'message_stop' }]]);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    bodies.push({ url: req.url, body, at: Date.now() });
    const answer = script ? script(body) : null;
    if (answer) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(answer); return; }
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'stub' } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function fixture(name, { git = false } = {}) {
  const root = join(work, name);
  mkdirSync(join(root, 'sub'), { recursive: true }); mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), 'MARK_ROOT_CLAUDE_MD');
  writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'MARK_DOTCLAUDE_CLAUDE_MD');
  writeFileSync(join(root, 'sub', 'CLAUDE.md'), 'MARK_SUB_CLAUDE_MD');
  writeFileSync(join(root, 'AGENTS.md'), 'MARK_ROOT_AGENTS_MD');
  writeFileSync(join(root, 'sub', 'AGENTS.md'), 'MARK_SUB_AGENTS_MD');
  writeFileSync(join(root, 'sub', 'x.txt'), 'plain file the model is told to read');
  if (git) execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  return root;
}
const marksIn = (text) => MARKS.filter((m) => text.includes(m));

/** Run one process; ends when it exits, when `until(seen)` is true (then a short grace), or at `ms`. */
function run(cmd, args, { cwd, env, ms = 60000, until }) {
  return new Promise((resolveRun) => {
    const start = bodies.length;
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; let finished = false;
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const done = () => {
      if (finished) return; finished = true; clearInterval(iv); clearTimeout(kill);
      const seen = bodies.slice(start);
      resolveRun({ requests: seen.length, perRequest: seen.map((b, i) => ({ n: i + 1, url: b.url, bytes: b.body.length, hasToolResult: /"tool_result"/.test(b.body), marks: marksIn(b.body) })), marks: marksIn(seen.map((b) => b.body).join('\n')), tail: out.slice(-240).replace(/\s+/g, ' ') });
    };
    const kill = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    const t0 = Date.now(); let satisfiedAt = 0;
    const iv = setInterval(() => {
      const seen = bodies.slice(start);
      if (!satisfiedAt && (until ? until(seen) : seen.length > 0)) satisfiedAt = Date.now();
      if (satisfiedAt && Date.now() - satisfiedAt > 2500) { try { p.kill(); } catch {} }
      if (Date.now() - t0 > ms) { try { p.kill(); } catch {} }
    }, 250);
    p.on('close', done); p.on('error', done);
  });
}

const raw = { ran: new Date().toISOString().slice(0, 10), stub: 'local 127.0.0.1, dummy tokens, empty account folders, no sign-in', runs: [] };
const record = (label, what, result) => { raw.runs.push({ label, what, ...result }); console.log(label, '→ requests', result.requests, 'marks', JSON.stringify(result.marks)); };

// ---- Claude Code 2.1.311
const croot = fixture('claude');
const cfg = join(base, 'cfg-empty'); mkdirSync(cfg, { recursive: true });
const claudeEnv = { CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-canary-dummy', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' };
const readAnswer = (file) => (body) => {
  if (!/"name":\s*"Read"/.test(body)) return textAnswer('ok'); // a side request without the Read tool
  return /"tool_result"/.test(body) ? textAnswer('done') : toolUseAnswer('Read', { file_path: file });
};
script = null;
for (const [label, cwd, extra, what] of [
  ['claude-static-user-root', croot, ['--setting-sources', 'user'], 'E1/E2: user sources only, cwd = root'],
  ['claude-static-user-sub', join(croot, 'sub'), ['--setting-sources', 'user'], 'E1/E2: user sources only, cwd = subfolder'],
  ['claude-static-default-sub-CONTROL', join(croot, 'sub'), [], 'control: default sources, cwd = subfolder (expects root, .claude and sub CLAUDE.md)'],
  ['claude-static-default-root-CONTROL', croot, [], 'control: default sources, cwd = root'],
]) record(label, what, await run(CLAUDE, ['-p', 'say hi', '--max-turns', '1', ...extra], { cwd, env: claudeEnv }));

script = readAnswer(join(croot, 'sub', 'x.txt'));
for (const [label, extra, what] of [
  ['claude-lazy-user-root', ['--setting-sources', 'user'], 'lazy subfolder case, user sources only, cwd = root: the model reads sub/x.txt; the SECOND request must not carry MARK_SUB_CLAUDE_MD'],
  ['claude-lazy-default-root-CONTROL', [], 'lazy control, default sources, cwd = root: the SECOND request should carry MARK_SUB_CLAUDE_MD'],
]) {
  const r = await run(CLAUDE, ['-p', 'read sub/x.txt then say done', '--max-turns', '3', '--allowedTools', 'Read', ...extra], { cwd: croot, env: claudeEnv, ms: 90000, until: (seen) => seen.some((b) => /"tool_result"/.test(b.body)) });
  const second = r.perRequest.find((q) => q.hasToolResult);
  record(label, what, { ...r, secondRequestMarks: second ? second.marks : null, sawSecondRequest: Boolean(second) });
}
script = null;

// ---- Codex 0.170.0 (a git repo at the fixture root)
const xroot = fixture('codex', { git: true });
const home = join(base, 'codex-home'); mkdirSync(home, { recursive: true });
const toml = (docBytes) => ['model_provider = "stub"', 'model = "gpt-5.5"', ...(docBytes === null ? [] : [`project_doc_max_bytes = ${docBytes}`]), '', '[model_providers.stub]', 'name = "stub"', `base_url = "http://127.0.0.1:${port}/v1"`, 'env_key = "STUB_TOKEN"', 'wire_api = "responses"', 'requires_openai_auth = false', ''].join('\n');
for (const [label, cwd, bytes, what] of [
  ['codex-max0-root', xroot, 0, 'OI-1: project_doc_max_bytes = 0, git root, cwd = root'],
  ['codex-max0-sub', join(xroot, 'sub'), 0, 'OI-1: project_doc_max_bytes = 0, cwd = subfolder of the git root'],
  ['codex-default-root-CONTROL', xroot, null, 'control: default, cwd = root'],
  ['codex-default-sub-CONTROL', join(xroot, 'sub'), null, 'control: default, cwd = subfolder of the git root (expects root and sub AGENTS.md)'],
]) {
  writeFileSync(join(home, 'config.toml'), toml(bytes));
  record(label, what, await run(CODEX, ['exec', '--sandbox', 'read-only', 'say hi'], { cwd, env: { CODEX_HOME: home, STUB_TOKEN: 'dummy-canary-token', CODEX_DISABLE_TELEMETRY: '1' }, ms: 60000 }));
}

// ---- S-F13B: command/exec through Codex's own sandbox (no model, no account)
async function exec13b() {
  const f13 = join(base, 'f13'); rmSync(f13, { recursive: true, force: true });
  const project = join(f13, 'project'); const outside = join(f13, 'outside'); const h = join(base, 'codex-home-f13'); rmSync(h, { recursive: true, force: true });
  for (const d of [project, outside, h]) mkdirSync(d, { recursive: true });
  writeFileSync(join(h, 'config.toml'), ['[windows]', 'sandbox = "unelevated"', ''].join('\n'));
  const child = spawn(CODEX, ['app-server'], { cwd: project, env: { ...process.env, CODEX_HOME: h }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map(); let nextId = 1; let buf = ''; const log = [];
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else log.push(line.slice(0, 200)); } catch {} } });
  let err = ''; child.stderr.on('data', (d) => { err += d; });
  const send = (o) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
  const call = (method, params, ms = 420000) => new Promise((res) => { const id = nextId++; const t = setTimeout(() => { pending.delete(id); res({ timeout: true }); }, ms); pending.set(id, (m) => { clearTimeout(t); res(m); }); send({ id, method, params }); });
  const out = { home: h, project, outside, steps: [] };
  const init = await call('initialize', { clientInfo: { name: 'canary', title: 'canary', version: '1' } }, 30000);
  out.initialize = init.timeout ? 'timeout' : (init.error ? init.error : 'ok');
  send({ method: 'initialized' });
  const attempt = async (label, command, extra = {}) => { const t0 = Date.now(); const r = await call('command/exec', { command, cwd: project, ...extra }); out.steps.push({ label, seconds: Math.round((Date.now() - t0) / 100) / 10, result: r.timeout ? 'timeout' : (r.error ?? { exitCode: r.result?.exitCode, stdout: String(r.result?.stdout ?? '').slice(0, 200), stderr: String(r.result?.stderr ?? '').slice(0, 300) }) }); };
  const ps = (script) => ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script]; // PowerShell: paths with spaces are single-quoted inside the one argument (cmd /c quoting made the first run's outside steps fail for the wrong reason)
  const put = (path) => ps(`Set-Content -LiteralPath '${path}' -Value x -ErrorAction Stop`);
  const policy = { type: 'workspaceWrite', writableRoots: [project], networkAccess: false };
  await attempt('write inside the project, workspaceWrite policy (first command: sets up the sandbox identity, can be slow)', put(join(project, 'inside.txt')), { sandboxPolicy: policy });
  await attempt('write outside the project, workspaceWrite policy (expect refused)', put(join(outside, 'outside.txt')), { sandboxPolicy: policy });
  await attempt('read outside the project, workspaceWrite policy (reads are not stopped)', ps(`Get-Content -LiteralPath '${join(base, 'work', 'claude', 'CLAUDE.md')}' -ErrorAction Stop`), { sandboxPolicy: policy });
  await attempt('write inside, readOnly policy (expect refused)', put(join(project, 'ro.txt')), { sandboxPolicy: { type: 'readOnly' } });
  await attempt('write outside with NO sandboxPolicy (the configured default)', put(join(outside, 'default.txt')));
  out.files = { 'project/inside.txt': existsSync(join(project, 'inside.txt')), 'outside/outside.txt': existsSync(join(outside, 'outside.txt')), 'project/ro.txt': existsSync(join(project, 'ro.txt')), 'outside/default.txt': existsSync(join(outside, 'default.txt')) };
  out.otherMessages = log.slice(0, 5); out.stderrTail = err.slice(-300).replace(/\s+/g, ' ');
  try { child.kill(); } catch {}
  return out;
}
raw.sF13B = await exec13b();
console.log('S-F13B files', JSON.stringify(raw.sF13B.files));

server.close();
writeFileSync(outFile, `${JSON.stringify(raw, null, 1)}\n`);
console.log('wrote', outFile);
