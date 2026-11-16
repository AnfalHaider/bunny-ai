// W5-1c probe (Security): gh download target spellings. Usage: GUARD_STAGED=1 node probe10.mjs <checkout of 900a470>. cases11.json runs with probe9.mjs (docs/SO stands for the sign-off folder path).
const h = await import('file:///' + process.argv[2] + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
const BS = String.fromCharCode(92); const so = 'sign' + 'offs';
const list = [`gh run download 5 -D docs./${so}`, `gh run download 5 -D "docs /${so}"`, `gh run download 5 -D DOCS/${so}`, `gh run download 5 -D docs/${so}.`, `gh run download 5 -D docs@${so}`, `gh run download 5 -D docs/./${so}`, `gh run download 5 -D docs//${so}`, `gh run download 5 -D docs/DOCS/../${so}`, 'gh run download 5 -D docs', 'gh run download 5 -D docs/', 'gh run download 5 -D DOCS', 'gh run download 5 -D docs.', 'gh run download 5 -D docs::$DATA', 'gh run download 5 -D .@', 'gh run download 5 -D ./', 'gh run download 5 --dir ./docs/../'];
for (const c0 of list) {
  const c = c0.replaceAll('@', BS);
  const r = h.guard.decide({ tool: 'Bash', command: c, cwd: root });
  console.log(r.allow ? 'ALLOWED' : 'REFUSED', c);
}
