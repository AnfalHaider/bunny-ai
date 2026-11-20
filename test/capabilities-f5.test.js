import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startApp, post } from './helpers.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { CAPABILITIES } from '../src/server/agentTools.js';

// AGENT-FLOW F5 (Security F5-1 to F5-4): capability cards for the browser panel, sign-in and connector sign-in, with the tools pushed into the SAME reply.
const jsonH = { 'content-type': 'application/json' };
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
const call = (name, args) => ({ tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] });

/** A stand-in model that asks for one request_capability, then says what the tool told it. */
async function world(t, capabilityArgs, { secretStore = memorySecretStore(), body = {} } = {}) {
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const b = JSON.parse(raw);
      seen.push(b);
      const told = b.messages.filter((m) => m.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(told.length ? { content: `told: ${told.at(-1).content}` } : call('request_capability', capabilityArgs)));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  const { base } = await startApp(t, { fake: false, secretStore });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(base, '/api/sessions', { title: 'F5' });
  const say = async (answers = {}, onCard = null) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', ...body }) });
    const reader = res.body.getReader();
    let text = '';
    let card = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      const m = !card && /event: capability\ndata: (.*)\n/.exec(text);
      if (m) { card = JSON.parse(m[1]); await onCard?.(card); await post(base, `/api/sessions/${session.id}/capability/${card.id}`, { granted: answers.grant ?? true }); }
    }
    return { text, card };
  };
  return { base, seen, say, secretStore };
}
const toolNames = (b) => (b.tools ?? []).map((d) => d.function.name);
const lastTool = (b) => String(b.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '');

test('F5: the three new capabilities exist, and are never offered to helpers', () => {
  for (const k of ['browser_panel', 'sign_in', 'connector_sign_in']) assert.ok(CAPABILITIES[k], k);
  const src = readFileSync(new URL('../src/server/app.js', import.meta.url), 'utf8');
  const never = src.slice(src.indexOf('const HELPER_NEVER'), src.indexOf('\n', src.indexOf('const HELPER_NEVER')));
  for (const k of ['browser_panel', 'sign_in', 'connector_sign_in']) assert.ok(never.includes(`'${k}'`), `${k} is in HELPER_NEVER`);
});

test('browser_panel: with no window that can drive it there is no card, only the fixed answer', async (t) => {
  const w = await world(t, { capability: 'browser_panel', reason: 'open a page' });
  const r = await w.say();
  assert.equal(r.card, null, 'no card');
  assert.match(lastTool(w.seen[1]), /The browser panel is only in Bunny's window on the PC\. Use web_search and read_url here, or tell the person to continue in Bunny's window\./);
  assert.ok(!toolNames(w.seen[1]).some((n) => n.startsWith('browser_')), 'no browser tools were pushed');
});

test('browser_panel: in the desktop window (browserControl) the answer says it is already there', async (t) => {
  const w = await world(t, { capability: 'browser_panel', reason: 'open a page' }, { body: { browserControl: true } });
  const r = await w.say();
  assert.equal(r.card, null);
  assert.match(lastTool(w.seen[1]), /already available in this reply/);
  assert.ok(toolNames(w.seen[0]).includes('browser_open'));
});

test('sign_in github: the card says Sign in to GitHub; after the person signs in, the github_ tools are in the SAME reply, and the model learns only "signed in"', async (t) => {
  const secretStore = memorySecretStore();
  const w = await world(t, { capability: 'sign_in', service: 'github', reason: 'list issues' }, { secretStore });
  const r = await w.say({ grant: true }, async () => { await secretStore.set('account:github', 'ghp_SECRETTOKEN0123456789'); }); // the person signs in in Settings while the card is open
  assert.equal(r.card.capability, 'sign_in');
  assert.equal(r.card.title, 'Sign in to GitHub');
  assert.match(r.card.reason, /Settings › Profile/);
  assert.match(lastTool(w.seen[1]), /^Signed in to GitHub\. You now have the github_ tools/);
  assert.ok(toolNames(w.seen[1]).some((n) => n.startsWith('github_')), 'the tools arrived in the same reply');
  assert.ok(!JSON.stringify(w.seen).includes('ghp_SECRETTOKEN'), 'a token is never in any request to the model (F5-1)');
});

