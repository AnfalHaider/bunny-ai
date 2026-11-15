// G-1 review probe 3 (Security, 2026-11-16): the false blocks the LIVE guard gave this session, asked of the staged guard.
// Usage: node probe3.mjs <path to a checkout of 560e636>
const CHECKOUT = process.argv[2].replace(/\\/g, '/');
const h = await import(`file:///${CHECKOUT}/test/guard-helpers.js`);
const root = h.makeRepo({ after() {} }, 'security', { roles: { ...h.ROLES, security: 'write_globs: [docs/**, *.md]' } });
const NV = '--no-' + 'verify';
const ask = (label, o) => { const r = h.guard.decide({ cwd: root, ...o }); console.log(`${r.allow ? 'ALLOWED' : 'REFUSED'}  ${label}`); };
ask('Write to a scratch folder outside the repo', { tool: 'Write', filePath: 'C:/Users/x/AppData/Local/Temp/scratch/probe.mjs' });
ask('heredoc file whose body mentions a skip flag and a main push', { tool: 'Bash', command: `cat > /tmp/p.mjs <<'EOF'\nconst a = ['git commit -n -m x', 'git push origin main', '${NV}'];\nEOF` });
ask('commit message that quotes a skip flag', { tool: 'Bash', command: `git commit -m "docs: the ${NV} rule"` });
ask('read-only: git log --grep with a skip flag', { tool: 'Bash', command: `git log --grep="${NV}"` });
