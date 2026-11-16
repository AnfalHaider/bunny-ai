import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

/**
 * Q-2: a link (junction) inside the working folder that points outside it must not let the model write outside,
 * and must not let the Changes, Files or file routes show anything from outside.
 * A scripted model asks to write link/secret.txt; the test then reads every pane route.
 */

const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

async function setup(t) {
  const { base } = await startApp(t, { fake: false });
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw); const done = body.messages.some((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (!done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'link/secret.txt', content: 'OVERWRITTEN-BY-MODEL\n' }) } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  return base;
}

test('a junction inside the folder that points outside: no write outside, no outside text in Changes, Files or file', async (t) => {
  const base = await setup(t);
  const jail = await mkdtemp(join(tmpdir(), 'bunny-q2-jail-'));
  const outside = await mkdtemp(join(tmpdir(), 'bunny-q2-out-'));
  await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE\n');
  await writeFile(join(jail, 'README.md'), '# demo\n');
  try { await symlink(outside, join(jail, 'link'), 'junction'); } catch (e) { t.skip('cannot make a junction here: ' + e.code); return; }

  const { body: s } = await post(base, '/api/sessions', { title: 'escape', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', jail); await set('workMode', 'code'); await set('permissionMode', 'auto');
  await (await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'write it', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) })).text();

  assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'TOP-SECRET-OUTSIDE\n', 'the model overwrote a file outside the folder through the link');
  for (const route of ['changes', 'files', 'file?path=link%2Fsecret.txt', 'files?path=link', 'file?path=..%2F']) {
    const r = await fetch(`${base}/api/sessions/${s.id}/${route}`);
    const text = await r.text();
    assert.ok(!/TOP-SECRET|OVERWRITTEN-BY-MODEL/.test(text), `${route} (${r.status}) shows text from outside the folder: ${text.slice(0, 120)}`);
  }
});
