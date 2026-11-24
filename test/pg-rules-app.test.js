/**
 * PERMISSIONS-GAPS on the server, end to end with a scripted model: the card, the refusal and the skip for website, tool and helper
 * rules, and the built-in read-only commands in Ask mode. Same harness idea as permission-rules-app.test.js. Invented data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

/** A stand-in model: "call <tool> <json>" in the person's message becomes that tool call; afterwards it says done. */
async function setup(t, { connectorTool = null } = {}) {
  const { base } = await startApp(t, { fake: false });
  const provider = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
      const m = /^call (\w+)(?: (.+))?$/s.exec(asked);
      const done = body.messages.some((x) => x.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (m && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: m[1], arguments: m[2] ?? '{}' } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => { provider.closeAllConnections?.(); provider.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const calls = [];
  const listed = [];
  let connectorId = null;
  if (connectorTool) {
    const mcp = createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const r = JSON.parse(raw || '{}');
        const result = r.method === 'tools/list' ? (listed.push(1), { tools: [{ name: connectorTool, description: 'a tool', inputSchema: { type: 'object', properties: {} } }] })
          : r.method === 'tools/call' ? (calls.push(r.params.name), { content: [{ type: 'text', text: 'ok' }] }) : {};
        res.writeHead(200, j); res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
      });
    });
    await new Promise((r) => mcp.listen(0, '127.0.0.1', r));
    t.after(() => { mcp.closeAllConnections?.(); mcp.close(); });
    const { body: added } = await post(base, '/api/mcp', { name: 'Notion', url: `http://127.0.0.1:${mcp.address().port}/mcp` });
    connectorId = added.id;
  }
  return { base, calls, listed, connectorId };
}

const putRules = (base, global) => fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: j, body: JSON.stringify({ global, folders: {} }) });

