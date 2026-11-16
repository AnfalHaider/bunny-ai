import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace } from '../src/server/workspace.js';
import { readFileUrlIn } from '../src/server/app.js';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'bunny-w69-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'work'); const outside = join(base, 'outside');
  await mkdir(join(root, 'sub'), { recursive: true }); await mkdir(outside);
  await writeFile(join(root, 'a.txt'), 'hello inside');
  await writeFile(join(outside, 's.txt'), 'secret');
  return { root, outside, ws: createWorkspace(root) };
}

test('read_file on a folder lists it', async (t) => {
  const { ws } = await fixture(t);
  const out = await ws.run('read_file', { path: '.' });
  assert.match(out, /^\(that is a folder; its contents:\)/);
  assert.match(out, /sub\//); assert.match(out, /a\.txt/);
  await assert.rejects(ws.run('read_file', { path: '..' }), /outside/);
});

test('read_url file:// inside the workspace reads the file', async (t) => {
  const { root, ws } = await fixture(t);
  assert.equal(await readFileUrlIn(ws, pathToFileURL(join(root, 'a.txt')).href), 'hello inside');
});

test('read_url file:// outside the workspace is refused', async (t) => {
  const { outside, ws } = await fixture(t);
  await assert.rejects(readFileUrlIn(ws, pathToFileURL(join(outside, 's.txt')).href), /inside the workspace/);
});

test('read_url file:// through a link pointing outside is refused', async (t) => {
  const { root, outside, ws } = await fixture(t);
  try { await symlink(outside, join(root, 'link'), 'junction'); } catch { t.skip('cannot create a link here'); return; }
  await assert.rejects(readFileUrlIn(ws, pathToFileURL(join(root, 'link', 's.txt')).href), /inside the workspace/);
});

test('read_url file:// in Chat mode (no workspace) is refused', () => {
  assert.throws(() => readFileUrlIn(null, 'file:///etc/hosts'), /Chat mode/);
});
