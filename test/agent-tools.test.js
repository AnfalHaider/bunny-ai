import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';
import {
  AGENT_TOOL_RISK, CAPABILITIES, processToolDefinitions, computerToolDefinitions, describeAgentTool, screenLinesText,
} from '../src/server/agentTools.js';
import { createProcessStore } from '../src/server/processes.js';
import { createCustomTools } from '../src/server/customTools.js';
import { streamChat } from '../src/server/chat.js';

const windows = process.platform === 'win32';

test('risk levels: artifacts and asking need no OK, building always asks, programs follow the mode', () => {
  assert.equal(AGENT_TOOL_RISK.create_artifact, 'own');
  assert.equal(AGENT_TOOL_RISK.request_capability, 'own');
  assert.equal(AGENT_TOOL_RISK.create_tool, 'build');
  assert.equal(AGENT_TOOL_RISK.start_process, 'run');
  assert.equal(AGENT_TOOL_RISK.computer_click, 'build');
  assert.deepEqual(processToolDefinitions(['read']).map((d) => d.function.name).sort(), ['list_processes', 'read_process', 'stop_process']);
  assert.deepEqual(computerToolDefinitions(['read']).map((d) => d.function.name), ['computer_screenshot']);
  assert.ok(CAPABILITIES.code_mode && CAPABILITIES.new_tool);
  assert.equal(describeAgentTool('computer_key', { keys: ['ctrl', 's'] }), 'Press ctrl+s');
  assert.equal(describeAgentTool('create_artifact', { title: 'Todo app' }), 'Make artifact "Todo app"');
});

test('screen text is given at the centre of each line, in the pixels of the shown picture', () => {
  const text = screenLinesText([{ text: 'File', x: 100, y: 40, width: 40, height: 20 }], 0.5);
  assert.equal(text, '(60, 25) File');
  assert.equal(screenLinesText([]), 'No text was found on the screen.');
});

test('a started program keeps running, is read in pieces, and stops', { skip: !windows && 'PowerShell only' }, async () => {
  const store = createProcessStore();
  const p = store.start({
    command: 'node -e "console.log(\'ready at http://localhost:4321\'); setInterval(() => {}, 1000)"',
    cwd: process.cwd(), owner: 'chat-1',
  });
  const first = await store.settle(p.id, 'chat-1', 10);
  assert.equal(first.running, true);
  assert.match(first.output, /ready at http:\/\/localhost:4321/);
  assert.equal(store.read(p.id, 'chat-1').output, '', 'nothing new since the last read');
  assert.throws(() => store.read(p.id, 'another-chat'), /No program called/);
  await store.stop(p.id, 'chat-1');
  assert.equal(store.list('chat-1')[0].running, false);
});

test('a built tool is checked, saved, and runs with its arguments', { skip: !windows && 'PowerShell only' }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tools = createCustomTools({ dir });
  assert.throws(() => tools.check({ name: 'Bad Name', script: 'x' }), /lowercase/);
  assert.throws(() => tools.check({ name: 'ok_name', script: '  ' }), /needs a script/);
  await tools.save({ name: 'greet', description: 'Say hello', parameters: { who: 'Who to greet' }, script: 'Write-Output "Hello, $($params.who)!"' });
  assert.equal((await tools.list()).length, 1);
  assert.equal(tools.definitions(await tools.list())[0].function.name, 'my_greet');
  assert.equal(await tools.run('greet', { who: 'Lahore' }), 'Hello, Lahore!');
  await tools.remove('greet');
  assert.equal((await tools.list()).length, 0);
});

test('a tool answer with a picture is shown to the model after the answers', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const frame = bodies.length === 1
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'computer_screenshot', arguments: '{}' } }] } }] }
      : { choices: [{ delta: { content: 'I see a desktop' } }] };
    return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, { status: 200 });
  };
  let out = '';
  for await (const d of streamChat({
    baseUrl: 'http://x', model: 'm', messages: [{ role: 'user', content: 'look' }], fetchImpl,
    tools: [{ type: 'function', function: { name: 'computer_screenshot' } }],
    runTool: async () => ({ content: 'Text on screen: Start', images: ['data:image/png;base64,AAAA'] }),
  })) out += d;
  assert.equal(out, 'I see a desktop');
  const second = bodies[1].messages;
  assert.equal(second.at(-2).role, 'tool');
  assert.equal(second.at(-2).content, 'Text on screen: Start');
  assert.equal(second.at(-1).role, 'user');
  assert.equal(second.at(-1).content[1].image_url.url, 'data:image/png;base64,AAAA');
});