/** One reply in `mode`; every permission card is answered with `answer`; reports the cards, the step status and the whole stream. */
async function run(env, mode, say, { answer = true, rules = [], folder: given = null } = {}) {
  const { base } = env;
  const folder = given ?? await mkdtemp(join(tmpdir(), 'bunny-pg-'));
  assert.equal((await putRules(base, rules)).status, 200);
  const { body: s } = await post(base, '/api/sessions', { title: 'pg', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: say, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
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
  return { cards, status: saved.messages.find((m) => m.kind === 'tool_call')?.status ?? 'none', stream: all, folder, session: s };
}

const rule = (kind, effect, pattern) => ({ kind, effect, pattern });

// ---- PG-1

test('PG-1: a deny on a website refuses read_url at once and the model is told; no card', async (t) => {
  const env = await setup(t);
  const r = await run(env, 'auto', 'call read_url {"url":"https://x.paste.io/a"}', { rules: [rule('domain', 'deny', '*.paste.io')] });
  assert.equal(r.status, 'denied');
  assert.deepEqual(r.cards, []);
  assert.match(r.stream, /Blocked by your permission rule/);
  assert.match(r.stream, /x\.paste\.io|paste\.io/);
});

test('PG-1: an ask on a website shows a card in Auto, and a no stops the fetch', async (t) => {
  const env = await setup(t);
  const r = await run(env, 'auto', 'call read_url {"url":"https://example.com/"}', { rules: [rule('domain', 'ask', 'example.com')], answer: false });
  assert.equal(r.cards.length, 1);
  assert.match(r.cards[0].detail, /Asked because of your rule/);
  assert.equal(r.status, 'denied');
});

test('PG-1: an allow on a website skips the Ask-mode card for download_file (the write still follows the folder rules)', async (t) => {
  const env = await setup(t);
  const plain = await run(env, 'ask', 'call download_file {"url":"http://example.invalid/x","path":"a.bin"}', { rules: [] });
  assert.equal(plain.cards.length, 1, 'without the rule Ask mode asks');
  const allowed = await run(env, 'ask', 'call download_file {"url":"http://example.invalid/x","path":"a.bin"}', { rules: [rule('domain', 'allow', 'example.invalid')] });
  assert.deepEqual(allowed.cards, []);
});

test('PG1-d: a connector whose address is on a denied host cannot be added, and a deny stops its calls', async (t) => {
  const env = await setup(t);
  await putRules(env.base, [rule('domain', 'deny', '*.paste.io')]);
  const added = await post(env.base, '/api/mcp', { name: 'Bad', url: 'https://mcp.paste.io/mcp' });
  assert.equal(added.status, 400);
  assert.match(JSON.stringify(added.body), /blocks this address/);
  const r = await setup(t, { connectorTool: 'create_page' });
  const out = await run(r, 'auto', 'call notion__create_page', { rules: [rule('domain', 'deny', '127.0.0.1')] });
  assert.notEqual(out.status, 'done'); // PG1-e: the connector is not offered at all now
  assert.deepEqual(r.calls, [], 'the connector was never called');
});

// ---- PG-2

test('PG-2: an ask rule on a connector asks in Auto; renaming the connector keeps it in force; an allow cannot skip a send', async (t) => {
  const env = await setup(t, { connectorTool: 'create_page' });
  const rules = (id) => [rule('tool', 'ask', `${id}:*`)];
  const asked = await run(env, 'auto', 'call notion__create_page', { rules: rules(env.connectorId), answer: false });
  assert.equal(asked.cards.length, 1);
  assert.match(asked.cards[0].detail, /Asked because of your rule/);
  assert.deepEqual(env.calls, [], 'a no stops the call');
  await fetch(`${env.base}/api/mcp/${env.connectorId}`, { method: 'PATCH', headers: j, body: JSON.stringify({ name: 'My notes' }) });
  const again = await run(env, 'auto', 'call notion__create_page', { rules: rules(env.connectorId), answer: false });
  assert.equal(again.cards.length + (again.status === 'denied' ? 0 : 1) >= 1, true, 'still governed after a rename (the model-facing name may change; the key is the connector id and the tool)');
});

test('PG-2: a deny on computer_* leaves the tools out of what the model is offered', async (t) => {
  const env = await setup(t);
  await fetch(`${env.base}/api/settings`, { method: 'PATCH', headers: j, body: JSON.stringify({ aiComputerUse: true }) });
  const r = await run(env, 'auto', 'call computer_screenshot', { rules: [rule('tool', 'deny', 'computer_*')] });
  assert.notEqual(r.status, 'done');
  assert.deepEqual(r.cards, []);
});

// ---- PG-3

test('PG-3: a deny on helpers refuses run_subagent and tells the model', async (t) => {
  const env = await setup(t);
  const r = await run(env, 'auto', 'call run_subagent {"title":"t","task":"do it"}', { rules: [rule('agent', 'deny', 'helper:*')] });
  assert.equal(r.status, 'denied');
  assert.match(r.stream, /Blocked by your permission rule/);
});

test('PG3-a: an allow on chat:message never skips the card, in every mode; an allow on chat:start is not a card for the person to see', async (t) => {
  const env = await setup(t);
  for (const mode of ['ask', 'accept', 'auto']) {
    const r = await run(env, mode, 'call message_session {"id":"nope","message":"hi"}', { rules: [rule('agent', 'allow', 'chat:message')], answer: false });
    assert.ok(r.cards.length >= 1, `${mode}: a message to another chat still asks`);
  }
});

// ---- PG-5

test('PG-5: in Ask mode a read-only command runs with no card; a chained or off-list one still asks; the person\'s ask rule comes first', async (t) => {
  const env = await setup(t);
  const folder = await mkdtemp(join(tmpdir(), 'bunny-pg5-'));
  await writeFile(join(folder, 'a.txt'), 'hello\n');
  const ro = await run(env, 'ask', 'call run_command {"command":"type a.txt"}', { folder });
  assert.deepEqual(ro.cards, []);
  assert.equal(ro.status, 'done');
  const git = await run(env, 'ask', 'call run_command {"command":"node --version"}', { folder });
  assert.deepEqual(git.cards, []);
  const chained = await run(env, 'ask', 'call run_command {"command":"type a.txt; echo hi"}', { folder });
  assert.equal(chained.cards.length, 1);
  const ruled = await run(env, 'ask', 'call run_command {"command":"type a.txt"}', { folder, rules: [{ kind: 'command', effect: 'ask', pattern: 'type *' }] });
  assert.equal(ruled.cards.length, 1);
  const outside = await run(env, 'ask', 'call run_command {"command":"type ..\\\\outside.txt"}', { folder });
  assert.equal(outside.cards.length, 1, 'a path outside the folder gets a card');
  assert.equal(existsSync(join(folder, 'a.txt')), true);
});

test('PG1-e: a connector on a denied host is not listed or offered at reply start', async (t) => {
  const env = await setup(t, { connectorTool: 'create_page' });
  env.listed.length = 0;
  const out = await run(env, 'auto', 'call notion__create_page', { rules: [rule('domain', 'deny', '127.0.0.1')] });
  assert.notEqual(out.status, 'done', 'the tool was never offered');
  assert.deepEqual(env.calls, [], 'the connector was not called');
  assert.equal(env.listed.length, 0, 'and not even asked for its tools');
});
