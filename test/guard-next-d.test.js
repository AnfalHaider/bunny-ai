/**
 * G-1 / D: `bootstrap role` narrows a session's plugins to its kit; it never widens past what the
 * project settings enable (the wildcard "*-lsp" once switched php-lsp and csharp-lsp back on).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BIN, makeRepo, runNode } from './guard-helpers.js';

const cli = join(BIN, 'bootstrap.mjs');

function projectWith(t, enabledPlugins, kit) {
  const root = makeRepo(t, null, { roles: { builder: `write_globs: []\nkit_plugins: [${kit}]\ndeny: []` } });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins }));
  return root;
}
const localPlugins = (root) => JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8')).enabledPlugins;

test('D: a wildcard kit entry never re-enables a plugin the project turns off', (t) => {
  const root = projectWith(t, {
    'typescript-lsp@official': true, 'php-lsp@official': false, 'csharp-lsp@official': false,
    'superpowers@official': true, 'frontend-design@official': true, 'bootstrap-environment@x': true,
  }, '*-lsp, superpowers');
  assert.equal(runNode(cli, ['role', 'builder'], root).code, 0);
  const p = localPlugins(root);
  assert.equal(p['typescript-lsp@official'], true);
  assert.equal(p['php-lsp@official'], false, 'stays off');
  assert.equal(p['csharp-lsp@official'], false, 'stays off');
  assert.equal(p['superpowers@official'], true);
  assert.equal(p['frontend-design@official'], false, 'not in the kit: narrowed off');
  assert.equal(p['bootstrap-environment@x'], true, 'the toolkit plugin stays on');
});

test('D: the toolkit plugin is not switched on if the project has it off', (t) => {
  const root = projectWith(t, { 'bootstrap-environment@x': false, 'typescript-lsp@official': true }, '*-lsp');
  runNode(cli, ['role', 'builder'], root);
  assert.equal(localPlugins(root)['bootstrap-environment@x'], false);
});

test('D: a kit that matches nothing narrows everything off; an empty kit changes nothing', (t) => {
  const root = projectWith(t, { 'a@x': true, 'b@x': true }, 'nothing-matches');
  runNode(cli, ['role', 'builder'], root);
  assert.deepEqual(localPlugins(root), { 'a@x': false, 'b@x': false });
  const none = projectWith(t, { 'a@x': true }, '');
  runNode(cli, ['role', 'builder'], none);
  assert.equal(localPlugins(none), undefined);
});
