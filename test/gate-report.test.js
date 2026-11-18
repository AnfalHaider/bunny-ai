import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureDetail } from '../scripts/gate-report.mjs';

test('a plain failure shows the exit status and no signal', () => {
  const d = failureDetail({ status: 1, signal: null }, []);
  assert.deepEqual(d, ['exit status: 1', 'signal: none']);
});

test('ENOBUFS shows the spawn error and the maxBuffer line', () => {
  const error = Object.assign(new Error('spawnSync npm.cmd ENOBUFS'), { code: 'ENOBUFS' });
  const d = failureDetail({ status: null, signal: 'SIGTERM', error }, []);
  assert.ok(d.includes('exit status: none') && d.includes('signal: SIGTERM'));
  assert.ok(d.some((l) => l.startsWith('spawn error: ENOBUFS')));
  assert.ok(d.some((l) => /maxBuffer/.test(l)));
});

test('a HUNG line is kept with the lines after it', () => {
  const d = failureDetail({ status: 1 }, ['ok', 'HUNG: "x" printed nothing for 4 minutes. The last thing it printed:', 'tail line']);
  assert.ok(d.some((l) => l.startsWith('HUNG:')));
  assert.ok(d.includes('tail line'));
  assert.ok(!d.includes('ok'));
});

test('an EXIT line is kept', () => {
  const line = 'EXIT: "all other unit tests, in parallel" ended with code 1, signal none';
  assert.ok(failureDetail({ status: 1 }, ['x', line]).includes(line));
});

test('a passing result gives exactly the two first lines and no spawn error', () => {
  const d = failureDetail({ status: 0 }, ['fine']);
  assert.deepEqual(d, ['exit status: 0', 'signal: none']);
});

test('a HUNG line keeps the 20 lines after it (the list of tests still running reaches the report), and no more', () => {
  const out = ['HUNG: "x" printed nothing for 4 minutes.', ...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)];
  const d = failureDetail({ status: 1 }, out);
  assert.ok(d.includes('line 20'));
  assert.ok(!d.includes('line 21'));
});
