import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalMcp, checkProposedCommand, progressLine, LOCAL_COMMANDS } from '../src/server/mcpLocal.js';
import { createAppTools } from '../src/server/appTools.js';

const script = fileURLToPath(new URL('./fixtures/mcp-slow-start-server.mjs', import.meta.url));
const slow = (delay, extra = {}) => ({ id: 'slow-1', type: 'local', name: 'Carrots', command: process.execPath, args: [script, String(delay), ...(extra.pidFile ? [extra.pidFile] : [])], env: {}, ...extra });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pids, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pids.every((p) => !alive(p))) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
/** The two process ids (the program and its child) the fixture writes to a file. */
async function waitForPids(file) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const m = /^(\d+) (\d+)$/.exec(await readFile(file, 'utf8').catch(() => ''));
    if (m) return [Number(m[1]), Number(m[2])];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the program never reported its process ids');
}
const pidFile = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'pids.txt');
};

test('the first start takes longer than the later limit and shows progress lines', async (t) => {
  // The normal start limit is 0.5 s here and the first-start limit 20 s: the program needs about 1.5 s, so only the long limit lets it through.
  const local = createLocalMcp({ firstStartMs: 20_000, startMs: 500 });
  t.after(() => local.stopAll());
  const lines = [];
  const tools = await local.listTools(slow(1500), { onProgress: (text) => lines.push(text) });
  assert.equal(tools[0].name, 'hello');
  assert.ok(lines.length >= 2, `progress was shown more than once (${lines.length})`);
  assert.match(lines[0], /^Starting Carrots \(first start can take a few minutes\)… 0s/);
  assert.ok(lines.some((l) => /… [1-9]s/.test(l)), 'the elapsed seconds change');
  assert.ok(lines.some((l) => l.includes('downloading carrot-server 1.0.0') || l.includes('almost ready')), 'the program\'s own last line is shown');
  const ends = lines.filter((l) => l.includes('\n')).map((l) => l.split('\n')[1]);
  assert.ok(ends.every((l) => l.length <= 200), 'each detail line is capped at 200 characters');
  assert.ok(lines.every((l) => !l.includes('abc123secretvalue')), 'a secret in the program\'s output is not echoed');
  assert.ok(lines.every((l) => !l.includes('\u001b')), 'colour codes are removed');
  assert.ok(lines.at(-1).split('\n').length <= 2, 'only the last line is shown');
});

test('a later start of the same connector keeps the short limit', async (t) => {
  const local = createLocalMcp({ firstStartMs: 20_000, startMs: 500 });
  t.after(() => local.stopAll());
  await local.listTools(slow(1200)); // first start: allowed
  await local.stop('slow-1');
  // same connector, started again in this run: the short limit applies, and 1.2 s is too slow
  await assert.rejects(local.listTools(slow(1200)), (err) => err.code === 'mcp.startTimeout' && /did not finish starting within 1 second/.test(err.message));
  assert.deepEqual(local.running(), [], 'the program that was too slow was stopped');
});

test('a program that never answers fails plainly after the first-start limit, and is stopped', async (t) => {
  const local = createLocalMcp({ firstStartMs: 1000, startMs: 500 });
  t.after(() => local.stopAll());
  const lines = [];
  const file = await pidFile(t);
  const began = Date.now();
  await assert.rejects(local.listTools(slow('never', { pidFile: file }), { onProgress: (x) => lines.push(x) }), (err) => {
    assert.equal(err.code, 'mcp.startTimeout');
    assert.match(err.message, /^Carrots did not finish starting within 1 second\(s\), so it was stopped\. The last thing it said: /);
    assert.ok(!err.message.includes('abc123secretvalue'));
    return true;
  });
  assert.ok(Date.now() - began >= 900, 'it waited for the whole first-start limit');
  assert.deepEqual(local.running(), []);
  const [mainPid, childPid] = await waitForPids(file);
  assert.ok(await gone([mainPid, childPid]), 'the program and its child are gone');
});

test('a program that exits during its first start is reported as stopped, not as a timeout', async (t) => {
  const local = createLocalMcp({ firstStartMs: 20_000 });
  t.after(() => local.stopAll());
  await assert.rejects(local.listTools(slow(0, { id: 'dies', args: ['-e', 'console.error("no such package"); process.exit(2)'] })), /The connector stopped \(exit code 2\)\. It said: no such package/);
});

