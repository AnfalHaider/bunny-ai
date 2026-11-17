import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

const put = (base, body) => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

/** A model that records what it was sent and answers "ok". */
async function recorder(t, base) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok\nNext one\nAnother idea' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  return seen;
}
const ask = async (base, sid, content) => (await fetch(`${base}/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) })).text();

test('instructions, chat search, helpers, report and unrelated-task settings change what the model gets', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const seen = await recorder(t, base);
  const { body: s } = await post(base, '/api/sessions', { title: 'Wired' });

  await put(base, { instructions: 'Always answer in haiku.' });
  await ask(base, s.id, 'hello');
  let sent = JSON.stringify(seen.at(-1));
  let tools = seen.at(-1).tools.map((d) => d.function.name);
  assert.match(sent, /instructions for every chat:\\nAlways answer in haiku/);
  assert.ok(tools.includes('search_chats') && tools.includes('run_subagent') && tools.includes('move_to_new_chat'));
  assert.match(sent, /Always finish with a short report/);

  await put(base, { searchChats: false, helpersEnabled: false, summaryNextSteps: false, unrelatedTask: 'here' });
  await ask(base, s.id, 'again');
  sent = JSON.stringify(seen.at(-1));
  tools = seen.at(-1).tools.map((d) => d.function.name);
  assert.ok(!tools.includes('search_chats') && !tools.includes('run_subagent') && !tools.includes('move_to_new_chat'));
  assert.doesNotMatch(sent, /Always finish with a short report/);
});

test('the sidebar list carries each chat\'s reply status, cleared once the chat is opened', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await recorder(t, base);
  const { body: s } = await post(base, '/api/sessions', { title: 'Status' });
  await ask(base, s.id, 'hi');
  const rows = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(rows.find((r) => r.id === s.id).replyStatus, 'ready');
  await fetch(`${base}/api/sessions/${s.id}?seen=1`);
  const after = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(after.find((r) => r.id === s.id).replyStatus, undefined);
});

test('prompt suggestions come back as up to three short lines', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await recorder(t, base);
  const { body: s } = await post(base, '/api/sessions', { title: 'Suggest' });
  await ask(base, s.id, 'hi');
  const { body } = await post(base, `/api/sessions/${s.id}/suggest`, { providerId: 'openai', model: 'gpt-4o' });
  assert.deepEqual(body.suggestions, ['ok', 'Next one', 'Another idea']);
});

test('memory from chats: lasting facts are kept, sensitive ones only when allowed; import adds lines', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await recorder(t, base);
  const { body: s } = await post(base, '/api/sessions', { title: 'Memory' });
  await put(base, { autoMemory: true });
  await ask(base, s.id, 'I prefer short answers.');
  let list = await (await fetch(`${base}/api/memory`)).json();
  assert.ok(list.some((m) => /short answers/i.test(m.text) && m.source === 'auto'), JSON.stringify(list));
  const { body: imported } = await post(base, '/api/memory/import', { text: 'Here is what I remember:\n- Works on Bunny AI\n- Prefers TypeScript\n- Works on Bunny AI' });
  assert.equal(imported.added, 2);
  list = await (await fetch(`${base}/api/memory`)).json();
  assert.ok(list.some((m) => m.text === 'Prefers TypeScript' && m.source === 'import'));
});
