import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const { createWorkspace } = await import('file:///' + process.argv[2] + '/src/server/workspace.js');
const top = mkdtempSync(join(tmpdir(), 'bunny-la-'));
const root = join(top, 'ws'); mkdirSync(join(root, 'sub'), { recursive: true }); mkdirSync(join(top, 'outside'));
writeFileSync(join(top, 'outside', 'secret.txt'), 'OUTSIDE-SECRET\n'); writeFileSync(join(top, 'sib.txt'), 'SIB-SECRET\n');
writeFileSync(join(root, 'ok.txt'), 'hello\nline two\n');
try { execFileSync('powershell', ['-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${join(root, 'jl')}' -Target '${join(top, 'outside')}' | Out-Null`]); } catch (e) { console.log('junction failed'); }
const ws = createWorkspace(root, { beforeWrite: async () => {} });
const t = async (label, fn) => { const s = Date.now(); try { const r = await fn(); console.log(`${/OUTSIDE-SECRET|SIB-SECRET/.test(String(r)) ? '**LEAK**' : 'ok'} ${label} [${Date.now()-s}ms] ${JSON.stringify(String(r)).slice(0, 90)}`); } catch (e) { console.log(`refused ${label} [${Date.now()-s}ms] ${e.message.slice(0, 80)}`); } };
console.log('--- paths');
for (const p of ['..', '../sib.txt', top, top.split(String.fromCharCode(92)).join('/'), 'jl', 'jl/secret.txt', 'C:x', '\\localhost\c$', 'ok.txt\0x']) {
  await t('search path=' + JSON.stringify(p), () => ws.run('search_files', { query: 'SECRET', path: p }));
  await t('find   path=' + JSON.stringify(p), () => ws.run('find_files', { pattern: '*', path: p }));
}
await t('search whole ws (junction inside)', () => ws.run('search_files', { query: 'SECRET' }));
await t('find ** whole ws', () => ws.run('find_files', { pattern: '**' }));
await t('find ../** pattern', () => ws.run('find_files', { pattern: '../**' }));
await t('find abs pattern', () => ws.run('find_files', { pattern: top.split(String.fromCharCode(92)).join('/') + '/**' }));
await t('include ../*', () => ws.run('search_files', { query: 'SECRET', include: '../*' }));
console.log('--- caps');
await t('brace 3 levels', () => ws.run('find_files', { pattern: '{a,b,c,d,e,f}{a,b,c,d,e,f}{a,b,c,d,e,f}' }));
await t('brace 4x4x4x4=256', () => ws.run('find_files', { pattern: '{a,b,c,d}{a,b,c,d}{a,b,c,d}{a,b,c,d}' }));
await t('50 patterns', () => ws.run('find_files', { pattern: Array.from({length: 50}, (_, i) => 'x' + i).join(',') }));
await t('nested brace', () => ws.run('find_files', { pattern: '{{{{a,b},{a,b}},{{a,b},{a,b}}},{{{a,b},{a,b}},{{a,b},{a,b}}}}' }));
