// W2-7 review probe 2 (Security): do the spellings the rules miss really reach the protected file? (real reads and writes, throwaway folder)
// Usage: node probe2.mjs <checkout of 791dc98>
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CO = process.argv[2].replace(/\\/g, '/');
const pr = await import(`file:///${CO}/src/server/permissionRules.js`);
const { createWorkspace } = await import(`file:///${CO}/src/server/workspace.js`);
const top = mkdtempSync(join(tmpdir(), 'bunny-w27b-'));
const root = join(top, 'ws');
mkdirSync(join(root, 'secrets-private'), { recursive: true });
writeFileSync(join(root, 'secrets-private', 'key.txt'), 'THE-SECRET');
writeFileSync(join(root, '.env'), 'ENV-SECRET');
const R = (effect, pattern, ops) => ({ id: pattern + ops, kind: 'path', effect, pattern, ops, scope: 'All folders' });
const rules = [R('deny', 'secrets-private/**', 'reads'), R('deny', 'secrets-private/**', 'edits'), R('deny', '.env', 'reads'), R('deny', '.env', 'edits')];
const ws = createWorkspace(root, {});
const judge = async (tool, path) => pr.checkToolCall(rules, tool, { path }, await ws.canon(path).catch(() => null))?.effect ?? 'none';
let bad = 0;
const readCase = async (p, secret) => {
  const verdict = await judge('read_file', p);
  let got = '';
  try { got = await ws.run('read_file', { path: p }); } catch (e) { got = `(error ${e.code ?? e.message.slice(0, 40)})`; }
  const reached = got.includes(secret);
  if (reached && verdict !== 'deny') { bad += 1; console.log(`**BYPASS** read_file ${JSON.stringify(p)} returned the secret; the rule said ${verdict}`); }
  else console.log(`  ok  read_file ${JSON.stringify(p)} rule=${verdict} reached=${reached}`);
};
const writeCase = async (p, folder) => {
  rmSync(join(root, folder, 'planted.txt'), { force: true });
  const verdict = await judge('write_file', p);
  let err = '';
  try { await ws.run('write_file', { path: p, content: 'WRITTEN' }); } catch (e) { err = e.message.slice(0, 50); }
  const reached = existsSync(join(root, folder, 'planted.txt'));
  if (reached && verdict !== 'deny') { bad += 1; console.log(`**BYPASS** write_file ${JSON.stringify(p)} created a file inside ${folder}; the rule said ${verdict}`); }
  else console.log(`  ok  write_file ${JSON.stringify(p)} rule=${verdict} reached=${reached} ${err}`);
};
console.log('--- reads');
for (const p of ['.env', '.env.', '.env ', '.env..', '.env. .', '.ENV', '.env::$DATA', 'secrets-private/key.txt', 'secrets-private./key.txt', 'secrets-private /key.txt', 'secrets-private/key.txt.', 'secrets-private/key.txt ', 'SECRET~1/key.txt', 'secret~1/KEY.TXT', 'secrets-private::$INDEX_ALLOCATION/key.txt', 'secrets-private/key.txt::$DATA']) await readCase(p, p.startsWith('.env') ? 'ENV-SECRET' : 'THE-SECRET');
console.log('--- writes into the protected folder');
for (const p of ['secrets-private/planted.txt', 'secrets-private./planted.txt', 'secrets-private /planted.txt', 'secrets-private../planted.txt', 'SECRET~1/planted.txt', 'secrets-private/planted.txt.', 'secrets-private/planted.txt ', 'secrets-private::$INDEX_ALLOCATION/planted.txt']) await writeCase(p, 'secrets-private');
console.log('--- writes to .env');
for (const p of ['.env.', '.env ', '.env::$DATA']) {
  const verdict = await judge('write_file', p);
  try { await ws.run('write_file', { path: p, content: 'CHANGED' }); } catch { /* */ }
  const changed = readFileSync(join(root, '.env'), 'utf8') === 'CHANGED';
  if (changed && verdict !== 'deny') { bad += 1; console.log(`**BYPASS** write_file ${JSON.stringify(p)} overwrote .env; the rule said ${verdict}`); } else console.log(`  ok  write_file ${JSON.stringify(p)} rule=${verdict} changed=${changed}`);
  writeFileSync(join(root, '.env'), 'ENV-SECRET');
}
console.log(bad ? `BYPASSES: ${bad}` : 'NO BYPASS FOUND');
