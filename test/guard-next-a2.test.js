/**
 * G-1 / A2 and E: the shell write-target check (a seatbelt, behind a policy switch) and the
 * record-folder and sign-off rules, both read through the tokenizer.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { guard, makeRepo, runNode, fileUrl, BIN } from './guard-helpers.js';

// One throwaway repo per role/policy, shared by the cases below and removed when the file is done.
const repos = new Map();
after(() => { for (const r of repos.values()) rmSync(r, { recursive: true, force: true }); });
function repoFor(t, role, policy) {
  const key = `${role}|${JSON.stringify(policy ?? {})}`;
  if (!repos.has(key)) repos.set(key, makeRepo({ after() {} }, role, { policy }));
  return repos.get(key);
}
const run = (t, command, role = 'tech-lead', policy) => guard.decide({ tool: 'Bash', command, cwd: repoFor(t, role, policy) });
const allowed = (t, c, role, policy) => { const v = run(t, c, role, policy); assert.equal(v.allow, true, `should allow: ${c}\n${v.reason ?? ''}`); };
const denied = (t, c, role, policy) => assert.equal(run(t, c, role, policy).allow, false, `should deny: ${c}`);

// ============================================================ A2

test('A2 allow: ordinary commands and writes inside the role\'s scope', (t) => {
  allowed(t, 'echo x > docs/a.md');
  allowed(t, 'echo x >> README.md');
  allowed(t, 'git status');
  allowed(t, 'cat src/a.js');
  allowed(t, 'grep ">" src/a.js');
  allowed(t, 'npm test');
  allowed(t, 'ls docs && echo done');
  allowed(t, 'make 2>&1 | tail -5');
  allowed(t, 'node build.js > /dev/null');
  allowed(t, 'node build.js 2> /dev/null');
  allowed(t, 'node build.js > NUL');
  allowed(t, 'cp src/a.js docs/copy.md');
  allowed(t, 'rm docs/old.md');
  allowed(t, 'git add src/a.js');
  allowed(t, 'git checkout main');
  allowed(t, 'git checkout -- docs/a.md');
  allowed(t, 'sed s/a/b/ src/a.js');
  allowed(t, 'sed -n 1,5p src/a.js');
  allowed(t, 'echo x > /tmp/outside.txt');
  allowed(t, 'cat <<EOF > docs/a.md\nif (a > b) { echo > nowhere }\nEOF');
  allowed(t, 'cd docs && echo x > a.js');
  allowed(t, 'echo "a > src/b.js"');
});

test('A2 deny: shell writes outside the role\'s scope', (t) => {
  denied(t, 'sed -i s/a/b/ src/app.js');
  denied(t, 'sed -i.bak s/a/b/ src/app.js');
  denied(t, 'sed -ni s/a/b/p src/app.js');
  denied(t, 'echo hi > src/app.js');
  denied(t, 'echo hi >> src/app.js');
  denied(t, 'echo hi 2> src/err.log');
  denied(t, 'echo hi &> src/both.log');
  denied(t, 'echo hi >src/app.js');
  denied(t, 'echo hi >"src/with space.js"');
  denied(t, 'echo hi | tee src/app.js');
  denied(t, 'echo hi | tee -a src/app.js');
  denied(t, 'cp docs/a.md src/b.js');
  denied(t, 'mv docs/a.md src/b.js');
  denied(t, 'mv src/a.js docs/a.md', 'tech-lead');
  denied(t, 'rm src/a.js');
  denied(t, 'rm -rf src');
  denied(t, 'touch src/new.js');
  denied(t, 'mkdir src/new');
  denied(t, 'git checkout -- src/a.js');
  denied(t, 'git restore src/a.js');
  denied(t, 'git rm src/a.js');
  denied(t, 'dd if=/dev/zero of=src/a.bin');
  denied(t, 'Set-Content -Path src/a.js -Value x');
  denied(t, 'Set-Content src/a.js x');
  denied(t, 'Out-File -FilePath src/a.js');
  denied(t, 'echo x | Out-File src\\a.js');
  denied(t, 'Add-Content src/a.js x');
  denied(t, 'Remove-Item src/a.js');
  denied(t, 'Remove-Item -Recurse -Force src');
  denied(t, 'New-Item -Path src/x.js -ItemType File');
  denied(t, 'Copy-Item docs/a.md -Destination src/b.js');
  denied(t, 'Move-Item docs/a.md src/b.js');
  denied(t, 'del src\\a.js');
  denied(t, 'copy docs\\a.md src\\b.md');
  denied(t, 'echo x && echo hi > src/a.js');
  denied(t, 'cd src && echo hi > a.js');
  denied(t, 'echo $(echo hi > src/a.js)');
  denied(t, 'bash -c "echo hi > src/a.js"');
  denied(t, 'FOO=1 sed -i s/a/b/ src/a.js');
});

test('A2 deny: protected files, for every role but the Chief of Staff', (t) => {
  for (const role of ['tech-lead', 'builder', 'qa']) {
    denied(t, 'echo x > .bootstrap/policy.json', role);
    denied(t, 'echo x > .bootstrap/session.json', role);
    denied(t, 'tee .bootstrap/bin/guard.mjs', role);
    denied(t, 'Set-Content -Path .githooks/pre-push -Value x', role);
    denied(t, 'cp x.md .bootstrap/policy.json', role);
    denied(t, 'echo x >> AGENTS.md', role);
    denied(t, 'sed -i s/a/b/ .claude/settings.json', role);
    denied(t, 'echo x > .git/hooks/pre-push', role);
    denied(t, 'echo x > .git/config', role);
    denied(t, 'echo x > .BOOTSTRAP/policy.json', role);
    denied(t, 'rm .githooks/pre-push', role);
  }
  allowed(t, 'echo x > .bootstrap/policy.json', 'chief-of-staff');
  allowed(t, 'cp x.md .githooks/pre-commit', 'chief-of-staff');
});

test('A2: a role with no write_globs may write anywhere that is not protected', (t) => {
  allowed(t, 'echo x > src/a.js', 'builder');
  allowed(t, 'sed -i s/a/b/ src/a.js', 'builder');
  denied(t, 'echo x > .bootstrap/session.json', 'builder');
});

test('A2: targets that cannot be resolved are not blocked, unless they name a protected path', (t) => {
  allowed(t, 'echo x > $OUT');
  allowed(t, 'echo x > "$DIR/a.js"');
  allowed(t, 'rm *.tmp');
  allowed(t, 'echo x > ~/a.js');
  denied(t, 'echo x > "$ROOT/.bootstrap/policy.json"', 'builder');
  denied(t, 'echo x > $ROOT/.githooks/pre-push', 'builder');
});

test('A2 malformed: unbalanced quotes, empty, huge, trailing operators finish and never throw', (t) => {
  allowed(t, '');
  allowed(t, 'echo "unclosed > src/a.js');
  allowed(t, 'echo hi;');
  allowed(t, 'echo hi >');
  const t0 = Date.now();
  allowed(t, `echo ${'x '.repeat(500_000)} > docs/a.md`);
  denied(t, `echo ${'x '.repeat(500_000)} > src/a.js`);
  assert.ok(Date.now() - t0 < 6000, 'a 1 MB command finishes well inside the 10 s hook limit');
});

test('A2: the policy switch turns the write check off', (t) => {
  denied(t, 'echo hi > src/app.js');
  allowed(t, 'echo hi > src/app.js', 'tech-lead', { shell_write_check: false });
  allowed(t, 'echo hi > .bootstrap/policy.json', 'tech-lead', { shell_write_check: false }); // the whole layer is off; A1 still catches it at commit
});

// ============================================================ E

const SIGNOFF = 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --sha abc1234 --note "plain words"';

test('E allow: the sign-off command in every shape that was false-blocked', (t) => {
  allowed(t, SIGNOFF);
  allowed(t, `${SIGNOFF} 2>&1 | tail -5`);
  allowed(t, `${SIGNOFF}; ls docs/signoffs/b-1`);
  allowed(t, `${SIGNOFF} && git status`);
  allowed(t, `${SIGNOFF} && ls docs/signoffs/b-1 2>&1`);
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --note "a -> b, cp and rm are words here"');
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --note "line one\nline two"');
  allowed(t, `${SIGNOFF};`);
  allowed(t, 'git add docs/signoffs/b-1/tech-lead.md');
  allowed(t, 'cat docs/releases/x.md');
  allowed(t, 'ls docs/signoffs');
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --role tech-lead');
});

test('E deny: writing into the record folders other than through the CLI', (t) => {
  denied(t, 'echo x > docs/signoffs/b-1/qa.md');
  denied(t, 'cp x.md docs/signoffs/b-1/qa.md');
  denied(t, 'tee docs/releases/r.md');
  denied(t, 'Set-Content docs/signoffs/b-1/qa.md x');
  denied(t, 'sed -i s/a/b/ docs/signoffs/b-1/qa.md');
  denied(t, 'rm docs/signoffs/b-1/qa.md');
  denied(t, 'echo x > docs/releases/r.md', 'qa');
  denied(t, 'echo x > docs/signoffs/b-1/qa.md', 'builder');
  allowed(t, 'echo x > docs/signoffs/b-1/chief-of-staff.md', 'chief-of-staff');
});

test('E deny: a sign-off for another role, and ids that escape the folder', (t) => {
  denied(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --role qa');
  denied(t, 'node .bootstrap/bin/bootstrap.mjs signoff ../../src --verdict PASS');
  denied(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --role ../../x');
  denied(t, 'node .bootstrap/bin/bootstrap.mjs signoff a/b --verdict PASS');
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS --role qa', 'chief-of-staff');
  // the rest of the line is not the sign-off's own options
  allowed(t, 'node .bootstrap/bin/bootstrap.mjs signoff b-1 --verdict PASS ; node other.mjs --role qa');
});

test('E: the sign-off command itself rejects a bad id and another role (defence in depth)', (t) => {
  const root = makeRepo(t, 'tech-lead');
  const cli = join(BIN, 'bootstrap.mjs');
  assert.notEqual(runNode(cli, ['signoff', '..', '--verdict', 'PASS'], root).code, 0);
  assert.notEqual(runNode(cli, ['signoff', 'b-1', '--verdict', 'PASS', '--role', 'qa'], root).code, 0);
  assert.notEqual(runNode(cli, ['signoff', 'b-1', '--verdict', 'PASS', '--role', '../x'], root).code, 0);
  assert.equal(runNode(cli, ['signoff', 'b-1', '--verdict', 'PASS', '--sha', 'abc1234'], root).code, 0);
  assert.equal(runNode(cli, ['signoff', 'b-2', '--verdict', 'PASS', '--role', 'qa', '--sha', 'abc1234'], makeRepo(t, 'chief-of-staff')).code, 0);
});

test('E: the Write tool follows the same record-folder rule', (t) => {
  const root = repoFor(t, 'qa');
  assert.equal(guard.decide({ tool: 'Write', filePath: join(root, 'docs', 'signoffs', 'b-1', 'qa.md'), cwd: root }).allow, false);
  assert.equal(guard.decide({ tool: 'Write', filePath: join(root, 'docs', 'plans', 'x.md'), cwd: root }).allow, true);
  const cos = repoFor(t, 'chief-of-staff');
  assert.equal(guard.decide({ tool: 'Write', filePath: join(cos, 'docs', 'signoffs', 'b-1', 'chief-of-staff.md'), cwd: cos }).allow, true);
});

test('the module list: the staged guard imports only what is staged', async () => {
  const shellwrites = await import(fileUrl(join(BIN, 'lib', 'shellwrites.mjs')));
  assert.equal(typeof shellwrites.checkWrites, 'function');
});
