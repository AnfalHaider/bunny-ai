import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';

// W6-18: a big tool result is kept whole for the model: saved in .bunny/notes, path and text kept with the step.
test('a large tool result is saved in .bunny/notes and read back by the next turn', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-notes-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'big.txt'), 'row of data\n'.repeat(900)); // ~10,800 characters
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = seen.length === 1
        ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: JSON.stringify({ path: 'big.txt' }) } }] }
        : { content: 'ok' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Notes' });
  const patch = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  await patch('permissionMode', 'auto');
  await patch('folder', folder);
  const send = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }),
  }).then((r) => r.text());
  await send('read the big file');
  const step = (await json(base, `/api/sessions/${session.id}`)).body.messages.find((m) => m.kind === 'tool_call');
  assert.match(step.resultFile ?? '', /^\.bunny\/notes\/step-[a-z0-9-]+\.txt$/);
  assert.ok((await readFile(join(folder, step.resultFile), 'utf8')).length > 6000, 'the whole result is on disk');
  assert.ok(step.result.length <= 1300, 'the chat still shows a short result');
  assert.ok(step.modelResult.length > 3000, 'the model-facing result is far longer than 300');
  await send('now summarise it');
  const sent = JSON.stringify(seen.at(-1).messages);
  assert.match(sent, /full output saved in \.bunny\/notes\/step-/, 'the next turn is told where the whole result is');
  assert.ok((sent.match(/row of data/g) ?? []).length > 100, 'and reads far more than 300 characters of it');
});
