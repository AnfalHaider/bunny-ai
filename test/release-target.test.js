import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget as check, checkBuild, checkGhArgs, parseArgs, gatherGitState } from '../scripts/release.mjs';
// most cases are about the target; HEAD is the target unless a case says otherwise
const checkTarget = (o) => check({ head: o.target, ...o });

const MAIN = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';

test('HEAD equal to origin/main is allowed', () => {
  assert.deepEqual(checkTarget({ target: MAIN, originMain: MAIN, dirty: false }), { ok: true, reason: '' });
});

test('HEAD behind or ahead of origin/main is refused', () => {
  for (const target of [OTHER, 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678']) {
    const r = checkTarget({ target, originMain: MAIN, dirty: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /not origin\/main/);
    assert.match(r.reason, /Release only what is on main/);
  }
});

test('an explicit sha that is not origin/main is refused', () => {
  const r = checkTarget({ target: '1234567', originMain: MAIN, dirty: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Refusing to release 1234567: it is not origin\/main \(a1b2c3d\)/);
});

test('an abbreviated sha equal to origin/main is allowed', () => {
  assert.equal(checkTarget({ target: MAIN.slice(0, 9), originMain: MAIN }).ok, true);
  assert.equal(checkTarget({ target: MAIN, originMain: MAIN.slice(0, 7) }).ok, true);
});

test('a dirty tree is refused even on origin/main', () => {
  const r = checkTarget({ target: MAIN, originMain: MAIN, dirty: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /uncommitted or untracked files/);
});

test('missing origin/main is refused with a clear message', () => {
  for (const originMain of ['', null, undefined]) {
    const r = checkTarget({ target: MAIN, originMain, dirty: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /origin\/main does not exist/);
  }
});

test('a fetch failure is refused, never silently ok', () => {
  const r = checkTarget({ target: MAIN, originMain: MAIN, dirty: false, fetchError: 'network down' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not fetch origin\/main \(network down\)/);
});

test('an unresolvable target is refused', () => {
  assert.equal(checkTarget({ target: '', originMain: MAIN }).ok, false);
  assert.equal(checkTarget({ target: 'zzz', originMain: MAIN }).ok, false);
});

test('parseArgs takes --target and --dry-run and passes the rest on', () => {
  assert.deepEqual(parseArgs([]), { target: 'HEAD', dryRun: false, rest: [] });
  assert.deepEqual(parseArgs(['--target', 'abc1234', '--dry-run', '--notes-file', 'n.md']), { target: 'abc1234', dryRun: true, rest: ['--notes-file', 'n.md'] });
  assert.equal(parseArgs(['--target=abc1234']).target, 'abc1234');
});

function fakeGit({ fetchFails = false, head = MAIN, origin = MAIN, status = '' } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'fetch') { if (fetchFails) throw new Error('fatal: unable to access\nmore'); return ''; }
    if (args[0] === 'rev-parse') {
      if (args[2].startsWith('origin/main')) { if (!origin) throw new Error('bad revision'); return `${origin}\n`; }
      return `${head}\n`;
    }
    if (args[0] === 'status') return status;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

test('gatherGitState fetches first, resolves both shas, and feeds checkTarget', () => {
  const { git, calls } = fakeGit();
  const state = gatherGitState({ git, target: 'HEAD' });
  assert.equal(calls[0], 'fetch origin main');
  assert.deepEqual(state, { target: MAIN, originMain: MAIN, head: MAIN, dirty: false, fetchError: null });
  assert.equal(check(state).ok, true);
});

test('gatherGitState reports fetch failure, missing origin/main and a dirty tree', () => {
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ fetchFails: true }).git, target: 'HEAD' })).ok, false);
  assert.equal(gatherGitState({ git: fakeGit({ fetchFails: true }).git, target: 'HEAD' }).fetchError, 'fatal: unable to access');
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ origin: '' }).git, target: 'HEAD' })).ok, false);
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ status: ' M src/a.js\n' }).git, target: 'HEAD' })).ok, false);
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ head: OTHER }).git, target: 'HEAD' })).ok, false);
});

