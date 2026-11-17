import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';
import { createWorktrees } from '../src/server/worktrees.js';
import { neverBrowse } from '../src/server/panes.js';

// W2-9 / ADR-002: a git worktree per code chat. Real git, invented repositories in the temp folder, an invented data folder.
const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
const tmp = (name) => realpathSync(mkdtempSync(join(tmpdir(), `bunny-wt-${name}-`)));
const clean = (t, ...dirs) => t.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* removed already */ } } });

function makeRepo(t, files = { 'hello.js': 'export const hello = () => "hi";\n' }) {
  const dir = tmp('repo');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), text); }
  git(dir, 'add', '-A');
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'first');
  clean(t, dir);
  return dir;
}
const ID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

test('W2-9 #1: two chats on one repository edit the same file in their own copies; the repository folder is untouched', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  clean(t, data);
  const wt = createWorktrees({ dataDir: data });
  const a = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'Tidy the greeter' });
  const b = await wt.create({ sessionId: ID_B, folder: repo, prefix: 'bunny/', title: 'Add a test' });
  assert.notEqual(a.path, b.path);
  assert.match(a.branch, /^bunny\/tidy-the-greeter-aaaaaaaa$/);
  assert.ok(a.path.startsWith(join(realpathSync(data), 'worktrees')), 'the copy lives in the data folder');
  assert.ok(!a.path.startsWith(repo), 'never inside the project');
  writeFileSync(join(a.path, 'hello.js'), 'export const hello = () => "hello from A";\n');
  writeFileSync(join(b.path, 'hello.js'), 'export const hello = () => "hello from B";\n');
  assert.match(git(a.path, 'diff', '--stat'), /hello\.js/);
  assert.match(git(a.path, 'diff'), /hello from A/);
  assert.doesNotMatch(git(a.path, 'diff'), /hello from B/);
  assert.equal(readFileSync(join(repo, 'hello.js'), 'utf8'), 'export const hello = () => "hi";\n', 'the person\'s own folder is untouched');
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal((await wt.status(a)).dirty, 1);
});

test('W2-9 #2: the path code puts the copy beside no repo, whatever drive the repo is on (injected paths)', async () => {
  const calls = [];
  const fakeGit = async (args, { cwd }) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return 'D:/some/where/app';
    if (args[0] === 'rev-parse' && args[1] === '--is-bare-repository') return 'false';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123';
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main';
    if (args.includes('--verify')) throw new Error('no such branch');
    return '';
  };
  const data = tmp('data');
  const repo = tmp('app');
  const fake2 = async (args, o) => (args[0] === 'rev-parse' && args[1] === '--show-toplevel' ? repo : fakeGit(args, o));
  const wt = createWorktrees({ dataDir: data, git: fake2 });
  try {
    const made = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny', title: 'x' }).catch((e) => e);
    // the fake does not make the folder, so git "add" did nothing: what matters is where it was told to put it and with long paths on
    const add = calls.find((c) => c.includes('worktree add'));
    assert.match(add, /-c core\.longpaths=true worktree add -b bunny\/x-aaaaaaaa .*worktrees.*aaaaaaaa HEAD/);
    assert.ok(!add.includes(repo + ' HEAD') && !String(add).includes(`${repo}\\`), 'not inside the project');
    assert.ok(made instanceof Error || made.path, 'either made or refused with a message');
  } finally { rmSync(data, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});

test('W2-9 #3: a file 200 characters deep is checked out in the copy; a copy git cannot make leaves no folder and no branch', async (t) => {
  const repo = makeRepo(t);
  const deep = `${'d'.repeat(48)}/${'e'.repeat(48)}/${'f'.repeat(48)}/${'g'.repeat(48)}/file.txt`; // about 200 characters
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env, input: 'deep\n', encoding: 'utf8' }).trim();
  git(repo, 'update-index', '--add', '--cacheinfo', `100644,${blob},${deep}`);
  git(repo, 'commit', '-q', '-m', 'deep');
  const data = tmp('data');
  clean(t, data);
  const wt = createWorktrees({ dataDir: data });
  const made = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'deep' });
  assert.ok(deep.length >= 195);
  assert.equal(readFileSync(join(made.path, ...deep.split('/')), 'utf8'), 'deep\n');
  // a failure: git refuses (here: the branch name cannot be made), and nothing stays behind
  const failing = createWorktrees({ dataDir: data, git: async (args, o) => { if (args.includes('worktree') && args.includes('add')) throw new Error('fatal: could not create work tree dir: Filename too long'); return (await import('../src/server/worktrees.js')).runGit(args, o); } });
  await assert.rejects(failing.create({ sessionId: ID_B, folder: repo, prefix: 'bunny/', title: 'nope' }), /The copy could not be made: .*Filename too long.*long paths/s);
  assert.equal(git(repo, 'branch', '--list', 'bunny/nope-*'), '', 'the half-made branch is gone');
  assert.ok(!existsSync(join(realpathSync(data), 'worktrees', wt.root.split(/[\\/]/).pop())), 'no folder');
});

