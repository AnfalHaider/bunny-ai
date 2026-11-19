import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClaude } from '../src/server/engines/claude-code.js';
import { startCodex } from '../src/server/engines/codex.js';
import { createBridge } from '../src/server/engines/bridge.js';
import { createEngineService } from '../src/server/engines/service.js';
import { minimalEnv } from '../src/server/engines/process.js';

// CLI-ENGINES §5.2 (CE-3, CE-4.3, CE-8): the spawned environment is safeEnv plus the named variables only; the home is isolated and rewritten at each start; the token never appears in the spawn
// arguments; the engine's home variables point into the isolated folder (so the person's own hostile configs are never found); no credential variable in local mode, no token in account mode;
// an incognito chat's folder is removed.

const FAKE = fileURLToPath(new URL('../src/server/engines/fake-engine.mjs', import.meta.url));
const SECRETS = { OPENAI_API_KEY: 'sk-parent-0123456789abcdef', ANTHROPIC_API_KEY: 'sk-ant-parent-0123456789abcdef', GITHUB_TOKEN: 'ghp_parentparentparentparent0123', AWS_SECRET_ACCESS_KEY: 'parentsecretparentsecret01', OPENROUTER_API_KEY: 'or-parent-key-0123456789' };

async function world() { const base = await mkdtemp(join(tmpdir(), 'bunny-env-')); const root = join(base, 'proj'); await mkdir(root, { recursive: true }); return { base, root, home: join(base, 'home') }; }
const allow = async () => ({ allow: true });
const bridge = (w) => createBridge({ mode: 'auto', rules: [], root: w.root, protect: [], keyFolders: [], ask: async () => true });
const noUpstream = async function* () { yield { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }; };

async function withParentSecrets(fn) {
  const keep = {}; for (const [k, v] of Object.entries(SECRETS)) { keep[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
async function drain(r) { for await (const e of r.events) void e; }

test('the engine environment has none of Bunny\'s own variables or keys (not even ones set in the parent), only the minimal Windows set', async () => {
  await withParentSecrets(() => {
    const env = minimalEnv();
    for (const k of Object.keys(SECRETS)) assert.equal(k in env, false, k);
    assert.ok(Object.keys(env).every((k) => ['SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'PATH', 'Path', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'].includes(k)));
  });
});

test('Claude Code: every home variable points into the isolated folder; no parent key; no vendor credential in local mode, no endpoint token in account mode; the bridge token only by environment', async () => {
  await withParentSecrets(async () => {
    for (const auth of ['account', 'local']) {
      const w = await world(); const dump = join(w.base, `env-${auth}.json`);
      const r = await startClaude({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', auth, upstream: auth === 'local' ? async function* () { /* the stand-in never asks */ } : null, judge: allow, launcher: [process.execPath, FAKE, 'claude-code'], extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ dumpEnv: dump, steps: [] }) } });
      await drain(r);
      const { env, argv } = JSON.parse(await readFile(dump, 'utf8'));
      assert.equal(JSON.stringify(env).includes('parent'), false, `${auth}: nothing of the parent's secrets`);
      for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CLAUDE_CONFIG_DIR']) assert.ok(String(env[k]).startsWith(w.home), `${auth}: ${k} is inside the isolated home (${env[k]})`);
      assert.equal(argv.join(' ').includes(env.BUNNY_BRIDGE_TOKEN), false, 'the token is not on the command line');
      if (auth === 'local') { assert.match(env.ANTHROPIC_API_KEY, /^[a-f0-9]{64}$/); assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in env, false); assert.match(env.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/); }
      else for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(k in env, false, `account mode has no ${k}`);
    }
  });
});

test('Codex: the isolated CODEX_HOME and home variables; no parent key; the endpoint token only in local mode and only by environment; config.toml is rewritten at each start', async () => {
  await withParentSecrets(async () => {
    for (const auth of ['local', 'account']) {
      const w = await world(); const dump = join(w.base, `env-${auth}.json`);
      await mkdir(join(w.home, 'codex'), { recursive: true });
      await writeFile(join(w.home, 'codex', 'config.toml'), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n'); // a hostile leftover
      const r = await startCodex({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', auth, model: 'gpt-5.5', bridge: bridge(w), upstream: noUpstream, launcher: [process.execPath, FAKE, 'codex'], extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ dumpEnv: dump, steps: [] }) } });
      await drain(r);
      const { env, argv } = JSON.parse(await readFile(dump, 'utf8'));
      assert.equal(JSON.stringify(env).includes('parent'), false, `${auth}: nothing of the parent's secrets`);
      for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']) assert.ok(String(env[k]).startsWith(w.home), `${auth}: ${k}`);
      assert.equal(typeof env.BUNNY_ENGINE_TOKEN, auth === 'local' ? 'string' : 'undefined');
      if (auth === 'local') assert.equal(argv.join(' ').includes(env.BUNNY_ENGINE_TOKEN), false);
      const config = await readFile(join(w.home, 'codex', 'config.toml'), 'utf8');
      assert.doesNotMatch(config, /danger-full-access|approval_policy = "never"/, 'the hostile leftover was rewritten');
      assert.match(config, /trust_level = "untrusted"/);
      if (auth === 'account') assert.match(config, /cli_auth_credentials_store = "file"/); else assert.doesNotMatch(config, /cli_auth_credentials_store/);
    }
  });
});

test('an incognito chat\'s engine folder is removed when the reply ends; a normal chat\'s is kept', async () => {
  const prev = process.env.BUNNY_FAKE_ENGINE_SCRIPT;
  process.env.BUNNY_FAKE_ENGINE_SCRIPT = JSON.stringify({ steps: [{ say: 'ok' }] });
  try {
    for (const incognito of [true, false]) {
      const dataDir = await mkdtemp(join(tmpdir(), 'bunny-svc-')); const root = join(dataDir, 'proj'); await mkdir(root, { recursive: true });
      const service = createEngineService({ dataDir, fake: true });
      const turn = { id: 'chat-1', session: { engine: { id: 'claude-code', auth: 'account' } }, settings: {}, content: 'x', root, permissionMode: 'auto', send: () => {}, logStep: async () => {}, askPermission: async () => true, signal: null, incognito, beforeWrite: async () => {}, writeReal: async () => {} };
      const out = await service.runTurn(turn);
      assert.equal(out.ok, true);
      assert.equal(existsSync(join(dataDir, 'engines', 'claude-code', 'account', 'chat', 'chat-1')), !incognito, incognito ? 'removed' : 'kept');
    }
  } finally { if (prev === undefined) delete process.env.BUNNY_FAKE_ENGINE_SCRIPT; else process.env.BUNNY_FAKE_ENGINE_SCRIPT = prev; }
});
