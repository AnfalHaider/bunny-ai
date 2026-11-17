// W6-16 bypass probe (Security): junction, symlink, 8.3 short name, case, sibling prefix. Temp folder only.
// Run: node docs/security/w6-16-probe/scope-probe.mjs "file:///<checkout of the W6-16 branch>"
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.argv[2];
const { inScope } = await import(`${repo}/src/server/scope.js`);
const { checkFolder } = await import(`${repo}/src/server/workspace.js`);
const real = async (p) => { const r = await checkFolder(p); return r.ok ? r.folder : null; };

const root = await mkdtemp(join(tmpdir(), 'w616-'));
const A = join(root, 'LongFolderNameAlpha');
const A2 = join(root, 'LongFolderNameAlpha2');
const B = join(root, 'Bravo');
for (const d of [A, join(A, 'sub'), A2, B]) await mkdir(d, { recursive: true });
const scope = [await real(A)];
const row = async (label, chatFolder) => {
  const r = await real(chatFolder);
  console.log(`${label.padEnd(34)} real=${String(r).replace(root, '<tmp>').padEnd(34)} inScope=${inScope(scope, r)}`);
};
await row('A itself', A);
await row('A\\sub', join(A, 'sub'));
await row('A2 (prefix sibling)', A2);
await row('B', B);
await row('A in UPPER case', A.toUpperCase());
const jOut = join(root, 'jOut'); await symlink(A, jOut, 'junction');
const jIn = join(A, 'jIn'); await symlink(B, jIn, 'junction');
await row('junction outside -> A', jOut);
await row('junction inside A -> B', jIn);
try { const sOut = join(root, 'sOut'); await symlink(B, sOut, 'dir'); await row('dir symlink -> B', sOut); } catch (e) { console.log('dir symlink: not allowed here', e.code); }
try {
  const short = execFileSync('cmd', ['/c', `for %I in ("${A}") do @echo %~sI`], { encoding: 'utf8' }).trim();
  await row(`8.3 short name (${short.split('\\').pop()})`, short);
} catch (e) { console.log('8.3: could not read a short name', e.message); }
const rA = scope[0];
console.log('text: A + trailing sep           ', inScope(scope, `${rA}\\`));
console.log('text: A\\sub\\..\\..\\Bravo           ', inScope(scope, join(rA, 'sub', '..', '..', 'Bravo')));
console.log('text: no folder                  ', inScope(scope, null));
console.log('text: same name, other drive     ', inScope(scope, `Z:${rA.slice(2)}`));
await rm(root, { recursive: true, force: true });
