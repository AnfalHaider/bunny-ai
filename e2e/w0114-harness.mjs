/**
 * QA v0.1.14 PHONE-LAYOUT harness: an invented-profile Bunny (scripted OpenAI-compatible model), a local URL (browser view) and a remote-device URL
 * (127.0.0.2, signed in, Chats or Everything). Never the real profile, never the real network. Shared by the phone walk and probes.
 */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, devices } from 'playwright';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);

export async function startHarness() {
  const root = process.cwd();
  const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
  const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
  const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0114-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0114-folder-'));
  const provider = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta) => res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + NL + NL);
      send({ content: 'Here is an answer with a list:' + NL + NL + '1. first point that is a little long so it wraps on a phone screen' + NL + '2. second point' + NL + NL + '```js' + NL + 'const aVeryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);' + NL + '```' + NL + NL + '| a | b | c | d |' + NL + '|---|---|---|---|' + NL + '| 1 | 2 | 3 | a long cell value here |' });
      res.end('data: [DONE]' + NL + NL);
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  const bunny = await createApp({ dataDir: DATA, fake: false, secretStore: memorySecretStore(), probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [{ id: 'gpt-4o', displayName: 'GPT 4o', ownedBy: 'x', contextLength: null }, { id: 'gpt-4o-mini', displayName: 'GPT 4o mini', ownedBy: 'x', contextLength: null }], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2', networkProfile: async () => ({ name: 'Test network', category: 'Private' }) });
  await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
  const local = `http://127.0.0.1:${bunny.server.address().port}`;
  const adminJson = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j }; };
  await bunny.chooseFolder(FOLDER);
  await adminJson('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
  await adminJson('/api/settings', 'PUT', { providerId: 'openai', model: 'gpt-4o', callName: 'Pat', displayName: 'Pat Invented' });
  const mk = async (title) => (await adminJson('/api/sessions', 'POST', { title, providerId: 'openai', model: 'gpt-4o' })).json;
  const long = await mk('A chat with a rather long title to see how the header and list cope on a phone');
  await adminJson(`/api/sessions/${long.id}/messages`, 'POST', { content: 'Give me a list, code and a table please.', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' });
  for (const t of ['Trip plan', 'Budget', 'Recipe ideas']) await mk(t);
  await wait(1500);
  const passcode = 'qa-passcode-0114-abcdef';
  const on = await adminJson('/api/remote', 'PUT', { enabled: true, passcode });
  const remoteUrl = (on.json?.url ?? '').replace(/\/$/, '') || null;
  const browser = await chromium.launch();
  const remoteSignIn = async (ctx, level) => {
    const r = await ctx.request.post(remoteUrl + '/api/remote/signin', { data: { passcode } });
    if (!r.ok()) throw new Error('remote sign-in failed ' + r.status());
    const st = await adminJson('/api/remote', 'GET');
    const dev = (st.json?.devices ?? []).slice(-1)[0];
    if (level && dev) await adminJson(`/api/remote/devices/${dev.id}/level`, 'PUT', { level });
    return dev;
  };
  const close = async () => { try { await browser.close(); } catch { /* x */ } try { provider.close(); } catch { /* x */ } try { await bunny.close?.(); } catch { /* x */ } try { bunny.server.close(); } catch { /* x */ } };
  return { browser, devices, local, remoteUrl, remoteSignIn, adminJson, bunny, close, chatId: long.id, DATA };
}
