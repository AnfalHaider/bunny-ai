/**
 * W3-3, the Auto middle way: in Auto mode only three build actions still ask the person
 * (a new tool, a schedule that may change things, a local connector). Everything else runs unasked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { asksInAuto } from '../src/server/autoAsks.js';

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, '..', 'src', 'server', 'app.js'), 'utf8');

test('asksInAuto: the three build actions that still ask in Auto', () => {
  assert.equal(asksInAuto('create_tool', { name: 'x', description: 'y', script: 'z' }), true);
  assert.equal(asksInAuto('create_tool', {}), true);
  assert.equal(asksInAuto('schedule_task', { name: 'n', prompt: 'p', every_minutes: 60, may_change: true }), true);
  assert.equal(asksInAuto('add_connector', { name: 'c', command: 'node', args: ['server.js'] }), true);
});

test('asksInAuto: nothing else asks in Auto', () => {
  assert.equal(asksInAuto(undefined, {}), false, 'no tool name');
  assert.equal(asksInAuto('', {}), false, 'empty tool name');
  assert.equal(asksInAuto(null, undefined), false, 'no name and no args');
  assert.equal(asksInAuto('schedule_task', { name: 'n', prompt: 'p', every_minutes: 60 }), false, 'schedule without may_change');
  assert.equal(asksInAuto('schedule_task', { name: 'n', prompt: 'p', every_minutes: 60, may_change: false }), false, 'schedule with may_change false');
  assert.equal(asksInAuto('add_connector', { name: 'c', url: 'https://example.invalid/mcp' }), false, 'connector with a url only');
  assert.equal(asksInAuto('add_connector', { name: 'c', command: '   ' }), false, 'connector with a blank command');
  assert.equal(asksInAuto('computer_click', { x: 10, y: 20 }), false);
  assert.equal(asksInAuto('computer_type', { text: 'hello' }), false);
  assert.equal(asksInAuto('install_plugin', { id: 'p' }), false);
  assert.equal(asksInAuto('write_file', { path: 'a.txt', content: 'x' }), false);
  assert.equal(asksInAuto('run_command', { command: 'npm test' }), false);
});

test('wiring: every needsOk call in app.js passes the tool name and its arguments', () => {
  const definition = appSource.match(/const needsOk = \(risk, name, args\) => [\s\S]*?;\n/);
  assert.ok(definition, 'needsOk takes (risk, name, args)');
  assert.match(definition[0], /asksInAuto\(name, args\)/);
  assert.match(definition[0], /permissionMode !== 'auto'/);

  const calls = [...appSource.matchAll(/needsOk\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)]
    .filter((m) => !m[0].startsWith('needsOk(risk, name, args)'));
  assert.equal(calls.length, 3, `expected 3 call sites (agent tools, browser, workspace/app tools), found ${calls.length}`);
  for (const m of calls) {
    const args = m[1].split(',').map((s) => s.trim());
    assert.equal(args.length, 3, `call site has ${args.length} arguments: needsOk(${m[1]})`);
    assert.equal(args[1], 'name', `second argument must be name: needsOk(${m[1]})`);
    assert.equal(args[2], 'parsed', `third argument must be the parsed args: needsOk(${m[1]})`);
  }
});
