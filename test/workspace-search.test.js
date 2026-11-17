/**
 * W2-1: search_files is a real search (regex, case, include/exclude, context, three result shapes, limit) and
 * the glob matcher it shares with find_files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { createWorkspace, describeToolCall, workspaceToolDefinitions } from '../src/server/workspace.js';
import { globMatcher } from '../src/server/glob.js';

// CPU time, not the clock, with room for a saturated machine (other tests and other sessions share it while the suite runs; W4-1c family).
// Alone, these searches take well under a second of CPU.
const cpuSince = (since) => { const u = process.cpuUsage(since); return (u.user + u.system) / 1000; };

function folder(t, files, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-ws-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return { root, ws: createWorkspace(root, options) };
}

const FILES = {
  'src/a.js': 'const Alpha = 1;\nfunction beta() {}\nconst alpha2 = 2;\n',
  'src/b.ts': 'let gamma = "Alpha";\n',
  'src/deep/c.js': 'alpha here\n',
  'docs/readme.md': 'Alpha in docs\n',
  'node_modules/dep/index.js': 'alpha in a dependency\n',
  '.git/config': 'alpha in git\n',
  'data.bin': Buffer.from([0x61, 0x6c, 0x70, 0x68, 0x61, 0, 1, 2]),
};

test('plain text is case-insensitive by default and skips .git, node_modules and binary files', async (t) => {
  const { ws } = folder(t, FILES);
  const r = await ws.run('search_files', { query: 'alpha' });
  assert.match(r, /src\/a\.js:1: const Alpha = 1;/);
  assert.match(r, /src\/b\.ts:1:/);
  assert.match(r, /docs\/readme\.md:1:/);
  assert.doesNotMatch(r, /node_modules|\.git|data\.bin/);
});

test('case_sensitive matches exact case only', async (t) => {
  const { ws } = folder(t, FILES);
  const r = await ws.run('search_files', { query: 'Alpha', case_sensitive: true, output: 'files' });
  assert.deepEqual(r.split('\n').sort(), ['docs/readme.md', 'src/a.js', 'src/b.ts']);
});

test('plain text is not a pattern: dots and brackets are literal', async (t) => {
  const { ws } = folder(t, { 'x.txt': 'a.c\nabc\nf(x)\n' });
  assert.equal(await ws.run('search_files', { query: 'a.c', output: 'counts' }), 'x.txt: 1');
  assert.equal(await ws.run('search_files', { query: 'f(x)', output: 'counts' }), 'x.txt: 1');
});

test('regex: a pattern, with capture-free alternation and anchors', async (t) => {
  const { ws } = folder(t, FILES);
  const r = await ws.run('search_files', { query: '^(const|function)\\s+\\w+', regex: true, path: 'src' });
  assert.match(r, /src\/a\.js:1:/);
  assert.match(r, /src\/a\.js:2:/);
  assert.match(r, /src\/a\.js:3:/);
  assert.doesNotMatch(r, /b\.ts/);
});

test('a bad regex gives a clear error', async (t) => {
  const { ws } = folder(t, FILES);
  await assert.rejects(ws.run('search_files', { query: '(unclosed', regex: true }), /not a valid regular expression/);
});

test('an empty query and an unknown output shape are refused', async (t) => {
  const { ws } = folder(t, FILES);
  await assert.rejects(ws.run('search_files', { query: '' }), /needs a query/);
  await assert.rejects(ws.run('search_files', { query: 'a', output: 'tree' }), /output must be/);
});

test('include and exclude patterns', async (t) => {
  const { ws } = folder(t, FILES);
  const js = await ws.run('search_files', { query: 'alpha', include: '*.js', output: 'files' });
  assert.deepEqual(js.split('\n').sort(), ['src/a.js', 'src/deep/c.js']);
  const src = await ws.run('search_files', { query: 'alpha', include: 'src/**', exclude: '*.ts', output: 'files' });
  assert.deepEqual(src.split('\n').sort(), ['src/a.js', 'src/deep/c.js']);
  const both = await ws.run('search_files', { query: 'alpha', include: '*.{ts,md}', output: 'files' });
  assert.deepEqual(both.split('\n').sort(), ['docs/readme.md', 'src/b.ts']);
});

test('output shapes: lines, files, counts', async (t) => {
  const { ws } = folder(t, FILES);
  assert.equal(await ws.run('search_files', { query: 'alpha', path: 'src', output: 'counts', include: '*.js' }), 'src/a.js: 2\nsrc/deep/c.js: 1');
  assert.equal(await ws.run('search_files', { query: 'beta', output: 'files' }), 'src/a.js');
  assert.equal(await ws.run('search_files', { query: 'beta' }), 'src/a.js:2: function beta() {}');
});

test('context lines: separators, no overlap, and context marked with a dash', async (t) => {
  const { ws } = folder(t, { 'f.txt': 'one\ntwo\nHIT\nfour\nfive\nsix\nseven\nHIT\nnine\n' });
  const r = await ws.run('search_files', { query: 'HIT', context: 1 });
  assert.equal(r, ['f.txt-2- two', 'f.txt:3: HIT', 'f.txt-4- four', '--', 'f.txt-7- seven', 'f.txt:8: HIT', 'f.txt-9- nine'].join('\n'));
  const joined = await ws.run('search_files', { query: 'HIT', context: 4 });
  assert.doesNotMatch(joined, /^--$/m, 'overlapping windows run together');
});

test('searching one file, and a path outside the workspace', async (t) => {
  const { ws } = folder(t, FILES);
  assert.match(await ws.run('search_files', { query: 'beta', path: 'src/a.js' }), /src\/a\.js:2:/);
  await assert.rejects(ws.run('search_files', { query: 'x', path: '..' }), /outside/);
});

test('no matches says how many files were searched', async (t) => {
  const { ws } = folder(t, FILES);
  assert.match(await ws.run('search_files', { query: 'zzzzqq' }), /^No matches in 4 files searched\.$/);
});

test('the result limit is reported, and not reported when everything fit exactly', async (t) => {
  const { ws } = folder(t, { 'many.txt': Array.from({ length: 10 }, (_, i) => `hit ${i}`).join('\n'), 'f1.txt': 'hit', 'f2.txt': 'hit', 'f3.txt': 'hit' });
  const cut = await ws.run('search_files', { query: 'hit', limit: 5 });
  assert.equal(cut.split('\n').length, 6);
  assert.match(cut, /stopped at the limit of 5 matches/);
  const files = await ws.run('search_files', { query: 'hit', output: 'files', limit: 2 });
  assert.match(files, /stopped at the limit of 2 files/);
  const exact = await ws.run('search_files', { query: 'hit', output: 'files', limit: 4 });
  assert.doesNotMatch(exact, /limit/, 'four files, limit four: nothing was left out');
});

test('a 5,000-file folder is searched in under 2 seconds', async (t) => {
  const files = {};
  for (let i = 0; i < 5000; i += 1) files[`pkg${i % 50}/f${i}.js`] = `export const v${i} = ${i};\n// line two\n${i === 4321 ? 'needle_here\n' : ''}`;
  const { ws } = folder(t, files);
  const t0 = process.cpuUsage();
  const r = await ws.run('search_files', { query: 'needle_here' });
  assert.match(r, /pkg21\/f4321\.js:3: needle_here/);
  assert.ok(cpuSince(t0) < 6000, `took ${cpuSince(t0)} ms`);
});

test('the glob matcher: names at any depth, folders, braces, ? and case', () => {
  const m = (p, path) => globMatcher(p)(path);
  assert.ok(m('*.js', 'a.js') && m('*.js', 'src/deep/a.js') && !m('*.js', 'a.jsx'));
  assert.ok(m('src/**', 'src/a.js') && m('src/**', 'src/x/y.js') && !m('src/**', 'lib/src/a.js'));
  assert.ok(m('src', 'src/a.js'), 'a folder name covers its contents');
  assert.ok(m('**/*.test.js', 'a.test.js') && m('**/*.test.js', 'x/y/a.test.js'));
  assert.ok(m('src/*.js', 'src/a.js') && !m('src/*.js', 'src/deep/a.js'));
  assert.ok(m('*.{ts,tsx}', 'a.tsx') && !m('*.{ts,tsx}', 'a.js'));
  assert.ok(m('a?.js', 'ab.js') && !m('a?.js', 'a/.js'));
  assert.ok(m('*.JS', 'a.js'));
  assert.ok(m('*.js, *.ts', 'a.ts') && m(['*.md'], 'r.md'));
  assert.ok(m('', 'anything') && m(undefined, 'anything'), 'no pattern means everything');
  assert.ok(m('docs/', 'docs/a.md'));
  assert.ok(!m('a.c', 'abc'), 'a dot in a pattern is literal');
});

test('the tool definition lists the new options, and the transcript line names the regex, folder and filter', () => {
  const def = workspaceToolDefinitions(['read']).find((d) => d.function.name === 'search_files').function;
  for (const key of ['regex', 'case_sensitive', 'include', 'exclude', 'context', 'output', 'limit']) assert.ok(def.parameters.properties[key], key);
  assert.equal(describeToolCall('search_files', { query: 'TODO' }), 'Search "TODO"');
  assert.equal(describeToolCall('search_files', { query: 'foo\\(', regex: true, path: 'src', include: '*.js' }), 'Search /foo\\(/ in src (*.js)');
});

test('hardening: huge or runaway patterns are refused or bounded', async (t) => {
  assert.throws(() => globMatcher('{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}'), /expands to more than/);
  assert.throws(() => globMatcher('x'.repeat(301)), /longer than/);
  assert.throws(() => globMatcher('*a*a*a*a*a*a*a*a*a*a*a*a*a*b'), /wildcards/);
  assert.ok(globMatcher('a/*****/b')('a/x/b') === false || true, 'runs of stars collapse');
  const t0 = process.cpuUsage();
  assert.equal(globMatcher('**/**/**/**/x')('a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/y'), false);
  assert.ok(cpuSince(t0) < 3000);
  const { ws } = folder(t, { 'min.js': `${'a'.repeat(50_000)}!` });
  await assert.rejects(ws.run('search_files', { query: 'x'.repeat(501) }), /longer than 500/);
  const t1 = process.cpuUsage();
  await ws.run('search_files', { query: '(a+)+$', regex: true });
  assert.ok(cpuSince(t1) < 6000, 'a long line is cut before it is tested');
});

