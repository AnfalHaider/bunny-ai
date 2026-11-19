import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { badName, describeReview, diff, discard, review, runsLater, stage, stageDirFor } from '../src/server/engines/staging.js';
import { createBridge } from '../src/server/engines/bridge.js';
import { checkRule, readDenied } from '../src/server/permissionRules.js';

// CLI-ENGINES §5.2 (CE-2): the staged copy leaves out hidden and denied paths, the data folder, engine homes, .git and config folders, and links; only allowed changes are applied through the
// workspace write path; denied and Plan-mode changes are discarded and named; deletes are judged too; the copy is removed afterwards; symlinks in the copy are not followed.

const rule = (r) => checkRule(r).rule;
const put = async (root, rel, text) => { await mkdir(dirname(join(root, rel)), { recursive: true }); await writeFile(join(root, rel), text); };

async function world() {
  const base = await mkdtemp(join(tmpdir(), 'bunny-stage-'));
  const root = join(base, 'proj'); const data = join(base, 'data');
  await mkdir(root, { recursive: true }); await mkdir(join(data, 'engines', 'codex'), { recursive: true });
  await put(root, 'a.txt', 'alpha'); await put(root, 'src/b.js', 'bee'); await put(root, 'docs/readme.md', 'read me'); await put(root, '.env', 'KEY=sk-live-secret'); await put(root, 'secrets/key.pem', 'PRIVATE');
  await put(root, '.git/config', '[core]'); await put(root, '.git/HEAD', 'ref: refs/heads/main'); await put(root, '.claude/settings.json', '{}'); await put(root, '.codex/config.toml', ''); await put(root, '.cline/x', ''); await put(root, '.aider.conf.yml', '');
  await put(base, 'outside/o.txt', 'outside'); await put(data, 'secret.json', '{}'); await put(data, 'engines/codex/h', 'home');
  return { base, root, data, dir: stageDirFor(data, 'codex', 'chat-1') };
}

const hiddenFor = (rules) => (rel) => readDenied(rules, rel);
const mk = (w, { mode = 'auto', rules = [], answer = true } = {}) => {
  const asks = []; const written = [];
  const collected = createBridge({ mode, rules, root: w.root, protect: [w.data], keyFolders: [], ask: async (summary, detail) => { asks.push({ summary, detail, from: 'bridge' }); return false; } });
  return { asks, written, judge: (call) => collected.judge(call), ask: async (summary, detail) => { asks.push({ summary, detail, from: 'card' }); return typeof answer === 'function' ? answer(detail) : answer; }, writeReal: async (rel, buf) => { written.push([rel, buf === null ? null : buf.toString('utf8')]); } };
};

test('the copy has the ordinary files and leaves out: hidden (read-deny) paths, the data folder, engine homes, .git, .claude, .codex, .cline, .aider*, and names it can never copy back', async () => {
  const w = await world();
  const rules = [rule({ kind: 'path', ops: 'reads', pattern: '.env', effect: 'deny' }), rule({ kind: 'path', ops: 'reads', pattern: 'secrets/**', effect: 'deny' })];
  const copy = await stage({ root: w.root, dir: w.dir, hidden: hiddenFor(rules), keepOut: [w.data] });
  for (const kept of ['a.txt', 'src/b.js', 'docs/readme.md']) assert.equal(existsSync(join(w.dir, ...kept.split('/'))), true, kept);
  for (const left of ['.env', 'secrets/key.pem', '.git', '.git/config', '.claude', '.codex', '.cline', '.aider.conf.yml']) assert.equal(existsSync(join(w.dir, ...left.split('/'))), false, `${left} is not in the copy`);
  assert.deepEqual([...copy.manifest.keys()].sort(), ['a.txt', 'docs/readme.md', 'src/b.js']);
  assert.ok(copy.skipped.some((s) => s.path === '.env' && /hidden/.test(s.why)));
  assert.ok(copy.skipped.some((s) => s.path === '.git' && /configuration/.test(s.why)));
  assert.equal(await readFile(join(w.dir, 'a.txt'), 'utf8'), 'alpha');
});

test('the copy has no link back: a data folder inside the project is left out, and a junction or symlink is skipped, never followed', async () => {
  const w = await world();
  await mkdir(join(w.root, 'bunnydata'), { recursive: true }); await put(w.root, 'bunnydata/secret.json', '{}');
  try {
    await symlink(join(w.base, 'outside'), join(w.root, 'link-out'), 'junction');
    await symlink(w.data, join(w.root, 'link-data'), 'junction');
  } catch (err) { if (!/EPERM|EACCES/.test(String(err.code))) throw err; }
  const copy = await stage({ root: w.root, dir: w.dir, keepOut: [join(w.root, 'bunnydata')] });
  assert.equal(existsSync(join(w.dir, 'bunnydata')), false);
  assert.equal(existsSync(join(w.dir, 'link-out')), false, 'the junction is not in the copy');
  assert.equal(existsSync(join(w.dir, 'link-data')), false);
  if (existsSync(join(w.root, 'link-out'))) assert.ok(copy.skipped.some((s) => s.path === 'link-out' && s.why === 'a link'));
  assert.equal([...copy.manifest.keys()].some((k) => k.startsWith('link-') || k.startsWith('bunnydata')), false);
});

