/**
 * The agentic surfaces: memory, MCP tools, scheduled tasks, hooks and skills.
 *
 * Each one is checked through the API and, where it matters, through what the
 * model actually receives.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, json, post, patch, put, del, connectProvider } from './helpers.js';

/** A tiny MCP server that answers the two calls the client makes. */
async function startMcpServer({ toolName = 'echo' } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body || '{}');
      seen.push(request);
      const answer = request.method === 'tools/list'
        ? { jsonrpc: '2.0', id: request.id, result: { tools: [{ name: toolName, description: 'Echoes back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } }
        : { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: `echo: ${request.params?.arguments?.text ?? ''}` }] } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

// ---------------------------------------------------------------- memory

test('a memory is remembered, listed and forgotten', async (t) => {
  const { base } = await startApp(t);

  const added = await post(base, '/api/memory', { text: 'I work in London' });
  assert.equal(added.status, 200);
  assert.equal(added.body.text, 'I work in London');
  assert.equal(added.body.enabled, true);

  const { body: list } = await json(base, '/api/memory');
  assert.equal(list.length, 1);

  const off = await patch(base, `/api/memory/${added.body.id}`, { enabled: false });
  assert.equal(off.body.enabled, false);

  const removed = await del(base, `/api/memory/${added.body.id}`);
  assert.equal(removed.body.ok, true);
  const { body: after } = await json(base, '/api/memory');
  assert.equal(after.length, 0);
});

test('an empty memory is refused', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/memory', { text: '   ' });
  assert.equal(status, 400);
  assert.equal(body.code, 'memory.empty');
});

test('a memory reaches the model, and is not stored as a turn', async (t) => {
  // Not fake mode: this test needs the real request path to reach the stub.
  const { base } = await startApp(t, { fake: false });
  const model = await connectProvider(base);
  await post(base, '/api/memory', { text: 'I prefer metric measurements' });

  // A stub provider records what it was sent.
  const seen = [];
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
        return;
      }
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  t.after(() => new Promise((r) => upstream.close(r)));

  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: upstreamUrl });

  const { body: created } = await post(base, '/api/sessions', { title: 'With memory' });
  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'how far is it?', providerId: 'openai', model: 'gpt-4o' }),
  }).then((r) => r.text());

  const sent = JSON.stringify(seen.at(-1));
  assert.match(sent, /I prefer metric measurements/);

  // It was standing context, not a message in the transcript.
  const { body: session } = await json(base, `/api/sessions/${created.id}`);
  assert.equal(session.messages.some((m) => m.content.includes('metric measurements')), false);
});

// ---------------------------------------------------------------- MCP

test('an MCP server needs an http address', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/mcp', { name: 'files', url: 'file:///etc/passwd' });
  assert.equal(status, 400);
  assert.equal(body.code, 'mcp.badUrl');
});

test('an MCP server is added, listed and removed', async (t) => {
  const { base } = await startApp(t);
  const added = await post(base, '/api/mcp', { name: 'files', url: 'http://127.0.0.1:9/mcp' });
  assert.equal(added.status, 200);

  const { body: list } = await json(base, '/api/mcp');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'files');

  const removed = await del(base, `/api/mcp/${added.body.id}`);
  assert.equal(removed.body.ok, true);
});

test('the tools of an MCP server can be listed and called', async (t) => {
  const { base } = await startApp(t);
  const mcp = await startMcpServer({ toolName: 'echo' });
  t.after(() => new Promise((r) => mcp.server.close(r)));

  const added = await post(base, '/api/mcp', { name: 'local', url: mcp.url });
  const { status, body } = await json(base, `/api/mcp/${added.body.id}/tools`);
  assert.equal(status, 200);
  assert.equal(body.status, 'connected');
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, 'echo');

  const called = await post(base, `/api/mcp/${added.body.id}/call`, {
    name: 'echo', arguments: { text: 'hello' },
  });
  assert.equal(called.status, 200);
  assert.match(JSON.stringify(called.body.result), /hello/);
});

test('an MCP server that is not there is reported, not hidden', async (t) => {
  const { base } = await startApp(t);
  const added = await post(base, '/api/mcp', { name: 'gone', url: 'http://127.0.0.1:9/mcp' });
  const { status, body } = await json(base, `/api/mcp/${added.body.id}/tools`);
  assert.equal(status, 502);
  assert.ok(body.message);
});

// ---------------------------------------------------------------- schedules

