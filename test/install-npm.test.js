import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNpmSpec, integrityOf, prepareNpm, describeNpm, installNpm, discardNpm, npmIsolation, binOf } from '../src/server/npmSource.js';
import { makeTgz } from './helpers-archives.js';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';

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
        if (args.includes('--package-lock-only')) await writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': {}, 'node_modules/b': { hasInstallScript: true } } }));
        if (args[0] === 'ci') { await mkdir(join(cwd, 'node_modules', 'a'), { recursive: true }); await mkdir(join(cwd, 'node_modules', 'b', 'build'), { recursive: true }); await writeFile(join(cwd, 'node_modules', 'a', 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0' })); await writeFile(join(cwd, 'node_modules', 'b', 'package.json'), JSON.stringify({ name: 'b', version: '1.0.0', scripts: { postinstall: 'node-gyp rebuild' } })); await writeFile(join(cwd, 'node_modules', 'b', 'build', 'b.node'), 'x'); }
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

test('the card pins the exact version and integrity, installs the WHOLE tree into staging now (no scripts, own cache), and the yes only moves that staged tree', async () => {
  const work = await tmp(); const w = world(tarball());
  const p = await prepareNpm('notes-mcp@latest', { workDir: work, ...w.deps });
  assert.equal(p.version, '1.2.3'); assert.equal(p.dependencies, 2);
  const text = describeNpm(p);
  for (const need of ['notes-mcp@1.2.3', 'integrity sha512-', 'This adds 2 packages', 'Runs: node bin/server.js', 'This runs code from the internet on this computer', 'b: includes compiled code', "b: needs a script Bunny doesn't run"]) assert.ok(text.includes(need), need);
  const lockCall = w.npmCalls.find((c) => c.args.includes('--package-lock-only'));
  for (const need of ['--ignore-scripts', '--omit=dev']) assert.ok(lockCall.args.includes(need), need);
  assert.ok(lockCall.args.some((a) => a === '--registry=https://registry.npmjs.org/'), 'only the public registry');
  assert.ok(lockCall.args.some((a) => /^--userconfig=.*empty\.npmrc$/.test(a)) && lockCall.args.some((a) => /^--globalconfig=.*empty\.npmrc$/.test(a)), "the person's .npmrc (tokens, private registries) is never read");
  assert.ok(lockCall.args.some((a) => /^--cache=/.test(a) && a.includes('npm-home')), "npm's cache is a folder Bunny makes, not the person's");
  assert.ok(lockCall.env.HOME.startsWith(work) && lockCall.env.npm_config_cache.startsWith(work));
  const ci = w.npmCalls.find((c) => c.args[0] === 'ci'); assert.ok(ci, 'npm ci ran at card time'); assert.ok(ci.args.includes('--ignore-scripts') && ci.args.includes('--omit=dev'));
  assert.deepEqual(await readdir(join(work, 'npm-home')), [], "npm's home and cache are deleted when the card is made");
  const before = w.npmCalls.length;
  const dest = join(work, 'tools', 'notes-mcp');
  const run = await installNpm(p, { dest });
  assert.equal(w.npmCalls.length, before, 'nothing is downloaded or run after the yes');
  assert.equal(run.command, 'node'); assert.ok(run.args[0].startsWith(dest)); assert.ok(!JSON.stringify(run).includes('npx'));
  assert.ok((await readFile(join(dest, 'node_modules', 'a', 'package.json'), 'utf8')).includes('"a"'), 'the staged tree is what was moved');
  assert.deepEqual(await readdir(join(work, 'npm')), [], 'the staging folder is gone after the move');
});

test('an integrity mismatch is refused and leaves nothing; any file changed in the staged tree between card and install stops the install; "no" deletes the staging', async () => {
  const work = await tmp(); const good = tarball();
  const w = world(good); const bad = world(good); bad.deps.fetchBytes = async () => tarball([{ name: 'package/extra.js', data: 'evil' }]);
  await assert.rejects(prepareNpm('notes-mcp@1.2.3', { workDir: work, ...bad.deps }), /integrity/);
  assert.deepEqual(await readdir(join(work, 'npm')).catch(() => []), []);
  const p = await prepareNpm('notes-mcp@1.2.3', { workDir: work, ...w.deps });
  await writeFile(join(p.root, 'node_modules', 'a', 'index.js'), 'require("child_process").exec("evil")');
  await assert.rejects(installNpm(p, { dest: join(work, 'tools', 'x') }), /changed after you looked/);
  assert.deepEqual(await readdir(join(work, 'npm')), [], 'a changed tree is deleted, not installed');
  const q = await prepareNpm('notes-mcp@1.2.3', { workDir: work, ...w.deps });
  await discardNpm(q);
  assert.deepEqual(await readdir(join(work, 'npm')), [], 'a no (or a timeout) deletes the staging folder');
});

test('each package is named on the card: "includes compiled code" for a .node file, "needs a script Bunny does not run" for an install script, a hasInstallScript lock entry or a binding.gyp; clean trees say so', async () => {
  const work = await tmp();
  const dirty = world(tarball([{ name: 'package/build/addon.node', data: 'x' }, { name: 'package/binding.gyp', data: '{}' }], { scripts: { postinstall: 'node-gyp rebuild' } }));
  const p = await prepareNpm('notes-mcp@1.2.3', { workDir: work, ...dirty.deps });
  const text = describeNpm(p);
  for (const need of ['notes-mcp: includes compiled code', 'b: includes compiled code', "notes-mcp: needs a script Bunny doesn't run", "b: needs a script Bunny doesn't run"]) assert.ok(text.includes(need), need);
  assert.equal(dirty.npmCalls.some((c) => !c.args.includes('--ignore-scripts')), false, 'every npm call ignores scripts');
  const clean = world(tarball());
  clean.deps.runNpm = async (args, { cwd }) => { if (args.includes('--package-lock-only')) await writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {} } })); return ''; };
  const c = await prepareNpm('notes-mcp@1.2.3', { workDir: await tmp(), ...clean.deps });
  const ctext = describeNpm(c);
  assert.ok(ctext.includes('No compiled code in the whole tree.') && ctext.includes('No package needs an install script.'));
});

