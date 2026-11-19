// SEARCH-PC tests: an invented computer in a temp folder (a profile, documents, folders Bunny must never read), a fake Windows Search index over it, a model
// stand-in that plays a script of tool calls and records every request, and a reader of the reply's events. No real index, no real home, no network.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse } from 'node:path';
import { startApp, post } from '../helpers.js';
import { fakeRunner } from './pc-fake-index.mjs';

const json = { 'content-type': 'application/json' };

export async function pcWorld(t, { files = {}, settings = { pcSearchEnabled: true }, calls = [], permissionMode = 'auto', startOptions = {} } = {}) {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-pcw-')));
  t.after(() => rmSync(T, { recursive: true, force: true }));
  const home = join(T, 'Users', 'me');
  const dirs = { home, local: join(home, 'AppData', 'Local'), roaming: join(home, 'AppData', 'Roaming'), data: join(home, 'AppData', 'Local', 'BunnyAI') };
  for (const d of [dirs.local, dirs.roaming, dirs.data, join(T, 'ProgramData'), join(T, 'Windows'), join(T, 'Program Files'), join(T, 'Program Files (x86)'), join(T, 'Users', 'sam')]) mkdirSync(d, { recursive: true });
  const written = {};
  for (const [rel, text] of Object.entries(files)) {
    const full = join(home, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    written[rel] = full;
  }
  const rows = Object.entries(written).map(([rel, path]) => ({ path, name: basename(path), snippet: String(files[rel]).slice(0, 80), modified: '2025-03-01 10:00:00' }));
  const indexSeen = [];
  const env = { APPDATA: dirs.roaming, LOCALAPPDATA: dirs.local, ProgramData: join(T, 'ProgramData'), windir: join(T, 'Windows'), ProgramFiles: join(T, 'Program Files'), 'ProgramFiles(x86)': join(T, 'Program Files (x86)'), SystemDrive: parse(T).root.replace(/[\\/]+$/, '').toUpperCase() };
  const pcOptions = { run: fakeRunner(rows, { seen: indexSeen }), home, env, driveType: async () => 'local' };

  const requests = [];
  const upstream = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, json); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })); }
      requests.push(JSON.parse(raw));
      const call = calls[requests.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = call
        ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${requests.length}`, function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } }] }
        : { choices: [{ delta: { content: 'done' } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => { upstream.closeAllConnections?.(); upstream.close(); });

  const started = await startApp(t, { fake: false, dataDir: dirs.data, pcOptions, ...startOptions });
  const { base, app } = started;
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify(settings) });

  /** Send a message; `onEvent(event, data)` may answer cards. Returns every event. */
  async function say(content, { sessionId, extra = {}, onEvent = async () => {}, session = {}, headers = {} } = {}) {
    let id = sessionId;
    if (!id) {
      const { body } = await post(base, '/api/sessions', { title: 'pc', workMode: 'chat', ...session });
      id = body.id;
      if (permissionMode) await fetch(`${base}/api/sessions/${id}/setting/permissionMode`, { method: 'PATCH', headers: json, body: JSON.stringify({ value: permissionMode }) });
    }
    const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify({ content, providerId: 'openai', model: 'm1', ...extra }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (!event || !data) continue;
        const parsed = JSON.parse(data);
        events.push({ event, data: parsed });
        await onEvent(event, parsed, id);
      }
    }
    return { events, id };
  }
  const answer = (allowed) => async (event, data, id) => { if (event === 'permission') await post(base, `/api/sessions/${id}/permission/${data.id}`, { allowed }); };
  const toolNames = (request) => (request.tools ?? []).map((d) => d.function.name);
  const toolAnswers = () => requests.slice(1).map((r) => String(r.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? ''));
  return { T, dirs, files: written, rows, base, app, requests, indexSeen, say, answer, toolNames, toolAnswers, env, pcOptions, upstream };
}
