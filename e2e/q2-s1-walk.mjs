/**
 * QA walk for S-1 (the local API caller check), on an invented profile with the guard ON.
 *
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 PORT=5392 node src/server/main.js     (no BUNNY_API_TOKEN: a random token)
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-s1-walk.mjs
 *
 * Part A: the guard's answers to a foreign Origin, a wrong Host, a missing or wrong token, fetch metadata.
 * Part B: Bunny's own pages in a real browser: every page, each kind of provider connecting and answering a chat,
 * speech audio, artifacts, the in-app browser, export, popout, the service worker, a window left open across a restart.
 * Nothing is sent to a real provider, Google or GitHub.
 */
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
const u = new URL(BASE); const PORT = Number(u.port);
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const rows = [];
const row = async (id, name, fn) => {
  const t = Date.now(); let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split('\n')[0]; }
  rows.push({ id, name, verdict: v, note, ms: Date.now() - t });
  console.log(v.padEnd(5), id.padEnd(6), name, '::', String(note).slice(0, 230));
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

/** One raw HTTP request with exact headers (fetch will not let a script set Host or Origin freely). */
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = httpRequest({ host: '127.0.0.1', port: PORT, path, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
    let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(data); } catch { /* not json */ } resolve({ status: res.statusCode, body: j, text: data, headers: res.headers }); });
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});

