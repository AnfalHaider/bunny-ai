import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { WINDOW_ONLY_SETTING_KEYS } from '../src/server/windowOnly.js';

// AGENT-FLOW F11 in the real app: a stand-in provider answers both the chat model and the judge (the judge's request has the judge's system text and no tools); a stand-in connector
// counts what actually ran. Auto with the judge on: allow runs it, block stops it and tells the model, a bad or missing answer is a block or a card, and the judge off changes nothing.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
const isJudge = (body) => String(body.messages?.[0]?.content ?? '').startsWith('You check one action');

async function world(t, { judge, judgeOn = true, judgeStatus = 200, mode = 'auto' }) {
  const seen = [];
  const calls = [];
  const connector = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      const result = r.method === 'tools/list' ? { tools: [{ name: 'deploy', description: 'Deploys it', inputSchema: { type: 'object', properties: { target: { type: 'string' } } }, annotations: { readOnlyHint: false } }] }
        : r.method === 'tools/call' ? (calls.push(r.params.name), { content: [{ type: 'text', text: `ran ${r.params.name}` }] }) : {};
      res.writeHead(200, jsonH);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => connector.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { connector.closeAllConnections?.(); connector.close(r); }));
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      if (isJudge(body)) {
        if (judgeStatus !== 200) { res.writeHead(judgeStatus, jsonH); res.end('{"error":{"message":"down"}}'); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sse({ content: judge(body) }));
        return;
      }
      const told = body.messages.filter((m) => m.role === 'tool');
      const deploy = (body.tools ?? []).find((d) => /deploy/.test(d.function.name));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(told.length ? { content: `told: ${told.at(-1).content}` } : { tool_calls: [{ index: 0, id: 'c1', function: { name: deploy?.function.name ?? 'none', arguments: JSON.stringify({ target: 'production' }) } }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  await post(base, '/api/mcp', { name: 'Ship', url: `http://127.0.0.1:${connector.address().port}/mcp` });
  if (judgeOn) assert.equal((await fetch(`${base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ autoJudgeEnabled: true }) })).status, 200);
  const { body: session } = await post(base, '/api/sessions', { title: 'judge' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: mode }) });
  const say = async (content, { answer = null } = {}) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) });
    const reader = res.body.getReader();
    let text = '';
    let card = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      const m = !card && /event: permission\ndata: (.*)\n/.exec(text);
      if (m) { card = JSON.parse(m[1]); await post(base, `/api/sessions/${session.id}/permission/${card.id}`, { allowed: answer ?? false }); }
    }
    return { text, card };
  };
  return { base, seen, calls, say, session };
}
const judgeRequests = (w) => w.seen.filter(isJudge);

test('Auto with the judge ON: an allow runs the action once, the judge saw only the person\'s words and the fenced call, and the verdict is recorded as a step', async (t) => {
  const w = await world(t, { judge: () => '{"verdict":"allow","reason":"It deploys what you asked for."}' });
  const r = await w.say('deploy it to production');
  assert.deepEqual(w.calls, ['deploy'], 'it ran');
  assert.equal(r.card, null, 'no card');
  assert.equal(judgeRequests(w).length, 1);
  const j = judgeRequests(w)[0];
  assert.equal(j.tools, undefined, 'the judge is offered no tools');
  // the provider's own request may join the two user messages into one (as the chat loop does for consecutive user turns); either way the person's words come first, then the fenced action
  const user = j.messages.filter((m) => m.role === 'user').map((m) => String(m.content)).join(' | ');
  assert.match(user, /deploy it to production/);
  assert.ok(user.indexOf('deploy it to production') < user.indexOf('<action>'), "the person's words, then the action");
  assert.match(user, /<action>\n\{"tool":"ship__deploy","arguments":\{"target":"production"\}/);
  assert.match(r.text, /Checked: Ship: deploy|"tool":"Checked:/);
  assert.match(r.text, /Allowed: It deploys what you asked for\./);
  assert.ok(!JSON.stringify(j.messages).includes('system prompt'), 'nothing of the chat\'s own system text');
});

test('Auto with the judge ON: a block stops it, nothing runs, and the model is told in fixed words', async (t) => {
  const w = await world(t, { judge: () => '{"verdict":"block","reason":"It deploys, which you did not ask for."}' });
  const r = await w.say('look at the project');
  assert.deepEqual(w.calls, [], 'nothing ran');
  assert.equal(r.card, null);
  const told = w.seen.filter((b) => !isJudge(b)).at(-1).messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.equal(told, "Bunny's check stopped this: It deploys, which you did not ask for. Find a safer way, or ask the person with ask_user.");
});

test('a judge answer that is not the form is a block', async (t) => {
  const w = await world(t, { judge: () => '```json\n{"verdict":"allow","reason":"ok"}\n```' });
  await w.say('deploy it');
  assert.deepEqual(w.calls, []);
});

test('the judge cannot be reached: Auto falls back to a card, and a yes runs it; a no does not', async (t) => {
  const yes = await world(t, { judge: () => '', judgeStatus: 500 });
  const r = await yes.say('deploy it', { answer: true });
  assert.ok(r.card, 'a card was asked');
  assert.match(r.card.detail, /could not reach the model that checks actions/);
  assert.deepEqual(yes.calls, ['deploy']);
  const no = await world(t, { judge: () => '', judgeStatus: 500 });
  await no.say('deploy it', { answer: false });
  assert.deepEqual(no.calls, []);
});

test('with the judge OFF (the default) Auto runs it as before: no judge request is made', async (t) => {
  const w = await world(t, { judge: () => 'never', judgeOn: false });
  const r = await w.say('deploy it');
  assert.deepEqual(w.calls, ['deploy']);
  assert.equal(r.card, null);
  assert.equal(judgeRequests(w).length, 0);
});

test('outside Auto the judge is not used: Ask mode still shows its card for the same action', async (t) => {
  const w = await world(t, { judge: () => '{"verdict":"allow","reason":"ok"}', mode: 'ask' });
  const r = await w.say('deploy it', { answer: true });
  assert.ok(r.card);
  assert.equal(judgeRequests(w).length, 0);
});

test('the two settings are window-only keys, validated, and a bad value is refused', async (t) => {
  assert.ok(WINDOW_ONLY_SETTING_KEYS.includes('autoJudgeEnabled') && WINDOW_ONLY_SETTING_KEYS.includes('autoJudgeModel'));
  const w = await world(t, { judge: () => '', judgeOn: false });
  const put = (body) => fetch(`${w.base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify(body) });
  assert.equal((await put({ autoJudgeEnabled: 'yes' })).status, 400);
  assert.equal((await put({ autoJudgeModel: 'not a model id with spaces' })).status, 400);
  assert.equal((await put({ autoJudgeModel: 'openai/gpt-4o-mini' })).status, 200);
  assert.equal((await put({ autoJudgeModel: '' })).status, 200);
});
