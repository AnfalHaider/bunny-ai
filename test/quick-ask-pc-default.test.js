import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_WINDOW_MARKER, PC_OFF_TEXT, createAnswerer } from '../electron/quick-ask-answer.js';

// F8: Search this PC is ON when the switch was never written (only a saved false is off). The bar's "files question after a refusal" path must agree.
const ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const refusal = [frame('delta', { text: `${NEEDS_WINDOW_MARKER}\nI only support web search; open Bunny's full window.` }), frame('done', { model: 'm1' })];
const found = [frame('delta', { text: 'I found tax-return-2025.txt in Documents.' }), frame('done', { model: 'm1', lookups: 1 })];

function server(rounds) {
  const calls = [];
  let n = 0;
  const adminFetch = async (path, init = {}) => {
    calls.push(path);
    if (path === '/api/sessions') return new Response(JSON.stringify({ id: ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    const events = rounds[Math.min(n, rounds.length - 1)]; n += 1;
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(e)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { adminFetch, messages: () => calls.filter((p) => p.endsWith('/messages')).length };
}
const shown = (got) => { let t = ''; for (const e of got) { if (e.type === 'restart') t = ''; else if (e.type === 'delta') t += e.text; } return t; };
async function ask(settings) {
  const s = server([refusal, found]);
  const got = [];
  await createAnswerer({ adminFetch: s.adminFetch, emit: (e) => got.push(e), getSettings: () => settings }).ask({ text: 'find my tax returns file' });
  return { s, got };
}

for (const [label, settings] of [['never written', {}], ['true', { pcSearchEnabled: true }]]) {
  test(`pcSearchEnabled ${label}: a files question the model refused is searched, not answered "off"`, async () => {
    const { s, got } = await ask(settings);
    assert.equal(s.messages(), 2, 'it retried with the search');
    assert.notEqual(shown(got), PC_OFF_TEXT);
    assert.notEqual(got.at(-1).own, 'pc-off');
  });
}

test('pcSearchEnabled false: the bar says Search this PC is off and searches nothing', async () => {
  const { s, got } = await ask({ pcSearchEnabled: false });
  assert.equal(s.messages(), 1);
  assert.equal(shown(got), PC_OFF_TEXT);
  assert.equal(got.at(-1).own, 'pc-off');
});
