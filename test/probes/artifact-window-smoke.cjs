// SB-1 probe in the REAL Electron (not run by the unit suite): `npx electron test/probes/artifact-window-smoke.cjs`
// A stand-in server on 127.0.0.1 plays Bunny (its pages and an artifact at /api/artifacts/<id>/raw). The windows are made with the REAL preload.cjs and the REAL
// own-pages.js rules that electron/main.js uses. It prints what really happened: does an artifact window get the desktop bridge, and is secure:write from it refused?
// Uses an invented userData folder only; never Bunny's real profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'bunny-sb1-smoke-')));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PRELOAD = join(__dirname, '..', '..', 'electron', 'preload.cjs');

async function main() {
  await app.whenReady();
  const rules = await import(pathToFileURL(join(__dirname, '..', '..', 'electron', 'own-pages.js')).href);
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', ...(req.url.startsWith('/api/artifacts/') ? { 'content-security-policy': 'sandbox allow-scripts allow-forms allow-modals' } : {}) });
    res.end(`<title>${req.url}</title><body>page ${req.url}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const bunnyPreferences = () => ({ preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false });
  const seen = [];
  // the same rule as main.js: which pages are believed
  ipcMain.handle('secure:write', (event) => {
    const from = event.senderFrame?.url ?? event.sender.getURL();
    seen.push(from);
    return rules.isOwnPage(from, origin) ? 'ACCEPTED' : 'REFUSED';
  });
  const created = [];
  const blocked = [];
  // the same will-navigate rule as main.js: only addresses outside Bunny's own server are turned away
  const guardNavigation = (contents) => contents.on('will-navigate', (event, url) => { if (!rules.navigationAllowed(url, origin)) { event.preventDefault(); blocked.push(url); } });
  const guardWindow = (contents) => contents.setWindowOpenHandler(({ url }) => {
    const kind = rules.openDecision(url, origin);
    if (kind === 'bunny' || kind === 'plain') return { action: 'allow', overrideBrowserWindowOptions: rules.childWindowOptions(kind, { bunnyPreferences }) };
    return { action: 'deny' };
  });
  app.on('web-contents-created', (_e, c) => { if (c.getType() === 'window') { guardWindow(c); guardNavigation(c); } });

  const main = new BrowserWindow({ width: 600, height: 400, x: 0, y: 0, show: false, skipTaskbar: true, focusable: false, webPreferences: bunnyPreferences() });
  main.webContents.on('did-create-window', (w) => created.push(w));
  await main.loadURL(`${origin}/src/ui/index.html`);
  check('the app page has the bridge', (await main.webContents.executeJavaScript('typeof window.bunnyDesktop')) === 'object');

  // 1. "Open" on an artifact: window.open('/api/artifacts/<id>/raw')
  await main.webContents.executeJavaScript(`window.open('/api/artifacts/abc/raw', '_blank'); 0`);
  await wait(1200);
  const art = created.find((w) => w.webContents.getURL().includes('/api/artifacts/'));
  check('the artifact window was opened', Boolean(art), created.map((w) => w.webContents.getURL()).join(' '));
  if (art) {
    check('the artifact window RENDERS its content (its first load was not turned away)', (await art.webContents.executeJavaScript('document.body.innerText')).includes('page /api/artifacts/abc/raw'), blocked.join(' '));
    check('no navigation of the artifact window was refused', blocked.length === 0, blocked.join(' '));
    check('the artifact window has NO desktop bridge', (await art.webContents.executeJavaScript('typeof window.bunnyDesktop')) === 'undefined');
    const tried = await art.webContents.executeJavaScript('(async () => { try { return await window.bunnyDesktop.secureWrite("PATCH", "/api/settings", {}); } catch (e) { return "no bridge: " + e.message; } })()');
    check('secure:write from the artifact window does not work', String(tried).startsWith('no bridge'), tried);
  }

  // an address outside Bunny's server is still turned away from the artifact window
  if (art) {
    await art.webContents.executeJavaScript(`location.href = 'https://example.com/'; 0`).catch(() => {});
    await wait(600);
    check('a navigation to another site is still refused', blocked.includes('https://example.com/'), blocked.join(' '));
  }

  // 2. a pop-out of a real Bunny page keeps its bridge and is believed
  await main.webContents.executeJavaScript(`window.open('/src/ui/settings.html', '_blank'); 0`);
  await wait(1200);
  const page = created.find((w) => w.webContents.getURL().includes('/src/ui/settings.html'));
  check('a Bunny page opened with window.open has the bridge', page && (await page.webContents.executeJavaScript('typeof window.bunnyDesktop')) === 'object');
  if (page) check('and secure:write from it is accepted', (await page.webContents.executeJavaScript('window.bunnyDesktop.secureWrite("PATCH", "/x", {})')) === 'ACCEPTED');

  // 3. defence in depth: the preload INSIDE a page that is not a Bunny page exposes nothing, and main would refuse its sender anyway
  const forced = new BrowserWindow({ width: 300, height: 200, show: false, webPreferences: bunnyPreferences() });
  await forced.loadURL(`${origin}/api/artifacts/zzz/raw`);
  check('even with the preload loaded, an artifact page gets no bridge', (await forced.webContents.executeJavaScript('typeof window.bunnyDesktop')) === 'undefined');
  check('main\'s check refuses an artifact address', rules.isOwnPage(`${origin}/api/artifacts/zzz/raw`, origin) === false);
  check('and an address that only starts like Bunny\'s', rules.isOwnPage(`${origin}.evil.test/src/ui/index.html`, origin) === false);

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`);
  console.log(failed.length ? `PROBE FAILED: ${failed.length} of ${results.length}` : `PROBE PASSED: ${results.length} of ${results.length}`);
  server.close();
  app.exit(failed.length ? 1 : 0);
}
main().catch((err) => { console.error('probe crashed:', err); app.exit(2); });