test('sign_in: a no gives the fixed answer, and nothing is pushed; Google with no client set up gives the card-less words', async (t) => {
  const w = await world(t, { capability: 'sign_in', service: 'github', reason: 'x' });
  const r = await w.say({ grant: false });
  assert.ok(r.card);
  assert.match(lastTool(w.seen[1]), /The person said no\. Do not ask for this again/);
  assert.ok(!toolNames(w.seen[1]).some((n) => n.startsWith('github_')));
  const g = await world(t, { capability: 'sign_in', service: 'google', reason: 'x' });
  const gr = await g.say();
  assert.equal(gr.card, null);
  assert.match(lastTool(g.seen[1]), /Google isn't set up in Bunny yet/);
});

test('connector_sign_in: an unknown name, or one that is not exact, is refused with fixed words and no card; a switched-off connector is not signed in to', async (t) => {
  const w = await world(t, { capability: 'connector_sign_in', connector: 'Notio', reason: 'x' });
  await post(w.base, '/api/mcp', { name: 'Notion', url: 'http://127.0.0.1:9/mcp' });
  const r = await w.say();
  assert.equal(r.card, null);
  assert.match(lastTool(w.seen[1]), /No installed connector has that exact name in this chat/);
  const off = await world(t, { capability: 'connector_sign_in', connector: 'Notion', reason: 'x' });
  const { body: offAdded } = await post(off.base, '/api/mcp', { name: 'Notion', url: 'http://127.0.0.1:9/mcp' });
  await fetch(`${off.base}/api/mcp/${offAdded.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: false }) });
  const o = await off.say();
  assert.equal(o.card, null);
  assert.match(lastTool(off.seen[1]), /Notion is switched off\. The person switches it on in Settings › Customize first/);
});

test('connector_sign_in: an installed, switched-on connector gets a card with its own name, and a no is the fixed answer', async (t) => {
  const w = await world(t, { capability: 'connector_sign_in', connector: 'Notion', reason: 'read my pages' });
  const { body: added } = await post(w.base, '/api/mcp', { name: 'Notion', url: 'http://127.0.0.1:9/mcp' });
  await fetch(`${w.base}/api/mcp/${added.id}`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ enabled: true }) });
  const r = await w.say({ grant: false });
  assert.equal(r.card.title, 'Sign in to Notion');
  assert.match(lastTool(w.seen[1]), /The person said no/);
});

test('F5-3 and F5 words: pushed browser tools follow the taint rule, devices and a model that refused tools are told in words, and the long plugin gets a step', () => {
  const src = readFileSync(new URL('../src/server/app.js', import.meta.url), 'utf8');
  // the taint check sits before the browser branch of runTool, so every browser tool (pushed or not) asks in Auto after a PC file was read
  assert.ok(src.indexOf('pcTurn.tainted && !textOnly') < src.indexOf('if (browserControl && isBrowserTool(name))'));
  assert.match(src, /On this device you can't use: the browser panel, desktop control, installing plugins or tools, building tools and scheduling/);
  assert.match(src, /Your tools were turned off for this model/);
  assert.match(src, /is installed and off/);
  assert.match(src, /Its description is too long to show here\. Open Settings › Customize to read it and switch it on\./);
});

// ---- the over-long plugin: the step carries openInCustomize, nothing is switched on ----
const LONG_REPO = { 'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }) };
for (let n = 0; n < 30; n += 1) LONG_REPO[`skills/grow${n}/SKILL.md`] = `---
name: grow${n}
description: How to grow carrots in a very particular way number ${n}, with care
---
Water them every morning.`;
test('F5: a plugin whose description is too long to show gets a step with Open in Customize (openInCustomize), and nothing is switched on', async (t) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.github.com') && u.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(LONG_REPO).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
    if (m) return LONG_REPO[m[1]] !== undefined ? new Response(LONG_REPO[m[1]], { status: 200 }) : new Response('not found', { status: 404 });
    return real(url, init);
  };
  t.after(() => { globalThis.fetch = real; });
  const w = await world(t, { capability: 'new_tool', reason: 'x' });
  // a model that installs the plugin instead: replace the stand-in's first answer by driving the tool route through a second world
  const seen = [];
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, jsonH); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const b = JSON.parse(raw);
      seen.push(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(b.messages.some((m) => m.role === 'tool') ? { content: 'done' } : call('install_plugin', { url: 'https://github.com/bunny/carrot-helper' })));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  await post(w.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  const { body: session } = await post(w.base, '/api/sessions', { title: 'long plugin' });
  await fetch(`${w.base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: jsonH, body: JSON.stringify({ value: 'auto' }) });
  const res = await fetch(`${w.base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: jsonH, body: JSON.stringify({ content: 'add the carrot plugin', providerId: 'openai', model: 'gpt-4o' }) });
  const reader = res.body.getReader();
  let text = '';
  const stop = setTimeout(() => reader.cancel().catch(() => {}), 20_000);
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true }));
    if (done) break;
    text += new TextDecoder().decode(value);
    const card = /event: (permission|capability)\ndata: (.*)\n/.exec(text);
    if (card && !text.includes('answered')) { text += 'answered'; await post(w.base, `/api/sessions/${session.id}/${card[1]}/${JSON.parse(card[2]).id}`, card[1] === 'permission' ? { allowed: true } : { granted: true }); }
  }
  clearTimeout(stop);
  assert.match(text, /"result":"Its description is too long to show here\. Open Settings › Customize to read it and switch it on\.","openInCustomize":true/);
  const skills = await (await fetch(`${w.base}/api/skills`)).json();
  assert.equal(skills.length, 30);
  assert.ok(skills.every((x) => x.enabled === false), 'nothing was switched on');
});
