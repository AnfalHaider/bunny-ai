/**
 * REWIND (v0.1.15): the plan and the write, on invented temp folders. Nothing here touches a real profile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCheckpoints } from '../src/server/checkpoints.js';
import { apply, plan } from '../src/server/rewind.js';

const SID = randomUUID();

async function fixture(t, opts = {}) {
  const base = await mkdtemp(join(tmpdir(), 'bunny-rewind-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'project');
  await mkdir(root);
  const cps = createCheckpoints({ dir: join(base, 'cps'), ...opts });
  /** one reply: capture each path, change it (null = delete), finish. Returns the checkpoint as stored. */
  async function reply(changes, { commands = false, kind } = {}) {
    const cp = cps.begin(SID, root, kind ? { kind } : undefined);
    for (const [rel, content] of Object.entries(changes)) {
      const abs = join(root, rel);
      await cp.capture(abs);
      if (content === null) await rm(abs, { force: true });
      else { await mkdir(join(abs, '..'), { recursive: true }); await writeFile(abs, content); }
    }
    if (commands) await cp.markCommands();
    await cp.finish(randomUUID());
    return cps.get(SID, cp.id);
  }
  const read = (rel) => readFile(join(root, rel), 'utf8');
  const exists = (rel) => stat(join(root, rel)).then(() => true, () => false);
  return { base, root, cps, reply, read, exists, dataDir: join(base, 'data') };
}
const act = (p, path) => p.files.find((f) => f.path === path)?.action;

test('1. three replies: rewinding to before the first puts a back, removes b, and a second rewind finds nothing to do', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2' });
  const c2 = await f.reply({ 'b.txt': 'new' });
  const c3 = await f.reply({ 'a.txt': '3', 'b.txt': 'newer' });
  const cps = [c1, c2, c3];
  const p = await plan({ cps, root: f.root });
  assert.equal(act(p, 'a.txt'), 'restore');
  assert.equal(act(p, 'b.txt'), 'delete');
  const r = await apply({ cps, root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('a.txt'), '1');
  assert.equal(await f.exists('b.txt'), false);
  assert.deepEqual(r.handled.sort(), cps.map((c) => c.id).sort());
  const again = await plan({ cps, root: f.root });
  assert.deepEqual(again.files.map((x) => x.action), ['same', 'same']);
});

test('2. rewinding to before reply 2 leaves reply 1\'s state', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  await f.reply({ 'a.txt': '2' });
  const c2 = await f.reply({ 'a.txt': '3', 'b.txt': 'x' });
  await apply({ cps: [c2], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('a.txt'), '2');
  assert.equal(await f.exists('b.txt'), false);
});

test('3. a file the person edits afterwards is "changed": left alone unless ticked', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2' });
  await writeFile(join(f.root, 'a.txt'), 'my own edit');
  const p = await plan({ cps: [c1], root: f.root });
  assert.equal(act(p, 'a.txt'), 'changed');
  const r = await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('a.txt'), 'my own edit');
  assert.deepEqual(r.left, ['a.txt']);
  assert.equal(r.undoId, null, 'nothing was written, so no safety checkpoint');
  const r2 = await apply({ cps: [c1], root: f.root, include: ['a.txt'], checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('a.txt'), '1');
  assert.equal(r2.putBack, 1);
});

test('4. an old checkpoint without "after" counts every file as changed', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2' });
  delete c1.after;
  const p = await plan({ cps: [c1], root: f.root });
  assert.equal(act(p, 'a.txt'), 'changed');
});

test('5. a file over 5 MB is "big" and left alone', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'big.bin'), Buffer.alloc(5 * 1024 * 1024 + 10, 1));
  const c1 = await f.reply({ 'big.bin': 'small now' });
  const p = await plan({ cps: [c1], root: f.root });
  assert.equal(act(p, 'big.bin'), 'big');
  await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('big.bin'), 'small now');
});

test('6. G2: a path behind a junction or link, under .git, in another folder, or under a deny rule is refused', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'sub'));
  await writeFile(join(f.root, 'sub', 'x.txt'), 'old');
  await writeFile(join(f.root, 'keep.txt'), 'old');
  await mkdir(join(f.root, '.git'));
  const c1 = await f.reply({ 'sub/x.txt': 'new', 'keep.txt': 'new' });
  // a link replaces the folder after the reply
  const outside = join(f.base, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'x.txt'), 'new'); // same bytes as "after": only the link check can stop it
  await rm(join(f.root, 'sub'), { recursive: true });
  await symlink(outside, join(f.root, 'sub'), 'junction');
  const p = await plan({ cps: [c1], root: f.root, deny: (rel) => (rel === 'keep.txt' ? 'Your rule "keep.txt" blocks edits.' : null) });
  assert.equal(act(p, 'sub/x.txt'), 'refused');
  assert.equal(act(p, 'keep.txt'), 'refused');
  assert.match(p.files.find((x) => x.path === 'keep.txt').why, /rule/);
  await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID, deny: () => null });
  assert.equal(await readFile(join(outside, 'x.txt'), 'utf8'), 'new', 'nothing was written through the link');
  // .git
  const g = { ...c1, files: [{ path: join(f.root, '.git', 'hooks'), existed: false }], after: { [join(f.root, '.git', 'hooks')]: { hash: 'absent' } } };
  assert.equal(act(await plan({ cps: [g], root: f.root }), '.git/hooks'), 'refused');
  // another folder
  const other = { ...c1, root: join(f.base, 'elsewhere') };
  assert.ok((await plan({ cps: [other], root: f.root })).files.every((x) => x.action === 'refused'));
});

