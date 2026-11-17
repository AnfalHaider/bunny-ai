import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { satisfies, checkEnvironment, readRequirements } from '../src/server/environment.js';
import { createWorkspace, workspaceToolDefinitions, TOOL_RISK, describeToolCall } from '../src/server/workspace.js';

const fake = (versions) => async (cmd) => (versions[cmd] ? { ok: true, out: versions[cmd] } : { ok: false, out: '' });
const ALL = { node: 'v18.17.0', npm: '9.6.7', git: 'git version 2.42.0.windows.1', python: 'Python 3.11.4' };

test('semver check table', () => {
  const cases = [
    ['18.17.0', '>=20', false], ['20.1.0', '>=20', true], ['20.0.0', '>=20.0.0', true],
    ['21.0.0', '>20', true], ['20.9.0', '>20', false], ['20.0.1', '>20.0.0', true],
    ['18.17.0', '^18.2.0', true], ['19.0.0', '^18.2.0', false], ['18.1.0', '^18.2.0', false],
    ['0.2.5', '^0.2.3', true], ['0.3.0', '^0.2.3', false],
    ['18.17.0', '~18.17', true], ['18.18.0', '~18.17', false], ['18.17.9', '~18.17.1', true],
    ['20.5.0', '20.x', true], ['21.0.0', '20.x', false], ['20.5.0', '20', true], ['3.11.4', '3.11', true], ['3.12.0', '3.11', false],
    ['18.17.0', '18.17.0', true], ['18.17.1', '18.17.0', false], ['18.17.0', '*', true],
    ['18.17.0', '>=16 <20', true], ['20.0.0', '>=16 <20', false], ['3.11.4', '>=3.8,<4', true], ['3.11.4', '>=3.8, <3.11', false],
    ['3.11.4', '~=3.8', true], ['4.0.0', '~=3.8', false],
    ['14.0.0', '^16 || ^18 || ^20', false], ['18.1.0', '^16 || ^18 || ^20', true],
    ['18.17.0', '<=18', true], ['19.0.0', '<=18', false],
    ['18.17.0', 'lts/*', null], ['18.17.0', '16 - 20', null], ['18.17.0', 'banana', null], ['weird', '>=1', null],
  ];
  for (const [have, range, want] of cases) assert.equal(satisfies(have, range), want, `${have} vs ${range}`);
});

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-env-'));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

test('engines.node >=99 gives the needs-a-newer-runtime advice', async () => {
  const dir = await project({ 'package.json': JSON.stringify({ engines: { node: '>=99' } }) });
  try {
    const out = await checkEnvironment({ folder: dir, run: fake(ALL) });
    assert.match(out, /This project needs Node 99 or newer; you have 18\.17\.0\. Install the current Node LTS from nodejs\.org, then reopen Bunny\./);
    assert.match(out, /Node: 18\.17\.0/);
    assert.match(out, /package\.json: node >=99/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('other requirement files are read; a satisfied one gives no complaint', async () => {
  const dir = await project({ '.nvmrc': 'v18\n', 'pyproject.toml': '[project]\nrequires-python = ">=3.12"\n', 'runtime.txt': 'python-3.11.4\n', '.tool-versions': 'nodejs lts\npython 3.11.4\n' });
  try {
    const out = await checkEnvironment({ folder: dir, run: fake(ALL) });
    assert.match(out, /Python 3\.12 or newer; you have 3\.11\.4/);
    assert.match(out, /Node lts\. Could not compare|Could not compare/);
    assert.doesNotMatch(out, /needs Node 18/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing tool is reported, not thrown, even when the runner throws', async () => {
  const dir = await project({});
  try {
    const boom = async (cmd) => { if (cmd === 'git') throw new Error('spawn failed'); return { ok: false, out: '' }; };
    const out = await checkEnvironment({ folder: dir, run: boom });
    assert.match(out, /Node: not installed/);
    assert.match(out, /Git: not installed/);
    assert.match(out, /Python: not installed/);
    assert.doesNotMatch(out, /pnpm|Yarn/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('python falls back to py, and pnpm shows only when present', async () => {
  const out = await checkEnvironment({ run: fake({ ...ALL, python: undefined, py: 'Python 3.12.1', pnpm: '8.6.0' }) });
  assert.match(out, /Python: 3\.12\.1/);
  assert.match(out, /pnpm: 8\.6\.0/);
});

test('output stays under the cap', async () => {
  const dir = await project({ 'package.json': JSON.stringify({ engines: { node: '>=99 ' + 'x'.repeat(6000) } }) });
  try {
    const out = await checkEnvironment({ folder: dir, run: fake(ALL) });
    assert.ok(out.length <= 3000, `length ${out.length}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a symlink or junction named like a requirement file is not read', async () => {
  const outside = await project({ secret: '>=99 TOPSECRET', 'package.json': JSON.stringify({ engines: { node: '>=98' } }) });
  const dir = await project({});
  try {
    let linked = 0;
    try { await symlink(join(outside, 'secret'), join(dir, '.nvmrc'), 'file'); linked++; } catch { /* OS refuses file symlinks */ }
    try { await symlink(outside, join(dir, 'package.json'), 'junction'); linked++; } catch { /* not permitted */ }
    // A directory named like a file is skipped too.
    await mkdir(join(dir, '.python-version'));
    const reqs = await readRequirements(dir);
    assert.deepEqual(reqs, []);
    const out = await checkEnvironment({ folder: dir, run: fake(ALL) });
    assert.doesNotMatch(out, /TOPSECRET|99|98/);
    assert.ok(linked >= 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('a requirement file is read only up to 64 KB', async () => {
  const dir = await project({ '.nvmrc': `>=77${' '.repeat(70_000)}>=88` });
  try {
    const reqs = await readRequirements(dir);
    assert.equal(reqs[0].range, '>=77');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the workspace tool works, is read-risk, and refuses a path outside the workspace', async () => {
  const dir = await project({ 'package.json': JSON.stringify({ engines: { node: '>=99' } }) });
  await mkdir(join(dir, 'sub'));
  try {
    const ws = createWorkspace(dir, { envRunner: fake(ALL) });
    assert.ok(ws.has('check_environment'));
    assert.equal(TOOL_RISK.check_environment, 'read');
    assert.ok(workspaceToolDefinitions(['read']).some((d) => d.function.name === 'check_environment'));
    assert.equal(describeToolCall('check_environment', { path: 'sub' }), 'Check environment in sub');
    assert.match(await ws.run('check_environment', {}), /needs Node 99 or newer/);
    assert.match(await ws.run('check_environment', { path: 'sub' }), /none found/);
    await assert.rejects(ws.run('check_environment', { path: '..' }), /outside the workspace/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
