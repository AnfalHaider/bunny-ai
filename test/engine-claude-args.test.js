import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISALLOWED_TOOLS, EXPECTED_TOOLS, QUIET_ENV, buildArgs, buildRun, buildSettings, createClaudeReader, denyRules, hookCommandLine, profile } from '../src/server/engines/claude-code.js';
import { createEventQueue } from '../src/server/engines/events.js';
import { checkRule } from '../src/server/permissionRules.js';

// CLI-ENGINES §5.2: CE-1.8 and CE-1.9 for Claude Code: what the spawn always has and never has, what the generated settings hold, the tool-list check.

const rule = (r) => checkRule(r).rule;
const base = { exe: 'C:\\E\\claude.exe', home: 'C:\\Bunny\\engines\\claude-code\\local\\chat\\c1', hookPath: 'C:\\Bunny\\h\\bunny-pretooluse.cjs', runtimePath: 'C:\\Program Files\\Bunny\\Bunny.exe', bridge: { port: 5555, token: 'b'.repeat(64) } };
const FORBIDDEN = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions', 'acceptEdits', '--permission-prompt-tool', 'dontAsk', '--allowedTools', '--allowed-tools', '--mcp-config', '-c', '--continue'];

test('the profile says what the adapter is: jsonl, per-call, the Messages wire in local mode, account and local, resumable', () => {
  assert.deepEqual([profile.id, profile.transport, profile.approvals, profile.wire, profile.auth, profile.resume, profile.runtime], ['claude-code', 'jsonl', 'per-call', 'messages', ['account', 'local'], true, 'native']);
});

for (const mode of ['full', 'restricted']) {
  for (const planMode of [false, true]) {
    test(`CE-1.8: the spawn (${mode}${planMode ? ', Plan mode' : ''}) always has --permission-prompts none, --setting-sources user, --settings, --strict-mcp-config and the --disallowedTools names; never anything that bypasses or allows; the prompt is not on the command line`, () => {
      const args = buildArgs({ mode, planMode, settingsPath: 'C:\\s\\bunny-settings.json', resumeId: null });
      const at = (flag) => args[args.indexOf(flag) + 1];
      assert.equal(at('--permission-prompts'), 'none');
      assert.equal(at('--setting-sources'), 'user');
      assert.equal(at('--settings'), 'C:\\s\\bunny-settings.json');
      assert.ok(args.includes('--strict-mcp-config'));
      const names = args.slice(args.indexOf('--disallowedTools') + 1, args.findIndex((a, i) => i > args.indexOf('--disallowedTools') && a.startsWith('--')) === -1 ? undefined : args.findIndex((a, i) => i > args.indexOf('--disallowedTools') && a.startsWith('--')));
      for (const n of ['WebSearch', 'Agent', 'Task', 'Skill', 'CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree']) assert.ok(names.includes(n), `${n} is disallowed (the nine proven names)`);
      for (const n of ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'SendMessage', 'ListAgents', 'ScheduleWakeup', 'Workflow', 'ReportFindings', 'Monitor']) assert.ok(names.includes(n), `${n} is disallowed too`);
      assert.deepEqual(names, [...DISALLOWED_TOOLS]);
      for (const bad of FORBIDDEN) assert.equal(args.includes(bad), false, `no ${bad}`);
      assert.equal(args.includes('--permission-mode'), planMode, 'Plan mode adds --permission-mode plan, and nothing else does');
      if (planMode) assert.equal(at('--permission-mode'), 'plan');
      assert.equal(args.includes('--restricted'), mode === 'restricted');
      assert.equal(args[0], '-p'); assert.equal(args[args.indexOf('-p') + 1].startsWith('--'), true, '-p has no prompt after it: the prompt goes to stdin');
      assert.equal(at('--input-format'), 'stream-json'); assert.equal(at('--output-format'), 'stream-json');
      assert.ok(!args.some((a) => /\.\.\.|hello|prompt/i.test(a) && !a.startsWith('--')), 'no prompt text in the arguments');
    });
  }
}

test('a resumed chat adds --resume <id>; a model name only when one is given', () => {
  const a = buildArgs({ mode: 'full', settingsPath: 's', resumeId: 'sess-1', model: 'claude-sonnet-4-5' });
  assert.equal(a[a.indexOf('--resume') + 1], 'sess-1'); assert.equal(a[a.indexOf('--model') + 1], 'claude-sonnet-4-5');
  assert.equal(buildArgs({ mode: 'full', settingsPath: 's' }).includes('--resume'), false);
});

