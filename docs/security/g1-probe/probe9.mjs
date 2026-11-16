// W5-1b delta probe (Security). Usage: GUARD_STAGED=1 node probe9.mjs <checkout of 611dee7> <cases json>  (cases9.json, cases10.json). Placeholders: BT = backtick, BS = backslash, RSX = a git word the live guard blocks in typed text.
const h = await import('file:///' + process.argv[2] + '/test/guard-helpers.js');
const root = h.makeRepo({ after() {} }, 'builder');
const BT = String.fromCharCode(96);
const must = (label, list, want) => {
  console.log('--- ' + label + ' (want ' + want + ')');
  for (const c of list) {
    const r = h.guard.decide({ tool: 'Bash', command: c.replace('BT', BT).replaceAll('BS', String.fromCharCode(92)).replace('RSX', 're'+'set'), cwd: root });
    const got = r.allow ? 'ALLOWED' : 'REFUSED';
    console.log((got === want ? '  ok  ' : '**MISMATCH** ') + got + '  ' + c);
  }
};
const sets = JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[3], 'utf8'));
for (const [label, want, list] of sets) must(label, list, want);
