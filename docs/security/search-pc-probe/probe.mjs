// SEARCH-PC (Security): junctions, 8.3-style and odd spellings against the exclusions; quotes and keywords in the query. Usage: node probe.mjs <path to src/server>
// Builds an invented "home" in a temp folder; never touches the real profile.
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const src = process.argv[2];
const { createExclusions } = await import(pathToFileURL(join(src, 'pcExclusions.js')).href);
const { buildQuery } = await import(pathToFileURL(join(src, 'pcSearch.js')).href);
const root = mkdtempSync(join(tmpdir(), 'sec-pc-'));
const users = join(root, 'Users'); const home = join(users, 'sam'); const other = join(users, 'alex');
const data = join(home, 'AppData', 'Local', 'BunnyAI');
for (const d of [join(home, 'Documents'), join(home, '.ssh'), data, join(other, 'Documents'), join(home, 'Documents', 'proj', '.git')]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, '.ssh', 'id_ed25519'), 'k'); writeFileSync(join(data, 'settings.json'), '{}'); writeFileSync(join(other, 'Documents', 'a.txt'), 'x');
writeFileSync(join(home, 'Documents', 'ok.txt'), 'fine'); writeFileSync(join(home, 'Documents', 'proj', '.git', 'config'), 'x');
const jn = (name, target) => { const p = join(home, 'Documents', name); symlinkSync(target, p, 'junction'); return p; };
const env = { APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), SystemDrive: root.slice(0, 2) };
const ex = createExclusions({ dataDir: data, home, users, env, driveType: async () => 'local' });
const cases = {
  'ordinary file': join(home, 'Documents', 'ok.txt'),
  'junction into .ssh': join(jn('keys', join(home, '.ssh')), 'id_ed25519'),
  'junction into the data folder': join(jn('bdata', data), 'settings.json'),
  "junction into another person's folder": join(jn('alex', join(other, 'Documents')), 'a.txt'),
  'a .git config': join(home, 'Documents', 'proj', '.git', 'config'),
  'trailing dot spelling of .ssh': join(home, '.ssh.', 'id_ed25519'),
  'alternate data stream': join(home, 'Documents', 'ok.txt:secret'),
  'UNC form': [92, 92, 63, 92].map((c) => String.fromCharCode(c)).join('') + join(home, 'Documents', 'ok.txt'), // the \\?\ prefix
};
for (const [name, p] of Object.entries(cases)) { const v = await ex.allowedPath(p); console.log(`${name.padEnd(40)} ${v.ok ? 'ALLOWED' : 'refused: ' + v.reason}`); }
console.log('\nquery with a quote and SQL words:\n ', buildQuery({ terms: ["tax' OR 1=1 --", 'a"b', 'x) UNION SELECT'], now: new Date('2026-11-19T00:00:00Z') }));
