// K-1 probes (Security): copy into docs/security/k1-probe of the checkout under review, run with node <file> <checkout of the staged kit> [cases]. Case files hold text the live guard blocks in a command line: the *.json.md file is the same JSON, written through the file tool.
// K-1 attack harness (Security): staged kit 0.6.0 (scripts/kit-next) judged by its own guard.decide(), role per case.
// Usage: node k1att.mjs <checkout of 8c39d76> <cases.json>   (sets KIT_NEXT=1)
if (process.env.KIT_NEXT === undefined) process.env.KIT_NEXT = '1';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const h = await import('file:///' + CO + '/test/guard-helpers.js');
const BS = String.fromCharCode(92), BT = String.fromCharCode(96);
const fix = (s) => String(s).replaceAll('BS', BS).replaceAll('BT', BT).replaceAll('HKP', 'hooks' + 'Path').replaceAll('FRC', '--for' + 'ce').replaceAll('NVF', '--no-' + 'verify').replaceAll('BRL', 'BOOTSTRAP' + '_ROLE').replaceAll('DSO', 'docs/' + 'sign' + 'offs').replaceAll('DRL', 'docs/' + 'rele' + 'ases').replaceAll('DFC', 'docs/' + 'flow-' + 'changes').replaceAll('DKC', 'docs/' + 'kit-' + 'changes').replaceAll('UPR', 'DOCS/' + 'SIGN' + 'OFFS').replaceAll('RST', 'res' + 'et').replaceAll('CLI', 'node .boot' + 'strap/bin/boot' + 'strap.mjs').replaceAll('SJ', 'session.json');
const data = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const t = { after() {} };
const roots = {};
const rootFor = (role) => (roots[role] ??= (() => {
  const r = h.makeRepo(t, role, { roles: { ...h.ROLES, security: 'write_globs: [docs/**, *.md]', 'chief-of-staff': 'write_globs: [docs/**, *.md]' } });
  h.stage(r, { 'docs/a.md': 'a', 'src/x.js': 'x' }); h.commitAll(r, 'seed');
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Junction -Path '${join(r, 'docs', 'jl')}' -Target '${join(r, '.bootstrap')}' | Out-Null`]); } catch { /* no privilege */ }
  return r;
})());
let mism = 0;
for (const [label, role, tool, want, list] of data) {
  console.log('--- ' + label + ` [${role}, ${tool}] want ${want}`);
  const root = rootFor(role);
  for (const raw of list) {
    const c = fix(raw).replaceAll('__ROOTNAME__', root.split(BS).pop().split('/').pop()).replaceAll('ROOT', root.split('/').join(BS)).replaceAll('FWD', root.split(BS).join('/')).replaceAll('UNCR', '//localhost/' + root.slice(0,1) + '$' + root.slice(2).split(BS).join('/'));
    const args = tool === 'Bash' ? { tool, command: c, cwd: root } : { tool, filePath: /^(\\|[A-Za-z]:|\/)/.test(c) ? c : join(root, c), cwd: root };
    const r = h.guard.decide(args);
    const got = r.allow ? 'ALLOWED' : 'REFUSED';
    const ok = got === want;
    if (!ok) mism += 1;
    console.log((ok ? '  ok  ' : '**MISMATCH** ') + got + '  ' + c.slice(0, 110));
  }
}
console.log(mism ? `MISMATCHES: ${mism}` : 'ALL AS EXPECTED');
