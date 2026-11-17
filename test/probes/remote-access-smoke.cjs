// BROWSER step 2 probe in the REAL Electron (not run by the unit suite): `npx electron test/probes/remote-access-smoke.cjs`
// The real server (electron-free createApp) with the request guard ON, opened to "other devices" on an invented profile (its "local network" is 127.0.0.1 on a second port),
// and a real browser page playing the other device in its own cookie jar: it types the passcode into the real sign-in page and then uses the real app page.
// Uses an invented data folder and an invented userData folder only; never Bunny's real profile.
const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'bunny-remote-probe-user-')));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 220) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PASS = 'a passcode for the probe only';
app.on('window-all-closed', () => {});

async function main() {
  await app.whenReady();
  const root = join(__dirname, '..', '..');
  const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
  const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
  const data = mkdtempSync(join(tmpdir(), 'bunny-remote-probe-data-'));
  const bunny = await createApp({ dataDir: data, fake: true, secretStore: memorySecretStore(), probe: async () => ({ ok: true }), discover: async () => [], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.1' });
  await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
  const local = `http://127.0.0.1:${bunny.server.address().port}`;

  // off: nothing else listens
  const status0 = await (await bunny.adminFetch('/api/remote')).json();
  check('it is off by default', status0.enabled === false && status0.url === null);

  const on = await (await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  check('turning it on opens a second address', Boolean(on.url) && !on.url.startsWith(local), on.url);
  const lanUrl = on.url;

  // the other device: its own cookie jar
  const device = new BrowserWindow({ width: 500, height: 700, show: false, webPreferences: { partition: 'remote-probe-device', sandbox: true, contextIsolation: true } });
  await device.loadURL(lanUrl);
  check('the other device sees the sign-in page first', (await device.webContents.executeJavaScript('document.title')) === 'Sign in to Bunny AI');
  const before = await device.webContents.executeJavaScript(`fetch('/api/sessions').then((r) => r.status)`);
  check('and no API answers before sign-in', before === 401, before);
  // a wrong passcode, then the right one, typed into the real page
  await device.webContents.executeJavaScript(`(() => { document.getElementById('passcode').value = 'not the passcode at all'; document.getElementById('form').requestSubmit(); })()`);
  await wait(700);
  const wrongMsg = await device.webContents.executeJavaScript(`document.getElementById('msg').textContent`);
  check('a wrong passcode says so on the page', /not right/.test(wrongMsg), wrongMsg);
  const loaded = new Promise((r) => device.webContents.once('did-navigate', () => r()));
  await device.webContents.executeJavaScript(`(() => { document.getElementById('passcode').value = ${JSON.stringify(PASS)}; document.getElementById('form').requestSubmit(); })()`);
  await Promise.race([loaded, wait(4000)]);
  await wait(1500);
  const page = await device.webContents.executeJavaScript(`({ url: location.pathname, bridge: typeof window.bunnyDesktop, token: Boolean(document.querySelector('meta[name="bunny-token"]')), csrf: (document.querySelector('meta[name="bunny-csrf"]')?.content ?? '').length, cookie: document.cookie })`);
  check('signed in: the app page is shown', page.url === '/src/ui/index.html', JSON.stringify(page));
  check('it has no desktop bridge, no launch token, and the cookie is hidden from the page', page.bridge === 'undefined' && page.token === false && page.csrf === 48 && !/bunny_remote/.test(page.cookie), JSON.stringify(page));
  const reads = await device.webContents.executeJavaScript(`fetch('/api/sessions').then((r) => r.status)`);
  check('it can read chats', reads === 200, reads);
  const made = await device.webContents.executeJavaScript(`fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'From the probe', folder: 'C:\\\\Windows', workMode: 'code' }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`);
  check('it can start a chat (the page adds the CSRF header itself), in Chat mode with no folder', made.status === 200 && made.body.workMode === 'chat' && made.body.folder === null, JSON.stringify(made));
  const refused = await device.webContents.executeJavaScript(`fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permissionRules: {} }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`);
  check('a window-only change is refused with the window sentence', refused.status === 403 && refused.body.message === "Change this in Bunny's window.", JSON.stringify(refused));
  // the page's own fetch adds the right CSRF header; a request made another way (XHR, as a stray script or a forged form would) has none, or a wrong one
  const raw = await device.webContents.executeJavaScript(`new Promise((resolve) => { const x = new XMLHttpRequest(); x.open('POST', '/api/sessions'); x.setRequestHeader('content-type', 'application/json'); x.setRequestHeader('x-bunny-csrf', 'wrong'); x.onload = () => resolve(x.status); x.onerror = () => resolve('error'); x.send('{}'); })`);
  const none = await device.webContents.executeJavaScript(`new Promise((resolve) => { const x = new XMLHttpRequest(); x.open('POST', '/api/sessions'); x.setRequestHeader('content-type', 'application/json'); x.onload = () => resolve(x.status); x.onerror = () => resolve('error'); x.send('{}'); })`);
  check('a write with a wrong or missing CSRF token is refused even from the signed-in page', raw === 403 && none === 403, `${raw} ${none}`);
  const terminal = await device.webContents.executeJavaScript(`fetch('/api/terminal/list').then((r) => r.status)`);
  check('the terminal and the rest of what runs things are not reachable', terminal === 403, terminal);

  // the window's view: one device signed in; ending it signs the page out
  const st = await (await bunny.adminFetch('/api/remote')).json();
  check('the window sees one signed-in device', st.signedIn === 1 && st.devices.length === 1, JSON.stringify(st.devices));
  await bunny.adminFetch(`/api/remote/devices/${st.devices[0].id}/signout`, { method: 'POST' });
  const after = await device.webContents.executeJavaScript(`fetch('/api/sessions').then((r) => r.status)`);
  check('ending it signs that device out at once', after === 401, after);
  // 127.0.0.1 behaves as before: a normal request without a token is refused, the window's (admin) one works
  const noToken = await fetch(`${local}/api/sessions`).then((r) => r.status);
  check('the 127.0.0.1 server still wants its token', noToken === 403, noToken);
  await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  const closed = await device.webContents.executeJavaScript(`fetch('/api/sessions').then((r) => r.status).catch(() => 'refused')`);
  check('turning it off closes the address', closed === 'refused', closed);

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`);
  console.log(failed.length ? `PROBE FAILED: ${failed.length} of ${results.length}` : `PROBE PASSED: ${results.length} of ${results.length}`);
  bunny.server.close();
  void session;
  app.exit(failed.length ? 1 : 0);
}
main().catch((err) => { console.error('probe crashed:', err); app.exit(2); });
