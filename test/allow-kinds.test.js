/** AGENT-FLOW F9: "Allow for this chat". The kinds are made from the call's own arguments; the list lives on the chat and is written only by the server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addKind, browserKind, browserMatches, commandKind, commandMatches, connectorKind, connectorMatches, editKind, editMatches,
  computerKind, MAX_KINDS, reasonLine, saveRuleFor, storable,
} from '../src/server/allowKinds.js';
import { WINDOW_ONLY_ROUTES, isWindowOnlyRoute } from '../src/server/windowOnly.js';

// a fixed program table so the tests do not depend on this PC's PATH
const table = { npm: 'c:\\tools\\npm.cmd', git: 'c:\\tools\\git.exe', node: 'c:\\tools\\node.exe', rm: 'c:\\tools\\rm.exe' };
const resolver = (name) => table[String(name).toLowerCase().replace(/\.(exe|cmd)$/, '')] ?? null;
const ck = (cmd) => commandKind(cmd, { cwd: 'c:\\work', resolve: resolver });

test('F9-1: a listed pair gets a wide kind, any other plain command only its exact text', () => {
  const a = ck('npm run lint');
  assert.equal(a.kind.mode, 'pair'); assert.equal(a.kind.key, 'npm run');
  assert.equal(commandMatches(a.kind, 'npm run test', { cwd: 'c:\\work', resolve: resolver }), true);
  assert.equal(commandMatches(a.kind, 'npm install evil', { cwd: 'c:\\work', resolve: resolver }), false);
  const e = ck('node -e x');
  assert.equal(e.kind.mode, 'exact');
  assert.equal(commandMatches(e.kind, 'node -e x', { cwd: 'c:\\work', resolve: resolver }), true);
  assert.equal(commandMatches(e.kind, 'node -e xy', { cwd: 'c:\\work', resolve: resolver }), false);
  assert.equal(commandMatches(e.kind, 'node -e x y', { cwd: 'c:\\work', resolve: resolver }), false);
});

test('F9-1: a path, an option before the sub-command, a compound, or an unreadable command gets no kind', () => {
  for (const cmd of ['.\\npm run x', './npm run x', 'c:\\tools\\npm run x', 'git -c a=b commit', 'npm --prefix ..\\x run y', 'npm run a && rm -rf x', 'npm run a | tee x', 'echo $(whoami)', 'npm run "$X"', 'npm run a > out.txt']) {
    assert.equal(ck(cmd).kind, null, cmd);
  }
  assert.equal(ck('git push').kind?.mode === 'pair', false); // push is never a wide kind
  assert.ok(reasonLine('compound').startsWith('Asked every time'));
});

test('F9-1: a program that does not resolve to the same path no longer matches (a planted file)', () => {
  const a = ck('npm run lint');
  const planted = (name) => (name === 'npm' ? 'c:\\work\\npm.cmd' : null);
  assert.equal(commandMatches(a.kind, 'npm run lint', { cwd: 'c:\\work', resolve: planted }), false);
});

test('F9-2: an edit kind is the real folder below the root, never the root, never a file that runs later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'f9-edit-'));
  await mkdir(join(root, 'src', 'a'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  const k = editKind(join(root, 'src', 'a', 'x.js'), root);
  assert.equal(k.kind.type, 'edit'); assert.match(k.kind.rel, /^src\/a\/$/);
  assert.equal(editKind(join(root, 'readme.md'), root).reason, 'root');
  assert.equal(editKind(join(root, 'src', 'package.json'), root).reason, 'protectedPath');
  assert.equal(editKind(join(root, '.git', 'config'), root).reason, 'protectedPath');
  assert.equal(editKind(join(root, '..', 'out.txt'), root).kind, null);
  assert.equal(editMatches(k.kind, join(root, 'src', 'a', 'deep', 'y.js'), root), true);
  assert.equal(editMatches(k.kind, join(root, 'src', 'b.js'), root), false);
  assert.equal(editMatches(k.kind, join(root, 'src', 'a', 'package.json'), root), false);
  await writeFile(join(root, 'src', 'a', 'z.txt'), 'x');
});

test('F9-3: a connector kind uses the original tool name and never a tool that sends or buys', () => {
  const k = connectorKind({ serverId: 's1', serverName: 'Docs', toolName: 'list_files' });
  assert.equal(k.kind.key, 's1::list_files');
  assert.equal(connectorMatches(k.kind, { serverId: 's1', toolName: 'list_files' }), true);
  assert.equal(connectorMatches(k.kind, { serverId: 's1', toolName: 'renamed' }), false);
  assert.equal(connectorMatches(k.kind, { serverId: 's2', toolName: 'list_files' }), false);
  assert.equal(connectorKind({ serverId: 's1', toolName: 'send_email' }).reason, 'sends');
  assert.equal(connectorKind({ serverId: 's1', toolName: 'create-payment' }).kind, null);
  assert.equal(connectorKind({ serverId: 's1', toolName: 'delete_file' }).kind, null);
});

test('F9-4/5: computer is for this reply only; a browser kind is the exact host and a submit with text is once only', () => {
  assert.equal(computerKind().kind.thisReplyOnly, true);
  const b = browserKind('shop.example.com', { name: 'browser_click' });
  assert.equal(browserMatches(b.kind, 'shop.example.com'), true);
  assert.equal(browserMatches(b.kind, 'evil.shop.example.com'), false);
  assert.equal(browserMatches(b.kind, 'example.com'), false);
  assert.equal(browserKind('shop.example.com', { name: 'browser_type', parsed: { submit: true } }).kind, null);
  assert.equal(browserKind('shop.example.com', { name: 'browser_capture' }).kind, null);
  assert.equal(browserKind('', { name: 'browser_click' }).reason, 'noHost');
  assert.equal(browserKind('user:pw@host', { name: 'browser_click' }).kind, null);
});

test('F9-6: the saved rule text is exact, and only command and edit kinds can be saved', () => {
  const k = ck('npm run lint').kind;
  const s = saveRuleFor(k, 'c:\\work');
  assert.equal(s.rule.effect, 'allow'); assert.equal(s.rule.pattern, 'npm run *');
  assert.match(s.text, /^Allow `npm run \*` in c:\\work$/);
  assert.equal(saveRuleFor(computerKind().kind, 'c:\\work'), null);
  assert.equal(saveRuleFor(browserKind('a.com', {}).kind, 'c:\\work'), null);
  assert.equal(saveRuleFor(connectorKind({ serverId: 's', toolName: 'x' }).kind, 'c:\\work'), null);
});

test('the stored list: only checked fields, no duplicates, at most MAX_KINDS', () => {
  const k = ck('npm run lint').kind;
  let list = addKind([], { ...k, injected: 'x' });
  assert.equal(Object.hasOwn(list[0], 'injected'), false);
  list = addKind(list, k);
  assert.equal(list.length, 1);
  for (let i = 0; i < MAX_KINDS + 5; i += 1) list = addKind(list, { type: 'connector', key: `s::t${i}`, label: `t${i}` });
  assert.equal(list.length, MAX_KINDS);
  assert.ok(storable({ type: 'x', key: 'k'.repeat(900), label: 'l'.repeat(900) }).key.length <= 400);
});

test('the Forget route is window-only (a device cannot clear or read it as the window)', () => {
  const route = `/api/sessions/00000000-0000-4000-8000-000000000000/allow-kinds/all`;
  assert.ok(WINDOW_ONLY_ROUTES.length > 0);
  assert.equal(isWindowOnlyRoute('DELETE', route), true);
});
