/**
 * K-1 landing: what `node scripts/kit-next/.bootstrap/bin/bootstrap.mjs upgrade` does to a copy of origin/main.
 * Everything happens in a throw-away clone; the real .bootstrap/ and .githooks/ are never touched.
 * The upgrade is run as the Chief of Staff (the only role that may run it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'scripts', 'kit-next', '.bootstrap');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const eol = (text) => text.replace(/\r\n/g, '\n');
const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : [relative(base, join(dir, e.name)).replace(/\\/g, '/')])).sort();
const read = (p) => eol(readFileSync(p, 'utf8'));

function baseRef() {
  for (const ref of ['origin/main', 'main']) { try { return git(['rev-parse', '--verify', ref], ROOT); } catch { /* next */ } }
  return null;
}

test('the staged kit folder has everything `upgrade` copies from', () => {
  for (const d of ['bin', 'flow', 'ui', 'roles', 'templates/project']) assert.ok(existsSync(join(KIT, d)), d);
  assert.ok(existsSync(join(KIT, 'policy.json')));
  // byte-identical to the plugin's 0.6.0 for the folders that are not ours (when the plugin is installed on this machine)
  const plugin = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'plugins', 'cache', 'bootstrap-environment', 'bootstrap-environment', '0.6.0');
  if (existsSync(plugin)) {
    for (const d of ['flow', 'ui', 'roles', 'templates']) {
      assert.deepEqual(files(join(KIT, d)), files(join(plugin, d)), `${d}: same files`);
      for (const f of files(join(plugin, d))) assert.equal(read(join(KIT, d, f)), read(join(plugin, d, f)), `${d}/${f}`);
    }
  }
});

test('upgrading a copy of origin/main: bin is the staged bin; flow.json, settings and our hooks are untouched; policy is kept', (t) => {
  const base = baseRef();
  if (!base) return t.skip('no origin/main here');
  const clone = mkdtempSync(join(tmpdir(), 'bunny-landing-'));
  git(['clone', '-q', '--no-checkout', ROOT, clone], tmpdir());
  git(['fetch', '-q', ROOT, `${base}:refs/heads/landing-base`], clone);
  git(['checkout', '-q', 'landing-base'], clone);
  git(['config', 'user.email', 'a@example.test'], clone);
  git(['config', 'user.name', 'Invented'], clone);
  const mine = (rel) => join(clone, ...rel.split('/'));
  const before = {};
  for (const rel of ['.claude/settings.json', '.githooks/pre-commit', '.githooks/commit-msg', '.githooks/pre-push', '.bootstrap/policy.json', 'AGENTS.md']) {
    if (existsSync(mine(rel))) before[rel] = read(mine(rel));
  }
  const rolesBefore = files(mine('.bootstrap/roles'));
  const liveBin = files(mine('.bootstrap/bin'));
  writeFileSync(mine('.bootstrap/session.json'), JSON.stringify({ role: 'chief-of-staff' }));

  const run = spawnSync(process.execPath, [join(KIT, 'bin', 'bootstrap.mjs'), 'upgrade'], { cwd: clone, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);

  // 1. bin is the staged bin, file for file
  const staged = files(join(KIT, 'bin'));
  assert.deepEqual(files(mine('.bootstrap/bin')).filter((f) => staged.includes(f) || liveBin.includes(f)), [...new Set([...staged, ...liveBin])].sort(), 'no file went missing');
  for (const f of staged) assert.equal(read(mine(`.bootstrap/bin/${f}`)), read(join(KIT, 'bin', f)), `bin/${f}`);
  // 2. stale files: live bin files that the staged kit does not have (none expected: the staged kit has every live file)
  const stale = liveBin.filter((f) => !staged.includes(f));
  assert.deepEqual(stale, [], `files the upgrade leaves behind: ${stale.join(', ')}`);
  // 3. the lane model is not switched on
  assert.equal(existsSync(mine('.bootstrap/flow.json')), false);
  // 4. settings, our three hooks and the policy are as they were
  for (const rel of Object.keys(before)) assert.equal(read(mine(rel)), before[rel], `${rel} unchanged`);
  // 5. the kit's own folders arrived
  for (const d of ['flow', 'ui']) assert.ok(existsSync(mine(`.bootstrap/${d}`)), d);
  assert.ok(existsSync(mine('.bootstrap/kit.json')));
  // 6. our role briefs were not overwritten (roles are copied without overwrite); report what was added
  for (const f of rolesBefore) assert.equal(read(mine(`.bootstrap/roles/${f}`)), read(join(ROOT, '.bootstrap', 'roles', f)), `roles/${f} kept`);
  const rolesAdded = files(mine('.bootstrap/roles')).filter((f) => !rolesBefore.includes(f));
  const changed = git(['status', '--porcelain'], clone).split('\n').filter(Boolean).map((l) => l.slice(3));
  console.log(`landing: roles added: ${rolesAdded.join(', ') || 'none'}`);
  console.log(`landing: files changed or added in the clone: ${changed.length}`);
  for (const c of changed) console.log(`  ${c}`);
});

test('the live policy.json needs the staged additions: with its own records.globs the flow and kit record folders are not protected', async () => {
  const policyLib = await import(pathToFileURL(join(KIT, 'bin', 'lib', 'policy.mjs')).href);
  const liveText = join(ROOT, '.bootstrap', 'policy.json');
  const stagedText = join(KIT, 'policy.json');
  const globs = (p) => JSON.parse(readFileSync(p, 'utf8')).records?.globs ?? [];
  const wanted = ['docs/flow-changes/**', 'docs/kit-changes/**'];
  assert.deepEqual(wanted.filter((g) => !globs(stagedText).includes(g)), [], 'the staged policy has them');
  const liveMissing = wanted.filter((g) => !globs(liveText).includes(g));
  // the policy's own list replaces the default one (an object spread), so a live policy that lists only two folders leaves these two open
  assert.deepEqual(liveMissing, wanted, 'the live policy.json does not list them: landing must also take the staged policy.json (or drop records.globs from it)');
  assert.ok(policyLib.DEFAULT_POLICY.records.globs.includes('docs/kit-changes/**'), 'the default policy of the staged kit has them');
});
