// D-2 review probe (Security, 2026-11-16): asks panes.js (from 6ef4ccf) to read paths it must refuse.
// Builds a throwaway folder in the temp directory with a "secret" OUTSIDE it, and links inside it that point out.
// Usage: node probe.mjs <path to panes.js from 6ef4ccf>
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const panes = await import(`file:///${process.argv[2].replace(/\\/g, '/')}`);
const top = mkdtempSync(join(tmpdir(), 'bunny-d2-'));
const root = join(top, 'project');
mkdirSync(join(root, 'sub'), { recursive: true });
mkdirSync(join(root, '.git'), { recursive: true });
mkdirSync(join(top, 'outside'), { recursive: true });
writeFileSync(join(top, 'outside', 'secret.txt'), 'OUTSIDE-SECRET\n');
writeFileSync(join(top, 'sibling-secret.txt'), 'SIBLING-SECRET\n');
writeFileSync(join(root, 'ok.txt'), 'inside\n');
writeFileSync(join(root, '.env'), 'KEY=inside-env\n');
writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://user:TOKEN@example.test/r.git\n');
let linked = 'none';
try { symlinkSync(join(top, 'outside'), join(root, 'dirlink'), 'junction'); linked = 'junction'; } catch (e) { linked = 'junction failed: ' + e.code; }
try { symlinkSync(join(top, 'outside', 'secret.txt'), join(root, 'filelink.txt'), 'file'); linked += ' + file symlink'; } catch (e) { linked += ' / file symlink failed: ' + e.code; }
console.log('links made:', linked);

const tryRead = async (label, rel) => {
  try {
    const r = await panes.readTextFile(root, rel);
    const leaked = /OUTSIDE-SECRET|SIBLING-SECRET/.test(r.text ?? '');
    console.log(`${leaked ? '**LEAK**' : 'read    '} ${label.padEnd(44)} -> ${r.binary ? 'binary' : JSON.stringify((r.text ?? '').slice(0, 30))}`);
  } catch (e) { console.log(`refused  ${label.padEnd(44)} -> ${e.code ?? e.message}`); }
};
const tryList = async (label, rel) => {
  try {
    const r = await panes.listFolder(root, rel);
    console.log(`listed   ${label.padEnd(44)} -> ${r.entries.map((x) => x.name).join(', ').slice(0, 60)}`);
  } catch (e) { console.log(`refused  ${label.padEnd(44)} -> ${e.code ?? e.message}`); }
};
console.log('--- reads');
for (const [l, p] of [
  ['inside file', 'ok.txt'], ['dotenv inside', '.env'], ['.git/config inside (hidden from the list)', '.git/config'],
  ['dotdot', '../sibling-secret.txt'], ['dotdot backslash', '..\\sibling-secret.txt'], ['dotdot via sub', 'sub/../../sibling-secret.txt'],
  ['absolute', join(top, 'sibling-secret.txt')], ['absolute forward slashes', join(top, 'sibling-secret.txt').replace(/\\/g, '/')],
  ['drive-relative', 'C:sibling-secret.txt'], ['UNC', '\\\\localhost\\c$\\Windows\\win.ini'], ['UNC forward', '//localhost/c$/Windows/win.ini'],
  ['extended prefix', '\\\\?\\' + join(top, 'sibling-secret.txt')], ['device path', '\\\\.\\C:\\Windows\\win.ini'],
  ['junction to outside', 'dirlink/secret.txt'], ['file symlink to outside', 'filelink.txt'],
  ['NUL byte', 'ok.txt\0.png'], ['trailing dot', 'ok.txt.'], ['trailing space', 'ok.txt '], ['alternate data stream', 'ok.txt::$DATA'],
  ['upper case name', 'OK.TXT'], ['reserved name CON', 'CON'], ['reserved name NUL', 'sub/NUL'], ['reserved name COM1', 'COM1'], ['reserved name aux.txt', 'aux.txt'],
  ['8.3 short name of .env', 'ENV~1'], ['empty (the folder itself)', ''], ['dot', '.'],
]) await tryRead(l, p);
console.log('--- lists');
for (const [l, p] of [['root', ''], ['sub', 'sub'], ['dotdot', '..'], ['junction to outside', 'dirlink'], ['absolute', top], ['.git (hidden from list, listable by path?)', '.git']]) await tryList(l, p);

console.log('--- changesFor with a checkpoint path that is a link to a file outside');
const cp = [{ id: 'c1', at: '2026-11-16T00:00:00Z', files: [{ path: join(root, 'filelink.txt'), existed: false }, { path: join(root, 'dirlink', 'secret.txt'), existed: false }, { path: join(top, 'sibling-secret.txt'), existed: false }] }];
const ch = await panes.changesFor(root, cp);
for (const f of ch.checkpoints[0].files) console.log(`${/OUTSIDE-SECRET|SIBLING-SECRET/.test(f.lines.join('\n')) ? '**LEAK**' : 'ok      '} ${f.path} status=${f.status} lines=${JSON.stringify(f.lines).slice(0, 60)}`);
console.log('files reported:', ch.checkpoints[0].files.length, '(the sibling path outside the folder is dropped when it is not 3)');

console.log('--- cost of a big file and of many diffs');
const big = join(root, 'big.bin');
spawnSync('fsutil', ['file', 'createnew', big, String(300 * 1024 * 1024)]);
const m0 = process.memoryUsage().rss;
const t0 = Date.now();
try { await panes.readTextFile(root, 'big.bin'); } catch (e) { console.log('big file error', e.code ?? e.message); }
console.log(`readTextFile on a 300 MB file: ${Date.now() - t0} ms, rss grew ${Math.round((process.memoryUsage().rss - m0) / 1048576)} MB (the cut is 1 MB)`);
const lines = Array.from({ length: 1900 }, (_, i) => `line ${i}`).join('\n');
const lines2 = Array.from({ length: 1900 }, (_, i) => `line ${i % 7 ? i : 'x' + i}`).join('\n');
const t1 = Date.now();
for (let i = 0; i < 20; i += 1) panes.lineDiff(lines, lines2);
console.log(`20 line diffs of 1900 lines: ${Date.now() - t1} ms (blocks the server's event loop while it runs)`);
rmSync(top, { recursive: true, force: true });
