import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pcWorld } from './support/pc-world.mjs';
import { createAnswerer } from '../electron/quick-ask-answer.js';

// AGENT-FLOW F8-4 (Security): the bar searches by itself by default, so its first search shows the same fixed notice, once, as a small line under the answer (not a card), and sets the flag.
// Never on a device. The chat's own notice is covered in test/pc-default-f8.test.js.
const json = { 'content-type': 'application/json' };
const files = { 'Documents/tax return 2025.txt': 'Income was 104,250 dollars.' };

async function barAsk(w, content) {
  const made = await (await fetch(`${w.base}/api/sessions`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'bar', origin: 'quick-ask', workMode: 'chat' }) })).json();
  const res = await w.app.adminFetch(`/api/sessions/${made.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content, providerId: 'openai', model: 'm1', workMode: 'chat', textOnly: true, pcSearch: true }) });
  return res.text();
}
const noticeIn = (text) => [...text.matchAll(/event: notice\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1])).filter((n) => n.pcNotice === true);

test('the bar\'s first search sends the notice (flagged pcNotice), once; the flag is set; a second bar search sends none', async (t) => {
  const w = await pcWorld(t, { files, settings: {}, calls: [['search_pc', { terms: ['tax'] }], ['search_pc', { terms: ['return'] }]] });
  const first = noticeIn(await barAsk(w, 'find my tax return'));
  assert.equal(first.length, 1, 'one notice in the first search');
  assert.match(first[0].text, /^Search this PC is on, for finding files only\. File names and folders it finds go to the model/);
  assert.match(first[0].text, /Turn it off in Settings › Capabilities\.$/);
  const saved = JSON.parse(await readFile(join(w.dirs.data, 'settings.json'), 'utf8'));
  assert.equal(saved.pcSearchNoticeShown, true, 'the flag is set from the bar too');
  assert.equal(noticeIn(await barAsk(w, 'and the other one')).length, 0, 'not again');
});

test('a flag already set sends no notice', async (t) => {
  const shown = await pcWorld(t, { files, settings: { pcSearchNoticeShown: true }, calls: [['search_pc', { terms: ['tax'] }]] });
  assert.equal(noticeIn(await barAsk(shown, 'find my tax return')).length, 0);
});

test('the answer relay turns the notice into one fixed line for the bar (cleaned, at most 400 characters) and ignores a notice that is not the search notice', async () => {
  const sse = (...frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const run = async (frames) => {
    const events = [];
    const adminFetch = async (path) => (path === '/api/sessions' ? new Response(JSON.stringify({ id: 'aaaaaaaa-1111-4111-8111-111111111111' }), { status: 200 }) : new Response(sse(...frames), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const a = createAnswerer({ adminFetch, emit: (e) => events.push(e), getSettings: () => ({}) });
    await a.ask({ text: 'find my tax return' });
    return events;
  };
  const text = `Search this PC is on, for finding files only.\u0007 ${'x'.repeat(500)}`;
  const events = await run([['notice', { text, pcNotice: true }], ['delta', { text: 'ok' }], ['done', { model: 'm1' }]]);
  const line = events.find((e) => e.type === 'pc-notice');
  assert.ok(line, 'the bar is sent the notice');
  assert.ok(line.text.length <= 400 && !/[\u0000-\u001f]/.test(line.text));
  const other = await run([['notice', { text: 'No folder is chosen', folderPicker: true }], ['delta', { text: 'ok' }], ['done', { model: 'm1' }]]);
  assert.ok(!other.some((e) => e.type === 'pc-notice'), 'only the search notice becomes a line');
});

test('the bar page has the line under the answer (not a card) and clears it for each question', async () => {
  const html = await readFile(new URL('../electron/quick-ask/bar.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../electron/quick-ask/bar.js', import.meta.url), 'utf8');
  assert.match(html, /id="pcnote" role="status" hidden/);
  assert.match(js, /event\.type === 'pc-notice'[\s\S]*\$\('pcnote'\)\.textContent = event\.text/);
  assert.match(js, /\$\('pcnote'\)\.hidden = true; \$\('pcnote'\)\.textContent = '';/);
});

test('never on a device: an Everything device that searches gets no notice and does not set the flag', async (t) => {
  const { default: http } = await import('node:http');
  const PASS = 'correct horse battery staple';
  const w = await pcWorld(t, { files, settings: {}, calls: [['search_pc', { terms: ['tax'] }]], startOptions: { lanAddress: '127.0.0.1' } });
  const on = await (await fetch(`${w.base}/api/remote`, { method: 'PUT', headers: json, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  t.after(() => w.app.remote.disable());
  const url = on.url.replace(/\/$/, '');
  const host = new URL(url).host;
  const lan = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? json : {}), ...headers } }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const signed = await lan('/api/remote/signin', { method: 'POST', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  const cookie = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const me = JSON.parse((await lan('/api/remote/me', { headers: { host, cookie } })).text);
  const list = await (await fetch(`${w.base}/api/remote`)).json();
  await fetch(`${w.base}/api/remote/devices/${list.devices[0].id}/level`, { method: 'PATCH', headers: json, body: JSON.stringify({ level: 'everything' }) });
  const h = { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': me.csrf };
  const made = JSON.parse((await lan('/api/sessions', { method: 'POST', headers: h, body: { title: 'from a device' } })).text);
  const sent = await lan(`/api/sessions/${made.id}/messages`, { method: 'POST', headers: h, body: { content: 'find my tax return', providerId: 'openai', model: 'm1' } });
  assert.ok(w.toolNames(w.requests[0]).includes('search_pc'), 'an Everything device does search');
  assert.equal(noticeIn(sent.text).length, 0, 'no notice on a device');
  const saved = JSON.parse(await readFile(join(w.dirs.data, 'settings.json'), 'utf8').catch(() => '{}'));
  assert.ok(!saved.pcSearchNoticeShown, 'and the flag is not set by a device');
});

test('the bar\'s own first look-up (pcLookupFirst, round 2) shows the same notice once and sets the flag, and nothing more when the flag is set', async (t) => {
  const ask = async (w, extra) => {
    const made = await (await fetch(`${w.base}/api/sessions`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'bar', origin: 'quick-ask', workMode: 'chat' }) })).json();
    const res = await w.app.adminFetch(`/api/sessions/${made.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ content: 'find my tax return', providerId: 'openai', model: 'm1', workMode: 'chat', textOnly: true, pcSearch: true, pcLookupFirst: true, pcTerms: ['tax'], ...extra }) });
    return res.text();
  };
  const w = await pcWorld(t, { files, settings: {}, calls: [] });
  const first = noticeIn(await ask(w));
  assert.equal(first.length, 1, 'the look-up the bar makes by itself shows the notice');
  assert.match(first[0].text, /^Search this PC is on, for finding files only\./);
  assert.equal(JSON.parse(await readFile(join(w.dirs.data, 'settings.json'), 'utf8')).pcSearchNoticeShown, true);
  assert.equal(noticeIn(await ask(w)).length, 0, 'not again');
  const shown = await pcWorld(t, { files, settings: { pcSearchNoticeShown: true }, calls: [] });
  assert.equal(noticeIn(await ask(shown)).length, 0, 'a flag already set sends none');
});

test('LM-9: the bar shows "Starting your local model…" for the one flagged notice, in fixed words; a notice with the same words but no flag, or other text with the flag, is not passed through as given', async () => {
  const sse = (...frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const run = async (frames) => {
    const events = [];
    const adminFetch = async (path) => (path === '/api/sessions' ? new Response(JSON.stringify({ id: 'aaaaaaaa-1111-4111-8111-111111111111' }), { status: 200 }) : new Response(sse(...frames), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const a = createAnswerer({ adminFetch, emit: (e) => events.push(e), getSettings: () => ({}) });
    await a.ask({ text: 'hello' });
    return events;
  };
  const flagged = await run([['notice', { text: 'anything', localStarting: true }], ['delta', { text: 'ok' }], ['done', { model: 'm1' }]]);
  assert.equal(flagged.find((e) => e.type === 'pc-notice').text, 'Starting your local model…');
  const plain = await run([['notice', { text: 'Starting your local model…' }], ['delta', { text: 'ok' }], ['done', { model: 'm1' }]]);
  assert.ok(!plain.some((e) => e.type === 'pc-notice'), 'only the flagged notice is drawn');
});
