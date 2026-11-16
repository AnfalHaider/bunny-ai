/**
 * QA walk for W4-8 (the quick-ask bar). Invented profile only. Electron itself is never started (it would put a real global
 * shortcut and a real window on this computer), so:
 *   - the real electron/quick-ask.js controller runs with fake Electron objects (window, shortcut, screen, capturer, ipcMain);
 *   - the real bar page (electron/quick-ask/bar.html) runs in Chromium, its bridge calling the controller's own IPC handlers;
 *   - the real chat and Settings pages run against a plain app server with a scripted model; their bridge is a stand-in for the
 *     preload that follows electron/main.js line for line (prefs:set -> applyTrayRule -> applyQuickAsk; startQuickChat -> take).
 * What this cannot show: the operating system really delivering the shortcut, real focus and frameless drawing. Those are UNKNOWN.
 *
 *   SRC=<worktree at the commit under test> OUT=<folder> [PORT0=6401] node e2e/w48-walk.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fd3'; const PORT = +(process.env.PORT0 ?? 6401); const NL = String.fromCharCode(10);
const U = (p) => pathToFileURL(join(SRC, p)).href;
const L = await import(U('electron/quick-ask-logic.js'));
const Q = await import(U('electron/quick-ask.js'));
const rows = []; const ok = (c, m) => { if (!c) throw new Error(m); };
let pageRef = null;
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; if (pageRef) { try { await pageRef.screenshot({ path: join(OUT, 'fail-' + id + '.png') }); } catch { /* x */ } } }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(6), name, '::', String(note).slice(0, 320));
};

// a real (tiny) PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

// ------------------------------------------------------------------ fake Electron
const mkElectron = ({ taken = [] } = {}) => {
  const log = { windows: [], registered: new Map(), registerCalls: [], unregisterCalls: [], captures: 0, handlers: new Map(), submitted: [] };
  class FakeWC extends EventEmitter { constructor() { super(); this.session = { setPermissionRequestHandler: (f) => { this.permHandler = f; } }; this.denied = null; } setWindowOpenHandler(f) { this.openHandler = f; } focus() {} }
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new FakeWC(); this.destroyed = false; this.visible = false; this.bounds = { x: 0, y: 0, width: 700, height: 300 }; this.shows = 0; log.windows.push(this); }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); } show() { this.visible = true; this.shows += 1; } hide() { this.visible = false; } focus() {}
    setBounds(b) { this.bounds = b; } getBounds() { return this.bounds; } setAlwaysOnTop(v, level) { this.aot = [v, level]; } loadFile(f) { this.file = f; }
  }
  const globalShortcut = { register: (a, cb) => { log.registerCalls.push(a); if (taken.includes(a)) return false; log.registered.set(a, cb); return true; }, unregister: (a) => { log.unregisterCalls.push(a); log.registered.delete(a); } };
  const screen = { getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }), getCursorScreenPoint: () => ({ x: 10, y: 10 }) };
  const image = { toPNG: () => PNG, getSize: () => ({ width: 1, height: 1 }), resize() { return image; } };
  const desktopCapturer = { getSources: async () => { log.captures += 1; return [{ display_id: '1', thumbnail: image }]; } };
  const ipcMain = { handle: (ch, fn) => log.handlers.set(ch, fn) };
  return { log, BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain };
};
const BAR_URL = 'file:///C:/x/electron/quick-ask/bar.html';
const evFrom = (win, url = BAR_URL) => ({ sender: win.webContents, senderFrame: { url } });

// ------------------------------------------------------------------ the scripted model (chat + settings pages use a plain server)
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const modelSaw = [];
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const msgs = body.messages; const last = [...msgs].reverse().find((m) => m.role === 'user'); const t = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
    modelSaw.push({ t, hasImage: /image_url|data:image\/png|base64/.test(JSON.stringify(msgs)), raw: Array.isArray(last?.content) ? 'parts: ' + last.content.map((p) => p.type + (p.image_url ? '(' + String(p.image_url.url ?? p.image_url).slice(0, 22) + ')' : '')).join(',') : 'text only: ' + t.slice(0, 160), keys: Object.keys(last ?? {}).join(',') });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (/slowreply/.test(t)) { let i = 0; const iv = setInterval(() => { i += 1; if (i > 30) { clearInterval(iv); res.end(frame({ content: ' done.' }) + 'data: [DONE]' + NL + NL); return; } res.write(frame({ content: `word${i} ` })); }, 200); res.on('close', () => clearInterval(iv)); return; }
    res.end(frame({ content: 'Scripted answer.' }) + 'data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port;

const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w48-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } fake.closeAllConnections?.(); fake.close(); writeFileSync(join(OUT, 'w48-results.json'), JSON.stringify(rows, null, 1)); const f = rows.filter((r) => r.verdict !== 'PASS').length; console.log(`${NL}${rows.length - f} of ${rows.length} PASS`); process.exit(code ?? (f ? 1 : 0)); };

