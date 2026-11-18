// release-0.1.12 (Security): does a rebased range carry exactly the changes of the reviewed range? Compares `git patch-id --stable` commit by commit.
// Usage: node rebase-patch-ids.mjs <reviewed base> <reviewed tip> <new base> <new tip>
import { execFileSync } from 'node:child_process';

const [oldBase, oldTip, newBase, newTip] = process.argv.slice(2);
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
const patchId = (sha) => git(['patch-id', '--stable'], git(['show', sha])).split(' ')[0] || '(merge or empty)';
const list = (a, b) => git(['log', '--reverse', '--no-merges', '--format=%h %s', `${a}..${b}`]).trim().split('\n').filter(Boolean);

const reviewed = list(oldBase, oldTip).map((l) => ({ sha: l.split(' ')[0], subject: l.slice(l.indexOf(' ') + 1), id: patchId(l.split(' ')[0]) }));
const rebased = list(newBase, newTip).map((l) => ({ sha: l.split(' ')[0], subject: l.slice(l.indexOf(' ') + 1), id: patchId(l.split(' ')[0]) }));
const byId = new Map(rebased.map((c) => [c.id, c]));
for (const c of reviewed) console.log(`${c.sha} -> ${byId.get(c.id)?.sha ?? 'NO MATCH'}  ${c.subject.slice(0, 70)}`);
const extra = rebased.filter((c) => !reviewed.some((r) => r.id === c.id));
for (const c of extra) console.log(`only in the new range: ${c.sha}  ${c.subject.slice(0, 90)}`);
