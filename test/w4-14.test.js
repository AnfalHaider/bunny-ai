/**
 * W4-14: "Bunny was not able to run commands and asked the person to."
 * The model is told what it can do from the tools it is really given; a question that only asks the person to run
 * commands is not shown; Plan mode has a way out (a card only the window can answer, to Ask, never Auto); a Code chat with
 * no folder says so once, with the picker. Scripted provider: it replays the steps and records every request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';
import { asksToRunCommands } from '../src/server/agentTools.js';

const j = { 'content-type': 'application/json' };

/** steps[i] = { name, args } to call a tool on request i, or undefined to just answer "done". */
async function provider(t, steps) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] })); return; }
      seen.push(JSON.parse(raw));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = step
        ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] }
        : { choices: [{ delta: { content: 'done' } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

const toolNames = (body) => (body.tools ?? []).map((d) => d.function.name);
const systemText = (body) => body.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

/** One reply; `answer(event, data, send)` may answer cards. Returns the events. */
async function reply(fx, { mode = 'ask', workMode = 'code', folder = true, content = 'go', answer = null, admin = false } = {}) {
  const { base, app, folderDir } = fx;
  const adminFetch = (path, init) => (admin ? app.adminFetch(path, init) : fetch(`${base}${path}`, init));
  const { body: s } = await post(base, '/api/sessions', { title: 'w414', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => adminFetch(`/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  if (admin && folder === true) await app.chooseFolder(folderDir); // the desktop app only takes a folder the picker chose
  if (folder) await set('folder', folder === true ? folderDir : folder);
  await set('workMode', workMode); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode }) });
  const events = [];
  let buf = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      events.push({ event, data: parsed });
      if (answer) await answer(event, parsed, { adminFetch, sessionId: s.id });
    }
  }
  return { events, sessionId: s.id, adminFetch };
}

async function setup(t, steps, startOptions = {}) {
  const folderDir = await mkdtemp(join(tmpdir(), 'bunny-w414-'));
  t.after(() => rm(folderDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const p = await provider(t, steps);
  const { base, app } = await startApp(t, { fake: false, ...startOptions });
  const connect = startOptions.folderPickerOnly ? app.adminFetch('/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: p.url }) }) : post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: p.url });
  await connect;
  return { base, app, folderDir, seen: p.seen };
}

test('W4-14: the question check catches "run these commands" and leaves real choices alone', () => {
  for (const q of ['Can you run these commands in PowerShell for me?', 'Please paste the output from the terminal', 'Run the following script in your terminal and tell me what it prints']) assert.equal(asksToRunCommands({ question: q }), true, q);
  for (const q of ['Which command should I run?', 'Run the tests now or later?', 'Should I use React or Vue?', 'Where should the project go?']) assert.equal(asksToRunCommands({ question: q }), false, q);
  // QA and Security: a real decision about what Bunny will do is shown, whatever words it uses
  for (const q of ['Should I run the migration command now?', 'I will run the commands now. Do you agree with the plan?', 'Do you want me to run the commands now or review them first?', 'Is it OK if I run the install script?']) assert.equal(asksToRunCommands({ question: q }), false, q);
  for (const q of ['Please run npm install in your terminal and tell me the result', 'You can run these in PowerShell', 'Could you run the script for me?']) assert.equal(asksToRunCommands({ question: q }), true, q);
});

test('W4-14-a: in a Code chat in Plan mode the model is not promised run_command, is not given it, and is told how to leave Plan mode', async (t) => {
  const fx = await setup(t, []);
  await reply(fx, { mode: 'plan', workMode: 'code' });
  const body = fx.seen[0];
  assert.ok(!toolNames(body).includes('run_command'));
  assert.ok(toolNames(body).includes('read_file'));
  const text = systemText(body);
  assert.doesNotMatch(text, /You run commands yourself with run_command/);
  assert.doesNotMatch(text, /never say you are not able to run commands/);
  assert.match(text, /Plan mode/);
  assert.match(text, /leave_plan_mode/);
});

test('W4-14-a: in Ask mode the promise is there and so is the tool', async (t) => {
  const fx = await setup(t, []);
  await reply(fx, { mode: 'ask', workMode: 'code' });
  assert.ok(toolNames(fx.seen[0]).includes('run_command'));
  assert.match(systemText(fx.seen[0]), /You run commands yourself with run_command/);
});

test('W4-14-b: leave_plan_mode is a card; yes moves the chat to Ask (never Auto) and the run tools arrive; only the window can answer', async (t) => {
  const fx = await setup(t, [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'run the setup commands' } }], { folderPickerOnly: true });
  let httpStatus = null;
  const out = await reply(fx, {
    mode: 'plan', workMode: 'code', admin: true,
    answer: async (event, data, { adminFetch, sessionId }) => {
      if (event !== 'capability') return;
      assert.equal(data.capability, 'leave_plan_mode');
      // a program with only the token cannot answer it
      const plain = await fetch(`${fx.base}/api/sessions/${sessionId}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted: true }) });
      httpStatus = plain.status;
      await adminFetch(`/api/sessions/${sessionId}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted: true }) });
    },
  });
  assert.equal(httpStatus, 403);
  assert.ok(out.events.some((e) => e.event === 'capability'));
  const toolMessage = fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.match(toolMessage, /Ask mode/);
  assert.match(toolMessage, /run_command/);
  assert.ok(toolNames(fx.seen[1]).includes('run_command'), 'the run tools are offered in the same reply');
  const saved = await (await fetch(`${fx.base}/api/sessions/${out.sessionId}`)).json();
  assert.equal(saved.permissionMode, 'ask');
});

test('W4-14-b: saying no keeps Plan mode and the model is told', async (t) => {
  const fx = await setup(t, [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'x' } }]);
  const out = await reply(fx, {
    mode: 'plan', workMode: 'code',
    answer: async (event, data, { sessionId }) => {
      if (event === 'capability') await post(fx.base, `/api/sessions/${sessionId}/capability/${data.id}`, { granted: false });
    },
  });
  assert.match(fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content, /said no/);
  assert.ok(!toolNames(fx.seen[1]).includes('run_command'));
  const saved = await (await fetch(`${fx.base}/api/sessions/${out.sessionId}`)).json();
  assert.equal(saved.permissionMode, 'plan');
});

test('W4-14-b: asking to leave Plan mode when not in Plan mode changes nothing', async (t) => {
  const fx = await setup(t, [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'x' } }]);
  const out = await reply(fx, { mode: 'auto', workMode: 'code' });
  assert.ok(!out.events.some((e) => e.event === 'capability'), 'no card');
  assert.match(fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content, /not in Plan mode/);
  const saved = await (await fetch(`${fx.base}/api/sessions/${out.sessionId}`)).json();
  assert.equal(saved.permissionMode, 'auto', 'never moved to Ask or anything else');
});

const ASK = { name: 'ask_user', args: { question: 'Can you run these commands in PowerShell for me?' } };

test('W4-14-c: in Plan mode a "run these commands" question is not shown; the model is told to use leave_plan_mode; the fourth is shown', async (t) => {
  const fx = await setup(t, [ASK, ASK, ASK, ASK]);
  const out = await reply(fx, { mode: 'plan', workMode: 'code', answer: async (event, data, { sessionId }) => {
    if (event === 'question') await post(fx.base, `/api/sessions/${sessionId}/question/${data.id}`, { text: 'ok' });
  } });
  const questions = out.events.filter((e) => e.event === 'question');
  assert.equal(questions.length, 1, 'only the fourth ask is shown');
  assert.match(fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content, /leave_plan_mode/);
});

test('W4-14-c: with the run tools the model is told to run the commands itself', async (t) => {
  const fx = await setup(t, [ASK]);
  const out = await reply(fx, { mode: 'ask', workMode: 'code' });
  assert.equal(out.events.filter((e) => e.event === 'question').length, 0);
  assert.match(fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content, /run them yourself/);
});

test('W4-14-d: in Chat mode the same question is refused and points to code_mode; the capability card follows, without a folder', async (t) => {
  const fx = await setup(t, [ASK, { name: 'request_capability', args: { capability: 'code_mode', reason: 'run the setup' } }]);
  const out = await reply(fx, { mode: 'ask', workMode: 'chat', folder: false, answer: async (event, data, { sessionId }) => {
    if (event === 'capability') await post(fx.base, `/api/sessions/${sessionId}/capability/${data.id}`, { granted: false });
  } });
  assert.equal(out.events.filter((e) => e.event === 'question').length, 0);
  assert.match(fx.seen[1].messages.filter((m) => m.role === 'tool').at(-1).content, /code_mode/);
  const card = out.events.find((e) => e.event === 'capability');
  assert.equal(card.data.capability, 'code_mode');
  assert.equal(card.data.hasFolder, false);
});

test('W4-14-e: a Code chat whose folder is gone makes no promise of run_command and says so once, with the folder picker', async (t) => {
  const fx = await setup(t, []);
  const out = await reply(fx, { mode: 'ask', workMode: 'code', folder: join(tmpdir(), 'bunny-w414-does-not-exist') });
  const text = systemText(fx.seen[0]);
  assert.doesNotMatch(text, /You run commands yourself with run_command/);
  assert.doesNotMatch(text, /never say you are not able to run commands/);
  assert.match(text, /request_capability with code_mode/);
  assert.ok(!toolNames(fx.seen[0]).includes('run_command'));
  const notices = out.events.filter((e) => e.event === 'notice');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].data.folderPicker, true);
});