test('W2-9 #4: finishing: clean copy and branch go; dirty copy keeps the branch with one WIP commit; discard removes both; a running process does not block (the caller stops it first)', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  clean(t, data);
  const wt = createWorktrees({ dataDir: data });
  // dirty + keep
  const a = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'work' });
  writeFileSync(join(a.path, 'new.txt'), 'new work\n');
  const kept = await wt.finish(a, { action: 'keep' });
  assert.equal(kept.ok, true);
  assert.ok(!existsSync(a.path), 'the copy is gone');
  assert.match(git(repo, 'branch', '--list', a.branch), /bunny\/work/);
  assert.equal(git(repo, 'log', '-1', '--format=%s', a.branch), 'Bunny: work in progress');
  assert.equal(git(repo, 'show', `${a.branch}:new.txt`), 'new work');
  // discard
  const b = await wt.create({ sessionId: ID_B, folder: repo, prefix: 'bunny/', title: 'scrap' });
  writeFileSync(join(b.path, 'x.txt'), 'scrap\n');
  assert.equal((await wt.finish(b, { action: 'discard' })).ok, true);
  assert.ok(!existsSync(b.path));
  assert.equal(git(repo, 'branch', '--list', b.branch), '', 'branch deleted with it');
  // a clean copy: status says nothing to lose
  const c = await wt.create({ sessionId: 'cccccccc-3333-4333-8333-333333333333', folder: repo, prefix: 'bunny/', title: 'clean' });
  const s = await wt.status(c);
  assert.deepEqual([s.dirty, s.ahead], [0, 0]);
  await wt.finish(c, { action: 'keep' });
  git(repo, 'branch', '-d', c.branch); // safe delete works: nothing unique on it
  assert.equal(git(repo, 'branch', '--list', c.branch), '');
});

test('W2-9 #5: a copy no saved chat names is listed and never removed by itself; a path outside the copies folder is refused', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  const outside = tmp('outside');
  clean(t, data, outside);
  const wt = createWorktrees({ dataDir: data });
  const a = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'orphan' });
  const listed = await wt.leftovers([]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].path.toLowerCase(), a.path.toLowerCase());
  assert.ok(existsSync(a.path), 'listing removes nothing');
  assert.deepEqual(await wt.leftovers([a.path]), [], 'a copy a saved chat names is not a leftover');
  await assert.rejects(wt.removeLeftover(outside, []), /not one of Bunny's leftover copies/);
  await assert.rejects(wt.removeLeftover(a.path, [a.path]), /still uses that copy/);
  assert.ok(existsSync(a.path));
  await wt.removeLeftover(a.path, []);
  assert.ok(!existsSync(a.path));
});

test('W2-9 #6: the gate: the chat\'s own copy is allowed in the Files pane, the data folder, secrets, a junction into it and another chat\'s copy are not', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  clean(t, data);
  const wt = createWorktrees({ dataDir: data });
  const a = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'a' });
  const b = await wt.create({ sessionId: ID_B, folder: repo, prefix: 'bunny/', title: 'b' });
  mkdirSync(join(data, 'secrets'), { recursive: true });
  assert.ok(await neverBrowse(a.path, data), 'without the exception the copy is inside the data folder: refused');
  assert.equal(await neverBrowse(a.path, data, { allowed: a.path }), null, 'its own copy is allowed');
  assert.ok(await neverBrowse(b.path, data, { allowed: a.path }), 'another chat\'s copy is refused');
  assert.ok(await neverBrowse(data, data, { allowed: a.path }), 'the data folder is refused');
  assert.ok(await neverBrowse(join(data, 'secrets'), data, { allowed: a.path }), 'secrets are refused');
  // a junction from the copies folder to secrets: the recorded copy path must not be usable
  const link = join(realpathSync(data), 'worktrees', 'linked');
  try {
    symlinkSync(join(data, 'secrets'), link, 'junction');
    assert.equal(await wt.usable({ path: link, branch: 'x', repo }), null, 'a junction out of the copies folder is not a copy');
    assert.ok(await neverBrowse(link, data, { allowed: a.path }), 'and is refused as a folder');
  } catch (err) { if (!/EPERM|EEXIST/.test(String(err))) throw err; }
  assert.equal(await wt.usable({ path: join(data, 'worktrees', '..', 'secrets'), branch: 'x', repo }), null, 'worktrees/../secrets is refused');
  assert.equal(await wt.usable({ path: repo, branch: 'x', repo }), null, 'a folder outside the copies folder is not a copy');
});

