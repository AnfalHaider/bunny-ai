// W6-24 smoke test in the REAL Electron (not run by the unit suite): `npx electron test/probes/views-smoke.mjs`
// Starts two local pages, opens the panel's views through electron/browserViews.js, and prints what really happened.
// Uses throwaway sessions only (an invented userData folder); never touches the real Bunny profile.
import { app, BrowserWindow, WebContentsView, session, webContents } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserViews, PARTITION, loadable, requestAllowed } from '../../electron/browserViews.js';

// The profile of this run: an invented folder given as the first argument or in BUNNY_SMOKE_USERDATA, else a new temp folder. Never Bunny's real profile.
const given = process.argv.slice(1).find((a) => !a.startsWith('-') && !/(views-smoke|qa-w624-smoke)\.mjs$/.test(a)) ?? process.env.BUNNY_SMOKE_USERDATA;
if (given && /BunnyAI/i.test(given)) { console.error('Refusing to use a folder that looks like the real Bunny profile.'); process.exit(2); }
app.setPath('userData', given ? given : mkdtempSync(join(tmpdir(), 'bunny-views-smoke-')));
const results = [];
import { appendFileSync } from 'node:fs'; const LOG = process.env.SMOKE_LOG; const say = (m) => { try { appendFileSync(LOG, m + String.fromCharCode(10)); } catch {} }; say('start');
const check = (name, ok, detail = '') => { say((ok ? 'PASS ' : 'FAIL ') + name + ' :: ' + String(detail).slice(0, 160)); results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const serve = (handler) => new Promise((resolve) => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port })); });

await app.whenReady(); say('ready');

// B stands in for Bunny's own page (the default session); A for a website (the panel's session)
const B = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>bunny</title><body>bunny page'); });
const A = await serve((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/bust') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Loaded</title><script>if (top !== self) top.location = 'http://127.0.0.1:${B.port}/hijacked'</script>busting page`); return; }
  if (u.pathname === '/iso') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Iso</title><script>window.leak="main"; Element.prototype.getBoundingClientRect=function(){throw new Error("hijacked")}; Array.prototype.map=function(){throw new Error("mapjack")}</script>iso page'); return; }
  if (u.pathname === '/dl') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="evil.bin"' }); res.end('BINARYDATA'); return; }
  if (u.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'sid=abc123; Path=/; Max-Age=3600' }); res.end('<title>Login</title>logged in'); return; }
  if (u.pathname === '/cookie') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Cookie</title><body id=b></body><script>b.textContent = "cookie:" + document.cookie</script>'); return; }
  if (u.pathname === '/popup') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Popup</title><script>window.open('http://127.0.0.1:${B.port}/opened')</script>popup page`); return; }
  if (u.pathname === '/file') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>File</title><script>setTimeout(() => { location = "file:///C:/Windows/win.ini" }, 200)</script>tries file'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>A</title>a');
});

const win = new BrowserWindow({ width: 1000, height: 700, show: process.env.SHOW !== '0' });
say('loading B'); await win.loadURL(`http://127.0.0.1:${B.port}/`); say('B loaded');
const views = createBrowserViews({ WebContentsView, session, getWindow: () => win });
const events = [];
const owner = win.webContents;
const realSend = owner.send.bind(owner);
owner.send = (channel, payload) => { if (channel === 'browser:view-event') events.push(payload); else realSend(channel, payload); };
say('views made'); const windowsBefore = BrowserWindow.getAllWindows().length;

const open = (tab, url) => { views.handle(owner, { op: 'open', tab, url }); views.handle(owner, { op: 'rect', tab, rect: { x: 0, y: 0, width: 800, height: 600 }, visible: true }); };
const text = async (tab) => (await views.control(owner, tab, 'read', {}))?.page?.text ?? '';

// 1. a page that frame-busts loads as the top-level page it now is
open('bunny-tab-1', `http://127.0.0.1:${A.port}/bust`);
say('opened'); await wait(1500); say('waited');
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