test('a schedule needs a name and a prompt', async (t) => {
  const { base } = await startApp(t);
  const noName = await post(base, '/api/schedules', { prompt: 'do it' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, 'schedule.nameRequired');

  const noPrompt = await post(base, '/api/schedules', { name: 'daily' });
  assert.equal(noPrompt.status, 400);
  assert.equal(noPrompt.body.code, 'schedule.promptRequired');
});

test('a schedule is added, listed and removed', async (t) => {
  const { base } = await startApp(t);
  const added = await post(base, '/api/schedules', {
    name: 'morning digest', prompt: 'summarise my day', everyMinutes: 60,
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.everyMinutes, 60);

  const { body: list } = await json(base, '/api/schedules');
  assert.equal(list.length, 1);

  const removed = await del(base, `/api/sessions/00000000-0000-0000-0000-000000000000`.replace('sessions', 'schedules').replace('00000000-0000-0000-0000-000000000000', added.body.id));
  assert.equal(removed.body.ok, true);
});

test('a due schedule runs and leaves a chat behind', async (t) => {
  const { app, base } = await startApp(t);
  await connectProvider(base);
  const model = (await json(base, '/api/models')).body[0].id;

  await post(base, '/api/schedules', {
    name: 'hourly check', prompt: 'what is the time', everyMinutes: 1, providerId: 'anthropic', model,
  });

  const results = await app.runDueSchedules();
  assert.equal(results.length, 1);

  const { body: sessions } = await json(base, '/api/sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, 'hourly check');
  assert.equal(sessions[0].messageCount, 2);
});

test('a schedule that has just run is not due again', async (t) => {
  const { app, base } = await startApp(t);
  await connectProvider(base);
  const model = (await json(base, '/api/models')).body[0].id;

  await post(base, '/api/schedules', {
    name: 'hourly check', prompt: 'what is the time', everyMinutes: 60, providerId: 'anthropic', model,
  });
  await app.runDueSchedules();
  assert.equal((await app.runDueSchedules()).length, 0);
});

// ---------------------------------------------------------------- hooks

test('a hook needs a name, a command and a known event', async (t) => {
  const { base } = await startApp(t);
  const noName = await post(base, '/api/hooks', { event: 'message.sent', command: 'echo hi' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, 'hook.nameRequired');

  const badEvent = await post(base, '/api/hooks', { name: 'x', event: 'whenever', command: 'echo hi' });
  assert.equal(badEvent.status, 400);
  assert.equal(badEvent.body.code, 'hook.unknownEvent');
});

test('a hook is off until it is switched on', async (t) => {
  const { base } = await startApp(t);
  const added = await post(base, '/api/hooks', {
    name: 'note', event: 'message.sent', command: 'echo hooked',
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.enabled, false, 'a hook must be switched on deliberately');
});

test('a hook runs when a message is sent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-hook-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, 'hook.txt');

  const { base } = await startApp(t);
  const model = await connectProvider(base);

  const added = await post(base, '/api/hooks', {
    name: 'note', event: 'message.sent', command: `echo %BUNNY_EVENT% > "${marker}"`,
  });
  await patch(base, `/api/hooks/${added.body.id}`, { enabled: true });

  const { body: created } = await post(base, '/api/sessions', { title: 'Hooked' });
  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'anthropic', model }),
  }).then((r) => r.text());

  const written = await readFile(marker, 'utf8').catch(() => '');
  assert.match(written, /message\.sent/);
});

// ---------------------------------------------------------------- skills

test('a skill needs a name and instructions', async (t) => {
  const { base } = await startApp(t);
  const noName = await post(base, '/api/skills', { instructions: 'be brief' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, 'skill.nameRequired');

  const noInstructions = await post(base, '/api/skills', { name: 'brief' });
  assert.equal(noInstructions.status, 400);
  assert.equal(noInstructions.body.code, 'skill.instructionsRequired');
});

test('a skill that is on reaches the model', async (t) => {
  // Not fake mode: this test needs the real request path to reach the stub.
  const { base } = await startApp(t, { fake: false });
  const model = await connectProvider(base);

  const added = await post(base, '/api/skills', {
    name: 'pirate', description: 'talk like a pirate', instructions: 'Answer like a pirate.',
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.enabled, false);

  // Switched off, it is not offered.
  let { body: list } = await json(base, '/api/skills');
  assert.equal(list[0].enabled, false);

  await patch(base, `/api/skills/${added.body.id}`, { enabled: true });
  list = (await json(base, '/api/skills')).body;
  assert.equal(list[0].enabled, true);

  const seen = [];
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
        return;
      }
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  t.after(() => new Promise((r) => upstream.close(r)));
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: upstreamUrl });

  const { body: created } = await post(base, '/api/sessions', { title: 'With a skill' });
  await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }),
  }).then((r) => r.text());

  assert.match(JSON.stringify(seen.at(-1)), /Answer like a pirate/);
});

test('a tool the model asks for is run and the answer comes back', async (t) => {
  const { base } = await startApp(t, { fake: false });

  // An MCP server with one tool.
  const mcp = await startMcpServer({ toolName: 'echo' });
  t.after(() => new Promise((r) => mcp.server.close(r)));
  const added = await post(base, '/api/mcp', { name: 'local', url: mcp.url });
  // Fetching the tools is what makes them known to the model.
  await json(base, `/api/mcp/${added.body.id}/tools`);

  // A provider that asks for the tool, then answers with what it was told.
  let call = 0;
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
        return;
      }
      call += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (call === 1) {
        const frame = {
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'local__echo', arguments: '{"text":"hello"}' } }] } }],
        };
        res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
        return;
      }
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'the tool said hello' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  t.after(() => new Promise((r) => upstream.close(r)));

  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: upstreamUrl });
  const { body: created } = await post(base, '/api/sessions', { title: 'With a tool' });
  const res = await fetch(`${base}/api/sessions/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'use the echo tool', providerId: 'openai', model: 'gpt-4o' }),
  });
  const text = await res.text();

  // The model asked for the tool, the tool ran, and the answer came back.
  assert.match(text, /the tool said hello/);
  assert.equal(call, 2, 'the model should have been asked twice');
  assert.ok(mcp.seen.some((request) => request.method === 'tools/call'), 'the tool should have run');
});

test('memory can be switched off for the whole app', async (t) => {
  const { base } = await startApp(t);
  await post(base, '/api/memory', { text: 'remember this' });
  await put(base, '/api/settings', { memoryEnabled: false });

  const { body: settings } = await json(base, '/api/settings');
  assert.equal(settings.memoryEnabled, false);
});
