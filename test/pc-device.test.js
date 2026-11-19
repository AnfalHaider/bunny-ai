import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pcWorld } from './support/pc-world.mjs';

// SEARCH-PC SP-1 and SP-5, over real HTTP: a device on the network (the "network" is 127.0.0.1 on a second port) never turns Search this PC on or reads its record,
// a Chats device is not offered the tools, an Everything device may search, and it is logged by tool name.
const PASS = 'correct horse battery staple';
const json = { 'content-type': 'application/json' };
const files = { 'Documents/tax return 2025.txt': 'Income was 104,250 dollars.' };

function lan(url, { path = '/', method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? json : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => { try { return JSON.parse(text); } catch { return null; } } }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function withDevice(t, calls) {
  const w = await pcWorld(t, { files, settings: { pcSearchEnabled: true, pcSearchAfter: 'show' }, calls, startOptions: { lanAddress: '127.0.0.1' } });
  const on = await (await fetch(`${w.base}/api/remote`, { method: 'PUT', headers: json, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  t.after(() => w.app.remote.disable());
  const url = on.url.replace(/\/$/, '');
  const host = new URL(url).host;
  const signed = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  assert.equal(signed.status, 200);
  const cookie = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0];
  const me = (await lan(url, { path: '/api/remote/me', headers: { host, cookie } })).json();
  const dev = (path, o = {}) => lan(url, { ...o, path, headers: { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': me.csrf, ...(o.headers ?? {}) } });
  const setLevel = async (level) => { const list = await (await fetch(`${w.base}/api/remote`)).json(); await fetch(`${w.base}/api/remote/devices/${list.devices[0].id}/level`, { method: 'PATCH', headers: json, body: JSON.stringify({ level }) }); };
  const chat = async () => {
    const made = (await dev('/api/sessions', { method: 'POST', body: { title: 'from a device' } })).json();
    const sent = await dev(`/api/sessions/${made.id}/messages`, { method: 'POST', body: { content: 'find my tax return', providerId: 'openai', model: 'm1' } });
    return sent.text;
  };
  return { ...w, dev, setLevel, chat };
}

test('a Chats device: not offered the tools, cannot change the settings, cannot read the record', async (t) => {
  const d = await withDevice(t, [['search_pc', { terms: ['tax'] }]]);
  await d.chat();
  assert.ok(!d.toolNames(d.requests[0]).some((n) => /pc/.test(n)), 'no pc tool offered to a Chats device');
  assert.equal(d.indexSeen.length, 0);
  const put = await d.dev('/api/settings', { method: 'PUT', body: { pcSearchEnabled: false } });
  assert.equal(put.status, 403);
  assert.equal((await d.dev('/api/pcsearch/activity')).status, 403);
  assert.equal((await d.dev('/api/pcsearch/fixed')).status, 403);
  assert.equal((await (await fetch(`${d.base}/api/settings`)).json()).pcSearchEnabled, true, 'unchanged');
});

test('an Everything device may search in its chats, is logged by tool name, and still cannot change the settings or read the record', async (t) => {
  const d = await withDevice(t, [['search_pc', { terms: ['tax'] }]]);
  await d.setLevel('everything');
  await d.chat();
  assert.ok(d.toolNames(d.requests[0]).includes('search_pc'), 'offered to an Everything device');
  assert.equal(d.indexSeen.length, 1, 'it searched');
  const logged = await d.app.remote.actions();
  assert.ok(logged.some((e) => e.kind === 'tool' && e.tool === 'search_pc'), 'the device log has it by tool name');
  assert.ok(!JSON.stringify(logged).includes('tax return') && !JSON.stringify(logged).includes('104,250'), 'never the query or a result');
  for (const body of [{ pcSearchEnabled: false }, { pcSearchAfter: 'read' }, { pcSearchExcluded: [d.dirs.home] }, { pcSearchBarAuto: false }]) {
    const put = await d.dev('/api/settings', { method: 'PUT', body });
    assert.equal(put.status, 403, JSON.stringify(body));
  }
  assert.equal((await d.dev('/api/pcsearch/activity')).status, 403);
  assert.equal((await d.dev('/api/pcsearch/resolve', { method: 'POST', body: { ref: 'x' } })).status, 403);
  const settings = await (await fetch(`${d.base}/api/settings`)).json();
  assert.deepEqual([settings.pcSearchEnabled, settings.pcSearchAfter], [true, 'show']);
  // the activity record names who asked
  const record = (await (await fetch(`${d.base}/api/pcsearch/activity`)).json()).entries;
  assert.match(record[0].who, /./);
  assert.notEqual(record[0].who, 'window');
});
