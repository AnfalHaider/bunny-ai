/**
 * QA, v0.1.13: Quick ask error states in the REAL window. Invented profile; no OS keys (shortcut captured, keys sent as input events to the bar).
 * Rows: E-none (no model connected), E-500 (the model answers with an error), E-retry (Try again works once the model is back),
 * E-offline (the model cannot be reached), E-ctrlenter (Ctrl+Enter on a card opens the chat).
 * For each card: it is the whole panel (follow-up field and second Open in Bunny hidden), the keys line fits inside the bar, the bar window shows the whole card.
 *   node e2e/w0113-qerr.mjs [scale]
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const SCALE = process.argv[2] ?? '1';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113e-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0113e-user-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 500) : '')); };
const NL = String.fromCharCode(10);
let mode = 'ok';
const handler = (req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    if (mode === 'err500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"the scripted model fell over"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Back again, here is the answer.' } }] }) + NL + NL);
    res.end('data: [DONE]' + NL + NL);
  });
};
const provider = createServer(handler);
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const port = provider.address().port;

const env = { ...process.env, BUNNY_DATA_DIR: DATA }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.BUNNY_FAKE_UPSTREAM;
const args = [root, '--user-data-dir=' + USER]; if (SCALE !== '1') args.push('--force-device-scale-factor=' + SCALE);
const app = await _electron.launch({ executablePath: exe, args, env, timeout: 90000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
const finish = async (code) => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } try { provider.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed (scale ${SCALE}); pictures in ${SHOTS}`); console.log('=== FAILED ==='); for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`); process.exit(code ?? (bad.length ? 1 : 0)); };
const pageApi = (fnSrc, ...a) => win.evaluate(async ([src, args]) => { const m = await import('/src/ui/api.js'); return new Function('m', 'args', `return (async () => { ${src} })()`)(m, args); }, [fnSrc, a]);

try {
  await app.evaluate(({ app: a, globalShortcut, shell }) => {
    globalThis.__hot = null; globalThis.__shortcuts = [];
    globalShortcut.register = (acc, cb) => { globalThis.__shortcuts.push(acc); globalThis.__hot = cb; return true; };
    globalShortcut.unregister = () => {}; globalShortcut.isRegistered = () => true;
    a.setLoginItemSettings = () => {}; shell.openExternal = async () => {};
  });
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: true })); await wait(800);
  const barPage = async () => { for (let i = 0; i < 30; i++) { const p = app.windows().find((w) => /quick-ask\/bar\.html/.test(w.url())); if (p) return p; await wait(250); } return null; };
  const barInfo = () => app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Bunny AI quick ask'); return b ? { visible: b.isVisible(), bounds: b.getBounds() } : null; });
  const openBar = async () => { await app.evaluate(() => globalThis.__hot()); const p = await barPage(); await wait(900); return p; };
  const sendKey = (keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, [k, m]) => { const b = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Bunny AI quick ask'); if (!b) return false; b.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m }); b.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m }); return true; }, [keyCode, modifiers]);
  const ask = async (bar, q) => { await bar.locator('#text').fill(q); await wait(300); await bar.locator('#go').click(); await wait(3500); };
  const cardState = (bar) => bar.evaluate(() => {
    const c = document.getElementById('card'); const cb = c.getBoundingClientRect(); const key = document.getElementById('keyline');
    const barR = document.getElementById('bar').getBoundingClientRect(); const btns = [...c.querySelectorAll('button')].map((b) => b.textContent.trim());
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
    return { cardShown: !c.hidden, title: c.querySelector('.t')?.textContent ?? '', body: c.querySelector('.b')?.textContent ?? '', btns, footShown: vis('foot'), followShown: vis('follow'),
      keys: key?.textContent ?? '', keysFit: key ? key.scrollWidth <= key.clientWidth + 1 && key.getBoundingClientRect().right <= barR.right + 1 : false,
      cardInsideBar: cb.bottom <= barR.bottom + 1 && cb.top >= barR.top - 1, pageScroll: document.documentElement.scrollHeight - window.innerHeight, barH: Math.round(barR.height), barTop: Math.round(barR.top), barBottom: Math.round(barR.bottom), innerH: window.innerHeight, scrollY: Math.round(window.scrollY + document.documentElement.scrollTop + document.body.scrollTop) };
  });
  const whole = async (bar) => { const s = await cardState(bar); const inf = await barInfo(); return { s, bounds: inf?.bounds, wholeOk: Boolean(s.cardShown && !s.footShown && !s.followShown && s.keysFit && s.cardInsideBar && s.pageScroll <= 1 && s.barTop >= 0 && s.barBottom <= s.innerH && s.scrollY === 0 && inf && inf.bounds.height >= s.barBottom) }; };
  const reset = async () => { await sendKey('Escape'); await wait(1500); if ((await barInfo())?.visible) { await sendKey('Escape'); await wait(1200); } };

  // E-none: no provider connected at all
  let bar = await openBar();
  await ask(bar, 'is anyone there');
  let r = await whole(bar); await bar.screenshot({ path: join(SHOTS, `err-none-s${SCALE}.png`) }).catch(() => {});
  check('E-none', 'no model connected: the card says so, its only button is Open Bunny settings, it is the whole panel, the keys line fits and reads Esc closes', r.wholeOk && /No model is connected/.test(r.s.body) && r.s.btns.length === 1 && /Open Bunny settings/.test(r.s.btns[0]) && /Esc closes/.test(r.s.keys), JSON.stringify(r));
  await bar.locator('#card button').first().click(); await wait(2500);
  const settingsUp = await win.evaluate(() => ({ frames: [...document.querySelectorAll('iframe')].map((x) => x.src).join(' ') }));
  check('E-none-open', 'Open Bunny settings: Bunny opens its Settings (Providers) in the main window', /providers|settings/.test(settingsUp.frames), JSON.stringify(settingsUp));
  await win.locator('#settings-close').click().catch(() => {}); await wait(400);
  await reset();

  // connect the model
  const made = await pageApi("return await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: args[0], apiKey: 'sk-qa-0000000000' });", `http://127.0.0.1:${port}/v1`).catch((e) => ({ error: String(e) }));
  const providers = await pageApi("return await m.getJSON('/api/providers');");
  const custom = (Array.isArray(providers) ? providers : providers.providers ?? []).find((p) => p.custom || /QA Harbor/.test(p.name ?? '')); const pid = custom?.id ?? made?.id;
  await pageApi("return await m.sendJSON('/api/settings', 'PUT', { providerId: args[0], model: 'qa-model' });", pid).catch(() => {});
  await win.reload(); await wait(2000);

  // E-500
  mode = 'err500'; bar = await openBar();
  await ask(bar, 'this will fail');
  r = await whole(bar); await bar.screenshot({ path: join(SHOTS, `err-500-s${SCALE}.png`) }).catch(() => {});
  check('E-500', 'model error: the card says Bunny could not answer, offers Try again and Open in Bunny, is the whole panel, the keys line fits', r.wholeOk && /could not answer/i.test(r.s.title) && r.s.btns.some((b) => /Try again/.test(b)) && r.s.btns.some((b) => /Open in Bunny/.test(b)) && /Ctrl\+Enter/.test(r.s.keys), JSON.stringify(r));
  // E-retry: the model is back, Try again answers
  mode = 'ok';
  await bar.locator('#card button', { hasText: 'Try again' }).click(); await wait(3500);
  const after = await bar.evaluate(() => ({ ans: document.getElementById('ans')?.innerText ?? '', cardHidden: document.getElementById('card').hidden }));
  check('E-retry', 'Try again with the model back: the answer arrives and the card goes', /Back again/.test(after.ans) && after.cardHidden, JSON.stringify(after));
  await reset();

  // E-offline: the model cannot be reached (the server is closed)
  await new Promise((res) => { provider.close(res); provider.closeAllConnections?.(); }); await wait(500);
  bar = await openBar();
  await ask(bar, 'anyone out there');
  const first = await whole(bar); await wait(2000);
  r = await whole(bar); r.first = { h: first.s.barH, win: first.bounds?.height }; await bar.screenshot({ path: join(SHOTS, `err-offline-s${SCALE}.png`) }).catch(() => {});
  check('E-offline', 'model unreachable: the card names it (offline or could not answer), offers Try again and Open in Bunny, is the whole panel, the keys line fits', r.wholeOk && /offline|could not answer/i.test(r.s.title) && r.s.btns.some((b) => /Try again/.test(b)) && r.s.btns.some((b) => /Open in Bunny/.test(b)), JSON.stringify(r));
  // Ctrl+Enter from a card opens the chat in Bunny
  await sendKey('Return', ['control']); await wait(2500);
  const inf = await barInfo();
  const chatTxt = await win.evaluate(() => document.body.innerText.slice(0, 600));
  check('E-ctrlenter', 'Ctrl+Enter on an error card: the bar closes and the chat opens in Bunny with the question', (!inf || inf.visible === false) && /anyone out there/.test(chatTxt), chatTxt.slice(0, 200));
  await finish();
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', label: 'script error', ok: false, detail: String(e) }); await finish(1); }
