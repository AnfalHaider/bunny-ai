import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readUrl } from '../src/server/pluginImport.js';
import { startApp, post } from './helpers.js';

// WEB-ACCESS (Security): read_url, now also offered in Quick ask, reads public addresses only, like download_file.
const json = { 'content-type': 'application/json' };

test('read_url refuses this computer, private networks, the cloud metadata address and Bunny\'s own server, by number or by name', async (t) => {
  const secret = createServer((_req, res) => { res.end('SECRET ON THIS COMPUTER'); });
  await new Promise((r) => secret.listen(0, '127.0.0.1', r));
  t.after(() => secret.close());
  const port = secret.address().port;
  for (const url of [
    `http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`, `http://0.0.0.0:${port}/`,
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.9/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://[fe80::1]/',
  ]) {
    await assert.rejects(() => readUrl(url), (err) => !/SECRET/.test(err.message) && /private network|this computer|own server|Could not read|find the host/i.test(err.message), url);
  }
});

test('the old stand-in path still works for tests, and a page that is not http(s) is refused', async () => {
  const text = await readUrl('https://example.com/x', { fetchImpl: async () => ({ ok: true, text: async () => '<html><body><p>Hello &amp; welcome</p></body></html>' }) });
  assert.equal(text, 'Hello & welcome');
  await assert.rejects(() => readUrl('file:///C:/secret.txt'), /http or https/);
});

test('Quick ask: a quick answer may look things up five times and no more, and a model that reads this computer gets a refusal, not the page', async (t) => {
  const secret = createServer((_req, res) => { res.end('SECRET ON THIS COMPUTER'); });
  await new Promise((r) => secret.listen(0, '127.0.0.1', r));
  t.after(() => secret.close());
  const { base } = await startApp(t, { fake: false });
  const requests = [];
  const upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })); }
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const calls = requests.length <= 7
        ? [{ index: 0, id: `c${requests.length}`, function: { name: 'read_url', arguments: JSON.stringify({ url: `http://127.0.0.1:${secret.address().port}/page${requests.length}` }) } }] : null;
      const frame = calls ? { choices: [{ delta: { tool_calls: calls } }] } : { choices: [{ delta: { content: 'done' } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => { upstream.closeAllConnections?.(); upstream.close(); });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'q', origin: 'quick-ask' });
  const text = await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content: 'read it', providerId: 'openai', model: 'm1', workMode: 'chat', textOnly: true }) })).text();
  assert.ok(!text.includes('SECRET ON THIS COMPUTER'), 'the page of this computer never reached the model or the person');
  const results = requests.slice(1).map((r) => String(r.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? ''));
  assert.ok(results.slice(0, 5).every((r) => /private network|this computer|own server|Could not read/i.test(r)), results.join(' | '));
  assert.match(results.at(5) ?? '', /may look things up 5 times/, 'the sixth look-up is refused');
});
