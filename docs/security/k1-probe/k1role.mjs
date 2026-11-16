// K-1: does `bootstrap role <id>` accept a path-like id? (real run in a throwaway repo, unassigned session)
process.env.KIT_NEXT = '1';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, null);
writeFileSync(join(root, 'AGENTS.md'), '# rules\n');
h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
for (const id of ['../../AGENTS', '../../docs/a', 'qa']) {
  const r = h.runNode(join(h.BIN, 'bootstrap.mjs'), ['role', id], root);
  const rf = h.lib.roleFile(root);
  let file = ''; try { file = readFileSync(rf, 'utf8').trim(); } catch { file = '(none)'; }
  console.log(String(id).padEnd(18), r.code === 0 ? 'ACCEPTED' : 'refused ', ' role file now: ' + file, ' | currentRole=' + h.lib.currentRole(root));
}
