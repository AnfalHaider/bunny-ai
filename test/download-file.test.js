/**
 * W6-13 download_file(url, path): http(s) only, inside the folder, 50 MB cap, content type recorded.
 * A local server on 127.0.0.1 stands in for the web; loopback is allowed only through the
 * BUNNY_ALLOW_LOOPBACK_DOWNLOAD switch (or the allowLoopback option), and the refusal has its own test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspace, workspaceToolDefinitions, TOOL_RISK, describeToolCall } from '../src/server/workspace.js';
import { fetchLimited, isPrivateAddress, MAX_DOWNLOAD_BYTES } from '../src/server/download.js';
import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };

async function webServer(t) {
  const server = createServer((req, res) => {
    if (req.url === '/file') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': 'secret=1' }); res.end('hello bunny'); return; }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.write(Buffer.alloc(1024 * 1024)); const more = () => { if (res.destroyed) return; res.write(Buffer.alloc(1024 * 1024), () => setImmediate(more)); }; more(); return; }
    if (req.url === '/to-file') { res.writeHead(302, { location: 'file:///etc/passwd' }); res.end(); return; }
    if (req.url === '/hop') { res.writeHead(302, { location: '/file' }); res.end(); return; }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const workspace = async (opts = { allowLoopback: true }) => createWorkspace(await mkdtemp(join(tmpdir(), 'bunny-dl-')), opts);

test('download_file is an edit-risk workspace tool with a description', () => {
  assert.equal(TOOL_RISK.download_file, 'edit');
  assert.ok(workspaceToolDefinitions(['edit']).some((d) => d.function.name === 'download_file'));
  assert.ok(!workspaceToolDefinitions(['read']).some((d) => d.function.name === 'download_file'));
  assert.match(describeToolCall('download_file', { url: 'https://x.test/a.zip', path: 'a.zip' }), /Download https:\/\/x\.test\/a\.zip to a\.zip/);
});

test('saves the file, creates parent folders, records content type, size and final URL, no cookies in the result', async (t) => {
  const base = await webServer(t);
  const ws = await workspace();
  let before = null;
  const w = createWorkspace(ws.root, { allowLoopback: true, beforeWrite: (p) => { before = p; } });
  const out = await w.run('download_file', { url: `${base}/hop`, path: 'deep/er/a.txt' });
  assert.equal(await readFile(join(ws.root, 'deep/er/a.txt'), 'utf8'), 'hello bunny');
  assert.match(out, /deep\/er\/a\.txt/);
  assert.match(out, /11 bytes/);
  assert.match(out, /Content type: text\/plain/);
  assert.ok(out.includes(`Final URL: ${base}/file`));
  assert.doesNotMatch(out, /secret|cookie/i);
  assert.ok(before?.endsWith('a.txt'), 'the undo checkpoint was captured before writing');
});

test('refuses non-http schemes: file:, data:, ftp:', async () => {
  const ws = await workspace();
  for (const url of ['file:///etc/passwd', 'data:text/plain,hi', 'ftp://example.com/a', 'not a url']) {
    await assert.rejects(ws.run('download_file', { url, path: 'x.txt' }), /http or https|full http/, url);
  }
  assert.equal(existsSync(join(ws.root, 'x.txt')), false);
});

test('a redirect to a non-http scheme is refused', async (t) => {
  const base = await webServer(t);
  const ws = await workspace();
  await assert.rejects(ws.run('download_file', { url: `${base}/to-file`, path: 'x.txt' }), /http or https/);
  assert.equal(existsSync(join(ws.root, 'x.txt')), false);
});

test('a redirect loop stops after 5 hops', async (t) => {
  const base = await webServer(t);
  const ws = await workspace();
  await assert.rejects(ws.run('download_file', { url: `${base}/loop`, path: 'x.txt' }), /Too many redirects/);
});

test('a path that escapes the folder is refused and nothing is fetched into it', async (t) => {
  const base = await webServer(t);
  const ws = await workspace();
  await assert.rejects(ws.run('download_file', { url: `${base}/file`, path: '../x' }), /outside the workspace/);
  await assert.rejects(ws.run('download_file', { url: `${base}/file`, path: '' }), /needs a path/);
});

test('over the size cap: refused and no partial file is left', async (t) => {
  const base = await webServer(t);
  const ws = await workspace();
  await assert.rejects(ws.run('download_file', { url: `${base}/big`, path: 'big.bin' }), new RegExp(`${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit`));
  assert.deepEqual(await readdir(ws.root), []);
});

test('loopback and private hosts are refused by default', async (t) => {
  const base = await webServer(t);
  const ws = await workspace({});
  await assert.rejects(ws.run('download_file', { url: `${base}/file`, path: 'x.txt' }), /private network|public addresses/);
  assert.equal(existsSync(join(ws.root, 'x.txt')), false);
});

test('the address check blocks every reserved range and every IPv4-in-IPv6 spelling', () => {
  for (const ip of ['127.0.0.1', '127.9.9.9', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.127.255.255', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.168.1.1',
    '169.254.169.254', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255', '0.0.0.0',
    '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12::1', 'fe80::1', 'febf::1', 'ff02::1', '[::1]',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:7f00:0001', '::ffff:10.0.0.1', '::ffff:a00:1', '::127.0.0.1', '::7f00:1',
    '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a00:1::1', '2002:c0a8:101::1', 'not-an-ip']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255', '1.1.1.1',
    '2606:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2001:db8::1']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('numeric, hex and octal host spellings are normalised and refused (no DNS needed)', async () => {
  for (const url of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:127.0.0.1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://[64:ff9b::7f00:1]/']) {
    await assert.rejects(fetchLimited(url, { lookupImpl: async () => { throw new Error('no DNS expected'); } }), /private network/, url);
  }
});

test('DNS rebinding: a host answering with any blocked address is refused', async () => {
  let calls = 0;
  const lookupImpl = async () => { calls += 1; return [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]; };
  await assert.rejects(fetchLimited('http://rebind.example/file', { lookupImpl }), /private network/);
  assert.equal(calls, 1);
});

test('DNS rebinding: the lookup runs once and the socket goes to the validated address, never the second answer', async (t) => {
  let hits = 0;
  const probe = createServer((req, res) => { hits += 1; res.end('x'); });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  t.after(() => { probe.closeAllConnections?.(); probe.close(); });
  const seen = [];
  // First answer is a public (TEST-NET) address; a rebinding resolver would answer 127.0.0.1 next.
  const lookupImpl = async () => { seen.push('lookup'); return seen.length === 1 ? [{ address: '192.0.2.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]; };
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 400);
  await assert.rejects(fetchLimited(`http://rebind.example:${probe.address().port}/`, { lookupImpl, signal: stop.signal }), /Stopped|Could not download/);
  assert.equal(seen.length, 1, 'resolved exactly once');
  assert.equal(hits, 0, 'the loopback server was never reached');
});

/** A model that calls download_file once, then says done. */
async function caller(t, args) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'call:download_file' }] })); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
      if (body.messages.some((m) => m.role === 'tool')) { res.end(frame({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      res.end(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'download_file', arguments: JSON.stringify(args) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

async function runIn(t, mode) {
  process.env.BUNNY_ALLOW_LOOPBACK_DOWNLOAD = '1';
  t.after(() => { delete process.env.BUNNY_ALLOW_LOOPBACK_DOWNLOAD; });
  const web = await webServer(t);
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await caller(t, { url: `${web}/file`, path: 'got.txt' }) });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-dlm-'));
  const { body: s } = await post(base, '/api/sessions', { title: mode, providerId: 'openai', model: 'call:download_file' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'call:download_file', workMode: 'code' }) });
  const asked = [];
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const part = decoder.decode(chunk, { stream: true });
    text += part;
    for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) {
      const data = JSON.parse(m[1]);
      asked.push(data);
      await post(base, `/api/sessions/${s.id}/permission/${data.id}`, { allowed: true });
    }
  }
  return { asked, text, saved: existsSync(join(folder, 'got.txt')) };
}

test('Manual: download_file asks first, then saves when allowed', async (t) => {
  const { asked, saved } = await runIn(t, 'ask');
  assert.equal(asked.length, 1);
  assert.match(asked[0].title, /Download/);
  assert.equal(saved, true);
});

test('Plan: download_file is refused and nothing is saved', async (t) => {
  const { asked, text, saved } = await runIn(t, 'plan');
  assert.deepEqual(asked, []);
  assert.equal(saved, false);
  assert.match(text, /denied|not available/);
});
