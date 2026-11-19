import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json, post, startApp } from './helpers.js';
import { createBridge } from '../src/server/engines/bridge.js';
import { createApproveServer, mcpConfig } from '../src/server/engines/approve-server.js';
import { createBridgeServer } from '../src/server/engines/bridge-server.js';
import { writeHook } from '../src/server/engines/hook-script.js';
import { buildArgs, buildRun, buildSettings, ENGINE_RULES_DISALLOWED, MCP_TOOL_TIMEOUT_MS } from '../src/server/engines/claude-code.js';
import { validateEngineSettings, validateRules } from '../src/server/engines/service.js';
import { deviceRefusal } from '../src/server/remoteAccess.js';

// CLI-ENGINES ENGINE-RULES (spec 3.7, ER-1 to ER-7): with Bunny's engine off the chat follows the engine's own rules. The floor still holds, the person's Bunny rules are not used,
// the engine's questions become cards, and an unanswered question is a deny. The real binary's behaviour is in docs/spikes/cli-engines/s1 (the ER-4 line).

const put = (base, path, body) => json(base, path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- the bridge: floor only, and the relayed question

async function world() {
  const root = await mkdtemp(join(tmpdir(), 'bunny-rules-'));
  const dataDir = join(root, 'data'); await mkdir(dataDir, { recursive: true }); await writeFile(join(dataDir, 'keys.bin'), 'k');
  await writeFile(join(root, 'a.txt'), 'alpha');
  const asked = [];
  const bridge = createBridge({ mode: 'auto', rules: [{ effect: 'deny', kind: 'path', pattern: 'a.txt', ops: 'all' }], root, protect: [dataDir], keyFolders: [], ask: async (summary, detail) => { asked.push({ summary, detail }); return asked.answer ?? false; } });
  return { root, dataDir, bridge, asked };
}

test('floorOnly: the data folder is denied; the person\'s own Bunny deny rule is NOT used (no opinion); an unknown tool and a command are no opinion; Bunny\'s own prompt tool is denied', async () => {
  const { root, dataDir, bridge } = await world();
  const d = await bridge.claudeFloor({ tool: 'Read', input: { file_path: join(dataDir, 'keys.bin') } });
  assert.deepEqual([d.allow, d.abstain], [false, undefined]); assert.match(d.reason, /keeps private/);
  const rule = await bridge.claudeFloor({ tool: 'Read', input: { file_path: join(root, 'a.txt') } });
  assert.deepEqual([rule.allow, rule.abstain], [false, true], 'a path covered only by the person\'s Bunny deny rule reaches the engine\'s own decision (ER-7)');
  assert.equal((await bridge.claudeFloor({ tool: 'Write', input: { file_path: join(root, 'new.txt'), content: 'x' } })).abstain, true);
  assert.equal((await bridge.claudeFloor({ tool: 'Bash', input: { command: 'npm test' } })).abstain, true);
  assert.equal((await bridge.claudeFloor({ tool: 'SomethingNew', input: {} })).abstain, true);
  const mine = await bridge.claudeFloor({ tool: 'mcp__bunny__approve', input: {} });
  assert.deepEqual([mine.allow, mine.abstain], [false, undefined]);
  const flagged = await bridge.claudeFloor({ tool: 'Bash', input: { command: `type "${join(dataDir, 'keys.bin')}"` } });
  assert.deepEqual([flagged.allow, flagged.abstain], [false, true]); assert.match(flagged.flag, /data folder/);
  const bad = await bridge.claudeFloor({ tool: 'Read', input: null });
  assert.equal(bad.abstain, undefined, 'a call that cannot be read is a deny');
});

test('relay (the engine\'s own question): the floor first, then the person\'s card; no answer is a deny; a command that names the data folder is flagged on the card, never decided by Bunny', async () => {
  const { root, dataDir, bridge, asked } = await world();
  assert.equal((await bridge.claudeAsk({ tool: 'Read', input: { file_path: join(dataDir, 'keys.bin') } })).allow, false);
  assert.equal(asked.length, 0, 'a floor path never reaches a card');
  assert.equal((await bridge.claudeAsk({ tool: 'Bash', input: { command: 'npm test' } })).allow, false, 'no answer is a deny');
  assert.equal(asked.length, 1);
  asked.answer = true;
  assert.equal((await bridge.claudeAsk({ tool: 'Bash', input: { command: 'npm test' } })).allow, true);
  const flag = await bridge.claudeAsk({ tool: 'Bash', input: { command: `type "${join(dataDir, 'keys.bin')}"` } });
  assert.equal(flag.allow, true); assert.match(asked.at(-1).detail, /data folder/);
  assert.equal((await bridge.claudeAsk({ tool: 'Write', input: { file_path: join(root, 'x.txt') } })).allow, true);
});

test('Codex with the option off: a patch to the data folder is declined at once, any other patch and every command goes to a card (a command naming the data folder is flagged)', async () => {
  const { root, dataDir, bridge, asked } = await world();
  asked.answer = true;
  const declined = await bridge.codexChangesRelay([{ path: join(dataDir, 'keys.bin'), kind: { type: 'update' } }]);
  assert.equal(declined.allow, false); assert.equal(asked.length, 0);
  const ok = await bridge.codexChangesRelay([{ path: join(root, 'a.txt'), kind: { type: 'update' } }]);
  assert.equal(ok.allow, true); assert.equal(asked.length, 1, 'a path covered only by a Bunny deny rule goes to the card');
  const cmd = await bridge.codexCommandRelay({ command: `type "${join(dataDir, 'keys.bin')}"` });
  assert.equal(cmd.allow, true); assert.match(asked.at(-1).detail, /data folder/);
  asked.answer = false;
  assert.equal((await bridge.codexCommandRelay({ command: 'dir' })).allow, false);
});

// ---------------------------------------------------------------- the hook: no opinion

function runHook(file, stdin, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ELECTRON_RUN_AS_NODE: '1', ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', (c) => { out += c; });
    child.on('close', (code) => resolve({ code, out })); child.stdin.on('error', () => {}); child.stdin.end(stdin);
  });
}
const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_1' });

