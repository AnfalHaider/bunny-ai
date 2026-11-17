const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const { createWorkspace } = await import(`file:///${CO}/src/server/workspace.js`);
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'bunny-dl2-')); mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
const ws = createWorkspace(root, {});
for (const p of ['.git/hooks/pre-commit', 'AGENTS.md', 'out.txt::$DATA', 'con', '.bunny/notes/x.txt']) {
  try { await ws.run('write_file', { path: p, content: 'x' }); console.log('write_file WROTE   ' + p); } catch (e) { console.log('write_file refused ' + p + '  ' + e.message.slice(0, 60)); }
}
