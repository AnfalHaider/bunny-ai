import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pcWorld } from './support/pc-world.mjs';
import { parseLabel } from '../src/server/confine.js';

// F13 in the app: "Confine commands" with the stand-in model running run_command in Auto, on invented folders (Windows only). The label card, the confined step, the second command without a card, Deny, the
// "Couldn't confine this command" card for a tampered helper, and Remove the label.
const windows = process.platform === 'win32';
const json = { 'content-type': 'application/json' };
const post = async (base, path, body) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const icacls = (folder) => execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [folder], { encoding: 'utf8', windowsHide: true });
const q = (p) => p.replace(/'/g, "''");

async function world(t, calls, settings = { confineCommands: 'auto', autoJudgeEnabled: false }) {
  const project = mkdtempSync(join(tmpdir(), 'bunny-confrun-project-'));
  const outside = mkdtempSync(join(tmpdir(), 'bunny-confrun-outside-'));
  t.after(() => { rmSync(project, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); rmSync(outside, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });
  const w = await pcWorld(t, { files: {}, settings, calls: typeof calls === 'function' ? calls({ project, outside }) : calls, permissionMode: 'auto' });
  assert.equal((await post(w.base, '/api/folder/check', { folder: project })).status, 200);
  const { body: s } = await post(w.base, '/api/sessions', { title: 'confine', workMode: 'code', folder: project, permissionMode: 'auto' });
  const cards = []; const details = [];
  const say = (content, allow = true) => w.say(content, { sessionId: s.id, extra: { workMode: 'code' }, onEvent: async (event, data, id) => { if (event === 'permission') { cards.push(data.title); details.push(data.detail); await post(w.base, `/api/sessions/${id}/permission/${data.id}`, { allowed: allow }); } } });
  return { w, project, outside, id: s.id, say, cards, details };
}

test('F13 in Auto with "Confine" on: the label card once, the step is marked confined, a write outside the folder is refused, the second command asks nothing, Remove the label puts the folder back', { skip: !windows }, async (t) => {
  const c = await world(t, ({ project, outside }) => [['run_command', { command: `Set-Content -LiteralPath '${q(join(project, 'in.txt'))}' -Value x -ErrorAction Stop; 'wrote inside'; Set-Content -LiteralPath '${q(join(outside, 'out.txt'))}' -Value x -ErrorAction Stop` }], null, ['run_command', { command: "'second'" }], null]);
  const before = icacls(c.project).replace(/\r/g, '');
  const first = await c.say('write two files');
  assert.deepEqual(c.cards.filter((x) => /Confine commands/.test(x)), ['Confine commands to this folder?'], 'the label card, once');
  assert.ok(c.details[0].includes('While the label is on, other low-rights programs on this PC can also write in this folder. Remove the label when you no longer need it.'), 'F13-6: the label card carries the sentence about other low-rights programs');
  assert.ok(existsSync(join(c.project, 'in.txt')), 'the write inside the folder worked');
  assert.equal(existsSync(join(c.outside, 'out.txt')), false, 'the write outside the folder was refused');
  const step = first.events.filter((e) => e.event === 'tool' && e.data.status !== 'running' && e.data.confined);
  assert.ok(step.length >= 1, 'the finished step says it was confined');
  assert.match(c.w.toolAnswers().join('\n'), /denied/i);
  const saved = await (await fetch(`${c.w.base}/api/sessions/${c.id}`)).json();
  assert.ok(saved.messages.some((m) => m.kind === 'tool_call' && m.confined === true), 'the confined mark is saved with the step');
  assert.equal(parseLabel(icacls(c.project)).level, 'Low');
  const settings = await (await fetch(`${c.w.base}/api/settings`)).json();
  assert.equal(settings.confineFolders.length, 1);
  assert.equal(settings.confineFolders[0].before.level, null, 'the folder\'s own label before was recorded (none)');
  const cardsBefore = c.cards.length;
  await c.say('and another');
  assert.equal(c.cards.length, cardsBefore, 'no card for the second command');
  const view = await (await fetch(`${c.w.base}/api/sessions/${c.id}/confine`)).json();
  assert.equal(view.labelled, true); assert.equal(view.mode, 'auto'); assert.equal(view.applies, true);
  assert.ok(view.notCovered.some((x) => /network/.test(x)));
  const removed = await post(c.w.base, `/api/sessions/${c.id}/confine/remove`, {});
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(icacls(c.project).replace(/\r/g, ''), before, 'Remove the label put the folder back exactly');
  assert.equal((await (await fetch(`${c.w.base}/api/settings`)).json()).confineFolders.length, 0);
});

test('F13: Deny on the label card means this chat\'s commands run normally; "off" never asks; a PUT cannot forge a label record', { skip: !windows }, async (t) => {
  const denied = await world(t, ({ outside }) => [['run_command', { command: `Set-Content -LiteralPath '${q(join(outside, 'free.txt'))}' -Value x -ErrorAction Stop; 'wrote'` }]]);
  await denied.say('write outside', false);
  assert.equal(denied.cards.length, 1);
  assert.ok(existsSync(join(denied.outside, 'free.txt')), 'Deny: the command ran normally');
  assert.equal(parseLabel(icacls(denied.project)).level, null, 'and nothing was labelled');
  const off = await world(t, ({ outside }) => [['run_command', { command: `Set-Content -LiteralPath '${q(join(outside, 'free.txt'))}' -Value x; 'wrote'` }]], { confineCommands: 'off', autoJudgeEnabled: false });
  await off.say('write outside');
  assert.equal(off.cards.length, 0); assert.ok(existsSync(join(off.outside, 'free.txt')));
  const bad = await fetch(`${off.w.base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ confineCommands: 'sometimes' }) });
  assert.equal(bad.status, 400);
  await fetch(`${off.w.base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ confineFolders: [{ folder: off.project, before: { level: 'High', flags: '' } }] }) });
  assert.deepEqual((await (await fetch(`${off.w.base}/api/settings`)).json()).confineFolders ?? [], [], 'a PUT cannot write the label records');
});

test('F13-2 in the app: a tampered helper gives the "Couldn\'t confine this command" card, and No means the command is not run', { skip: !windows }, async (t) => {
  const c = await world(t, ({ outside }) => [['run_command', { command: "'warm up'" }], null, ['run_command', { command: `Set-Content -LiteralPath '${q(join(outside, 'x.txt'))}' -Value x; 'wrote'` }], null]);
  await c.say('first'); // the label card and the helper being built
  const exe = join(c.w.dirs.data, 'confine', 'bunny-confine.exe');
  const bytes = readFileSync(exe); bytes[bytes.length - 3] ^= 0xff; writeFileSync(exe, bytes);
  const cardsBefore = c.cards.length;
  await c.say('second', false);
  assert.deepEqual(c.cards.slice(cardsBefore), ["Couldn't confine this command"]);
  assert.equal(existsSync(join(c.outside, 'x.txt')), false, 'No: nothing was run, confined or not');
});

test('F13-4: GET /api/confine returns the one not-covered list that the label card and the Settings help show, with the F13-6 sentence last', async (t) => {
  const { NOT_COVERED } = await import('../src/server/confine.js');
  const w = await pcWorld(t, { files: {}, settings: {}, calls: [], permissionMode: 'auto' });
  const got = await (await fetch(`${w.base}/api/confine`)).json();
  assert.deepEqual(got.notCovered, NOT_COVERED);
  assert.equal(got.notCovered.at(-1), 'While the label is on, other low-rights programs on this PC can also write in this folder. Remove the label when you no longer need it.');
});