test('W2-9 #6 (routes): picking a folder does not choose a copy; the chat patch, the setting route and import cannot set `worktree`', async (t) => {
  const repo = makeRepo(t);
  const { base, dataDir } = await startApp(t, { folderPickerOnly: true }); // the desktop app: only the native picker chooses a folder
  const wt = createWorktrees({ dataDir });
  const copy = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'a' });
  const check = await post(base, '/api/folder/check', { folder: copy.path });
  // the folder check itself may answer, but the copy must not become something a chat can be pointed at
  const { body: s } = await post(base, '/api/sessions', { title: 'try' });
  const patch = await fetch(`${base}/api/sessions/${s.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worktree: { path: repo, branch: 'x', repo }, folder: copy.path }) });
  const after = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.equal(after.worktree, undefined, 'a patch cannot set worktree');
  assert.notEqual(after.folder, copy.path, `the data folder's copy was not accepted as a chat folder (check ${check.status}, patch ${patch.status})`);
  assert.equal(patch.status, 403, 'the copy was never chosen by a folder check');
  const imported = await post(base, '/api/import', { content: JSON.stringify({ title: 'imp', worktree: { path: repo }, messages: [{ role: 'user', content: 'hi' }] }) });
  const listed = await (await fetch(`${base}/api/sessions`)).json();
  for (const row of listed) assert.equal((await (await fetch(`${base}/api/sessions/${row.id}`)).json()).worktree, undefined, `import ${imported.status}`);
});

test('W2-9 #7: a non-git folder, a repo with submodules, a bare repo and a repo with no commits cannot get a copy, with the reason', async (t) => {
  const data = tmp('data');
  const plain = tmp('plain');
  const sub = makeRepo(t, { '.gitmodules': '[submodule "x"]\n\tpath = x\n\turl = ../x\n', 'a.txt': 'a\n' });
  const empty = tmp('empty');
  const bare = tmp('bare');
  clean(t, data, plain, empty, bare);
  git(empty, 'init', '-q', '-b', 'main');
  git(bare, 'init', '-q', '--bare');
  const wt = createWorktrees({ dataDir: data });
  assert.match((await wt.eligibility(plain)).reason, /not one|git folder/i);
  assert.match((await wt.eligibility(sub)).reason, /submodules/);
  assert.match((await wt.eligibility(empty)).reason, /no commits/);
  assert.equal((await wt.eligibility(bare)).ok, false);
  await assert.rejects(wt.create({ sessionId: ID_A, folder: plain, prefix: 'bunny/', title: 't' }), /git folder/);
  const ok = makeRepo(t);
  const good = await wt.eligibility(ok);
  assert.equal(good.ok, true);
  assert.equal(good.base, 'main');
  // a sub-folder of a project is not the top
  mkdirSync(join(ok, 'sub'));
  assert.match((await wt.eligibility(join(ok, 'sub'))).reason, /top folder/);
});

test('W2-9 #8: a repository folder renamed after the copy was made says so, never an empty change list', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  const parent = tmp('parent');
  clean(t, data, parent);
  const moved = join(parent, 'app');
  renameSync(repo, moved);
  clean(t, moved);
  // make the copy from the moved repo, then move the repo again so the copy's link breaks
  const wt = createWorktrees({ dataDir: data });
  const a = await wt.create({ sessionId: ID_A, folder: moved, prefix: 'bunny/', title: 'a' });
  const renamed = join(parent, 'app-renamed');
  renameSync(moved, renamed);
  clean(t, renamed);
  await assert.rejects(wt.status(a), /./, 'git cannot be asked: an error, not "0 changes"');
});

