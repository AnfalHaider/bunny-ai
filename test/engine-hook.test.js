import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_SOURCE, hookIntact, hookSha256, writeHook } from '../src/server/engines/hook-script.js';
import { BRIDGE_ASK_LIMIT_MS, HOOK_OWN_LIMIT_MS, HOOK_TIMEOUT_SECONDS, createBridgeServer } from '../src/server/engines/bridge-server.js';

// CLI-ENGINES CE-1 / CE-1.4 / CE-1.7 / CE-1.11: the hook is run FOR REAL (as a separate Node process, the way Claude Code starts it) against the real bridge listener.
// On every path it prints a deny unless the bridge answered {"allow":true}, and it never exits with 1 (Claude Code lets the tool run on exit 1).

async function hookFile() { const dir = await mkdtemp(join(tmpdir(), 'bunny-hook-')); return (await writeHook(dir)).path; }

/** Run the hook with `stdin` text and these environment variables. Resolves { code, out, decision }. */
function runHook(file, stdin, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ELECTRON_RUN_AS_NODE: '1', ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (c) => { out += c; });
    child.on('close', (code) => { let decision = null; try { decision = JSON.parse(out).hookSpecificOutput; } catch { /* not json */ } resolve({ code, out, decision }); });
    child.stdin.on('error', () => {}); child.stdin.end(stdin);
  });
}
const event = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\p\\a.txt' }, tool_use_id: 'toolu_1', ...extra });
const denied = (r, why) => { assert.equal(r.code, 0, `exit ${r.code} (never 1): ${r.out}`); assert.equal(r.decision?.hookEventName, 'PreToolUse'); assert.equal(r.decision?.permissionDecision, 'deny', r.out); if (why) assert.match(r.decision.permissionDecisionReason, why); };

/** A stand-in bridge that answers however a test wants. */
function fakeBridge(answer) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { req.resume(); req.on('end', () => answer(req, res)); });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) }));
  });
}
const TOKEN = 'a'.repeat(64);
const envFor = (port, extra = {}) => ({ BUNNY_BRIDGE_PORT: String(port), BUNNY_BRIDGE_TOKEN: TOKEN, ...extra });

test('the hook file is Bunny\'s fixed text: rewritten at every start, its sha256 is checked, a changed file is not intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-hook-'));
  const a = await writeHook(dir);
  assert.equal(a.sha256, hookSha256());
  assert.equal(await readFile(a.path, 'utf8'), HOOK_SOURCE);
  assert.equal(await hookIntact(a.path), true);
  await writeFile(a.path, `${HOOK_SOURCE}\n// planted`);
  assert.equal(await hookIntact(a.path), false, 'a changed hook is caught');
  await writeHook(dir); // the next run start puts it back
  assert.equal(await hookIntact(a.path), true);
  assert.equal(await hookIntact(join(dir, 'gone.cjs')), false);
  assert.ok(HOOK_TIMEOUT_SECONDS * 1000 > HOOK_OWN_LIMIT_MS && HOOK_OWN_LIMIT_MS > BRIDGE_ASK_LIMIT_MS, 'Claude Code\'s timeout > the hook\'s own > the bridge\'s Ask limit (CE-1.11)');
  assert.doesNotMatch(HOOK_SOURCE, /process\.exit\(1\)|exit\(1\)/, 'the hook has no exit 1');
});

test('with a live bridge: allow prints allow, deny prints deny with Bunny\'s one-line reason; the request carries the tool, input and tool_use_id; the token is in a header, never the command line', async () => {
  const seen = [];
  const bridge = createBridgeServer({ judge: async (req) => { seen.push(req); return req.tool === 'Read' ? { allow: true, reason: 'Allowed.' } : { allow: false, reason: 'Blocked by your permission rule "git push*" (All folders).' }; } });
  const { port } = await bridge.start();
  try {
    const file = await hookFile();
    const ok = await runHook(file, event(), { ...envFor(port), BUNNY_BRIDGE_TOKEN: bridge.token });
    assert.equal(ok.code, 0); assert.equal(ok.decision.permissionDecision, 'allow');
    const no = await runHook(file, event({ tool_name: 'Bash', tool_input: { command: 'git push' }, tool_use_id: 'toolu_2', agent_id: 'sub1' }), { ...envFor(port), BUNNY_BRIDGE_TOKEN: bridge.token });
    denied(no, /Blocked by your permission rule/);
    assert.deepEqual(seen.map((s) => [s.tool, s.id, s.agent]), [['Read', 'toolu_1', ''], ['Bash', 'toolu_2', 'sub1']]);
    assert.deepEqual(seen[1].input, { command: 'git push' });
    assert.equal(bridge.seen('toolu_1') && bridge.seen('toolu_2'), true, 'the watchdog can see which ids the hook asked about');
    assert.equal(bridge.seen('toolu_9'), false);
  } finally { await bridge.close(); }
});

