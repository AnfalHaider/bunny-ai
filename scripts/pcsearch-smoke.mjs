// SEARCH-PC smoke test for QA: the REAL Windows Search index, with INVENTED files only.
//   node scripts/pcsearch-smoke.mjs            run it (needs Windows, the Windows Search service, and Documents in the index, which is the default)
//   node scripts/pcsearch-smoke.mjs --dry      print what it would do and touch nothing
// It makes one new folder under your Documents named bunny-pcsearch-smoke-<random>, with three invented files and a .ssh folder holding a fourth, waits for Windows to index them,
// then checks with the real index and the real code that: the ordinary file is found and allowed; the .ssh file is found by the index but refused by Bunny; the text is read; and a
// quote in a search term causes no error. It deletes the folder it made when it ends, whatever happens. It never reads, lists or changes any other file.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createPcSearch } from '../src/server/pcSearch.js';
import { createExclusions } from '../src/server/pcExclusions.js';

const dry = process.argv.includes('--dry');
const word = `smokeword${randomBytes(4).toString('hex')}`;
const documents = join(homedir(), 'Documents');
const folder = join(documents, `bunny-pcsearch-smoke-${randomBytes(3).toString('hex')}`);
const plan = [
  `make ${folder} with: ${word} notes.txt, ${word} letter.txt, and .ssh\\${word} key notes.txt (all invented text)`,
  'wait up to 120 s for Windows to index them',
  'search the real index for the unique word and check what comes back',
  'read the ordinary file through the checked read, and try the .ssh one (must be refused)',
  'search with a quote in the term (must not fail)',
  `delete ${folder}`,
];

if (dry) { console.log(['SEARCH-PC smoke (dry run, nothing touched):', ...plan.map((p) => `  - ${p}`)].join('\n')); process.exit(0); }
if (process.platform !== 'win32') { console.log('SKIP: this needs Windows and the Windows Search index.'); process.exit(0); }

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };

try {
  mkdirSync(join(folder, '.ssh'), { recursive: true });
  writeFileSync(join(folder, `${word} notes.txt`), `Invented notes about ${word} and nothing else.`);
  writeFileSync(join(folder, `${word} letter.txt`), `An invented letter that mentions ${word}.`);
  writeFileSync(join(folder, '.ssh', `${word} key notes.txt`), `Invented text in a key folder: ${word}.`);

  const exclusions = createExclusions({ dataDir: join(homedir(), 'AppData', 'Local', 'BunnyAI'), electronData: join(homedir(), 'AppData', 'Roaming', 'bunny-ai'), home: homedir(), driveType: async () => 'local' });
  const search = createPcSearch();
  let found = null;
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const r = await search.search({ terms: [word] }, { gate: 'smoke', turn: { searches: 0 } });
    if (r.state === 'ok' && r.rows.length >= 2) { found = r; break; }
    if (r.state === 'unavailable') { console.log('FAIL  Windows Search is not available (the service is off or the provider is missing)'); results.push(false); break; }
    await new Promise((r2) => setTimeout(r2, 4000));
  }
  check('the real index returned the invented files within 120 s', Boolean(found), found ? `${found.rows.length} rows in ${Math.round((Date.now() - started) / 1000)} s` : 'if Documents is not indexed on this PC, add it in Windows indexing options');
  if (found) {
    const verdicts = [];
    for (const row of found.rows) verdicts.push({ name: row.name, v: await exclusions.allowedPath(row.path) });
    const ordinary = verdicts.filter((x) => !/key notes/.test(x.name));
    const keyed = verdicts.filter((x) => /key notes/.test(x.name));
    check('the ordinary files are allowed', ordinary.length >= 2 && ordinary.every((x) => x.v.ok));
    check('the file in the .ssh folder is found by the index but refused by Bunny', keyed.length === 1 && keyed[0].v.ok === false, keyed[0]?.v?.reason);
    const first = found.rows.find((r) => !/key notes/.test(r.name));
    const read = await exclusions.readAllowed(first.path);
    check('the checked read returns the invented text', read.ok && read.buffer.toString('utf8').includes(word));
    const refused = await exclusions.readAllowed(found.rows.find((r) => /key notes/.test(r.name)).path);
    check('the checked read of the .ssh file is refused', refused.ok === false, refused.reason);
  }
  const quoted = await search.search({ terms: [`x' OR 1=1 --`, word] }, { gate: 'smoke2', turn: { searches: 0 } });
  check('a quote in a term causes no error', ['ok', 'nothing'].includes(quoted.state), quoted.state);
} finally {
  // only the folder this run made: it must sit directly under Documents and carry the smoke name
  if (resolve(folder, '..') === resolve(documents) && /bunny-pcsearch-smoke-[0-9a-f]{6}$/.test(folder)) rmSync(folder, { recursive: true, force: true });
  console.log(`cleaned up ${folder}`);
}
process.exit(results.every(Boolean) ? 0 : 1);
