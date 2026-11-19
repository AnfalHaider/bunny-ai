import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// SEARCH-PC: the smoke script for QA (the real index, invented files). Here only its dry run and its guards: it never runs against the real index in the gate.
test('the smoke script says what it would do and touches nothing in a dry run; it removes only a folder it made under Documents', async () => {
  const r = spawnSync(process.execPath, ['scripts/pcsearch-smoke.mjs', '--dry'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dry run, nothing touched/);
  assert.match(r.stdout, /bunny-pcsearch-smoke-[0-9a-f]{6}/);
  const src = await readFile(new URL('../scripts/pcsearch-smoke.mjs', import.meta.url), 'utf8');
  assert.match(src, /resolve\(folder, '\.\.'\) === resolve\(documents\)/, 'the delete is guarded: the folder must sit directly under Documents');
  assert.match(src, /bunny-pcsearch-smoke-\[0-9a-f\]\{6\}\$/);
});
