// Names the unit-test file whose process never ends (a gate run printed "HUNG ... waiting for test/gaps.test.js": the file the report waits for is only the first one it has not heard from).
//   node scripts/unit-trace.mjs [--limit=150] [--jobs=N] [--out=trace.log]
// Runs every parallel-group file (the same split as scripts/unit-tests.mjs) in its own `node --test` process, N at a time (default: cpus - 1, like node's own pool), with the no-network preload, and writes one line when
// a file STARTS and one when it ENDS (pass/fail, seconds). A file still running after --limit seconds is named, listed as "NEVER ENDED", and killed. Nothing is changed in the repository.
import { spawn } from 'node:child_process';
import { readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const limitMs = Number(arg('limit', 150)) * 1000;
const jobs = Number(arg('jobs', Math.max(1, cpus().length - 1)));
const out = arg('out', null);
const say = (line) => { const t = `${new Date().toISOString().slice(11, 19)} ${line}`; console.log(t); if (out) appendFileSync(out, `${t}\n`); };
if (out) writeFileSync(out, '');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? walk(join(dir, e.name)) : /\.test\.js$/.test(e.name) ? [join(dir, e.name)] : [])).sort();
const isGuard = (f) => /^test\/(guard-[^/]*|kit-next-[^/]*|install-anywhere|confine|confine-run)\.test\.js$/.test(f); // keep in step with scripts/unit-tests.mjs
const files = walk(join(root, 'test')).map((f) => relative(root, f).replace(/\\/g, '/')).filter((f) => !isGuard(f));
const pre = pathToFileURL(join(root, 'test', 'support', 'no-network.mjs')).href;
const { CLAUDE_PROJECT_DIR, ...env } = process.env;

const never = [];
const queue = [...files];
let running = 0;
const runOne = (file) => new Promise((done) => {
  const t0 = Date.now();
  say(`START ${file}`);
  const child = spawn(process.execPath, ['--test', '--test-timeout=120000', '--import', pre, file], { cwd: root, env: { ...env, NODE_OPTIONS: `--import=${pre}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  const timer = setTimeout(() => { never.push(file); say(`NEVER ENDED after ${Math.round(limitMs / 1000)} s: ${file} (killing it)`); try { child.kill('SIGKILL'); } catch { /* gone */ } }, limitMs);
  child.on('close', (code, signal) => { clearTimeout(timer); say(`END   ${file} ${signal ? `signal ${signal}` : code === 0 ? 'pass' : `FAIL (exit ${code})`} ${((Date.now() - t0) / 1000).toFixed(1)}s`); done(); });
});
await new Promise((all) => {
  const pump = () => {
    while (running < jobs && queue.length) { running += 1; runOne(queue.shift()).then(() => { running -= 1; if (!queue.length && !running) all(); else pump(); }); }
  };
  pump();
});
say(never.length ? `NEVER ENDED: ${never.join(', ')}` : 'every file ended');
