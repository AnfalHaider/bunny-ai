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

function folder(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-ws-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return { root, ws: createWorkspace(root) };
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
  const t0 = Date.now();
  const r = await ws.run('search_files', { query: 'needle_here' });
  assert.match(r, /pkg21\/f4321\.js:3: needle_here/);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
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
