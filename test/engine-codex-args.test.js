import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_TOOLS, FEATURES_OFF, RESTRICTED_FEATURES_OFF, buildRun, configToml, loadSchema, profile, startCodex, threadStartParams, toolListCheck } from '../src/server/engines/codex.js';
import { createBridge } from '../src/server/engines/bridge.js';

// CLI-ENGINES §5.2: CE-1.12 to CE-1.16 for Codex: the policy, what Bunny answers, the tools off, the config rewritten each run, the sandbox, the pinned model and the tool-list check.

const FAKE = fileURLToPath(new URL('../src/server/engines/fake-engine.mjs', import.meta.url));
const launcher = [process.execPath, FAKE, 'codex'];
const noUpstream = async function* () { yield { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }; };

async function world() {
  const base = await mkdtemp(join(tmpdir(), 'bunny-cx-'));
  const root = join(base, 'proj'); const outside = join(base, 'outside'); const data = join(base, 'data');
  for (const d of [root, outside, data]) await mkdir(d, { recursive: true });
  return { base, root, outside, data, home: join(base, 'home') };
}
const bridgeFor = (w, opts = {}) => createBridge({ mode: opts.mode ?? 'auto', rules: opts.rules ?? [], root: w.root, protect: [w.data], keyFolders: [], ask: async () => opts.answer ?? true });

async function run(w, script, opts = {}) {
  const r = await startCodex({ cwd: w.root, prompt: 'do it', home: w.home, exe: 'C:\\E\\codex.exe', launcher, model: 'gpt-5.5', bridge: bridgeFor(w, opts.bridge), upstream: noUpstream, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify(script) }, schema: opts.schema ?? null, ...opts.start });
  const events = []; for await (const e of r.events) events.push(e);
  return { r, events };
}

test('the profile says what the adapter is: json-rpc, per-call, the Responses wire, local (default) and account, resumable', () => {
  assert.deepEqual([profile.id, profile.transport, profile.approvals, profile.wire, profile.auth, profile.resume, profile.runtime], ['codex', 'json-rpc', 'per-call', 'responses', ['local', 'account'], true, 'native']);
});

