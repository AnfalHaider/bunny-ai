// W5-1 review probe 5 (Security, 2026-11-16): file tools on guard files and the role file, and the pre-push backstop for
// a push of main by a non-live role (what catches a shell push the tokenizer misses).
// Usage: GUARD_STAGED=1 node probe5.mjs <path to a checkout of d3ee1cf>
import { join } from 'node:path';
const CHECKOUT = process.argv[2].replace(/\\/g, '/');
const h = await import(`file:///${CHECKOUT}/test/guard-helpers.js`);
const tt = { after() {} };
const roles = { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' };
const R = {};
for (const r of ['builder', 'security', 'release-ops']) R[r] = h.makeRepo(tt, r, { roles });
let bad = 0;
const file = (role, tool, rel, exp) => {
  const res = h.guard.decide({ tool, filePath: join(R[role], rel), cwd: R[role] });
  const got = res.allow ? 'A' : 'B';
  if (got !== exp) { bad += 1; console.log(`**MISMATCH** ${role} ${tool} ${rel} exp ${exp} got ${got}`); }
};
console.log('--- file tools (builder)');
for (const t of ['Write', 'Edit']) {
  for (const p of ['.git/bootstrap-role', '.git/config', '.git/hooks/pre-commit', '.githooks/pre-commit', '.githooks/pre-push', '.githooks/commit-msg', '.bootstrap/policy.json', '.bootstrap/bin/guard.mjs', '.bootstrap/session.json',
    'docs/signoffs/s-1/qa.md', 'docs/signoffs/s-1/_required.md', 'docs/releases/x.md', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.GIT/bootstrap-role', '.git/bootstrap-role::$DATA', '.git/bootstrap-role.', '.git/./bootstrap-role', '.git/x/../bootstrap-role', 'GIT~1/bootstrap-role']) file('builder', t, p, 'B');
  for (const p of ['src/x.js', '.claude/settings.local.json', 'docs/notes.md', 'test/x.test.js']) file('builder', t, p, 'A');
}
console.log('--- the role file is the role (does a role file for another role change what decide() allows?)');
import { writeFileSync, mkdirSync } from 'node:fs';
const root = R.builder;
const roleFile = join(h.git(root, 'rev-parse', '--git-dir').startsWith('/') || /^[A-Za-z]:/.test(h.git(root, 'rev-parse', '--git-dir')) ? h.git(root, 'rev-parse', '--git-dir') : join(root, h.git(root, 'rev-parse', '--git-dir')), 'bootstrap-role');
console.log('role file path:', roleFile.replace(/\\/g, '/').split('/').slice(-3).join('/'));
let before = h.guard.decide({ tool: 'Write', filePath: join(root, 'AGENTS.md'), cwd: root }).allow;
writeFileSync(roleFile, 'chief-of-staff\n');
let after = h.guard.decide({ tool: 'Write', filePath: join(root, 'AGENTS.md'), cwd: root }).allow;
console.log(`builder writes AGENTS.md: before role-file forge=${before}, after forging chief-of-staff in the role file=${after}  (the known "seatbelt, not proof" gap)`);
console.log(bad ? `MISMATCHES: ${bad}` : 'FILE TOOLS ALL MATCHED');
