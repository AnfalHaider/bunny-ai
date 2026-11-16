/**
 * W2-3: edit_file replace_all, and multi_edit: several replacements to one file, all or nothing, one checkpoint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspace, describeToolCall, workspaceToolDefinitions, TOOL_RISK } from '../src/server/workspace.js';
import { createCheckpoints } from '../src/server/checkpoints.js';

function setup(t, text, opts) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-edit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'f.txt'), text);
  return { root, ws: createWorkspace(root, opts), read: () => readFileSync(join(root, 'f.txt'), 'utf8') };
}

test('edit_file: still refuses a snippet that appears twice, now saying replace_all is the way', async (t) => {
  const { ws, read } = setup(t, 'a b a');
  await assert.rejects(ws.run('edit_file', { path: 'f.txt', old_text: 'a', new_text: 'x' }), /appears 2 times.*replace_all/);
  assert.equal(read(), 'a b a');
});

test('edit_file: replace_all changes every occurrence and counts them', async (t) => {
  const { ws, read } = setup(t, 'foo(1); foo(2); bar(foo)');
  const r = await ws.run('edit_file', { path: 'f.txt', old_text: 'foo', new_text: 'baz', replace_all: true });
  assert.equal(r, 'Edited f.txt (3 replacements)');
  assert.equal(read(), 'baz(1); baz(2); bar(baz)');
});

test('edit_file: replace_all with one occurrence, with none, and with text that looks like a replacement pattern', async (t) => {
  const { ws, read } = setup(t, 'one two');
  assert.equal(await ws.run('edit_file', { path: 'f.txt', old_text: 'one', new_text: 'a$&b$1', replace_all: true }), 'Edited f.txt');
  assert.equal(read(), 'a$&b$1 two', '$& and $1 stay literal');
  await assert.rejects(ws.run('edit_file', { path: 'f.txt', old_text: 'zzz', new_text: 'y', replace_all: true }), /was not found/);
  await assert.rejects(ws.run('edit_file', { path: 'f.txt', old_text: '', new_text: 'y', replace_all: true }), /needs old_text/);
});

test('multi_edit: applies the edits in order, each seeing the result of the one before', async (t) => {
  const { ws, read } = setup(t, 'alpha beta gamma beta');
  const r = await ws.run('multi_edit', { path: 'f.txt', edits: [
    { old_text: 'alpha', new_text: 'one' },
    { old_text: 'beta', new_text: 'two', replace_all: true },
    { old_text: 'one two', new_text: 'ONE-TWO' },
  ] });
  assert.equal(r, 'Edited f.txt (3 edits, 4 replacements)');
  assert.equal(read(), 'ONE-TWO gamma two');
});

test('multi_edit is all or nothing: a failing second edit leaves the file untouched and names the edit', async (t) => {
  const { ws, read } = setup(t, 'keep this\nand this');
  await assert.rejects(
    ws.run('multi_edit', { path: 'f.txt', edits: [{ old_text: 'keep', new_text: 'CHANGED' }, { old_text: 'not there', new_text: 'x' }] }),
    /edit 2's old_text was not found in f\.txt\. Nothing was changed/);
  assert.equal(read(), 'keep this\nand this');
  await assert.rejects(
    ws.run('multi_edit', { path: 'f.txt', edits: [{ old_text: 'this', new_text: 'that' }] }),
    /edit 1's old_text appears 2 times/);
  assert.equal(read(), 'keep this\nand this');
});

test('multi_edit: one checkpoint covers the file, and one Undo restores it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bunny-edit-'));
  const store = mkdtempSync(join(tmpdir(), 'bunny-cp-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  writeFileSync(join(root, 'f.txt'), 'a b c');
  const cps = createCheckpoints({ dir: store });
  const sessionId = '11111111-1111-1111-1111-111111111111';
  const cp = cps.begin(sessionId, root);
  let captures = 0;
  const ws = createWorkspace(root, { beforeWrite: async (abs) => { captures += 1; await cp.capture(abs); } });
  await ws.run('multi_edit', { path: 'f.txt', edits: [{ old_text: 'a', new_text: 'A' }, { old_text: 'b', new_text: 'B' }, { old_text: 'c', new_text: 'C' }] });
  assert.equal(captures, 1, 'one capture for three edits');
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), 'A B C');
  const listed = await cps.list(sessionId);
  assert.equal(listed.length, 1, 'one checkpoint');
  await cps.restore(sessionId, listed[0].id);
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), 'a b c');
});

test('multi_edit: nothing is captured when it fails', async (t) => {
  let captures = 0;
  const { ws } = setup(t, 'abc', { beforeWrite: async () => { captures += 1; } });
  await assert.rejects(ws.run('multi_edit', { path: 'f.txt', edits: [{ old_text: 'zzz', new_text: 'y' }] }));
  assert.equal(captures, 0);
});

test('multi_edit: bad input, a path outside the folder, and the 50-edit cap', async (t) => {
  const { ws } = setup(t, 'abc');
  await assert.rejects(ws.run('multi_edit', { path: 'f.txt' }), /needs a list of edits/);
  await assert.rejects(ws.run('multi_edit', { path: 'f.txt', edits: [] }), /needs a list of edits/);
  await assert.rejects(ws.run('multi_edit', { path: 'f.txt', edits: [{ new_text: 'x' }] }), /needs old_text/);
  await assert.rejects(ws.run('multi_edit', { path: '../x.txt', edits: [{ old_text: 'a', new_text: 'b' }] }), /outside/);
  await assert.rejects(ws.run('multi_edit', { path: 'f.txt', edits: Array.from({ length: 51 }, () => ({ old_text: 'a', new_text: 'a' })) }), /at most 50/);
});

test('multi_edit is an edit-risk tool: offered with edit tools, not with read-only ones, and described for the transcript', () => {
  assert.equal(TOOL_RISK.multi_edit, 'edit');
  assert.ok(workspaceToolDefinitions(['edit']).some((d) => d.function.name === 'multi_edit'));
  assert.ok(!workspaceToolDefinitions(['read']).some((d) => d.function.name === 'multi_edit'));
  const def = workspaceToolDefinitions(['edit']).find((d) => d.function.name === 'multi_edit').function.parameters;
  assert.deepEqual(def.required, ['path', 'edits']);
  assert.equal(describeToolCall('multi_edit', { path: 'a.js', edits: [{}, {}] }), 'Edit a.js (2 changes)');
  assert.equal(describeToolCall('edit_file', { path: 'a.js', replace_all: true }), 'Edit a.js (all occurrences)');
  assert.equal(describeToolCall('edit_file', { path: 'a.js' }), 'Edit a.js');
});
