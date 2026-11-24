import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNpmSpec, integrityOf, prepareNpm, describeNpm, installNpm, npmIsolation, binOf } from '../src/server/npmSource.js';
import { makeTgz } from './helpers-archives.js';

// INSTALL-ANYWHERE IA-2: a pinned npm connector. The registry, the tarball and npm itself are stand-ins; nothing touches the internet and no install script runs.
const dirs = []; const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'bunny-npm-')); dirs.push(d); return d; };
test.after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

const pkgJson = (extra = {}) => JSON.stringify({ name: 'notes-mcp', version: '1.2.3', bin: { 'notes-mcp': 'bin/server.js' }, ...extra });
const tarball = (extra = [], pkg = {}) => makeTgz([{ name: 'package/package.json', data: pkgJson(pkg) }, { name: 'package/bin/server.js', data: 'console.log("hi")' }, ...extra]);
function world(bytes, { name = 'notes-mcp', version = '1.2.3' } = {}) {
  const meta = { 'dist-tags': { latest: version }, versions: { [version]: { dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: integrityOf(bytes) } } } };
  const npmCalls = [];
  return {
    npmCalls,
    deps: {
      fetchJson: async () => meta,
      fetchBytes: async () => bytes,
      runNpm: async (args, { cwd, env }) => {
        npmCalls.push({ args, env, cwd });
        if (args.includes('--package-lock-only')) await writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': {}, 'node_modules/b': {} } }));
        return '';
      },
    },
  };
}

test('a name@version is parsed; a range or a bad name is refused', async () => {
  assert.deepEqual(parseNpmSpec('notes-mcp@1.2.3'), { name: 'notes-mcp', spec: '1.2.3' });
  assert.deepEqual(parseNpmSpec('@acme/notes@2.0.0'), { name: '@acme/notes', spec: '2.0.0' });
  assert.deepEqual(parseNpmSpec('notes-mcp'), { name: 'notes-mcp', spec: 'latest' });
  for (const bad of ['../x@1.0.0', 'A Bad Name@1', 'x y@1', '']) assert.ok(parseNpmSpec(bad).error, bad);
  const work = await tmp(); const w = world(tarball());
  await assert.rejects(prepareNpm('notes-mcp@^1.0.0', { workDir: work, ...w.deps }), /exact version/);
});

test('the card pins the exact version and integrity, locks every dependency now, and installs from that lockfile with no scripts', async () => {
  const work = await tmp(); const w = world(tarball());
  const p = await prepareNpm('notes-mcp@latest', { workDir: work, ...w.deps });
  assert.equal(p.version, '1.2.3'); assert.equal(p.dependencies, 2); assert.equal(p.compiled, false);
  const text = describeNpm(p);
  for (const need of ['notes-mcp@1.2.3', 'integrity sha512-', 'This adds 2 packages', 'Runs: node bin/server.js', 'This runs code from the internet on this computer']) assert.ok(text.includes(need), need);
  const lockCall = w.npmCalls.find((c) => c.args.includes('--package-lock-only'));
  for (const need of ['--ignore-scripts', '--omit=dev']) assert.ok(lockCall.args.includes(need), need);
  assert.ok(lockCall.args.some((a) => a === '--registry=https://registry.npmjs.org/'), 'only the public registry');
  assert.ok(lockCall.args.some((a) => /^--userconfig=.*empty\.npmrc$/.test(a)) && lockCall.args.some((a) => /^--globalconfig=.*empty\.npmrc$/.test(a)), "the person's .npmrc (tokens, private registries) is never read");
  assert.ok(lockCall.env.HOME.startsWith(work) && lockCall.env.npm_config_cache.startsWith(work));
  const run = await installNpm(p, { runNpm: w.deps.runNpm });
  const ci = w.npmCalls.find((c) => c.args[0] === 'ci');
  assert.ok(ci.args.includes('--ignore-scripts') && ci.args.includes('--omit=dev'));
  assert.equal(run.command, 'node'); assert.equal(run.args[0], p.bin.file); assert.ok(!JSON.stringify(run).includes('npx'));
});

test('an integrity mismatch is refused and leaves nothing; a lockfile changed between card and install stops the install', async () => {
  const work = await tmp(); const good = tarball();
  const w = world(good); const bad = world(good); bad.deps.fetchBytes = async () => tarball([{ name: 'package/extra.js', data: 'evil' }]);
  await assert.rejects(prepareNpm('notes-mcp@1.2.3', { workDir: work, ...bad.deps }), /integrity/);
  assert.deepEqual(await readdir(join(work, 'npm')).catch(() => []), []);
  const p = await prepareNpm('notes-mcp@1.2.3', { workDir: work, ...w.deps });
  await writeFile(join(p.root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/evil': {} } }));
  await assert.rejects(installNpm(p, { runNpm: w.deps.runNpm }), /changed after you looked/);
  assert.equal(w.npmCalls.some((c) => c.args[0] === 'ci'), false, 'npm ci never ran');
});

test('compiled code and install scripts are reported on the card; a bin that leaves the package is refused', async () => {
  const work = await tmp();
  const compiled = world(tarball([{ name: 'package/build/addon.node', data: 'x' }], { scripts: { postinstall: 'node-gyp rebuild' } }));
  const p = await prepareNpm('notes-mcp@1.2.3', { workDir: work, ...compiled.deps });
  const text = describeNpm(p);
  assert.equal(p.compiled, true); assert.ok(text.includes('Includes compiled code.')); assert.ok(text.includes('Needs an install script (postinstall), which Bunny does not run'));
  assert.equal(compiled.npmCalls.some((c) => !c.args.includes('--ignore-scripts')), false, 'every npm call ignores scripts');
  for (const bin of ['../x.js', 'C:\\evil.exe', '/etc/x']) {
    const w = world(tarball([], { bin: { x: bin } }), { name: 'notes-mcp' });
    await assert.rejects(prepareNpm('notes-mcp@1.2.3', { workDir: await tmp(), ...w.deps }), /outside its own folder|not in it/, bin);
  }
  await assert.rejects(binOf(work, { name: 'x' }), /no "bin"/);
  assert.ok(npmIsolation('/h').args.includes('--no-audit'));
});