test('a bin that leaves the package is refused, and a package with no bin cannot be a connector', async () => {
  const work = await tmp();
  for (const bin of ['../x.js', 'C:\\evil.exe', '/etc/x']) {
    const w = world(tarball([], { bin: { x: bin } }), { name: 'notes-mcp' });
    await assert.rejects(prepareNpm('notes-mcp@1.2.3', { workDir: await tmp(), ...w.deps }), /outside its own folder|not in it/, bin);
  }
  await assert.rejects(binOf(work, { name: 'x' }), /no "bin"/);
  assert.ok(npmIsolation('/h').args.includes('--no-audit'));
});

// through the app: add_connector({ npm }) shows ONE card with the pin and the whole-tree facts; keep-off installs the staged tree off; no deletes the staging
for (const [choice, label] of [['off', 'keep off'], ['no', "don't install"]]) test(`through the app: add_connector with an npm package, ${label}`, async (t) => {
  const w = world(tarball());
  const upstream = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = done === 0 ? { tool_calls: [{ index: 0, id: 'c0', function: { name: 'add_connector', arguments: JSON.stringify({ name: 'Notes', npm: 'notes-mcp@1.2.3' }) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(r); }));
  const { base, app } = await startApp(t, { fake: false, installSource: { npmDeps: w.deps } });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'npm' });
  const J2 = { 'content-type': 'application/json' };
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: J2, body: JSON.stringify({ value: 'ask' }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: J2, body: JSON.stringify({ content: 'add notes', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const cards = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) { const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card); await fetch(`${base}/api/sessions/${session.id}/permission/${card.id}`, { method: 'POST', headers: J2, body: JSON.stringify({ choice, allowed: choice !== 'no' }) }); }
    }
  }
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].choices.map((c) => [c.id, !!c.primary]), [['off', true], ['on', false], ['no', false]], 'a package the model named is from no catalogue: keep-off is the main button');
  for (const need of ['notes-mcp@1.2.3', 'integrity sha512-', 'b: includes compiled code', 'Runs: node bin/server.js']) assert.ok(cards[0].detail.includes(need), need);
  const list = (await json(base, '/api/mcp')).body;
  if (choice === 'off') {
    assert.equal(list.length, 1); assert.equal(list[0].command, 'node'); assert.equal(list[0].enabled, false); assert.equal(list[0].addedBy, 'model'); assert.ok(!/npx/.test(JSON.stringify(list[0])));
  } else {
    assert.equal(list.length, 0);
    assert.deepEqual(await readdir(join(app.dataDir ?? '', 'installing', 'npm')).catch(() => []), [], 'the staged tree is gone');
  }
});
