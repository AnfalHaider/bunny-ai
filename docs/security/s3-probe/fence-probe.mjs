// S-3 probe (Security): two ways around the secrets fence the unit tests do not try.
//  A. an 8.3 short name for the data folder, used as a path INSIDE a chat's folder (the file tools' real-path check must still catch it);
//  B. a shell command that reaches the secrets with wildcards and no protected name in its text.
// Invented data only: a temp "data folder" with a fake secret. Usage: node fence-probe.mjs <path to workspace.js of the commit under review>
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { createWorkspace } = await import(pathToFileURL(process.argv[2]).href);
const top = mkdtempSync(join(tmpdir(), 'sec-s3-'));
const data = join(top, 'BunnyAIDataFolderLongName');
const secretName = 'ab'.repeat(16) + '.secret';
mkdirSync(join(data, 'secrets'), { recursive: true });
writeFileSync(join(data, 'secrets', secretName), 'TOPSECRET-INVENTED');
const ws = createWorkspace(top, { protect: [join(data, 'secrets'), join(data, 'account.json')] });
const tryIt = async (label, tool, args) => {
  try { const out = String(await ws.run(tool, args)); console.log(`${label.padEnd(58)} ${/TOPSECRET/.test(out) ? 'SECRET READ  <-- finding' : 'ran, no secret: ' + out.slice(0, 60).replace(/\s+/g, ' ')}`); }
  catch (err) { console.log(`${label.padEnd(58)} refused: ${String(err.message).slice(0, 60)}`); }
};
try {
  // A. the 8.3 name of the data folder, from Windows itself
  let short = '';
  try { short = execFileSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:SEC_S3_DIR).ShortPath'], { encoding: 'utf8', env: { ...process.env, SEC_S3_DIR: data } }).trim(); } catch { /* no 8.3 names on this volume */ }
  const shortName = short ? short.split('\\').pop() : '';
  if (shortName && shortName.toLowerCase() !== 'bunnyaidatafolderlongname') await tryIt(`A read_file via 8.3 name ${shortName}`, 'read_file', { path: `${shortName}/secrets/${secretName}` });
  else console.log('A skipped: this volume makes no 8.3 names');
  // B. wildcards in a shell command (no protected path or ".secret" in the text)
  await tryIt('B run_command with wildcards', 'run_command', { command: 'Get-ChildItem -Recurse -File -Filter "*.s*t" | Get-Content' });
} finally { rmSync(top, { recursive: true, force: true }); }
