/**
 * QA walk for W5-7 (security-relevant writes only from Bunny's window). Invented profile only. The server is started the way Electron
 * starts it (folderPickerOnly), through e2e/w27-desktop-server.mjs, which also offers a tiny relay that plays the Electron main process
 * (app.adminFetch carries the window-only secret). The page gets a stand-in for the preload bridge, window.bunnyDesktop.secureWrite,
 * which calls that relay: so the real screens run, and every write they make to a protected route must go through the bridge.
 *
 *   SRC=<worktree at the commit under test> OUT=<folder> [PORT0=6101] node e2e/w57-walk.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fb1'; const PORT = +(process.env.PORT0 ?? 6101); const NL = String.fromCharCode(10);
const { isWindowOnlyRoute } = await import(pathToFileURL(join(SRC, 'src/server/windowOnly.js')).href);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
let pageRef = null;
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; if (pageRef) { try { await pageRef.screenshot({ path: join(OUT, 'fail-' + id + '.png') }); const btns = await pageRef.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 24)).slice(0, 16).join(' / ')); note += ' [url ' + pageRef.url().replace(/^https?:..[^/]+/, '') + '; buttons: ' + btns + ']'; } catch { /* page gone */ } } }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(8), name, '::', String(note).slice(0, 300));
};

// a scripted model, only to have a permission prompt raised
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const lastUser = body.messages.map((m) => m.role).lastIndexOf('user'); const asked = String(body.messages[lastUser]?.content ?? '');
    const done = body.messages.slice(lastUser).some((m) => m.role === 'tool'); res.writeHead(200, { 'content-type': 'text/event-stream' });
    const tools = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    if (/gitpush/.test(asked)) { res.end((tools === 0 ? frame({ tool_calls: [{ index: 0, id: 'g1', function: { name: 'run_command', arguments: JSON.stringify({ command: 'git ("push") origin main' }) } }] }) : frame({ content: 'Finished with git.' })) + 'data: [DONE]\n\n'); return; }
    if (/askq/.test(asked)) { res.end((tools === 0 ? frame({ tool_calls: [{ index: 0, id: 'q1', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Keep going?', choices: [{ label: 'Keep going', recommended: true }, { label: 'Stop here' }] }) } }] }) : frame({ content: 'You said to carry on.' })) + 'data: [DONE]\n\n'); return; }
    if (/repeat/.test(asked)) { res.end((tools < 6 ? frame({ tool_calls: [{ index: 0, id: 'r' + tools, function: { name: 'run_command', arguments: JSON.stringify({ command: 'Write-Output same' }) } }] }) : frame({ content: 'Repeated enough.' })) + 'data: [DONE]\n\n'); return; }
    const out = /run it/.test(asked) && !done ? frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: JSON.stringify({ command: 'Write-Output ran-ok' }) } }] }) : frame({ content: 'Hello from the scripted model. ' + (done ? 'The command ran.' : '') });
    res.end(out + 'data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port;

const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w57-data-'));
const desk = spawn('node', ['e2e/w27-desktop-server.mjs'], { env: { ...process.env, SRC, DATA: dataDir, PORT: String(PORT), TOKEN, BUNNY_FAKE_UPSTREAM: '1' }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const http = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b == null ? undefined : JSON.stringify(b) });
const relay = async (path, method, body) => { const r = await (await fetch(`http://127.0.0.1:${PORT + 1000}`, { method: 'POST', body: JSON.stringify({ path, method, body }) })).json(); let data = {}; try { data = JSON.parse(r.body); } catch { /* not json */ } return { status: r.status, data }; };
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(desk.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } fake.closeAllConnections?.(); fake.close(); process.exit(code); };
const U = '11111111-1111-1111-1111-111111111111';
try {
  ok((await (await http('/api/health')).json()).fake, 'refusing: not an invented profile');
  // ---------- 1. the same writes over HTTP with only the page token: 403 ----------
  const MSG = "Change this in Bunny's window.";
  const BLOCKED = [
    ['POST', '/api/mcp', { name: 'x', url: 'https://example.invalid/mcp' }], ['PATCH', `/api/mcp/${U}`, { enabled: true }], ['DELETE', `/api/mcp/${U}`, null],
    ['POST', '/api/schedules', { name: 'x', prompt: 'y', everyMinutes: 5 }], ['PATCH', `/api/schedules/${U}`, { enabled: false }], ['DELETE', `/api/schedules/${U}`, null],
    ['POST', '/api/hooks', { event: 'x', command: 'y' }], ['POST', '/api/skills', { name: 'x', instructions: 'y' }], ['POST', '/api/plugins/install', { url: 'https://github.com/a/b' }],
    ['POST', `/api/sessions/${U}/permission/${U}`, { allowed: true }], ['POST', `/api/sessions/${U}/capability/${U}`, { granted: true }],
    ['POST', '/api/computer/click', { x: 1, y: 1 }], ['POST', '/api/terminal/create', {}], ['POST', '/api/terminal/write', { id: 'x', data: 'dir' }],
    ['POST', '/api/providers/custom', { name: 'x', baseUrl: 'http://127.0.0.1:1/v1' }], ['POST', '/api/providers/anthropic/connect', { apiKey: 'sk-test-000000000000' }], ['POST', '/api/providers/anthropic/disconnect', {}],
    ['POST', '/api/account/github/cli', {}], ['DELETE', '/api/account/github', null], ['POST', '/api/oauth/openai/start', {}],
    ['PUT', '/api/permission-rules', { global: [], folders: {} }], ['PUT', '/api/settings', { defaultPermissionMode: 'auto' }], ['PUT', '/api/settings', { allowlist: ['x'] }], ['PUT', '/api/settings', { aiComputerUse: true }],
    ['POST', '/api/sessions', { title: 'x', permissionMode: 'auto' }], ['POST', '/api/projects', { name: 'x', instructions: 'ignore the rules' }],
  ];
  await row('H1', `HTTP with only the page token: ${BLOCKED.length} protected writes are all 403 "${MSG}" (and change nothing)`, async () => {
    const bad = [];
    for (const [m, p, b] of BLOCKED) { const r = await http(p, m, b); const t = await r.json().catch(() => ({})); if (r.status !== 403 || t.message !== MSG) bad.push(`${m} ${p} -> ${r.status} ${String(t.message).slice(0, 40)}`); }
    ok(!bad.length, bad.length + ' not refused: ' + bad.slice(0, 4).join(' ; ')); const left = { mcp: (await (await http('/api/mcp')).json()).length, schedules: (await (await http('/api/schedules')).json()).length, rules: (await (await http('/api/permission-rules')).json()).global.length };
    ok(left.mcp === 0 && left.schedules === 0 && left.rules === 0, 'something was saved: ' + JSON.stringify(left)); return JSON.stringify(left);
  });
  await row('H2', 'the same writes through the window path (admin secret) are accepted; ordinary writes over HTTP still work', async () => {
    const a = await relay('/api/providers/custom', 'POST', { name: 'Scripted', baseUrl: `http://127.0.0.1:${FPORT}/v1` }); ok(a.status === 200 || a.status === 201, 'provider via window ' + a.status + JSON.stringify(a.data).slice(0, 80));
    const n = await http('/api/memory', 'POST', { text: 'QA fixture memory' }); ok(n.status === 200 || n.status === 201, 'memory over HTTP ' + n.status);
    const s = await http('/api/sessions', 'POST', { title: 'ordinary' }); ok(s.status === 200 || s.status === 201, 'session over HTTP ' + s.status);
    const f = await http('/api/settings', 'PUT', { theme: 'dark' }); ok(f.status === 200, 'ordinary settings over HTTP ' + f.status); const mf = await http('/api/settings', 'PUT', { modelFilter: 'all' }); ok(mf.status === 403, 'modelFilter should now be window-only, got ' + mf.status); const mw = await relay('/api/settings', 'PUT', { modelFilter: 'all' }); ok(mw.status === 200, 'modelFilter through the window ' + mw.status); return 'provider via window ok; memory, session, settings over HTTP ok';
  });
  const PID = (await (await http('/api/providers')).json()).find((p) => p.custom)?.id; ok(PID, 'no custom provider');

  // ---------- 2. the real screens through a stand-in for the preload bridge ----------
  browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const page = await ctx.newPage(); pageRef = page; page.on('dialog', (d) => d.accept());
  const bridge = []; await page.exposeFunction('__secureWrite', async (method, path, body) => { const r = await relay(path, method, body); bridge.push(`${method} ${path} ${r.status}`); return r; });
  await page.addInitScript(() => { window.bunnyDesktop = { secureWrite: (m, p, b) => window.__secureWrite(m, p, b) }; });
  const rawProtected = []; page.on('request', (r) => { const m = r.method(); if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return; const u = new URL(r.url()); let body = null; try { body = JSON.parse(r.postData() ?? 'null'); } catch { /* x */ } if (u.origin === BASE && isWindowOnlyRoute(m, u.pathname, body)) rawProtected.push(`${m} ${u.pathname}`); });
  const mark = () => bridge.length;

  await row('W1', 'screens: connectors and schedules (Automation): add a connector, switch it off and on, remove it; add a schedule and remove it', async () => {
    const b0 = mark(); await page.goto('/src/ui/automation.html'); await page.waitForSelector('#mcp-form'); await page.waitForTimeout(500);
    await page.fill('#mcp-name', 'QA connector'); await page.fill('#mcp-url', 'https://example.invalid/mcp'); await page.locator('#mcp-form button[type=submit], #mcp-form button.primary').first().click(); await page.waitForTimeout(800);
    ok((await (await http('/api/mcp')).json()).some((s) => s.name === 'QA connector'), 'connector not saved: ' + (await page.locator('#automation-error').innerText().catch(() => '')));
    const tog = page.locator('#mcp-list input[type=checkbox]').first(); if (await tog.count()) { await tog.click(); await page.waitForTimeout(500); await tog.click(); await page.waitForTimeout(500); }
    await page.locator('#mcp-list').getByRole('button', { name: /remove|delete/i }).first().click(); await page.waitForTimeout(700); ok((await (await http('/api/mcp')).json()).length === 0, 'connector not removed');
    await page.fill('#schedule-name', 'QA schedule'); await page.fill('#schedule-prompt', 'say hi'); await page.locator('#schedule-form button[type=submit], #schedule-form button.primary').first().click(); await page.waitForTimeout(800);
    ok((await (await http('/api/schedules')).json()).some((s) => s.name === 'QA schedule'), 'schedule not saved'); await page.locator('#schedule-list').getByRole('button', { name: /remove|delete/i }).first().click().catch(() => {}); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/w57-automation.png` }); const used = bridge.slice(b0); ok(used.some((x) => x.startsWith('POST /api/mcp ')) && used.some((x) => x.startsWith('POST /api/schedules ')), 'writes did not go through the window: ' + used.join(' | ')); ok(used.every((x) => / 2\d\d$/.test(x)), 'a bridged write failed: ' + used.join(' | ')); return used.join(' | ');
  });
  await row('W2', 'screens: connect a provider (Providers page) and a custom one', async () => {
    const b0 = mark(); await page.goto('/src/ui/providers.html'); await page.waitForTimeout(900);
    const connects = page.locator('button', { hasText: /^.{0,2}Connect/ }); const nBtn = await connects.count(); let opened = false; for (let i = 0; i < nBtn && !opened; i++) { await connects.nth(i).click().catch(() => {}); await page.waitForTimeout(250); opened = await page.locator('#f-anthropic-apiKey').isVisible().catch(() => false); }
    ok(opened, 'the Anthropic key field never opened (' + nBtn + ' connect buttons)'); const input = page.locator('#f-anthropic-apiKey'); await input.fill('sk-test-000000000000'); await input.press('Enter'); await page.waitForTimeout(1500);
    const prov = await (await http('/api/providers')).json(); ok(prov.find((p) => p.id === 'anthropic')?.status === 'connected', 'anthropic not connected: ' + JSON.stringify(prov.find((p) => p.id === 'anthropic')).slice(0, 120));
    await page.screenshot({ path: `${OUT}/w57-providers.png` }); const used = bridge.slice(b0); ok(used.some((x) => x.startsWith('POST /api/providers/anthropic/connect')), 'connect did not go through the window: ' + used.join(' | ')); return used.join(' | ');
  });
  const dis = await relay('/api/providers/anthropic/disconnect', 'POST', {}); ok(dis.status === 200, 'disconnect via the window ' + dis.status); // so the picker offers only the scripted model again
  await row('W3', 'screens: permission rules (Settings): add a rule; it is saved through the window', async () => {
    const b0 = mark(); await page.goto('/src/ui/settings.html'); await page.locator('#perm-rules').waitFor({ timeout: 10000 });
    await page.locator('#rules-kind').selectOption('command'); await page.locator('#rules-pattern').fill('git push*'); await page.locator('#rules-effect').selectOption('ask'); await page.locator('#rules-add-btn').click(); await page.waitForTimeout(800);
    ok((await (await http('/api/permission-rules')).json()).global.some((r) => r.pattern === 'git push*'), 'rule not saved: ' + (await page.locator('#rules-line').innerText())); const used = bridge.slice(b0); ok(used.some((x) => x.startsWith('PUT /api/permission-rules 200')), 'not via the window: ' + used.join(' | ')); return used.join(' | ');
  });
  // chat: a session in Code mode with a folder, made and set up through the window path
  const work = mkdtempSync(join(tmpdir(), 'bunny-w57-')); writeFileSync(join(work, 'README.md'), '# demo' + NL);
  const sess = await http('/api/sessions', 'POST', { title: 'desk chat', providerId: PID, model: 'offline/bunny-code' }); const sid = (await sess.json()).id;
  await relay(`/api/sessions/${sid}/setting/permissionMode`, 'PATCH', { value: 'ask' });
  const chosen = await (await fetch(`http://127.0.0.1:${PORT + 1000}`, { method: 'POST', body: JSON.stringify({ choose: work }) })).json(); const fset = await http(`/api/sessions/${sid}/setting/folder`, 'PATCH', { value: work }); console.log('folder chosen via the picker path:', chosen.status, '; set on the chat:', fset.status);
  await http(`/api/sessions/${sid}/setting/workMode`, 'PATCH', { value: 'code' });
  await row('W4', 'chat: change the permission mode in the UI (Manual to Accept edits): saved through the window', async () => {
    const b0 = mark(); await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); }); await page.goto(`/src/ui/index.html?s=${sid}`); await page.waitForSelector('#input'); await page.waitForTimeout(800);
    await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Accept edits' }).first().click(); await page.waitForTimeout(800);
    const mode = (await (await http('/api/sessions/' + sid)).json()).permissionMode; ok(mode === 'accept', 'mode is ' + mode); const used = bridge.slice(b0); ok(used.some((x) => x.includes('/setting/permissionMode 200')), 'not via the window: ' + used.join(' | ')); return `mode now ${mode}; ` + used.join(' | ');
  });
  await row('W5', 'chat: a command raises a permission prompt; Allow in the UI is answered through the window and the command runs', async () => {
    const b0 = mark(); await relay(`/api/sessions/${sid}/setting/permissionMode`, 'PATCH', { value: 'ask' });
    if (!(await page.locator('#picker-button').innerText()).includes('bunny-code')) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    await page.goto(`/src/ui/index.html?s=${sid}`); await page.waitForSelector('#input'); await page.waitForTimeout(600); await page.locator('#input').fill('run it please'); await page.locator('#send').click();
    await page.waitForSelector('.permission-prompt', { timeout: 15000 }); await page.screenshot({ path: `${OUT}/w57-prompt.png` }); await page.getByRole('button', { name: 'Allow' }).first().click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }); await page.waitForTimeout(500);
    const text = await page.locator('#messages').innerText(); ok(/ran-ok|The command ran/.test(text), 'the command did not run: ' + text.slice(-200)); const used = bridge.slice(b0); ok(used.some((x) => /\/permission\/[a-f0-9-]{36} 200/.test(x)), 'answer not via the window: ' + used.join(' | ')); return used.join(' | ');
  });
  await row('W6', 'chat: open a terminal in the UI (the shell is created through the window)', async () => {
    const b0 = mark(); await page.locator('.toolbar [data-view="terminal"]').click(); await page.waitForTimeout(2500); const used = bridge.slice(b0); await page.screenshot({ path: `${OUT}/w57-terminal.png` });
    ok(used.some((x) => x.startsWith('POST /api/terminal/create 200')), 'terminal not created through the window: ' + (used.join(' | ') || 'no bridged write') + ' | error: ' + (await page.locator('#error').innerText().catch(() => ''))); return used.join(' | ');
  });
  await row('W7', 'ordinary chat, sessions and the Files pane still work in the desktop build', async () => {
    const s2 = await (await http('/api/sessions', 'POST', { title: 'plain' })).json(); await page.goto(`/src/ui/index.html?s=${s2.id}`); await page.waitForSelector('#input'); await page.waitForTimeout(500);
    if (!(await page.locator('#picker-button').innerText()).includes('bunny-code')) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    await page.locator('#input').fill('hello there'); await page.locator('#send').click(); await page.waitForSelector('.msg.assistant .body', { timeout: 15000 }); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }); await page.waitForTimeout(500);
    ok(/Hello from the scripted model/.test(await page.locator('#messages').innerText()), 'no reply');
    const list = await (await http('/api/sessions')).json(); ok(list.length >= 3, 'sessions listing ' + list.length);
    await page.goto(`/src/ui/index.html?s=${sid}`); await page.waitForSelector('#input'); await page.locator('.toolbar [data-view="file"]').click(); await page.waitForTimeout(1200); const files = await page.locator('#file-content').innerText(); ok(/README\.md/.test(files), 'Files pane: ' + files.slice(0, 80));
    await page.screenshot({ path: `${OUT}/w57-files.png` }); return `reply ok, ${list.length} sessions, Files lists README.md`;
  });
  await row('W8', 'no screen made a protected write over plain HTTP (every one went through the window bridge)', async () => { ok(!rawProtected.length, rawProtected.length + ' raw protected writes: ' + [...new Set(rawProtected)].join(' | ')); return `${bridge.length} bridged writes, 0 raw`; });
  // ---- W5-7 final stamp spot-checks ----
  const stream = async (sessionId, text, onEvent) => { const r = await fetch(BASE + '/api/sessions/' + sessionId + '/messages', { method: 'POST', headers: H, body: JSON.stringify({ content: text, providerId: PID, model: 'offline/bunny-code', workMode: 'code' }) }); let buf = ''; const dec = new TextDecoder(); const events = []; for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) !== -1) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (\w+)/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1]; if (!ev) continue; let p = null; try { p = JSON.parse(data); } catch { /* x */ } events.push(ev); await onEvent(ev, p); } } return events; };
  const newSession = async (title) => { const x = await (await http('/api/sessions', 'POST', { title, providerId: PID, model: 'offline/bunny-code' })).json(); await http('/api/sessions/' + x.id + '/setting/folder', 'PATCH', { value: work }); await http('/api/sessions/' + x.id + '/setting/workMode', 'PATCH', { value: 'code' }); await relay('/api/sessions/' + x.id + '/setting/permissionMode', 'PATCH', { value: 'auto' }); return x.id; };
  await row('K1', 'NEW: an unknown settings key is refused with 400 (and nothing is parked); known keys still save', async () => {
    const bad = await http('/api/settings', 'PUT', { theme: 'dark', notARealSetting: 'x' }); const bt = await bad.json().catch(() => ({})); ok(bad.status === 400, 'status ' + bad.status + ' ' + JSON.stringify(bt).slice(0, 120));
    const now = await (await http('/api/settings')).json(); ok(!('notARealSetting' in now), 'the unknown key was stored'); const good = await http('/api/settings', 'PUT', { theme: 'light' }); ok(good.status === 200, 'known key ' + good.status); return JSON.stringify(bt).slice(0, 140);
  });
  await row('K2', 'NEW: a question card (Keep going?) answered over HTTP with the page token is 403, answered from the window the reply continues', async () => {
    const id = await newSession('askq'); let httpStatus = null; let viaWindow = null; let question = '';
    const events = await stream(id, 'askq please', async (ev, p) => { if (ev === 'question') { question = p.question; const r = await http('/api/sessions/' + id + '/question/' + p.id, 'POST', { choices: ['Keep going'] }); httpStatus = r.status; const t = await r.json().catch(() => ({})); ok(t.message === "Change this in Bunny's window." || r.status === 403, 'http body ' + JSON.stringify(t)); const w = await relay('/api/sessions/' + id + '/question/' + p.id, 'POST', { choices: ['Keep going'] }); viaWindow = w.status; } });
    const savedK2 = await (await http('/api/sessions/' + id)).json(); ok(question, 'no question was asked (events: ' + events.slice(-4).join(',') + '; steps ' + savedK2.messages.filter((m) => m.kind === 'tool_call').length + '; last: ' + String(savedK2.messages.at(-1)?.content ?? '').slice(0, 80) + ')'); ok(httpStatus === 403, 'over HTTP: ' + httpStatus); ok(viaWindow === 200, 'from the window: ' + viaWindow); const done = events.includes('done'); ok(done, 'the reply did not finish'); return question.slice(0, 70) + ' | HTTP ' + httpStatus + ', window ' + viaWindow;
  });
  await row('K3', 'NEW: git ("push") origin main under a Deny git push* (computed argument) is not run silently: it asks (a card), in Auto', async () => {
    await relay('/api/permission-rules', 'PUT', { global: [{ kind: 'command', effect: 'deny', pattern: 'git push*' }], folders: {} }); const id = await newSession('gitpush'); const cards = [];
    const events = await stream(id, 'gitpush now', async (ev, p) => { if (ev === 'permission') { cards.push(p); await relay('/api/sessions/' + id + '/permission/' + p.id, 'POST', { allowed: false }); } });
    ok(cards.length === 1, 'cards ' + cards.length + ' events ' + events.slice(-5).join(',')); const saved = await (await http('/api/sessions/' + id)).json(); const step = saved.messages.filter((m) => m.kind === 'tool_call').at(-1); ok(step && step.status !== 'done', 'the command ran: ' + step?.status);
    await relay('/api/permission-rules', 'PUT', { global: [], folders: {} }); return 'card: ' + JSON.stringify(cards[0]).slice(0, 180);
  });
  await row('W9', 'the real Electron preload and main-process handler (secure:write) are not exercised here', async () => { throw new Error('UNKNOWN: needs the Electron shell; the bridge here is a stand-in that calls the same app.adminFetch'); });
  writeFileSync(join(OUT, 'w57.json'), JSON.stringify(rows, null, 1));
  console.log(NL + `${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
  await finish(0);
} catch (e) { console.log('HARNESS ERROR', e.stack); await finish(1); }
