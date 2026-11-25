import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';

const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const call = (calls) => frame({ tool_calls: calls.map((c, index) => ({ index, id: `c${index}_${Date.now()}`, function: { name: c.name, arguments: JSON.stringify(c.args) } })) });

/** A provider whose answer depends on who is asking: the main chat, a helper, or a chat being messaged. */
async function teamProvider(t, mainScript) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const system = String(body.messages[0]?.content ?? '');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const helper = /You are "([^"]+)", a helper agent/.exec(system);
      if (helper) {
        // A helper: take one look if it has tools, then report.
        const looked = body.messages.some((m) => m.role === 'tool');
        const canLook = (body.tools ?? []).some((d) => d.function.name === 'list_sessions');
        res.end(looked || !canLook ? `${frame({ content: `report from ${helper[1]}` })}data: [DONE]\n\n` : `${call([{ name: 'list_sessions', args: {} }])}data: [DONE]\n\n`);
        return;
      }
      if (/Another chat is sending you a message/.test(system)) {
        const knows = body.messages.some((m) => /carrot/.test(String(m.content)));
        res.end(`${frame({ content: knows ? 'The word is carrot' : 'I do not know' })}data: [DONE]\n\n`);
        return;
      }
      const toolsSoFar = body.messages.filter((m) => m.role === 'tool').length;
      const step = mainScript(toolsSoFar, body);
      res.end(step ? `${call(step)}data: [DONE]\n\n` : `${frame({ content: 'all done' })}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

const send = (base, sid, content) => fetch(`${base}/api/sessions/${sid}/messages`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }),
}).then((r) => r.text());

// PG3-a: a message to another chat speaks for the person, so it asks in every mode, Auto included: this sender says yes to every card
async function sendAnswering(base, sid, content) {
  const res = await fetch(`${base}/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let all = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) await fetch(`${base}/api/sessions/${sid}/permission/${JSON.parse(/^data: (.*)$/m.exec(block)[1]).id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }) });
    }
  }
  return all;
}

test('two helpers run side by side, report back, and are kept as chats nested under this one', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const provider = await teamProvider(t, (toolsSoFar) => (toolsSoFar === 0 ? [
    { name: 'run_subagent', args: { title: 'Alpha', task: 'Look around and report.' } },
    { name: 'run_subagent', args: { title: 'Beta', task: 'Look around too.', read_only: true } },
  ] : null));
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: main } = await post(base, '/api/sessions', { title: 'Lead' });
  await fetch(`${base}/api/sessions/${main.id}/setting/permissionMode`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'auto' }) });

  const stream = await send(base, main.id, 'split this up');
  assert.match(stream, /all done/);
  assert.match(stream, /"tool":"Alpha › List chats"/, 'a helper\'s steps carry its name');

  // The main model got both reports.
  const final = provider.seen.at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.ok(final.some((c) => /report from Alpha/.test(c)), JSON.stringify(final));
  assert.ok(final.some((c) => /report from Beta/.test(c)), JSON.stringify(final));

  // Helpers never get the tools that would reach the person, the screen, or other chats.
  const helperRequest = provider.seen.find((b) => /You are "Beta"/.test(b.messages[0].content));
  const helperTools = (helperRequest.tools ?? []).map((d) => d.function.name);
  for (const never of ['request_capability', 'start_session', 'message_session', 'create_tool']) assert.ok(!helperTools.includes(never), never);

  // Both are nested chats with their task and report; the main chat links to them.
  const { body: all } = await json(base, '/api/sessions');
  const kids = all.filter((s) => s.parentId === main.id);
  assert.deepEqual(kids.map((s) => s.title).sort(), ['Alpha', 'Beta']);
  assert.ok(kids.every((s) => s.agent === 'helper' && s.agentStatus === 'done'));
  const { body: alpha } = await json(base, `/api/sessions/${kids.find((s) => s.title === 'Alpha').id}`);
  assert.equal(alpha.messages[0].content, 'Look around and report.');
  assert.equal(alpha.messages.at(-1).content, 'report from Alpha');
  assert.ok(alpha.messages.some((m) => m.kind === 'tool_call'), 'the helper\'s own steps are kept in its chat');
  const { body: lead } = await json(base, `/api/sessions/${main.id}`);
  assert.deepEqual(lead.messages.filter((m) => m.linked).map((m) => m.linked.title).sort(), ['Alpha', 'Beta']);
});

test('one chat can message another and read it; a background chat works on its own', async (t) => {
  const { base } = await startApp(t, { fake: false });
  let otherId = '';
  const provider = await teamProvider(t, (toolsSoFar, body) => {
    if (!/send it/.test(JSON.stringify(body.messages))) return null;
    return [
      [{ name: 'message_session', args: { session_id: otherId, message: 'What is the secret word?' } }],
      [{ name: 'read_session', args: { session_id: otherId, last: 4 } }],
      [{ name: 'start_session', args: { title: 'Researcher', task: 'Find things out.' } }],
    ][toolsSoFar] ?? null;
  });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: other } = await post(base, '/api/sessions', { title: 'Notes' });
  otherId = other.id;
  await send(base, other.id, 'Remember: the secret word is carrot.');
  const { body: asker } = await post(base, '/api/sessions', { title: 'Asker' });
  await fetch(`${base}/api/sessions/${asker.id}/setting/permissionMode`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'auto' }) });
  await sendAnswering(base, asker.id, 'send it');

  const tools = provider.seen.filter((b) => /send it/.test(JSON.stringify(b.messages)) && !/helper agent/.test(b.messages[0].content))
    .at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(tools[0], /Reply from "Notes":\nThe word is carrot/);
  assert.match(tools[1], /Chat "Notes"[^\n]*\n[\s\S]*Person: Remember: the secret word is carrot/);
  assert.match(tools[1], /Message from the chat "Asker": What is the secret word\?/);
  assert.match(tools[2], /Started the chat "Researcher"/);

  const { body: notes } = await json(base, `/api/sessions/${other.id}`);
  assert.equal(notes.messages.at(-1).content, 'The word is carrot');

  // The background chat finishes by itself, nested under the chat that started it.
  let researcher;
  for (let i = 0; i < 50; i += 1) {
    researcher = (await json(base, '/api/sessions')).body.find((s) => s.title === 'Researcher');
    if (researcher?.agentStatus === 'done') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(researcher.parentId, asker.id);
  assert.equal(researcher.agent, 'chat');
  assert.equal(researcher.agentStatus, 'done');
  const bgRequest = provider.seen.find((b) => /You are "Researcher"/.test(b.messages[0].content));
  assert.ok((bgRequest.tools ?? []).every((d) => !['run_command', 'write_file', 'run_subagent'].includes(d.function.name)), 'background chats only look');
});

test('at most four helpers run at once; the rest wait their turn', async (t) => {
  let inFlight = 0;
  let most = 0;
  let mainCalls = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const helper = /You are "([^"]+)", a helper agent/.exec(body.messages[0].content);
      if (helper) {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 150));
        inFlight -= 1;
        res.end(`${frame({ content: `report from ${helper[1]}` })}data: [DONE]\n\n`);
        return;
      }
      mainCalls += 1;
      res.end(mainCalls === 1
        ? `${call(Array.from({ length: 6 }, (_, i) => ({ name: 'run_subagent', args: { title: `H${i}`, task: 'go' } })))}data: [DONE]\n\n`
        : `${frame({ content: 'all done' })}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: main } = await post(base, '/api/sessions', { title: 'Many' });
  const stream = await send(base, main.id, 'fan out');
  assert.match(stream, /all done/);
  assert.equal(most, 4);
  const kids = (await json(base, '/api/sessions')).body.filter((s) => s.parentId === main.id);
  assert.equal(kids.length, 6);
  assert.ok(kids.every((s) => s.agentStatus === 'done'));
});

