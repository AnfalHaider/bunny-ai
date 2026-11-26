/**
 * LOCAL-MODELS runtime install: Security's SP-1 (the pin), SP-2 (exact allow and skip lists, the manifest re-hashed before every start) and SP-4 (the GitHub hosts, public only).
 * Stand-in zips and hosts only: nothing here touches the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRuntimePins, checkRuntimePins, downloadRuntimeZip, installFromZip, verifyRuntime, classifyEntries, MANIFEST } from '../src/server/localRuntimeInstall.js';
import { makeZip } from './helpers-archives.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
async function temp(t) { const d = await mkdtemp(join(tmpdir(), 'bunny-rt-')); t.after(() => rm(d, { recursive: true, force: true })); return d; }

/** Pins for a tiny invented zip. */
function standIn(entriesExtra = []) {
  const zip = makeZip([
    { name: 'llama-server.exe', data: 'MZ-fake-server' }, { name: 'ggml.dll', data: 'dll-1' }, { name: 'llama.dll', data: 'dll-2' },
    { name: 'ggml-rpc-server.exe', data: 'MZ-rpc' }, { name: 'ggml-rpc.dll', data: 'rpc-dll' },
    ...entriesExtra,
  ]);
  const pins = { 'llama-server': { tag: 'b12760', licence: 'MIT', entry: 'llama-server.exe', hosts: ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'], skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'],
    files: { cpu: { name: 'x.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12760/x.zip', size: zip.length, sha256: sha(zip), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll', 'llama.dll'] } } } };
  return { zip, pins };
}

test('SP-1: the real pin is b12760 with the two zips, sizes and sha256 values Security signed', () => {
  const pins = loadRuntimePins()['llama-server'];
  assert.equal(pins.tag, 'b12760');
  assert.equal(pins.files.cpu.size, 25273382);
  assert.equal(pins.files.cpu.sha256, 'c82a83190be4f0506778d458db685b6ba5d1b06372b7f7083e6e76605c84cb97');
  assert.equal(pins.files.vulkan.size, 39145779);
  assert.equal(pins.files.vulkan.sha256, 'c7764958827c03353da4d4543e6b44a99ac984fed9b098052e320b02089fb6e9');
  assert.deepEqual(checkRuntimePins({ 'llama-server': pins }), []);
  assert.ok(pins.files.cpu.url.startsWith('https://github.com/ggml-org/llama.cpp/releases/download/b12760/'));
});

test('SP-1: the checks on the pins refuse a wrong skip list, a host off the list, a missing hash and a tag mismatch', () => {
  const base = () => JSON.parse(JSON.stringify(loadRuntimePins()));
  const bad = (edit) => { const p = base(); edit(p['llama-server']); return checkRuntimePins(p); };
  assert.ok(bad((p) => { p.skip = ['ggml-rpc-server.exe']; }).some((m) => /skip list/.test(m)));
  assert.ok(bad((p) => { p.files.cpu.url = 'https://evil.example/b12760/x.zip'; }).some((m) => /not on the host list/.test(m)));
  assert.ok(bad((p) => { p.files.cpu.sha256 = ''; }).some((m) => /no sha256/.test(m)));
  assert.ok(bad((p) => { p.files.cpu.url = 'https://github.com/ggml-org/llama.cpp/releases/download/b1/x.zip'; }).some((m) => /pinned tag/.test(m)));
  assert.ok(bad((p) => { p.files.cpu.allow.push('ggml-rpc.dll'); }).some((m) => /both lists/.test(m)));
  assert.ok(bad((p) => { p.licence = 'GPL'; }).some((m) => /licence/.test(m)));
});

test('SP-2: the real allow lists are complete (from the two zips own 52 and 53 entries), never hold the two RPC files, and an incomplete list still fails the release check', () => {
  const pins = loadRuntimePins();
  assert.deepEqual(checkRuntimePins(pins, { forShip: true }), []);
  const f = pins['llama-server'].files;
  assert.equal(f.cpu.allow.length, 50);
  assert.equal(f.vulkan.allow.length, 51);
  for (const k of ['cpu', 'vulkan']) {
    assert.ok(f[k].allow.includes('llama-server.exe'));
    assert.ok(!f[k].allow.includes('ggml-rpc.dll') && !f[k].allow.includes('ggml-rpc-server.exe'), k);
  }
  const bad = JSON.parse(JSON.stringify(pins)); bad['llama-server'].files.cpu.allowComplete = false;
  assert.ok(checkRuntimePins(bad, { forShip: true }).some((m) => /allow list is not complete/.test(m)));
});

test('SP-2: neither skipped file exists in the runtime folder after set-up; the manifest holds every written file', async (t) => {
  const dir = await temp(t);
  const { zip, pins } = standIn();
  await writeFile(join(dir, 'x.zip'), zip);
  const runtime = join(dir, 'rt');
  const manifest = await installFromZip({ zip: join(dir, 'x.zip'), dir: runtime, pins, backend: 'cpu' });
  assert.deepEqual((await readdir(runtime)).sort(), [MANIFEST, 'ggml.dll', 'llama-server.exe', 'llama.dll'].sort());
  assert.equal(existsSync(join(runtime, 'ggml-rpc-server.exe')), false);
  assert.equal(existsSync(join(runtime, 'ggml-rpc.dll')), false);
  assert.deepEqual(manifest.leftInZip.sort(), ['ggml-rpc-server.exe', 'ggml-rpc.dll']);
  assert.equal(manifest.files['llama.dll'].sha256, sha(Buffer.from('dll-2')));
  assert.equal((await verifyRuntime(runtime)).ok, true);
});

test('SP-2: any entry on neither list fails the whole unpack and leaves nothing behind', async (t) => {
  const dir = await temp(t);
  for (const extra of [[{ name: 'surprise.dll', data: 'x' }], [{ name: 'sub/llama.dll', data: 'x' }], [{ name: '../escape.dll', data: 'x' }], [{ name: 'llama-cli.exe', data: 'x' }]]) {
    const { zip, pins } = standIn(extra);
    await writeFile(join(dir, 'y.zip'), zip);
    await assert.rejects(installFromZip({ zip: join(dir, 'y.zip'), dir: join(dir, 'rt2'), pins, backend: 'cpu' }), /not on the list|climbs|which is not|in a folder/, extra[0].name);
    assert.equal(existsSync(join(dir, 'rt2')), false, 'no folder left');
    assert.deepEqual((await readdir(dir)).filter((n) => n.startsWith('rt2')), []);
  }
});

test('SP-2: a zip missing a listed file fails too', () => {
  assert.throws(() => classifyEntries([{ name: 'llama-server.exe', isDir: false }], { allow: ['llama-server.exe', 'ggml.dll'], skip: [] }), /missing ggml\.dll/);
});

test('SP-2: a start is refused when a file changed, is gone, or when either skipped RPC file (or any unknown file) appears later', async (t) => {
  const dir = await temp(t);
  const { zip, pins } = standIn();
  await writeFile(join(dir, 'x.zip'), zip);
  const runtime = join(dir, 'rt');
  await installFromZip({ zip: join(dir, 'x.zip'), dir: runtime, pins, backend: 'cpu' });
  assert.equal((await verifyRuntime(runtime)).ok, true);
  await writeFile(join(runtime, 'llama.dll'), 'tampered');
  const changed = await verifyRuntime(runtime);
  assert.equal(changed.ok, false); assert.equal(changed.file, 'llama.dll'); assert.equal(changed.changed, true);
  await writeFile(join(runtime, 'llama.dll'), 'dll-2');
  assert.equal((await verifyRuntime(runtime)).ok, true);
  for (const name of ['ggml-rpc-server.exe', 'ggml-rpc.dll', 'planted.dll']) {
    await writeFile(join(runtime, name), 'x');
    const r = await verifyRuntime(runtime);
    assert.equal(r.ok, false, name); assert.equal(r.file, name);
    await rm(join(runtime, name));
  }
  await rm(join(runtime, 'ggml.dll'));
  assert.equal((await verifyRuntime(runtime)).file, 'ggml.dll');
  assert.equal((await verifyRuntime(join(dir, 'nothing-here'))).missing, true);
});

/** A stand-in GitHub: the origin redirects to the asset host, which serves `body`. */
function github({ asset = 'release-assets.githubusercontent.com', body, status = 200 }) {
  const seen = [];
  return Object.assign(async (url) => {
    seen.push(url);
    const u = new URL(url);
    if (u.hostname === 'github.com') return { status: 302, headers: { location: `https://${asset}/blob/abc` }, body: [] };
    return { status, headers: {}, body: (async function* () { for (let i = 0; i < body.length; i += 1024) yield body.subarray(i, i + 1024); })() };
  }, { seen });
}

test('SP-1 and SP-4: the download follows GitHub to its own asset host, keeps the pinned size, and deletes a wrong hash', async (t) => {
  const dir = await temp(t);
  const { zip, pins } = standIn();
  for (const asset of ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']) {
    const got = await downloadRuntimeZip({ pins, backend: 'cpu', dest: join(dir, `${asset}.zip`), fetchImpl: github({ asset, body: zip }) });
    assert.equal(got.size, zip.length);
    assert.equal(sha(await readFile(got.path)), pins['llama-server'].files.cpu.sha256);
  }
  await assert.rejects(downloadRuntimeZip({ pins, backend: 'cpu', dest: join(dir, 'bad.zip'), fetchImpl: github({ body: Buffer.concat([zip.subarray(0, zip.length - 1), Buffer.from('X')]) }) }), (e) => e.code === 'runtime.hash');
  assert.equal(existsSync(join(dir, 'bad.zip')), false, 'a wrong hash is deleted');
  await assert.rejects(downloadRuntimeZip({ pins, backend: 'cpu', dest: join(dir, 'big.zip'), fetchImpl: github({ body: Buffer.concat([zip, Buffer.from('more')]) }) }), (e) => e.code === 'runtime.tooBig');
  assert.equal(existsSync(join(dir, 'big.zip')), false);
});

test('SP-4: a redirect to any other host (an amazonaws name, a lookalike of GitHub\'s) stops the download', async (t) => {
  const dir = await temp(t);
  const { zip, pins } = standIn();
  for (const asset of ['evil.example.com', 'github.com.evil.example', 'objects.githubusercontent.com.evil.example', 's3.amazonaws.com']) {
    await assert.rejects(downloadRuntimeZip({ pins, backend: 'cpu', dest: join(dir, 'z.zip'), fetchImpl: github({ asset, body: zip }) }), (e) => e.code === 'runtime.host', asset);
  }
});
