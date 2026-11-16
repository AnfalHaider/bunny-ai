import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, parseArgs, gatherGitState } from '../scripts/release.mjs';

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
  assert.match(r.reason, /uncommitted changes/);
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
  assert.deepEqual(state, { target: MAIN, originMain: MAIN, dirty: false, fetchError: null });
  assert.equal(checkTarget(state).ok, true);
});

test('gatherGitState reports fetch failure, missing origin/main and a dirty tree', () => {
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ fetchFails: true }).git, target: 'HEAD' })).ok, false);
  assert.equal(gatherGitState({ git: fakeGit({ fetchFails: true }).git, target: 'HEAD' }).fetchError, 'fatal: unable to access');
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ origin: '' }).git, target: 'HEAD' })).ok, false);
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ status: ' M src/a.js\n' }).git, target: 'HEAD' })).ok, false);
  assert.equal(checkTarget(gatherGitState({ git: fakeGit({ head: OTHER }).git, target: 'HEAD' })).ok, false);
});
