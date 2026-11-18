// release-0.1.10 (Security): are the commits Security signed on claude/builder-c-v0110 the same changes as the rebuilt ones in the candidate?
// Compares `git patch-id --stable` (the change itself, not the sha). Usage: node patch-ids.mjs <candidate sha>
import { execFileSync } from 'node:child_process';

const candidate = process.argv[2];
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
const patchId = (sha) => git(['patch-id', '--stable'], git(['show', sha])).split(' ')[0] || '(none)';

const signed = { 'S-3 1ec5c64': '1ec5c64', 'W2-9 fix 3df05d5': '3df05d5', 'W2-9 395021d': '395021d', 'S-5..S-7 6b2a351': '6b2a351', 'W6-11 1ee1b01': '1ee1b01' };
const inCandidate = git(['log', '--format=%h', candidate]).trim().split('\n');
const byId = new Map();
for (const sha of inCandidate) { try { byId.set(patchId(sha), sha); } catch { /* a merge commit: no patch */ } }
for (const [label, sha] of Object.entries(signed)) {
  const id = patchId(sha);
  console.log(`${label.padEnd(20)} patch-id ${id.slice(0, 12)}  in candidate as: ${byId.get(id) ?? 'NOT FOUND (same change not present)'}`);
}
