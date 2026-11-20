import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_WINDOW_MARKER, askedToSearch, createAnswerer, searchQueryOf, webCanAnswer } from '../electron/quick-ask-answer.js';

// v0.1.14.1, QUICK ASK: a model that ignores its tools must still get a sourced answer for a web question, and the "needs Bunny's window" card is for local actions only.
const ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** A stand-in for Bunny's server that answers each message request with the next list of events. */
function server(rounds) {
  const calls = [];
  let n = 0;
  const adminFetch = async (path, init = {}) => {
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === '/api/sessions') return new Response(JSON.stringify({ id: ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    const events = rounds[Math.min(n, rounds.length - 1)]; n += 1;
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(e)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { adminFetch, messages: () => calls.filter((c) => c.path.endsWith('/messages')) };
}
const collect = () => { const got = []; return { got, emit: (e) => got.push(e) }; };
const refusal = [frame('delta', { text: `${NEEDS_WINDOW_MARKER}\nI only support web search; open Bunny's full window.` }), frame('done', { model: 'ernie-flash' })];
const answered = [frame('delta', { text: 'Islamabad is 24 °C and clear (weather.example).' }), frame('done', { model: 'ernie-flash', lookups: 1 })];

test('the words: who asked to search, what is a local action, what is searched for', () => {
  assert.equal(askedToSearch('what is the weather like in islamabad today? search the internet'), true);
  assert.equal(askedToSearch('Google it online please'), true);
  assert.equal(askedToSearch('what is the weather like in islamabad today?'), false);
  assert.equal(webCanAnswer('what is the weather like in islamabad today? search the internet'), true);
  assert.equal(webCanAnswer('last month PLS file DHA-2'), false);
  assert.equal(webCanAnswer('delete my downloads folder'), false);
  assert.equal(searchQueryOf('what is the weather like in islamabad today? search the internet'), 'what is the weather like in islamabad today?');
});

test('the owner\'s weather question: the model asks for the window without looking anything up, so Bunny searches the web itself and asks again; the bar gets a restart and then a sourced answer, never the window card', async () => {
  const s = server([refusal, answered]);
  const c = collect();
  await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'what is the weather like in islamabad today? search the internet' });
  const sent = s.messages();
  assert.equal(sent.length, 2, 'one retry');
  assert.equal(sent[0].body.lookupFirst, undefined, 'the first ask is the ordinary one');
  assert.equal(sent[1].body.lookupFirst, true);
  assert.equal(sent[1].body.lookupQuery, 'what is the weather like in islamabad today?');
  assert.equal(sent[1].body.textOnly, true, 'still text only');
  assert.deepEqual(c.got.map((e) => e.type), ['start', 'restart', 'delta', 'done']);
  assert.match(c.got.find((e) => e.type === 'delta').text, /weather\.example/);
  assert.equal(c.got.at(-1).lookups, 1);
  assert.equal(c.got.some((e) => e.type === 'needs-window'), false);
});

test('a model that answers "I cannot search" when the person asked to search the internet gets the same retry, and what it first said is dropped', async () => {
  const s = server([[frame('delta', { text: 'I cannot browse the internet.' }), frame('done', { model: 'm', lookups: 0 })], answered]);
  const c = collect();
  await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'search the web for the latest Node.js release' });
  assert.equal(s.messages().length, 2);
  assert.deepEqual(c.got.map((e) => e.type), ['start', 'delta', 'restart', 'delta', 'done']);
});

test('an answer that did look things up is left alone, and a question that did not ask to search is not searched for', async () => {
  const s1 = server([[frame('delta', { text: 'Done.' }), frame('done', { model: 'm', lookups: 2 })]]);
  await createAnswerer({ adminFetch: s1.adminFetch, emit: () => {} }).ask({ text: 'search the internet for rabbits' });
  assert.equal(s1.messages().length, 1);
  const s2 = server([[frame('delta', { text: 'A rabbit is a mammal.' }), frame('done', { model: 'm', lookups: 0 })]]);
  await createAnswerer({ adminFetch: s2.adminFetch, emit: () => {} }).ask({ text: 'what is a rabbit?' });
  assert.equal(s2.messages().length, 1, 'no look-up forced for an ordinary question');
});

test('a real local action still gets the window card, with no search and no retry', async () => {
  for (const text of ['delete the files in my downloads folder', 'last month PLS file DHA-2', 'run npm test in my project']) {
    const s = server([refusal]);
    const c = collect();
    await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text });
    assert.equal(s.messages().length, 1, text);
    assert.deepEqual(c.got.map((e) => e.type), ['start', 'needs-window'], text);
  }
});

test('if the retry still ends in the marker for a web question, the person gets the model\'s words as an answer, not the window card, and there is only one retry', async () => {
  const s = server([refusal, refusal]);
  const c = collect();
  await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'what is the weather like in islamabad today?' });
  assert.equal(s.messages().length, 2, 'never a third ask');
  assert.deepEqual(c.got.map((e) => e.type), ['start', 'restart', 'delta', 'done']);
  assert.equal(c.got.some((e) => e.type === 'needs-window'), false);
});
