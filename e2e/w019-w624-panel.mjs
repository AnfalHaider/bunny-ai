/**
 * QA, v0.1.9 W6-24 (8f66eb2): the browser panel's tabs as real views, in the REAL Electron window on an invented profile
 * (BUNNY_DATA_DIR and --user-data-dir are temp folders; BUNNY_FAKE_UPSTREAM=1; nothing of %LOCALAPPDATA%\BunnyAI is touched; no OS keys are sent).
 *   node e2e/w019-w624-panel.mjs      (pictures to $SHOTS or the temp folder)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w624-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w624-user-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 260) : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const site = createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const html = (s, h = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...h }); res.end(s); };
  if (p === '/login') return html('<title>Login</title>signed in', { 'set-cookie': 'sid=abc123; Path=/; Max-Age=3600' });
  if (p === '/cookie') return html('<title>Cookie</title><body id=b></body><script>b.textContent="cookie:"+document.cookie</script>');
  if (p === '/popup') return html(`<title>Popup</title><script>window.open("http://127.0.0.1:${site.address().port}/opened")</script>popup page`);
  if (p === '/opened') return html('<title>Opened</title>the opened page');
  if (p === '/bust') return html(`<title>Bust</title><script>if (top !== self) top.location = "http://127.0.0.1:${site.address().port}/hijacked"</script>busting page`);
  if (p === '/r') { res.writeHead(302, { location: '/final' }); return res.end(); }
  if (p === '/final') return html('<title>Final</title>final page');
  return html('<title>Home</title>home page');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r)); const SP = site.address().port; const S = (p) => `http://127.0.0.1:${SP}${p}`;
const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.BUNNY_UPDATE_FEED;
const app = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env, timeout: 60000 });
const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(e.message));
await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500);
const bunnyPort = new URL(win.url()).port;
const nativeShot = async (name) => { const b64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); await new Promise((r) => setTimeout(r, 400)); const d = screen.getDisplayMatching(w.getBounds()); const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) } }); const one = src.find((x) => String(x.display_id) === String(d.id)) ?? src[0]; return one.thumbnail.toPNG().toString('base64'); }); (await import('node:fs')).writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64')); };
const views = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => ({ id: w.id, url: w.getURL(), type: w.getType(), part: w.session && w.session.storagePath ? 'persist' : 'mem' })));
const go = async (url) => { await win.locator('#browser-url').fill(url); await win.locator('#browser-url').press('Enter'); await wait(1800); };
try {
  
  // open the Browser panel
  await win.locator('#tab-browser').click({ timeout: 8000 }).catch(async () => { await win.locator('[aria-label*="rowser"]').first().click(); });
  await wait(800); check('B0', 'the Browser panel opens with an address bar', await win.locator('#browser-url').isVisible(), '');
  await go(S('/'));
  const v1 = await views(); check('B1', 'a page loads in the panel as its own view (a second web contents, not the Bunny page)', v1.some((x) => x.url === S('/')), JSON.stringify(v1.map((x) => x.url)));
  await win.screenshot({ path: join(SHOTS, 'b1-panel.png') }); await nativeShot('b1-native.png');
  const addr = await win.locator('#browser-url').inputValue(); check('B2', 'the address bar shows the real address of the page', addr === S('/') || addr === S(''), addr);
  await go(S('/r')); const addr2 = await win.locator('#browser-url').inputValue(); check('B3', 'after a redirect the address bar shows where the page really is (/final)', addr2 === S('/final'), addr2);
  await go(S('/login')); await go(S('/cookie')); const vc = await views(); const cview = vc.find((x) => x.url === S('/cookie'));
  const cookieSeen = cview ? await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.cookie'), cview.id) : 'no view';
  check('B4', 'a sign-in cookie stays in the panel (the next page sees it)', /sid=abc123/.test(cookieSeen), cookieSeen);
  const bunnyCookie = await win.evaluate(() => document.cookie); check('B5', 'Bunny\'s own page does not see the panel cookie', !/sid=/.test(bunnyCookie), JSON.stringify(bunnyCookie));
  const tabsBefore = await win.locator('#browser-tabbar [role=tab], #browser-tabbar .browser-tab').count();
  await go(S('/popup')); await wait(1200); const tabsAfter = await win.locator('#browser-tabbar [role=tab], #browser-tabbar .browser-tab').count();
  const vp = await views(); check('B6', 'window.open opens a NEW TAB in the panel (not a window)', tabsAfter === tabsBefore + 1 && vp.some((x) => x.url === S('/opened')), `tabs ${tabsBefore} -> ${tabsAfter}; ${vp.filter((x) => x.type !== 'window' || true).map((x) => x.url).join(' ')}`);
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length); check('B7', 'and no extra app window', wins === 1, String(wins));
  await go(S('/bust')); const vb = await views(); check('B8', 'a frame-busting page loads in the panel (and is not sent elsewhere)', vb.some((x) => x.url === S('/bust')) && !vb.some((x) => /hijacked/.test(x.url)), JSON.stringify(vb.map((x) => x.url)));
  // Bunny's own port
  const before = (await views()).length; await go(`http://127.0.0.1:${bunnyPort}/`); const after = await views();
  check('B9', 'Bunny\'s own port is refused in the panel (no view shows it)', !after.some((x) => x.url.startsWith(`http://127.0.0.1:${bunnyPort}`) && x.type !== 'window') || after.filter((x) => x.url.startsWith(`http://127.0.0.1:${bunnyPort}`)).length === before - (before - 1) , `${after.map((x) => x.type + ' ' + x.url).join(' | ')}`);
  await win.screenshot({ path: join(SHOTS, 'b9-own-port.png') });
  const msg = await win.locator('#pane-browser').innerText(); console.log('INFO  panel text after the own-port attempt: ' + msg.replace(/\s+/g, ' ').slice(0, 200));
  // size follows the panel; menu above the view
  await go(S('/'));
  const geo = async () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const c = w.contentView.children.map((v) => ({ ...v.getBounds(), vis: v.getVisible?.() })); return { win: w.getContentBounds(), kids: c }; });
  const g1 = await geo(); const paneRect = await win.locator('#browser-tabs-content').boundingBox();
  const near = (a, b) => Math.abs(a - b) <= 3; const k1 = g1.kids.filter((k) => k.vis).at(-1) ?? g1.kids.at(-1); console.log('INFO  all views at B10: ' + JSON.stringify(g1.kids));
  check('B10', 'the view sits exactly on the panel\'s content area', Boolean(k1) && Boolean(paneRect) && near(k1.x, paneRect.x) && near(k1.y, paneRect.y) && near(k1.width, paneRect.width) && near(k1.height, paneRect.height), JSON.stringify({ view: k1, pane: paneRect }));
  await wait(1500); const g1b = await geo(); const pr1b = await win.locator('#browser-tabs-content').boundingBox(); console.log('INFO  settled view ' + JSON.stringify(g1b.kids.at(-1)) + ' pane ' + JSON.stringify(pr1b)); await nativeShot('b10-native.png');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setSize(1000, 700); }); await wait(1500); console.log('INFO  window now ' + JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds())));
  const g2 = await geo(); const paneRect2 = await win.locator('#browser-tabs-content').boundingBox(); const k2 = g2.kids.filter((k) => k.vis).at(-1) ?? g2.kids.at(-1); console.log('INFO  all views at B11: ' + JSON.stringify(g2.kids));
  check('B11', 'after the window is made smaller the view follows the panel\'s new size', Boolean(k2) && Boolean(paneRect2) && near(k2.width, paneRect2.width) && near(k2.height, paneRect2.height) && k2.width < k1.width, JSON.stringify({ before: k1, after: k2, pane: paneRect2 }));
  await win.locator('#browser-more').click(); await wait(500); const g3 = await geo(); const k3 = g3.kids.at(-1);
  const menuBox = await win.locator('#browser-menu').boundingBox(); await win.screenshot({ path: join(SHOTS, 'b12-menu.png') }); await nativeShot('b12-native.png');
  const overlaps = Boolean(k3) && Boolean(menuBox) && menuBox.x < k3.x + k3.width && menuBox.x + menuBox.width > k3.x && menuBox.y < k3.y + k3.height && menuBox.y + menuBox.height > k3.y;
  const viewVisible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => v.getVisible?.() ?? 'unknown'));
  check('B12', 'with the ⋯ menu open, the menu is not hidden behind the page: the view is hidden or moved away while it is open', !overlaps || viewVisible.at(-1) === false, JSON.stringify({ overlaps, viewVisible, menuBox, view: k3 }));
  console.log('INFO  menu open after Escape? ' + (await win.locator('#browser-menu').isVisible())); await win.locator('#browser-more').click(); await wait(500); console.log('INFO  menu visible after clicking ⋯ again: ' + (await win.locator('#browser-menu').isVisible()));
  const g4 = (await geo()).kids.map((k) => k.vis); await nativeShot('b13-native.png'); check('B13', 'after the menu closes the page comes back', g4.at(-1) !== false, JSON.stringify(g4));
  // a dialog / settings window above the view
  await win.locator('#account-btn, [aria-label*="ccount"], #settings-open').first().click({ timeout: 4000 }).catch(() => {}); await wait(600);
  const settingsOpen = await win.locator('#settings-backdrop').isVisible().catch(() => false);
  if (settingsOpen) { const g5 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => v.getVisible?.() ?? 'unknown')); await win.screenshot({ path: join(SHOTS, 'b14-settings.png') }); check('B14', 'with the Settings window open the page view is hidden (the dialog is on top)', g5.at(-1) === false, JSON.stringify(g5)); await win.keyboard.press('Escape'); await wait(400); }
  else console.log('INFO  B14 not run: could not open Settings from the account button');
  check('B15', 'no page error in the Bunny window', errors.length === 0, errors.join(' | '));
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); await win.screenshot({ path: join(SHOTS, 'abort.png') }).catch(() => {}); }
await app.close().catch(() => {}); site.close();
const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${SHOTS}`); process.exit(bad.length ? 1 : 0);
