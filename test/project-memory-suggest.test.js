/**
 * PROJECT-CONTEXT: the suggestion card under a reply. Nothing is stored until Keep; Keep stores exactly what was shown (PC-6). Invented profile only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';

async function scripted(t, steps) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

const suggest = (items) => ({ name: 'suggest_project_memory', args: { items } });

async function setup(t, steps, chatExtra = {}) {
  const { base } = await startApp(t, { fake: false });
  const provider = await scripted(t, steps);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const project = (await post(base, '/api/projects', { name: 'Carrot shop' })).body;
  const session = (await post(base, '/api/sessions', { title: 'Chat', projectId: project.id, ...chatExtra })).body;
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) }).then((r) => r.text());
  const card = async () => (await json(base, `/api/sessions/${session.id}`)).body.messages.find((m) => m.suggestion);
  const items = async () => (await json(base, `/api/projects/${project.id}/memory`)).body.items;
  const act = (body) => post(base, `/api/sessions/${session.id}/project-memory`, body);
  return { base, provider, project, session, send, card, items, act };
}

test('a suggestion shows as one card, stores nothing, and Keep stores exactly what was shown; Edit then Keep stores the edit; Discard stores nothing', async (t) => {
  const { send, card, items, act, provider } = await setup(t, [suggest([{ kind: 'decision', text: 'Use tabs, not spaces.' }, { kind: 'convention', text: 'Prices are stored in cents.' }, { kind: 'open', text: 'Sold-out label needs a test.' }]), null]);
  await send('we decided on tabs');
  const c = await card();
  assert.equal(c.suggestion.items.length, 3);
  assert.deepEqual(await items(), [], 'nothing is stored until Keep');
  assert.ok(!JSON.stringify(provider.seen.at(-1).messages).includes('memory_suggestion'), 'the card is never sent back to the model');
  const [a, b, d] = c.suggestion.items;
  const first = await act({ messageId: c.id, itemId: a.id, action: 'keep' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await act({ messageId: c.id, itemId: b.id, action: 'keep', text: 'Prices are stored in whole cents (integers).' });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal((await act({ messageId: c.id, itemId: d.id, action: 'discard' })).status, 200);
  const stored = await items();
  assert.deepEqual(stored.map((m) => m.text).sort(), ['Prices are stored in whole cents (integers).', 'Use tabs, not spaces.']);
  assert.ok(stored.every((m) => m.source === 'suggested'));
  assert.equal((await act({ messageId: c.id, itemId: a.id, action: 'keep' })).status, 409, 'an item is decided once');
});

test('Keep all; more than 5 items are cut to 5; each is at most 400 characters; secret-looking and sensitive items are not shown', async (t) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: 'fact', text: `Fact number ${i} ${'x'.repeat(i === 0 ? 600 : 5)}` }));
  many.push({ kind: 'fact', text: 'The key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' });
  const { send, card, items, act } = await setup(t, [suggest([...many.slice(0, 1), { kind: 'fact', text: 'My password is hunter2' }, ...many.slice(1, 8), many[8]]), null]);
  await send('go');
  const c = await card();
  assert.equal(c.suggestion.items.length, 5);
  assert.ok(c.suggestion.items.every((i) => i.text.length <= 400));
  assert.ok(!JSON.stringify(c).includes('hunter2') && !JSON.stringify(c).includes('sk-ant'));
  assert.equal((await act({ messageId: c.id, action: 'keepAll' })).body.kept, 5);
  assert.equal((await items()).length, 5);
});

test('PC-6: a secret-looking edit is refused at Keep and stores nothing', async (t) => {
  const { send, card, items, act } = await setup(t, [suggest([{ kind: 'fact', text: 'Hosting is a static bucket.' }]), null]);
  await send('go');
  const c = await card();
  const r = await act({ messageId: c.id, itemId: c.suggestion.items[0].id, action: 'keep', text: 'token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'memory.secret');
  assert.deepEqual(await items(), []);
  const long = await act({ messageId: c.id, itemId: c.suggestion.items[0].id, action: 'keep', text: 'y'.repeat(1001) });
  assert.equal(long.status, 400);
});

test('no card in an incognito chat, with project memory switched off, or when the chat has project context off', async (t) => {
  const a = await setup(t, [suggest([{ kind: 'fact', text: 'Anything.' }]), null], { incognito: true });
  await a.send('go');
  assert.equal(await a.card(), undefined);
  const b = await setup(t, [suggest([{ kind: 'fact', text: 'Anything.' }]), null]);
  await fetch(`${b.base}/api/projects/${b.project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ useMemory: false }) });
  await b.send('go');
  assert.equal(await b.card(), undefined);
  assert.ok(!b.provider.seen.some((r) => JSON.stringify(r.tools ?? []).includes('suggest_project_memory')), 'the tool is not even offered');
});
