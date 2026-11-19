import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { buildQuery, cleanTerms, createPcSearch, runPowerShell, SEARCH_SCRIPT, MAX_TERMS, MAX_TERM_CHARS } from '../src/server/pcSearch.js';
import { powershellPath } from '../src/server/safeExec.js';
import { fakeRunner, splitSql } from './support/pc-fake-index.mjs';

// SEARCH-PC SP-7: the question never becomes query text. Terms are cleaned, escaped and quoted into a fixed template; kinds and dates are fixed choices.
const NOW = new Date('2026-11-19T12:00:00Z');

test('the query is the fixed template plus quoted terms, byte for byte', () => {
  assert.equal(
    buildQuery({ terms: ['tax', 'return 2025'], now: NOW }),
    "SELECT TOP 50 System.ItemPathDisplay, System.ItemName, System.DateModified, System.Size, System.Search.AutoSummary FROM SystemIndex WHERE SCOPE='file:' AND (CONTAINS('\"tax\"') OR CONTAINS(System.ItemName, '\"tax*\"')) AND (CONTAINS('\"return 2025\"') OR CONTAINS(System.ItemName, '\"return 2025*\"')) ORDER BY System.Search.Rank DESC",
  );
});

test('a quote in a term causes no query error and finds nothing it should not (the release-gate probe)', async () => {
  const rows = [
    { path: 'C:\\x\\obrien report.txt', name: 'obrien report.txt' }, { path: 'C:\\x\\salary.txt', name: 'salary.txt' }, { path: 'C:\\x\\o brien notes.txt', name: 'o brien notes.txt' },
  ];
  for (const evil of ["O'Brien", "x' OR 1=1 --", "'; DROP TABLE SystemIndex; --", "' OR ''='", 'a" OR "b', "%' OR System.ItemName LIKE '%"]) {
    const sql = buildQuery({ terms: [evil], now: NOW });
    const { outside } = splitSql(sql); // throws on a quote that is not balanced
    assert.doesNotMatch(outside, /OR 1|DROP|;/, evil);
    const seen = [];
    const search = createPcSearch({ run: fakeRunner(rows, { seen }), now: () => NOW });
    const r = await search.search({ terms: [evil] });
    assert.ok(['ok', 'nothing'].includes(r.state), `${evil}: ${r.state} ${r.message ?? ''}`);
    if (r.state === 'ok') assert.ok(r.rows.every((x) => /brien/i.test(x.name)), 'no other rows');
    assert.ok(!seen.some((q) => /DROP|1=1/.test(q.replace(/'[^']*'/g, ''))), 'nothing of it outside a quoted piece');
  }
  assert.equal(cleanTerms(["O'Brien"])[0], 'O Brien');
});

test('wildcards are escaped, and characters outside letters, digits, space and - _ . become spaces', () => {
  assert.deepEqual(cleanTerms(['100%_[x]*?\\/:;<>|"`~!@#$^&()=+{}']), ['100 _ x']);
  assert.match(buildQuery({ terms: ['a_b'], now: NOW }), /CONTAINS\(System\.ItemName, '"a_b\*"'\)/);
  assert.doesNotMatch(buildQuery({ terms: ['tax'], now: NOW }), /LIKE/, 'a leading-wildcard LIKE scans the whole index (measured: 18 s for a word in no file); never used');
  assert.deepEqual(cleanTerms(['  Übung für Köln – 2025  ']), ['Übung für Köln 2025'], 'Unicode letters stay');
  assert.deepEqual(cleanTerms(['', '   ', '%%', "'''"]), []);
  assert.equal(buildQuery({ terms: ['%%'], now: NOW }), null, 'nothing left means no search');
});

test('at most 8 terms of at most 64 characters', () => {
  assert.equal(cleanTerms(Array.from({ length: 12 }, (_, i) => `word${i}`)).length, MAX_TERMS);
  assert.equal(cleanTerms(['x'.repeat(200)])[0].length, MAX_TERM_CHARS);
  assert.deepEqual(cleanTerms('not a list'), []);
  assert.deepEqual(cleanTerms([{ toString: () => 'obj' }, 42, null]), ['obj', '42']);
});

test('kinds and dates come from fixed choices only', () => {
  assert.match(buildQuery({ terms: ['a'], kind: 'pdf', now: NOW }), /System\.FileExtension = '\.pdf'/);
  assert.match(buildQuery({ terms: ['a'], kind: 'spreadsheet', now: NOW }), /'\.xlsx'.*'\.csv'/);
  assert.throws(() => buildQuery({ terms: ['a'], kind: "pdf' OR 1=1" }), /not one of the choices/);
  assert.throws(() => buildQuery({ terms: ['a'], kind: '__proto__' }), /not one of the choices/);
  assert.match(buildQuery({ terms: ['a'], modified: '7d', now: NOW }), /System\.DateModified >= '2026-11-12 00:00:00'/);
  assert.match(buildQuery({ terms: ['a'], modified: '1y', now: NOW }), /System\.DateModified >= '2025-11-19 00:00:00'/);
  assert.match(buildQuery({ terms: ['a'], modified: '2024', now: NOW }), />= '2024-01-01 00:00:00' AND System\.DateModified < '2025-01-01 00:00:00'/);
  for (const bad of ["2024' OR 1=1", '20245', 'yesterday', '1800', '9999']) assert.throws(() => buildQuery({ terms: ['a'], modified: bad, now: NOW }), /not one of the choices/, bad);
});

test('the terms reach PowerShell by environment, never on the command line; PowerShell is started by its full path with a fixed script', async () => {
  const calls = [];
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), pid: 4321, kill() {} });
  const execFileImpl = (file, args, options) => { calls.push({ file, args, env: options?.env }); queueMicrotask(() => { child.stdout.emit('data', '{"done":true}\n'); child.emit('close', 0); }); return child; };
  const sql = buildQuery({ terms: ['secret-term-xyz'], now: NOW });
  const out = await runPowerShell(sql, { execFileImpl });
  assert.deepEqual(out.lines, ['{"done":true}']);
  const start = calls[0];
  assert.equal(start.file, powershellPath());
  assert.ok(process.platform !== 'win32' || /^[A-Za-z]:\\.*powershell\.exe$/i.test(start.file), 'an absolute path');
  assert.deepEqual(start.args, ['-NoProfile', '-NonInteractive', '-Command', SEARCH_SCRIPT]);
  assert.ok(!JSON.stringify(start.args).includes('secret-term-xyz'), 'the term is not on the command line');
  assert.ok(start.env.BUNNY_PCSEARCH_SQL.includes('secret-term-xyz'));
  assert.equal(start.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.deepEqual([...SEARCH_SCRIPT.matchAll(/\$env:(\w+)/g)].map((m) => m[1]), ['BUNNY_PCSEARCH_SQL']);
  assert.doesNotMatch(SEARCH_SCRIPT, /\$_\.Exception\.Message|Write-Error/, "an error's own words are never printed");
});

test('the code reads only the index: no directory listing or file scan', async () => {
  const text = await readFile(new URL('../src/server/pcSearch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /readdir|opendir|glob|Get-ChildItem|dir \/s/i);
});

test('SEARCH-PC timeout fix: no LIKE with a leading wildcard (it scanned the whole index: over 18 s for a word in no file, measured 2026-11-19), and the provider has its own 8 s command timeout', async () => {
  const { SEARCH_SCRIPT, SEARCH_TIMEOUT_MS } = await import('../src/server/pcSearch.js');
  for (const terms of [['tax'], ['tax', 'return 2025'], ['zqxjvkwpl123456'], ['a_b.c']]) assert.doesNotMatch(buildQuery({ terms, now: NOW }), /LIKE|%/);
  assert.match(SEARCH_SCRIPT, /CommandTimeout = 8/);
  assert.ok(SEARCH_TIMEOUT_MS === 10_000, 'the user-facing limit stays 10 s');
});