test('CE-1.14 / CE-1.15: config.toml has every feature off, web search disabled, no analytics, no update check, the unelevated sandbox, the project UNTRUSTED and never "trusted"; local mode has the Bunny provider with the token by name only', () => {
  const root = 'C:\\Users\\p\\Projects\\Demo';
  const full = configToml({ root, model: 'gpt-5.5', auth: 'local', mode: 'full', baseUrl: 'http://127.0.0.1:6000/v1' });
  for (const f of FEATURES_OFF) assert.match(full, new RegExp(`^${f} = false$`, 'm'), f);
  for (const f of ['view_image', 'apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'tool_suggest', 'computer_use', 'image_generation', 'goals', 'hooks']) assert.ok(FEATURES_OFF.includes(f), f);
  assert.match(full, /^web_search = "disabled"$/m); assert.match(full, /^check_for_update_on_startup = false$/m);
  assert.match(full, /\[analytics\]\nenabled = false/); assert.match(full, /\[windows\]\nsandbox = "unelevated"/);
  assert.match(full, /\[projects\.'c:\\Users\\p\\Projects\\Demo'\]\ntrust_level = "untrusted"/i);
  assert.doesNotMatch(full, /trust_level = "trusted"/); assert.doesNotMatch(full, /danger|never"|on-request|granular|bypass/i);
  assert.match(full, /^model_provider = "bunny"$/m); assert.match(full, /^model = "gpt-5\.5"$/m);
  assert.match(full, /\[model_providers\.bunny\]\nname = "Bunny AI"\nbase_url = "http:\/\/127\.0\.0\.1:6000\/v1"\nenv_key = "BUNNY_ENGINE_TOKEN"\nwire_api = "responses"\nrequires_openai_auth = false/);
  assert.doesNotMatch(full, /shell_tool|unified_exec/, 'full mode keeps the command tools');
  const restricted = configToml({ root, model: 'gpt-5.5', auth: 'local', mode: 'restricted', baseUrl: 'http://127.0.0.1:6000/v1' });
  for (const f of RESTRICTED_FEATURES_OFF) assert.match(restricted, new RegExp(`^${f} = false$`, 'm'), f);
  assert.deepEqual([...RESTRICTED_FEATURES_OFF], ['shell_tool', 'unified_exec']);
  assert.match(restricted, /^view_image = false$/m, 'view_image is off in restricted mode too');
  const account = configToml({ root, model: 'gpt-5.5', auth: 'account', mode: 'full' });
  assert.doesNotMatch(account, /model_providers|BUNNY_ENGINE_TOKEN|model_provider/);
  assert.match(account, /trust_level = "untrusted"/);
  assert.throws(() => configToml({ root, model: 'm', auth: 'local', mode: 'full' }), /endpoint/);
});

test('buildRun: the token is in the environment only, the home is isolated, the command line is just app-server; account mode has no endpoint token', () => {
  const run = buildRun({ exe: 'C:\\E\\codex.exe', home: 'C:\\B\\home', root: 'C:\\p', model: 'gpt-5.5', auth: 'local', endpoint: { base: 'http://127.0.0.1:6000/v1', token: 't'.repeat(64) } });
  assert.deepEqual(run.args, ['app-server']);
  assert.equal(run.env.BUNNY_ENGINE_TOKEN, 't'.repeat(64)); assert.equal(run.config.includes('t'.repeat(64)), false, 'not in config.toml'); assert.equal(run.args.join(' ').includes('t'.repeat(64)), false);
  assert.equal(run.env.CODEX_HOME, 'C:\\B\\home\\codex'); assert.equal(run.env.USERPROFILE, 'C:\\B\\home'); assert.equal(run.env.HOME, 'C:\\B\\home');
  const account = buildRun({ exe: 'e', home: 'C:\\B\\h', root: 'C:\\p', model: 'm', auth: 'account' });
  assert.equal('BUNNY_ENGINE_TOKEN' in account.env, false);
  assert.throws(() => buildRun({ exe: 'e', home: 'h', root: 'r', model: 'm', auth: 'local' }), /endpoint/);
});

test('CE-1.12 / CE-1.16: thread/start is always untrusted, ephemeral, with the pinned model name and the Bunny provider; the sandbox confines writes, and is read-only in Plan mode', () => {
  const normal = threadStartParams({ cwd: 'C:\\p', model: 'gpt-5.5' });
  assert.deepEqual(normal, { cwd: 'C:\\p', approvalPolicy: 'untrusted', sandbox: 'workspace-write', ephemeral: true, model: 'gpt-5.5', modelProvider: 'bunny' });
  assert.equal(threadStartParams({ cwd: 'x', model: 'm', planMode: true }).sandbox, 'read-only');
  for (const p of [normal, threadStartParams({ cwd: 'x', model: 'm', planMode: true })]) { assert.equal(p.approvalPolicy, 'untrusted'); assert.equal(p.ephemeral, true); assert.doesNotMatch(JSON.stringify(p), /granular|on-request|never|danger/); }
  assert.equal('model' in threadStartParams({ cwd: 'x', model: 'm', auth: 'account' }), false, 'account mode leaves the model to Codex');
});

test('the handshake: initialize never sends experimentalApi; thread/start carries untrusted + ephemeral + the pinned model; config.toml is REWRITTEN at the run start even when a run left "trusted" in it', async () => {
  const w = await world(); const dump = join(w.base, 'dump.json');
  await mkdir(join(w.home, 'codex'), { recursive: true });
  await writeFile(join(w.home, 'codex', 'config.toml'), `[projects.'${w.root.toLowerCase()}']\ntrust_level = "trusted"\n`);
  const { events } = await run(w, { dumpParams: dump, steps: [{ say: 'hi' }] });
  assert.equal(events.at(-1).type, 'done');
  const seen = JSON.parse(await readFile(dump, 'utf8'));
  assert.equal(JSON.stringify(seen.init).includes('experimentalApi'), false, 'no experimentalApi');
  assert.deepEqual([seen.thread.approvalPolicy, seen.thread.ephemeral, seen.thread.model, seen.thread.modelProvider, seen.thread.sandbox], ['untrusted', true, 'gpt-5.5', 'bunny', 'workspace-write']);
  assert.equal(seen.env.BUNNY_ENGINE_TOKEN, true); assert.equal(seen.env.CODEX_HOME, join(w.home, 'codex'));
  const config = await readFile(join(w.home, 'codex', 'config.toml'), 'utf8');
  assert.doesNotMatch(config, /trust_level = "trusted"/); assert.match(config, /trust_level = "untrusted"/);
});

test('CE-1.12: Bunny answers accept or decline, never acceptForSession; permissions and the legacy approvals are always declined; an elicitation is declined', async () => {
  const w = await world(); const a = join(w.base, 'a.json'); const b = join(w.base, 'b.json'); const c = join(w.base, 'c.json'); const d = join(w.base, 'd.json'); const e = join(w.base, 'e.json'); const f = join(w.base, 'f.json');
  const { events } = await run(w, { steps: [
    { command: 'echo hi', recordTo: a }, { command: 'echo no', recordTo: f, marker: null },
    { serverRequest: 'item/permissions/requestApproval', params: { itemId: 'x' }, recordTo: b }, { serverRequest: 'applyPatchApproval', params: {}, recordTo: c }, { serverRequest: 'execCommandApproval', params: {}, recordTo: d }, { serverRequest: 'mcpServer/elicitation/request', params: {}, recordTo: e }] });
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(JSON.parse(await readFile(a, 'utf8')).result, { decision: 'accept' }, 'accept, not acceptForSession');
  assert.equal(JSON.parse(await readFile(b, 'utf8')).error.code, -32000, 'permissions are refused');
  assert.deepEqual(JSON.parse(await readFile(c, 'utf8')).result, { decision: 'denied' }); assert.deepEqual(JSON.parse(await readFile(d, 'utf8')).result, { decision: 'denied' });
  assert.deepEqual(JSON.parse(await readFile(e, 'utf8')).result, { action: 'decline' });
  for (const file of [a, b, c, d, e, f]) assert.doesNotMatch(await readFile(file, 'utf8'), /acceptForSession/);
});

test('CE-1.13: a command is judged on its text (a deny rule declines it; the command does not run); a file change is judged per path: outside the folder, in the data folder, or unreadable is declined, inside is accepted', async () => {
  const { checkRule } = await import('../src/server/permissionRules.js');
  const w = await world(); const ran = join(w.base, 'ran.txt'); const ans = join(w.base, 'ans.json');
  const rules = [checkRule({ kind: 'command', pattern: 'git push*', effect: 'deny' }).rule];
  const denied = await run(w, { steps: [{ command: 'git push origin main', marker: ran, recordTo: ans }] }, { bridge: { rules } });
  assert.deepEqual(JSON.parse(await readFile(ans, 'utf8')).result, { decision: 'decline' }); assert.equal(existsSync(ran), false, 'it did not run');
  assert.equal(denied.events.find((e) => e.type === 'tool-end').ok, false);
  const patched = join(w.base, 'patched.txt');
  const mk = (path) => [{ path, kind: { type: 'add' }, diff: 'x\n' }];
  const decisions = [];
  for (const [label, changes, allow] of [['inside', mk(join(w.root, 'new.txt')), true], ['outside', mk(join(w.outside, 'x.txt')), false], ['data folder', mk(join(w.data, 'secret.json')), false], ['unreadable', [{ kind: { type: 'chmod' } }], false]]) {
    const rec = join(w.base, `rec-${label.replace(' ', '')}.json`);
    await run(w, { steps: [{ patch: changes, recordTo: rec, marker: allow ? patched : join(w.base, 'never.txt') }] });
    decisions.push([label, JSON.parse(await readFile(rec, 'utf8')).result.decision]);
  }
  assert.deepEqual(decisions, [['inside', 'accept'], ['outside', 'decline'], ['data folder', 'decline'], ['unreadable', 'decline']]);
  assert.equal(existsSync(join(w.base, 'never.txt')), false);
});

test('CE-1.16: the offered tools must be exactly the pin\'s: full mode five, restricted three; anything else is refused (and, through the endpoint, stops the run)', () => {
  assert.deepEqual(EXPECTED_TOOLS.full, ['exec_command', 'write_stdin', 'apply_patch', 'request_user_input', 'tool_search']);
  assert.deepEqual(EXPECTED_TOOLS.restricted, ['apply_patch', 'request_user_input', 'tool_search']);
  assert.equal(toolListCheck('full')(['exec_command', 'write_stdin', 'apply_patch', 'request_user_input', 'tool_search']), true);
  assert.equal(toolListCheck('full')(['exec_command']), true, 'fewer is fine');
  for (const extra of ['view_image', 'web_search', 'multi_agent_v1', 'get_goal', '?']) assert.match(toolListCheck('full')(['exec_command', extra]), new RegExp(`does not allow: ${extra.replace('?', '\\?')}`));
  assert.match(toolListCheck('restricted')(['apply_patch', 'exec_command']), /exec_command/, 'a command tool in restricted mode');
  assert.equal(toolListCheck('restricted')(['apply_patch', 'request_user_input', 'tool_search']), true);
});

test('the pinned schema file lists the method names the adapter relies on (the approval requests and the item and turn notifications)', async () => {
  const schema = await loadSchema();
  for (const m of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'applyPatchApproval', 'execCommandApproval', 'mcpServer/elicitation/request', 'item/tool/requestUserInput']) assert.ok(schema.requests.has(m), m);
  for (const m of ['item/started', 'item/completed', 'item/agentMessage/delta', 'item/commandExecution/outputDelta', 'turn/started', 'turn/completed', 'thread/tokenUsage/updated', 'error']) assert.ok(schema.notifications.has(m), m);
  for (const m of ['initialize', 'thread/start', 'turn/start', 'turn/interrupt']) assert.ok(schema.clientRequests.has(m), m);
});

test('CE-1.15 / EN-2: the project entry names the REAL folder: a short 8.3 name resolves to the long path before the config is written', async () => {
  const { canonicalRoot } = await import('../src/server/engines/codex.js');
  const { execFileSync } = await import('node:child_process');
  const base = await mkdtemp(join(tmpdir(), 'bunny-canon-'));
  const long = join(base, 'A Rather Long Project Name'); await mkdir(long, { recursive: true });
  let short = null;
  try { short = execFileSync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:CANON_DIR).ShortPath'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, CANON_DIR: long } }).trim(); } catch { /* no short names */ }
  if (short && short.toLowerCase() !== long.toLowerCase()) assert.equal((await canonicalRoot(short)).toLowerCase(), long.toLowerCase(), 'the 8.3 name resolves');
  assert.equal(await canonicalRoot(join(base, 'does-not-exist')), join(base, 'does-not-exist'), 'a missing folder is returned as it is');
  assert.match(configToml({ root: await canonicalRoot(long), model: 'm', auth: 'account' }), /a rather long project name/i);
});

test('EN-2 / CE-1.15 after the run: if Codex wrote trust_level = "trusted" for the project while it ran, Bunny puts the untrusted entry back at once', async () => {
  const w = await world();
  const r = await startCodex({ cwd: w.root, prompt: 'x', home: w.home, exe: 'x', launcher, model: 'gpt-5.5', bridge: bridgeFor(w), upstream: noUpstream, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ trustProject: true, steps: [{ say: 'hi' }] }) } });
  for await (const e of r.events) void e;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const config = await readFile(join(w.home, 'codex', 'config.toml'), 'utf8');
  assert.doesNotMatch(config, /trust_level = "trusted"/); assert.match(config, /trust_level = "untrusted"/);
  const { ensureUntrusted } = await import('../src/server/engines/codex.js');
  assert.deepEqual(await ensureUntrusted(join(w.home, 'codex', 'config.toml'), config), { fixed: false }, 'nothing to fix when it is already untrusted');
  assert.deepEqual(await ensureUntrusted(join(w.home, 'codex', 'nope.toml'), 'x'), { fixed: false });
});
