import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startClaude } from '../src/server/engines/claude-code.js';
import { createBridge } from '../src/server/engines/bridge.js';
import { stragglers } from '../src/server/engines/process.js';

// CLI-ENGINES CE-1.10 / M6: the stream watchdog, with the fake engine: its hook can be turned off. With the hook on, a bridge request before each result keeps the run going.
// A tool_result with no bridge request stops the run at once (a tree kill), marks it "stopped: Bunny's check did not run", and restricted mode is offered by the caller.
// Also: a result for an unknown id, malformed or over-long or unknown lines, a start that never says init, silence, and "no engine process outlives its run".

const FAKE = fileURLToPath(new URL('../src/server/engines/fake-engine.mjs', import.meta.url));
const launcher = [process.execPath, FAKE, 'claude-code'];

async function world() {
  const base = await mkdtemp(join(tmpdir(), 'bunny-wd-'));
  return { base, cwd: base, home: join(base, 'home') };
}
const allowAll = async () => ({ allow: true, reason: 'Allowed.' });

async function run(w, script, { judge = allowAll, mode = 'full', silenceMs = 0, ...rest } = {}) {
  const decisions = [];
  const r = await startClaude({ cwd: w.cwd, prompt: 'do it', home: w.home, exe: 'C:\\E\\claude.exe', launcher, mode, judge, onDecision: (d) => decisions.push(d), silenceMs, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify(script) }, ...rest });
  const events = [];
  for await (const e of r.events) events.push(e);
  return { r, events, decisions };
}
const types = (events) => events.map((e) => e.type);
const alive = (pid) => new Promise((resolve) => { execFile(process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tasklist.exe') : 'ps', process.env.SystemRoot ? ['/FI', `PID eq ${pid}`, '/NH'] : ['-p', String(pid)], { windowsHide: true }, (_err, out) => resolve(String(out).includes(String(pid)))); });

test('with the hook on, a bridge request comes before each result and the run goes on: text, steps, the tool ran, usage and done', async () => {
  const w = await world(); const marker = join(w.base, 'ran.txt');
  const { events, decisions } = await run(w, { steps: [{ say: 'Looking.' }, { tool: 'Read', input: { file_path: join(w.cwd, 'a.txt') }, marker }, { say: 'Done.' }] });
  assert.deepEqual(types(events).filter((t) => t !== 'text'), ['session', 'tool-start', 'tool-end', 'usage', 'done']);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'Looking.Done.');
  const start = events.find((e) => e.type === 'tool-start'); const end = events.find((e) => e.type === 'tool-end');
  assert.deepEqual([start.name, start.engineTool, start.callId === end.callId, end.ok], ['read_file', 'Read', true, true]);
  assert.equal(decisions.length, 1); assert.equal(decisions[0].allow, true);
  assert.equal(existsSync(marker), true, 'the tool ran');
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', input: 10, output: 4 });
  assert.equal(events.find((e) => e.type === 'session').engineSessionId, 'fake-session-1');
});

test('a deny reaches the engine as a hook error: the tool did not run, the step ends as failed with Bunny\'s reason, and the run goes on to the end', async () => {
  const w = await world(); const marker = join(w.base, 'ran.txt');
  const judge = createBridge({ mode: 'auto', rules: [], root: w.cwd, protect: [], keyFolders: [], ask: async () => false }).claude;
  const { events } = await run(w, { steps: [{ tool: 'Write', input: { file_path: join(w.cwd, '..', 'outside.txt'), content: 'x' }, marker }, { say: 'ok' }] }, { judge });
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, false); assert.match(end.output, /outside the workspace/);
  assert.equal(existsSync(marker), false, 'it did not run');
  assert.equal(types(events).at(-1), 'done');
});

test('CE-1.10: with the hook DISABLED, a tool_use followed by a tool_result with no bridge request stops the run at once: tree-killed, an error marked "stopped: Bunny\'s check did not run", no done', async () => {
  const w = await world(); const marker = join(w.base, 'ran.txt');
  const { r, events } = await run(w, { steps: [{ say: 'hi' }, { tool: 'Bash', input: { command: 'echo hi' }, skipHook: true, marker }, { say: 'never shown' }] });
  const err = events.find((e) => e.type === 'error');
  assert.equal(err.code, 'watchdog'); assert.match(err.message, /Bunny's check did not run/);
  assert.equal(types(events).includes('done'), false, 'the run did not finish');
  assert.equal(events.some((e) => e.type === 'tool-end'), false, 'the result was not passed on');
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'hi', 'nothing after the trip was shown');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await alive(r.pid), false, 'the engine process is gone (a tree kill)');
  assert.equal(r.stopped, true);
});

