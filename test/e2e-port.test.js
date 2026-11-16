/**
 * W4-1: the browser-test port belongs to the run, not to the repository, so gates in two worktrees can run at once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SETUP = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'setup.js')).href;

function load(env) {
  const code = `const m = await import(${JSON.stringify(SETUP)}); console.log(JSON.stringify({ port: m.PORT, dir: m.dataDir, env: process.env.BUNNY_E2E_PORT }));`;
  const base = { ...process.env };
  delete base.BUNNY_E2E_PORT;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...base, ...env } }));
}

test('W4-1: BUNNY_E2E_PORT is honoured, and the data folder follows the port', () => {
  const r = load({ BUNNY_E2E_PORT: '5611' });
  assert.equal(r.port, 5611);
  assert.match(r.dir, /bunny-e2e-5611$/);
});

test('W4-1: without it a free port is picked, exported for the workers, and not the old fixed one', () => {
  const r = load({});
  assert.ok(Number.isInteger(r.port) && r.port > 1023 && r.port < 65536);
  assert.notEqual(r.port, 5199);
  assert.equal(r.env, String(r.port), 'written back to the environment so every worker reads the same port');
});

test('W4-1: two runs started together get different ports and folders', () => {
  const a = load({});
  const b = load({});
  assert.notEqual(a.dir === b.dir && a.port === b.port, true);
});

test('W4-1: nonsense in BUNNY_E2E_PORT falls back to a free port', () => {
  const r = load({ BUNNY_E2E_PORT: 'abc' });
  assert.ok(r.port > 0 && r.port < 65536);
});
