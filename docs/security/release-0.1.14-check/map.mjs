// release-0.1.14 (Security): is each signed sha in the candidate, as an ancestor or by patch id? Usage: node map.mjs <candidate>
import { execFileSync } from 'node:child_process';
const cand = process.argv[2];
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
const signed = {
  'BANNER-NOTICE 3a76dc9': '3a76dc9', 'BANNER tray 73bf9c2': '73bf9c2', 'BRAND-BUNNY 9bf9fcc': '9bf9fcc', 'SEARCH-PC 000bfd8': '000bfd8',
  'WEB-ACCESS 75912d6': '75912d6', 'WEBAPP-SIGNIN b475675': 'b475675', 'CLI-ENGINES d603917': 'd603917', 'v0114-lows e66574b': 'e66574b', 'LOWs de90ba1': 'de90ba1',
};
const anc = (s) => { try { git(['merge-base', '--is-ancestor', s, cand]); return true; } catch { return false; } };
const pid = (s) => (git(['patch-id', '--stable'], git(['show', s])).split(' ')[0] || '(merge)');
let ids = null;
for (const [label, sha] of Object.entries(signed)) {
  let exists = true; try { git(['cat-file', '-t', sha]); } catch { exists = false; }
  if (!exists) { console.log(`${label.padEnd(26)} UNKNOWN SHA`); continue; }
  if (anc(sha)) { console.log(`${label.padEnd(26)} ancestor`); continue; }
  if (!ids) { ids = new Map(); for (const s of git(['rev-list', '--no-merges', `origin/main..${cand}`]).trim().split('\n')) { try { ids.set(pid(s), s.slice(0, 9)); } catch { /* none */ } } }
  const p = pid(sha);
  console.log(`${label.padEnd(26)} not an ancestor; patch-id ${p.slice(0, 12)} ${ids.get(p) ? 'found as ' + ids.get(p) : 'NOT FOUND'}`);
}
