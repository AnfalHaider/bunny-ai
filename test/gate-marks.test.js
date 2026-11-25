import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FAIL_MARKS } from '../scripts/gate-marks.mjs';

// GATE-MARKS: a failed unit step must name the failing test. The old pattern `(✖|not ok)\b` could never match a ✖ line.
const MUST_MATCH = [
  '✖ the named one fails (1.2ms)',
  '  ✖ nested failing test (0.4ms)',
  'not ok 3 - the tap line',
  '  not ok 12 - indented tap line',
  'ℹ tests 56', 'ℹ suites 0', 'ℹ pass 55', 'ℹ fail 1', 'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0',
  "AssertionError [ERR_ASSERTION]: expected 'a' to equal 'b'",
  "  code: 'ERR_ASSERTION' Error [ERR_TEST_FAILURE]: boom",
  'TypeError: x is not a function', '  ReferenceError: y is not defined', 'RangeError: bad', 'Error: plain',
];
const MUST_NOT_MATCH = [
  '✔ the passing one (0.3ms)',
  'ok 1 - a tap pass',
  'notok 4 - no space',
  'not okay at all',
  'ℹ duration_ms 9389.6',
  'a line that only mentions ✖ in the middle',
  'running 3 files',
  '',
];

test('every failure mark is matched, with the ✖ line first (the bug)', () => { for (const l of MUST_MATCH) assert.ok(FAIL_MARKS.test(l), `must match: ${JSON.stringify(l)}`); });
test('passing and unrelated lines are not kept', () => { for (const l of MUST_NOT_MATCH) assert.ok(!FAIL_MARKS.test(l), `must not match: ${JSON.stringify(l)}`); });
test('the old pattern really missed a ✖ line (so this test would have failed before)', () => {
  const old = /^\s*(✖|not ok)\b/;
  assert.equal(old.test('✖ the named one fails (1.2ms)'), false);
  assert.equal(FAIL_MARKS.test('✖ the named one fails (1.2ms)'), true);
});

test('end to end: a real failing node test run has its failing test named among the kept lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-marks-'));
  try {
    const file = join(dir, 'fixture.test.js');
    writeFileSync(file, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('the passing one', () => {});\ntest('the named one fails', () => { assert.equal(1, 2); });\n");
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], { encoding: 'utf8', timeout: 60_000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    assert.notEqual(r.status, 0, 'the fixture must fail');
    const kept = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => FAIL_MARKS.test(l));
    assert.ok(kept.some((l) => l.includes('the named one fails')), `the failing test is named in the kept lines:\n${kept.join('\n')}`);
    assert.ok(kept.some((l) => /^ℹ fail 1\b/.test(l)), 'the totals are kept');
    assert.ok(!kept.some((l) => l.includes('the passing one')), 'the passing test is not kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