/** A provider that plays a script of tool calls, one per request, then says "done". */
async function scriptedProvider(t, steps) {
  const seen = [];
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
        return;
      }
      seen.push(JSON.parse(body));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = step
        ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] }
        : { choices: [{ delta: { content: 'done' } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => upstream.close(r)));
  return { seen, url: `http://127.0.0.1:${upstream.address().port}/v1` };
}

/** Send a message and read its events as they come; `onEvent` may answer cards. */
async function chat(base, sessionId, content, onEvent = () => {}) {
  const res = await fetch(`${base}/api/sessions/${sessionId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      events.push({ event, data: parsed });
      await onEvent(event, parsed);
    }
  }
  return events;
}

const toolNames = (request) => (request.tools ?? []).map((d) => d.function.name);

test('in Chat mode the model can make an artifact, which opens as a sandboxed page', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const page = '<!doctype html><html><body><h1>Todo</h1><script>document.title="x"</script></body></html>';
  const provider = await scriptedProvider(t, [{ name: 'create_artifact', args: { title: 'Todo app', kind: 'html', content: page } }]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Make a page' });

  const events = await chat(base, session.id, 'make a todo app');
  assert.ok(toolNames(provider.seen[0]).includes('create_artifact'));
  assert.ok(toolNames(provider.seen[0]).includes('request_capability'));
  assert.ok(!toolNames(provider.seen[0]).includes('list_files'), 'no file tools in Chat mode');
  assert.match(JSON.stringify(provider.seen[0].messages[0]), /create_artifact/);
  assert.match(provider.seen[0].messages[0].content, new RegExp(`Today is .*${new Date().getFullYear()}`), 'the model is told the date');

  const made = events.find((e) => e.event === 'tool' && e.data.artifact);
  assert.ok(made, 'the window hears about the artifact');
  assert.equal(made.data.artifact.title, 'Todo app');
  assert.equal(made.data.artifact.kind, 'html');

  const raw = await fetch(`${base}/api/artifacts/${made.data.artifact.id}/raw`);
  assert.match(raw.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.equal(await raw.text(), page);

  // The step is saved with its artifact, so the card comes back when the chat is reopened.
  const { body: saved } = await json(base, `/api/sessions/${session.id}`);
  assert.deepEqual(saved.messages.find((m) => m.kind === 'tool_call').artifact, made.data.artifact);

  // The next message knows the artifact, so it can be updated.
  const later = await scriptedProvider(t, [{ name: 'update_artifact', args: { id: made.data.artifact.id, content: '<h1>Todo v2</h1>' } }]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: later.url });
  await chat(base, session.id, 'make the heading say v2');
  assert.match(JSON.stringify(later.seen[0].messages), new RegExp(made.data.artifact.id));
  const { body: artifact } = await json(base, `/api/artifacts/${made.data.artifact.id}`);
  assert.equal(artifact.versions.length, 2);
});

test('asking for Code mode: the person picks a folder and the file tools arrive in the same reply', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-folder-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const provider = await scriptedProvider(t, [{ name: 'request_capability', args: { capability: 'code_mode', reason: 'To look at your files' } }]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Needs files' });

  let card = null;
  const events = await chat(base, session.id, 'what files do I have?', async (event, data) => {
    if (event !== 'capability') return;
    card = data;
    // What the window does: set the folder, then say yes.
    await fetch(`${base}/api/sessions/${session.id}/setting/folder`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: folder }),
    });
    await post(base, `/api/sessions/${session.id}/capability/${data.id}`, { granted: true });
  });
  assert.equal(card.capability, 'code_mode');
  assert.equal(card.reason, 'To look at your files');
  assert.ok(toolNames(provider.seen[1]).includes('list_files'), 'file tools offered right after the yes');
  assert.ok(toolNames(provider.seen[1]).includes('start_process'));
  assert.match(provider.seen[1].messages.find((m) => m.role === 'tool').content, /Code mode is on/);
  assert.ok(events.some((e) => e.event === 'done'));
  const { body: after } = await json(base, `/api/sessions/${session.id}`);
  assert.equal(after.workMode, 'code');
});

test('a "no" to a capability is final for that reply', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const provider = await scriptedProvider(t, [{ name: 'request_capability', args: { capability: 'computer_use', reason: 'To open Paint' } }]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'No thanks' });
  await chat(base, session.id, 'open paint', async (event, data) => {
    if (event === 'capability') await post(base, `/api/sessions/${session.id}/capability/${data.id}`, { granted: false });
  });
  assert.match(provider.seen[1].messages.find((m) => m.role === 'tool').content, /said no/);
  assert.ok(!toolNames(provider.seen[1]).includes('computer_screenshot'));
  const { body: settings } = await json(base, '/api/settings');
  assert.notEqual(settings.aiComputerUse, true);
});

test('building a tool always asks, even in Auto mode, and the tool is usable at once', { skip: !windows && 'PowerShell only' }, async (t) => {
  const { base } = await startApp(t, { fake: false });
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customToolsEnabled: true }) });
  const provider = await scriptedProvider(t, [
    { name: 'create_tool', args: { name: 'shout', description: 'Upper-case some text', parameters: { text: 'The text' }, script: 'Write-Output $params.text.ToUpper()' } },
    { name: 'my_shout', args: { text: 'bunny' } },
  ]);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Build' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'auto' }),
  });
  const asked = [];
  await chat(base, session.id, 'make a shouting tool and use it', async (event, data) => {
    if (event !== 'permission') return;
    asked.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  assert.equal(asked.length, 1, 'only building asked; running it in Auto did not');
  assert.match(asked[0].title, /Build tool my_shout/);
  assert.match(asked[0].detail, /ToUpper/);
  assert.ok(toolNames(provider.seen[1]).includes('my_shout'));
  assert.equal(provider.seen[2].messages.filter((m) => m.role === 'tool').at(-1).content, 'BUNNY');
  const { body: tools } = await json(base, '/api/tools');
  assert.equal(tools[0].name, 'shout');
});

test('a provider that takes the request and never answers is given up on, not waited on for minutes', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const started = Date.now();
  await assert.rejects(async () => {
    for await (const _ of streamChat({ baseUrl: 'http://x', model: 'm', messages: [], fetchImpl, stallMs: 200 })) { /* nothing arrives */ }
  }, /did not answer in time/);
  assert.ok(Date.now() - started < 3000);
});

test('a reply cut off before any words is asked again with more room, then reported', async () => {
  const limits = [];
  const answer = (frames) => new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });
  const thinkingOnly = { choices: [{ delta: {}, finish_reason: 'length' }] };
  let out = '';
  for await (const d of streamChat({
    baseUrl: 'http://x', model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 2048,
    fetchImpl: async (_u, init) => {
      limits.push(JSON.parse(init.body).max_tokens);
      return limits.length === 1 ? answer([thinkingOnly]) : answer([{ choices: [{ delta: { content: 'Here it is' }, finish_reason: 'stop' }] }]);
    },
  })) out += d;
  assert.equal(out, 'Here it is');
  assert.deepEqual(limits, [2048, 8192]);

  await assert.rejects(async () => {
    for await (const _ of streamChat({ baseUrl: 'http://x', model: 'm', messages: [], fetchImpl: async () => answer([thinkingOnly]) })) { /* none */ }
  }, /used up its whole reply limit/);
  await assert.rejects(async () => {
    for await (const _ of streamChat({ baseUrl: 'http://x', model: 'm', messages: [], fetchImpl: async () => answer([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]) })) { /* none */ }
  }, /empty reply/);
});
