import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepSeed, seedDirOf, seedHome, SEED_FILES } from '../src/server/engines/sandbox-seed.js';

// Codex's sandbox identity (cap_sid) is made once per CODEX_HOME at 3 to 4 minutes; the seed carries only those two files into each new chat home and nothing else.

test('the seed is made from the first run\'s home, holds only the two identity files, and a later home gets exactly those', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-seed-'));
  const R1 = join(dataDir, 'proj-one'); await mkdir(R1, { recursive: true });
  const first = join(dataDir, 'engines', 'codex', 'account', 'chat', 'a', 'codex'); await mkdir(first, { recursive: true });
  await writeFile(join(first, 'cap_sid'), '{"workspace":"S-1"}'); await writeFile(join(first, '.sandbox_migration'), 'v1'); await writeFile(join(first, 'auth.json'), 'SECRET'); await writeFile(join(first, 'config.toml'), 'x'); await writeFile(join(first, 'state_5.sqlite'), 'db');
  assert.equal(await seedHome({ dataDir, root: R1, codexHome: join(dataDir, 'h0') }), false, 'no seed yet: the slow first run');
  assert.equal(await keepSeed({ dataDir, root: R1, codexHome: join(dataDir, 'nothing') }), false);
  assert.equal(await keepSeed({ dataDir, root: R1, codexHome: first }), true);
  assert.deepEqual((await readdir(await seedDirOf(dataDir, R1))).sort(), [...SEED_FILES].sort(), 'no credential, config or state in the seed');
  const second = join(dataDir, 'h2'); await mkdir(second, { recursive: true }); await writeFile(join(second, 'config.toml'), 'mine');
  assert.equal(await seedHome({ dataDir, root: R1, codexHome: second }), true);
  assert.equal(await readFile(join(second, 'cap_sid'), 'utf8'), '{"workspace":"S-1"}');
  assert.deepEqual((await readdir(second)).sort(), ['.sandbox_migration', 'cap_sid', 'config.toml']);
  assert.equal(await readFile(join(second, 'config.toml'), 'utf8'), 'mine', 'nothing else is touched');
  // a second home never replaces the seed
  const other = join(dataDir, 'h3'); await mkdir(other, { recursive: true }); await writeFile(join(other, 'cap_sid'), '{"workspace":"S-2"}');
  assert.equal(await keepSeed({ dataDir, root: R1, codexHome: other }), false);
  assert.equal(await readFile(join(await seedDirOf(dataDir, R1), 'cap_sid'), 'utf8'), '{"workspace":"S-1"}');
  assert.equal(existsSync(join(first, 'cap_sid')), true);
});

test('EN-8: two projects get different seeds (never shared), the same project always the same one, whatever the case or a trailing slash', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bunny-seed-'));
  const a = join(dataDir, 'Proj-A'); const b = join(dataDir, 'proj-b'); await mkdir(a); await mkdir(b);
  const da = await seedDirOf(dataDir, a); const db = await seedDirOf(dataDir, b);
  assert.notEqual(da, db); assert.match(da, /sandbox-seed[/\\][a-f0-9]{64}$/);
  assert.equal(await seedDirOf(dataDir, `${a}/`), da); assert.equal(await seedDirOf(dataDir, a.toUpperCase()), da);
  const home = join(dataDir, 'h'); await mkdir(home); await writeFile(join(home, 'cap_sid'), '{"workspace":"S-A"}');
  assert.equal(await keepSeed({ dataDir, root: a, codexHome: home }), true);
  const other = join(dataDir, 'h2'); await mkdir(other);
  assert.equal(await seedHome({ dataDir, root: b, codexHome: other }), false, 'project B does not get project A seed');
  assert.equal(await seedHome({ dataDir, root: a, codexHome: other }), true);
});
