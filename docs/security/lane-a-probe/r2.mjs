// Lane A re-check (Security): LA-1 and LA-2 against the fixed workspace.js / glob.js
// Usage: node r2.mjs <checkout of 9fb372f>
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createWorkspace } = await import('file:///' + process.argv[2].replace(/\\/g, '/') + '/src/server/workspace.js');
const top = mkdtempSync(join(tmpdir(), 'bunny-la3-'));
const root = join(top, 'ws');
mkdirSync(join(root, 'sub', 'deep', 'er', 'est'), { recursive: true });
writeFileSync(join(root, 'ok.txt'), 'hello\n');
const ws = createWorkspace(root, { beforeWrite: async () => {} });
const t = async (label, fn) => {
  const s = Date.now();
  try { const r = await fn(); console.log(`ok      [${String(Date.now() - s).padStart(5)} ms] ${label} -> ${JSON.stringify(String(r)).slice(0, 80)}`); }
  catch (e) { console.log(`refused [${String(Date.now() - s).padStart(5)} ms] ${label} -> ${e.message.slice(0, 80)}`); }
};
console.log('--- LA-1 glob');
for (const n of [30, 60, 200]) {
  writeFileSync(join(root, 'sub', 'a'.repeat(n) + 'b.txt'), 'x');
  await t(`12 stars vs ${n}-char name`, () => ws.run('find_files', { pattern: '*a*a*a*a*a*a*a*a*a*a*a*c' }));
}
writeFileSync(join(root, 'sub', 'deep', 'er', 'est', 'a.txt'), 'x');
await t('** chain x6 on deep path (no match)', () => ws.run('find_files', { pattern: '**/a/**/a/**/a/**/a/**/a/**/a/**/z' }));
await t('?/* mix 12 on long name (no match)', () => ws.run('find_files', { pattern: '*?*?*?*?*?*?*?*?*?*?*?*z' }));
await t('braces 256', () => ws.run('find_files', { pattern: '{a,b,c,d}{a,b,c,d}{a,b,c,d}{a,b,c,d}' }));
await t('include with 12 stars in search_files', () => ws.run('search_files', { query: 'x', include: '*a*a*a*a*a*a*a*a*a*a*a*c' }));
await t('find sanity: **/*.txt', () => ws.run('find_files', { pattern: '**/*.txt', limit: 2 }));
await t('find sanity: sub/deep/**', () => ws.run('find_files', { pattern: 'sub/deep/**' }));
await t('find sanity: ok.{txt,md}', () => ws.run('find_files', { pattern: 'ok.{txt,md}' }));
console.log('--- LA-2 regex');
writeFileSync(join(root, 'bad.txt'), 'a'.repeat(2000) + '!\n' + 'a'.repeat(40) + '!\n');
await t('(a+)+$ regex', () => ws.run('search_files', { query: '(a+)+$', regex: true }));
await t('(a|aa)+$ regex', () => ws.run('search_files', { query: '(a|aa)+$', regex: true }));
await t('(.*a){25} regex', () => ws.run('search_files', { query: '(.*a){25}', regex: true }));
await t('lookahead + group', () => ws.run('search_files', { query: '^(?=(a+)+$)(a+)+b', regex: true }));
await t('normal regex hel+o', () => ws.run('search_files', { query: 'hel+o', regex: true }));
await t('literal (a+)+$ (not regex)', () => ws.run('search_files', { query: '(a+)+$' }));
await t('invalid regex', () => ws.run('search_files', { query: '(', regex: true }));
await t('code in regex source', () => ws.run('search_files', { query: '/);process.exit(1);//', regex: true }));
await t('query of 501 chars', () => ws.run('search_files', { query: 'a'.repeat(501), regex: true }));
console.log('--- many files, each slow but under the per-file limit');
for (let i = 0; i < 40; i += 1) writeFileSync(join(root, `f${i}.txt`), ('a'.repeat(24) + '!\n').repeat(5));
await t('40 files x 5 lines, ^(a+)+$', () => ws.run('search_files', { query: '^(a+)+$', regex: true, include: 'f*.txt' }));
console.log('done (process still alive)');
