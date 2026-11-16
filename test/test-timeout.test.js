import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// W4-1c: a hung test must fail with its own name instead of stalling the gate for minutes.
test('the unit-test script gives every test a timeout', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const m = /--test-timeout=(\d+)/.exec(pkg.scripts.test);
  assert.ok(m, 'npm test passes --test-timeout');
  assert.ok(Number(m[1]) >= 30_000 && Number(m[1]) <= 300_000, 'between 30 s and 5 min');
});
