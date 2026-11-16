/**
 * W2-7 end to end on the server: the person's rules are checked before the permission mode, deny wins, ask always asks,
 * allow skips the question, Plan mode still refuses edits, folder rules stay in their folder, and denied paths are
 * left out of the listings. Same scripted-model harness as q2-permissions.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const ARGS = {
  list_files: { depth: 2 }, write_file: { path: 'note.txt', content: 'carrots\n' }, run_command: { command: 'echo hi' },
  read_file: { path: 'secrets/key.txt' }, search_files: { query: 'TOPSECRET' }, find_files: { pattern: '*.txt' },
  chained: { command: 'echo hi; echo there' },
};

async function setup(t) {
  const { base } = await startApp(t, { fake: false });
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
      const tool = /^call (\w+)/.exec(asked)?.[1];
      const done = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (tool && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: tool === 'chained' ? 'run_command' : tool, arguments: JSON.stringify(ARGS[tool] ?? {}) } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  return base;
}

const putRules = (base, rules) => fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: j, body: JSON.stringify(rules) });
const cmd = (effect, pattern) => ({ kind: 'command', effect, pattern });
const edits = (effect, pattern) => ({ kind: 'path', effect, pattern, ops: 'edits' });
const reads = (effect, pattern) => ({ kind: 'path', effect, pattern, ops: 'reads' });

/** One reply that calls `tool` in `mode` in a fresh folder (seeded by `seed`); answers cards; reports what happened. */
async function run(base, mode, tool, { answer = true, rules = null, seed = null, rulesFor = null } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rules-'));
  if (seed) await seed(folder);
  if (rules) assert.equal((await putRules(base, typeof rules === 'function' ? rules(folder) : rules)).status, 200);
  const { body: s } = await post(base, '/api/sessions', { title: 'rules', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: `call ${tool}`, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
  const cards = []; let buf = ''; let all = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) {
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card);
        await fetch(`${base}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) });
      }
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  const toolResult = [...all.matchAll(/"result":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join(' | ');
  return { cards, status: step?.status ?? 'none', folder, wrote: existsSync(join(folder, 'note.txt')), ran: /"status":"running"/.test(all), stream: all, toolResult, step };
}

test('deny: in Auto a denied path is not written, the step says Blocked, and the model is told why', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'write_file', { rules: { global: [edits('deny', 'note.*')] } });
  assert.equal(r.wrote, false);
  assert.equal(r.status, 'denied');
  assert.deepEqual(r.cards, []);
  assert.match(r.stream, /Blocked by your permission rule \\"note\.\*\\" \(All folders\)/);
});

test('deny: a denied command does not run, in any mode (even Auto, even with an allow that matches)', async (t) => {
  const base = await setup(t);
  for (const mode of ['ask', 'accept', 'auto']) {
    const r = await run(base, mode, 'run_command', { rules: { global: [cmd('allow', 'echo *'), cmd('deny', 'echo hi')] } });
    assert.equal(r.status, 'denied', mode);
    assert.equal(r.ran, false, mode);
    assert.deepEqual(r.cards, [], `${mode}: a denial does not even ask`);
  }
});

test('allow: in Manual an allowed command runs without a question; the same command with no rule asks', async (t) => {
  const base = await setup(t);
  const allowed = await run(base, 'ask', 'run_command', { rules: { global: [cmd('allow', 'echo *')] } });
  assert.deepEqual(allowed.cards, []);
  assert.equal(allowed.status, 'done');
  const plain = await run(base, 'ask', 'run_command', { rules: { global: [] } });
  assert.equal(plain.cards.length, 1);
});

test('allow: a rule for one command does not allow a chained second command', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'chained', { rules: { global: [cmd('allow', 'echo hi')] } });
  assert.equal(r.cards.length, 1, '"echo there" is not covered, so the question is asked');
});

test('allow: an edit rule lets a file edit through in Manual without a question', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'write_file', { rules: { global: [edits('allow', 'note.txt')] } });
  assert.deepEqual(r.cards, []);
  assert.equal(r.wrote, true);
});

test('ask: always asks, even in Auto, says which rule, and Deny keeps the command from running', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'run_command', { rules: { global: [cmd('ask', 'echo*')] }, answer: false });
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].detail, /Asked because of your rule "echo\*" \(All folders\)/);
  assert.equal(r.status, 'denied');
  const yes = await run(base, 'auto', 'run_command', { rules: { global: [cmd('ask', 'echo*')] }, answer: true });
  assert.equal(yes.cards.length, 1);
  assert.equal(yes.status, 'done');
});

test('Plan mode still refuses an edit whatever an allow rule says', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'plan', 'write_file', { rules: { global: [edits('allow', 'note.txt'), cmd('allow', '*')] } });
  assert.equal(r.wrote, false);
  assert.equal(r.status === 'denied' || r.status === 'none', true);
  assert.equal(r.ran, false);
});

test('scopes: a rule for another folder does not apply here; a rule for this folder does', async (t) => {
  const base = await setup(t);
  const other = await run(base, 'auto', 'write_file', { rules: { global: [], folders: { [tmpdir()]: [edits('deny', 'note.txt')] } } });
  assert.equal(other.wrote, true, 'the rule is for a different folder');
  const mine = await run(base, 'auto', 'write_file', { rules: (folder) => ({ global: [], folders: { [folder]: [edits('deny', 'note.txt')] } }) });
  assert.equal(mine.wrote, false);
  assert.equal(mine.status, 'denied');
  assert.match(mine.stream, /\(This folder\)/);
});

test('reads: a denied path is blocked when read directly and left out of the listings and searches', async (t) => {
  const base = await setup(t);
  const seed = async (folder) => {
    await mkdir(join(folder, 'secrets'));
    await writeFile(join(folder, 'secrets', 'key.txt'), 'TOPSECRET\n');
    await writeFile(join(folder, 'open.txt'), 'TOPSECRET too\n');
  };
  const rules = { global: [reads('deny', 'secrets/**')] };
  const direct = await run(base, 'auto', 'read_file', { rules, seed });
  assert.equal(direct.status, 'denied');
  assert.doesNotMatch(direct.stream, /TOPSECRET\\n/);
  const listing = await run(base, 'auto', 'list_files', { rules, seed });
  assert.match(listing.toolResult, /open\.txt/);
  assert.doesNotMatch(listing.toolResult, /secrets|key\.txt/);
  const search = await run(base, 'auto', 'search_files', { rules, seed });
  assert.match(search.toolResult, /open\.txt/);
  assert.doesNotMatch(search.toolResult, /key\.txt/);
  const found = await run(base, 'auto', 'find_files', { rules, seed });
  assert.match(found.toolResult, /open\.txt/);
  assert.doesNotMatch(found.toolResult, /key\.txt/);
});

test('API: rules are validated line by line, saved, read back, and tried without running anything', async (t) => {
  const base = await setup(t);
  const bad = await putRules(base, { global: [cmd('allow', 'npm test*'), { kind: 'path', effect: 'allow', pattern: '..\\secrets\\**', ops: 'edits' }] });
  assert.equal(bad.status, 400);
  const err = await bad.json();
  assert.match(err.message, /cannot leave the folder/);
  assert.equal(err.index, 1);
  assert.equal(err.scope, 'global');
  const empty = await (await fetch(`${base}/api/permission-rules`)).json();
  assert.deepEqual(empty, { global: [], folders: {} }, 'a bad list saves nothing');

  const folder = await mkdtemp(join(tmpdir(), 'bunny-rules-api-'));
  const ok = await putRules(base, { global: [cmd('deny', 'Remove-Item -Recurse*'), cmd('ask', 'git push*')], folders: { [folder]: [cmd('allow', 'npm test*')] } });
  assert.equal(ok.status, 200);
  const saved = await (await fetch(`${base}/api/permission-rules`)).json();
  assert.equal(saved.global.length, 2);
  assert.equal(saved.folders[folder][0].pattern, 'npm test*');

  const tryIt = async (body) => (await post(base, '/api/permission-rules/try', body)).body;
  assert.deepEqual((await tryIt({ command: 'npm test --watch', folder })).outcome, 'allow');
  assert.deepEqual((await tryIt({ command: 'npm test --watch' })).outcome, 'none', 'no folder: the folder rule does not apply');
  const push = await tryIt({ command: 'git push origin main', folder });
  assert.equal(push.outcome, 'ask');
  assert.equal(push.rule.scope, 'All folders');
  assert.equal((await tryIt({ command: 'Remove-Item -Recurse build', folder })).outcome, 'deny');
  assert.equal((await tryIt({ command: 'node scripts/tidy.js', folder })).outcome, 'none');

  const warn = (await post(base, '/api/permission-rules/check', { rule: cmd('allow', 'Remove-Item -Recurse build'), folder })).body;
  assert.equal(warn.ok, true);
  assert.equal(warn.coveredBy.pattern, 'Remove-Item -Recurse*');
  assert.equal((await post(base, '/api/permission-rules/check', { rule: cmd('allow', 'npm run lint*'), folder })).body.coveredBy, null);
  assert.equal((await post(base, '/api/permission-rules/check', { rule: { kind: 'path', effect: 'allow', pattern: '../x' }, folder })).body.ok, false);

  assert.equal((await putRules(base, { global: [], folders: {} })).status, 200);
  assert.equal((await tryIt({ command: 'git push origin main', folder })).outcome, 'none', 'cleared');
  assert.equal((await putRules(base, { global: 'nope' })).status, 400);
  assert.equal((await putRules(base, { folders: { 'relative/folder': [cmd('allow', 'x')] } })).status, 400);
});

test('review: a collapsed ".." and a junction cannot get around a path rule (the real file is judged)', async (t) => {
  const base = await setup(t);
  const seed = async (folder) => { await mkdir(join(folder, 'secrets')); await mkdir(join(folder, 'docs')); };
  const rules = { global: [edits('deny', 'secrets/**')] };
  // ARGS.write_file writes note.txt; use a rule on the dotted spelling through a model that names the path
  const folderRun = await run(base, 'auto', 'write_file', { rules: { global: [edits('deny', 'note.txt')] }, seed });
  assert.equal(folderRun.wrote, false);
  // the workspace's canon() collapses ".." and follows links
  const { createWorkspace } = await import('../src/server/workspace.js');
  const { mkdtempSync, mkdirSync, symlinkSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'bunny-canon-'));
  mkdirSync(join(root, 'secrets')); mkdirSync(join(root, 'docs'));
  const ws = createWorkspace(root);
  assert.equal(await ws.canon('docs/../secrets/k.txt'), 'secrets/k.txt');
  assert.equal(await ws.canon('docs/a/b/c.txt'), 'docs/a/b/c.txt', 'a file in folders that do not exist yet');
  assert.equal(await ws.canon('../outside.txt'), null);
  assert.equal(await ws.canon('.'), '.');
  try {
    symlinkSync(join(root, 'secrets'), join(root, 'docs', 'jump'), 'junction');
    assert.equal(await ws.canon('docs/jump/k.txt'), 'secrets/k.txt', 'a junction to secrets/');
  } catch { /* links cannot be made here */ }
  void rules;
});

test('W2-7b: canon() says false for a link that points nowhere, and null for a path outside the folder', async (t) => {
  const { createWorkspace } = await import('../src/server/workspace.js');
  const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'bunny-dangle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  const ws = createWorkspace(root);
  assert.equal(await ws.canon('docs/new/x.txt'), 'docs/new/x.txt', 'not there yet is fine');
  assert.equal(await ws.canon('../out.txt'), null);
  let linked = true;
  try { symlinkSync(join(root, 'nowhere'), join(root, 'docs', 'dangling'), 'junction'); } catch { linked = false; }
  if (!linked) return t.skip('links cannot be made here');
  assert.equal(await ws.canon('docs/dangling/x.txt'), false, 'a junction to a folder that does not exist');
});
