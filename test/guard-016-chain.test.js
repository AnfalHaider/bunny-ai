/**
 * W5-1 / item 5: the deny_all patterns judge each simple command, with quoted text and here-document bodies blanked.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { guard, makeRepo } from './guard-016-helpers.js';
import { simpleCommandTexts } from './guard-016-blank.js';

const FLAG = `--no-${'verify'}`;
const HOOKS = `core.hooks${'Path'}`;
const verdict = (t, command, role = 'builder') => guard.decide({ tool: 'Bash', command, cwd: makeRepo(t, role) });
const allowed = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, true, `should allow: ${c}\n${v.reason ?? ''}`); };
const denied = (t, c, role) => assert.equal(verdict(t, c, role).allow, false, `should deny: ${c}`);

test('item 5: a force flag on the next command of a chain is not a force push', (t) => {
  allowed(t, 'git push -q origin HEAD; git worktree remove --force d');
  allowed(t, 'git push -q origin claude/x && git worktree remove --force d');
  allowed(t, 'git push origin claude/x\ngit worktree remove --force d');
  denied(t, 'git push origin x --force');
  denied(t, 'git push -f origin claude/x');
  denied(t, 'echo ok; git push --force origin claude/x');
});

test('item 5: a flag inside quoted text or a here-document is data', (t) => {
  allowed(t, `echo "do not use ${FLAG}"`);
  allowed(t, `git commit -m "mentions ${FLAG}"`);
  allowed(t, `git commit -m 'also ${HOOKS} and git commit -n'`);
  allowed(t, `cat <<'EOF' > docs/n.md\nthe flag ${FLAG} and the key ${HOOKS}\nEOF\nls docs`);
  allowed(t, `cat <<-EOT > docs/n.md\n\tgit push --force\n\tEOT\nls`);
});

test('item 5: the real thing, however it is chained, is still refused', (t) => {
  denied(t, `git commit ${FLAG}`);
  denied(t, 'git commit -n -m x');
  denied(t, `echo x; git commit ${FLAG}`);
  denied(t, `git -c ${HOOKS}=/dev/null push`);
  denied(t, `git commit -m ok && git commit ${FLAG} -m again`);
  denied(t, 'git commit -$\'n\'');
  denied(t, 'echo ok; git reset --hard HEAD~1');
  denied(t, 'echo $(git push --force origin x)');
  denied(t, 'echo `git push -f origin x`');
  denied(t, 'sh -c "git commit -n"');
  denied(t, 'git push 2>&1 --force origin x');
});

test('item 5: patterns marked "whole" and commands that cannot be read keep the raw-text check', (t) => {
  denied(t, 'GIT_CONFIG_COUNT=1 git status');
  denied(t, 'echo "GIT_CONFIG_PARAMETERS is set"; ls');
  denied(t, 'git commit -n -m "unclosed');
});

test('item 5: the text cutter blanks quotes and heredocs and splits on separators, but not on redirections', () => {
  assert.deepEqual(simpleCommandTexts('git commit -m "a; b" && echo hi'), ['git commit -m', 'echo hi']);
  assert.deepEqual(simpleCommandTexts('git push 2>&1 --force x'), ['git push 2>_1 --force x']);
  assert.deepEqual(simpleCommandTexts("cat <<'EOF'\nsecret; git push --force\nEOF\nls"), ['cat <<\'EOF\'', 'ls']);
  assert.deepEqual(simpleCommandTexts("echo $'a;b'"), ["echo $'a", "b'"], 'ANSI-C text is kept raw');
  assert.deepEqual(simpleCommandTexts(''), []);
  assert.deepEqual(simpleCommandTexts('echo "unclosed'), ['echo "unclosed']);
});

test('item 5 review: text handed to an interpreter keeps the raw check (it is code, not a message)', (t) => {
  denied(t, `node -e "require('child_process').execSync('git push --force origin x')"`);
  denied(t, `python -c "import os; os.system('git reset --hard')"`);
  denied(t, `perl -e 'system("git push -f origin x")'`);
  denied(t, `bash -ec "git push --force origin x"`);
  denied(t, `echo go | xargs -I{} git push --force origin x`);
  allowed(t, `echo "not an interpreter: git push --force"`);
});

test('item 2 review: more variables that run programs', (t) => {
  for (const c of ['GIT_PAGER=evil git log', 'PAGER=evil git log', 'GIT_EXTERNAL_DIFF=evil git diff', 'GIT_PROXY_COMMAND=evil git fetch', 'GIT_TEMPLATE_DIR=x git init']) denied(t, c);
});
