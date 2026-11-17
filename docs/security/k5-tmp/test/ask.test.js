import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { cleanQuestion } from '../src/server/agentTools.js';

test('a question keeps six choices, each with its reason, the one recommended first', () => {
  const q = cleanQuestion({ question: ' Which? ', choices: ['a', '', 'b', 'c', { label: 'd', reason: 'fits the plan', recommended: true }, 'e', 'f', 'g'], multiple: true });
  assert.equal(q.question, 'Which?');
  assert.deepEqual(q.choices.map((c) => c.label), ['d', 'a', 'b', 'c', 'e', 'f']);
  assert.deepEqual(q.choices[0], { label: 'd', reason: 'fits the plan', recommended: true });
  assert.equal(q.multiple, true);
  const two = cleanQuestion({ question: 'x', choices: [{ label: 'p', recommended: true }, { label: 'q', recommended: true }] });
  assert.deepEqual(two.choices.map((c) => c.recommended), [true, false], 'only one is recommended');
});

/** The model asks a question, then reports what the tool told it. */
async function askingProvider(t) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const answered = body.messages.find((m) => m.role === 'tool');
      const delta = answered
        ? { content: `got: ${answered.content}` }
        : { tool_calls: [{ index: 0, id: 'q1', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which colour?', choices: [{ label: 'Blue', reason: 'calm' }, { label: 'Green', reason: 'matches the logo', recommended: true }] }) } }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

async function askAndAnswer(t, answer, keep = {}) {
  const { base } = await startApp(t, { fake: false });
  const provider = await askingProvider(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'Ask' });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'paint it', providerId: 'openai', model: 'gpt-4o' }),
  });
  const reader = res.body.getReader();
  let text = '';
  let card = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const m = !card && /event: question\ndata: (.*)\n/.exec(text);
    if (m) {
      card = JSON.parse(m[1]);
      await post(base, `/api/sessions/${session.id}/question/${card.id}`, answer);
    }
  }
  keep.base = base; keep.sessionId = session.id;
  return { card, text, provider };
}

test('the model asks with choices and gets the one the person clicked, in the same reply', async (t) => {
  const { card, text, provider } = await askAndAnswer(t, { choices: ['Green'] });
  assert.equal(card.question, 'Which colour?');
  assert.deepEqual(card.choices.map((c) => [c.label, c.reason, c.recommended]), [['Green', 'matches the logo', true], ['Blue', 'calm', false]]);
  assert.match(text, /got: The person answered: Green/);
  assert.ok(provider.seen[0].tools.some((d) => d.function.name === 'ask_user'));
});

test('a typed answer and a skipped question both reach the model', async (t) => {
  const typed = await askAndAnswer(t, { text: 'Sunset orange, please' });
  assert.match(typed.text, /got: The person answered: Sunset orange, please/);
  const skipped = await askAndAnswer(t, { skipped: true });
  assert.match(skipped.text, /got: The person did not answer\. Carry on with your best judgement/);
});

test('the question, its choices and the answer are kept in the chat', async (t) => {
  const keep = {};
  await askAndAnswer(t, { choices: ['Green'] }, keep);
  const saved = await (await fetch(`${keep.base}/api/sessions/${keep.sessionId}`)).json();
  const step = saved.messages.find((m) => m.question);
  assert.equal(step.question.question, 'Which colour?');
  assert.equal(step.question.answer, 'Green');
  assert.equal(step.question.choices[0].reason, 'matches the logo');
});