test('CE-1.9: the settings hold the hook on every tool and a deny list, and NOTHING that allows or asks: every deny rule, read-deny path, the data folder, engine homes, protected and key folders, and every read-Ask path', () => {
  const rules = [
    rule({ kind: 'command', pattern: 'git push*', effect: 'deny' }), rule({ kind: 'command', pattern: 'git status*', effect: 'allow' }), rule({ kind: 'command', pattern: 'npm publish*', effect: 'ask' }),
    rule({ kind: 'path', ops: 'reads', pattern: 'secrets', effect: 'deny' }), rule({ kind: 'path', ops: 'reads', pattern: 'notes/**', effect: 'ask' }), rule({ kind: 'path', ops: 'reads', pattern: 'docs/**', effect: 'allow' }),
    rule({ kind: 'path', ops: 'edits', pattern: 'src/locked/**', effect: 'deny' }), rule({ kind: 'path', ops: 'edits', pattern: 'src/other/**', effect: 'ask' }),
  ];
  const deny = denyRules({ rules, root: 'C:\\proj', protect: ['C:\\Users\\p\\AppData\\Local\\BunnyAI', 'C:\\Users\\p\\AppData\\Local\\BunnyAI\\engines\\claude-code\\local'], keyFolders: ['C:\\Users\\p\\.ssh', 'C:\\Users\\p\\.claude'], hidden: ['C:\\proj\\.env'] });
  assert.ok(deny.includes('Bash(git push*)'), 'a command deny rule');
  assert.ok(deny.includes('Read(./secrets)') && deny.includes('Read(./secrets/**)'), 'a read-deny path, and what is under it');
  assert.ok(deny.includes('Read(./notes/**)'), 'a read-ASK path is denied (CE-1.9: a hook allow does not pass an ask read)');
  assert.ok(deny.includes('Edit(./src/locked/**)'), 'an edit-deny path');
  assert.ok(deny.includes('Read(//C:/Users/p/AppData/Local/BunnyAI/**)') && deny.includes('Edit(//C:/Users/p/AppData/Local/BunnyAI/**)'), 'the data folder, for reading and editing');
  assert.ok(deny.some((d) => d.includes('engines/claude-code/local')), 'an engine home');
  assert.ok(deny.includes('Read(//C:/Users/p/.ssh/**)') && deny.includes('Read(//C:/Users/p/.claude/**)'), 'key folders');
  assert.ok(deny.includes('Read(//C:/proj/.env)'), 'a hidden path');
  for (const not of ['Bash(git status*)', 'Read(./docs/**)', 'Bash(npm publish*)', 'Edit(./src/other/**)']) assert.equal(deny.includes(not), false, `${not} is not a deny`);
  const settings = buildSettings({ hookCommand: 'x', deny });
  assert.deepEqual(Object.keys(settings).sort(), ['hooks', 'permissions']);
  assert.deepEqual(Object.keys(settings.permissions), ['deny'], 'no allow, no ask, no defaultMode');
  assert.equal(JSON.stringify(settings).includes('"allow"'), false); assert.equal(JSON.stringify(settings).includes('"ask"'), false); assert.equal(/bypass|acceptEdits/.test(JSON.stringify(settings)), false);
  assert.deepEqual(deny, [...new Set(deny)].sort(), 'sorted, no repeats (a stable file)');
});

