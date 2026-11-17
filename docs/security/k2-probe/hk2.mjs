import { execFileSync } from 'node:child_process';
const h = await import('file:///' + process.env.KCO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'builder'); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
const NV = '--no-' + 'verify', HP = 'hooks' + 'Path', G = 'g' + 'it';
const cases = [
  `node -e "require('child_process').execSync('${G} commit ${NV} -m x')"`,
  `node -e "require('child_process').execSync('${G} commit -n -m x')"`,
  `python -c "import os; os.system('${G} commit ${NV} -m x')"`,
  `python -c "import os; os.system('${G} config core.${HP} x')"`,
  `bash -c '${G} commit ${NV} -m x'`,
  `powershell -c "${G} commit ${NV} -m x"`,
  `pwsh -Command "${G} -c core.${HP}=x commit -m y"`,
  `sh -c "${G} -c core.${HP}=/x commit -m y"`,
  `eval "${G} commit ${NV} -m x"`,
  `echo ${G} commit ${NV} | sh`,
  `xargs ${G} commit ${NV} -m x`,
  `iex '${G} commit ${NV} -m x'`,
  `cmd /c ${G} commit ${NV} -m x`,
  `${G} commit -m x ${NV}`,
  `echo "prose about ${NV}"`,
];
for (const c of cases) { const r = h.guard.decide({ tool: 'Bash', command: c, cwd: P }); console.log((r.allow ? 'ALLOWED ' : 'refused ') + c.slice(0, 95)); }
