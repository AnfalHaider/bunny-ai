import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePypiSpec, preparePypi, describePypi, installPypi, discardPypi, pickWheel, pipEnv, PIP_FLAGS } from '../src/server/pypiSource.js';
import { makeZip } from './helpers-archives.js';

// INSTALL-ANYWHERE IA-3: a pinned PyPI connector, wheels only all the way down. PyPI, pip and python are stand-ins; nothing touches the internet and no setup script runs.
const dirs = []; const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'bunny-pypi-')); dirs.push(d); return d; };
test.after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });
const sha = (b) => createHash('sha256').update(b).digest('hex');

const wheelBytes = (extra = []) => makeZip([{ name: 'notes_mcp/__init__.py', data: '' }, { name: 'notes_mcp/__main__.py', data: 'print("hi")' }, ...extra]);
function world({ bytes = wheelBytes(), urls = null, deps = [{ name: 'dep-a', version: '1.0', url: 'https://files.pythonhosted.org/dep_a-1.0-py3-none-any.whl', sha256: 'a'.repeat(64) }], compiled = false } = {}) {
  const calls = [];
  const wheelUrl = { packagetype: 'bdist_wheel', url: 'https://files.pythonhosted.org/notes_mcp-1.0-py3-none-any.whl', filename: 'notes_mcp-1.0-py3-none-any.whl', digests: { sha256: sha(bytes) } };
  return {
    calls, bytes,
    deps: {
      python: 'python',
      fetchJson: async () => ({ urls: urls ?? [wheelUrl] }),
      fetchBytes: async () => bytes,
      run: async (program, args, { cwd, env }) => {
        calls.push({ program, args, env, cwd });
        const i = args.indexOf('venv');
        if (i >= 0) { const v = args[i + 1]; await mkdir(join(v, process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true }); await writeFile(join(v, 'pyvenv.cfg'), 'home = x'); return ''; }
        if (args.includes('--dry-run')) {
          const report = args[args.indexOf('--report') + 1];
          await writeFile(report, JSON.stringify({ install: [{ metadata: { name: 'notes-mcp', version: '1.0' }, download_info: { url: wheelUrl.url, archive_info: { hashes: { sha256: wheelUrl.digests.sha256 } } } }, ...deps.map((d) => ({ metadata: { name: d.name, version: d.version }, download_info: { url: d.url, archive_info: { hashes: { sha256: d.sha256 } } } }))] }));
          return '';
        }
        if (args.includes('--require-hashes')) {
          const site = join(args[args.indexOf('-r') + 1], '..', 'venv', 'Lib', 'site-packages');
          await mkdir(join(site, 'dep_a'), { recursive: true }); await writeFile(join(site, 'dep_a', '__init__.py'), '');
          if (compiled) await writeFile(join(site, 'dep_a', '_speed.pyd'), 'x');
        }
        return '';
      },
    },
  };
}

test('only name==version with an exact version is taken; an sdist is never picked', () => {
  assert.deepEqual(parsePypiSpec('notes-mcp==1.0'), { name: 'notes-mcp', version: '1.0' });
  for (const bad of ['notes-mcp', 'notes-mcp>=1.0', 'notes-mcp==1.*', '../x==1.0', 'x y==1.0', '']) assert.ok(parsePypiSpec(bad).error, bad);
  assert.throws(() => pickWheel([{ packagetype: 'sdist', url: 'https://x/a.tar.gz', digests: { sha256: 'a'.repeat(64) } }]), /wheels only/i);
});

test('the card pins the wheel by sha256, resolves the whole set wheels-only, installs it hash-locked into the final folder as pending, and the yes only removes the pending mark', async () => {
  process.env.PIP_INDEX_URL = 'https://evil.example.com/simple'; process.env.PIP_EXTRA_INDEX_URL = 'https://evil.example.com/extra';
  try {
    const work = await tmp(); const dest = join(work, 'tools', 'pypi', 'notes-mcp-1.0'); const w = world({ compiled: true });
    const p = await preparePypi('notes-mcp==1.0', { workDir: work, dest, ...w.deps });
    const text = describePypi(p);
    for (const need of ['notes-mcp==1.0', 'notes_mcp-1.0-py3-none-any.whl', 'Wheels only, all the way down: this adds 1 more package', 'dep_a: includes compiled code', 'Runs: python -m notes_mcp', 'This runs code from the internet on this computer']) assert.ok(text.includes(need), need);
    const lock = await readFile(join(dest, 'requirements.lock'), 'utf8');
    assert.ok(lock.includes(`notes-mcp==1.0 --hash=sha256:${p.sha256}`) && lock.includes(`dep-a==1.0 --hash=sha256:${'a'.repeat(64)}`), 'every package pinned with its hash');
    const resolve = w.calls.find((c) => c.args.includes('--dry-run')); const install = w.calls.find((c) => c.args.includes('--require-hashes'));
    for (const f of PIP_FLAGS) { assert.ok(resolve.args.includes(f) && install.args.includes(f), f); }
    assert.ok(install.args.includes('--no-deps'));
    for (const c of w.calls) { assert.equal(c.env.PIP_INDEX_URL, undefined); assert.equal(c.env.PIP_EXTRA_INDEX_URL, undefined); assert.ok(c.env.HOME.startsWith(work)); }
    assert.equal(pipEnv('/h').PYTHONNOUSERSITE, '1');
    assert.ok(existsSync(join(dest, '.pending')), 'pending until the yes');
    const before = w.calls.length;
    const placed = await installPypi(p);
    assert.equal(w.calls.length, before, 'nothing is downloaded or run after the yes');
    assert.ok(!existsSync(join(dest, '.pending'))); assert.equal(placed.command, p.command); assert.deepEqual(await readdir(join(work, 'pip-home')), [], "pip's home is gone");
  } finally { delete process.env.PIP_INDEX_URL; delete process.env.PIP_EXTRA_INDEX_URL; }
});