test('the hook is on every tool (matcher *), its command is absolute (Bunny\'s runtime and the script), and its timeout is above the longest an Ask card waits', () => {
  const s = buildSettings({ hookCommand: hookCommandLine('C:\\Program Files\\Bunny\\Bunny.exe', 'C:\\h\\bunny-pretooluse.cjs'), deny: [] });
  const h = s.hooks.PreToolUse[0];
  assert.equal(h.matcher, '*'); assert.equal(h.hooks[0].type, 'command');
  assert.equal(h.hooks[0].command, '"C:/Program Files/Bunny/Bunny.exe" "C:/h/bunny-pretooluse.cjs"');
  assert.match(h.hooks[0].command, /^"[A-Za-z]:\//, 'an absolute path, never a bare node');
  assert.ok(h.hooks[0].timeout > 10 * 60, 'longer than 10 minutes (the Ask limit)');
});

test('buildRun: local mode carries the endpoint and the run token and no vendor credential; account mode carries no endpoint and no token; both are quiet and isolated; the bridge token is by environment only', () => {
  const local = buildRun({ ...base, auth: 'local', endpoint: { base: 'http://127.0.0.1:6000/v1', token: 'e'.repeat(64) }, deny: ['Read(./x)'] });
  assert.equal(local.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:6000'); assert.equal(local.env.ANTHROPIC_API_KEY, 'e'.repeat(64)); assert.equal(local.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
  assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in local.env, false);
  const account = buildRun({ ...base, auth: 'account' });
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(k in account.env, false, `account mode has no ${k}`);
  for (const run of [local, account]) {
    for (const [k, v] of Object.entries(QUIET_ENV)) assert.equal(run.env[k], v, k);
    assert.equal(run.env.CLAUDE_CONFIG_DIR, `${base.home}\\config`); assert.equal(run.env.USERPROFILE, base.home); assert.equal(run.env.HOME, base.home);
    assert.equal(run.env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(run.env.BUNNY_BRIDGE_TOKEN, 'b'.repeat(64));
    assert.equal(run.args.join(' ').includes('b'.repeat(64)), false, 'the token is never on the command line');
    assert.equal(run.args.join(' ').includes('e'.repeat(64)), false);
  }
  assert.throws(() => buildRun({ ...base, auth: 'local' }), /endpoint/);
  assert.equal(account.file, base.exe);
});

test('CE-1.16: the tool list the pin expects: full mode and restricted mode; PowerShell only when Bunny turned it on; restricted never lists a command tool', () => {
  assert.deepEqual(EXPECTED_TOOLS.full, ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Bash', 'WebFetch', 'ToolSearch']);
  assert.deepEqual(EXPECTED_TOOLS.restricted, EXPECTED_TOOLS.full.filter((t) => !['Bash', 'WebFetch'].includes(t)));
  assert.deepEqual(buildRun({ ...base, usePowerShell: true }).expectedTools.slice(-1), ['PowerShell']);
  assert.equal(buildRun({ ...base, mode: 'restricted', usePowerShell: true }).expectedTools.includes('PowerShell'), false);
  assert.equal(buildRun({ ...base, usePowerShell: true }).env.CLAUDE_CODE_USE_POWERSHELL_TOOL, '1');
  assert.equal('CLAUDE_CODE_USE_POWERSHELL_TOOL' in buildRun(base).env, false);
});

function init(tools, opts = {}) {
  const q = createEventQueue();
  const r = createClaudeReader({ queue: q, bridge: { seen: () => true }, ...opts });
  return { q, r, feed: () => r.feed(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools })) };
}

test('a system/init tool list with anything outside the pin\'s expected set stops the run (a renamed or new tool after an update); the expected sets pass', () => {
  assert.doesNotThrow(() => init(EXPECTED_TOOLS.full).feed());
  assert.doesNotThrow(() => init(['Read', 'Write']).feed(), 'fewer is fine');
  for (const tools of [[...EXPECTED_TOOLS.full, 'Agent'], [...EXPECTED_TOOLS.full, 'WebSearch'], ['Read', 'mcp__evil__do'], [...EXPECTED_TOOLS.full, 'BrandNewTool'], [...EXPECTED_TOOLS.full, 'PowerShell']]) {
    assert.throws(() => init(tools).feed(), /does not expect/, tools.at(-1));
  }
  assert.doesNotThrow(() => init([...EXPECTED_TOOLS.full, 'PowerShell'], { expectedTools: [...EXPECTED_TOOLS.full, 'PowerShell'] }).feed(), 'PowerShell when Bunny turned it on');
  assert.throws(() => init(EXPECTED_TOOLS.full, { mode: 'restricted', expectedTools: [...EXPECTED_TOOLS.full] }).feed(), /command tool in restricted mode/);
  assert.doesNotThrow(() => init(EXPECTED_TOOLS.restricted, { mode: 'restricted', expectedTools: EXPECTED_TOOLS.restricted }).feed());
  const none = createClaudeReader({ queue: createEventQueue(), bridge: { seen: () => true } });
  assert.throws(() => none.feed(JSON.stringify({ type: 'system', subtype: 'init' })), /did not list its tools/);
});
