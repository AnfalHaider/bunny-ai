/** Shared pieces for the staged-guard suites (test/guard-next*.test.js). */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// Once G-1 has landed (the new pre-commit checker exists in the live .bootstrap/), these tests exercise the LIVE guard;
// before that they exercise the staged copy in scripts/guard-next/.
export const NEXT = !process.env.GUARD_STAGED && existsSync(join(ROOT, '.bootstrap', 'bin', 'precommit.mjs')) ? ROOT : join(ROOT, 'scripts', 'guard-next'); // GUARD_STAGED=1 runs this suite against the staged copy (what the Chief of Staff will land)
export const BIN = join(NEXT, '.bootstrap', 'bin');
export const fileUrl = (p) => new URL(`file:///${p.replace(/\\/g, '/')}`);

export const lib = await import(fileUrl(join(BIN, 'lib', 'policy.mjs')));
export const guard = await import(fileUrl(join(BIN, 'guard.mjs')));
export const prepush = await import(fileUrl(join(BIN, 'prepush.mjs')));

delete process.env.BOOTSTRAP_ROLE;

export const ROLES = {
  'tech-lead': 'write_globs: [docs/**, *.md]',
  'chief-of-staff': 'write_globs: [docs/**, *.md]',
  builder: 'write_globs: []',
  qa: 'write_globs: [docs/**, *.md, test/**, e2e/**]',
  'release-ops': 'write_globs: [docs/**, *.md]',
};

/** A throwaway git repo with the staged policy and a role file. Never the real one. */
export function makeRepo(t, role = 'tech-lead', { policy = {}, roles = ROLES } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-guard-next-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'a@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Invented'], { cwd: root });
  mkdirSync(join(root, '.bootstrap', 'roles'), { recursive: true });
  const base = JSON.parse(readFileSync(join(NEXT, '.bootstrap', 'policy.json'), 'utf8'));
  writeFileSync(join(root, '.bootstrap', 'policy.json'), JSON.stringify({ ...base, ...policy }));
  for (const [id, scope] of Object.entries(roles)) writeFileSync(join(root, '.bootstrap', 'roles', `${id}.md`), `---\nid: ${id}\n${scope}\n---\n`);
  if (role) writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function stage(root, files, { remove = [] } = {}) {
  for (const [f, body = 'x\n'] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  if (Object.keys(files).length) execFileSync('git', ['add', '-A', '--', ...Object.keys(files)], { cwd: root });
  for (const f of remove) execFileSync('git', ['rm', '-q', '-f', '--', f], { cwd: root });
}

export function commitAll(root, msg = 'seed') {
  execFileSync('git', ['commit', '-q', '-m', msg, '--allow-empty'], { cwd: root });
}

export function runNode(script, args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '', ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
