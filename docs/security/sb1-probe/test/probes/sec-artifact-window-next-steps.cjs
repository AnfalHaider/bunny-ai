// Security probe for SB-1 (3e8f598): what an artifact window can do NEXT. Same REAL preload.cjs and own-pages.js (copied from the branch beside this file),
// the REAL raw CSP (with allow-popups), and main.js's guard: setWindowOpenHandler AND will-navigate on every web contents. Invented userData only.
const { app, BrowserWindow, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'bunny-sec-sb1-')));
const PRELOAD = join(__dirname, '..', '..', 'electron', 'preload.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const check = (name, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 160)}]` : ''}`);

async function main() {
  await app.whenReady();
  const rules = await import(pathToFileURL(join(__dirname, '..', '..', 'electron', 'own-pages.js')).href);
  const server = createServer((req, res) => {
    const raw = req.url.startsWith('/api/artifacts/');
    res.writeHead(200, { 'content-type': 'text/html', ...(raw ? { 'content-security-policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups' } : {}) });
    res.end(`<title>${req.url}</title><body>page ${req.url}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const isOwn = (u) => rules.isOwnPage(String(u ?? ''), origin);
  const bunnyPreferences = () => ({ preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false });
  const external = [];
  const ipcFrom = [];
  ipcMain.handle('secure:write', (event) => { const from = event.senderFrame?.url ?? ''; ipcFrom.push(from); return isOwn(from) ? 'ACCEPTED' : 'REFUSED'; });
  const created = [];
  app.on('web-contents-created', (_e, c) => {
    c.setWindowOpenHandler(({ url }) => {
      const kind = rules.openDecision(url, origin);
      if (kind === 'bunny' || kind === 'plain') return { action: 'allow', overrideBrowserWindowOptions: { show: false, ...rules.childWindowOptions(kind, { bunnyPreferences }) } };
      if (kind === 'web') external.push(url);
      return { action: 'deny' };
    });
    c.on('will-navigate', (event, url) => { if (!rules.navigationAllowed(url, origin)) { event.preventDefault(); if (/^https?:\/\//i.test(url)) external.push(url); } });

  });
  app.on('browser-window-created', (_e, w) => created.push(w));
  const find = (part) => created.find((w) => !w.isDestroyed() && w.webContents.getURL().includes(part));
  const typeOf = (w) => w.webContents.executeJavaScript('typeof window.bunnyDesktop');

  const main = new BrowserWindow({ show: false, webPreferences: bunnyPreferences() });
  await main.loadURL(`${origin}/src/ui/index.html?s=abc#top`);
  check('own page with ?query and #hash has the bridge', (await typeOf(main)) === 'object');

  await main.webContents.executeJavaScript(`window.open('/api/artifacts/a1/raw', '_blank', 'noopener'); 0`);
  await wait(1000);
  const art = find('/api/artifacts/a1/raw');
  if (!art) console.log('DEBUG windows:', created.map((w) => w.webContents.getURL()), 'external:', external);
  check('artifact window opened, no bridge', art && (await typeOf(art)) === 'undefined');

  // B. the artifact (CSP allow-popups) opens Bunny's own page, then tries to script it and to steer it
  const b = await art.webContents.executeJavaScript(`(async () => {
    const w = window.open('/src/ui/index.html?s=x', 'victim');
    await new Promise((r) => setTimeout(r, 1200));
    let reach; try { reach = typeof w.bunnyDesktop + ' / ' + typeof w.document; } catch (e) { reach = 'blocked: ' + e.name; }
    try { w.location = '/api/artifacts/evil/raw'; } catch (e) {}
    return reach;
  })()`);
  await wait(1200);
  check('artifact cannot script the Bunny window it opened', String(b).startsWith('blocked'), b);
  const victim = find('/src/ui/index.html?s=x') ?? find('/api/artifacts/evil/raw');
  if (victim) {
    const url = victim.webContents.getURL().replace(origin, '');
    const t = await typeOf(victim);
    check('steering that window to an artifact address leaves no bridge on an artifact page', !url.startsWith('/api/') || t === 'undefined', `${url} bridge=${t}`);
    if (t === 'object') check('and secure:write there is from an own page', isOwn(victim.webContents.getURL()), url);
  } else check('the Bunny window opened by the artifact exists', false, created.map((w) => w.webContents.getURL()).join(' '));

  // C. the artifact opens another artifact address: plain, no bridge
  await art.webContents.executeJavaScript(`window.open('/api/artifacts/a2/raw', '_blank'); 0`);
  await wait(1000);
  const a2 = find('/api/artifacts/a2/raw');
  check('artifact-opened artifact window has no bridge', a2 && (await typeOf(a2)) === 'undefined');

  // A. the artifact window navigates itself to Bunny's own page: allowed by will-navigate, but the window has no preload
  await art.webContents.executeJavaScript(`location.href = '/src/ui/settings.html'; 0`).catch(() => {});
  await wait(1200);
  const selfNav = art.webContents.getURL().replace(origin, '');
  check('artifact window navigated to an own page still has no bridge', (await typeOf(art)) === 'undefined', selfNav);

  // D. address spellings
  const spell = {
    '/src/ui/../ui/index.html': true, '/src/ui/%2e%2e/ui/index.html': true, '/SRC/UI/INDEX.HTML': false, '/src/ui/index.html/': false,
    '/src/ui/index.html%00': false, '/api/artifacts/x/raw?/src/ui/index.html': false, '/api/artifacts/x/raw#/src/ui/index.html': false,
  };
  for (const [p, want] of Object.entries(spell)) check(`isOwnPage(${p}) is ${want}`, rules.isOwnPage(origin + p, origin) === want);
  check('another port is not own', rules.isOwnPage(`http://127.0.0.1:1/src/ui/index.html`, origin) === false);
  check('localhost spelling is not own', rules.isOwnPage(origin.replace('127.0.0.1', 'localhost') + '/src/ui/index.html', origin) === false);
  check('external hand-offs seen', true, external.join(' ') || 'none');

  for (const line of out) console.log(line);
  const failed = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(failed ? `SEC PROBE FAILED: ${failed} of ${out.length}` : `SEC PROBE PASSED: ${out.length} of ${out.length}`);
  server.close();
  app.exit(failed ? 1 : 0);
}
main().catch((err) => { console.error('probe crashed:', err); app.exit(2); });
