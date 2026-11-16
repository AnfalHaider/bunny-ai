// K-1 edge timing (Security): the new 64 KB / 2,000-part limits, and shapes that stay under them but make the guard start processes.
process.env.KIT_NEXT = '1';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
const run = (label, command, role = 'builder') => {
  const s = Date.now(); const r = h.guard.decide({ tool: 'Bash', command, cwd: root }); const ms = Date.now() - s;
  console.log(label.padEnd(58), (r.allow ? 'ALLOWED' : 'REFUSED').padEnd(8), String(ms).padStart(6) + ' ms', command.length > 1000 ? Math.round(command.length / 1024) + ' KB' : '');
};
const rep = (s, n) => s.repeat(n);
run('1,999 x "git status;"', rep('git status; ', 1999));
run('2,001 x "git status;" (over the part limit)', rep('git status; ', 2001));
run('6,500 x "git status;" ~64 KB (over the count)', rep('git status; ', 6500));
run('64 KB of one long argument', 'echo ' + 'a'.repeat(64 * 1024 - 10));
run('64 KB + 1 of one long argument', 'echo ' + 'a'.repeat(64 * 1024));
run('1,999 x push to a claude branch (git lookups?)', rep('git push origin claude/x; ', 1999));
run('1,999 x push of a short name (tag lookup spawns git)', rep('git push origin v1; ', 1999));
run('1,999 x unknown git subcommand (alias lookup)', rep('git foo; ', 1999));
run('1,999 x git -C . branch -f x y', rep('git -C . branch -f x y; ', 1999));
run('1,999 x gh pr create (current-branch lookup)', rep('gh pr create --fill; ', 1999));
run('1,999 x gh release download -D x', rep('gh release download v1 -D x; ', 1999));
run('1,999 x fetch with a refspec', rep('git fetch origin a:b; ', 1999));
run('1,999 x "echo $(echo a) | cat" (counts as 3 parts each)', rep('echo "$(echo a)" | cat; ', 1999));
run('1,000 x nested quotes and subshells', rep('echo "$(echo \'a\' `date`)"; ', 1000));
run('12 KB note with a push at the end (must be read)', 'echo ' + 'x '.repeat(6000) + '; git push origin main');
run('1,500 commands then a push to main (must be read)', rep('git status; ', 1500) + 'git push origin main');
