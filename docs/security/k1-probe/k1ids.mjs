// K-1 id attack (Security): run the staged bootstrap.mjs for real in throwaway repos and list every file it created outside its own record folder.
// Usage: node k1ids.mjs <checkout of 8c39d76>
process.env.KIT_NEXT = '1';
import { readdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const walk = (dir, out = [], skip = ['.git', 'node_modules']) => { for (const n of readdirSync(dir)) { if (skip.includes(n)) continue; const p = join(dir, n); let s; try { s = statSync(p); } catch { continue; } if (s.isDirectory()) walk(p, out, skip); else out.push(p); } return out; };
const BS = String.fromCharCode(92);
const ids = ['../x', '..' + BS + 'x', '..', '.', 'x/y', 'x' + BS + 'y', '../../.bootstrap/roles', 'C:/Windows/Temp/k1zzz', '/k1zzz', 'con', 'aux', 'nul', 'x.', 'x ', ' x', '', 'a'.repeat(300), 'x:y', 'x::$DATA', '~/x', 'x\ny', 'X/../../AGENTS', '%TEMP%', '$HOME', 'a"b', "a'b", 'a;b', 'a b', 'a&b', 'a|b', '-x', '--role', 'ok-1', 'Ok_2.3'];
const cmds = [
  ['signoff', 'builder', (id) => ['signoff', id, '--verdict', 'PASS', '--note', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']],
  ['signoff --role=', 'builder', (id) => ['signoff', 'ok', '--role=' + id, '--verdict', 'PASS', '--note', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']],
  ['signoff --role ', 'builder', (id) => ['signoff', 'ok', '--role', id, '--verdict', 'PASS', '--note', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']],
  ['piece', 'chief-of-staff', (id) => ['piece', id, '--lane', 'normal']],
  ['approve', 'chief-of-staff', (id) => ['approve', id, '--words', 'w', '--question', 'q', '--said-at', 't', '--artifact', 'a']],
  ['require', 'chief-of-staff', (id) => ['require', id, 'qa']],
  ['release', 'chief-of-staff', (id) => ['release', id, '--shas', 'abc1234', '--words', 'w', '--question', 'q', '--said-at', 't']],
  ['role', 'builder', (id) => ['role', id]],
];
let leaks = 0;
for (const [name, role, mk] of cmds) {
  console.log('--- ' + name + ' [' + role + ']');
  for (const id of ids) {
    const root = h.makeRepo({ after() {} }, role, {});
    h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
    const parent = join(root, '..');
    const before = new Set(walk(root));
    const r = h.runNode(join(h.BIN, 'bootstrap.mjs'), mk(id), root);
    const after = walk(root);
    const created = after.filter((f) => !before.has(f)).map((f) => relative(root, f).split(BS).join('/'));
    const inside = created.filter((f) => /^docs\/(signoffs|releases)\/[^/]+\/[^/]+$|^docs\/signoffs\/[^/]+\/_[a-z]+\.md$|^docs\/releases\/[^/]+\.md$/.test(f));
    const stray = created.filter((f) => !inside.includes(f) && !/^\.bootstrap\/(session\.json)$/.test(f));
    const stat = r.code === 0 ? 'ran' : 'refused';
    const flag = stray.length || (r.code === 0 && inside.some((f) => f.split('/').length > 4)) ? '**STRAY**' : '  ';
    if (flag.startsWith('**')) leaks += 1;
    if (flag.startsWith('**') || r.code === 0) console.log(flag + ' ' + stat.padEnd(8) + JSON.stringify(id).slice(0, 40).padEnd(42) + ' created: ' + created.join(', ').slice(0, 160));
  }
}
console.log(leaks ? 'STRAY WRITES: ' + leaks : 'NO STRAY WRITE FOUND (only plain ids ran)');