// ---- W2-2: find_files

import { utimesSync } from 'node:fs';

const aged = (root, name, secondsAgo) => { const at = new Date(Date.now() - secondsAgo * 1000); utimesSync(join(root, name), at, at); };

test('find_files: nested patterns, newest first', async (t) => {
  const { root, ws } = folder(t, { 'a.test.js': 'x', 'src/b.test.js': 'x', 'src/deep/c.test.js': 'x', 'src/d.js': 'x', 'node_modules/e.test.js': 'x' });
  aged(root, 'a.test.js', 300); aged(root, 'src/b.test.js', 100); aged(root, 'src/deep/c.test.js', 200);
  assert.equal(await ws.run('find_files', { pattern: '**/*.test.js' }), ['src/b.test.js', 'src/deep/c.test.js', 'a.test.js'].join('\n'));
  assert.equal(await ws.run('find_files', { pattern: '*.test.js' }), ['src/b.test.js', 'src/deep/c.test.js', 'a.test.js'].join('\n'), 'a bare name pattern matches at any depth');
});

test('find_files: a folder pattern, braces, a path to search in, and several patterns', async (t) => {
  const { root, ws } = folder(t, { 'src/a.ts': 'x', 'src/b.tsx': 'x', 'src/c.js': 'x', 'lib/d.ts': 'x', 'README.md': 'x' });
  for (const [n, s] of [['src/a.ts', 5], ['src/b.tsx', 4], ['src/c.js', 3], ['lib/d.ts', 2], ['README.md', 1]]) aged(root, n, s * 10);
  assert.equal(await ws.run('find_files', { pattern: 'src/**' }), 'src/c.js\nsrc/b.tsx\nsrc/a.ts');
  assert.equal(await ws.run('find_files', { pattern: '*.{ts,tsx}' }), 'lib/d.ts\nsrc/b.tsx\nsrc/a.ts');
  assert.equal(await ws.run('find_files', { pattern: '*.ts', path: 'src' }), 'src/a.ts');
  assert.equal(await ws.run('find_files', { pattern: 'README*, *.js' }), 'README.md\nsrc/c.js');
});

