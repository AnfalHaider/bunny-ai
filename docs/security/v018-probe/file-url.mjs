// W6-9 probe (Security): read_url file:// containment, and whether read rules apply to it.
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const { createWorkspace } = await import(`file:///${CO}/src/server/workspace.js`);
const pr = await import(`file:///${CO}/src/server/permissionRules.js`);
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const top = mkdtempSync(join(tmpdir(), 'bunny-fu-')); const root = join(top, 'ws');
mkdirSync(join(root, 'secrets'), { recursive: true });
writeFileSync(join(root, '.env'), 'ENV-SECRET'); writeFileSync(join(root, 'secrets', 'k.txt'), 'KEY-SECRET'); writeFileSync(join(root, 'ok.txt'), 'fine'); writeFileSync(join(top, 'outside.txt'), 'OUTSIDE-SECRET');
try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${join(root, 'jl')}' -Target '${top}' | Out-Null`]); } catch { /* */ }
const rules = [{ id: 'a', kind: 'path', effect: 'deny', pattern: 'secrets/**', ops: 'reads', scope: 'All folders' }, { id: 'b', kind: 'path', effect: 'deny', pattern: '.env', ops: 'reads', scope: 'All folders' }];
const ws = createWorkspace(root, { hidden: (rel) => pr.readDenied(rules, rel) });
const fw = (p) => pathToFileURL(p).href;
const BS = String.fromCharCode(92);
const cases = [['inside, plain', fw(join(root, 'ok.txt'))], ['outside the workspace', fw(join(top, 'outside.txt'))], ['..', 'file:///' + join(root, 'ok.txt').split(BS).join('/') + '/../../outside.txt'], ['%2e%2e', fw(join(root, 'x')).replace('/x', '/%2e%2e/outside.txt')], ['through the junction', fw(join(root, 'jl', 'outside.txt'))], ['UNC form', 'file://localhost/' + join(root, 'ok.txt').split(BS).join('/')], ['host form (remote)', 'file://evil.example/share/x.txt'], ['drive root', 'file:///C:/Windows/win.ini'], ['URL-encoded name', fw(join(root, 'ok.txt')).replace('ok', '%6fk')], ['trailing dot', fw(join(root, 'ok.txt')) + '.'], ['ADS', fw(join(root, 'ok.txt')) + '::$DATA'], ['a folder', fw(root)], ['the denied .env', fw(join(root, '.env'))], ['the denied secrets/k.txt', fw(join(root, 'secrets', 'k.txt'))], ['upper-case .ENV', fw(join(root, '.ENV'))]];
for (const [label, url] of cases) { try { const r = await ws.readFileUrl(url); console.log('READ     ' + label.padEnd(28) + JSON.stringify(r).slice(0, 70)); } catch (e) { console.log('refused  ' + label.padEnd(28) + e.message.slice(0, 80)); } }
console.log('--- the same files through read_file with the hidden filter on');
for (const p of ['.env', 'secrets/k.txt']) { try { const r = await ws.run('read_file', { path: p }); console.log('read_file READ ' + p + ' ' + JSON.stringify(r).slice(0, 50)); } catch (e) { console.log('read_file refused ' + p + ' ' + e.message.slice(0, 60)); } }
console.log('rules engine for read_url file://: ' + (pr.checkToolCall(rules, 'read_url', { url: fw(join(root, '.env')) }, null)?.effect ?? 'NONE (no rule applied)'));
