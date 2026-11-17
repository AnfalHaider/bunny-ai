import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

// W6-25: a question and a permission prompt are never answered for the person. They wait, the window is nudged after a while (here 120 ms instead of 3 minutes),
// and an answer given after the nudge still goes through.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

async function run(t, toolCall, answerWith) {
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const told = body.messages.find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(told ? { content: `got: ${told.content}` } : { tool_calls: [{ index: 0, id: 'c1', function: toolCall }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false, waitNudgeMs: 120 });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'W625' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'ask' }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const reader = res.body.getReader();
  let text = '';
  let card = null;
  let nudged = false;
  let lateCap = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const m = !card && /event: (question|permission|capability)\ndata: (.*)\n/.exec(text);
    if (m) card = { kind: m[1], ...JSON.parse(m[2]) };
    // a later capability card (add_skill asks whether to switch the new skill on) is answered at once: No
    const cap = card && card.kind === 'permission' && nudged && !lateCap && /event: capability\ndata: (.*)\n/.exec(text);
    if (cap) { lateCap = true; await post(base, `/api/sessions/${session.id}/capability/${JSON.parse(cap[1]).id}`, { granted: false }); }
    if (card && !nudged && /event: waiting\n/.test(text)) {
      nudged = true;
      await new Promise((r) => setTimeout(r, 300)); // well past the nudge: the old timers would have answered by now only in minutes, so this checks the nudge, not the wait
      await post(base, `/api/sessions/${session.id}/${card.kind}/${card.id}`, answerWith);
    }
  }
  return { card, nudged, text };
}

test('W6-25: a question left waiting sends a nudge, is not skipped, and a late answer reaches the model', async (t) => {
  const r = await run(t, { name: 'ask_user', arguments: JSON.stringify({ question: 'Which colour?', choices: [{ label: 'Blue' }, { label: 'Green' }] }) }, { choices: ['Green'] });
  assert.equal(r.card.kind, 'question');
  assert.equal(r.nudged, true, 'the window was nudged');
  assert.match(r.text, /event: waiting\ndata: .*"kind":"question".*Which colour/);
  assert.match(r.text, /got: The person answered: Green/);
});

test('W6-25: a permission prompt left waiting sends a nudge, is not denied, and a late yes runs the tool', async (t) => {
  const r = await run(t, { name: 'add_skill', arguments: JSON.stringify({ name: 'tidy', description: 'd', instructions: 'Keep it tidy.' }) }, { allowed: true });
  assert.equal(r.card.kind, 'permission', 'Manual mode asks before adding a skill');
  assert.equal(r.nudged, true);
  assert.match(r.text, /event: waiting\ndata: .*"kind":"permission"/);
  assert.doesNotMatch(r.text, /did not allow/, 'it was not denied while it waited');
  assert.match(r.text, /got: /);
});