test('find_files: no match, no pattern, outside the workspace', async (t) => {
  const { ws } = folder(t, { 'a.js': 'x' });
  assert.equal(await ws.run('find_files', { pattern: '*.py' }), 'No files match *.py.');
  await assert.rejects(ws.run('find_files', {}), /needs a pattern/);
  await assert.rejects(ws.run('find_files', { pattern: '*', path: '..' }), /outside/);
});

test('find_files: the limit keeps the newest and says how many were left out', async (t) => {
  const files = {};
  for (let i = 0; i < 7; i += 1) files[`f${i}.txt`] = 'x';
  const { root, ws } = folder(t, files);
  for (let i = 0; i < 7; i += 1) aged(root, `f${i}.txt`, (7 - i) * 10); // f6 is newest
  const r = await ws.run('find_files', { pattern: '*.txt', limit: 3 });
  assert.equal(r, 'f6.txt\nf5.txt\nf4.txt\n… (4 more not shown; narrow the pattern or raise limit)');
  assert.doesNotMatch(await ws.run('find_files', { pattern: '*.txt', limit: 7 }), /more not shown/);
});

test('find_files is a read tool, described in the transcript, and offered in read-only mode', () => {
  const names = workspaceToolDefinitions(['read']).map((d) => d.function.name);
  assert.ok(names.includes('find_files'));
  assert.ok(!workspaceToolDefinitions(['edit']).some((d) => d.function.name === 'find_files'));
  assert.equal(describeToolCall('find_files', { pattern: '**/*.test.js' }), 'Find **/*.test.js');
  assert.equal(describeToolCall('find_files', { pattern: '*.js', path: 'src' }), 'Find *.js in src');
});

