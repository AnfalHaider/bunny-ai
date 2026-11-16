import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** One chat with browser control on; the "window" (this test) answers the screenshot request with a picture. */
async function screenshotChat(t, { vision }) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = seen.length === 1
        ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'browser_screenshot', arguments: '{}' } }] }
        : { content: 'I can see it.' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'Shot' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'auto' }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'look at the page', providerId: 'openai', model: 'gpt-4o', browserControl: true, vision }),
  });
  const reader = res.body.getReader();
  let buffer = '';
  const answered = new Set();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    for (const m of buffer.matchAll(/event: browser\ndata: (.*)\n/g)) {
      const ask = JSON.parse(m[1]);
      if (answered.has(ask.id)) continue;
      answered.add(ask.id);
      await post(base, `/api/sessions/${session.id}/browser/${ask.id}`, { note: 'Screenshot taken.', image: PNG });
    }
  }
  return seen;
}

// W6-20: the picture itself reaches a model that can see.
test('a screenshot of the browser panel is sent to a model that can see', async (t) => {
  const seen = await screenshotChat(t, { vision: true });
  const after = JSON.stringify(seen[1].messages);
  assert.ok(after.includes('"type":"image_url"') && after.includes(PNG.slice(0, 40)), 'the second request carries the picture');
  assert.match(seen[1].messages.find((m) => m.role === 'tool').content, /the picture is attached below/);
});

test('a model that cannot see is told so and gets no picture', async (t) => {
  const seen = await screenshotChat(t, { vision: false });
  assert.ok(!JSON.stringify(seen[1].messages).includes('image_url'));
  assert.match(seen[1].messages.find((m) => m.role === 'tool').content, /cannot see pictures: work from the text/);
});
