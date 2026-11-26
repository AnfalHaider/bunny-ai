/** LOCAL-MODELS SP-7: the curated list is the two proven models only, each pinned by commit, with every check Security named. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadLocalList, checkLocalList } from '../src/providers/localList.js';

const sources = readFileSync(fileURLToPath(new URL('../src/providers/localModels.sources.md', import.meta.url)), 'utf8');

test('SP-7: the list is exactly Qwen3-4B and Granite-4.1-3B at the pinned commits, sizes and sha256 values', () => {
  const list = loadLocalList();
  assert.deepEqual(list.map((m) => m.id), ['qwen3-4b', 'granite-4.1-3b']);
  const q = list[0]; const g = list[1];
  assert.deepEqual([q.repo, q.revision, q.file, q.size, q.sha256], ['Qwen/Qwen3-4B-GGUF', 'bc640142c66e1fdd12af0bd68f40445458f3869b', 'Qwen3-4B-Q4_K_M.gguf', 2497280256, '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5']);
  assert.deepEqual([g.repo, g.revision, g.file, g.size, g.sha256], ['ibm-granite/granite-4.1-3b-GGUF', 'ab4701481089b58a082ef63cc1cee738887293ff', 'granite-4.1-3b-Q4_K_M.gguf', 2099501664, '662b0626cd58f443baea23559b469df6576a81d349649c59413b36a9fb32eb29']);
  assert.deepEqual(checkLocalList(list, { sourcesText: sources }), []);
});

test('the checks fail a wrong licence, a gated model, a branch name, a missing hash, tools without proof, a model not in the sources file, and a non-gguf file', () => {
  const base = () => JSON.parse(JSON.stringify(loadLocalList()));
  const bad = (edit) => { const l = base(); edit(l[0]); return checkLocalList(l, { sourcesText: sources }); };
  assert.ok(bad((m) => { m.licence = 'gpl-3.0'; }).some((p) => /licence/.test(p)));
  assert.ok(bad((m) => { m.gated = true; }).some((p) => /gated/.test(p)));
  assert.ok(bad((m) => { m.revision = 'main'; }).some((p) => /40-hex/.test(p)));
  assert.ok(bad((m) => { m.sha256 = ''; }).some((p) => /sha256/.test(p)));
  assert.ok(bad((m) => { delete m.toolsProof; }).some((p) => /S-LM2/.test(p)));
  assert.ok(bad((m) => { m.sha256 = 'a'.repeat(64); }).some((p) => /sources/.test(p)));
  assert.ok(bad((m) => { m.file = 'model.safetensors'; }).some((p) => /\.gguf/.test(p)));
  assert.ok(bad((m) => { m.kvBytesPerToken = 0; }).some((p) => /cache size/.test(p)));
});

test('SP-7: both chat templates were read from the pinned headers; each sha256 is in the sources file, and signing needs it', () => {
  const list = loadLocalList();
  assert.deepEqual(list.map((m) => [m.id, m.template.status, m.template.sha256]), [
    ['qwen3-4b', 'read', '57f1fd00f0013a2be96aa79b857391f27e23df5b5f847072b524c897e24d0361'],
    ['granite-4.1-3b', 'read', 'fed2756d2d24e127b951dcf139d0b03ab7db8ef23a456128ebc9c2db4901d476'],
  ]);
  assert.deepEqual(checkLocalList(list, { forSigning: true, sourcesText: sources }), []);
  assert.doesNotMatch(sources, /PENDING/);
  const pending = JSON.parse(JSON.stringify(list)); pending[0].template = { status: 'pending', sha256: null };
  assert.ok(checkLocalList(pending, { forSigning: true }).some((p) => /chat template has not been read/.test(p)));
  const wrong = JSON.parse(JSON.stringify(list)); wrong[1].template.sha256 = 'b'.repeat(64);
  assert.ok(checkLocalList(wrong, { sourcesText: sources }).some((p) => /template sha256 is not in/.test(p)));
});
