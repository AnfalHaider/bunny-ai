import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';
import { listTools } from '../src/server/mcp.js';
import { refusesTools } from '../src/server/chat.js';
import { readGithubPlugin } from '../src/server/pluginImport.js';

// W4-11, QA's three findings on the first batch.
const json = { 'content-type': 'application/json' };

function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}
const skill = (n) => `---\nname: ${n}\ndescription: skill ${n}\n---\nDo ${n}.`;

test('(1) P-1: skills inside node_modules, test, fixtures and examples are not imported, and the count is capped with a note', async () => {
  const files = {};
  for (let i = 0; i < 30; i += 1) files[`node_modules/pkg${i}/skills/s${i}/SKILL.md`] = skill(`nm${i}`);
  files['plugins/a/test/skills/t/SKILL.md'] = skill('intest');
  files['fixtures/skills/f/SKILL.md'] = skill('infixture');
  files['examples/skills/e/SKILL.md'] = skill('inexample');
  for (let i = 0; i < 45; i += 1) files[`skills/real${i}/SKILL.md`] = skill(`real${i}`);
  const plugin = await readGithubPlugin('https://github.com/o/big', { fetchImpl: fakeGithub(files) });
  assert.equal(plugin.skills.length, 40);
  assert.ok(plugin.skills.every((s) => s.name.startsWith('real')), 'only real skills');
  assert.ok(plugin.skipped.some((s) => /^5 more skills were not imported \(at most 40/.test(s)), plugin.skipped.join(' | '));
});

test('(2) PV-1: only a refusal ABOUT tools counts; a 400 that merely holds the word does not', () => {
  const say = (m) => ({ code: 'chat.http', message: `The provider answered 400: ${m}` });
  assert.equal(refusesTools(say('max_tokens is too large for a model that uses tools')), false);
  assert.equal(refusesTools(say('the context is too long, even without tools')), false);
  assert.equal(refusesTools(say('tool_choice must be auto')), false);
  assert.equal(refusesTools(say('Tool use is not supported')), true);
  assert.equal(refusesTools(say('tools is not supported by this model')), true);
  assert.equal(refusesTools(say('This model does not support function calling')), true);
  assert.equal(refusesTools(say('Invalid parameter: tools')), false, 'no refusal wording: left to the next model');
});

test('(2) PV-1: a model that refused tools is not asked with them again in the same chat, and the notice is not repeated', async (t) => {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      if (body.tools) { res.writeHead(400, json); res.end('{"error":{"message":"tools is not supported by this model"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'plain' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'PV1' });
  const say = async (content) => (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }) })).text();
  const first = await say('one');
  assert.match(first, /Tools are off for this model/);
  assert.deepEqual(seen.map((b) => Boolean(b.tools)), [true, false], 'first message: with tools (refused), then without');
  const second = await say('two');
  assert.deepEqual(seen.map((b) => Boolean(b.tools)), [true, false, false], 'second message: no request with tools at all');
  assert.doesNotMatch(second, /Tools are off for this model/);
  assert.match(second, /plain/);
});

/** A server that pages its tool list: `total` tools (or without end), `size` to a page. */
async function paged(t, { total = Infinity, size = 3 } = {}) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      res.writeHead(200, json);
      if (r.method === 'initialize') { res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'no' } })); return; }
      const from = Number(r.params?.cursor ?? 0);
      const to = Math.min(from + size, total);
      const tools = Array.from({ length: to - from }, (_, i) => ({ name: `t${from + i}`, inputSchema: { type: 'object' } }));
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { tools, ...(to < total ? { nextCursor: String(to) } : {}) } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

test('(3) R-5: 100 tools in pages of 3 are all listed (the old 20-page stop gave 60)', async (t) => {
  const tools = await listTools({ id: 'p100', name: 'P', url: await paged(t, { total: 100 }) });
  assert.equal(tools.length, 100);
  assert.equal(tools.truncated, undefined);
});

test('(3) R-5: a list that never ends stops at 1,000 tools and says it was cut', async (t) => {
  const tools = await listTools({ id: 'pinf', name: 'P', url: await paged(t, { size: 50 }) }, { timeoutMs: 30_000 });
  assert.equal(tools.length, 1000);
  assert.equal(tools.truncated, true);
});