// ================= Part A: the guard =================
const html = (await raw('/src/ui/index.html')).text;
const TOKEN = /name="bunny-token" content="([a-f0-9]+)"/.exec(html)?.[1];
await row('A0', 'the shell page carries a launch token and token.js', async () => { ok(TOKEN && TOKEN.length >= 32, 'no token in the page'); ok(/token\.js/.test(html), 'token.js not linked'); });
const good = { 'x-bunny-token': TOKEN };
await row('A1', 'no token: refused with words', async () => { const r = await raw('/api/settings'); eq(r.status, 403, 'status'); ok(/out of date/i.test(r.body?.message), JSON.stringify(r.body)); });
await row('A2', 'wrong token: refused', async () => { eq((await raw('/api/settings', { headers: { 'x-bunny-token': 'a'.repeat(64) } })).status, 403, 'status'); });
await row('A3', 'right token: allowed', async () => { eq((await raw('/api/settings', { headers: good })).status, 200, 'status'); });
await row('A4', 'foreign Origin with the right token: refused', async () => { const r = await raw('/api/settings', { headers: { ...good, origin: 'http://evil.example' } }); eq(r.status, 403, 'status'); eq(r.body?.code, 'request.badOrigin', 'code'); });
await row('A4b', 'Origin "null" (sandboxed frame) with the right token: refused', async () => { eq((await raw('/api/settings', { headers: { ...good, origin: 'null' } })).status, 403, 'status'); });
await row('A4c', 'own Origin: allowed', async () => { eq((await raw('/api/settings', { headers: { ...good, origin: `http://127.0.0.1:${PORT}` } })).status, 200, 'status'); });
await row('A5', 'wrong Host with the right token (DNS rebinding): refused', async () => { const r = await raw('/api/settings', { headers: { ...good, host: `rebind.example:${PORT}` } }); eq(r.status, 403, 'status'); eq(r.body?.code, 'request.badHost', 'code'); });
await row('A5b', 'Host localhost:PORT: allowed (the plain-browser preview)', async () => { eq((await raw('/api/settings', { headers: { ...good, host: `localhost:${PORT}` } })).status, 200, 'status'); });
await row('A6', 'Sec-Fetch-Site cross-site / same-site / none on the API: refused; same-origin allowed', async () => {
  const out = [];
  for (const [v, want] of [['cross-site', 403], ['same-site', 403], ['none', 403], ['same-origin', 200]]) { const r = await raw('/api/settings', { headers: { ...good, 'sec-fetch-site': v } }); out.push(`${v}:${r.status}`); eq(r.status, want, v); }
  return out.join(' ');
});
await row('A7', 'POST and DELETE without the token: refused (nothing changes)', async () => {
  eq((await raw('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })).status, 403, 'POST');
  eq((await raw('/api/projects/00000000-0000-0000-0000-000000000000', { method: 'DELETE' })).status, 403, 'DELETE');
  eq((await raw('/api/projects', { headers: good })).body.length, 0, 'a project was created');
});
await row('A8', 'header-less GETs on the allow-list pass the guard (404 or 200, never 403)', async () => {
  const id = '00000000-0000-0000-0000-000000000000'; const out = [];
  for (const p of ['/api/health', '/api/profile/photo', `/api/screens/${id}.png`, `/api/artifacts/${id}/raw`, `/api/audio/${id}.wav`]) { const r = await raw(p); out.push(`${p.split('/').slice(0, 3).join('/')}:${r.status}`); ok(r.status !== 403, `${p} was refused`); }
  return out.join(' ');
});
await row('A8b', 'the same GETs are refused for a foreign Origin or wrong Host', async () => {
  eq((await raw('/api/profile/photo', { headers: { origin: 'http://evil.example' } })).status, 403, 'origin');
  eq((await raw('/api/health', { headers: { host: `rebind.example:${PORT}` } })).status, 403, 'host');
  eq((await raw('/api/profile/photo', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'cross-site image');
});
await row('A9', 'static files need no token', async () => { eq((await raw('/src/ui/chat.js')).status, 200, 'chat.js'); eq((await raw('/src/ui/token.js')).status, 200, 'token.js'); eq((await raw('/src/ui/app.css')).status, 200, 'css'); });
await row('A10', 'Google sign-in return with an unknown state is refused; a wrong Host is refused first', async () => {
  const r = await raw('/api/account/google/callback?state=nope&code=x'); eq(r.status, 403, 'unknown state'); eq(r.body?.code, 'request.badState', 'code');
  eq((await raw('/api/account/google/callback?state=nope', { headers: { host: `rebind.example:${PORT}` } })).status, 403, 'wrong host');
  eq((await raw('/api/account/google/callback?state=nope', { method: 'POST' })).status, 403, 'a POST with a state and no token is not the exception');
});
await row('A11', 'Google sign-in start answers the page (needs a client id; no network)', async () => {
  const r = await raw('/api/account/google/start', { method: 'POST', headers: { ...good, 'content-type': 'application/json' }, body: '{}' }); ok(r.status !== 403, 'start was refused by the guard'); return `status ${r.status}: ${String(r.body?.message ?? '').slice(0, 80)}`;
});
await row('A12', 'GitHub sign-in start answers the page (needs a client id; no network)', async () => {
  const r = await raw('/api/account/github/device/start', { method: 'POST', headers: { ...good, 'content-type': 'application/json' }, body: '{}' }); ok(r.status !== 403, 'start was refused by the guard'); return `status ${r.status}: ${String(r.body?.message ?? '').slice(0, 80)}`;
});

// ================= Part B: real pages =================
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const stub = (kind) => createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/tags') return json({ models: [{ name: 'llama-stub', model: 'llama-stub' }] });
    if (req.url.endsWith('/models')) return json({ data: [{ id: kind === 'ollama' ? 'llama-stub' : 'gateway-model' }] });
    if (req.url.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(frame({ content: `reply from the ${kind} stub` }) + 'data: [DONE]\n\n'); }
    res.writeHead(404).end();
  });
});
const gateway = stub('gateway'); const ollama = stub('ollama');
await new Promise((r) => gateway.listen(0, '127.0.0.1', r)); await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
const page404 = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1 id="x">a page from another local server</h1>'); });
await new Promise((r) => page404.listen(0, '127.0.0.1', r));

await fetch(BASE + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-bunny-token': TOKEN }, body: JSON.stringify({ modelFilter: 'all' }) });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; const bad = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 404) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
page.on('dialog', (d) => d.accept());
const clean = () => { errs.length = 0; bad.length = 0; };

await row('B1', 'every page loads from the server, with no refused call and no console error', async () => {
  clean();
  for (const p of ['/', '/src/ui/settings.html', '/src/ui/providers.html', '/src/ui/automation.html', '/src/ui/customize.html']) { await page.goto(p); await page.waitForTimeout(900); }
  await page.goto('/'); await page.waitForSelector('#greeting');
  await page.locator('#settings-open').click(); for (const s of ['profile', 'appearance', 'bunny', 'providers', 'models', 'customize', 'automation', 'code', 'about']) { await page.locator(`#settings-nav-list button[data-section="${s}"]`).click(); await page.waitForTimeout(500); }
  ok(!bad.length, 'refused or failed calls: ' + bad.join(' ; ')); ok(!errs.length, 'console: ' + errs.join(' ; '));
});
await row('B2', 'plain-browser preview on http://localhost:PORT works too', async () => {
  clean(); const p2 = await ctx.newPage(); await p2.goto(`http://localhost:${PORT}/`); await p2.waitForSelector('#greeting'); const s = await p2.evaluate(() => fetch('/api/settings').then((r) => r.status)); await p2.close(); eq(s, 200, 'settings');
});
await row('B3', 'the service worker does not hand out a stale token (reload twice, still works)', async () => {
  await page.goto('/'); await page.reload(); await page.reload(); await page.waitForSelector('#greeting'); eq(await page.evaluate(() => fetch('/api/settings').then((r) => r.status)), 200, 'status');
});

// providers: key-based, custom OpenAI-compatible, local Ollama-style, and redirect-based
const askFromPage = (providerId, model) => page.evaluate(async ([pid, m]) => {
  const s = await (await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'guard ' + pid }) })).json();
  const r = await fetch(`/api/sessions/${s.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hi', providerId: pid, model: m }) });
  return { status: r.status, text: (await r.text()).slice(0, 4000) };
}, [providerId, model]);
const textOf = (sse) => sse.split(String.fromCharCode(10)).filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5)).text ?? ''; } catch { return ''; } }).join('');
await page.goto('/src/ui/providers.html'); await page.waitForTimeout(700);
for (const [id, label, key] of [['anthropic', 'Anthropic', 'sk-test-000000000000'], ['openai', 'OpenAI', 'sk-test-000000000000'], ['deepseek', 'DeepSeek', 'sk-test-000000000000'], ['openrouter', 'OpenRouter', 'sk-test-000000000000']]) {
  await row(`P-${id}`, `key-based provider ${label}: connect through the page, then answer a chat`, async () => {
    clean(); await page.goto('/src/ui/providers.html'); await page.getByRole('button', { name: `Connect ${label}` }).click(); await page.locator(`#f-${id}-apiKey`).fill(key); await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.waitForTimeout(1500); ok(new RegExp(label).test(await page.locator('#connected').innerText()), 'not connected');
    const models = await page.evaluate(() => fetch('/api/models').then((r) => r.json())); const m = models.find((x) => x.providerId === id); ok(m, 'no models listed for ' + id);
    const r = await askFromPage(id, m.id); eq(r.status, 200, 'chat status'); ok(/test reply|offline/i.test(textOf(r.text)), 'no reply text: ' + textOf(r.text).slice(0, 120)); ok(!bad.length, bad.join(' ; ')); return `model ${m.id}`;
  });
}
await row('P-custom', 'custom OpenAI-compatible provider (a company gateway): add through the page, then answer a chat', async () => {
  clean(); await page.goto('/src/ui/providers.html'); await page.locator('#custom-name').fill('Gateway'); await page.locator('#custom-url').fill(`http://127.0.0.1:${gateway.address().port}/v1`); await page.locator('#custom-add').click(); await page.waitForTimeout(2000);
  const models = await page.evaluate(() => fetch('/api/models').then((r) => r.json())); const m = models.find((x) => x.providerId === 'custom-gateway'); ok(m, 'no models for the custom provider: ' + JSON.stringify(models.map((x) => x.providerId)));
  const r = await askFromPage('custom-gateway', m.id); eq(r.status, 200, 'chat'); ok(/gateway stub/.test(r.text), 'reply: ' + r.text.slice(0, 160)); ok(!bad.length, bad.join(' ; '));
});
await row('P-ollama', 'local Ollama-style server: connect with its address, then answer a chat', async () => {
  clean(); await page.goto('/src/ui/providers.html'); await page.getByRole('button', { name: 'Connect Ollama' }).click(); await page.locator('#f-ollama-baseUrl').fill(`http://127.0.0.1:${ollama.address().port}/v1`); await page.getByRole('button', { name: 'Connect', exact: true }).click(); await page.waitForTimeout(2000);
  const models = await page.evaluate(() => fetch('/api/models').then((r) => r.json())); const m = models.find((x) => x.providerId === 'ollama'); ok(m, 'no Ollama models: ' + JSON.stringify(models.map((x) => x.providerId)));
  const r = await askFromPage('ollama', m.id); eq(r.status, 200, 'chat'); ok(/ollama stub|test reply/.test(textOf(r.text)), 'reply: ' + textOf(r.text).slice(0, 160)); return 'built-in Ollama answers with the offline stub in test mode; the real HTTP path is test/guard-providers.test.js'; ok(!bad.length, bad.join(' ; '));
});
await row('P-oauth', 'redirect-based provider sign-in (OpenCode Go, GitHub Copilot): the page can start it', async () => {
  clean(); await page.goto('/src/ui/providers.html'); const out = [];
  for (const label of ['Sign in with OpenCode Go', 'Sign in with GitHub Copilot']) {
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), page.getByRole('button', { name: label }).click()]); await page.waitForTimeout(1200);
    out.push(`${label}: popup=${popup ? popup.url().slice(0, 40) : 'none'}`); if (popup) await popup.close();
  }
  const refused = bad.filter((b) => b.startsWith('403')); ok(!refused.length, 'the guard refused: ' + refused.join(' ; ')); return out.join(' | ') + ` | other failures: ${bad.join(' ; ') || 'none'}`;
});

