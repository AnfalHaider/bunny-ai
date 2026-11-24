// Canaries E1, E2, OI-1: what do the real CLIs send to a model? A local stub endpoint records every request body; no account, no sign-in, dummy token, no internet needed.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2];
const CLAUDE = join(base, 'cc/package/claude.exe');
const CODEX = join(base, 'cx/codex-x86_64-pc-windows-msvc.exe');
const work = join(base, 'work');
rmSync(work, { recursive: true, force: true });

const bodies = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { bodies.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') }); res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'stub' } })); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function fixture(name) {
  const root = join(work, name);
  mkdirSync(join(root, 'sub'), { recursive: true }); mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), 'MARK_ROOT_CLAUDE_MD');
  writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'MARK_DOTCLAUDE_CLAUDE_MD');
  writeFileSync(join(root, 'sub', 'CLAUDE.md'), 'MARK_SUB_CLAUDE_MD');
  writeFileSync(join(root, 'AGENTS.md'), 'MARK_ROOT_AGENTS_MD');
  writeFileSync(join(root, 'sub', 'AGENTS.md'), 'MARK_SUB_AGENTS_MD');
  return root;
}
const MARKS = ['MARK_ROOT_CLAUDE_MD', 'MARK_DOTCLAUDE_CLAUDE_MD', 'MARK_SUB_CLAUDE_MD', 'MARK_ROOT_AGENTS_MD', 'MARK_SUB_AGENTS_MD'];

function run(cmd, args, { cwd, env, ms = 45000 }) {
  return new Promise((resolve) => {
    const start = bodies.length;
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    const done = () => { clearTimeout(kill); const seen = bodies.slice(start); resolve({ out: out.slice(0, 300), requests: seen.length, marks: MARKS.filter((m) => seen.some((b) => b.body.includes(m))) }); };
    p.on('close', done); p.on('error', done);
    // once the first request arrived and a moment passed, stop (the stub refuses every call)
    const t0 = Date.now(); const iv = setInterval(() => { if (bodies.length > start && Date.now() - t0 > 3000) { clearInterval(iv); setTimeout(() => { try { p.kill(); } catch {} }, 1500); } if (Date.now() - t0 > ms) clearInterval(iv); }, 300);
  });
}

const results = {};
const root = fixture('claude');
const cfg = join(base, 'cfg-empty'); mkdirSync(cfg, { recursive: true });
const claudeEnv = { CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'sk-ant-canary-dummy', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' };
for (const [label, cwd, extra] of [
  ['claude user-only, cwd=root', root, ['--setting-sources', 'user']],
  ['claude user-only, cwd=sub', join(root, 'sub'), ['--setting-sources', 'user']],
  ['claude CONTROL default sources, cwd=sub', join(root, 'sub'), []],
]) results[label] = await run(CLAUDE, ['-p', 'say hi', '--max-turns', '1', ...extra], { cwd, env: claudeEnv });

const croot = fixture('codex');
const home = join(base, 'codex-home'); mkdirSync(home, { recursive: true });
const toml = (docBytes) => ['model_provider = "stub"', 'model = "gpt-5.5"', ...(docBytes === null ? [] : [`project_doc_max_bytes = ${docBytes}`]), '', '[model_providers.stub]', 'name = "stub"', `base_url = "http://127.0.0.1:${port}/v1"`, 'env_key = "STUB_TOKEN"', 'wire_api = "responses"', 'requires_openai_auth = false', ''].join('\n');
for (const [label, cwd, bytes] of [
  ['codex doc_max_bytes=0, cwd=root', croot, 0],
  ['codex doc_max_bytes=0, cwd=sub', join(croot, 'sub'), 0],
  ['codex CONTROL default bytes, cwd=sub', join(croot, 'sub'), null],
]) {
  writeFileSync(join(home, 'config.toml'), toml(bytes));
  results[label] = await run(CODEX, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'say hi'], { cwd, env: { CODEX_HOME: home, STUB_TOKEN: 'dummy-canary-token', CODEX_DISABLE_TELEMETRY: '1' }, ms: 60000 });
}
server.close();
console.log(JSON.stringify(results, null, 1));