test('CE-1.10: a tool_result for an id that never started stops the run too; so does a result for a different id than the one the hook was asked about', async () => {
  const w = await world();
  const unknown = await run(w, { steps: [{ tool: 'Read', input: { file_path: join(w.cwd, 'a') }, resultId: 'toolu_other' }] });
  assert.match(unknown.events.find((e) => e.type === 'error').message, /never saw start/);
  assert.equal(unknown.events.some((e) => e.type === 'done'), false);
});

test('a refusal the ENGINE made before running anything (validation, "no such tool") has no bridge request and does NOT trip the watchdog', async () => {
  const w = await world();
  const { events } = await run(w, { steps: [{ tool: 'Edit', input: { file_path: join(w.cwd, 'a.txt') }, skipHook: true, engineRefusal: true }, { say: 'fine' }] });
  assert.equal(events.some((e) => e.type === 'error'), false);
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, false); assert.match(end.output, /tool_use_error/);
  assert.equal(types(events).at(-1), 'done');
});

test('a line that is not JSON, one with no type, an unknown kind of event, an over-long line and a system/init with an unexpected tool each end the run with an error (M6)', async () => {
  const w = await world();
  for (const [label, script, pattern] of [
    ['garbage', { steps: [{ rawLine: 'this is not json' }, { say: 'x' }] }, /not JSON/],
    ['no type', { steps: [{ rawLine: '{"hello":1}' }] }, /no type/],
    ['unknown kind', { steps: [{ rawLine: '{"type":"surprise"}' }] }, /does not know/],
    ['too long', { steps: [{ rawLine: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(1100000) }] } }) }] }, /longer than 1 MB/],
    ['unexpected tool', { tools: ['Read', 'Agent'], steps: [{ say: 'x' }] }, /does not expect/],
  ]) {
    const { events } = await run(w, script);
    const err = events.find((e) => e.type === 'error');
    assert.ok(err, label); assert.match(err.message, pattern, label);
    assert.equal(events.some((e) => e.type === 'done'), false, `${label}: no done after an error`);
  }
});

test('a process that ends before printing system/init is an error that says it did not start; one that hangs in silence is stopped after the silence limit', async () => {
  const w = await world();
  const early = await run(w, { noInit: true, steps: [{ exit: 3 }] });
  assert.match(early.events.find((e) => e.type === 'error').message, /did not start/);
  const silent = await run(w, { steps: [{ say: 'a' }, { hang: true }] }, { silenceMs: 800 });
  assert.match(silent.events.find((e) => e.type === 'error').message, /printed nothing for too long/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await alive(silent.r.pid), false, 'the silent engine is killed');
});

test('stop() ends the run: the whole process tree is killed and no engine process is left; the bridge listener is closed', async () => {
  const w = await world();
  const r = await startClaude({ cwd: w.cwd, prompt: 'x', home: w.home, exe: 'x', launcher, judge: allowAll, extraEnv: { BUNNY_FAKE_SCRIPT: JSON.stringify({ steps: [{ say: 'start' }, { hang: true }] }) } });
  const port = r.bridge.port;
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(await alive(r.pid), true, 'running');
  await r.stop();
  const events = []; for await (const e of r.events) events.push(e);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await alive(r.pid), false, 'killed');
  assert.equal(r.bridge.closed, true);
  assert.equal(stragglers().includes(r.pid), false, 'no straggler is recorded');
  assert.ok(port > 0);
});

test('the prompt is read by the engine from stdin as a stream-json user message (it is not an argument); the home is isolated and the hook and settings are written there each run', async () => {
  const w = await world();
  const { r } = await run(w, { steps: [{ say: 'x' }] });
  void r;
  assert.equal(existsSync(join(w.home, 'hook', 'bunny-pretooluse.cjs')), true);
  const settings = JSON.parse(await readFile(join(w.home, 'bunny-settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings.permissions), ['deny']);
  assert.equal(settings.hooks.PreToolUse[0].matcher, '*');
});