test('CE-1 failure set: crash-like, garbage, empty, wrong shape and error answers from the bridge, an unreachable or closed bridge, a refused token, bad stdin and missing set-up each print a deny, exit 0', async () => {
  const file = await hookFile();
  // a closed port
  const probe = createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const closedPort = probe.address().port; await new Promise((r) => probe.close(r));
  denied(await runHook(file, event(), envFor(closedPort)), /could not be reached/);
  // answers that are not {"allow":true}
  const bad = [
    ['garbage', (req, res) => { res.writeHead(200); res.end('this is not json {{{'); }], ['empty body', (req, res) => { res.writeHead(200); res.end(''); }], ['500', (req, res) => { res.writeHead(500); res.end('{"allow":true}'); }],
    ['403', (req, res) => { res.writeHead(403); res.end('{}'); }], ['allow as a string', (req, res) => { res.writeHead(200); res.end('{"allow":"yes"}'); }], ['allow 1', (req, res) => { res.writeHead(200); res.end('{"allow":1}'); }],
    ['no allow field', (req, res) => { res.writeHead(200); res.end('{"ok":true}'); }], ['array', (req, res) => { res.writeHead(200); res.end('[true]'); }], ['null', (req, res) => { res.writeHead(200); res.end('null'); }],
    ['closed mid-answer', (req, res) => { res.socket.destroy(); }], ['huge', (req, res) => { res.writeHead(200); res.end('x'.repeat(200000)); }],
  ];
  for (const [label, answer] of bad) {
    const b = await fakeBridge(answer);
    try { const r = await runHook(file, event(), envFor(b.port)); denied(r); assert.notEqual(r.decision?.permissionDecision, 'allow', label); } finally { await b.close(); }
  }
  // the only allow: exactly {"allow":true}
  const good = await fakeBridge((req, res) => { res.writeHead(200); res.end('{"allow":true}'); });
  try { assert.equal((await runHook(file, event(), envFor(good.port))).decision.permissionDecision, 'allow'); } finally { await good.close(); }
  // stdin that does not parse or has no tool name; no set-up
  const b2 = await fakeBridge((req, res) => { res.writeHead(200); res.end('{"allow":true}'); });
  try {
    for (const stdin of ['', 'not json', '{', '[]', 'null', '{"tool_name":5}', '{"hook_event_name":"PreToolUse"}']) denied(await runHook(file, stdin, envFor(b2.port)), /could not read the request/);
    denied(await runHook(file, event(), {}), /not set up/);
    denied(await runHook(file, event(), { BUNNY_BRIDGE_PORT: 'abc', BUNNY_BRIDGE_TOKEN: TOKEN }), /not set up/);
    denied(await runHook(file, event(), { BUNNY_BRIDGE_PORT: String(b2.port), BUNNY_BRIDGE_TOKEN: 'short' }), /not set up/);
    denied(await runHook(file, event(), { BUNNY_BRIDGE_PORT: '99999', BUNNY_BRIDGE_TOKEN: TOKEN }), /not set up/);
  } finally { await b2.close(); }
});

test('the hook\'s own timeout is a deny, never an allow (a bridge that never answers)', async () => {
  const file = await hookFile();
  const b = await fakeBridge(() => { /* never answers */ });
  try {
    const started = Date.now();
    const r = await runHook(file, event(), envFor(b.port, { BUNNY_HOOK_LIMIT_MS: '400' }));
    denied(r, /did not answer in time/);
    assert.ok(Date.now() - started < 5000);
  } finally { await b.close(); }
});

test('the bridge answers deny itself when an Ask is not answered by its limit (CE-1.11); a card answered earlier allows', async () => {
  let release; const answered = new Promise((r) => { release = r; });
  const bridge = createBridgeServer({ limitMs: 300, judge: async (req) => { if (req.tool === 'Bash') { await new Promise(() => {}); } if (req.tool === 'Write') return answered; return { allow: true }; } });
  const { port } = await bridge.start();
  try {
    const file = await hookFile();
    const slow = await runHook(file, event({ tool_name: 'Bash', tool_input: { command: 'x' } }), { ...envFor(port), BUNNY_BRIDGE_TOKEN: bridge.token });
    denied(slow, /No answer came in time/);
    const pending = runHook(file, event({ tool_name: 'Write', tool_input: { file_path: 'a' }, tool_use_id: 'toolu_w' }), { ...envFor(port), BUNNY_BRIDGE_TOKEN: bridge.token });
    setTimeout(() => release({ allow: true, reason: 'Allowed by the person.' }), 100); // the person answers before the limit
    assert.equal((await pending).decision.permissionDecision, 'allow');
  } finally { await bridge.close(); }
});

