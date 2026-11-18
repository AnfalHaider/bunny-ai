/**
 * QA, release-0.1.10 RA-1 re-check (0e5bc55): device sign-in lockout on an invented profile, lanAddress 127.0.0.2. Chromium plays the device, plus a burst of parallel tries.
 *   node e2e/w0110-signin.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const PASS = 'qa passcode for sign in 0110';
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bunny = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'bunny-w0110s-')), fake: true, secretStore: memorySecretStore(), probe: async () => ({ ok: true }), discover: async () => [], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2' });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const on = await (await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
const url = on.url.replace(/\/$/, ''); const host = new URL(url).host;
const signin = (code) => fetch(url + '/api/remote/signin', { method: 'POST', headers: { host, origin: 'http://' + host, 'content-type': 'application/json' }, body: JSON.stringify({ passcode: code }) });
const browser = await chromium.launch();
try {
  // A: one device by hand, in the page
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const page = await ctx.newPage();
  await page.goto(url + '/'); const msgs = [];
  for (let i = 0; i < 5; i += 1) { await page.fill('#passcode', 'wrong passcode number ' + i + ' xxxx'); await page.locator('#form').evaluate((f) => f.requestSubmit()); await page.waitForTimeout(700); msgs.push(await page.locator('#msg').textContent()); }
  check('A1', 'four wrong passcodes say "not right"; the fifth says to wait', msgs.slice(0, 4).every((m) => /not right\.$/.test(m)) && /Wait \d+ seconds/.test(msgs[4]), msgs.join(' | '));
  await page.fill('#passcode', PASS); await page.locator('#form').evaluate((f) => f.requestSubmit()); await page.waitForTimeout(900);
  const during = await page.locator('#msg').textContent();
  check('A2', 'the RIGHT passcode during the wait is refused with the wait message, and nothing is shown', /Wait \d+ seconds/.test(during) && (await page.title()) === 'Sign in to Bunny AI', during);
  await page.screenshot({ path: join(tmpdir(), 'qa-w0110-signin-wait.png') });
  // after the wait
  const t0 = Date.now(); let ok = false; let last = '';
  while (Date.now() - t0 < 70000 && !ok) { await wait(3000); await page.fill('#passcode', PASS); await Promise.all([page.waitForURL(/index\.html/, { timeout: 2500 }).then(() => { ok = true; }).catch(() => {}), page.locator('#form').evaluate((f) => f.requestSubmit())]); last = await page.locator('#msg').textContent().catch(() => ''); }
  check('A3', 'after the wait (' + Math.round((Date.now() - t0) / 1000) + ' s) the right passcode signs in and the app page opens', ok, last);
  await ctx.close();
  // B: a burst of 60 parallel wrong tries from one device: at most 5 are really checked, the rest wait
  await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  const on2 = await (await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  const url2 = on2.url.replace(/\/$/, ''); const host2 = new URL(url2).host;
  const sign2 = (code) => fetch(url2 + '/api/remote/signin', { method: 'POST', headers: { host: host2, origin: 'http://' + host2, 'content-type': 'application/json' }, body: JSON.stringify({ passcode: code }) });
  const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => sign2('burst wrong ' + i + ' xxxxxxxx').then((r) => r.status)));
  const n401 = burst.filter((s) => s === 401).length; const n429 = burst.filter((s) => s === 429).length;
  check('B1', 'a burst of 60 parallel wrong tries: at most 5 are checked (401), the others are told to wait (429)', n401 <= 5 && n429 >= 55 && n401 + n429 === 60, `401:${n401} 429:${n429}`);
  const rightNow = await sign2(PASS);
  check('B2', 'right after the burst even the right passcode has to wait (429)', rightNow.status === 429, String(rightNow.status));
  const t1 = Date.now(); let status = 429; while (Date.now() - t1 < 80000 && status === 429) { await wait(4000); status = (await sign2(PASS)).status; }
  check('B3', 'after the wait the right passcode signs in (200)', status === 200, `${status} after ${Math.round((Date.now() - t1) / 1000)} s`);
  void signin;
} catch (e) { console.log('CRASHED ' + (e?.stack ?? e)); }
await browser.close(); await bunny.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }).catch(() => {});
const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); process.exit(bad.length ? 1 : 0);
