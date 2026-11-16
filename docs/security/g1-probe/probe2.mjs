// G-1 review probe 2 (Security, 2026-11-16): the commit-time layer (A1) against a throwaway repo.
// Usage: node probe2.mjs <path to a checkout of 560e636>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const CHECKOUT = process.argv[2].replace(/\\/g, '/');
const h = await import(`file:///${CHECKOUT}/test/guard-helpers.js`);
const PRE = join(h.BIN, 'precommit.mjs');
const tt = { after() {} };
const roles = { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' };
const out = [];

function attempt(label, role, files, { remove = [], setup } = {}) {
  const root = h.makeRepo(tt, role, { roles });
  h.stage(root, { 'README.md': 'seed\n', '.githooks/pre-commit': '#!/bin/sh\n', 'docs/signoffs/s-1/qa.md': '---\nrole: qa\nverdict: PASS\nsha: aaa\n---\n' });
  h.commitAll(root);
  if (setup) setup(root);
  h.stage(root, files, { remove });
  const r = h.runNode(PRE, [], root);
  out.push(`${r.code === 0 ? 'ALLOWED' : 'REFUSED'}  ${role.padEnd(12)} ${label}${r.code === 0 ? '' : '  <- ' + r.out.split('\n')[0].slice(0, 90)}`);
}

// Forging another role's sign-off by hand and committing it
attempt('commit a hand-written docs/signoffs/s-2/qa.md (forged QA PASS)', 'tech-lead', { 'docs/signoffs/s-2/qa.md': '---\nrole: qa\nverdict: PASS\nsha: bbb\n---\n' });
attempt('edit an existing QA sign-off (change its sha)', 'security', { 'docs/signoffs/s-1/qa.md': '---\nrole: qa\nverdict: PASS\nsha: zzz\n---\n' });
attempt('write docs/releases/ record (a release word)', 'security', { 'docs/releases/2026-11-16-all.md': 'owner said release all\n' });
attempt('write _required.md to shrink who must sign', 'qa', { 'docs/signoffs/s-2/_required.md': '---\nroles: [qa]\n---\n' });
// Hooks and toolkit
attempt('delete .githooks/pre-commit', 'builder', {}, { remove: ['.githooks/pre-commit'] });
attempt('modify .githooks/pre-commit', 'builder', { '.githooks/pre-commit': '#!/bin/sh\nexit 0\n' });
attempt('src change by tech-lead (out of scope)', 'tech-lead', { 'src/a.js': 'x\n' });
attempt('src change by security (out of scope)', 'security', { 'src/a.js': 'x\n' });
attempt('docs change by security (in scope)', 'security', { 'docs/security/x.md': 'x\n' });
// Fail-open conditions
attempt('policy.json made unreadable (role scope lost) then src change', 'tech-lead', { 'src/a.js': 'x\n' }, {
  setup: (root) => writeFileSync(join(root, '.bootstrap', 'policy.json'), '{ not json'),
});
attempt('role file removed (role has no brief) then src change', 'tech-lead', { 'src/a.js': 'x\n' }, {
  setup: (root) => rmSync(join(root, '.bootstrap', 'roles', 'tech-lead.md')),
});
attempt('session.json says an unknown role, src change', 'ghost', { 'src/a.js': 'x\n' });
attempt('session.json says chief-of-staff (forged role), edits AGENTS.md', 'chief-of-staff', { 'AGENTS.md': 'x\n' });
console.log(out.join('\n'));