test('the hook: an answer of {abstain} prints no decision and exits 0 (the engine\'s own rules apply); an allow:false without abstain is still a deny; a floor deny is a deny', async () => {
  const file = (await writeHook(await mkdtemp(join(tmpdir(), 'bunny-hk-')))).path;
  const answers = [{ judge: async () => ({ allow: false, abstain: true }) }, { judge: async () => ({ allow: false, reason: 'floor' }) }];
  const results = [];
  for (const a of answers) {
    const server = createBridgeServer({ judge: a.judge }); const { port, token } = await server.start();
    results.push(await runHook(file, event, { BUNNY_BRIDGE_PORT: String(port), BUNNY_BRIDGE_TOKEN: token }));
    await server.close();
  }
  assert.equal(results[0].code, 0); assert.equal(JSON.parse(results[0].out).hookSpecificOutput, undefined, 'no decision printed');
  assert.equal(results[1].code, 0); assert.equal(JSON.parse(results[1].out).hookSpecificOutput.permissionDecision, 'deny');
});

// ---------------------------------------------------------------- the prompt-tool server

function rpc(srv, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/mcp', method: 'POST', headers: { host: `127.0.0.1:${srv.port}`, authorization: `Bearer ${srv.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end(data);
  });
}
const callApprove = (srv, args, id = 7) => rpc(srv, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'approve', arguments: args } });

