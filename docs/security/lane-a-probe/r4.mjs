// LA-4 re-check at 19e1455: 200 files that each cost ~0.3 s (under the 1 s per-file limit). Usage: node r4.mjs <checkout>. Before the fix: 15.7 s, loop frozen; after: stops near 5 s, loop ticks.
// Lane A re-check: many files that are each slow but under the 1 s per-file limit (total time, does the event loop still tick?)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createWorkspace } = await import('file:///' + process.argv[2].replace(/\\/g, '/') + '/src/server/workspace.js');
const root = mkdtempSync(join(tmpdir(), 'bunny-la4-'));
for (let i = 0; i < 200; i += 1) writeFileSync(join(root, `f${i}.txt`), 'a'.repeat(23) + '!\n');
const ws = createWorkspace(root, {});
let ticks = 0; const iv = setInterval(() => { ticks += 1; }, 50);
const s = Date.now();
try { console.log(await ws.run('search_files', { query: '^(a+)+$', regex: true })); } catch (e) { console.log('error', e.message); }
clearInterval(iv);
console.log(`total ${Date.now() - s} ms, timer ticks during it: ${ticks} (a frozen loop would show about 0)`);
