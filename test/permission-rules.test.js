/**
 * W2-7: permission rules by command and path. Matching, precedence, scopes, validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkRule, normaliseRules, rulesFor, checkCommand, checkPath, checkToolCall, commandParts, coveredByDeny, readDenied, MAX_RULES } from '../src/server/permissionRules.js';

const R = (kind, effect, pattern, extra = {}) => ({ id: `${effect}-${pattern}`, kind, effect, pattern, scope: 'All folders', ...extra });
const cmd = (effect, pattern) => R('command', effect, pattern);
const path = (effect, pattern, ops = 'edits') => R('path', effect, pattern, { ops });

test('a command rule: * is the only wildcard, case does not matter, and the whole simple command is matched', () => {
  const rules = [cmd('allow', 'npm test*'), cmd('allow', 'npm run build')];
  assert.equal(checkCommand(rules, 'npm test')?.effect, 'allow');
  assert.equal(checkCommand(rules, 'NPM test --watch')?.effect, 'allow');
  assert.equal(checkCommand(rules, 'npm run build')?.effect, 'allow');
  assert.equal(checkCommand(rules, 'npm run build --prod'), null, 'no star: exactly that command');
  assert.equal(checkCommand(rules, 'npm install'), null);
  assert.equal(checkCommand([cmd('allow', 'node (a|b).js')], 'node a.js'), null, 'a regular expression is just text here');
  assert.equal(checkCommand([cmd('allow', 'git *')], 'git status')?.effect, 'allow');
});

test('precedence: deny beats ask beats allow, whichever order the rules are in', () => {
  const rules = [cmd('allow', 'git *'), cmd('ask', 'git push*'), cmd('deny', 'git push --force*')];
  assert.equal(checkCommand(rules, 'git status')?.effect, 'allow');
  assert.equal(checkCommand(rules, 'git push origin x')?.effect, 'ask');
  assert.equal(checkCommand(rules, 'git push --force origin x')?.effect, 'deny');
  assert.equal(checkCommand([...rules].reverse(), 'git push --force origin x')?.effect, 'deny');
});

test('an allow rule never covers a chained or substituted command; deny and ask see every part', () => {
  const rules = [cmd('allow', 'npm test*'), cmd('deny', 'Remove-Item -Recurse*'), cmd('ask', 'git push*')];
  assert.equal(checkCommand(rules, 'npm test; rm -rf x'), null, 'the second command is not allowed');
  assert.equal(checkCommand(rules, 'npm test && npm test')?.effect, 'allow', 'both parts are allowed');
  assert.equal(checkCommand(rules, 'npm test | cat'), null);
  assert.equal(checkCommand(rules, 'npm test $(rm x)'), null, 'a command substitution is never allowed');
  assert.equal(checkCommand(rules, 'npm test `rm x`'), null);
  assert.equal(checkCommand(rules, 'npm test > out.txt'), null, 'a redirect to a file is a write');
  assert.equal(checkCommand(rules, 'npm test 2>&1')?.effect, 'allow', '2>&1 is plumbing');
  assert.equal(checkCommand(rules, 'npm test\nrm -rf x'), null, 'a new line is another command');
  assert.equal(checkCommand(rules, 'echo hi; Remove-Item -Recurse build')?.effect, 'deny', 'a deny sees the later part');
  assert.equal(checkCommand(rules, 'echo $(git push origin main)')?.effect, 'ask', 'and what is inside $( )');
  assert.equal(checkCommand(rules, 'echo `git push origin main`')?.effect, 'ask');
  assert.equal(checkCommand(rules, 'cd x && git push')?.effect, 'ask');
  assert.equal(checkCommand(rules, '& git push origin x')?.effect, 'ask', 'the PowerShell call operator');
});

test('quotes are respected when cutting a command, and && inside them is text', () => {
  assert.deepEqual(commandParts('echo "a && b" ; npm test').parts, ['echo "a && b"', 'npm test']);
  assert.deepEqual(commandParts("echo 'a; b'").parts, ["echo 'a; b'"]);
  assert.equal(commandParts('echo "$(x)"').unsafe, true);
  assert.equal(commandParts("echo '$(x)'").unsafe, false);
  assert.deepEqual(commandParts('').parts, []);
  assert.equal(checkCommand([cmd('allow', 'echo *')], ''), null);
});

test('a path rule judges edits or reads, never the other', () => {
  const rules = [path('deny', 'secrets/**', 'edits'), path('deny', '.env*', 'reads'), path('allow', 'docs/**', 'edits')];
  assert.equal(checkPath(rules, 'secrets/key.txt', 'edits')?.effect, 'deny');
  assert.equal(checkPath(rules, 'secrets/key.txt', 'reads'), null, 'an edits rule is silent about reading');
  assert.equal(checkPath(rules, '.env.local', 'reads')?.effect, 'deny');
  assert.equal(checkPath(rules, 'docs/a.md', 'edits')?.effect, 'allow');
  assert.equal(checkPath(rules, 'src/a.js', 'edits'), null);
  assert.equal(checkPath(rules, 'secrets\\deep\\x', 'edits')?.effect, 'deny', 'backslashes');
  assert.equal(checkPath(rules, './secrets/x', 'edits')?.effect, 'deny');
  assert.equal(checkPath(rules, 'secrets', 'edits')?.effect, 'deny', 'the folder itself');
  assert.equal(readDenied(rules, '.env'), true);
  assert.equal(readDenied(rules, 'src/a.js'), false);
});

test('checkToolCall: the right argument for each tool; unknown tools are not judged', () => {
  const rules = [cmd('deny', 'rm *'), path('deny', 'secrets/**', 'edits'), path('ask', 'prod/**', 'reads')];
  assert.equal(checkToolCall(rules, 'run_command', { command: 'rm x' })?.effect, 'deny');
  assert.equal(checkToolCall(rules, 'start_process', { command: 'rm x' })?.effect, 'deny');
  assert.equal(checkToolCall(rules, 'write_file', { path: 'secrets/a', content: 'x' })?.effect, 'deny');
  assert.equal(checkToolCall(rules, 'multi_edit', { path: 'secrets/a', edits: [] })?.effect, 'deny');
  assert.equal(checkToolCall(rules, 'read_file', { path: 'prod/a' })?.effect, 'ask');
  assert.equal(checkToolCall(rules, 'list_files', {})?.effect ?? null, null, 'listing "." matches nothing here');
  assert.equal(checkToolCall(rules, 'browser_click', { selector: 'a' }), null);
});

test('scopes: a folder\'s own rules come first, global ones apply everywhere, other folders\' rules do not', () => {
  const stored = { global: [cmd('deny', 'rm *')], folders: { 'D:\\Work\\app': [cmd('allow', 'npm test*')], 'D:\\Work\\other': [cmd('deny', 'node *')] } };
  const here = rulesFor(stored, 'd:\\work\\APP');
  assert.deepEqual(here.map((r) => [r.pattern, r.scope]), [['npm test*', 'This folder'], ['rm *', 'All folders']]);
  assert.deepEqual(rulesFor(stored, 'D:\\Elsewhere').map((r) => r.pattern), ['rm *']);
  assert.deepEqual(rulesFor(stored, null).map((r) => r.pattern), ['rm *']);
});

test('checkRule: valid rules are tidied; bad ones say why on the line', () => {
  assert.equal(checkRule({ kind: 'command', effect: 'allow', pattern: '  npm   test* ' }).rule.pattern, 'npm test*');
  assert.equal(checkRule({ kind: 'path', effect: 'deny', pattern: 'secrets\\**', ops: 'reads' }).rule.ops, 'reads');
  assert.equal(checkRule({ kind: 'path', effect: 'deny', pattern: 'secrets/**' }).rule.ops, 'edits', 'edits by default');
  for (const [bad, why] of [
    [{ kind: 'path', effect: 'allow', pattern: '..\\secrets\\**' }, /cannot leave the folder/],
    [{ kind: 'path', effect: 'allow', pattern: 'a/../../b' }, /cannot leave the folder/],
    [{ kind: 'path', effect: 'allow', pattern: 'C:\\x\\**' }, /relative to the folder/],
    [{ kind: 'path', effect: 'allow', pattern: '/etc/**' }, /relative to the folder/],
    [{ kind: 'path', effect: 'allow', pattern: '~/x' }, /relative to the folder/],
    [{ kind: 'command', effect: 'allow', pattern: '' }, /Type a pattern/],
    [{ kind: 'command', effect: 'allow', pattern: 'x'.repeat(201) }, /at most 200/],
    [{ kind: 'command', effect: 'allow', pattern: 'a\nb' }, /one line/],
    [{ kind: 'command', effect: 'maybe', pattern: 'a' }, /Deny, Ask or Allow/],
    [{ kind: 'url', effect: 'allow', pattern: 'a' }, /Command or Path/],
    [null, /Command or Path/],
  ]) assert.match(checkRule(bad).error ?? '', why, JSON.stringify(bad));
});

test('normaliseRules drops what cannot be trusted and keeps the cap', () => {
  const stored = { global: [cmd('deny', 'a*'), { kind: 'path', effect: 'allow', pattern: '../x' }, 'junk', null], folders: { 'D:\\a': [cmd('ask', 'b*')], 'D:\\b': 'nope', 'D:\\c': [] } };
  const n = normaliseRules(stored);
  assert.deepEqual(n.global.map((r) => r.pattern), ['a*']);
  assert.deepEqual(Object.keys(n.folders), ['D:\\a']);
  assert.deepEqual(normaliseRules(undefined), { global: [], folders: {} });
  assert.deepEqual(normaliseRules('x'), { global: [], folders: {} });
  const many = { global: Array.from({ length: MAX_RULES + 50 }, (_, i) => cmd('allow', `x${i}`)) };
  assert.equal(normaliseRules(many).global.length, MAX_RULES);
});

test('an Allow that a Deny already covers is reported', () => {
  const rules = [cmd('deny', 'Remove-Item -Recurse*'), path('deny', 'secrets/**', 'edits')];
  assert.equal(coveredByDeny(rules, { kind: 'command', effect: 'allow', pattern: 'Remove-Item -Recurse build' })?.pattern, 'Remove-Item -Recurse*');
  assert.equal(coveredByDeny(rules, { kind: 'path', effect: 'allow', pattern: 'secrets/x.txt', ops: 'edits' })?.pattern, 'secrets/**');
  assert.equal(coveredByDeny(rules, { kind: 'command', effect: 'allow', pattern: 'npm test' }), null);
  assert.equal(coveredByDeny(rules, { kind: 'command', effect: 'deny', pattern: 'Remove-Item -Recurse build' }), null, 'only an Allow is warned about');
});

test('pathological patterns and commands finish at once', () => {
  const t0 = Date.now();
  const nasty = [cmd('deny', '*a*a*a*a*a*a*a*a*a*a*a*b')];
  assert.equal(checkCommand(nasty, 'a'.repeat(5000)), null);
  assert.equal(checkPath([path('deny', '*a*a*a*a*a*a*a*a*b/**')], 'a'.repeat(300), 'edits'), null);
  assert.ok(commandParts('echo '.repeat(20000)).parts.length >= 1);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});

test('review: grouping, script blocks, carriage returns and control characters are other commands (deny and ask see them, allow never covers them)', () => {
  const rules = [cmd('allow', 'npm test*'), cmd('deny', 'rm *'), cmd('ask', 'git push*')];
  for (const sneaky of ['npm test (rm x)', 'npm test; (rm x)', 'npm test @(rm x)', 'npm test { rm x }', 'npm test\rrm x', 'npm test rm x', 'npm test\u0085rm x', 'npm test\u000brm x']) {
    assert.notEqual(checkCommand(rules, sneaky)?.effect, 'allow', JSON.stringify(sneaky));
  }
  assert.equal(checkCommand(rules, 'npm test\rrm x')?.effect, 'deny');
  assert.equal(checkCommand(rules, 'echo (git push origin x)')?.effect, 'ask');
  assert.equal(checkCommand(rules, '& { git push origin x }')?.effect, 'ask');
  assert.equal(checkCommand(rules, 'echo hi rm -rf x')?.effect, 'deny');
  assert.equal(checkCommand(rules, 'npm test --grep "a (b)"')?.effect, 'allow', 'parentheses inside quotes are text');
});

test('review: a path is judged as typed, collapsed, and as the real file; an Allow needs every spelling allowed', () => {
  const rules = [path('deny', 'secrets/**', 'edits'), path('allow', 'docs/**', 'edits')];
  assert.equal(checkToolCall(rules, 'write_file', { path: 'docs/../secrets/key.txt' })?.effect, 'deny', 'collapsed ".."');
  assert.equal(checkToolCall(rules, 'write_file', { path: 'a/b/../../secrets/key.txt' })?.effect, 'deny');
  assert.equal(checkToolCall(rules, 'write_file', { path: 'docs/a.md' }, 'secrets/real.md')?.effect, 'deny', 'a link that leads into secrets/');
  assert.equal(checkToolCall(rules, 'write_file', { path: 'docs/a.md' }, 'docs/a.md')?.effect, 'allow');
  assert.equal(checkToolCall(rules, 'write_file', { path: 'docs/a.md' }, 'src/x.md'), null, 'the real file is not under docs/: the Allow does not apply');
  assert.equal(checkToolCall(rules, 'edit_file', { path: 'docs/./sub//a.md' })?.effect, 'allow');
});