test('a folder that is too big is refused with a plain sentence, and the copy of a second turn starts clean', async () => {
  const w = await world();
  await assert.rejects(() => stage({ root: w.root, dir: w.dir, maxFiles: 2 }), /too big/);
  await stage({ root: w.root, dir: w.dir }); await put(w.dir, 'engine-leftover.txt', 'x');
  await stage({ root: w.root, dir: w.dir });
  assert.equal(existsSync(join(w.dir, 'engine-leftover.txt')), false, 'the old copy was removed first');
});

test('diff finds a changed, an added and a deleted file, and a link or a file/folder swap made in the copy; an untouched copy has no changes', async () => {
  const w = await world();
  const copy = await stage({ root: w.root, dir: w.dir });
  assert.deepEqual(await diff({ root: w.root, dir: w.dir, manifest: copy.manifest }), []);
  await writeFile(join(w.dir, 'a.txt'), 'alpha changed');
  await put(w.dir, 'new/file.txt', 'new');
  await rm(join(w.dir, 'docs', 'readme.md'));
  await rm(join(w.dir, 'src', 'b.js')); await mkdir(join(w.dir, 'src', 'b.js'), { recursive: true }); // a file turned into a folder
  try { await symlink(join(w.base, 'outside'), join(w.dir, 'sneaky'), 'junction'); } catch (err) { if (!/EPERM|EACCES/.test(String(err.code))) throw err; }
  const changes = await diff({ root: w.root, dir: w.dir, manifest: copy.manifest });
  const kinds = Object.fromEntries(changes.map((c) => [c.rel, c.kind]));
  assert.equal(kinds['a.txt'], 'change'); assert.equal(kinds['new/file.txt'], 'add'); assert.equal(kinds['docs/readme.md'], 'delete'); assert.equal(kinds['src/b.js'], 'type');
  if ('sneaky' in kinds) assert.equal(kinds.sneaky, 'link');
});

test('review: allowed changes are written through the write path (content from the copy, a delete as null); nothing else is written; the real folder is untouched by the review itself', async () => {
  const w = await world();
  const copy = await stage({ root: w.root, dir: w.dir });
  await writeFile(join(w.dir, 'a.txt'), 'alpha changed'); await put(w.dir, 'new/file.txt', 'new'); await rm(join(w.dir, 'docs', 'readme.md'));
  const m = mk(w, { mode: 'auto' });
  const result = await review({ root: w.root, dir: w.dir, changes: await diff({ root: w.root, dir: w.dir, manifest: copy.manifest }), mode: 'auto', ...m });
  assert.deepEqual(result.applied.sort(), ['a.txt', 'docs/readme.md', 'new/file.txt']);
  assert.deepEqual(m.written.sort((x, y) => x[0].localeCompare(y[0])), [['a.txt', 'alpha changed'], ['docs/readme.md', null], ['new/file.txt', 'new']]);
  assert.equal(await readFile(join(w.root, 'a.txt'), 'utf8'), 'alpha', 'the review wrote nothing itself');
  assert.equal(m.asks.length, 0, 'Auto: no question');
  assert.match(describeReview(result), /Kept 3 changes/);
});

test('review: a deny rule discards the change and names the rule; a delete is judged like a write; a path in the data folder, .git or a config folder is discarded; a Plan mode review keeps nothing', async () => {
  const w = await world();
  const rules = [rule({ kind: 'path', ops: 'edits', pattern: 'src/**', effect: 'deny' }), rule({ kind: 'path', ops: 'edits', pattern: 'docs/readme.md', effect: 'deny' })];
  const changes = [{ rel: 'src/b.js', kind: 'change', size: 3 }, { rel: 'docs/readme.md', kind: 'delete' }, { rel: 'a.txt', kind: 'change', size: 5 }, { rel: '.git/hooks/pre-commit', kind: 'add', size: 4 }, { rel: '.claude/settings.json', kind: 'change', size: 2 }, { rel: 'x.txt:hidden', kind: 'add', size: 1 }, { rel: 'con.txt', kind: 'add', size: 1 }, { rel: 'trail.', kind: 'add', size: 1 }, { rel: 'big.bin', kind: 'add', size: 999 }, { rel: 'l', kind: 'link' }, { rel: 'swap', kind: 'type' }];
  await put(w.dir, 'a.txt', 'changed');
  const m = mk(w, { mode: 'auto', rules });
  const result = await review({ root: w.root, dir: w.dir, changes, mode: 'auto', writeLimit: 500, ...m });
  assert.deepEqual(result.applied, ['a.txt']);
  const why = Object.fromEntries(result.discarded.map((d) => [d.rel, d.why]));
  assert.match(why['src/b.js'], /permission rule "src\/\*\*"/); assert.match(why['docs/readme.md'], /permission rule/);
  assert.match(why['.git/hooks/pre-commit'], /configuration folder/); assert.match(why['.claude/settings.json'], /configuration folder/);
  assert.match(why['x.txt:hidden'], /alternate data stream/); assert.match(why['con.txt'], /reserved/); assert.match(why['trail.'], /dot or a space/); assert.match(why['big.bin'], /size limit/); assert.match(why.l, /link/); assert.match(why.swap, /file turned into a folder/);
  assert.deepEqual(m.written.map((x) => x[0]), ['a.txt']);
  const plan = await review({ root: w.root, dir: w.dir, changes: [{ rel: 'a.txt', kind: 'change', size: 5 }], mode: 'plan', ...mk(w, { mode: 'plan' }) });
  assert.deepEqual([plan.applied, plan.discarded.map((d) => d.why)], [[], ['Plan mode keeps nothing']]);
});