test('a package offered only as source, a dependency with no wheel, and a wrong hash are all refused, and leave nothing behind', async () => {
  const work = await tmp(); const dest = join(work, 'd');
  await assert.rejects(preparePypi('notes-mcp==1.0', { workDir: work, dest, ...world({ urls: [{ packagetype: 'sdist', url: 'https://x/a.tar.gz', filename: 'a.tar.gz', digests: { sha256: 'a'.repeat(64) } }] }).deps }), /wheels only/i);
  const noWheelDep = world({ deps: [{ name: 'dep-src', version: '2.0', url: 'https://files.pythonhosted.org/dep_src-2.0.tar.gz', sha256: 'b'.repeat(64) }] });
  await assert.rejects(preparePypi('notes-mcp==1.0', { workDir: work, dest, ...noWheelDep.deps }), /dep-src is not a wheel/);
  const wrong = world(); wrong.deps.fetchBytes = async () => wheelBytes([{ name: 'evil.py', data: 'x' }]);
  await assert.rejects(preparePypi('notes-mcp==1.0', { workDir: work, dest, ...wrong.deps }), /does not match the hash/);
  const pipFails = world(); const run = pipFails.deps.run; pipFails.deps.run = async (p, a, o) => { if (a.includes('--dry-run')) throw new Error('No matching distribution found for dep-x (no wheel)'); return run(p, a, o); };
  await assert.rejects(preparePypi('notes-mcp==1.0', { workDir: work, dest, ...pipFails.deps }), /no wheel|wheels only/i);
  assert.equal(existsSync(dest), false, 'the connector folder is gone after every refusal');
});

test('any file changed in the tree between card and install stops it and deletes it; no (or a timeout) deletes the folder', async () => {
  const work = await tmp(); const dest = join(work, 'd'); const w = world();
  const p = await preparePypi('notes-mcp==1.0', { workDir: work, dest, ...w.deps });
  await writeFile(join(dest, 'venv', 'Lib', 'site-packages', 'dep_a', '__init__.py'), 'import os; os.system("evil")');
  await assert.rejects(installPypi(p), /changed after you looked/);
  assert.equal(existsSync(dest), false);
  const q = await preparePypi('notes-mcp==1.0', { workDir: work, dest, ...w.deps });
  await discardPypi(q); assert.equal(existsSync(dest), false);
});

// through the app: add_connector({ pypi }) shows one card with the pin and the tree facts; keep-off adds a model-added connector that runs the venv's python; no deletes the folder
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';
for (const choice of ['off', 'no']) test(`through the app: add_connector with a PyPI package, ${choice === 'off' ? 'keep off' : "don't install"}`, async (t) => {
  const w = world({ compiled: true });
  const upstream = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = done === 0 ? { tool_calls: [{ index: 0, id: 'c0', function: { name: 'add_connector', arguments: JSON.stringify({ name: 'Notes', pypi: 'notes-mcp==1.0' }) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(r); }));
  const { base } = await startApp(t, { fake: false, installSource: { pypiDeps: w.deps } });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'pypi' });
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
  assert.deepEqual(cards[0].choices.map((c) => [c.id, !!c.primary]), [['off', true], ['on', false], ['no', false]]);
  for (const need of ['notes-mcp==1.0', 'Wheels only, all the way down', 'dep_a: includes compiled code']) assert.ok(cards[0].detail.includes(need), need);
  const list = (await json(base, '/api/mcp')).body;
  if (choice === 'off') { assert.equal(list.length, 1); assert.equal(list[0].enabled, false); assert.equal(list[0].addedBy, 'model'); assert.match(list[0].command, /python/); }
  else assert.equal(list.length, 0);
});

// IA-12: python and pip planted in a package are never run
import { pythonProgram, execAbsolute } from '../src/server/installExec.js';
test('IA-12: a package that ships python.cmd, pip.cmd or python.bat is never run: python is found by absolute path before the download and started with no shell from our own folder', async (t) => {
  const work = await tmp(); const evil = join(work, 'wheel dir'); await mkdir(evil, { recursive: true }); const marker = join(work, 'MARKER.txt');
  for (const name of ['python.cmd', 'python.bat', 'pip.cmd', 'pip.bat', 'python.exe']) await writeFile(join(evil, name), `@echo off\r\necho ran> "${marker}"\r\n`);
  let py; try { py = pythonProgram(work); } catch { t.skip('python is not installed'); return; }
  assert.ok(py.length > 3 && !py.startsWith(work));
  await execAbsolute(py, ['--version'], { cwd: evil, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? '' } }).catch(() => {});
  assert.equal(existsSync(marker), false, 'nothing planted ever ran');
  assert.equal(pipEnv('/h').NoDefaultCurrentDirectoryInExePath, '1');
  assert.throws(() => pythonProgram(join(py, '..')), /inside the install folder/);
});

test('without Python on the PC there is a plain line before any card', async () => {
  assert.throws(() => pythonProgram(tmpdirSync(), { pathText: '' }), /Packages from PyPI need Python installed/);
});
const tmpdirSync = () => tmpdir();

test('a folder that already exists is never built over or deleted before the yes (an existing connector is untouched)', async () => {
  const work = await tmp(); const dest = join(work, 'existing'); await mkdir(dest, { recursive: true }); await writeFile(join(dest, 'keep.txt'), 'mine');
  await assert.rejects(preparePypi('notes-mcp==1.0', { workDir: work, dest, ...world().deps }), /already exists/);
  assert.equal(await readFile(join(dest, 'keep.txt'), 'utf8'), 'mine');
});