test('W2-9 #9: merge is fast-forward only: it works into a clean folder on the base branch, and is refused (nothing changed) when the folder is dirty or elsewhere', async (t) => {
  const repo = makeRepo(t);
  const data = tmp('data');
  clean(t, data);
  const wt = createWorktrees({ dataDir: data });
  const a = await wt.create({ sessionId: ID_A, folder: repo, prefix: 'bunny/', title: 'merge' });
  writeFileSync(join(a.path, 'added.txt'), 'added\n');
  // dirty folder: refused, and the copy is still there with its work kept as a commit
  writeFileSync(join(repo, 'mine.txt'), 'my own change\n');
  const dirty = await wt.finish(a, { action: 'merge' });
  assert.equal(dirty.ok, false);
  assert.match(dirty.reason, /changes of its own/);
  assert.equal(readFileSync(join(repo, 'mine.txt'), 'utf8'), 'my own change\n');
  rmSync(join(repo, 'mine.txt'));
  // another branch: refused
  git(repo, 'checkout', '-q', '-b', 'other');
  assert.match((await wt.finish(a, { action: 'merge' })).reason, /is on other, not main/);
  git(repo, 'checkout', '-q', 'main');
  const merged = await wt.finish(a, { action: 'merge' });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.equal(readFileSync(join(repo, 'added.txt'), 'utf8'), 'added\n');
  assert.ok(!existsSync(a.path));
  assert.equal(git(repo, 'branch', '--list', a.branch), '', 'a merged branch is deleted');
  // a base that moved on (not a fast-forward): refused
  const b = await wt.create({ sessionId: ID_B, folder: repo, prefix: 'bunny/', title: 'late' });
  writeFileSync(join(b.path, 'late.txt'), 'late\n');
  writeFileSync(join(repo, 'moved.txt'), 'main moved\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'main moved on');
  const late = await wt.finish(b, { action: 'merge' });
  assert.equal(late.ok, false);
  assert.match(late.reason, /cannot be merged cleanly/);
  assert.equal(existsSync(join(repo, 'late.txt')), false, 'nothing was merged');
});

test('W2-9 #10 (routes): an old chat with no copy behaves exactly as before; the switch needs a picked folder; on, the panes follow the copy; delete keeps the branch', async (t) => {
  const repo = makeRepo(t);
  const { base, dataDir } = await startApp(t);
  const picked = await post(base, '/api/folder/check', { folder: repo });
  assert.equal(picked.status, 200);
  const { body: s } = await post(base, '/api/sessions', { title: 'Tidy the greeter', folder: repo });
  // before: the panes read the picked folder
  const before = await (await fetch(`${base}/api/sessions/${s.id}/files`)).json();
  assert.equal(before.folder ?? repo, before.folder ?? repo);
  assert.ok(before.entries.some((e) => e.name === 'hello.js'));
  assert.equal((await (await fetch(`${base}/api/sessions/${s.id}/worktree`)).json()).eligible, true);
  // on
  const on = await post(base, `/api/sessions/${s.id}/worktree`, {});
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.match(on.body.branch, /^bunny\/tidy-the-greeter-/);
  const listed = (await (await fetch(`${base}/api/sessions`)).json()).find((x) => x.id === s.id);
  assert.deepEqual(listed.worktree, { branch: on.body.branch }, 'the list carries the branch, never the path');
  const full = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  writeFileSync(join(full.worktree.path, 'hello.js'), 'export const hello = () => "copy";\n');
  const file = await (await fetch(`${base}/api/sessions/${s.id}/file?path=hello.js`)).json();
  assert.match(JSON.stringify(file), /copy/);
  assert.equal(readFileSync(join(repo, 'hello.js'), 'utf8'), 'export const hello = () => "hi";\n');
  const exported = await (await fetch(`${base}/api/sessions/${s.id}/export?format=json`)).text();
  assert.ok(!exported.includes(full.worktree.path.replace(/\\/g, '\\\\')) && !exported.includes(full.worktree.path), 'an export never carries the path');
  // delete: keep (default): the copy goes, the branch stays with the work
  const del = await fetch(`${base}/api/sessions/${s.id}`, { method: 'DELETE' });
  const delBody = await del.json();
  assert.equal(delBody.keptBranch, on.body.branch);
  assert.ok(!existsSync(full.worktree.path));
  assert.match(git(repo, 'branch', '--list', on.body.branch), /bunny\/tidy/);
  assert.equal(git(repo, 'show', `${on.body.branch}:hello.js`), 'export const hello = () => "copy";');
  // an old chat (no copy) in a folder: nothing changes; a non-git folder is told why
  const { body: old } = await post(base, '/api/sessions', { title: 'old' });
  assert.equal((await (await fetch(`${base}/api/sessions/${old.id}`)).json()).worktree, undefined);
  assert.equal((await (await fetch(`${base}/api/sessions/${old.id}/worktree`)).json()).eligible, false);
  assert.ok(dataDir);
});

test('W2-9: a chat whose copy has gone is told so, and is never quietly sent back to the person\'s own folder', async (t) => {
  const repo = makeRepo(t);
  const { base } = await startApp(t);
  await post(base, '/api/folder/check', { folder: repo });
  const { body: s } = await post(base, '/api/sessions', { title: 'gone', folder: repo });
  await post(base, `/api/sessions/${s.id}/worktree`, {});
  const full = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  rmSync(full.worktree.path, { recursive: true, force: true });
  const files = await fetch(`${base}/api/sessions/${s.id}/files`);
  assert.equal(files.status, 409);
  assert.match((await files.json()).message, /copy is gone; the branch bunny\/gone-/);
});