test('review: an Ask (the mode or a rule) shows ONE card listing the files and the person takes all or none; "no" discards them and writes nothing', async () => {
  const w = await world();
  await put(w.dir, 'a.txt', 'a2'); await put(w.dir, 'src/b.js', 'b2'); await put(w.dir, 'docs/readme.md', 'r2');
  const changes = [{ rel: 'a.txt', kind: 'change', size: 2 }, { rel: 'src/b.js', kind: 'change', size: 2 }, { rel: 'docs/readme.md', kind: 'change', size: 2 }];
  const yes = mk(w, { mode: 'ask', answer: true });
  const r1 = await review({ root: w.root, dir: w.dir, changes, mode: 'ask', ...yes });
  assert.equal(yes.asks.filter((a) => a.from === 'card').length, 1, 'one card');
  assert.match(yes.asks.find((a) => a.from === 'card').detail, /changed: a\.txt[\s\S]*changed: src\/b\.js[\s\S]*changed: docs\/readme\.md/);
  assert.deepEqual(r1.applied.sort(), ['a.txt', 'docs/readme.md', 'src/b.js']);
  const no = mk(w, { mode: 'ask', answer: false });
  const r2 = await review({ root: w.root, dir: w.dir, changes, mode: 'ask', ...no });
  assert.deepEqual([r2.applied, r2.discarded.map((d) => d.why).every((x) => /did not allow/.test(x)), no.written], [[], true, []]);
  // one allow rule and one ask rule: only the asked file is on the card
  const mixed = mk(w, { mode: 'ask', answer: true, rules: [rule({ kind: 'path', ops: 'edits', pattern: 'a.txt', effect: 'allow' })] });
  await review({ root: w.root, dir: w.dir, changes, mode: 'ask', ...mixed });
  assert.doesNotMatch(mixed.asks.find((a) => a.from === 'card').detail, /a\.txt/);
});

test('"runs code later" files are an Ask in EVERY mode, Auto included, and named on the card: package.json, tasks.json, workflows, Makefile, scripts, hooks, pyproject.toml, setup.py', async () => {
  for (const rel of ['package.json', 'sub/package.json', '.vscode/tasks.json', '.vscode/settings.json', '.vscode/launch.json', '.github/workflows/ci.yml', 'Makefile', 'build.ps1', 'x.bat', 'y.cmd', '.husky/pre-commit', '.pre-commit-config.yaml', 'pyproject.toml', 'setup.py']) assert.equal(runsLater(rel), true, rel);
  for (const rel of ['a.txt', 'src/b.js', 'package-lock.json', 'docs/makefile.md', 'setup.pyc']) assert.equal(runsLater(rel), false, rel);
  const w = await world();
  await put(w.dir, 'package.json', '{"scripts":{"postinstall":"x"}}'); await put(w.dir, 'a.txt', 'a2');
  const changes = [{ rel: 'package.json', kind: 'add', size: 30 }, { rel: 'a.txt', kind: 'change', size: 2 }];
  const auto = mk(w, { mode: 'auto', answer: false });
  const r = await review({ root: w.root, dir: w.dir, changes, mode: 'auto', ...auto });
  const card = auto.asks.filter((a) => a.from === 'card');
  assert.equal(card.length, 1); assert.match(card[0].detail, /\[runs code later\] added: package\.json/); assert.doesNotMatch(card[0].detail, /a\.txt/);
  assert.deepEqual(r.applied, ['a.txt'], 'the ordinary change is kept in Auto; the planted script is not');
  assert.equal(r.discarded[0].rel, 'package.json');
});

test('badName and discard: the names Windows or Bunny will not take; the copy is removed afterwards', async () => {
  for (const [name, expect] of [['a/b.txt', null], ['a/.gitignore', null], ['.git', 'a .git entry'], ['x/.git/config', 'an engine or git configuration folder'], ['.codex/rules/default.rules', 'an engine or git configuration folder'], ['.aider.chat.history.md', 'an engine or git configuration folder'], ['a.txt:s', 'an alternate data stream'], ['NUL', 'a reserved Windows name'], ['a/COM1.txt', 'a reserved Windows name'], ['bad ', 'a name ending in a dot or a space']]) assert.equal(badName(name), expect, name);
  const w = await world();
  await stage({ root: w.root, dir: w.dir });
  assert.equal(existsSync(w.dir), true);
  await discard(w.dir);
  assert.equal(existsSync(w.dir), false);
  void utimes;
});
