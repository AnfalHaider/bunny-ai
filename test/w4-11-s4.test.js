import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post } from './helpers.js';

// W4-11 S-4: a skill called by name (/name) makes the model load it first.
const jsonH = { 'content-type': 'application/json' };

async function setup(t) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const say = async (extra) => {
    const { body: session } = await post(base, '/api/sessions', { title: 'S4' });
    await (await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: '/carrot-math count these', providerId: 'openai', model: 'gpt-4o', ...extra }) })).text();
    return seen.at(-1).messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n---\n');
  };
  return { base, say };
}

test('S-4: a skill called by name tells the model to call read_skill for it first', async (t) => {
  const s = await setup(t);
  await post(s.base, '/api/skills', { name: 'carrot-math', description: 'Count carrots', instructions: 'x'.repeat(5000), enabled: true });
  assert.match(await s.say({ useSkill: 'carrot-math' }), /The person asked for the skill "carrot-math": call read_skill with that name first/);
});

test('S-4: a name that is not a skill, a skill that is off, or skills switched off add nothing', async (t) => {
  const s = await setup(t);
  const { body: off } = await post(s.base, '/api/skills', { name: 'carrot-math', description: 'Count carrots', instructions: 'x', enabled: false });
  assert.doesNotMatch(await s.say({ useSkill: 'carrot-math' }), /asked for the skill/, 'a skill that is off');
  assert.doesNotMatch(await s.say({ useSkill: 'no-such-skill' }), /asked for the skill/, 'not a skill');
  await fetch(`${s.base}/api/skills/${off.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: true }) });
  await fetch(`${s.base}/api/settings`, { method: 'PUT', headers: jsonH, body: JSON.stringify({ skillsEnabled: false }) });
  assert.doesNotMatch(await s.say({ useSkill: 'carrot-math' }), /asked for the skill/, 'skills switched off for every chat');
});
