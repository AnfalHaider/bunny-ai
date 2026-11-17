// W6-16: does an 8.3 short name of a scoped folder resolve to the same real path? Temp folder only.
// Run: node docs/security/w6-16-probe/short-name.mjs "file:///<checkout of the W6-16 branch>"
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.argv[2];
const { inScope } = await import(`${repo}/src/server/scope.js`);
const { checkFolder } = await import(`${repo}/src/server/workspace.js`);
const root = mkdtempSync(join(tmpdir(), 'w616s-'));
const a = join(root, 'LongFolderNameAlpha');
mkdirSync(a);
const ps = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${a.replace(/'/g, "''")}').ShortPath`;
const short = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
const ra = (await checkFolder(a)).folder;
const rs = (await checkFolder(short)).folder;
console.log('long  :', a);
console.log('short :', short, short === a ? '(the volume made no short name)' : '');
console.log('real of short:', rs);
console.log('scope [long], chat in short ->', inScope([ra], rs));
console.log('scope [short real], chat in long ->', inScope([rs], ra));
rmSync(root, { recursive: true, force: true });
