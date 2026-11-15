/**
 * G-1 / C and A3: the hook-skip rules read the command through the tokenizer, not a regex over the
 * raw text. Words are judged; prose that merely mentions a flag is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { guard, makeRepo } from './guard-helpers.js';

// Flag texts are assembled so this file never contains them as one literal.
const SKIP = `--no-${'verify'}`;
const HOOKS = `core.hooks${'Path'}`;

function verdict(t, command, role = 'builder') {
  const root = makeRepo(t, role);
  return guard.decide({ tool: 'Bash', command, cwd: root });
}
const allowed = (t, c, role) => assert.equal(verdict(t, c, role).allow, true, `should allow: ${c}\n${verdict(t, c, role).reason ?? ''}`);
const denied = (t, c, role) => assert.equal(verdict(t, c, role).allow, false, `should deny: ${c}`);

test('C allow: a flag inside a quoted message is data', (t) => {
  allowed(t, 'git commit -m "fix -n handling"');
  allowed(t, `git commit -m "explain ${SKIP} in the docs"`);
  allowed(t, 'git commit -am x');
  allowed(t, 'git -C "a b" commit -m x');
  allowed(t, 'git commit -mn', 'builder'); // the message is "n"
  allowed(t, 'git commit -m x -m y');
  allowed(t, 'git push -n origin claude/x'); // a dry run, not a hook skip
  allowed(t, 'git merge -n topic');
  allowed(t, `echo "git commit -n ${SKIP} ${HOOKS}"`);
  allowed(t, 'git commit --amend --no-edit');
  allowed(t, 'git commit -F msg.txt');
  allowed(t, 'git log --oneline -n 5');
});

test('C allow: prose about the flags written into a file through a heredoc', (t) => {
  allowed(t, `cat <<'EOF' > docs/note.md\nthe flag ${SKIP} and the key ${HOOKS} and git commit -n\nEOF\nls docs`);
  allowed(t, `printf '%s\\n' "see ${SKIP}" > docs/n.md`);
});

test('C deny: skipping the commit hooks, however it is spelled', (t) => {
  denied(t, 'git commit -n');
  denied(t, 'git commit -n -m x');
  denied(t, 'git commit -an -m x');
  denied(t, 'git commit -nm x');
  denied(t, `git commit -m x ${SKIP}`);
  denied(t, `git commit ${SKIP} -m x`);
  denied(t, 'git commit --no-verif -m x'); // git accepts unique prefixes
  denied(t, 'git commit --no-ve -m x');
  denied(t, `git -C d commit ${SKIP}`);
  denied(t, 'git -C "a b" -c user.name=x commit -n');
  denied(t, 'git --no-pager commit -n');
  denied(t, 'FOO=1 git commit -n');
  denied(t, 'env git commit -n');
  denied(t, '/usr/bin/git commit -n');
  denied(t, '"C:\\Program Files\\Git\\cmd\\git.exe" commit -n');
  denied(t, 'git.exe commit -n');
  denied(t, 'echo ok && git commit -n');
  denied(t, 'cd x; git commit -n');
  denied(t, 'echo $(git commit -n)');
  denied(t, 'sh -c "git commit -n"');
  denied(t, 'bash -lc \'git commit --no-ve\'');
  denied(t, 'powershell -Command "git commit -n"');
  denied(t, `git push ${SKIP}`);
  denied(t, `git merge ${SKIP} topic`);
  denied(t, `git -C d push ${SKIP} origin x`);
});

test('A3 deny: pointing git at another hooks folder, for any subcommand', (t) => {
  denied(t, `git -c ${HOOKS}=x commit -m y`);
  denied(t, `git -c ${HOOKS}=x push origin claude/x`);
  denied(t, `git -c ${HOOKS.toLowerCase()}=/dev/null push`);
  denied(t, `git -C d -c ${HOOKS}=x status`);
  denied(t, `git --config-env ${HOOKS}=HOOKVAR push`);
  denied(t, `git --config-env=${HOOKS}=HOOKVAR push`);
  denied(t, `git config ${HOOKS} x`);
  denied(t, `git config --global ${HOOKS} x`);
  denied(t, `git -c alias.p=push p ${SKIP}`);
  denied(t, `GIT_CONFIG_COUNT=1 git status`);
});

test('A3 allow: the key name as plain prose', (t) => {
  allowed(t, `echo "${HOOKS} is how git finds hooks"`);
  allowed(t, `git commit -m "document ${HOOKS}"`);
  allowed(t, `git config user.name`);
});

test('A3 deny: the attached -c form, quoted or not, for commit and push', (t) => {
  denied(t, `git -c${HOOKS}=x commit -m y`);
  denied(t, `git -c${HOOKS}=x push origin claude/x`);
  denied(t, `git "-c${HOOKS}=x" commit -m y`);
  denied(t, `git '-c${HOOKS}=x' push`);
  denied(t, `git -C d -c${HOOKS.toLowerCase()}=x status`);
  allowed(t, 'git -cuser.name=x status');
  allowed(t, 'git -Cdir status');
});

test('Push of every branch is refused for a role that may not push live; allowed for one that may', (t) => {
  denied(t, 'git push --all origin', 'builder');
  denied(t, 'git push origin --all', 'builder');
  denied(t, 'git push --mirror origin', 'builder');
  denied(t, 'git -C d push --mirror', 'qa');
  denied(t, 'git push origin "refs/heads/*:refs/heads/*"', 'builder');
  denied(t, 'git push origin refs/heads/*:refs/heads/*', 'tech-lead');
  denied(t, 'git push origin HEAD:refs/heads/*', 'builder');
  allowed(t, 'git push origin claude/builder-x', 'builder');
  allowed(t, 'git push --tags origin', 'builder');
  allowed(t, 'echo "git push --all"', 'builder');
  allowed(t, 'git push --all origin', 'release-ops');
});

test('A5 deny: setting the role from a command', (t) => {
  denied(t, 'BOOTSTRAP_ROLE=chief-of-staff git commit -m x');
  denied(t, 'export BOOTSTRAP_ROLE=chief-of-staff');
  denied(t, '$env:BOOTSTRAP_ROLE = "chief-of-staff"');
  denied(t, 'set BOOTSTRAP_ROLE=chief-of-staff');
  allowed(t, 'echo "the BOOTSTRAP_ROLE variable names the role"');
});

test('A5 deny: a role change by a session that already has a role (first assignment is allowed)', (t) => {
  denied(t, 'node .bootstrap/bin/bootstrap.mjs role chief-of-staff', 'builder');
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs role builder', 'chief-of-staff');
  const root = makeRepo(t, null);
  assert.equal(guard.decide({ tool: 'Bash', command: 'node .bootstrap/bin/bootstrap.mjs role builder', cwd: root }).allow, true, 'unassigned may take its first role');
});

test('C: the live-branch push check follows the tokenizer through global options', (t) => {
  denied(t, 'git -C d push origin main', 'builder');
  denied(t, 'git push origin "HEAD:main"', 'builder');
  denied(t, 'git push origin HEAD:refs/heads/main', 'builder');
  allowed(t, 'git push origin claude/builder-x', 'builder');
  allowed(t, 'echo "git push origin main"', 'builder');
  allowed(t, 'git push origin main', 'release-ops');
});

test('C: force pushes are caught through global options and bundles; prose is not', (t) => {
  denied(t, 'git -C d push -f origin x');
  denied(t, 'git push --force-with-lease origin x');
  denied(t, 'git push origin +claude/x');
  denied(t, 'git -C d reset --hard HEAD~1');
  allowed(t, 'git commit -m "never git push -f"');
});

test('C malformed: unbalanced quotes fall back to the strict patterns; empty and huge commands finish', (t) => {
  assert.equal(verdict(t, '').allow, true);
  assert.equal(verdict(t, 'git commit -m "unclosed').allow, true, 'an unclosed quote with no flag');
  assert.equal(verdict(t, 'git commit -n -m "unclosed').allow, false, 'an unclosed quote does not hide a skip: strict fallback');
  const t0 = Date.now();
  assert.equal(verdict(t, `git commit -m "${'x '.repeat(500_000)}"`).allow, true);
  assert.ok(Date.now() - t0 < 4000, 'a 1 MB command finishes inside the 10 s hook limit');
});

test('C: switching shell_parse off restores the old regexes', (t) => {
  const root = makeRepo(t, 'builder', { policy: { shell_parse: false } });
  assert.equal(guard.decide({ tool: 'Bash', command: 'git commit -n', cwd: root }).allow, false);
  assert.equal(guard.decide({ tool: 'Bash', command: `echo "${SKIP}"`, cwd: root }).allow, false, 'the old behaviour, false block included');
});
