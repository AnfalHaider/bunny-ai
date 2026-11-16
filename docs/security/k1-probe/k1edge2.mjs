// K-1 edge timing 2 (Security): how long the guard takes per repeated part, for the shapes that start git or gh processes.
process.env.KIT_NEXT = '1';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
h.stage(root, { 'docs/a.md': 'a' }); h.commitAll(root, 'seed');
const t = (label, command) => { const s = Date.now(); const r = h.guard.decide({ tool: 'Bash', command, cwd: root }); const ms = Date.now() - s; console.log(label.padEnd(52), (r.allow ? 'ALLOWED' : 'REFUSED').padEnd(8), String(ms).padStart(7) + ' ms'); return ms; };
const rep = (s, n) => s.repeat(n);
for (const n of [10, 25, 50, 100]) t(`${n} x git push origin claude/x`, rep('git push origin claude/x; ', n));
for (const n of [10, 50]) t(`${n} x git push origin v1 (short name)`, rep('git push origin v1; ', n));
for (const n of [10, 50]) t(`${n} x git foo (unknown subcommand)`, rep('git foo; ', n));
for (const n of [10, 50]) t(`${n} x gh pr create --fill`, rep('gh pr create --fill; ', n));
for (const n of [10, 50]) t(`${n} x git fetch origin a:b`, rep('git fetch origin a:b; ', n));
for (const n of [10, 50]) t(`${n} x git -C . branch -f x y`, rep('git -C . branch -f x y; ', n));
for (const n of [10, 50]) t(`${n} x git checkout -b claude/y`, rep('git checkout -b claude/y; ', n));
t('50 x git status then a push to main (must be read)', rep('git status; ', 50) + 'git push origin main');
