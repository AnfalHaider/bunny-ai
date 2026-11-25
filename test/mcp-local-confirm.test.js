/**
 * W6-14: a local connector the model proposes is only added after the person confirms the exact command line in the window,
 * in every mode (Auto too), and a program outside the short list is refused before any card is shown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

/** A model that calls add_connector with the arguments in `args`, then says done. */
async function proposer(t, args) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'propose' }] })); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.messages.some((m) => m.role === 'tool')) { res.end(frame({ content: 'done' }) + 'data: [DONE]\n\n'); return; }
      res.end(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_connector', arguments: JSON.stringify(args) } }] }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

async function run(t, mode, args, answer) {
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await proposer(t, args) });
  const { body: s } = await post(base, '/api/sessions', { title: mode, providerId: 'openai', model: 'propose' });
  await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'add a notes connector', providerId: 'openai', model: 'propose', workMode: 'chat' }) });
  const asked = [];
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const part = decoder.decode(chunk, { stream: true });
    text += part;
    for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) {
      const data = JSON.parse(m[1]);
      asked.push(data);
      await post(base, `/api/sessions/${s.id}/permission/${data.id}`, { allowed: answer, ...(data.choices ? { choice: answer ? 'on' : 'no' } : {}) });
    }
  }
  const servers = await (await fetch(`${base}/api/mcp`)).json();
  return { asked, text, servers };
}

// a stand-in that exits at once: a real `npx -y ...` is given up to 5 minutes for its first start (FIRST_START_MS), and with the suites running side by side that held this file's process for minutes (the gate's HUNG report)
const files = { name: 'Notes', command: 'node', args: ['-e', 'process.exit(0)', 'C:\\my notes'] };

for (const mode of ['ask', 'accept', 'auto']) {
  test(`${mode}: a local connector shows the exact command line and is added only after the person allows it`, async (t) => {
    const { asked, servers } = await run(t, mode, files, true);
    assert.equal(asked.length, 1, 'the card was shown, even in Auto');
    assert.equal(asked[0].detail, 'This runs on your computer:\nnode -e process.exit(0) "C:\\\\my notes"', 'the exact command line, the argument with a space quoted');
    assert.equal(servers.length, 1);
    assert.equal(servers[0].type, 'local');
  });
}

test('when the person says no, nothing is added and nothing starts', async (t) => {
  const { asked, servers } = await run(t, 'auto', files, false);
  assert.equal(asked.length, 1);
  assert.deepEqual(servers, []);
});

test('a program outside the short list is refused with no card, and nothing is added', async (t) => {
  const { asked, servers, text } = await run(t, 'auto', { name: 'Evil', command: 'powershell', args: ['-c', 'x'] }, true);
  assert.deepEqual(asked, [], 'no card for a command that is not allowed');
  assert.deepEqual(servers, []);
  assert.match(text, /can only run one of: npx, node, uvx, python, python3, docker/);
});

// W614-1 (Security): the card shows at most 2,000 characters; a longer proposal is refused before any card, in every mode.
for (const mode of ['ask', 'auto']) {
  test(`${mode}: a local connector whose command line is over 2,000 characters is refused, not shown cut`, async (t) => {
    const padded = { name: 'Padded', command: 'node', args: ['-e', 'a'.repeat(900), 'b'.repeat(900), 'c'.repeat(900), 'process.exit(1)'] };
    const { asked, servers, text } = await run(t, mode, padded, true);
    assert.equal(asked.length, 0, 'no card was shown');
    assert.equal(servers.length, 0, 'nothing was added');
    assert.match(text, /too long to show in full/);
  });
}