test('Security W5-8 (1): HEAD must be the target, not only the target origin/main', () => {
  const r = check({ target: MAIN, originMain: MAIN, head: OTHER, dirty: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /checked out/);
  assert.equal(check({ target: MAIN, originMain: MAIN, head: MAIN.slice(0, 8) }).ok, true);
  assert.equal(check({ target: MAIN, originMain: MAIN }).ok, false, 'no HEAD, no release');
  // through the git reader: "--target origin/main" from another branch
  const { git } = fakeGit({ head: OTHER, origin: MAIN });
  const state = gatherGitState({ git: (args) => (args[0] === 'rev-parse' && args[2].startsWith('HEAD') ? OTHER : args[0] === 'rev-parse' && args[2].startsWith('origin/main') ? MAIN : git(args)), target: 'origin/main' });
  assert.equal(state.target, MAIN);
  assert.equal(state.head, OTHER);
  assert.equal(check(state).ok, false);
});

test('Security W5-8 (2): untracked files count as changes', () => {
  const calls = [];
  const git = (args) => { calls.push(args.join(' ')); if (args[0] === 'status') return '?? src/extra.js\n'; if (args[0] === 'fetch') return ''; return `${MAIN}\n`; };
  const state = gatherGitState({ git, target: 'HEAD' });
  assert.equal(state.dirty, true);
  assert.equal(check(state).ok, false);
  const status = calls.find((c) => c.startsWith('status'));
  assert.ok(!status.includes('--untracked-files=no'), status);
  assert.match(status, /--untracked-files=all/);
});

test('Security W5-8 (3): dist/build-sha.txt must equal the target', () => {
  assert.equal(checkBuild({ target: MAIN, builtSha: `${MAIN}
` }).ok, true);
  assert.equal(checkBuild({ target: MAIN, builtSha: MAIN.slice(0, 9) }).ok, true);
  assert.match(checkBuild({ target: MAIN, builtSha: OTHER }).reason, /was built from ffffff/);
  assert.match(checkBuild({ target: MAIN, builtSha: '' }).reason, /build-sha.txt is missing/);
  assert.match(checkBuild({ target: MAIN, builtSha: undefined }).reason, /missing/);
  assert.match(checkBuild({ target: MAIN, builtSha: `${MAIN}-dirty` }).reason, /changes/);
  assert.equal(checkBuild({ target: MAIN, builtSha: 'not a sha' }).ok, false);
});

test('Security W5-8 (3): the stamp script writes HEAD and clears first', async () => {
  const { mkdtemp, readFile, rm, mkdir, writeFile } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../scripts/write-build-sha.mjs', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'bunny-stamp-'));
  try {
    // the script finds its repository from its own place, so run a copy inside a throw-away repository
    await mkdir(join(dir, 'scripts'));
    await writeFile(join(dir, 'scripts', 'write-build-sha.mjs'), await readFile(script, 'utf8'));
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'x');
    const run = (...a) => execFileSync(process.execPath, [join(dir, 'scripts', 'write-build-sha.mjs'), ...a], { cwd: dir, encoding: 'utf8' });
    run();
    assert.equal((await readFile(join(dir, 'dist', 'build-sha.txt'), 'utf8')).trim(), git('rev-parse', 'HEAD'));
    run('clear');
    await assert.rejects(readFile(join(dir, 'dist', 'build-sha.txt'), 'utf8'), /ENOENT/);
    await writeFile(join(dir, 'untracked.txt'), 'x');
    run();
    assert.equal((await readFile(join(dir, 'dist', 'build-sha.txt'), 'utf8')).trim(), `${git('rev-parse', 'HEAD')}-dirty`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Security W5-8 (4): only --notes-file goes on to gh', () => {
  assert.deepEqual(checkGhArgs([]), { ok: true, reason: '', args: [] });
  assert.deepEqual(checkGhArgs(['--notes-file', 'n.md']).args, ['--notes-file', 'n.md']);
  assert.deepEqual(checkGhArgs(['--notes-file=n.md']).args, ['--notes-file=n.md']);
  for (const bad of [['--repo', 'x/y'], ['-R', 'x/y'], ['--draft'], ['--prerelease'], ['--latest=false'], ['--notes', 'x'], ['--title', 'x'], ['--target', 'abc'], ['--notes-file', 'n.md', '--draft'], ['--notes-file'], ['--notes-file', '--draft'], ['n.md']]) {
    const r = checkGhArgs(bad);
    assert.equal(r.ok, false, bad.join(' '));
    assert.match(r.reason, /Refusing to release/);
  }
});
