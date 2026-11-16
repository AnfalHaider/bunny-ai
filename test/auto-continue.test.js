import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, shrinkConversation } from '../src/server/chat.js';

const sse = (frames) => new Response(new ReadableStream({
  start(c) { const e = new TextEncoder(); for (const f of frames) c.enqueue(e.encode(f)); c.close(); },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const toolFrame = (i, args = '{}') => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${i}`, function: { name: 'look', arguments: args } }] } }] })}\n\ndata: [DONE]\n\n`;
const textFrame = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: [DONE]\n\n`;
const tools = [{ type: 'function', function: { name: 'look', description: 'look', parameters: { type: 'object', properties: {} } } }];
const collect = async (gen) => { let s = ''; for await (const p of gen) s += p; return s; };

// W6-2: the step budget running out mid-task is not the end of the reply.
test('when the step budget runs out the work goes on, up to the cap, and the caller is told', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return sse([n <= 25 ? toolFrame(n) : textFrame('All done.')]); };
  const told = [];
  let limit = 4;
  const out = await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, runTool: async () => 'ok',
    maxToolRounds: () => limit,
    extendRounds: (round) => { if (round >= 100) return false; told.push(round); limit = round + 4; return true; },
  }));
  assert.equal(out, 'All done.', 'it finished the job instead of stopping at four steps');
  assert.ok(told.length >= 6, `extended several times (${told.length})`);
  assert.equal(n, 26);
});

test('the cap holds: past it the model is asked to report, not to go on', async () => {
  let n = 0;
  const seen = [];
  const fetchImpl = async (_u, init) => { n += 1; const b = JSON.parse(init.body); seen.push(b); return sse([b.tools ? toolFrame(n) : textFrame('Stopped at the cap.')]); };
  let limit = 2;
  const out = await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, runTool: async () => 'ok',
    maxToolRounds: () => limit, extendRounds: (round) => { if (round >= 6) return false; limit = round + 2; return true; },
  }));
  assert.equal(out, 'Stopped at the cap.');
  assert.equal(n, 7, 'six steps, then the report');
});

test('Stop ends it: no extension is asked for once the signal is aborted', async () => {
  const ctl = new AbortController();
  let asked = 0;
  const fetchImpl = async () => sse([toolFrame(1)]);
  await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, signal: ctl.signal,
    runTool: async () => { ctl.abort(); return 'ok'; }, maxToolRounds: 1, extendRounds: () => { asked += 1; return true; },
  }));
  assert.equal(asked, 0);
});

// W6-22: old results and big arguments are shortened so a 500-step job fits the window.
test('shrinkConversation keeps the newest whole and shortens older results and big arguments', () => {
  const big = 'z'.repeat(20_000);
  const conv = [{ role: 'user', content: 'go' }];
  for (let i = 0; i < 40; i += 1) {
    conv.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, function: { name: 'write_file', arguments: JSON.stringify({ path: `f${i}.js`, content: big }) } }] });
    conv.push({ role: 'tool', tool_call_id: `c${i}`, content: big });
  }
  const before = JSON.stringify(conv).length;
  assert.equal(shrinkConversation(conv, 100_000), true);
  assert.ok(JSON.stringify(conv).length < before / 4, 'much smaller');
  assert.match(conv[1].tool_calls[0].function.arguments, /left out of the history/);
  assert.ok(JSON.parse(conv[1].tool_calls[0].function.arguments).path === 'f0.js', 'the call is still valid JSON with its path');
  assert.equal(conv.at(-1).content.length, 20_000, 'the newest result is whole');
  assert.equal(shrinkConversation([{ role: 'user', content: 'hi' }], 100_000), false, 'a short conversation is left alone');
});

// Security review of W6-2: limits that ask a person instead of stopping silently, or running on.
test('the same call three times in a row asks; "stop" ends with a report, "keep going" resets', async () => {
  let n = 0;
  const asked = [];
  const fetchImpl = async (_u, init) => { n += 1; const b = JSON.parse(init.body); return sse([b.tools ? toolFrame(n, '{"q":"same"}') : textFrame('Reporting.')]); };
  const out = await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, runTool: async () => 'ok',
    maxToolRounds: 50, onLimit: async (info) => { asked.push(info.kind); return asked.length < 2; },
  }));
  assert.deepEqual(asked, ['repeat', 'repeat'], 'asked at the third repeat, kept going once, asked again, then stopped');
  assert.equal(out, 'Reporting.');
  assert.equal(n, 3 + 3 + 1, 'three steps, three more after "keep going", then the report');
});

test('25 rounds with no new call asks; a job that keeps trying new things never does', async () => {
  let n = 0;
  const kinds = [];
  // Alternating between two calls never repeats three times in a row, but makes no progress either.
  const fetchImpl = async (_u, init) => { n += 1; const b = JSON.parse(init.body); return sse([b.tools ? toolFrame(n, n % 2 ? '{"a":1}' : '{"a":2}') : textFrame('Stopped.')]); };
  await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, runTool: async () => 'ok',
    maxToolRounds: 100, onLimit: async (info) => { kinds.push(info.kind); return false; },
  }));
  assert.deepEqual(kinds, ['stalled']);
  let m = 0;
  const kinds2 = [];
  const fresh = async (_u, init) => { m += 1; const b = JSON.parse(init.body); return sse([b.tools && m <= 40 ? toolFrame(m, `{"i":${m}}`) : textFrame('Done.')]); };
  await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl: fresh, tools, runTool: async () => 'ok',
    maxToolRounds: 100, onLimit: async (info) => { kinds2.push(info.kind); return false; },
  }));
  assert.deepEqual(kinds2, []);
});

test('a token budget asks before it is spent; stopping ends with a report', async () => {
  let n = 0;
  const kinds = [];
  const big = 'x'.repeat(40_000);
  const fetchImpl = async (_u, init) => { n += 1; const b = JSON.parse(init.body); return sse([b.tools ? toolFrame(n, `{"i":${n}}`) : textFrame('Budget report.')]); };
  const out = await collect(streamChat({
    baseUrl: 'http://x/v1', model: 'm', messages: [{ role: 'user', content: 'go' }], fetchImpl, tools, runTool: async () => big,
    maxToolRounds: 100, tokenBudget: 50_000, onLimit: async (info) => { kinds.push(info.kind); return false; },
  }));
  assert.deepEqual(kinds, ['tokens']);
  assert.equal(out, 'Budget report.');
  assert.ok(n <= 8, `stopped within a few rounds (${n})`);
});

test('reply caps: tokens are never 0 (the cost brake); steps and minutes keep 0 = off', async () => {
  const { replyCaps } = await import('../src/server/caps.js');
  const zero = replyCaps({ autoContinueTokens: 0, autoContinueSteps: 0, autoContinueMinutes: 0 }, false);
  assert.equal(zero.tokens, 100_000, 'a stored 0 becomes the smallest budget, not "no limit"');
  assert.equal(zero.steps, 0);
  assert.equal(zero.minutes, 0);
  assert.equal(replyCaps({ autoContinueTokens: -5 }, false).tokens, 100_000);
  assert.equal(replyCaps({ autoContinueTokens: 'lots' }, false).tokens, 5_000_000, 'nonsense is the default');
  assert.equal(replyCaps({ autoContinueTokens: 999_999_999_999 }, false).tokens, 100_000_000);
  assert.deepEqual(replyCaps({}, false), { steps: 500, minutes: 120, tokens: 5_000_000 });
  assert.deepEqual(replyCaps({}, true), { steps: 100, minutes: 30, tokens: 2_000_000 });
  assert.equal(replyCaps({ autoContinueSteps: 99999 }, false).steps, 2000);
});
