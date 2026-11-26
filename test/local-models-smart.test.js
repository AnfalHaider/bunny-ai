/**
 * LOCAL-MODELS in fake mode, through a real chat: LM-8 (Smart asks with a local chat model and no checking model chosen), the plain error states raised on
 * purpose, the Quick ask line, and the device refusal. The "local server" is a scripted stand-in (BUNNY_FAKE_LOCAL_URL); nothing real is downloaded or run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

async function setup(t) {
  const asked = [];
  const model = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[]}'); return; }
      const body = JSON.parse(raw);
      asked.push(body.messages?.[0]?.content?.slice?.(0, 60));
      const done = body.messages.some((m) => m.role === 'tool');
      const user = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (/run it/.test(user) && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"command":"echo hi"}' } }] }) + 'data: [DONE]\n\n');
      else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  t.after(() => { model.closeAllConnections?.(); model.close(); });
  process.env.BUNNY_FAKE_LOCAL = '1';
  process.env.BUNNY_FAKE_LOCAL_URL = `http://127.0.0.1:${model.address().port}/v1`;
  t.after(() => { delete process.env.BUNNY_FAKE_LOCAL; delete process.env.BUNNY_FAKE_LOCAL_URL; });
  const { base, app } = await startApp(t, { fake: false });
  await post(base, '/api/local-models/setup', {});
  for (let i = 0; i < 80 && !(await (await fetch(`${base}/api/local-models`)).json()).installed; i += 1) await new Promise((r) => setTimeout(r, 50));
  await post(base, '/api/local-models/download', { id: 'qwen3-4b' });
  for (let i = 0; i < 100 && (await (await fetch(`${base}/api/local-models`)).json()).models.find((m) => m.id === 'qwen3-4b').state !== 'ready'; i += 1) await new Promise((r) => setTimeout(r, 50));
  return { base, asked, app };
}

async function chat(base, content, { mode = 'auto', raiseFirst = null, textOnly = false, admin = null } = {}) {
  if (raiseFirst) await post(base, '/api/local-models/fake', { raise: raiseFirst });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-lm-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'local', providerId: 'bunny-local', model: 'qwen3-4b' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  const init = { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'bunny-local', model: 'qwen3-4b', workMode: 'code', ...(textOnly ? { textOnly: true } : {}) }) };
  const res = admin ? await admin(`/api/sessions/${s.id}/messages`, init) : await fetch(`${base}/api/sessions/${s.id}/messages`, init);
  if (!(res.headers.get('content-type') ?? '').includes('event-stream')) return { status: res.status, json: await res.json(), cards: [], stream: '' };
  const cards = []; let buf = ''; let all = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) { const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card); await fetch(`${base}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: false }) }); }
    }
  }
  return { status: res.status, cards, stream: all };
}

test('LM-8: with a local chat model and no checking model chosen, Smart asks, with the words from the drawing, and the judge model is never asked', async (t) => {
  const { base, asked } = await setup(t);
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ autoJudgeEnabled: true }) });
  const r = await chat(base, 'run it');
  assert.equal(r.cards.length, 1, 'a card for the risky action: ' + r.stream.slice(0, 900));
  assert.match(`${r.cards[0].detail} ${r.stream}`, /Smart can't check this with a local model\. Choose a checking model in Settings to let Smart decide\./);
  assert.equal(asked.filter((a) => /check|judge/i.test(String(a))).length, 0, 'no second (local) model was asked to judge');
});

test('the plain error states are raised on purpose and come back as the drawn words, at the chat (409) and on the card', async (t) => {
  const { base } = await setup(t);
  for (const [kind, code, words] of [['memory', 'local.memory', /Not enough memory to load Qwen3 4B.*Close other apps or choose a smaller model\./], ['missing', 'local.missing', /isn't set up on this PC/], ['changed', 'local.changed', /program changed on disk/], ['device', 'local.notRunning', /Bunny local is stopped\. Start it from Bunny's window on your PC\./]]) {
    await post(base, '/api/local-models/fake', { raise: 'none' });
    const r = await chat(base, 'hello', { raiseFirst: kind });
    assert.equal(r.status, 409, kind);
    assert.equal(r.json.code, code, kind);
    assert.match(r.json.message, words, kind);
  }
  await post(base, '/api/local-models/fake', { raise: 'none' });
  const missing = await (await post(base, '/api/local-models/fake', { raise: 'missing' })).body;
  assert.equal(missing.alerts[0].kind, 'missing');
  const changed = await (await post(base, '/api/local-models/fake', { raise: 'changed' })).body;
  assert.deepEqual(changed.alerts.map((a) => a.kind), ['changed'], 'one program alert at a time');
  const fp = (await post(base, '/api/local-models/fake', { raise: 'fingerprint', id: 'qwen3-8b' })).body.models.find((m) => m.id === 'qwen3-8b');
  assert.match(fp.error, /didn't match its fingerprint and was deleted/);
  const hf = (await post(base, '/api/local-models/fake', { raise: 'hfchanged', id: 'qwen3-8b' })).body.models.find((m) => m.id === 'qwen3-8b');
  assert.equal(hf.changedOnHub, true);
  await post(base, '/api/local-models/fake', { raise: 'none' });
  const disk = (await post(base, '/api/local-models/fake', { raise: 'disk', id: 'qwen3-8b' })).body.models.find((m) => m.id === 'qwen3-8b');
  assert.match(disk.error, /GB free on this drive/);
  assert.equal((await post(base, '/api/local-models/fake', { raise: 'bogus' })).status, 400);
});

test('Quick ask says "Starting your local model…" the first time; a window chat says "Starting <model>…"', async (t) => {
  const { base, app } = await setup(t);
  await post(base, '/api/local-models/stop', {});
  // LM-14: a body that merely says textOnly is nobody, so it starts nothing
  const plain = await chat(base, 'hello', { textOnly: true, mode: 'ask' });
  assert.equal(plain.status, 409);
  assert.equal(plain.json.code, 'local.notRunning');
  // the bar's own request carries the main process's admin secret
  const quick = await chat(base, 'hello', { textOnly: true, mode: 'ask', admin: app.adminFetch });
  assert.match(quick.stream, /Starting your local model…/);
  await post(base, '/api/local-models/stop', {});
  const win = await chat(base, 'hello', { mode: 'ask' });
  assert.match(win.stream, /Starting Qwen3 4B… \(first message after a start takes longer\)/);
});

test('QA scenarios: smart-asks, quick-ask and device each build their chat and return the one message to send, with what to expect', async (t) => {
  const { base } = await setup(t);
  for (const name of ['smart-asks', 'quick-ask', 'device']) {
    const r = await post(base, '/api/local-models/scenario', { name });
    assert.equal(r.status, 200, name);
    assert.ok(r.body.sessionId && r.body.message && r.body.expect, name);
  }
  assert.equal((await post(base, '/api/local-models/scenario', { name: 'nope' })).status, 400);
  // the device one: the next message to a stopped model is refused the way a phone would be
  const dev = await post(base, '/api/local-models/scenario', { name: 'device' });
  const res = await fetch(`${base}/api/sessions/${dev.body.sessionId}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: dev.body.message, providerId: 'bunny-local', model: 'qwen3-4b' }) });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'local.notRunning');
  // and the Smart one makes its card
  await post(base, '/api/local-models/fake', { raise: 'none' });
  const smart = await post(base, '/api/local-models/scenario', { name: 'smart-asks' });
  const sres = await fetch(`${base}/api/sessions/${smart.body.sessionId}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: smart.body.message, providerId: 'bunny-local', model: 'qwen3-4b', workMode: 'code' }) });
  const reader = sres.body.getReader(); const dec = new TextDecoder(); let seen = '';
  while (!/event: permission/.test(seen)) { const { done, value } = await reader.read(); if (done) break; seen += dec.decode(value, { stream: true }); }
  await reader.cancel();
  assert.match(seen, /Smart can't check this with a local model/);
});

test('the invented numbers agree: one decimal, and a memory error or a Too big row always needs more than is free', async (t) => {
  const { base } = await setup(t);
  await post(base, '/api/local-models/fake', { raise: 'memory' });
  const r = await chat(base, 'hello');
  const [, free, need] = /about ([\d.]+) GB free and the model needs about ([\d.]+) GB/.exec(r.json.message);
  assert.ok(Number(need) > Number(free), `${need} > ${free}`);
  assert.match(free, /^\d+\.\d$/);
  const s = await (await fetch(`${base}/api/local-models`)).json();
  const big = s.models.find((m) => m.fit === 'too-big');
  assert.ok(big.needBytes > big.availBytes);
});
