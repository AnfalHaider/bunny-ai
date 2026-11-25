import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playwrightSummary } from '../scripts/gate-report.mjs';

// GATE-E2E-LIST: the gate used to show only the last 8 lines of the e2e output, which cut the list of failed tests and their count (a gate printed five failing pictures while other specs failed above them).
// Now it asks Playwright for a JSON report and prints every failed test and the totals. A canned report stands in for the run.

const one = (status, results = [{ status: 'passed' }], projectName = 'e2e') => ({ projectName, status, results });
const canned = {
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
};

test('every failed test is named with its project, spec:line and title, with the first line of its error, and the totals add up', () => {
  const sum = playwrightSummary(canned);
  assert.deepEqual([sum.passed, sum.failed, sum.flaky, sum.skipped, sum.didNotRun], [1, 3, 1, 1, 1]);
  assert.equal(sum.lines[0], 'totals: 1 passed, 3 failed, 1 flaky, 1 skipped, 1 did not run');
  const text = sum.lines.join('\n');
  assert.match(text, /\[e2e\] accounts\.spec\.js:37 › Settings offers GitHub sign-in {2}\[expect\(locator\)\.toContainText\(expected\) failed\]/);
  assert.match(text, /\[e2e\] accounts\.spec\.js:70 › a group › inside a group {2}\[Test timeout of 30000ms exceeded\.\]/);
  assert.match(text, /\[pictures\] pictures\.spec\.js:61 › permission-rules\.png matches its screen {2}\[777 pixels differ\]/);
  assert.doesNotMatch(text, /a passing one|skipped on request|never started|flaky one/, 'only failures are listed');
  assert.deepEqual(playwrightSummary({ suites: [] }).failures, []);
});

test('the gate asks Playwright for the JSON report, prints the list, and fails the step on a failed test even if the exit status said 0', () => {
  const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /'--reporter=line,json'/);
  assert.match(gate, /PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJson/);
  assert.match(gate, /playwrightSummary\(report\)/);
  assert.match(gate, /fail: sum\.failed > 0/);
  assert.match(gate, /const pass = ok\(r, out\) && !extraInfo\?\.fail/);
});
