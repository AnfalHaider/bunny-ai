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

const n = Number(process.argv[3]);
writeFileSync(join(root, 'sub', 'a'.repeat(n) + 'b.txt'), 'x');
await t(`12 stars vs ${n}-char name`, () => ws.run('find_files', { pattern: '*a*a*a*a*a*a*a*a*a*a*a*c' }));
