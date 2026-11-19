import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// SEARCH-PC: the smoke script for QA (the real index, invented files). Here only its dry run and its guards: it never runs against the real index in the gate.
test('without the explicit flag the script refuses, names the exact folder it would create and delete, and creates nothing', async () => {
  const r = spawnSync(process.execPath, ['scripts/pcsearch-smoke.mjs'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /REFUSED: this script writes into the real Documents folder/);
  const named = /^  (.*bunny-pcsearch-smoke-[0-9a-f]{6})$/m.exec(r.stdout)?.[1];
  assert.ok(named, 'the folder is named');
  assert.match(r.stdout, /--i-have-the-owners-ok/);
  assert.equal(existsSync(named), false, 'nothing was created');
  const other = spawnSync(process.execPath, ['scripts/pcsearch-smoke.mjs', '--yes'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(other.status, 2, 'only the exact flag counts');
});

test('the smoke script says what it would do and touches nothing in a dry run; it removes only a folder it made under Documents', async () => {
  const r = spawnSync(process.execPath, ['scripts/pcsearch-smoke.mjs', '--dry'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dry run, nothing touched/);
  assert.match(r.stdout, /bunny-pcsearch-smoke-[0-9a-f]{6}/);
  const src = await readFile(new URL('../scripts/pcsearch-smoke.mjs', import.meta.url), 'utf8');
  assert.match(src, /resolve\(folder, '\.\.'\) === resolve\(documents\)/, 'the delete is guarded: the folder must sit directly under Documents');
  assert.match(src, /bunny-pcsearch-smoke-\[0-9a-f\]\{6\}\$/);
});