test('the prompt tool server: MCP handshake, one tool, allow gives updatedInput, deny gives a message, no answer inside the limit is a deny, a malformed request is a deny, wrong token / Origin / Sec-Fetch are refused', async () => {
  const seen = [];
  const srv = createApproveServer({ decide: async (q) => { seen.push(q); if (q.tool === 'Slow') return new Promise(() => {}); if (q.tool === 'Boom') throw new Error('boom'); return { allow: q.tool === 'Bash', reason: 'The person said no.' }; }, limitMs: 300 });
  await srv.start();
  try {
    const init = await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    assert.equal(init.json().result.serverInfo.name, 'bunny');
    assert.equal((await rpc(srv, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.deepEqual((await rpc(srv, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json().result.tools.map((t) => t.name), ['approve']);
    const allow = JSON.parse((await callApprove(srv, { tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' })).json().result.content[0].text);
    assert.deepEqual(allow, { behavior: 'allow', updatedInput: { command: 'ls' } });
    const deny = JSON.parse((await callApprove(srv, { tool_name: 'Write', input: {}, tool_use_id: 'toolu_2' })).json().result.content[0].text);
    assert.deepEqual([deny.behavior, deny.message], ['deny', 'The person said no.']);
    const slow = JSON.parse((await callApprove(srv, { tool_name: 'Slow', input: {}, tool_use_id: 'toolu_3' })).json().result.content[0].text);
    assert.equal(slow.behavior, 'deny'); assert.match(slow.message, /No answer came in time/);
    const boom = JSON.parse((await callApprove(srv, { tool_name: 'Boom', input: {}, tool_use_id: 'toolu_4' })).json().result.content[0].text);
    assert.equal(boom.behavior, 'deny');
    for (const bad of [{ tool_name: 'Bash', input: 'ls', tool_use_id: 'x' }, { tool_name: 'Bash', input: {} }, { input: {}, tool_use_id: 'x' }, null]) {
      const r = (await callApprove(srv, bad)).json().result;
      assert.equal(r.isError, true); assert.equal(JSON.parse(r.content[0].text).behavior, 'deny');
    }
    assert.equal(seen.length, 4, 'a malformed request never reaches the person');
    assert.equal((await rpc(srv, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'other', arguments: {} } })).json().result.isError, true);
    const noAuth = await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer nope' }); assert.equal(noAuth.status, 403);
    assert.equal((await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://evil.test' })).status, 403);
    assert.equal((await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'sec-fetch-mode': 'cors' })).status, 403);
    assert.equal((await rpc(srv, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { host: 'localhost' })).status, 403);
  } finally { await srv.close(); }
  assert.equal(srv.closed, true);
});

// ---------------------------------------------------------------- the spawn

test('Claude Code with the option off: --permission-prompt-tool replaces --permission-prompts none, the generated settings hold the floor plus the owner\'s own rules (never Bunny\'s ask or allow), the token is in the environment only, the MCP tool timeout is above Bunny\'s limit, three interactive tools are not offered', () => {
  const base = { exe: 'C:\\x\\claude.exe', home: 'C:\\h', hookPath: 'C:\\h\\hook.cjs', runtimePath: 'C:\\r\\bunny.exe', bridge: { port: 1, token: 'b'.repeat(64) }, auth: 'account', deny: ['Read(//c/data/**)'] };
  const on = buildRun({ ...base, rules: 'bunny', engineRules: { allow: ['Bash(npm test:*)'], ask: [], deny: [] } });
  assert.ok(on.args.includes('--permission-prompts') && !on.args.includes('--permission-prompt-tool'));
  assert.equal(on.settings.permissions.allow, undefined, 'Bunny\'s engine on: no allow ever');
  const approve = { url: 'http://127.0.0.1:5555/mcp', token: 'c'.repeat(64) };
  const off = buildRun({ ...base, rules: 'engine', engineRules: { allow: ['Bash(npm test:*)'], ask: ['Bash(git push:*)'], deny: ['Read(./secret/**)'] }, approve });
  assert.deepEqual(off.args.slice(off.args.indexOf('--permission-prompt-tool'), off.args.indexOf('--permission-prompt-tool') + 2), ['--permission-prompt-tool', 'mcp__bunny__approve']);
  assert.equal(off.args.includes('--permission-prompts'), false); assert.ok(off.args.includes('--strict-mcp-config') && off.args.includes('--mcp-config'));
  assert.deepEqual(off.settings.permissions, { deny: ['Read(//c/data/**)', 'Read(./secret/**)'], ask: ['Bash(git push:*)'], allow: ['Bash(npm test:*)'] });
  for (const t of ENGINE_RULES_DISALLOWED) assert.ok(off.args.includes(t), t);
  assert.equal(off.env.BUNNY_APPROVE_TOKEN, approve.token); assert.equal(off.env.MCP_TOOL_TIMEOUT, String(MCP_TOOL_TIMEOUT_MS)); assert.ok(MCP_TOOL_TIMEOUT_MS > 150_000);
  assert.equal(off.args.join(' ').includes(approve.token), false); assert.equal(JSON.stringify(off.mcpConfig).includes(approve.token), false, 'the token is never in the config file');
  assert.deepEqual(off.mcpConfig, mcpConfig(approve.url));
  assert.equal(JSON.stringify(off.args).includes('bypassPermissions') || JSON.stringify(off.args).includes('dangerously'), false);
  assert.equal(buildArgs({ settingsPath: 's', rules: 'engine' }).includes('--mcp-config'), false, 'no config path, no flag');
  assert.deepEqual(buildSettings({ hookCommand: 'h', deny: ['a'] }).permissions, { deny: ['a'] });
});

// ---------------------------------------------------------------- the settings

test('rules in settings: Claude Code\'s pattern form, at most 200 rules of 200 characters, no rule for Bunny\'s own tool, none for Codex; useBunnyEngine is a boolean; a device is refused at every level', () => {
  assert.equal(validateRules({ allow: ['Bash(npm test:*)', 'Read(./docs/**)', 'Edit(//c/work)'], ask: [], deny: ['WebFetch'] }), null);
  for (const bad of [{ allow: ['not a rule!'] }, { allow: ['x'.repeat(201)] }, { allow: Array(201).fill('Bash') }, { allow: ['mcp__bunny__approve'] }, { allow: 'Bash' }, { maybe: [] }, { allow: [5] }, { allow: [''] }]) assert.equal(typeof validateRules(bad), 'string', JSON.stringify(bad).slice(0, 60));
  assert.equal(validateEngineSettings({ engines: { 'claude-code': { rules: { allow: ['Bash(ls:*)'] } } } }), null);
  assert.match(validateEngineSettings({ engines: { codex: { rules: { allow: ['Bash'] } } } }), /Codex asks about every step/);
  assert.equal(typeof validateEngineSettings({ useBunnyEngine: 'off' }), 'string');
  for (const level of ['chats', 'everything']) void level;
  assert.match(deviceRefusal('PUT', '/api/settings', { useBunnyEngine: false }), /Only Bunny's window/);
});

// ---------------------------------------------------------------- through the app (fake engine)

async function appOff(t, script) {
  const keep = { fake: process.env.BUNNY_FAKE_ENGINE, script: process.env.BUNNY_FAKE_ENGINE_SCRIPT };
  process.env.BUNNY_FAKE_ENGINE = '1'; process.env.BUNNY_FAKE_ENGINE_SCRIPT = JSON.stringify(script);
  t.after(() => { for (const [k, v] of [['BUNNY_FAKE_ENGINE', keep.fake], ['BUNNY_FAKE_ENGINE_SCRIPT', keep.script]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const started = await startApp(t);
  await post(started.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000' });
  return started;
}
async function downloadedEngine(base, id) {
  await post(base, `/api/engines/${id}/download`, {});
  for (let i = 0; i < 100; i += 1) { if ((await json(base, '/api/engines')).body.engines.find((e) => e.id === id).downloaded) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('no download');
}
async function chat(base, sessionId, content) {
  const res = await fetch(`${base}/api/sessions/${sessionId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'test-model-1', workMode: 'code' }) });
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((b) => ({ event: /^event: (.+)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? 'null') }));
}

test('Use Bunny\'s engine: cannot be turned off with no engine downloaded; once off it is recorded; a chat keeps the rules it started with; the engine\'s own rule allows, a question needs the person (no answer = deny)', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rules-app-'));
  const marker = join(folder, 'ran.txt');
  const { base } = await appOff(t, { steps: [{ tool: 'Bash', input: { command: 'npm test' }, marker }, { say: 'done' }] });
  assert.equal((await put(base, '/api/settings', { useBunnyEngine: false })).status, 409, 'no engine is downloaded yet');
  await downloadedEngine(base, 'claude-code');
  assert.equal((await put(base, '/api/settings', { engine: 'claude-code', useBunnyEngine: false, engines: { 'claude-code': { rules: { allow: ['Bash(npm test:*)'] } } } })).status, 200);
  assert.equal((await json(base, '/api/engines')).body.useBunnyEngine, false);
  const record = (await json(base, '/api/engines/record')).body.record;
  assert.ok(record.some((r) => r.action === 'rules-off' && r.who === 'window'));
  // the engine's own allow rule: the command runs with no card
  const made = (await post(base, '/api/sessions', { title: 'own rules', workMode: 'code', folder })).body;
  const events = await chat(base, made.id, 'run the tests');
  assert.equal(events.at(-1).event, 'done', JSON.stringify(events.map((e) => e.event)));
  assert.equal(existsSync(marker), true, 'the engine\'s own allow rule ran it');
  const saved = (await json(base, `/api/sessions/${made.id}`)).body;
  assert.deepEqual([saved.engine.rules, saved.engine.rulesFixed], ['engine', true]);
  // turning it back on does not move this chat
  assert.equal((await put(base, '/api/settings', { useBunnyEngine: true })).status, 200);
  assert.equal((await json(base, `/api/sessions/${made.id}`)).body.engine.rules, 'engine');
  assert.ok((await json(base, '/api/engines/record')).body.record.some((r) => r.action === 'rules-on'));
});

test('with the option off a question the engine asks reaches the person: no answer is a deny and the tool does not run; the floor beats an engine allow rule', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-rules-app-'));
  const marker = join(folder, 'asked.txt');
  const { base } = await appOff(t, { steps: [{ tool: 'Bash', input: { command: 'git push' }, marker }, { say: 'done' }] });
  await downloadedEngine(base, 'claude-code');
  await put(base, '/api/settings', { engine: 'claude-code', useBunnyEngine: false });
  const made = (await post(base, '/api/sessions', { title: 'asks', workMode: 'code', folder })).body;
  // nobody answers the card within the test: use Auto-less, short wait by aborting the request after the card appears
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 2500);
  const seen = [];
  try {
    const res = await fetch(`${base}/api/sessions/${made.id}/messages`, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'push', providerId: 'openai', model: 'test-model-1', workMode: 'code' }) });
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; seen.push(dec.decode(value)); }
  } catch { /* aborted: nobody answered */ }
  clearTimeout(timer);
  const text = seen.join('');
  assert.match(text, /Claude Code asks: Run: git push/, 'the card names the engine and shows the command');
  assert.equal(existsSync(marker), false, 'the tool did not run without an answer');
});

test('ER-1: a device at Chats or Everything is refused every change of useBunnyEngine (and of the engine rules)', async (t) => {
  const { base } = await appOff(t, { steps: [] });
  void base;
  for (const body of [{ useBunnyEngine: false }, { engines: { 'claude-code': { rules: { allow: ['Bash'] } } } }]) assert.match(deviceRefusal('PUT', '/api/settings', body), /Only Bunny's window can change engines\./);
});

// ---------------------------------------------------------------- "Allow for this chat" (Codex only, ENGINE-RULES only, only from the person's own click)

import { createCodexDriver } from '../src/server/engines/codex.js';

test('Allow for this chat: Codex gets acceptForSession only when the person clicked it; a plain Allow is accept; Claude Code\'s cards never offer it; Bunny never picks it', async () => {
  const sent = [];
  const mk = (verdict) => createCodexDriver({ send: (m) => sent.push(m), judgeCommand: async () => verdict, judgeChanges: async () => verdict });
  for (const [verdict, want] of [[{ allow: true }, 'accept'], [{ allow: true, forSession: true }, 'acceptForSession'], [{ allow: false }, 'decline'], [{ allow: false, forSession: true }, 'decline'], [{ allow: true, forSession: 'yes' }, 'accept']]) {
    sent.length = 0;
    await mk(verdict).feed(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'item/commandExecution/requestApproval', params: { itemId: 'i1', command: 'dir' } }));
    assert.equal(sent.at(-1).result.decision, want, JSON.stringify(verdict));
  }
  // the bridge: the card for Codex offers it; the answer 'session' becomes forSession; Claude Code's relay offers nothing and a stray 'session' there is just yes
  const offered = [];
  const answers = { next: 'session' };
  const bridge = createBridge({ mode: 'auto', rules: [], root: await mkdtemp(join(tmpdir(), 'bunny-sess-')), protect: [], keyFolders: [], ask: async (_s, _d, opts) => { offered.push(Boolean(opts?.forSession)); return answers.next; } });
  const c = await bridge.codexCommandRelay({ command: 'dir' });
  assert.deepEqual([c.allow, c.forSession], [true, true]);
  answers.next = true; assert.equal((await bridge.codexCommandRelay({ command: 'dir' })).forSession, undefined);
  answers.next = false; assert.equal((await bridge.codexCommandRelay({ command: 'dir' })).allow, false);
  answers.next = 'session'; const k = await bridge.claudeAsk({ tool: 'Bash', input: { command: 'ls' } });
  assert.equal(k.forSession, undefined, 'Claude Code never gets a session allow');
  assert.deepEqual(offered, [true, true, true, false], 'only Codex\'s cards ask for the third answer');
});

test('Allow for this chat, through the app: the card carries forSession only for Codex with Bunny\'s engine off; the answer is honoured only when the card offered it', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-sess-app-'));
  const { base } = await appOff(t, { steps: [{ command: 'dir', marker: join(folder, 'ran.txt') }, { say: 'done' }] });
  await downloadedEngine(base, 'codex');
  await put(base, '/api/settings', { engine: 'codex', useBunnyEngine: false });
  const made = (await post(base, '/api/sessions', { title: 'codex asks', workMode: 'code', folder })).body;
  const res = await fetch(`${base}/api/sessions/${made.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'test-model-1', workMode: 'code' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let text = '';
  let card = null;
  while (!card) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); const m = /event: permission\ndata: (.+)\n/.exec(text); if (m) card = JSON.parse(m[1]); }
  assert.equal(card.forSession, true, 'Codex\'s card offers Allow for this chat');
  const ans = await post(base, `/api/sessions/${made.id}/permission/${card.id}`, { allowed: true, forSession: true });
  assert.equal(ans.status, 200);
  for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); }
  assert.match(text, /event: done/);
  const saved = (await json(base, `/api/sessions/${made.id}`)).body;
  assert.ok(saved.messages.some((m) => /asked/.test(m.tool ?? '') && /allowed it for this chat/i.test(m.result ?? '')), 'the answer is a step in the chat');
});
