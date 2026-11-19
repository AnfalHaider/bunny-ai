/**
 * SEARCH-PC for the invented-profile test run only (BUNNY_FAKE_UPSTREAM=1 with BUNNY_PCSEARCH_FAKE=1): a Windows Search stand-in over a few invented files in a temp folder,
 * so the end-to-end tests and the screenshots never touch the real index or the owner's real files. Nothing in the installed app starts this.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

export function createFakePcSearch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-pcfake-')));
  const home = join(root, 'Users', 'me');
  const make = (rel, text) => { const full = join(home, rel); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, text); return full; };
  const rows = [
    ['Documents/tax return 2025.txt', 'Income was 104,250 dollars. The refund is 1,200 dollars. Filed in March.'],
    ['Documents/tax return 2024.txt', 'Income was 98,100 dollars. Nothing owed.'],
    ['Documents/trip notes.txt', 'Flights to Lisbon in May. Hotel near the river.'],
    ['Documents/setup tool.exe', 'MZ'],
    ['Downloads/tax software notes.txt', 'Notes about tax software, nothing private.'],
  ].map(([rel, text]) => ({ path: make(rel, text), name: rel.split('/').at(-1), snippet: text, modified: '2025-03-01 10:00:00' }));
  for (const d of ['AppData/Local', 'AppData/Roaming']) mkdirSync(join(home, d), { recursive: true });
  for (const d of ['ProgramData', 'Windows', 'Program Files', 'Program Files (x86)', join('Users', 'sam')]) mkdirSync(join(root, d), { recursive: true });
  const env = { APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), ProgramData: join(root, 'ProgramData'), windir: join(root, 'Windows'), ProgramFiles: join(root, 'Program Files'), 'ProgramFiles(x86)': join(root, 'Program Files (x86)'), SystemDrive: parse(root).root.replace(/[\\/]+$/, '').toUpperCase() };
  const run = async (sql) => {
    const terms = [...sql.matchAll(/CONTAINS\('"((?:[^']|'')*)"'\)/g)].map((m) => m[1].toLowerCase());
    const hit = rows.filter((r) => terms.every((t) => `${r.name} ${r.snippet}`.toLowerCase().includes(t)));
    return { lines: [...hit.map((r) => JSON.stringify({ p: r.path, n: r.name, m: r.modified, s: 100, a: r.snippet })), '{"done":true}'], timedOut: false, tooBig: false };
  };
  return { run, home, env, driveType: async () => 'local' };
}
