import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgeReport, playwrightSummary } from '../scripts/gate-report.mjs';

// GATE-E2E-LIST: the gate used to show only the last 8 lines of the e2e output, which cut the list of failed tests and their count (a gate printed five failing pictures while other specs failed above them).
// Now it asks Playwright for a JSON report and prints every failed test and the totals, and the step passes only when the report is read, clean and adds up (Tech Lead's G1 to G5). A canned report stands in for the run.

const one = (status, results = [{ status: 'passed' }], projectName = 'e2e') => ({ projectName, status, results });
const canned = () => ({
  stats: { expected: 1, unexpected: 3, flaky: 1, skipped: 2 }, // skipped counts the test that never started too
  errors: [],
  suites: [
    {
      title: 'accounts.spec.js', file: 'accounts.spec.js',
      specs: [
        { title: 'Settings offers GitHub sign-in', file: 'accounts.spec.js', line: 37, tests: [one('unexpected', [{ status: 'failed', error: { message: '\u001b[31mexpect(locator).toContainText(expected) failed\u001b[39m\nExpected substring: "Needs a Google client ID"' } }])] },
        { title: 'a passing one', file: 'accounts.spec.js', line: 60, tests: [one('expected')] },
      ],
      suites: [{ title: 'a group', specs: [{ title: 'inside a group', file: 'accounts.spec.js', line: 70, tests: [one('unexpected', [{ status: 'timedOut', errors: [{ message: 'Test timeout of 30000ms exceeded.' }] }])] }] }],
    },
    {
      title: 'pictures.spec.js', file: 'pictures.spec.js',
      specs: [
        { title: 'permission-rules.png matches its screen', file: 'pictures.spec.js', line: 61, tests: [one('unexpected', [{ status: 'failed', error: { message: '777 pixels differ' } }], 'pictures')] },
        { title: 'skipped on request', file: 'pictures.spec.js', line: 9, tests: [one('skipped', [{ status: 'skipped' }], 'pictures')] },
        { title: 'never started', file: 'pictures.spec.js', line: 99, tests: [{ projectName: 'pictures', status: 'skipped', results: [] }] },
        { title: 'flaky one', file: 'pictures.spec.js', line: 12, tests: [one('flaky', [{ status: 'failed' }, { status: 'passed' }], 'pictures')] },
      ],
    },
  ],
});
// a clean run: three passes, a skipped test and nothing else
const clean = () => ({ stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 1 }, errors: [], suites: [{ title: 'a.spec.js', file: 'a.spec.js', specs: [
  { title: 'one', file: 'a.spec.js', line: 1, tests: [one('expected')] }, { title: 'two', file: 'a.spec.js', line: 2, tests: [one('expected')] }, { title: 'three', file: 'a.spec.js', line: 3, tests: [one('expected')] },
  { title: 'skipped', file: 'a.spec.js', line: 4, tests: [one('skipped', [{ status: 'skipped' }])] },
] }] });

test('every failed test is named with its project, spec:line and title, with the first line of its error, and the totals add up', () => {
  const sum = playwrightSummary(canned());
  assert.deepEqual([sum.passed, sum.failed, sum.flaky, sum.skipped, sum.didNotRun], [1, 3, 1, 1, 1]);
  assert.equal(sum.lines[0], 'totals: 1 passed, 3 failed, 1 flaky, 1 skipped, 1 did not run');
  const text = sum.lines.join('\n');
  assert.match(text, /\[e2e\] accounts\.spec\.js:37 › Settings offers GitHub sign-in {2}\[expect\(locator\)\.toContainText\(expected\) failed\]/);
  assert.match(text, /\[e2e\] accounts\.spec\.js:70 › a group › inside a group {2}\[Test timeout of 30000ms exceeded\.\]/);
  assert.match(text, /\[pictures\] pictures\.spec\.js:61 › permission-rules\.png matches its screen {2}\[777 pixels differ\]/);
  assert.match(text, /-- flaky \(1\)[^\n]*\n {2}\[pictures\] pictures\.spec\.js:12 › flaky one/, 'G5: the flaky tests are named');
  assert.doesNotMatch(text, /a passing one|skipped on request|never started/, 'only failures and flaky tests are listed');
  assert.deepEqual(playwrightSummary({ suites: [] }).failures, []);
});

test('a clean report passes, with its totals', () => {
  const v = judgeReport(clean());
  assert.equal(v.pass, true, v.reasons.join('; '));
  assert.equal(v.lines[0], 'totals: 3 passed, 0 failed, 0 flaky, 1 skipped, 0 did not run');
});

test('G1: a missing or unreadable report always fails the step', () => {
  for (const bad of [null, undefined, 'not a report', 42]) {
    const v = judgeReport(bad);
    assert.equal(v.pass, false);
    assert.match(v.lines.join('\n'), /no usable JSON report/);
  }
});

test('a failed test fails the step', () => {
  const v = judgeReport(canned());
  assert.equal(v.pass, false);
  assert.ok(v.reasons.includes('3 failed'));
});

test('G2: a test that did not run fails the step, and so does a report whose totals do not match its tests', () => {
  const never = clean();
  never.suites[0].specs.push({ title: 'never started', file: 'a.spec.js', line: 5, tests: [{ projectName: 'e2e', status: 'skipped', results: [] }] });
  never.stats.skipped = 2;
  const a = judgeReport(never);
  assert.equal(a.pass, false); assert.ok(a.reasons.includes('1 did not run'));
  const off = clean(); off.stats.expected = 4; // the report says four passed, the tests show three
  const b = judgeReport(off);
  assert.equal(b.pass, false); assert.ok(b.reasons.includes('the report totals do not match its tests'));
  assert.match(b.lines.join('\n'), /report\.stats: expected 4, unexpected 0, flaky 0, skipped 1; counted from the tests: expected 3/);
  const none = clean(); delete none.stats;
  assert.equal(judgeReport(none).pass, false, 'a report with no totals is not trusted');
});

test('G3: report errors (spec load errors, global setup) are printed and fail the step', () => {
  const r = clean();
  r.errors = [{ message: '\u001b[31mError: Cannot find module "./setup.js"\u001b[39m\n    at load (x.js:1)' }, { message: 'globalSetup failed' }];
  const v = judgeReport(r);
  assert.equal(v.pass, false);
  const text = v.lines.join('\n');
  assert.match(text, /errors in the report \(2\)/);
  assert.match(text, /Error: Cannot find module "\.\/setup\.js"/);
  assert.match(text, /globalSetup failed/);
});

test('the gate asks Playwright for the JSON report, removes a stale one first, and fails the step on the verdict even if the exit status said 0 (G1, G4)', () => {
  const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /'--reporter=line,json'/);
  assert.match(gate, /PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson/);
  assert.match(gate, /const verdict = judgeReport\(report\)/);
  assert.match(gate, /fail: !verdict\.pass/);
  assert.match(gate, /const pass = ok\(r, out\) && !extraInfo\?\.fail/);
  const run = gate.indexOf("step('end-to-end tests'");
  const stale = gate.indexOf('rmSync(e2eJson', gate.indexOf('const e2eJson'));
  assert.ok(stale > 0 && stale < run, 'the old report is removed before the run');
});