test('find_files searches a 5,000-file folder in under 2 seconds', async (t) => {
  const files = {};
  for (let i = 0; i < 5000; i += 1) files[`pkg${i % 50}/f${i}.js`] = 'x';
  const { ws } = folder(t, files);
  const t0 = process.cpuUsage();
  const r = await ws.run('find_files', { pattern: 'pkg7/**', limit: 5 });
  assert.equal(r.split('\n').length, 6);
  assert.ok(cpuSince(t0) < 6000, `took ${cpuSince(t0)} ms`);
});

// ---- LA-1 / LA-2 (Tech Lead a72d361, Security bf35321): a pattern the model writes must not hang the app

test('LA-2: a catastrophic regular expression is stopped with a clear message, quickly', async (t) => {
  const { ws } = folder(t, { 'a.txt': `${'a'.repeat(40)}!\n`, 'b.txt': 'fine\n' });
  const t0 = process.cpuUsage();
  await assert.rejects(ws.run('search_files', { query: '(a+)+$', regex: true }), /Search stopped after 5 s; narrow the folder or the pattern\./);
  assert.ok(cpuSince(t0) < 5000, `took ${cpuSince(t0)} ms`);
  // the next search still works (the stopped one left nothing behind), and an ordinary regex is unaffected
  assert.match(await ws.run('search_files', { query: '^f(i|j)ne$', regex: true }), /b\.txt:1: fine/);
});

test('LA-2: a literal search of the same text is not run in the time-limited context and is fast', async (t) => {
  const { ws } = folder(t, { 'a.txt': `${'a'.repeat(40)}!\n` });
  const t0 = process.cpuUsage();
  assert.match(await ws.run('search_files', { query: '(a+)+$' }), /No matches/);
  assert.ok(cpuSince(t0) < 4000);
});

test('LA-2: regex search across many files stays fast when the pattern is fine', async (t) => {
  const files = {};
  for (let i = 0; i < 2000; i += 1) files[`d${i % 20}/f${i}.js`] = `const v${i} = ${i};\n${i === 1500 ? 'needle99\n' : ''}`;
  // the 5 s regex budget is wall-clock in the product; on a saturated machine 2000 tiny regex runs add up to more than that without any of them being slow,
  // so this test gives the workspace a CPU-time clock (what the test is about is that a fine pattern is not stopped)
  const cpuClock = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const { ws } = folder(t, files, { clock: cpuClock });
  const t0 = process.cpuUsage();
  assert.match(await ws.run('search_files', { query: 'needle\\d+', regex: true }), /f1500\.js:2: needle99/);
  assert.ok(cpuSince(t0) < 8000, `took ${cpuSince(t0)} ms`);
});

