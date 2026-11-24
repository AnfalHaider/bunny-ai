import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';

// W4-11 P-6 (Security's requirements): what the MODEL installs or adds arrives switched OFF in every mode, a card lists what was added, and only
// a yes switches it on. The person's own install from Customize (the window) is unchanged.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;

const REPO = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }),
  'skills/grow/SKILL.md': '---\nname: grow\ndescription: How to grow carrots\n---\nWater them every morning.',
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
};

/** GitHub is answered by a stand-in for this test process only; everything else goes where it was going. */
function standInGithub(t) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.github.com') && u.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(REPO).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
    if (m) return REPO[m[1]] !== undefined ? new Response(REPO[m[1]], { status: 200 }) : new Response('not found', { status: 404 });
    return real(url, init);
  };
  t.after(() => { globalThis.fetch = real; });
}

/** One reply in which the model calls `call` once, then reports what the tool told it. The capability card is answered with `grant`. */
async function modelInstalls(t, call, { mode = 'ask', grant = false } = {}) {
  standInGithub(t);
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const told = body.messages.find((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(told ? { content: `got: ${told.content}` } : { tool_calls: [{ index: 0, id: 'c1', function: call }] }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'P6' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'add it', providerId: 'openai', model: 'gpt-4o' }) });
  const reader = res.body.getReader();
  let text = '';
  const cards = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    for (const kind of ['permission', 'capability']) {
      const m = !cards[kind] && new RegExp(`event: ${kind}\\ndata: (.*)\\n`).exec(text);
      if (m) {
        cards[kind] = JSON.parse(m[1]);
        const answer = kind === 'permission' ? (cards[kind].choices ? { allowed: true, choice: grant === false ? 'off' : 'on' } : { allowed: true }) : { granted: grant };
        await post(base, `/api/sessions/${session.id}/${kind}/${cards[kind].id}`, answer);
      }
    }
  }
  return { base, cards, text, seen, sessionId: session.id };
}
const installCall = { name: 'install_plugin', arguments: JSON.stringify({ url: 'https://github.com/bunny/carrot-helper' }) };

test('P-6: in Auto, a plugin the model installs is added OFF, a card lists the skill, its size and the connector address, and a no keeps it off', async (t) => {
  const r = await modelInstalls(t, installCall, { mode: 'auto', grant: false });
  const card = r.cards.permission; // F10: ONE card now shows what the two old cards showed
  assert.ok(card, 'the card was shown'); assert.equal(r.cards.capability, undefined, 'and there is no second card');
  assert.deepEqual(card.choices.map((c) => c.id), ['on', 'off', 'no']);
  assert.match(card.detail, /Skill grow \(\d+ characters of instructions\): How to grow carrots/);
  assert.match(card.detail, /Connector weather: https:\/\/weather\.example\.com\/mcp/);
  const skills = (await json(r.base, '/api/skills')).body;
  const connectors = (await json(r.base, '/api/mcp')).body;
  assert.deepEqual(skills.map((s) => [s.name, s.enabled]), [['grow', false]]);
  assert.deepEqual(connectors.map((c) => [c.name, c.enabled]), [['weather', false]]);
  assert.match(r.text, /chose to keep it off/);
});

test('P-6: a yes from the window switches the skill and the connector on', async (t) => {
  const r = await modelInstalls(t, installCall, { mode: 'auto', grant: true });
  assert.deepEqual((await json(r.base, '/api/skills')).body.map((s) => [s.name, s.enabled]), [['grow', true]]);
  assert.deepEqual((await json(r.base, '/api/mcp')).body.map((c) => [c.name, c.enabled]), [['weather', true]]);
  assert.match(r.text, /now switched on/);
});

test('P-6: in Ask mode the question before installing already lists the same things', async (t) => {
  const r = await modelInstalls(t, installCall, { mode: 'ask', grant: false });
  assert.ok(r.cards.permission, 'the permission card came first');
  assert.match(r.cards.permission.detail, /Skill grow \(\d+ characters of instructions\)/);
  assert.match(r.cards.permission.detail, /Connector weather: https:\/\/weather\.example\.com\/mcp/);
});

test('P-6: add_connector with an address is added OFF with a card showing the address; a no keeps it off', async (t) => {
  const call = { name: 'add_connector', arguments: JSON.stringify({ name: 'Maps', url: 'https://maps.example.com/mcp' }) };
  const r = await modelInstalls(t, call, { mode: 'auto', grant: false });
  assert.match(r.cards.permission.detail, /https:\/\/maps\.example\.com\/mcp/);
  assert.deepEqual((await json(r.base, '/api/mcp')).body.map((c) => [c.name, c.enabled]), [['Maps', false]]);
});

test('P-6: a connector that is off is neither listed nor offered in a later reply', async (t) => {
  const r = await modelInstalls(t, installCall, { mode: 'auto', grant: false });
  const next = await fetch(`${r.base}/api/sessions/${r.sessionId}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'and now?', providerId: 'openai', model: 'gpt-4o' }) });
  await next.text();
  const last = r.seen.at(-1);
  assert.ok(!(last.tools ?? []).some((d) => /weather/.test(d.function.name)), 'no tool of an off connector');
  assert.ok(!last.messages.some((m) => m.role === 'system' && /Connectors:/.test(String(m.content))), 'and it is not listed');
});

test('P-6: the person\'s own install from the window (Customize) is unchanged: it arrives on', async (t) => {
  standInGithub(t);
  const { base } = await startApp(t, { fake: false });
  const done = await post(base, '/api/plugins/install', { url: 'https://github.com/bunny/carrot-helper' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual((await json(base, '/api/skills')).body.map((s) => [s.name, s.enabled]), [['grow', true]]);
  assert.deepEqual((await json(base, '/api/mcp')).body.map((c) => [c.name, c.enabled]), [['weather', true]]);
  // installing the same plugin again never changes it (and never re-enables anything)
  const again = await post(base, '/api/plugins/install', { url: 'https://github.com/bunny/carrot-helper' });
  assert.notEqual(again.status, 200);
});
