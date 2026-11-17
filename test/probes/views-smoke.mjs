// W6-24 smoke test in the REAL Electron (not run by the unit suite): `npx electron test/probes/views-smoke.mjs`
// Starts two local pages, opens the panel's views through electron/browserViews.js, and prints what really happened.
// Uses throwaway sessions only (an invented userData folder); never touches the real Bunny profile.
import { app, BrowserWindow, WebContentsView, session } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserViews, PARTITION } from '../../electron/browserViews.js';

app.setPath('userData', mkdtempSync(join(tmpdir(), 'bunny-views-smoke-')));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const serve = (handler) => new Promise((resolve) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port })); });

await app.whenReady();

// B stands in for Bunny's own page (the default session); A for a website (the panel's session)
const B = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>bunny</title><body>bunny page'); });
const A = await serve((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/bust') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Loaded</title><script>if (top !== self) top.location = 'http://127.0.0.1:${B.port}/hijacked'</script>busting page`); return; }
  if (u.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=abc123; Path=/; Max-Age=3600' }); res.end('<title>Login</title>logged in'); return; }
  if (u.pathname === '/cookie') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Cookie</title><body id=b></body><script>b.textContent = "cookie:" + document.cookie</script>'); return; }
  if (u.pathname === '/popup') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Popup</title><script>window.open('http://127.0.0.1:${B.port}/opened')</script>popup page`); return; }
  if (u.pathname === '/file') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>File</title><script>setTimeout(() => { location = "file:///C:/Windows/win.ini" }, 200)</script>tries file'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>A</title>a');
});

const win = new BrowserWindow({ width: 1000, height: 700, show: false });
await win.loadURL(`http://127.0.0.1:${B.port}/`);
const views = createBrowserViews({ WebContentsView, session, getWindow: () => win });
const events = [];
const owner = win.webContents;
const realSend = owner.send.bind(owner);
owner.send = (channel, payload) => { if (channel === 'browser:view-event') events.push(payload); else realSend(channel, payload); };
const windowsBefore = BrowserWindow.getAllWindows().length;

const open = (tab, url) => { views.handle(owner, { op: 'open', tab, url }); views.handle(owner, { op: 'rect', tab, rect: { x: 0, y: 0, width: 800, height: 600 }, visible: true }); };
const text = async (tab) => (await views.control(owner, tab, 'read', {}))?.page?.text ?? '';

// 1. a page that frame-busts loads as the top-level page it now is
open('bunny-tab-1', `http://127.0.0.1:${A.port}/bust`);
await wait(1500);
check('frame-busting page loads and stays', (await text('bunny-tab-1')).includes('busting page'), await text('bunny-tab-1'));

// 2. a sign-in cookie is kept in the panel's partition
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/login` });
await wait(1200);
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/cookie` });
await wait(1200);
const withCookie = await text('bunny-tab-1');
check('the cookie is kept in the view', /cookie:sid=abc123/.test(withCookie), withCookie);

// 3. and Bunny's own page (default session) does not see it
const bunnyCookie = await owner.executeJavaScript('document.cookie');
check('Bunny\'s own page does not see the panel\'s cookie', !String(bunnyCookie).includes('sid='), bunnyCookie);
const cookiesInDefault = await session.defaultSession.cookies.get({});
check('the default session holds no panel cookie', !cookiesInDefault.some((c) => c.name === 'sid'), JSON.stringify(cookiesInDefault.map((c) => c.name)));
const cookiesInPanel = await session.fromPartition(PARTITION).cookies.get({});
check('the panel session holds it', cookiesInPanel.some((c) => c.name === 'sid'), JSON.stringify(cookiesInPanel.map((c) => c.name)));

// 4. a window.open becomes a new-tab event, not a window
events.length = 0;
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/popup` });
await wait(1500);
check('window.open becomes a new-tab event', events.some((e) => e.event === 'new-tab' && e.url === `http://127.0.0.1:${B.port}/opened`), JSON.stringify(events.filter((e) => e.event === 'new-tab')));
check('and no new app window opened', BrowserWindow.getAllWindows().length === windowsBefore, BrowserWindow.getAllWindows().length);

// 5. a page that sends itself to file: stays where it is
events.length = 0;
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/file` });
await wait(1800);
const afterFile = await text('bunny-tab-1');
check('a file: navigation from the page is refused', afterFile.includes('tries file'), afterFile);

// 6. the model's actions work on a view: read gives elements, screenshot gives a picture
const shot = await views.control(owner, 'bunny-tab-1', 'screenshot', {});
check('screenshot of a view', /^data:image\/png;base64,/.test(shot?.image ?? ''), (shot?.image ?? '').slice(0, 30));

// 7. closing
views.handle(owner, { op: 'closeAll' });
check('closeAll removes every view', views.count() === 0, views.count());

console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} PASSED`);
app.exit(failed.length ? 1 : 0);
