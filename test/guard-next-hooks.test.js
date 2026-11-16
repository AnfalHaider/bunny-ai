/**
 * G-1 / A1 end to end: the staged hook runs from git itself, in a throwaway repo laid out like the
 * real one (.bootstrap/bin + .githooks), so "git commit" is refused for a definite violation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { NEXT, makeRepo } from './guard-helpers.js';

function installHooks(root) {
  cpSync(join(NEXT, '.bootstrap', 'bin'), join(root, '.bootstrap', 'bin'), { recursive: true });
  mkdirSync(join(root, '.githooks'), { recursive: true });
  cpSync(join(NEXT, '.githooks', 'pre-commit'), join(root, '.githooks', 'pre-commit'));
  chmodSync(join(root, '.githooks', 'pre-commit'), 0o755);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
}
const commit = (root) => spawnSync('git', ['commit', '-q', '-m', 'x'], { cwd: root, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' } });

test('A1 e2e: git itself refuses an out-of-scope commit, and allows an in-scope one', (t) => {
  const root = makeRepo(t, 'tech-lead');
  installHooks(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), 'x');
  execFileSync('git', ['add', 'src/a.js'], { cwd: root });
  const bad = commit(root);
  assert.notEqual(bad.status, 0, bad.stderr);
  assert.match(bad.stderr, /src\/a\.js/);

  execFileSync('git', ['reset', '-q'], { cwd: root });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'a.md'), 'x');
  execFileSync('git', ['add', 'docs/a.md'], { cwd: root });
  const good = commit(root);
  assert.equal(good.status, 0, good.stderr);
});

test('A1 e2e: the chief of staff lands protected files; a builder cannot', (t) => {
  const cos = makeRepo(t, 'chief-of-staff');
  installHooks(cos);
  writeFileSync(join(cos, 'AGENTS.md'), 'rules');
  execFileSync('git', ['add', 'AGENTS.md'], { cwd: cos });
  assert.equal(commit(cos).status, 0);

  const builder = makeRepo(t, 'builder');
  installHooks(builder);
  writeFileSync(join(builder, 'AGENTS.md'), 'rules');
  execFileSync('git', ['add', 'AGENTS.md'], { cwd: builder });
  const r = commit(builder);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /AGENTS\.md/);
});
