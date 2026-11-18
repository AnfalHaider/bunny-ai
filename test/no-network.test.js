import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowHost, resetHosts } from './support/net.mjs';

// TEST-DNS: the unit tests never wait on the real network. This file fails if test/support/no-network.mjs is not loaded (the runner loads it), so the gate checks itself.
const root = fileURLToPath(new URL('..', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/no-network.mjs', import.meta.url))).href;
const slow = pathToFileURL(fileURLToPath(new URL('./support/slow-resolver.mjs', import.meta.url))).href;
const timed = async (f) => { const t0 = performance.now(); try { await f(); return { ms: performance.now() - t0 }; } catch (error) { return { ms: performance.now() - t0, error }; } };

test('a name nobody can resolve (a real site, an invented one, .invalid, .test) fails at once with ENOTFOUND, as on a healthy network', async () => {
  for (const name of ['github.com', 'api.openai.com', 'nowhere.invalid', 'x.test', 'weather.example.com']) {
    const r = await timed(() => dns.lookup(name));
    assert.equal(r.error?.code, 'ENOTFOUND', name);
    assert.equal(r.error.hostname, name);
    assert.equal(r.error.syscall, 'getaddrinfo');
    assert.ok(r.ms < 200, `${name} took ${Math.round(r.ms)} ms`);
  }
});

test('localhost and an IP literal still resolve', async () => {
  assert.deepEqual(await dns.lookup('localhost'), { address: '127.0.0.1', family: 4 });
  assert.deepEqual((await dns.lookup('localhost', { all: true })).map((x) => x.address), ['127.0.0.1', '::1']);
  assert.deepEqual(await dns.lookup('127.0.0.1'), { address: '127.0.0.1', family: 4 });
  assert.deepEqual(await dns.lookup('app.localhost'), { address: '127.0.0.1', family: 4 });
});

test('an empty host name gets the plain Node answer (ERR_INVALID_ARG_VALUE), not a loop', async () => {
  await assert.rejects(() => dns.lookup(''), (e) => e.code === 'ERR_INVALID_ARG_VALUE');
  await assert.rejects(() => dns.lookup(undefined), (e) => e.code === 'ERR_INVALID_ARG_TYPE' || e.code === 'ERR_INVALID_ARG_VALUE' || e.code === 'ENOTFOUND');
});

test('fetch to a real site fails at once, with ENOTFOUND as its cause (undici resolves through dns.lookup)', async () => {
  const r = await timed(() => fetch('https://api.openai.com/'));
  assert.ok(r.error, 'it did not leave this computer');
  assert.equal(r.error.cause?.code, 'ENOTFOUND');
  assert.ok(r.ms < 500, `took ${Math.round(r.ms)} ms`);
});

test('a connect to an address that is not this computer is refused at once, and the line names this file', async () => {
  const written = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { written.push(String(chunk)); return write(chunk, ...rest); };
  let r;
  try {
    r = await timed(() => new Promise((resolve, reject) => { const s = net.connect(443, '8.8.8.8'); s.once('error', reject); s.once('connect', resolve); }));
  } finally { process.stderr.write = write; }
  assert.equal(r.error?.code, 'ECONNREFUSED');
  assert.ok(r.ms < 200, `took ${Math.round(r.ms)} ms`);
  assert.ok(written.some((l) => /^NO-NETWORK: no-network\.test\.js tried to reach 8\.8\.8\.8:443/.test(l)), written.join('|'));
});

test('a connect to loopback is untouched', async () => {
  const server = createServer((_req, res) => res.end('hello'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await res.text(), 'hello');
  } finally { server.closeAllConnections?.(); server.close(); }
});

test('allowHost points a name at a local test server for one test; resetHosts takes it back', async () => {
  const server = createServer((_req, res) => res.end('rebound'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    allowHost('rebind.example', '127.0.0.1');
    assert.equal(await (await fetch(`http://rebind.example:${server.address().port}/`)).text(), 'rebound');
    resetHosts();
    await assert.rejects(() => fetch(`http://rebind.example:${server.address().port}/`), (e) => e.cause?.code === 'ENOTFOUND');
  } finally { resetHosts(); server.closeAllConnections?.(); server.close(); }
  assert.throws(() => allowHost('evil.example', '8.8.8.8'), /only points a name at loopback/);
});

test('a node a test starts (NODE_OPTIONS) is cut off from the network too', () => {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, ['-e', "require('dns').promises.lookup('github.com').then(() => console.log('RESOLVED'), (e) => console.log(e.code))"], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.stdout.trim(), 'ENOTFOUND');
  assert.ok(performance.now() - t0 < 5000);
});

test('with a slow resolver (a stand-in that fails every lookup after a delay), the preload makes the cost the same: fast', () => {
  const code = "const t0 = Date.now(); require('dns').promises.lookup('github.com').catch((e) => console.log(e.code, Date.now() - t0))";
  const env = { ...process.env, BUNNY_SLOW_DNS_MS: '1500' };
  delete env.NODE_OPTIONS; // each child loads exactly what its flags say
  const without = spawnSync(process.execPath, ['--import', slow, '-e', code], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  const [code1, ms1] = without.stdout.trim().split(' ');
  assert.equal(code1, 'ENOTFOUND');
  assert.ok(Number(ms1) >= 1400, `the stand-in alone waited ${ms1} ms: it really is slow`);
  const withPreload = spawnSync(process.execPath, ['--import', slow, '--import', preload, '-e', code], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
  const [code2, ms2] = withPreload.stdout.trim().split(' ');
  assert.equal(code2, 'ENOTFOUND');
  assert.ok(Number(ms2) < 200, `with the preload it took ${ms2} ms, whatever the resolver does`);
});

test('the runner refuses to start with BUNNY_TEST_NETWORK=1 (the network is for a person trying one file, never for the gate)', () => {
  const r = spawnSync(process.execPath, ['scripts/unit-tests.mjs', '--list'], { cwd: root, env: { ...process.env, BUNNY_TEST_NETWORK: '1' }, encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /BUNNY_TEST_NETWORK=1 turns the no-network guard off/);
});
