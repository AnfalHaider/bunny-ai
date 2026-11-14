/**
 * Keeps the feature tally honest.
 *
 * docs/FEATURE-TALLY.md is what a person reads; docs/features.js is what this
 * test reads. A row may only be status 'D' when it names a test that actually
 * exists in test/ or e2e/. Without this, the matrix drifts into marketing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FEATURES, countBy, byArea } from '../docs/features.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Collect every test title declared in the two test trees. */
async function declaredTestTitles() {
  const titles = new Set();
  for (const dir of ['test', 'e2e']) {
    let names = [];
    try {
      names = await readdir(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.js')) continue;
      if (name === 'tally.test.js') continue;
      const source = await readFile(join(ROOT, dir, name), 'utf8');
      for (const match of source.matchAll(/\btest\(\s*'([^']+)'/g)) titles.add(match[1]);
    }
  }
  return titles;
}

test('every feature row has a unique id', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature id in docs/features.js');
});

test('every row has a known status and scope', () => {
  const STATUS = new Set(['D', 'P', 'M']);
  const SCOPE = new Set(['core', 'app', 'platform', 'enterprise']);
  for (const f of FEATURES) {
    assert.ok(STATUS.has(f.status), `${f.id} has status ${f.status}`);
    assert.ok(SCOPE.has(f.scope), `${f.id} has scope ${f.scope}`);
    assert.ok(f.name?.trim(), `${f.id} has no name`);
    assert.ok(f.area?.trim(), `${f.id} has no area`);
  }
});

test('a feature marked done names the test that proves it', () => {
  for (const f of FEATURES.filter((row) => row.status === 'D')) {
    assert.ok(f.test, `${f.id} (${f.name}) is marked done but names no test`);
  }
});

test('every test named by a done row actually exists', async () => {
  const titles = await declaredTestTitles();
  const missing = FEATURES
    .filter((f) => f.status === 'D')
    .filter((f) => !titles.has(f.test))
    .map((f) => `${f.id} ${f.name} -> "${f.test}"`);
  assert.deepEqual(missing, [], `tally names tests that do not exist:\n${missing.join('\n')}`);
});

test('the readable tally is the rendered registry', async () => {
  const { render } = await import('../scripts/feature-tally.mjs');
  const doc = await readFile(join(ROOT, 'docs', 'FEATURE-TALLY.md'), 'utf8');
  assert.equal(doc, render(), 'docs/FEATURE-TALLY.md is stale; run: node scripts/feature-tally.mjs');
});

test('the area breakdown adds up to the total', () => {
  const areas = byArea();
  const sum = Object.values(areas).reduce((n, a) => n + a.total, 0);
  assert.equal(sum, FEATURES.length);
});
