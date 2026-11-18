/**
 * QA, v0.1.13 real-window walk: the Quick ask bar, chats opening without a reload (CHAT-SWITCH), a theme change applying at once (THEME-APPLY).
 * REAL Electron, invented profile (BUNNY_DATA_DIR + --user-data-dir). No OS keys are sent: the global shortcut's callback is captured when Quick ask registers it and called
 * in the main process; keys go to the bar page as input events; the model is a scripted OpenAI-compatible server on a local port (a custom provider).
 *   node e2e/w0113-window.mjs [scale]      scale = 1 (default) or 2 (high DPI: --force-device-scale-factor=2)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const SCALE = process.argv[2] ?? '1';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113w-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0113w-user-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const NL = String.fromCharCode(10);

let slow = 0;
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (t) => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + NL + NL);
    const words = 'Here is a quick answer from the scripted model. It has several words so the answer takes a moment to arrive.'.split(' ');
    for (const w of words) { data(w + ' '); if (slow) await wait(slow); }
    res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));

const env = { ...process.env, BUNNY_DATA_DIR: DATA }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.BUNNY_FAKE_UPSTREAM;
const args = [root, '--user-data-dir=' + USER]; if (SCALE !== '1') args.push('--force-device-scale-factor=' + SCALE);
const app = await _electron.launch({ executablePath: exe, args, env, timeout: 90000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
const finish = async (code) => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } try { provider.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed (scale ${SCALE}); pictures in ${SHOTS}`); console.log('=== FAILED ==='); for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`); process.exit(code ?? (bad.length ? 1 : 0)); };
const pageApi = (fnSrc, ...a) => win.evaluate(async ([src, args]) => { const m = await import('/src/ui/api.js'); return new Function('m', 'args', `return (async () => { ${src} })()`)(m, args); }, [fnSrc, a]);

try {
  // stand-ins in the main process: the global shortcut (so the bar can be opened without an OS key), the login item, the browser
  await app.evaluate(({ app: a, globalShortcut, shell }) => {
    globalThis.__hot = null; globalThis.__shortcuts = [];
    globalShortcut.register = (acc, cb) => { globalThis.__shortcuts.push(acc); globalThis.__hot = cb; return true; };
    globalShortcut.unregister = () => {}; globalShortcut.isRegistered = () => true;
    a.setLoginItemSettings = () => {}; shell.openExternal = async () => {};
  });
  // connect the scripted model as a custom provider and make it the default
  const port = provider.address().port;
  const made = await pageApi("const r = await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: args[0], apiKey: 'sk-qa-0000000000' }); return r;", `http://127.0.0.1:${port}/v1`).catch((e) => ({ error: String(e) }));
  console.log('provider:', JSON.stringify(made).slice(0, 200));
  const providers = await pageApi("return await m.getJSON('/api/providers');");
  const custom = (Array.isArray(providers) ? providers : providers.providers ?? []).find((p) => p.custom || /QA Harbor/.test(p.name ?? ''));
  const pid = custom?.id ?? made?.id; console.log('custom provider id:', pid);
  await pageApi("return await m.sendJSON('/api/settings', 'PUT', { providerId: args[0], model: 'qa-model' });", pid).catch(() => {});
  await win.reload(); await wait(2000);

  // ---------------- CHAT-SWITCH: chats open without a reload ----------------
  const ids = [];
  for (const t of ['Chat one', 'Chat two', 'Chat three']) {
    const s = await pageApi("return await m.sendJSON('/api/sessions', 'POST', { title: args[0], providerId: args[1], model: 'qa-model' });", t, pid); ids.push(s.id);
    await pageApi("await m.sendJSON('/api/sessions/' + args[0] + '/messages', 'POST', { content: 'message in ' + args[1], providerId: args[2], model: 'qa-model', workMode: 'chat' }); return 1;", s.id, t, pid).catch(() => {});
  }
  await win.reload(); await wait(2500);
  await win.evaluate(() => { window.__marker = 'same-page'; window.__navs = 0; });
  const titles = ['Chat one', 'Chat two', 'Chat three'];
  const seenText = [];
  for (const t of titles) {
    await win.locator('#history, .sidebar, body').first().locator(`text="${t}"`).first().click().catch(() => {});
    await wait(1200);
    seenText.push(await win.evaluate(() => ({ marker: window.__marker, url: location.href, thread: (document.getElementById('messages')?.innerText ?? '').slice(0, 80) })));
  }
  check('CS-1', 'CHAT-SWITCH: opening three chats one after another keeps the same page (no reload: the marker set before survives)', seenText.every((s) => s.marker === 'same-page'), JSON.stringify(seenText.map((s) => s.marker)));
  check('CS-2', 'CHAT-SWITCH: each chat shows its own messages', seenText.every((s, i) => s.thread.includes(titles[i])) , JSON.stringify(seenText.map((s) => s.thread.slice(0, 40))));
  check('CS-3', 'CHAT-SWITCH: the address names the opened chat', /[?&]s=/.test(seenText[2].url), seenText[2].url);

  // ---------------- THEME-APPLY: a theme change applies at once ----------------
  await win.locator('#settings-open').click(); await wait(600);
  await win.locator('#settings-nav-list [data-section="appearance"]').click(); await wait(2000);
  const frame = win.frames().find((f) => f.url().includes('settings.html'));
  const bgNow = () => win.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, marker: window.__marker }));
  const before = await bgNow();
  await frame.locator('#theme').selectOption('dark'); await wait(700);
  const dark = await bgNow();
  await frame.locator('#theme').selectOption('light'); await wait(700);
  const light = await bgNow();
  check('TA-1', 'THEME-APPLY: with Settings still open, choosing Dark turns the main window dark at once, Light turns it back (no reload)', dark.t === 'dark' && light.t === 'light' && dark.bg !== light.bg && dark.marker === 'same-page' && light.marker === 'same-page', JSON.stringify({ before, dark, light }));
  await win.screenshot({ path: join(SHOTS, `theme-light-s${SCALE}.png`) });
  await win.locator('#settings-close').click(); await wait(400);

  // ---------------- QUICK ASK ----------------
  const qa = await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: true }));
  check('Q-0', 'Quick ask on: the shortcut was registered (captured, no OS key sent)', await app.evaluate(() => Boolean(globalThis.__hot)) && (await app.evaluate(() => globalThis.__shortcuts)).length >= 1, JSON.stringify(qa).slice(0, 160));
  const barPage = async () => { for (let i = 0; i < 30; i++) { const p = app.windows().find((w) => /quick-ask\/bar\.html/.test(w.url())); if (p) return p; await wait(250); } return null; };
  const barInfo = () => app.evaluate(({ BrowserWindow, screen }) => { const b = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Bunny AI quick ask'); if (!b) return null; const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); return { visible: b.isVisible(), bounds: b.getBounds(), work: d.workArea, scale: d.scaleFactor, onTop: b.isAlwaysOnTop() }; });
  const openBar = async () => { await app.evaluate(() => globalThis.__hot()); const p = await barPage(); await wait(900); return p; };
  const sendKey = (keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, [k, m]) => { const b = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Bunny AI quick ask'); if (!b) return false; b.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m }); b.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m }); return true; }, [keyCode, modifiers]);

  for (const theme of ['light', 'dark']) {
    await pageApi("return await m.sendJSON('/api/settings', 'PUT', { theme: args[0], interfaceFont: args[1] });", theme, theme === 'dark' ? 'mono' : 'system');
    let bar = await openBar();
    if (!bar) { check('Q-open-' + theme, `bar opens (${theme})`, false, 'no bar window'); continue; }
    const info = await barInfo();
    const rowBox = await bar.evaluate(() => { const r = document.getElementById('bar').getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), pageH: document.documentElement.scrollHeight, top: Math.round(r.top) }; });
    const look = await bar.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, bar: getComputedStyle(document.getElementById('bar')).backgroundColor, font: getComputedStyle(document.getElementById('text')).fontFamily, html: document.documentElement.dataset.theme ?? '' }));
    await bar.screenshot({ path: join(SHOTS, `bar-${theme}-s${SCALE}.png`) }).catch(() => {});
    if (theme === 'light') {
      check('Q-size', 'bar window: 640 wide (a work area wide enough), only as tall as the pill plus its margin (80 or less; no empty box below it)', info && info.bounds.width === Math.min(640, Math.floor(info.work.width * 0.95)) && info.bounds.height <= 90 && info.bounds.height >= rowBox.h && rowBox.h + 2 * rowBox.top <= info.bounds.height + 2, JSON.stringify({ bounds: info?.bounds, pill: rowBox }));
      check('Q-place', 'bar window: centred across the work area, in the upper fifth, on top of other windows', info && Math.abs((info.bounds.x + info.bounds.width / 2) - (info.work.x + info.work.width / 2)) <= 2 && info.bounds.y < info.work.y + info.work.height * 0.25 && info.onTop, JSON.stringify({ b: info?.bounds, w: info?.work }));
    }
    globalThis['look_' + theme] = look;
    // close for the next theme
    await sendKey('Escape'); await wait(1200);
  }
  const L = globalThis.look_light; const D = globalThis.look_dark;
  check('Q-theme', 'bar follows Settings: Light and Dark give different bar colours, and the interface font setting changes its text font', L && D && L.bar !== D.bar && L.font !== D.font, JSON.stringify({ L, D }));

  // click-away keeps the text
  await pageApi("return await m.sendJSON('/api/settings', 'PUT', { theme: 'light', interfaceFont: 'system' });");
  let bar = await openBar();
  await bar.locator('#text').fill('draft I want to keep'); await wait(300);
  await app.evaluate(({ BrowserWindow }) => { const m = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Bunny AI'); m?.focus(); }); await wait(800);
  let info = await barInfo();
  check('Q-clickaway', 'click away (another Bunny window takes the focus): the bar hides', !info || info.visible === false, JSON.stringify(info?.visible));
  bar = await openBar();
  const kept = bar ? await bar.locator('#text').inputValue() : null; const infoK = await barInfo();
  check('Q-keeptext', 'press the shortcut again: the bar is back with the text kept', kept === 'draft I want to keep', JSON.stringify({ kept, vis: infoK?.visible }));
  // the + menu first (a fresh bar): Esc closes the menu only
  await bar.locator('#plus').click({ timeout: 8000 }).catch(() => {}); await wait(500);
  const menuOpen = await bar.evaluate(() => !document.getElementById('menu').hidden);
  await sendKey('Escape'); await wait(1000);
  const menuAfter = await bar.evaluate(() => !document.getElementById('menu').hidden); const infoM = await barInfo();
  check('Q-esc-menu', 'Esc with the + menu open: closes the menu only, the bar stays', menuOpen && !menuAfter && infoM?.visible === true, JSON.stringify({ menuOpen, menuAfter, vis: infoM?.visible }));
  // answer, stop, copy
  slow = 700;
  await bar.locator('#text').fill('say something'); await bar.locator('#text').press('Enter'); await wait(1500);
  const stopVisible = await bar.evaluate(() => { const g = document.getElementById('go'); const r = g.getBoundingClientRect(); return { label: g.getAttribute('aria-label'), w: r.width, h: r.height, svg: !!g.querySelector('svg rect') }; });
  check('Q-stop', 'while answering the send button is the Stop icon (a square), visible', stopVisible.label === 'Stop' && stopVisible.w > 10 && stopVisible.h > 10 && stopVisible.svg, JSON.stringify(stopVisible));
  await bar.screenshot({ path: join(SHOTS, `bar-answering-s${SCALE}.png`) }).catch(() => {});
  // Esc: first stops the answer, bar stays
  await sendKey('Escape'); await wait(1500);
  info = await barInfo();
  check('Q-esc-stop', 'Esc while answering: stops the answer, the bar stays', info && info.visible === true && (await bar.locator('#go').getAttribute('aria-label')) === 'Send');
  const copy = await bar.evaluate(() => { const c = document.getElementById('copy'); const r = c.getBoundingClientRect(); return { hidden: c.hidden, w: r.width, h: r.height, svg: !!c.querySelector('svg') }; });
  check('Q-copy', 'after an answer the Copy icon is visible', copy.hidden === false && copy.w > 10 && copy.h > 10 && copy.svg, JSON.stringify(copy));
  slow = 0;
  // Esc a third time: bar closes
  await sendKey('Escape'); await wait(1500);
  info = await barInfo();
  check('Q-esc-close', 'Esc with nothing else to do: the bar closes', !info);
  // Ctrl+Enter opens the chat in Bunny
  slow = 0; bar = await openBar();
  await bar.locator('#text').fill('open this one in Bunny'); await bar.locator('#text').press('Enter'); await wait(3500);
  const pre = await barInfo(); const chatReady = await bar.evaluate(() => document.getElementById('ans')?.innerText.slice(0, 40)).catch((e) => 'gone: ' + e.message.slice(0, 40));
  console.log('before Ctrl+Enter:', JSON.stringify({ visible: pre?.visible, chatReady }));
  await sendKey('Enter', ['control']); await wait(2500);
  info = await barInfo();
  const mainText = await win.evaluate(() => document.body.innerText);
  check('Q-ctrlenter', 'Ctrl+Enter after an answer: the bar closes and the chat opens in Bunny\'s window with the question', !info && /open this one in Bunny/.test(mainText), mainText.slice(0, 100).replace(/\s+/g, ' '));
  await win.screenshot({ path: join(SHOTS, `main-after-s${SCALE}.png`) });
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: false }));
} catch (e) { check('W-run', 'real-window walk ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
await finish();
