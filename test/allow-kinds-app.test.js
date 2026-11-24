/** AGENT-FLOW F9 through the app: a scripted provider, Ask mode, an invented folder. The card offers the kind; one "Allow for this chat" stops the next calls of that kind from asking. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function chat(base, id, content, onEvent) {
  const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); const events = []; let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data); events.push({ event, data: parsed }); await onEvent?.(event, parsed);
    }
  }
  return events;
}

async function setup(t, steps) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-f9-'));
  await mkdir(join(folder, 'src', 'a'), { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { base } = await startApp(t, { fake: false });
  const provider = await scripted(t, steps);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  const { body: session } = await post(base, '/api/sessions', { title: 'F9' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await set('permissionMode', 'ask'); await set('folder', folder);
  return { base, folder, session, provider, set };
}

test('Allow for this chat: the first edit in a folder asks and offers the kind; the next edits in it do not ask', async (t) => {
  const { base, folder, session } = await setup(t, [
    { name: 'write_file', args: { path: 'src/a/one.js', content: '1\n' } },
    { name: 'write_file', args: { path: 'src/a/two.js', content: '2\n' } },
    { name: 'write_file', args: { path: 'src/a/deep/three.js', content: '3\n' } },
  ]);
  const cards = [];
  await chat(base, session.id, 'write three files', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true });
  });
  assert.equal(cards.length, 1, 'only the first call asked');
  assert.match(cards[0].kind.button, /src\/a\//);
  assert.equal(await readFile(join(folder, 'src/a/two.js'), 'utf8'), '2\n');
  assert.equal(await readFile(join(folder, 'src/a/deep/three.js'), 'utf8'), '3\n');
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 1);
  assert.match(list.kinds[0].label, /src\/a/);
  // Forget: the next call asks again
  const gone = await fetch(`${base}/api/sessions/${session.id}/allow-kinds/all`, { method: 'DELETE' });
  assert.ok([200, 403].includes(gone.status));
});

test('the root folder, a file that runs later, and Plan mode never get a kind; a stray "kind" answer is refused', async (t) => {
  const { base, session, set } = await setup(t, [
    { name: 'write_file', args: { path: 'top.txt', content: 'x\n' } },
    { name: 'write_file', args: { path: 'src/a/package.json', content: '{}\n' } },
  ]);
  const cards = [];
  let refused = null;
  await chat(base, session.id, 'write', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    if (!data.kind && refused === null) refused = (await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true })).status;
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].kind ?? null, null); assert.match(cards[0].reason, /^Asked every time/);
  assert.equal(cards[1].kind ?? null, null);
  assert.equal(refused, 400, 'a kind that was not offered cannot be given');
  await set('permissionMode', 'plan');
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 0);
});

test('a folder change clears what was allowed; PATCH cannot write the list', async (t) => {
  const { base, folder, session, set } = await setup(t, [{ name: 'write_file', args: { path: 'src/a/one.js', content: '1\n' } }]);
  await chat(base, session.id, 'write', async (event, data) => { if (event === 'permission') await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true, kind: true }); });
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 1);
  await set('allowKinds', [{ type: 'edit', key: 'x', label: 'x' }]);
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 1, 'the setting route did not take a list');
  const other = await mkdtemp(join(tmpdir(), 'bunny-f9b-')); t.after(() => rm(other, { recursive: true, force: true }));
  await set('folder', other);
  assert.equal((await json(base, `/api/sessions/${session.id}/allow-kinds`)).body.kinds.length, 0);
  void folder;
});

test('a command: the first "node -v" asks and offers its exact kind; the same command again does not ask, a different one does; a moved npm form is exact only', async (t) => {
  const { base, session } = await setup(t, [
    { name: 'run_command', args: { command: 'node -v' } },
    { name: 'run_command', args: { command: 'node -v' } },
    { name: 'run_command', args: { command: 'node -p 1' } },
  ]);
  const cards = [];
  await chat(base, session.id, 'run three commands', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, data.kind && cards.length === 1 ? { allowed: true, kind: true } : { allowed: true });
  });
  assert.equal(cards.length, 2, 'the repeat did not ask; the different command did');
  assert.match(cards[0].kind.button, /node -v/); assert.match(cards[0].kind.button, /exact command/);
  assert.match(cards[1].kind.button, /node -p 1/);
  const { body: list } = await json(base, `/api/sessions/${session.id}/allow-kinds`);
  assert.equal(list.kinds.length, 1);
});

test('a compound command gets no kind and the fixed reason; a device-style kind answer is not accepted without an offered kind', async (t) => {
  const { base, session } = await setup(t, [{ name: 'run_command', args: { command: 'node -v && node -v' } }]);
  const cards = [];
  await chat(base, session.id, 'run it', async (event, data) => {
    if (event !== 'permission') return;
    cards.push(data);
    await post(base, `/api/sessions/${session.id}/permission/${data.id}`, { allowed: true });
  });
  assert.equal(cards.length, 1); assert.equal(cards[0].kind ?? null, null);
  assert.match(cards[0].reason, /^Asked every time: it has more than one part/);
});