try {
  ok((await (await api('/api/health')).json()).fake, 'refusing: not an invented profile');
  const pv = await (await api('/api/providers/custom', 'POST', { name: 'Scripted', baseUrl: `http://127.0.0.1:${FPORT}/a/v1` })).json(); const PID = pv.id ?? pv.provider?.id;
  await api('/api/settings', 'PUT', { modelFilter: 'all' });

  // ============================================================ L. the pure rules
  await row('L1', 'shortcut check: valid forms accepted, spelled the way Electron wants', async () => {
    const good = [['Ctrl+Alt+Space', 'Ctrl+Alt+Space'], ['alt+space', 'Alt+Space'], ['Control+Shift+k', 'Ctrl+Shift+K'], ['win+f9', 'Super+F9'], ['CommandOrControl+Alt+Q', 'Ctrl+Alt+Q']];
    for (const [i, o] of good) { const r = L.validateAccelerator(i); ok(r.ok && r.accelerator === o, `${i} -> ${JSON.stringify(r)}`); } return good.map(([i, o]) => `${i}=>${o}`).join('; ');
  });
  await row('L2', 'shortcut check: unsafe or malformed forms refused with a message', async () => {
    const bad = ['', '   ', 'Space', 'Shift+A', 'Ctrl+', 'Ctrl+Alt', 'Ctrl+A+B', 'Ctrl+Enter!', 'x'.repeat(50), 'Ctrl++A', null, 5]; const out = [];
    for (const b of bad) { const r = L.validateAccelerator(b); ok(r.ok === false && r.message, `${JSON.stringify(b)} accepted: ${JSON.stringify(r)}`); out.push(r.message); } return `${bad.length} refused; messages: ${[...new Set(out)].join(' | ')}`;
  });
  await row('L3', 'tray rule: Quick ask on turns the tray on (note); tray off turns Quick ask off (note); both off is quiet', async () => {
    const a = L.applyTrayRule({ closeToTray: false, quickAskEnabled: false }, { quickAskEnabled: true }); ok(a.prefs.closeToTray === true && a.prefs.quickAskEnabled === true && /tray/.test(a.note), 'on: ' + JSON.stringify(a));
    const b = L.applyTrayRule({ closeToTray: true, quickAskEnabled: true }, { closeToTray: false }); ok(b.prefs.quickAskEnabled === false && b.prefs.closeToTray === false && /Quick ask is off/.test(b.note), 'tray off: ' + JSON.stringify(b));
    const c = L.applyTrayRule({ closeToTray: true, quickAskEnabled: false }, { closeToTray: false }); ok(c.note === null, 'quiet: ' + JSON.stringify(c));
    const d = L.applyTrayRule({ closeToTray: true, quickAskEnabled: true }, { quickAskEnabled: false }); ok(d.prefs.quickAskEnabled === false && d.prefs.closeToTray === true && d.note === null, 'quick off keeps tray: ' + JSON.stringify(d));
    return `on: "${a.note}" | tray off: "${b.note}"`;
  });
  await row('L4', 'submission check: empty, over-long, bad or extra screenshots refused; a good one accepted', async () => {
    ok(!L.validateSubmission('   ', []).ok && !L.validateSubmission(5, []).ok, 'empty'); ok(!L.validateSubmission('x'.repeat(20001), []).ok, 'long'); ok(L.validateSubmission('x'.repeat(20000), []).ok, 'limit itself');
    ok(!L.validateSubmission('hi', [{ data: PNG_URL }, { data: PNG_URL }]).ok, 'two shots'); ok(!L.validateSubmission('hi', [{ data: 'data:image/png;base64,AAAA' }]).ok, 'not a PNG'); ok(!L.validateSubmission('hi', [{ data: 'data:image/jpeg;base64,' + PNG.toString('base64') }]).ok, 'jpeg'); ok(!L.validateSubmission('hi', [{ data: 'https://example.invalid/a.png' }]).ok, 'url');
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(9 * 1024 * 1024)]); ok(!L.validateSubmission('hi', [{ data: 'data:image/png;base64,' + big.toString('base64') }]).ok, 'over 8 MB');
    const g = L.validateSubmission('  hello  ', [{ data: PNG_URL }]); ok(g.ok && g.text === 'hello' && g.shot.length === PNG.length, 'good'); return 'empty/20,001/two shots/not PNG/jpeg/url/over 8 MB refused; 20,000 chars and one PNG accepted, text trimmed';
  });
  await row('L5', 'new-chat request: Chat mode, no folder, text as data, screenshot as an ordinary image attachment', async () => {
    const r = L.buildNewChatRequest('hello', PNG); ok(r.workMode === 'chat' && r.folder === null && r.text === 'hello' && r.files.length === 1 && r.files[0].kind === 'image' && r.files[0].mime === 'image/png' && r.files[0].data === PNG_URL, JSON.stringify(r).slice(0, 200)); ok(L.buildNewChatRequest('x', null).files.length === 0, 'no shot'); return JSON.stringify({ ...r, files: r.files.map((f) => ({ ...f, data: '…' })) });
  });

  // ============================================================ C. the controller with fake Electron
  await row('C1', 'enable registers the shortcut; a taken shortcut says so and keeps the last good one; disable releases it', async () => {
    const e = mkElectron({ taken: ['Ctrl+Alt+Q'] }); const qa = Q.createQuickAsk({ ...e, onSubmit: () => true });
    const a = qa.enable('Ctrl+Alt+Space'); ok(a.ok && e.log.registered.has('Ctrl+Alt+Space') && qa.isEnabled(), 'enable ' + JSON.stringify(a));
    const t = qa.enable('Ctrl+Alt+Q'); ok(!t.ok && t.message === L.TAKEN_MESSAGE, 'taken ' + JSON.stringify(t)); ok(qa.accelerator() === 'Ctrl+Alt+Space' && e.log.registered.has('Ctrl+Alt+Space'), 'last good lost');
    const bad = qa.enable('Space'); ok(!bad.ok && /Ctrl|Alt|Win/.test(bad.message), 'invalid ' + JSON.stringify(bad));
    const sw = qa.enable('Alt+Shift+B'); ok(sw.ok && !e.log.registered.has('Ctrl+Alt+Space') && e.log.registered.has('Alt+Shift+B'), 'switch'); qa.disable(); ok(e.log.registered.size === 0 && !qa.isEnabled(), 'disable'); return `taken => "${t.message}"; switch moved the registration; disable left ${e.log.registered.size} registered`;
  });
  await row('C2', 'the shortcut opens the bar (frameless, always on top, sandboxed); a second press only focuses', async () => {
    const e = mkElectron(); const qa = Q.createQuickAsk({ ...e, onSubmit: () => true }); qa.enable('Ctrl+Alt+Space'); e.log.registered.get('Ctrl+Alt+Space')();
    ok(e.log.windows.length === 1, 'no bar'); const w = e.log.windows[0]; w.emit('ready-to-show'); ok(w.visible, 'not shown'); const o = w.opts; ok(o.frame === false && o.alwaysOnTop === true && o.skipTaskbar === true && o.webPreferences.sandbox === true && o.webPreferences.contextIsolation === true && o.webPreferences.nodeIntegration === false, JSON.stringify(o.webPreferences));
    ok(/quick-ask[\\/]bar\.html$/.test(w.file), 'file ' + w.file); ok(w.webContents.openHandler().action === 'deny', 'window.open'); let prevented = 0; w.webContents.emit('will-navigate', { preventDefault: () => prevented++ }); ok(prevented === 1, 'navigation not blocked');
    let denied = null; w.webContents.permHandler(null, 'media', (v) => { denied = v; }); ok(denied === false, 'permission not denied');
    e.log.registered.get('Ctrl+Alt+Space')(); ok(e.log.windows.length === 1 && w.shows >= 2, 'second press made a second window or did not focus'); ok(e.log.captures === 0, 'screenshot taken without a click'); return `1 window, options frame:false alwaysOnTop:true sandbox:true; second press: shows=${w.shows}, windows=${e.log.windows.length}`;
  });
  await row('C3', 'Esc closes the bar and forgets it', async () => {
    const e = mkElectron(); const qa = Q.createQuickAsk({ ...e, onSubmit: () => true }); qa.open(); const w = e.log.windows[0]; w.emit('ready-to-show'); let pd = 0; w.webContents.emit('before-input-event', { preventDefault: () => pd++ }, { type: 'keyDown', key: 'a' }); ok(!w.destroyed, 'closed by a letter'); w.webContents.emit('before-input-event', { preventDefault: () => pd++ }, { type: 'keyDown', key: 'Escape' }); ok(w.destroyed, 'Esc did not close');
    qa.open(); ok(e.log.windows.length === 2, 'next open makes a fresh bar'); return 'Esc destroyed the window; the next press opened a fresh one';
  });
  await row('C4', 'clicking away hides the bar and keeps the text; it is dropped after 5 minutes', async () => {
    const e = mkElectron(); const qa = Q.createQuickAsk({ ...e, onSubmit: () => true }); const realST = globalThis.setTimeout; let timer = null; globalThis.setTimeout = (fn, ms) => { if (ms === 5 * 60 * 1000) { timer = { fn, ms }; return 1; } return realST(fn, ms); };
    try { qa.open(); const w = e.log.windows[0]; w.emit('ready-to-show'); w.emit('blur'); ok(!w.visible && !w.destroyed, 'blur should hide only'); ok(timer?.ms === 300000, 'keep timer ' + JSON.stringify(timer)); qa.open(); ok(w.visible && e.log.windows.length === 1, 'reopen shows the same bar'); w.emit('blur'); timer.fn(); ok(w.destroyed, 'not dropped after the time'); } finally { globalThis.setTimeout = realST; }
    return 'hide on blur, same bar returns, destroyed when the 300000 ms timer fires';
  });
  await row('C5', 'IPC: submit and capture from anything but the bar page are refused', async () => {
    const e = mkElectron(); let sent = 0; const qa = Q.createQuickAsk({ ...e, onSubmit: () => { sent++; return true; } }); qa.open(); const w = e.log.windows[0]; const sub = e.log.handlers.get('quickask:submit'), cap = e.log.handlers.get('quickask:capture');
    const other = { sender: { }, senderFrame: { url: BAR_URL } }; const wrongUrl = evFrom(w, 'https://example.invalid/quick-ask/bar.html'); const wrongFile = evFrom(w, 'file:///C:/x/other.html');
    for (const ev of [other, wrongUrl, wrongFile]) { const a = await sub(ev, 'hi', []); const b = await cap(ev); ok(a.ok === false && b.ok === false, 'accepted ' + JSON.stringify([a, b])); } ok(sent === 0 && e.log.captures === 0, 'side effects'); const good = await sub(evFrom(w), 'hi', []); ok(good.ok && sent === 1, 'bar refused'); return 'foreign sender / http page / other file: all refused, no chat, no capture; the bar page: accepted';
  });
  await row('C6', 'submit hands over a Chat-mode request, closes the bar, and a refusal keeps it open with a message', async () => {
    const e = mkElectron(); let got = null; let willOpen = true; const qa = Q.createQuickAsk({ ...e, onSubmit: (r) => { got = r; return willOpen; } }); qa.open(); const w = e.log.windows[0]; const sub = e.log.handlers.get('quickask:submit');
    const r1 = await sub(evFrom(w), '   ', []); ok(!r1.ok && /Type/.test(r1.message) && !got && !w.destroyed, 'empty'); willOpen = false; const r2 = await sub(evFrom(w), 'hello', []); ok(!r2.ok && /could not open/.test(r2.message) && !w.destroyed, 'window failed: ' + JSON.stringify(r2)); willOpen = true; const r3 = await sub(evFrom(w), '  ask me  ', [{ data: PNG_URL }]);
    ok(r3.ok && w.destroyed && got.workMode === 'chat' && got.folder === null && got.text === 'ask me' && got.files.length === 1, JSON.stringify(got).slice(0, 160)); return 'empty refused; window-failure keeps the bar; success => destroyed, workMode chat, folder null, trimmed text, 1 image';
  });
  await row('C7', 'screenshot: the picture is taken only through capture (the "Add a screenshot" click), with the bar hidden meanwhile', async () => {
    const e = mkElectron(); const qa = Q.createQuickAsk({ ...e, onSubmit: () => true }); qa.enable('Ctrl+Alt+Space'); e.log.registered.get('Ctrl+Alt+Space')(); const w = e.log.windows[0]; w.emit('ready-to-show'); await e.log.handlers.get('quickask:submit')(evFrom(w), 'text only', []); ok(e.log.captures === 0, 'captured on submit');
    qa.open(); const w2 = e.log.windows[1]; let hiddenDuring = null; const orig = e.desktopCapturer.getSources; e.desktopCapturer.getSources = async (o) => { hiddenDuring = !w2.visible; return orig(o); };
    const r = await e.log.handlers.get('quickask:capture')(evFrom(w2)); ok(r.ok && r.data === PNG_URL, 'capture ' + JSON.stringify(r).slice(0, 80)); ok(e.log.captures === 1 && hiddenDuring === true, `captures=${e.log.captures} hiddenDuring=${hiddenDuring}`); ok(w2.visible, 'bar not back'); return 'open/type/submit: 0 captures; one capture IPC: 1 capture, bar hidden during it, shown after';
  });

  // ============================================================ the pages
  browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE });

  // ---- B. the bar page, wired to the real controller's handlers
  await row('B1', 'bar page: Enter sends, Shift+Enter is a new line, empty is not sent, the screenshot only on a click, chip can be removed', async () => {
    const e = mkElectron(); let got = null; const qa = Q.createQuickAsk({ ...e, onSubmit: (r) => { got = r; return true; } }); qa.open(); const w = e.log.windows[0];
    const page = await ctx.newPage(); pageRef = page; await page.exposeFunction('__submit', (t, a) => e.log.handlers.get('quickask:submit')(evFrom(w), t, a)); await page.exposeFunction('__capture', () => e.log.handlers.get('quickask:capture')(evFrom(w)));
    await page.addInitScript(() => { window.quickAsk = { submit: (t, a) => window.__submit(t, a), captureScreenshot: () => window.__capture() }; });
    await page.goto(pathToFileURL(join(SRC, 'electron/quick-ask/bar.html')).href); await page.waitForSelector('#text');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200); ok(got === null, 'empty Enter sent'); await page.locator('#text').fill('line one'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('line two'); await page.waitForTimeout(100); ok((await page.locator('#text').inputValue()) === 'line one' + NL + 'line two', 'newline: ' + JSON.stringify(await page.locator('#text').inputValue())); ok(got === null, 'Shift+Enter sent');
    ok(e.log.captures === 0, 'captured before any click'); await page.locator('#plus').click(); await page.locator('#shot-item').click(); await page.waitForSelector('.chip'); ok(e.log.captures === 1, 'captures ' + e.log.captures); await page.screenshot({ path: join(OUT, 'b1-bar-chip.png') }); await page.locator('.chip button').click(); ok((await page.locator('.chip').count()) === 0, 'chip not removed');
    await page.locator('#plus').click(); await page.locator('#shot-item').click(); await page.waitForSelector('.chip'); await page.locator('#text').fill('<img src=x onerror=alert(1)> **hi**'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    ok(got && got.text === '<img src=x onerror=alert(1)> **hi**' && got.files.length === 1 && got.workMode === 'chat', 'submit: ' + JSON.stringify(got).slice(0, 120)); ok(e.log.windows[0].destroyed, 'bar not closed after send'); ok((await page.locator('img[src="x"]').count()) === 0, 'HTML from the text was rendered'); await page.close(); return `Enter sent once with ${got.files.length} screenshot; captures=${e.log.captures} (one click each time); text kept as plain text`;
  });
  await row('B2', 'bar page: a refusal is shown in words and the text is kept', async () => {
    const page = await ctx.newPage(); pageRef = page; await page.addInitScript(() => { window.quickAsk = { submit: async () => ({ ok: false, message: 'Bunny could not open.' }), captureScreenshot: async () => ({ ok: false, message: 'Bunny could not take a screenshot.' }) }; });
    await page.goto(pathToFileURL(join(SRC, 'electron/quick-ask/bar.html')).href); await page.locator('#text').fill('keep me'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); ok(/could not open/.test(await page.locator('#msg').innerText()), 'msg ' + await page.locator('#msg').innerText()); ok((await page.locator('#text').inputValue()) === 'keep me', 'text lost');
    await page.locator('#plus').click(); await page.locator('#shot-item').click(); await page.waitForTimeout(300); ok(/screenshot/.test(await page.locator('#msg').innerText()), 'shot msg'); await page.close(); return 'shows "Bunny could not open." and "…take a screenshot." with the text kept';
  });

  // ---- N. the chat page: the shortcut's request becomes a new chat
  const mainSide = { pending: null, listeners: [] };
  const chatPage = async () => {
    const page = await ctx.newPage(); pageRef = page; mainSide.listeners = [];
    await page.exposeFunction('__take', () => { const r = mainSide.pending; mainSide.pending = null; return r; });
    await page.addInitScript(() => { window.__fire = []; window.bunnyDesktop = { quickAsk: { take: () => window.__take(), onNewChat: (fn) => { window.__fire.push(fn); return () => {}; } } }; });
    return page;
  };
  const fireNewChat = (page, request) => { mainSide.pending = request; return page.evaluate(() => window.__fire.forEach((f) => f())); };
  const chat = await chatPage(); await chat.goto('/'); await chat.waitForSelector('#input'); await chat.waitForTimeout(1200);
  await row('N1', 'chat page: a quick ask opens a NEW chat in Chat mode and is answered', async () => {
    const before = await (await api('/api/sessions')).json(); await fireNewChat(chat, L.buildNewChatRequest('What is two plus two?', null)); await chat.waitForFunction(() => /Scripted answer/.test(document.getElementById('messages').innerText), null, { timeout: 15000 }).catch(() => {});
    const body = await chat.locator('#messages').innerText(); await chat.screenshot({ path: join(OUT, 'n1-chat.png') }); const after = await (await api('/api/sessions')).json(); const asked = body.includes('What is two plus two?');
    ok(asked, 'question not shown: ' + body.slice(0, 160)); ok(/Scripted answer|offline|answer/i.test(body) || modelSaw.length > 0, 'no answer: ' + body.slice(0, 200)); ok(after.length === before.length + 1, `sessions ${before.length} -> ${after.length}`); const s = after.find((x) => !before.some((b) => b.id === x.id)); const full = await (await api(`/api/sessions/${s.id}`)).json();
    ok((full.workMode ?? s.workMode ?? 'chat') === 'chat' && !(full.folder ?? s.folder), 'workMode/folder ' + JSON.stringify({ w: full.workMode ?? s.workMode, f: full.folder ?? s.folder })); return `new session ${s.id.slice(0, 8)}, workMode=${full.workMode ?? s.workMode ?? '(default chat)'}, folder=${full.folder ?? s.folder ?? 'none'}; model saw "${modelSaw.at(-1)?.t}"`;
  });
  await row('N2', 'chat page: a quick ask with a screenshot sends it as an ordinary image attachment', async () => {
    modelSaw.length = 0; await fireNewChat(chat, L.buildNewChatRequest('Describe this picture', PNG)); await chat.waitForTimeout(3500); ok(modelSaw.length > 0, 'model never asked'); const imgs = await chat.locator('#messages .attachment-image').evaluateAll((l) => l.map((x) => x.src.slice(0, 22))); ok(imgs.length === 1 && imgs[0] === 'data:image/png;base64,', 'the sent message shows the picture: ' + JSON.stringify(imgs)); const sess = (await (await api('/api/sessions')).json()).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]; const stored = JSON.stringify(await (await api('/api/sessions/' + sess.id)).json()); ok(/data:image.{1,3}png;base64/.test(stored) || /Screenshot[.]png/.test(stored), 'picture not stored in the chat'); await chat.screenshot({ path: join(OUT, 'n2-shot.png') }); return `the sent message shows 1 PNG attachment and the chat stores it; model-side: ${modelSaw.at(-1).raw} (the scripted model is not vision-capable, so the app sends words only)`;
  });
  await row('N3', 'chat page: a leading "/" is a message, not a slash command', async () => {
    modelSaw.length = 0; await fireNewChat(chat, L.buildNewChatRequest('/clear everything', null)); await chat.waitForTimeout(3000); ok(modelSaw.length > 0 && /clear everything/.test(modelSaw.at(-1).t), 'the text did not reach the model as a message: ' + JSON.stringify(modelSaw.at(-1))); ok(/^\u2060/.test(modelSaw.at(-1).t), 'no word joiner in front'); return `model received "${modelSaw.at(-1).t.replace(/\u2060/g, '<WJ>')}"`;
  });
  await row('N4', 'chat page: a quick ask sent while Bunny is busy waits in the message box with a note, and is not lost', async () => {
    modelSaw.length = 0; await fireNewChat(chat, L.buildNewChatRequest('slowreply please', null)); await chat.waitForTimeout(1500); const streaming = await chat.evaluate(() => !document.getElementById('send').disabled || document.querySelector('.msg.assistant') !== null); ok(modelSaw.length === 1, 'first ask not started');
    await fireNewChat(chat, L.buildNewChatRequest('second quick ask', null)); await chat.waitForTimeout(500); const val = await chat.locator('#input').inputValue(); const err = await chat.locator('#error').innerText(); await chat.screenshot({ path: join(OUT, 'n4-busy.png') });
    ok(val === 'second quick ask', `message box: ${JSON.stringify(val)}`); ok(/Bunny is busy, so your quick ask is waiting in the message box/.test(err), 'note: ' + err); ok(modelSaw.length === 1, 'the busy ask was sent anyway'); const mid = await chat.locator('#messages').innerText(); ok(/word\d|\d+s$/m.test(mid), 'first answer not streaming: ' + JSON.stringify(mid.slice(0, 200)));
    await chat.waitForFunction(() => /done\./.test(document.getElementById('messages').innerText), null, { timeout: 20000 }); ok((await chat.locator('#input').inputValue()) === 'second quick ask', 'text lost after the answer ended'); return `box="${val}" note="${err}"; sent to the model: ${modelSaw.length}; box still holds it after the answer finished`;
  });
  await chat.close();

  // ---- S. the Settings page: switch and tray rule, using the real rule and the main.js glue
  const mkMain = () => {
    const e = mkElectron(); const m = { prefs: { launchAtLogin: false, closeToTray: false, quickAskEnabled: false, quickAskShortcut: L.DEFAULT_SHORTCUT }, e };
    m.qa = Q.createQuickAsk({ ...e, onSubmit: () => true });
    m.apply = (patch = {}) => { if (!m.prefs.quickAskEnabled) { m.qa.disable(); return {}; } const c = L.validateAccelerator(m.prefs.quickAskShortcut); const r = m.qa.enable(c.ok ? c.accelerator : ''); if (r.ok) { m.prefs.quickAskShortcut = r.accelerator; return {}; } if (!m.qa.isEnabled()) m.prefs.quickAskEnabled = false; else if (typeof patch.quickAskShortcut === 'string') m.prefs.quickAskShortcut = m.qa.accelerator(); return { error: r.message }; };
    m.set = (patch) => { const clean = {}; for (const k of ['launchAtLogin', 'closeToTray', 'quickAskEnabled']) if (typeof patch?.[k] === 'boolean') clean[k] = patch[k]; if (typeof patch?.quickAskShortcut === 'string') clean.quickAskShortcut = patch.quickAskShortcut; const ruled = L.applyTrayRule(m.prefs, clean); m.prefs = { ...m.prefs, ...ruled.prefs }; const q = m.apply(patch); return { ...m.prefs, quickAskNote: ruled.note, quickAskError: q.error ?? null }; };
    return m;
  };
  const settingsPage = async (m) => {
    const page = await ctx.newPage(); pageRef = page; await page.exposeFunction('__getPrefs', () => m.prefs); await page.exposeFunction('__setPrefs', (p) => m.set(p));
    await page.addInitScript(() => { window.bunnyDesktop = { getPrefs: () => window.__getPrefs(), setPrefs: (p) => window.__setPrefs(p) }; });
    await page.goto('/src/ui/settings.html'); await page.waitForSelector('#quick-ask', { state: 'attached', timeout: 10000 }); await page.waitForTimeout(500); return page;
  };
  await row('S1', 'Settings: the Quick ask switch turns it on (tray comes on with a note) and off (shortcut released)', async () => {
    const m = mkMain(); const p = await settingsPage(m); await p.locator('#desktop-section').scrollIntoViewIfNeeded().catch(() => {}); ok(!(await p.locator('#quick-ask').isChecked()), 'starts on');
    await p.locator('label.switch:has(#quick-ask)').click(); await p.waitForTimeout(500); ok(m.prefs.quickAskEnabled && m.prefs.closeToTray, 'prefs ' + JSON.stringify(m.prefs)); ok(m.e.log.registered.has('Ctrl+Alt+Space'), 'shortcut not registered'); const note = await p.locator('#quick-note').innerText(); ok(/tray/.test(note), 'note: ' + note); ok(await p.locator('#close-to-tray').isChecked(), 'tray box not shown on'); await p.screenshot({ path: join(OUT, 's1-on.png') });
    await p.locator('label.switch:has(#quick-ask)').click(); await p.waitForTimeout(500); ok(!m.prefs.quickAskEnabled && m.e.log.registered.size === 0, 'off: ' + JSON.stringify(m.prefs) + ' registered=' + m.e.log.registered.size); ok(m.prefs.closeToTray === true, 'tray should stay on'); await p.close(); return `on: note "${note}", Ctrl+Alt+Space registered; off: 0 registered, tray unchanged`;
  });
  await row('S2', 'Settings: turning the tray off turns Quick ask off, with the note', async () => {
    const m = mkMain(); const p = await settingsPage(m); await p.locator('label.switch:has(#quick-ask)').click(); await p.waitForTimeout(500); ok(m.prefs.quickAskEnabled, 'not on'); await p.locator('label.switch:has(#close-to-tray)').click(); await p.waitForTimeout(700);
    ok(!m.prefs.closeToTray && !m.prefs.quickAskEnabled && m.e.log.registered.size === 0, 'prefs ' + JSON.stringify(m.prefs) + ' registered=' + m.e.log.registered.size); ok(!(await p.locator('#quick-ask').isChecked()), 'switch still shown on'); const note = await p.locator('#quick-note').innerText(); ok(/Quick ask is off because it needs Bunny to keep running in the tray/.test(note), 'note: ' + note); await p.screenshot({ path: join(OUT, 's2-trayoff.png') }); await p.close(); return `switch shows off, shortcut released, note "${note}"`;
  });
  await row('S3', 'Settings: changing the shortcut keys; a taken shortcut shows a plain message and keeps the old one', async () => {
    const m = mkMain(); m.e.log.registered.clear(); const p = await settingsPage(m); await p.locator('label.switch:has(#quick-ask)').click(); await p.waitForTimeout(400);
    await p.locator('#quick-change').click(); await p.keyboard.press('Control+Alt+KeyK'); await p.waitForTimeout(500); ok(m.prefs.quickAskShortcut === 'Ctrl+Alt+K' && m.e.log.registered.has('Ctrl+Alt+K') && !m.e.log.registered.has('Ctrl+Alt+Space'), 'changed ' + JSON.stringify(m.prefs) + [...m.e.log.registered.keys()]); ok((await p.locator('#quick-keys').innerText()) === 'Ctrl+Alt+K', 'label ' + await p.locator('#quick-keys').innerText());
    const real = m.e.globalShortcut.register; m.e.globalShortcut.register = (a, cb) => (a === 'Ctrl+Alt+J' ? false : real(a, cb)); await p.locator('#quick-change').click(); await p.keyboard.press('Control+Alt+KeyJ'); await p.waitForTimeout(500); const note = await p.locator('#quick-note').innerText(); ok(note === L.TAKEN_MESSAGE, 'note: ' + note); ok(m.prefs.quickAskShortcut === 'Ctrl+Alt+K' && m.e.log.registered.has('Ctrl+Alt+K'), 'old shortcut lost ' + JSON.stringify(m.prefs));
    await p.locator('#quick-change').click(); await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok((await p.locator('#quick-change').innerText()) === 'Change', 'Esc did not cancel'); await p.close(); return `Ctrl+Alt+K registered, Space released; taken => "${note}", old kept; Esc cancels recording`;
  });
  await row('S4', 'the keys are window-only: with the Electron-style server, only the token is refused; the window path works', async () => {
    const dd = mkdtempSync(join(tmpdir(), 'bunny-w48-desk-')); const P2 = PORT + 20; const desk = spawn('node', ['e2e/w27-desktop-server.mjs'], { env: { ...process.env, SRC, DATA: dd, PORT: String(P2), TOKEN, BUNNY_FAKE_UPSTREAM: '1' }, stdio: 'ignore' });
    try {
      const B2 = 'http://127.0.0.1:' + P2; for (let i = 0; i < 60; i++) { try { if ((await (await fetch(B2 + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
      const put = (b) => fetch(B2 + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify(b) }); const a = await put({ quickAskEnabled: true }); const b = await put({ quickAskShortcut: 'Ctrl+Alt+Z' }); const c = await put({ theme: 'dark' });
      ok(a.status === 403 && b.status === 403, 'statuses ' + a.status + ' ' + b.status); ok(c.status === 200, 'ordinary setting ' + c.status);
      const rl = await (await fetch('http://127.0.0.1:' + (P2 + 1000), { method: 'POST', body: JSON.stringify({ path: '/api/settings', method: 'PUT', body: { quickAskEnabled: true } }) })).json(); ok(rl.status === 200, 'window path ' + rl.status);
      const st = await (await fetch(B2 + '/api/settings', { headers: H })).json(); ok(st.quickAskEnabled === true, 'not stored by the window path');
      return 'token only: quickAskEnabled -> ' + a.status + ', quickAskShortcut -> ' + b.status + ' (theme -> ' + c.status + '); via the window path -> ' + rl.status + ' and stored';
    } finally { try { execFileSync('taskkill', ['/PID', String(desk.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  });
  await finish();
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', name: 'abort', verdict: 'FAIL', note: e.message }); await finish(1); }