test('7. undoing the rewind brings back the exact bytes from before it', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2', 'n.txt': 'new' });
  const r = await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.ok(r.undoId);
  assert.equal(await f.read('a.txt'), '1');
  const rewound = await f.cps.get(SID, r.undoId);
  assert.equal(rewound.kind, 'rewind');
  await apply({ cps: [rewound], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('a.txt'), '2');
  assert.equal(await f.read('n.txt'), 'new');
});

test('8. a failed write stops, lists done and not done, and the done ones are covered by the safety checkpoint', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  await writeFile(join(f.root, 'b.txt'), '1');
  await writeFile(join(f.root, 'c.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2', 'b.txt': '2', 'c.txt': '2' });
  let n = 0;
  const { rename } = await import('node:fs/promises');
  const ops = { rename: async (from, to) => { n += 1; if (n === 2) throw new Error('locked'); return rename(from, to); } };
  const r = await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID, ops });
  assert.deepEqual(r.done, ['a.txt']);
  assert.deepEqual(r.failed.map((x) => x.path), ['b.txt', 'c.txt']);
  assert.ok(!(await readdir(f.root)).some((x) => x.includes('bunny-rewind')), 'no temp file left behind');
  assert.equal(r.handled.length, 0, 'a checkpoint with a failed file is not marked undone');
  const safety = await f.cps.get(SID, r.undoId);
  assert.ok(safety.files.some((x) => x.path === join(f.root, 'a.txt')));
});

test('10. limits: the 101st checkpoint removes the oldest; a small byte cap removes the oldest; deleting a chat removes its folder', async (t) => {
  const f = await fixture(t, { maxPerChat: 3 });
  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push((await f.reply({ [`f${i}.txt`]: 'x' })).id);
  const left = (await f.cps.list(SID)).map((c) => c.id);
  assert.equal(left.length, 3);
  assert.ok(!left.includes(ids[0]));
  const g = await fixture(t, { maxBytes: 700 });
  for (let i = 0; i < 5; i += 1) await g.reply({ [`f${i}.txt`]: 'x'.repeat(40) });
  assert.ok((await g.cps.list(SID)).length < 5);
  await g.cps.removeChat(SID);
  assert.deepEqual(await g.cps.list(SID), []);
});

test('12. a reply that ran a command is flagged, and the preview says so', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2' }, { commands: true });
  assert.equal(c1.commands, true);
  assert.equal((await plan({ cps: [c1], root: f.root })).commandsRan, true);
  const c2 = await f.reply({ 'a.txt': '3' });
  assert.equal((await plan({ cps: [c2], root: f.root })).commandsRan, false);
});

test('14. RW-2: a delete aimed at a folder is refused; an existing temp-style name is never clobbered; missing parents are made level by level', async (t) => {
  const f = await fixture(t);
  // the file a reply made is now a folder
  const c1 = await f.reply({ 'made.txt': 'x' });
  await rm(join(f.root, 'made.txt'));
  await mkdir(join(f.root, 'made.txt'));
  await writeFile(join(f.root, 'made.txt', 'inner'), 'keep');
  const p = await plan({ cps: [c1], root: f.root });
  assert.equal(act(p, 'made.txt'), 'refused');
  await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('made.txt/inner'), 'keep');
  // a file whose folders are gone comes back with them
  await mkdir(join(f.root, 'd1', 'd2'), { recursive: true });
  await writeFile(join(f.root, 'd1', 'd2', 'deep.txt'), 'deep');
  const c2 = await f.reply({ 'd1/d2/deep.txt': null });
  await rm(join(f.root, 'd1'), { recursive: true });
  const r = await apply({ cps: [c2], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.equal(await f.read('d1/d2/deep.txt'), 'deep');
  assert.equal(r.putBack, 1);
  // a link planted at the first level stops the folders being made
  await rm(join(f.root, 'd1'), { recursive: true });
  const outside = join(f.base, 'outside2');
  await mkdir(outside);
  await symlink(outside, join(f.root, 'd1'), 'junction');
  const r2 = await apply({ cps: [c2], root: f.root, checkpoints: f.cps, sessionId: SID });
  assert.deepEqual(await readdir(outside), []);
  assert.equal(r2.putBack, 0);
});

test('15. RW-3: "include" only counts paths the preview calls changed; the rest are ignored and counted', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  await writeFile(join(f.root, 'other.txt'), 'untouched');
  const c1 = await f.reply({ 'a.txt': '2' });
  const r = await apply({ cps: [c1], root: f.root, include: ['other.txt', '../escape.txt', join(f.base, 'x')], checkpoints: f.cps, sessionId: SID });
  assert.equal(r.ignored, 3);
  assert.equal(await f.read('other.txt'), 'untouched');
  assert.equal(await f.read('a.txt'), '1');
});

test('14b. RW-2: the restore is written with flag wx, so a file already named like the temp file is never clobbered', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'a.txt'), '1');
  const c1 = await f.reply({ 'a.txt': '2' });
  const { writeFile: realWrite } = await import('node:fs/promises');
  const seen = [];
  const ops = { writeFile: async (p, data, o) => { seen.push(o?.flag); return realWrite(p, data, o); } };
  await apply({ cps: [c1], root: f.root, checkpoints: f.cps, sessionId: SID, ops });
  assert.ok(seen.includes('wx'));
  assert.equal(await f.read('a.txt'), '1');
});
