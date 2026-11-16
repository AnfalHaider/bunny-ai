/**
 * W5-1 / G1-1 (Tech Lead's spec docs/plans/guard-0.1.6-spec.md, item 1): gh writes are for the live pushers only.
 * Runs against the staged guard in scripts/guard-next/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { guard, makeRepo } from './guard-016-helpers.js';

function verdict(t, command, role = 'builder') {
  const root = makeRepo(t, role);
  return guard.decide({ tool: 'Bash', command, cwd: root });
}
const denied = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, false, `should deny (${role ?? 'builder'}): ${c}`); return v.reason; };
const allowed = (t, c, role) => { const v = verdict(t, c, role); assert.equal(v.allow, true, `should allow (${role ?? 'builder'}): ${c}\n${v.reason ?? ''}`); };

test('G1-1 deny for a builder: publishing, merging and writing through gh', (t) => {
  for (const c of [
    'gh release create v9 x.zip',
    'gh release upload v1 file.zip',
    'gh release delete v1 -y',
    'gh release edit v1 --draft=false',
    'gh pr merge 12 --squash',
    'gh pr close 12',
    'gh pr ready 12',
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=x',
    'gh api --method=PATCH repos/o/r/git/refs/heads/main',
    'gh api -XDELETE repos/o/r/releases/1',
    'gh api repos/o/r/releases -f tag_name=v9',
    'gh api repos/o/r/releases --input body.json',
    "gh api graphql -f query='mutation{ createRef(input:{}) { ref { id } } }'",
    'gh api -X $M repos/o/r',
    'gh repo edit --visibility public',
    'gh repo delete o/r --yes',
    'gh secret set X',
    'gh variable set X',
    'gh workflow run build.yml',
    'gh ruleset delete 1',
    'gh label delete bug',
    'gh alias set rel "release create"',
    'gh extension install o/x',
    'gh -R o/r release create v9',
    'env gh release create v9',
    'command gh release create v9',
    'npx gh release create v9',
    '& gh release create v9',
    '/usr/bin/gh release create v9',
    'gh.exe release create v9',
    'echo ok && gh release create v9',
    'sh -c "gh release create v9"',
    'FOO=1 gh pr merge 3',
  ]) denied(t, c);
});

test('G1-1 allow for a builder: every read', (t) => {
  for (const c of [
    'gh release view v1', 'gh release list', 'gh release download v1 -D downloads',
    'gh pr view 12', 'gh pr list', 'gh pr checks 12', 'gh pr diff 12', 'gh pr create --title x --body y --head claude/builder-x',
    'gh run list', 'gh run view 5', 'gh issue view 3', 'gh issue list', 'gh auth status', 'gh repo view',
    'gh api repos/o/r/releases/latest', 'gh api -X GET repos/o/r', 'gh api repos/o/r/pulls -X GET',
    "gh api graphql -f query='{ viewer { login } }'".replace('-f', '-X GET -f'),
  ]) allowed(t, c);
});

test('G1-1: text that merely mentions a gh write is data', (t) => {
  allowed(t, 'git commit -m "never run gh release create by hand"');
  allowed(t, "echo 'gh pr merge 1'");
  allowed(t, "cat <<'EOF' > docs/n.md\ngh release create v9\nEOF\nls docs");
});

test('G1-1: release-ops and the Chief of Staff may publish, nobody but the owner may delete or edit a release', (t) => {
  allowed(t, 'gh release create v9 x.zip', 'release-ops');
  allowed(t, 'gh release upload v9 x.zip', 'release-ops');
  allowed(t, 'gh pr merge 12 --squash', 'chief-of-staff');
  allowed(t, 'gh release create v9', 'chief-of-staff');
  for (const role of ['release-ops', 'chief-of-staff', 'hotfix', 'builder']) {
    assert.match(denied(t, 'gh release delete v1', role), /only the owner/, role);
    assert.match(denied(t, 'gh release edit v1 --draft=false', role), /only the owner/, role);
  }
});

test('G1-1: a refusal says what to do instead', (t) => {
  assert.match(denied(t, 'gh release create v9'), /release-ops|Chief of Staff/);
  assert.match(denied(t, 'gh api -X $M repos/o/r'), /spell the method out/);
});

test('G1-1 review: the owner-only edits are refused for every role, however they are spelled', (t) => {
  for (const role of ['builder', 'release-ops', 'chief-of-staff']) {
    for (const c of [
      'gh release delete-asset v1 x.zip', 'gh release upload v1 x.zip --clobber',
      'gh api -X DELETE repos/o/r/releases/12', 'gh api -X PATCH repos/o/r/releases/12 -f draft=false',
      'gh api -X DELETE repos/o/r/git/refs/tags/v1', 'gh api repos/o/r/releases/12 -f name=x',
    ]) denied(t, c, role);
  }
  allowed(t, 'gh api repos/o/r/releases/latest', 'release-ops');
  allowed(t, 'gh release upload v1 x.zip', 'release-ops');
});

test('G1-1 review: a variable where the group or method should be, other launchers, aliases and tokens', (t) => {
  for (const c of ['gh $G create v9', 'gh release $S v9', 'gh api $X repos/o/r', 'gh api repos/o/r $FLAGS',
    'xargs gh release create v9', 'timeout 5 gh release create v9', 'gh alias set a b', 'gh alias delete a', 'gh auth token',
    'git -c "alias.x=!gh release create v9" x']) denied(t, c);
  allowed(t, 'gh pr view $N');
  allowed(t, 'gh api repos/o/$R/releases/latest');
});
