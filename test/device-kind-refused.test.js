import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';

// F9 (QA, Security): a device's answer that says "for this chat" is a 403 on EVERY card, the card keeps waiting, and it is never read as a plain Allow.
const PASS = 'correct horse battery staple'; const J = { 'content-type': 'application/json' };
function lan(url, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? J : {}), ...headers } }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, json: () => { try { return JSON.parse(text); } catch { return null; } }, headers: res.headers })); });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
for (const [level, scenario] of [['everything', 'edit card (offers a kind)'], ['everything', 'install card (named choices, no kind)'], ['chats', 'edit card (offers a kind)']]) {
  test(`a ${level} device answering the ${scenario} with kind:true gets 403 and the card keeps waiting; the window then answers`, async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'bunny-devkind-')); await mkdir(join(folder, 'src', 'a'), { recursive: true }); t.after(() => rm(folder, { recursive: true, force: true }));
    const started = await startApp(t, { lanAddress: '127.0.0.1', fake: false });
    const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: J, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
    t.after(() => started.app.remote.disable());
    const url = on.url.replace(/\/$/, ''); const host = new URL(url).host;
    const signin = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
    const cookie = String(signin.headers['set-cookie']?.[0] ?? '').split(';')[0];
    const page = await lan(url, { path: '/src/ui/index.html', headers: { host, cookie } });
    const csrf = /name="bunny-csrf" content="([a-f0-9]+)"/.exec(page.text)[1];
    if (level === 'everything') assert.equal((await fetch(`${started.base}/api/remote/devices/${started.app.remote.list()[0].id}/level`, { method: 'PATCH', headers: J, body: JSON.stringify({ level: 'everything' }) })).status, 200);
    const device = (method, path, body) => lan(url, { method, path, headers: { host, cookie, origin: `http://${host}`, 'x-bunny-csrf': csrf }, body });
    const isInstall = scenario.startsWith('install');
    const upstream = createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
        const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const call = isInstall ? { name: 'add_connector', args: { name: 'Notion', url: 'https://mcp.example-notion.test/mcp' } } : { name: 'write_file', args: { path: 'src/a/x.js', content: 'x\n' } };
        const delta = done === 0 ? { tool_calls: [{ index: 0, id: 'c0', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'done' };
        res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(r); }));
    await post(started.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
    const { body: session } = await post(started.base, '/api/sessions', { title: 'devkind' });
    const set = (key, value) => fetch(`${started.base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: J, body: JSON.stringify({ value }) });
    await set('permissionMode', 'ask'); if (!isInstall) await set('folder', folder);
    const res = await fetch(`${started.base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: isInstall ? 'chat' : 'code' }) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const statuses = [];
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!/^event: permission/m.test(block)) continue;
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
        for (const body of [{ allowed: true, kind: true }, { allowed: true, saveRule: true }, { choice: 'on', allowed: true, kind: true }]) statuses.push((await device('POST', `/api/sessions/${session.id}/permission/${card.id}`, body)).status);
        // still waiting: the window answers no
        const late = await fetch(`${started.base}/api/sessions/${session.id}/permission/${card.id}`, { method: 'POST', headers: J, body: JSON.stringify(isInstall ? { choice: 'no', allowed: false } : { allowed: false }) });
        statuses.push(late.status);
      }
    }
    assert.deepEqual(statuses, [403, 403, 403, 200], 'three refused, and the card was still there for the window');
    assert.equal((await (await fetch(`${started.base}/api/sessions/${session.id}/allow-kinds`)).json()).kinds.length, 0, 'no kind was given');
  });
}