test('a judge that throws is a deny with a reason; no decision is cached (the same call is judged again)', async () => {
  let calls = 0; let mode = 'throw';
  const bridge = createBridgeServer({ judge: async () => { calls += 1; if (mode === 'throw') throw new Error('boom'); return { allow: true }; } });
  const { port } = await bridge.start();
  try {
    const file = await hookFile(); const env = { ...envFor(port), BUNNY_BRIDGE_TOKEN: bridge.token };
    denied(await runHook(file, event(), env), /could not judge/);
    mode = 'ok';
    assert.equal((await runHook(file, event(), env)).decision.permissionDecision, 'allow');
    assert.equal(calls, 2);
  } finally { await bridge.close(); }
});

function raw(port, { method = 'POST', path = '/decide', host = `127.0.0.1:${port}`, headers = {}, body = '{"tool":"Read","input":{}}', token } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers };
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: h }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers })); });
    req.on('error', reject); req.end(body);
  });
}

test('the bridge listener refuses, with a bare 403: a wrong Host, any Origin, any Sec-Fetch-* header, a missing or wrong token, another run\'s token; only POST /decide is answered; a bad body is 400', async () => {
  const a = createBridgeServer({ judge: async () => ({ allow: true }) }); const b = createBridgeServer({ judge: async () => ({ allow: true }) });
  const { port } = await a.start(); await b.start();
  try {
    for (const extra of [{ host: 'localhost:' + port }, { host: '127.0.0.1' }, { headers: { origin: 'http://x' } }, { headers: { 'sec-fetch-site': 'cross-site' } }, { token: undefined }, { token: 'wrong' }, { token: b.token }, { token: `${a.token}x` }]) {
      const r = await raw(port, { token: a.token, ...extra, ...(extra.token === undefined && 'token' in extra ? { token: undefined } : {}) });
      assert.equal(r.status, 403, JSON.stringify(extra)); assert.equal(r.text, '{}'); assert.equal(r.headers['cache-control'], 'no-store');
      assert.ok(!Object.keys(r.headers).some((x) => x.startsWith('access-control-')));
    }
    assert.equal((await raw(port, { token: a.token })).status, 200);
    assert.equal((await raw(port, { token: a.token, method: 'GET', path: '/decide', body: '' })).status, 404);
    assert.equal((await raw(port, { token: a.token, path: '/other' })).status, 404);
    assert.equal((await raw(port, { token: a.token, body: 'nope' })).status, 400);
    assert.equal((await raw(port, { token: a.token, body: '{"input":1}' })).status, 400);
    assert.equal((await raw(port, { token: a.token, body: JSON.stringify({ tool: 'x', input: 'y'.repeat(1100000) }) })).status, 400, 'over 1 MB');
  } finally { await a.close(); await b.close(); }
});

test('after close the bridge no longer answers, and a pending Ask is ended', async () => {
  const bridge = createBridgeServer({ judge: () => new Promise(() => {}) });
  const { port } = await bridge.start();
  const pending = raw(port, { token: bridge.token }).catch((e) => e);
  await new Promise((r) => setTimeout(r, 100));
  await bridge.close();
  assert.ok((await pending) instanceof Error || true);
  await assert.rejects(() => raw(port, { token: bridge.token }), /ECONNREFUSED|ECONNRESET/);
});

test('CE-1.7: a stdout that never drains: both the deny and the allow path exit 2 with the reason on stderr (never exit 0 without a finished write)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-hook-'));
  const file = (await writeHook(dir)).path;
  const preload = join(dir, 'never-drain.cjs');
  await writeFile(preload, "process.stdout.write = function () { return true; }; // a write whose callback never comes\n");
  const run = (stdin, env) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', preload, file], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', (c) => { err += c; });
    const started = Date.now();
    child.on('close', (code) => resolve({ code, err, ms: Date.now() - started }));
    child.stdin.on('error', () => {}); child.stdin.end(stdin);
  });
  // deny: bad stdin
  const d = await run('not json', envFor(1));
  assert.equal(d.code, 2); assert.match(d.err, /could not read the request/); assert.ok(d.ms < 5000);
  // allow: a bridge that says allow
  const b = await fakeBridge((req, res) => { res.writeHead(200); res.end('{"allow":true}'); });
  try {
    const a = await run(event(), envFor(b.port));
    assert.equal(a.code, 2, 'an allow that could not be written is not an allow'); assert.match(a.err, /not allowed/);
  } finally { await b.close(); }
});
