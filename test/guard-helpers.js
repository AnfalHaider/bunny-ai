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
// KIT_NEXT=1 (K-1) runs the same suites against the 0.6.0 kit with our G-1 hardening put back (scripts/kit-next/).
export const NEXT = process.env.KIT_NEXT ? join(ROOT, 'scripts', 'kit-next') : !process.env.GUARD_STAGED && existsSync(join(ROOT, '.bootstrap', 'bin', 'precommit.mjs')) ? ROOT : join(ROOT, 'scripts', 'guard-next'); // GUARD_STAGED=1 runs this suite against the staged copy (what the Chief of Staff will land)
export const BIN = join(NEXT, '.bootstrap', 'bin');
// K-4: once the 0.6.0 kit is installed, the live guard IS scripts/kit-next, so the suites that tell the old guard from the new one
// (they check process.env.KIT_NEXT) must follow the kit that is actually installed: NEW_KIT is true when KIT_NEXT is set, or when the live
// .bootstrap/bin/guard.mjs and lib/policy.mjs are the staged ones. Nothing about the new guard is checked less: an old live guard still gets the old checks.
const text = (f) => readFileSync(f, 'utf8').split('\r\n').join('\n');
const same = (a, b) => existsSync(a) && existsSync(b) && text(a) === text(b);
export const LIVE_IS_KIT_NEXT = ['guard.mjs', join('lib', 'policy.mjs')].every((f) => same(join(ROOT, '.bootstrap', 'bin', f), join(ROOT, 'scripts', 'kit-next', '.bootstrap', 'bin', f)));
export const NEW_KIT = Boolean(process.env.KIT_NEXT) || (NEXT === ROOT && LIVE_IS_KIT_NEXT);
process.env.CLAUDE_CONFIG_DIR ||= mkdtempSync(join(tmpdir(), 'bunny-claude-config-')); // never the person's own user settings
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
