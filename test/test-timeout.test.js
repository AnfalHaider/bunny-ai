import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// W4-1c: a hung test must fail with its own name instead of stalling the gate for minutes.
test('the unit-test script gives every test a timeout', async () => {
  // v0.1.10 (RUN): npm test runs scripts/unit-tests.mjs, which passes --test-timeout to every node --test it starts
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /scripts\/unit-tests\.mjs/, 'npm test goes through the runner');
  const runner = await readFile(new URL('../scripts/unit-tests.mjs', import.meta.url), 'utf8');
  const m = /--test-timeout=(\d+)/.exec(runner);
  assert.ok(m, 'the runner passes --test-timeout');
  assert.ok(Number(m[1]) >= 30_000 && Number(m[1]) <= 300_000, 'between 30 s and 5 min');
});