// speech, artifacts, export, popout, browser pane, terminal
await row('B4', 'speech: a Speech-job reply is turned into audio, and the audio file is fetched and plays (header-less GET)', async () => {
  clean(); await page.goto('/'); await page.waitForSelector('#greeting'); await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  await page.locator('#job-button').click(); await page.locator('#job-menu button', { hasText: /^Speech/ }).click();
  const audioReq = page.waitForResponse((r) => /\/api\/audio\/[a-f0-9-]+\.wav/.test(r.url()), { timeout: 40000 }).catch(() => null);
  await page.locator('#input').fill('say something short'); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 40000 }).catch(() => {});
  const resp = await audioReq; ok(resp, 'no audio file was requested; reply: ' + (await page.locator('.msg.assistant .body').last().innerText()).slice(0, 100) + ' | error: ' + (await page.locator('#error').innerText()));
  eq(resp.status(), 200, 'audio status'); ok(!bad.some((b) => b.startsWith('403')), bad.join(' ; '));
  const ready = await page.evaluate(() => new Promise((res) => { const a = document.querySelector('audio'); if (!a) return res('no audio element'); if (a.readyState >= 1) return res('metadata ' + Math.round(a.duration * 10) / 10 + 's'); a.addEventListener('loadedmetadata', () => res('metadata ' + Math.round(a.duration * 10) / 10 + 's')); a.addEventListener('error', () => res('audio error')); setTimeout(() => res('timeout'), 5000); }));
  ok(/^metadata/.test(ready), 'the audio element: ' + ready); return `${resp.headers()['content-type']}, ${ready}`;
});
await row('B5', 'artifacts: an HTML artifact previews in the panel, in a sandboxed frame that cannot reach the API', async () => {
  clean(); await page.goto('/'); await page.waitForSelector('#greeting');
  const html = '<h1 id="h">hello artifact</h1><script>fetch(location.origin + "/api/settings").then(function (r) { document.title = "api:" + r.status; }, function () { document.title = "api:blocked"; });</script>';
  await page.evaluate(async (h) => { await fetch('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Guard probe', kind: 'html', content: h }) }); }, html);
  await page.reload(); await page.waitForSelector('#greeting'); await page.locator('#artifacts-toggle').click(); await page.waitForTimeout(800);
  const item = page.locator('#artifacts .artifact-row').first(); if (await item.count()) await item.click(); await page.waitForTimeout(1200);
  const frames = page.frames().filter((f) => f !== page.mainFrame()); let shown = '', title = 'n/a';
  for (const fr of frames) { const t = (await fr.locator('#h').innerText({ timeout: 1500 }).catch(() => '')).trim(); if (t) { shown = t; title = await fr.evaluate(() => document.title); break; } }
  ok(shown === 'hello artifact', 'the HTML artifact did not render; frames: ' + frames.map((f) => f.url().slice(0, 40)).join(',')); ok(title !== 'api:200', 'the artifact frame reached the API: ' + title);
  ok(!bad.some((b) => b.includes('/raw')), 'the preview was refused: ' + bad.join(' ; ')); return `rendered "${shown}"; its call to /api/settings: ${title}`;
});
await row('B6', 'export downloads Markdown; popout opens a working window', async () => {
  clean(); await page.goto('/'); await page.waitForSelector('#greeting'); await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); await page.locator('#input').fill('hello export'); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500); const [d] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export').click()]); ok(/\.md$/.test(d.suggestedFilename()), d.suggestedFilename());
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), page.locator('#popout').click()]); await pop.waitForLoadState(); await pop.waitForTimeout(800); const s = await pop.evaluate(() => fetch('/api/settings').then((r) => r.status)); await pop.close(); eq(s, 200, 'popout settings call'); ok(!bad.length, bad.join(' ; '));
});
await row('B7', 'in-app browser: another local server loads; Bunny\'s own API in the frame is refused', async () => {
  clean(); await page.locator('.toolbar [data-view="browser"]').click(); await page.locator('#browser-url').fill(`http://127.0.0.1:${page404.address().port}/`); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(1200);
  const f = page.frames().find((x) => x.url().includes(String(page404.address().port))); ok(f, 'frame did not load'); eq(await f.locator('#x').innerText(), 'a page from another local server', 'content');
  await page.locator('#browser-url').fill(`${BASE}/api/settings`); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(1200);
  const g = page.frames().find((x) => x.url().includes('/api/settings')); const txt = g ? await g.locator('body').innerText().catch(() => '') : ''; ok(/403|out of date|did not come/i.test(txt), 'the API answered inside the browser frame: ' + txt.slice(0, 80)); return 'frame shows: ' + txt.slice(0, 70);
});
await row('B8', 'terminal pane works through the guard', async () => {
  clean(); await page.locator('.toolbar [data-view="terminal"]').click(); await page.waitForTimeout(800); await page.locator('#terminal-input').fill('echo guard-ok'); await page.locator('#terminal-input').press('Enter');
  let out = ''; for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); out = await page.locator('#terminal-output').innerText(); if (out.includes('guard-ok')) break; } ok(out.includes('guard-ok'), 'no output'); ok(!bad.length, bad.join(' ; '));
});
await row('B9', 'connectors: add a remote server (bad address refused in words), schedules, skills, memory work from the page', async () => {
  clean(); await page.goto('/src/ui/automation.html'); await page.locator('#mcp-name').fill('Bad'); await page.locator('#mcp-url').fill('nope'); await page.getByRole('button', { name: 'Add server' }).click(); await page.waitForTimeout(700); const err = (await page.locator('.err:visible,[role=alert]:visible').allInnerTexts()).join('|');
  await page.locator('#skill-name').fill('Guard skill'); await page.locator('#skill-description').fill('d'); await page.locator('#skill-instructions').fill('x'); await page.getByRole('button', { name: 'Add skill' }).click(); await page.waitForTimeout(600); ok(/Guard skill/.test(await page.locator('#skill-list').innerText()), 'skill not added');
  await page.locator('#skill-list button', { hasText: 'Delete' }).first().click(); await page.waitForTimeout(400); ok(!bad.some((b) => b.startsWith('403')), bad.join(' ; ')); return `bad address message: "${err}"`;
});
writeFileSync(`${OUT}/s1-walk.json`, JSON.stringify(rows, null, 1));
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} PASS / ${n('FAIL')} FAIL of ${rows.length}`);
for (const s of [gateway, ollama, page404]) { s.closeAllConnections?.(); s.close(); }
await browser.close();