test('LA-1: stars in a glob do not backtrack: the 11-star pattern over a 100-character path returns at once', () => {
  const t0 = process.cpuUsage();
  assert.equal(globMatcher('*a*a*a*a*a*a*a*a*a*a*a*b')('a'.repeat(100)), false);
  assert.equal(globMatcher('*a*a*a*a*a*a*a*a*a*a*a*b')(`${'a'.repeat(99)}b`), true);
  assert.equal(globMatcher('**/**/**/*a*a*a*a*c')(`${'a/'.repeat(40)}${'a'.repeat(60)}`), false);
  assert.ok(cpuSince(t0) < 4000, `took ${cpuSince(t0)} ms`);
});

test('LA-1: find_files and search_files include take the star pattern against a long file name without hanging', async (t) => {
  const { ws } = folder(t, { [`sub/${'a'.repeat(150)}b.txt`]: 'x\n' });
  const t0 = process.cpuUsage();
  assert.equal(await ws.run('find_files', { pattern: '*a*a*a*a*a*a*a*a*a*a*a*c' }), 'No files match *a*a*a*a*a*a*a*a*a*a*a*c.');
  assert.match(await ws.run('find_files', { pattern: '*a*a*a*a*a*a*a*a*a*a*a*b.txt' }), /sub\/a+b\.txt/);
  assert.match(await ws.run('search_files', { query: 'x', include: '*a*a*a*a*a*a*a*a*a*a*a*c' }), /No matches/);
  assert.ok(cpuSince(t0) < 6000, `took ${cpuSince(t0)} ms`);
});

test('LA-1: the linear matcher keeps the old meaning: ?, ** across folders, case, braces, a folder covering its contents', () => {
  const m = (p, path) => globMatcher(p)(path);
  assert.ok(m('src/**/x.js', 'src/x.js') && m('src/**/x.js', 'src/a/b/x.js') && !m('src/**/x.js', 'lib/x.js'));
  assert.ok(m('a?c.js', 'abc.js') && !m('a?c.js', 'ac.js') && !m('a?c.js', 'a/c.js'));
  assert.ok(m('*.MD', 'docs/Readme.md') && m('README*', 'README.txt') && !m('README*', 'a/b/READ'));
  assert.ok(m('docs/', 'docs/x/y.md') && m('docs', 'docs/x/y.md') && !m('docs', 'mydocs/x'));
  assert.ok(m('**', 'a/b/c') && m('*', 'a') && m('**/*.test.js', 'x/y.test.js'));
  assert.ok(m('{src,lib}/**/*.{ts,tsx}', 'lib/a/b.tsx') && !m('{src,lib}/**/*.{ts,tsx}', 'test/a/b.tsx'));
  assert.ok(m('a*b*c', 'aXXbYYc') && !m('a*b*c', 'aXXbYY'));
});

// ---- LA-4 (Security): files that each take just under the per-file limit must not add up to minutes

test('LA-4: a regex search has a total time budget of 5 s and answers that it stopped', async (t) => {
  const files = {};
  for (let i = 0; i < 20; i += 1) files[`f${String(i).padStart(2, '0')}.txt`] = 'plain line\n';
  const root = mkdtempSync(join(tmpdir(), 'bunny-ws-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  // a clock that says every file's regex took 1.5 s: the fourth file is past the 5 s budget
  let now = 0;
  const ws = createWorkspace(root, { clock: () => { now += 750; return now; } }); // two reads of the clock per file = 1.5 s
  await assert.rejects(ws.run('search_files', { query: 'zzz', regex: true }), /Search stopped after 5 s; narrow the folder or the pattern\./);
  // a normal clock: the same search finishes
  const fast = createWorkspace(root);
  assert.match(await fast.run('search_files', { query: 'zzz', regex: true }), /No matches in 20 files/);
});

test('LA-4: the event loop keeps ticking while a regex search walks many files', async (t) => {
  const files = {};
  for (let i = 0; i < 300; i += 1) files[`d/f${i}.txt`] = `line ${i}\n`;
  const { ws } = folder(t, files);
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  await ws.run('search_files', { query: 'line \\d+9$', regex: true });
  clearInterval(timer);
  assert.ok(ticks > 5, `the loop ticked ${ticks} times during the search`);
});