// ---- QA additions: Security's four proofs
events.length = 0;
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/iso` });
await wait(1500);
const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/iso'));
check('QA found the view page', Boolean(wc), wc?.getURL());
if (wc) {
  const mainLeak = await wc.executeJavaScript('typeof window.leak');
  const isoLeak = await wc.executeJavaScriptInIsolatedWorld(1999, [{ code: 'typeof window.leak' }]);
  check('(1) isolated world is a real separate world: the page variable is visible in the main world but NOT in world 1999', mainLeak === 'string' && isoLeak === 'undefined', JSON.stringify({ mainLeak, isoLeak }));
  await wc.executeJavaScriptInIsolatedWorld(1999, [{ code: 'window.isoOnly = 7' }]);
  const seenByPage = await wc.executeJavaScript('typeof window.isoOnly');
  check('(1b) what runs in the isolated world is invisible to the page', seenByPage === 'undefined', seenByPage);
  const mainMap = await wc.executeJavaScript('try { [1].map((x) => x); "map works" } catch (e) { e.message }');
  const isoMap = await wc.executeJavaScriptInIsolatedWorld(1999, [{ code: 'try { [1].map((x) => x); "map works" } catch (e) { e.message }' }]);
  check('(1c) the page broke Array.prototype.map in its own world but the isolated world still has the real one', mainMap === 'mapjack' && isoMap === 'map works', JSON.stringify({ mainMap, isoMap }));
  const read = await views.control(owner, 'bunny-tab-1', 'read', {});
  check('(1d) the model read action still works on a page that tampered with the DOM functions', /iso page/.test(read?.page?.text ?? '') && !read?.error, JSON.stringify(read).slice(0, 160));
}
// (2) a download is cancelled and reported
events.length = 0;
const dlBefore = (await import('node:fs')).readdirSync(app.getPath('downloads')).length;
views.handle(owner, { op: 'navigate', tab: 'bunny-tab-1', url: `http://127.0.0.1:${A.port}/dl` });
await wait(2000);
const dlAfter = (await import('node:fs')).readdirSync(app.getPath('downloads')).length;
check('(2) a download is cancelled and the panel is told', events.some((e) => e.event === 'download-blocked'), JSON.stringify(events.filter((e) => /download/.test(e.event))));
check('(2b) and no file was written to the Downloads folder', dlAfter === dlBefore && !(await import('node:fs')).existsSync(app.getPath('downloads') + '/evil.bin'), `${dlBefore} -> ${dlAfter}`);
// Bunny's own port is refused (pure rules, as the views use them)
const OWN = 5173;
const refused = ['http://127.0.0.1:5173/', 'http://localhost:5173/x', 'http://[::1]:5173/', 'http://0.0.0.0:5173/', 'http://2130706433:5173/', 'http://127.1:5173/', 'http://LOCALHOST.:5173/', 'http://user:pw@127.0.0.1:5173/'].filter((u) => loadable(u, OWN));
check('Bunny own port is refused for every spelling of this computer', refused.length === 0, 'NOT refused: ' + refused.join(' '));
check('another local port and a normal https page are allowed', loadable('http://127.0.0.1:5999/', OWN) && loadable('https://example.com/', OWN), '');
const subs = ['http://127.0.0.1:5173/api/x', 'http://localhost:5173/'].filter((u) => requestAllowed({ url: u, resourceType: 'xhr' }, OWN));
check('a page own requests to Bunny port are cancelled', subs.length === 0, 'allowed: ' + subs.join(' '));
check('file: and javascript: pages cannot be opened', !loadable('file:///C:/Windows/win.ini', OWN) && !loadable('javascript:alert(1)', OWN) && !loadable('data:text/html,hi', OWN), '');

// 7. closing
views.handle(owner, { op: 'closeAll' });
check('closeAll removes every view', views.count() === 0, views.count());

say("done"); console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL ${results.length} PASSED`);
app.exit(failed.length ? 1 : 0);
