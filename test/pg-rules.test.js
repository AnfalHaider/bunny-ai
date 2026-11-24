/**
 * PERMISSIONS-GAPS PG-1, PG-2, PG-3 and PG-5 (spec: docs/plans/PERMISSIONS-GAPS-spec.md, with Security's PG1-a to PG5-d).
 * Pure rule logic, the website check at every redirect hop, and the read-only commands with real git in an invented repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkRule, coveredByDeny, normaliseRules } from '../src/server/permissionRules.js';
import { agentKey, allowSkipsCard, checkAgent, checkDomain, checkToolName, hostOf, readOnlyCommand, toolKey } from '../src/server/pgRules.js';
import { fetchLimited, hopJudge } from '../src/server/download.js';

const R = (kind, effect, pattern) => ({ id: `${kind}-${effect}-${pattern}`, kind, effect, pattern, scope: 'All folders' });
const dom = (effect, pattern) => R('domain', effect, checkRule({ kind: 'domain', effect, pattern }).rule.pattern);

// ---- PG-1

test('PG1-a: a host is normalised before matching: case, trailing dot, punycode, IP forms, ports', () => {
  assert.equal(hostOf('https://EXAMPLE.com./a'), 'example.com');
  assert.equal(hostOf('https://example.com:8443/a'), 'example.com');
  assert.equal(hostOf('http://2130706433/'), '127.0.0.1');
  assert.equal(hostOf('http://0x7f.1/'), '127.0.0.1');
  assert.equal(hostOf('https://bücher.example/'), 'xn--bcher-kva.example');
  assert.equal(hostOf('file:///c:/x'), null);
  assert.equal(checkDomain([dom('deny', 'example.com')], 'https://EXAMPLE.com./x')?.effect, 'deny');
  assert.equal(checkDomain([dom('deny', 'bücher.example')], 'https://xn--bcher-kva.example/')?.effect, 'deny');
  assert.equal(checkDomain([dom('deny', '127.0.0.1')], 'http://2130706433:8080/')?.effect, 'deny');
});

test('PG1-a: *.x.com matches subdomains only, x.com matches exactly, the editor takes whole addresses too', () => {
  assert.equal(checkDomain([dom('deny', '*.paste.io')], 'https://x.paste.io/a')?.effect, 'deny');
  assert.equal(checkDomain([dom('deny', '*.paste.io')], 'https://a.b.paste.io/a')?.effect, 'deny');
  assert.equal(checkDomain([dom('deny', '*.paste.io')], 'https://paste.io/a'), null, 'the bare domain is not a subdomain');
  assert.equal(checkDomain([dom('deny', '*.paste.io')], 'https://evilpaste.io/a'), null);
  assert.equal(checkDomain([dom('deny', 'paste.io')], 'https://x.paste.io/a'), null, 'exact only');
  assert.equal(checkRule({ kind: 'domain', effect: 'ask', pattern: 'https://Example.com:8080/path?q=1' }).rule.pattern, 'example.com');
  assert.ok(checkRule({ kind: 'domain', effect: 'ask', pattern: '' }).error);
  assert.ok(checkRule({ kind: 'domain', effect: 'ask', pattern: 'not a host!' }).error);
});

test('domain rules: deny beats ask beats allow', () => {
  const rules = [dom('allow', '*.example.com'), dom('ask', 'api.example.com'), dom('deny', 'bad.example.com')];
  assert.equal(checkDomain(rules, 'https://www.example.com/')?.effect, 'allow');
  assert.equal(checkDomain(rules, 'https://api.example.com/')?.effect, 'ask');
  assert.equal(checkDomain(rules, 'https://bad.example.com/')?.effect, 'deny');
  assert.equal(checkDomain(rules, 'https://other.org/'), null);
});

async function redirectServer(location) {
  const server = http.createServer((req, res) => { res.writeHead(302, { location }); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/start` };
}

test('PG-1: a deny refuses a fetch of the host and a redirect to it from an allowed host, at that hop', async () => {
  const rules = [dom('deny', '*.paste.io')];
  const seen = [];
  const judge = async (url) => { seen.push(url); const v = checkDomain(rules, url); if (v?.effect === 'deny') throw new Error(`Blocked by your rule: ${hostOf(url)}`); };
  await assert.rejects(hopJudge.run(judge, () => fetchLimited('https://x.paste.io/a')), /Blocked by your rule: x\.paste\.io/);
  const { server, url } = await redirectServer('http://x.paste.io/steal');
  try {
    await assert.rejects(hopJudge.run(judge, () => fetchLimited(url, { allowLoopback: true })), /Blocked by your rule: x\.paste\.io/);
    assert.equal(seen.length, 3, 'the first address and the redirect target were each judged');
    assert.match(seen[2], /x\.paste\.io\/steal/);
  } finally { server.close(); }
});

test('PG1-b: an allow never weakens the private-address refusal', async () => {
  const judge = async (url) => { assert.equal(checkDomain([dom('allow', '*')], url)?.effect, 'allow'); };
  await assert.rejects(hopJudge.run(judge, () => fetchLimited('http://127.0.0.1:9/')), /private network|find the host|will not fetch/);
  await assert.rejects(hopJudge.run(judge, () => fetchLimited('http://192.168.1.5/')), /private network|find the host|will not fetch/);
});

// ---- PG-2

test('PG-2: a tool rule matches by name; a connector tool is keyed by connector id plus its own tool name', () => {
  const rules = [R('tool', 'ask', 'c-notion:*'), R('tool', 'deny', 'computer_*'), R('tool', 'allow', 'gmail_send')];
  const entry = { server: { id: 'c-notion', name: 'Notion' }, tool: { name: 'create_page' } };
  assert.equal(toolKey('notion_create_page', entry), 'c-notion:create_page');
  assert.equal(checkToolName(rules, toolKey('notion_create_page', entry))?.effect, 'ask');
  // PG2-a: renaming the connector or the model-facing name changes nothing; the key is the id and the original name
  const renamed = { server: { id: 'c-notion', name: 'My Notes' }, tool: { name: 'create_page' } };
  assert.equal(checkToolName(rules, toolKey('mynotes_create_page_2', renamed))?.effect, 'ask');
  assert.equal(checkToolName(rules, 'computer_click')?.effect, 'deny');
  assert.equal(checkToolName(rules, 'browser_open'), null);
  assert.ok(checkRule({ kind: 'tool', effect: 'ask', pattern: 'spaces are not names' }).error);
  assert.equal(checkRule({ kind: 'tool', effect: 'ask', pattern: 'browser_*' }).rule.pattern, 'browser_*');
});

test('PG2-c: an allow rule can never skip a send; app.js asks needsOk, here the pieces it relies on', () => {
  assert.equal(allowSkipsCard('gmail_send'), true, 'the risk of a send is what keeps the card: needsOk checks risk !== send');
  assert.equal(allowSkipsCard('message_session'), false, 'PG3-a');
});

// ---- PG-3

test('PG-3: agent keys and rules', () => {
  assert.equal(agentKey('run_subagent', { job: 'research' }), 'helper:research');
  assert.equal(agentKey('run_subagent', {}), 'helper:code');
  assert.equal(agentKey('start_session', {}), 'chat:start');
  assert.equal(agentKey('move_to_new_chat', {}), 'chat:start');
  assert.equal(agentKey('message_session', {}), 'chat:message');
  assert.equal(agentKey('read_file', {}), null);
  const rules = [R('agent', 'deny', 'helper:*'), R('agent', 'ask', 'chat:message'), R('agent', 'allow', 'chat:start')];
  assert.equal(checkAgent(rules, 'helper:code')?.effect, 'deny');
  assert.equal(checkAgent(rules, 'chat:message')?.effect, 'ask');
  assert.equal(checkAgent(rules, 'chat:start')?.effect, 'allow');
  assert.ok(checkRule({ kind: 'agent', effect: 'ask', pattern: 'helpers please' }).error);
  assert.equal(checkRule({ kind: 'agent', effect: 'ask', pattern: 'Helper:Code' }).rule.pattern, 'helper:code');
});

test('stored rules of the new kinds survive normalising; a new allow under a deny is flagged', () => {
  const stored = { global: [{ kind: 'domain', effect: 'deny', pattern: '*.paste.io' }, { kind: 'agent', effect: 'ask', pattern: 'chat:start' }, { kind: 'nonsense', effect: 'deny', pattern: 'x' }], folders: {} };
  assert.deepEqual(normaliseRules(stored).global.map((r) => r.kind), ['domain', 'agent']);
  const rules = [R('domain', 'deny', '*.paste.io')];
  assert.ok(coveredByDeny(rules, R('domain', 'allow', 'x.paste.io')));
  assert.equal(coveredByDeny(rules, R('domain', 'allow', 'example.com')), null);
});

// ---- PG-5

const insideOnly = async (arg) => !/^(\.\.|outside|secret)/i.test(arg) && !/\.\.[\\/]/.test(arg);

test('PG-5: the listed read-only commands qualify, git forms are rewritten with fixed options', async () => {
  const st = await readOnlyCommand('git status', insideOnly);
  assert.equal(st.command, 'git -c core.fsmonitor= -c core.pager=cat -c diff.external= --no-pager status');
  const df = await readOnlyCommand('git diff --stat src/a.js', insideOnly);
  assert.equal(df.command, 'git -c core.fsmonitor= -c core.pager=cat -c diff.external= --no-pager diff --no-ext-diff --no-textconv --stat -- src/a.js');
  assert.match((await readOnlyCommand('git log --oneline -n 20', insideOnly)).command, /--no-pager log --oneline -n 20$/);
  assert.match((await readOnlyCommand('git log -p', insideOnly)).command, /log --no-ext-diff --no-textconv -p$/);
  assert.equal((await readOnlyCommand('dir', insideOnly)).command, 'dir');
  assert.equal((await readOnlyCommand('Get-ChildItem -Recurse src', insideOnly)).command, 'Get-ChildItem -Recurse src');
  assert.equal((await readOnlyCommand('type README.md', insideOnly)).command, 'type README.md');
  assert.equal((await readOnlyCommand('Get-Content -TotalCount 20 a.txt', insideOnly)).command, 'Get-Content -TotalCount 20 a.txt');
  assert.equal((await readOnlyCommand('npm ls', insideOnly)).command, 'npm ls');
  assert.equal((await readOnlyCommand('node --version', insideOnly)).command, 'node --version');
  assert.equal((await readOnlyCommand('git status; git diff', insideOnly)).command.split('; ').length, 2);
});

test('PG-5: chained, redirected, substituted or piped lines ask', async () => {
  for (const line of ['git status; rm -r x', 'git log > out.txt', 'Get-Content a | Set-Content b', 'git status | clip', 'git status && git push', 'git status $(whoami)',
    'git status `whoami`', 'type a.txt > b.txt', 'echo hi', 'git status &', 'cmd /c git status', '& git status']) {
    assert.equal(await readOnlyCommand(line, insideOnly), null, line);
  }
});

test('PG5-c: only the listed forms and flags; an unknown flag, git\'s own options and extra arguments ask', async () => {
  for (const line of ['git log --format=%H', 'git log --pretty=format:x', 'git -c core.pager=less status', 'git -C .. status', 'git --git-dir=x status', 'git status --foo',
    'git push', 'git branch -D x', 'git diff --ext-diff', 'git show HEAD', 'npm ls x', 'npm list --all', 'npm install', 'node --version x', 'node -e 1', 'dir /x', 'type', 'Get-Content -Wait a.txt', 'Remove-Item a']) {
    assert.equal(await readOnlyCommand(line, insideOnly), null, line);
  }
});

test('PG5-b: a path argument must be vouched for; outside the folder, a drive, ~, $HOME and read-denied paths ask', async () => {
  for (const line of ['type ..\\outside.txt', 'Get-Content $HOME\\.ssh\\id_ed25519', 'type C:\\Users\\x\\.ssh\\id_ed25519', 'type ~/.ssh/id_rsa', 'dir \\\\server\\share', 'type /etc/passwd', 'git diff -- ..\\x', 'type secret.txt']) {
    assert.equal(await readOnlyCommand(line, insideOnly), null, line);
  }
});

test('PG5-a: in an invented repository, git as Bunny runs it does not start a repository-configured program', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-pg5-'));
  try {
    const run = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, 'none'), GIT_CONFIG_NOSYSTEM: '1' } });
    run('init', '-q');
    run('config', 'user.email', 'a@b.c'); run('config', 'user.name', 'T');
    writeFileSync(join(dir, 'a.txt'), 'one\n'); run('add', '.'); run('commit', '-qm', 'one');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const probe = join(dir, 'probe.cmd');
    const marker = join(dir, 'RAN');
    writeFileSync(probe, `@echo off\r\necho x> "${marker}"\r\n`);
    const sh = probe.replace(/\\/g, '/');
    run('config', 'core.fsmonitor', sh);
    run('config', 'diff.external', sh);
    const status = (await readOnlyCommand('git status', insideOnly)).command.replace(/^git /, '');
    const diff = (await readOnlyCommand('git diff', insideOnly)).command.replace(/^git /, '');
    execFileSync('git', status.split(' '), { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, 'none'), GIT_CONFIG_NOSYSTEM: '1' } });
    execFileSync('git', diff.split(' '), { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, 'none'), GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(existsSync(marker), false, 'the probe program was never started');
    // and the control: without Bunny\'s fixed options the same repository does start it
    try { execFileSync('git', ['status'], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, 'none'), GIT_CONFIG_NOSYSTEM: '1' } }); } catch { /* the probe may fail git's protocol: only the marker matters */ }
    assert.equal(existsSync(marker), true, 'control: the plain command does run the configured program');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PG2-d: a hand-typed "notion:*" is refused; the picker\'s form (connector id, or *:) works', () => {
  const typed = checkRule({ kind: 'tool', effect: 'ask', pattern: 'notion:*' });
  assert.equal(typed.error, 'Pick the connector from the list, then type the tool name.');
  assert.ok(checkRule({ kind: 'tool', effect: 'ask', pattern: 'notion:create_page' }).error);
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(checkRule({ kind: 'tool', effect: 'ask', pattern: `${id}:*` }).rule.pattern, `${id}:*`);
  assert.equal(checkRule({ kind: 'tool', effect: 'deny', pattern: '*:delete_*' }).rule.pattern, '*:delete_*');
  assert.equal(checkRule({ kind: 'tool', effect: 'ask', pattern: 'browser_*' }).rule.pattern, 'browser_*');
});
