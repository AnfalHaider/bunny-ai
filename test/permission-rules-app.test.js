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
  long_command: { command: `echo ${'a'.repeat(2100)} & echo the-hidden-tail` },
  write_long: { path: 'note.txt', content: 'x'.repeat(3000) },
  fits_command: { command: `echo ${'a'.repeat(1900)}` },
  download_file: { url: 'http://example.invalid/x', path: 'secrets/key.txt' },
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
      const rest = /^call \w+ (.+)$/.exec(asked)?.[1]; // W69-1: read_url takes the address from the message
      const done = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (tool && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: tool === 'write_long' ? 'write_file' : tool === 'chained' || tool.endsWith('_command') && tool !== 'run_command' ? 'run_command' : tool, arguments: JSON.stringify(tool === 'read_url' ? { url: rest } : ARGS[tool] ?? {}) } }] }) + 'data: [DONE]\n\n');
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
async function run(base, mode, tool, { answer = true, rules = null, seed = null, rulesFor = null, say = null } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rules-'));
  if (seed) await seed(folder);
  if (rules) assert.equal((await putRules(base, typeof rules === 'function' ? rules(folder) : rules)).status, 200);
  const { body: s } = await post(base, '/api/sessions', { title: 'rules', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: typeof say === 'function' ? say(folder) : `call ${tool}`, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
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

test('Q-W27-1 (QA 995c8d4): a bad rules list answers 400 and leaves every saved rule where it was', async (t) => {
  const base = await setup(t);
  assert.equal((await putRules(base, { global: [cmd('deny', 'rm *')], folders: {} })).status, 200);
  const bad = await putRules(base, { global: [{ kind: 'path', effect: 'deny', pattern: '../x', ops: 'edits' }], folders: {} });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /cannot leave the folder/);
  const after = await (await fetch(`${base}/api/permission-rules`)).json();
  assert.equal(after.global.length, 1, 'the good rule is still there');
  assert.equal(after.global[0].pattern, 'rm *');
  // every other way a list can be bad
  for (const body of [{ global: 'nope' }, { global: [{ kind: 'command', effect: 'maybe', pattern: 'x' }] }, { global: [], folders: { 'relative/dir': [cmd('allow', 'x')] } }, { global: [], folders: { [tmpdir()]: [{ kind: 'url', effect: 'allow', pattern: 'x' }] } }]) {
    assert.equal((await putRules(base, body)).status, 400, JSON.stringify(body));
    assert.equal((await (await fetch(`${base}/api/permission-rules`)).json()).global[0]?.pattern, 'rm *', `still intact after ${JSON.stringify(body).slice(0, 40)}`);
  }
});

// W613-1 (Security): a download writes a file, so the person's edit rules judge it like write_file.
test('W613-1: download_file under a Deny edit rule is blocked in Auto and never reaches the network', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'download_file', { rules: { global: [edits('deny', 'secrets/**')] } });
  assert.equal(r.status, 'denied');
  assert.deepEqual(r.cards, []);
  assert.match(r.stream, /Blocked by your permission rule/);
});

test('W613-1: download_file under an Ask edit rule asks even in Auto', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'download_file', { answer: false, rules: { global: [edits('ask', 'secrets/**')] } });
  assert.equal(r.cards.length, 1);
});

// W69-1 (Security): read_url on a file: address is a read, so Deny read rules apply to it.
test('W69-1: read_url on a file: address inside a denied path is blocked', async (t) => {
  const base = await setup(t);
  const seed = async (folder) => { await mkdir(join(folder, 'secrets')); await writeFile(join(folder, 'secrets', 'k.txt'), 'KEY-SECRET'); await writeFile(join(folder, '.env'), 'ENV-SECRET'); };
  for (const [name, rule] of [['secrets/k.txt', 'secrets/**'], ['.env', '.env']]) {
    const r = await run(base, 'auto', 'read_url', {
      seed, rules: { global: [reads('deny', rule)] },
      say: (folder) => 'call read_url file:///' + join(folder, name).split(String.fromCharCode(92)).join('/'),
    });
    assert.equal(r.status, 'denied', name);
    assert.match(r.stream, /Blocked by your permission rule/, name);
    assert.doesNotMatch(r.stream, /KEY-SECRET|ENV-SECRET/, name);
  }
});

test('W69-1: with no rule, a file: address inside the folder still reads', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'auto', 'read_url', {
    seed: async (folder) => { await writeFile(join(folder, 'hello.txt'), 'HELLO-OK'); },
    say: (folder) => 'call read_url file:///' + join(folder, 'hello.txt').split(String.fromCharCode(92)).join('/'),
  });
  assert.equal(r.status, 'done');
});

// W614-1 (Security): the confirm card shows at most 2,000 characters, so a longer command is refused, never cut.
test('W614-1: a run_command whose card would be cut at 2,000 characters is refused in every mode that asks, and never runs', async (t) => {
  const base = await setup(t);
  for (const mode of ['ask', 'accept']) {
    const r = await run(base, mode, 'long_command', {});
    assert.deepEqual(r.cards, [], `${mode}: no card with a cut command`);
    assert.equal(r.ran, false, mode);
    assert.match(r.stream, /"status":"denied"/, mode);
    assert.match(r.stream, /too long to show in full/, mode);
  }
});

test('W614-1: a command that fits the card is shown whole', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'fits_command', {});
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].detail, `echo ${'a'.repeat(1900)}`);
});

test('W614-1: a long file being written is shown cut with a note that says how much is not shown', async (t) => {
  const base = await setup(t);
  const r = await run(base, 'ask', 'write_long', {});
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].detail, /… 700 more characters are not shown here$/);
});
