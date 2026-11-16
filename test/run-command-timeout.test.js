import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, workspaceToolDefinitions, describeToolCall } from '../src/server/workspace.js';

const win = process.platform === 'win32';

test('run_command offers timeout_seconds (1 to 600) and the step line says when it will wait long', () => {
  const def = workspaceToolDefinitions(['run']).find((d) => d.function.name === 'run_command');
  assert.ok(def.function.parameters.properties.timeout_seconds, 'the parameter is offered');
  assert.match(def.function.description, /timeout_seconds, up to 600/);
  assert.equal(describeToolCall('run_command', { command: 'npm install', timeout_seconds: 300 }), 'Run npm install (up to 5 min)');
  assert.equal(describeToolCall('run_command', { command: 'dir' }), 'Run dir');
});

test('a command is stopped at its own limit, and the message says how long and how to ask for more', { skip: !win && 'PowerShell only' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-timeout-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const ws = createWorkspace(folder);
  const started = Date.now();
  const out = await ws.run('run_command', { command: 'Start-Sleep -Seconds 30', timeout_seconds: 2 });
  assert.ok(Date.now() - started < 15_000, 'it did not wait the 30 seconds');
  assert.match(out, /\[stopped after 2 seconds: .*timeout_seconds \(up to 600\)/);
});

test('a countdown is reported while a long command runs, and the output is kept whole for the app to save', { skip: !win && 'PowerShell only' }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-countdown-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const ws = createWorkspace(folder);
  const ticks = [];
  // 80,000 characters of output over about 6 seconds, with a 30 second limit: one countdown line at least.
  const out = await ws.run('run_command', { command: '1..8 | ForEach-Object { Write-Output (\'x\' * 10000); Start-Sleep -Milliseconds 800 }', timeout_seconds: 30 }, { onProgress: (text) => ticks.push(text) });
  assert.ok(ticks.length >= 1 && /^Running… \d+ s of up to 30 s$/.test(ticks[0]), `countdown: ${ticks[0]}`);
  assert.ok(out.length > 79_000, `the whole output comes back to the app (${out.length}), which cuts it for the model and saves the rest`);
});