test('a helper can run on a different model: named outright, chosen for the job, or the chat model when one fails', async (t) => {
  const seen = [];
  let main = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
      const body = JSON.parse(raw);
      const helper = /You are "([^"]+)", a helper agent/.exec(body.messages[0].content);
      seen.push({ model: body.model, helper: helper?.[1] ?? null });
      if (helper && body.model === 'test-model-1' && helper[1] === 'Broken') { res.writeHead(503).end('{"error":{"message":"overloaded"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (helper) { res.end(`${frame({ content: `report from ${helper[1]} on ${body.model}` })}data: [DONE]\n\n`); return; }
      main += 1;
      res.end(main === 1
        ? `${call([
          { name: 'run_subagent', args: { title: 'Named', task: 'go', model: 'test-model-2' } },
          { name: 'run_subagent', args: { title: 'Broken', task: 'go', model: 'test-model-1' } },
          { name: 'run_subagent', args: { title: 'Same', task: 'go' } },
        ])}data: [DONE]\n\n`
        : `${frame({ content: 'all done' })}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: lead } = await post(base, '/api/sessions', { title: 'Lead' });
  const stream = await send(base, lead.id, 'use models');
  assert.match(stream, /all done/);

  const byHelper = (name) => seen.filter((s) => s.helper === name).map((s) => s.model);
  assert.deepEqual(byHelper('Named'), ['test-model-2'], 'a named model is used');
  assert.deepEqual(byHelper('Broken'), ['test-model-1', 'gpt-4o'], 'a model that fails hands over to the chat model');
  assert.deepEqual(byHelper('Same'), ['gpt-4o'], 'no choice: the chat model');

  const kids = (await json(base, '/api/sessions')).body.filter((s) => s.parentId === lead.id);
  assert.equal(kids.find((s) => s.title === 'Named').model, 'test-model-2');
  assert.equal(kids.find((s) => s.title === 'Broken').model, 'gpt-4o');
  const { body: leadAfter } = await json(base, `/api/sessions/${lead.id}`);
  assert.equal(leadAfter.messages.find((m) => m.linked?.title === 'Named').linked.model, 'test-model-2');
});

test('list_models offers the best models for each kind of work', async (t) => {
  let main = 0;
  let toolAnswer = '';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
      const body = JSON.parse(raw);
      main += 1;
      if (main === 2) toolAnswer = body.messages.find((m) => m.role === 'tool')?.content ?? '';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(main === 1 ? `${call([{ name: 'list_models', args: {} }])}data: [DONE]\n\n` : `${frame({ content: 'ok' })}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelFilter: 'all' }) });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: s } = await post(base, '/api/sessions', { title: 'Models' });
  await send(base, s.id, 'which models?');
  assert.match(toolAnswer, /This chat uses gpt-4o \(openai\)\./);
  assert.match(toolAnswer, /Best for chat: .*test-model-/);
});
