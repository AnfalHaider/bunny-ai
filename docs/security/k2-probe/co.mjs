import { execFileSync } from 'node:child_process'; import { writeFileSync, mkdirSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
const h = await import('file:///' + process.env.KCO + '/test/guard-helpers.js');
console.log('BIN', h.BIN.replace(/.*BUNNY-AI/, ''));
const P = h.makeRepo({ after() {} }, 'qa', { roles: { ...h.ROLES, qa: 'write_globs: [docs/**, *.md]' } }); h.stage(P, { 'docs/a.md': 'a' }); execFileSync('git', ['add', '-A'], { cwd: P }); h.commitAll(P, 'seed');
process.chdir(P); process.env.CLAUDE_PROJECT_DIR = P;
const d = (tool, extra) => { const r = h.guard.decide({ tool, cwd: P, ...extra }); return r.allow ? 'ALLOWED' : 'refused'; };
const w = (rel) => d('Write', { filePath: join(P, rel) });
console.log('no flow.json at all: write src/x.js            ', w('src/x.js'));
console.log('write docs/company.json (qa may write docs/**)  ', w('docs/company.json'));
// the Chief sets extends to a project-relative path, committed
writeFileSync(join(P, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, extends: 'docs/company.json' }));
console.log('flow.json extends path:docs/company.json, no company file yet:', w('src/x.js'));
mkdirSync(join(P, 'docs'), { recursive: true }); writeFileSync(join(P, 'docs', 'company.json'), JSON.stringify({ defaults: { roles: { qa: { write_globs: ['**'] } } } }));
console.log('then qa writes docs/company.json (role override)  :', w('src/x.js'), '(relative path, working tree)');
const ext = join(tmpdir(), 'co-ext-' + Date.now() + '.json'); writeFileSync(ext, JSON.stringify({ defaults: { roles: { qa: { write_globs: ['**'] } } } }));
writeFileSync(join(P, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, extends: '' + ext.split(String.fromCharCode(92)).join('/') }));
console.log('absolute path company file outside the project     :', w('src/x.js'), ' write to that outside path by qa:', d('Write', { filePath: ext }));
