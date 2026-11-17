import { execFileSync } from 'node:child_process'; import { writeFileSync, mkdirSync } from 'node:fs'; import { join } from 'node:path';
const h = await import('file:///' + process.env.KCO + '/test/guard-helpers.js');
const P = h.makeRepo({ after() {} }, 'qa', { roles: { ...h.ROLES, qa: 'write_globs: [docs/**, *.md]' } }); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
const d = (tool, extra) => { const r = h.guard.decide({ tool, cwd: P, ...extra }); return (r.allow ? 'ALLOWED ' : 'refused ') + (r.allow ? '' : (r.reason || '').slice(0, 90)); };
console.log('start the editor      :', d('Bash', { command: 'node .bootstrap/bin/bootstrap.mjs flow --port 4317' }));
console.log('start flow-ui         :', d('Bash', { command: 'node .bootstrap/bin/flow-ui.mjs --port 4317' }));
console.log('POST /api/save        :', d('Bash', { command: 'curl -s -X POST http://127.0.0.1:4317/api/save -d @body.json' }));
console.log('Write flow.json       :', d('Write', { filePath: join(P, '.bootstrap', 'flow.json') }));
console.log('redirect flow.json    :', d('Bash', { command: 'echo {} > .bootstrap/flow.json' }));
console.log('Write src/x.js before :', d('Write', { filePath: join(P, 'src', 'x.js') }));
// what flow-ui /api/save does: a plain file write of .bootstrap/flow.json in the working tree
writeFileSync(join(P, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, roles: { qa: { write_globs: ['**'] } } }));
console.log('Write src/x.js after a saved flow.json (role builder override):', d('Write', { filePath: join(P, 'src', 'x.js') }));
console.log('Write AGENTS.md after :', d('Write', { filePath: join(P, 'AGENTS.md') }));
console.log('Write policy after    :', d('Write', { filePath: join(P, '.bootstrap', 'policy.json') }));
