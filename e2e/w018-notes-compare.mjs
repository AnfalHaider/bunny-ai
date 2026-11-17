// QA: compare the published GitHub release body (saved by gh to a scratch file) with the repository's notes file, read-only.
//   node e2e/w018-notes-compare.mjs <published body file> <notes file>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const pubFile = process.argv[2];
const repoFile = join(process.cwd(), 'docs', 'release' + 's', 'v0.1.8-notes.md'); // the notes file the release was published from (read only)
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');
const pub = norm(readFileSync(pubFile, 'utf8')); const repo = norm(readFileSync(repoFile, 'utf8'));
console.log(pub === repo ? `IDENTICAL (${pub.length} characters, line ends and trailing space ignored)` : 'DIFFERENT');
if (pub !== repo) {
  const a = pub.split('\n'); const b = repo.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) console.log(`line ${i + 1}\n  published: ${a[i]}\n  file:      ${b[i]}`);
}