test('Stop kills the starting program and everything it started', async (t) => {
  const local = createLocalMcp({ firstStartMs: 60_000 });
  t.after(() => local.stopAll());
  const controller = new AbortController();
  const lines = [];
  const file = await pidFile(t);
  const pending = local.callTool(slow('never', { pidFile: file }), { name: 'hello', signal: controller.signal, onProgress: (x) => lines.push(x) });
  const failure = assert.rejects(pending, (err) => err.code === 'mcp.cancelled');
  const [mainPid, childPid] = await waitForPids(file);
  assert.ok(alive(mainPid) && alive(childPid), 'both were running while it started');
  controller.abort();
  await failure;
  assert.ok(await gone([mainPid, childPid]), 'the program and its child are gone after Stop');
  assert.deepEqual(local.running(), []);
});

test('a start that was already stopped never begins', async (t) => {
  const local = createLocalMcp();
  t.after(() => local.stopAll());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(local.listTools(slow(0), { signal: controller.signal }), (err) => err.code === 'mcp.cancelled');
  assert.deepEqual(local.running(), []);
});

test('progress lines are trimmed, capped and cleaned', () => {
  assert.equal(progressLine('one\ntwo\n  three  \n'), 'three');
  assert.equal(progressLine(`\u001b[31mred\u001b[0m`), 'red');
  assert.equal(progressLine('x'.repeat(500)).length, 200);
  assert.equal(progressLine('key is hunter22 ok', ['hunter22']), 'key is *** ok');
  assert.equal(progressLine('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer ***');
  assert.equal(progressLine('API_TOKEN=abcdef123456'), 'API_TOKEN=***');
  assert.equal(progressLine(''), '');
});

test('a command from the chat must be one of the short list, with separate arguments', () => {
  assert.deepEqual(LOCAL_COMMANDS, ['npx', 'node', 'uvx', 'python', 'python3', 'docker']);
  for (const ok of LOCAL_COMMANDS) assert.equal(checkProposedCommand(ok, ['-y', 'x']).command, ok);
  for (const bad of ['powershell', 'cmd', 'bash', 'curl', 'C:\\tools\\node.exe', './npx', 'npx -y x', 'npx; rm -rf /', '']) {
    assert.throws(() => checkProposedCommand(bad, []), (err) => err.code === 'mcp.commandNotAllowed' && /can only run one of: npx, node, uvx, python, python3, docker/.test(err.message), bad);
  }
  assert.throws(() => checkProposedCommand('npx', '-y some-package'), (err) => err.code === 'mcp.badArgs');
  assert.throws(() => checkProposedCommand('npx', ['-y', 5]), (err) => err.code === 'mcp.badArgs');
});

function toolsWith(store) {
  return createAppTools({
    skills: { add: async () => ({ id: 's' }) },
    mcp: { add: async (c) => { store.push(c); return { id: 'c1', name: c.name, type: c.command ? 'local' : 'remote' }; } },
    getSettings: () => ({}), saveSettings: async () => ({}),
  });
}

test('add_connector refuses a program outside the list, a command line in one piece, and secrets, and starts nothing', async () => {
  const added = [];
  const tools = toolsWith(added);
  await assert.rejects(tools.run('add_connector', { name: 'Bad', command: 'powershell', args: ['-c', 'x'] }), /can only run one of/);
  await assert.rejects(tools.run('add_connector', { name: 'Bad', command: 'npx', args: '-y thing' }), /separate pieces of text/);
  await assert.rejects(tools.run('add_connector', { name: 'Key', command: 'npx', args: ['-y', 'thing'], env: { API_KEY: 'sk-1234' } }), /not taken through the chat/);
  assert.deepEqual(added, [], 'nothing was added, so nothing can start');
  const ok = await tools.run('add_connector', { name: 'Files', command: 'npx', args: ['-y', 'some-server', 'C:\\notes'] });
  assert.match(ok, /local connector Files/);
  assert.deepEqual(added[0], { addedBy: 'model', name: 'Files', url: undefined, command: 'npx', args: ['-y', 'some-server', 'C:\\notes'], env: {}, enabled: true });
});

test('the model offers local connectors only with a command it must have confirmed (the add_connector tool says so)', async () => {
  const { appToolDefinitions } = await import('../src/server/appTools.js');
  const def = appToolDefinitions().find((d) => d.function.name === 'add_connector').function;
  assert.match(def.description, /npx, node, uvx, python, python3, docker/);
  assert.match(def.description, /exact command line on a card and confirms it before anything runs/);
  assert.match(def.parameters.properties.env.description, /never taken through the chat/);
});
