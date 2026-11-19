import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, EngineEventError, checkEvent, createEventQueue, cutResult } from '../src/server/engines/events.js';
import { createClaudeReader } from '../src/server/engines/claude-code.js';
import { createCodexDriver, loadSchema } from '../src/server/engines/codex.js';

// CLI-ENGINES §5.2: each adapter's parser gives exactly the expected events; a malformed or over-long line, or an unknown method or event, ends the run; Codex's methods match the pinned schema file.

test('checkEvent accepts every kind of event with the fields it needs and refuses a bad one with a plain sentence', () => {
  const good = [{ type: 'text', delta: 'a' }, { type: 'thinking', delta: 'b' }, { type: 'tool-start', callId: 'c', name: 'read_file', input: {} }, { type: 'tool-end', callId: 'c', ok: true, output: 'x' }, { type: 'approval', requestId: 'r', name: 'run_command' },
    { type: 'question', requestId: 'q', text: 'ok?', options: [] }, { type: 'edit', path: 'a.txt' }, { type: 'usage', input: 1, output: 2 }, { type: 'session', engineSessionId: 's' }, { type: 'done', stopReason: 'end_turn' }, { type: 'error', code: 'x', message: 'm' }];
  assert.deepEqual(good.map((e) => e.type), [...EVENT_TYPES]);
  for (const e of good) assert.equal(checkEvent(e), e);
  for (const bad of [null, [], 'x', {}, { type: 'surprise' }, { type: 'text' }, { type: 'text', delta: 5 }, { type: 'tool-start', name: 'x' }, { type: 'tool-end', callId: 'c' }, { type: 'edit', path: '' }, { type: 'usage', input: 'a', output: 1 }, { type: 'session' }, { type: 'question', requestId: 'q', text: 'x', options: 'no' }]) assert.throws(() => checkEvent(bad), EngineEventError, JSON.stringify(bad));
  assert.equal(cutResult('x'.repeat(2000)).length, 1201);
});

test('the event queue keeps order, ends cleanly, refuses events after the end, and rethrows a failure to the reader', async () => {
  const q = createEventQueue();
  q.push({ type: 'text', delta: 'a' }); q.push({ type: 'text', delta: 'b' }); q.end(); q.push({ type: 'text', delta: 'late' });
  const got = []; for await (const e of q) got.push(e.delta);
  assert.deepEqual(got, ['a', 'b']);
  const f = createEventQueue(); f.push({ type: 'text', delta: 'x' }); f.fail(new Error('boom'));
  const seen = []; await assert.rejects(async () => { for await (const e of f) seen.push(e.delta); }, /boom/);
  assert.deepEqual(seen, ['x']);
  assert.throws(() => createEventQueue().push({ type: 'nope' }), EngineEventError);
});

test('Claude Code reader: a recorded-shape stream gives exactly the expected events; malformed and unknown lines throw', async () => {
  const q = createEventQueue();
  const r = createClaudeReader({ queue: q, bridge: { seen: () => true }, expectedTools: ['Read'] });
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's1', tools: ['Read'] },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'alpha' }] } },
    { type: 'result', subtype: 'success', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } },
  ];
  for (const l of lines) r.feed(JSON.stringify(l));
  r.ended({ code: 0 });
  const got = []; for await (const e of q) got.push(e);
  assert.deepEqual(got.map((e) => e.type), ['session', 'text', 'tool-start', 'tool-end', 'usage', 'done']);
  assert.equal(got.find((e) => e.type === 'tool-start').engineTool, 'Read');
  for (const bad of ['{', '[]', '{"x":1}', '{"type":"mystery"}', 'null']) assert.throws(() => createClaudeReader({ queue: createEventQueue(), bridge: { seen: () => true } }).feed(bad), EngineEventError, bad);
});

test('Codex driver: events match the pinned schema; an unknown notification trips the run and a malformed line throws', async () => {
  const schema = await loadSchema();
  const q = createEventQueue();
  const d = createCodexDriver({ queue: q, schema, send: () => {}, judgeCommand: async () => ({ allow: true }), judgeChanges: async () => ({ allow: true }) });
  await d.feed(JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'i', delta: 'Hi' } }));
  await d.feed(JSON.stringify({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 4, outputTokens: 1 } } } }));
  await d.feed(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { status: 'completed' } } }));
  q.end();
  const got = []; for await (const e of q) got.push(e.type);
  assert.deepEqual(got, ['text', 'usage', 'done']);
  const d2 = createCodexDriver({ queue: createEventQueue(), schema, send: () => {}, judgeCommand: async () => ({ allow: true }), judgeChanges: async () => ({ allow: true }) });
  await d2.feed(JSON.stringify({ jsonrpc: '2.0', method: 'made/up', params: {} }));
  assert.equal(d2.tripped, true);
  for (const bad of ['{', '[]', 'null', '5']) await assert.rejects(() => createCodexDriver({ queue: createEventQueue(), schema, send: () => {} }).feed(bad), EngineEventError, bad);
});
