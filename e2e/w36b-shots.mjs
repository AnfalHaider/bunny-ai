/**
 * W3-6b: the connector sign-in screens, as pictures. Invented profile only.
 *
 *   node e2e/w36b-shots.mjs            (starts its own Bunny AI on a free port: BUNNY_FAKE_UPSTREAM=1, BUNNY_DATA_DIR=<temp folder>)
 *
 * The connectors are "Notes Hub" and "Acme Docs", stand-ins from test/fake-mcp-oauth.js on 127.0.0.1; the person's browser is played by
 * calling the return address. Pictures go to docs/design/review-w36/built/. Nothing here touches %LOCALAPPDATA%\BunnyAI.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { startFake } from '../test/fake-mcp-oauth.js';

const OUT = 'docs/design/review-w36/built';
const TOKEN = 'w36b-shots-token-0123456789abcdef0123456789abcdef0123456789abcdef';
mkdirSync(OUT, { recursive: true });

const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w36b-'));
const BASE = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['src/server/main.js'], {
  env: { ...process.env, PORT: String(port), BUNNY_FAKE_UPSTREAM: '1', BUNNY_RESET_PROFILE: '1', BUNNY_DATA_DIR: dataDir, BUNNY_API_TOKEN: TOKEN },
  stdio: 'ignore',
});
const stop = async () => { server.kill(); await new Promise((r) => setTimeout(r, 300)); try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* still in use: it is a temp folder */ } };
for (let i = 0; ; i++) {
  try { if ((await (await fetch(`${BASE}/api/health`)).json()).fake) break; } catch { /* not up yet */ }
  if (i > 100) { await stop(); throw new Error('the app did not start in an invented profile'); }
  await new Promise((r) => setTimeout(r, 200));
}

const J = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
const api = async (path, init = {}) => { const r = await fetch(BASE + path, { ...init, headers: { ...J, ...(init.headers ?? {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const ok = (c, m) => { if (!c) throw new Error(m); };

const notesFake = await startFake({ idToken: true, expiresIn: 30 }, BASE); // its sign-in is already inside the renewal margin, so the next call renews it
const acmeFake = await startFake({ idToken: true }, BASE);
const noRegFake = await startFake({ idToken: true, registration: false }, BASE);
const fakes = [notesFake, acmeFake, noRegFake];

const browser = await chromium.launch();
const done = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });

  const shot = async (name, { full = true } = {}) => {
    await page.mouse.move(0, 0); // no hover left on the last button clicked
    await page.waitForTimeout(250);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok(!sideways, `${name}: the page scrolls sideways`);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    done.push(name);
  };
  const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
  const size = (k) => page.setViewportSize(SIZES[k]);
  const rowOf = (name) => page.locator('.cz-row', { hasText: name });
  const popupFrom = async (btn) => { const p = page.waitForEvent('popup'); await btn.click(); return p; };
  const back = async (authUrl, params = {}) => {
    const state = new URL(authUrl).searchParams.get('state');
    const q = new URLSearchParams({ state, ...params });
    return fetch(`${BASE}/api/connectors/oauth/callback?${q}`, { headers: { 'sec-fetch-site': 'cross-site' } });
  };
  const approve = (fake, authUrl) => { const { code, state } = fake.browse(authUrl); return back(authUrl, { code, state }); };

  // Two connectors, as a person adds them.
  const notes = (await api('/api/mcp', { method: 'POST', body: JSON.stringify({ name: 'Notes Hub', url: notesFake.server.url, enabled: true }) })).body;
  const acme = (await api('/api/mcp', { method: 'POST', body: JSON.stringify({ name: 'Acme Docs', url: acmeFake.server.url, enabled: true }) })).body;
  await page.goto('/src/ui/customize.html');
  await rowOf('Notes Hub').getByRole('button', { name: 'Test' }).click();
  await rowOf('Acme Docs').getByRole('button', { name: 'Test' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cz-status-word').length === 2 && [...document.querySelectorAll('.cz-status-word')].every((w) => w.textContent === 'Needs sign-in'));

  // Acme Docs signs in first, so the first picture has an amber row beside a green one.
  let opened = await popupFrom(rowOf('Acme Docs').getByRole('button', { name: 'Sign in' }));
  await approve(acmeFake, opened.url()); await opened.close();
  await page.waitForFunction(() => [...document.querySelectorAll('.cz-row')].some((r) => /Acme/.test(r.textContent) && /Signed in/.test(r.textContent)), null, { timeout: 25_000 });
  await shot('a-needs-sign-in-desktop');
  await size('phone'); await shot('a-needs-sign-in-390'); await size('desktop');

  // (b) waiting for the browser
  opened = await popupFrom(rowOf('Notes Hub').getByRole('button', { name: 'Sign in' }));
  const notesAuth = opened.url();
  await opened.close();
  await page.locator('.cz-row', { hasText: 'Notes Hub' }).locator('.cz-status-word', { hasText: 'Waiting for your browser' }).waitFor();
  await shot('b-waiting-desktop');
  await size('phone'); await shot('b-waiting-390'); await size('desktop');

  // (c) signed in
  await approve(notesFake, notesAuth);
  await page.locator('.cz-row', { hasText: 'Notes Hub' }).locator('.cz-status-word', { hasText: 'Signed in' }).waitFor({ timeout: 25_000 });
  await size('phone'); await shot('c-signed-in-390');
  await page.emulateMedia({ colorScheme: 'dark' }); await shot('c-signed-in-390-dark'); await page.emulateMedia({ colorScheme: 'light' });
  await size('desktop'); await shot('c-signed-in-desktop');

  // (d) expired: the stored sign-in is inside its renewal margin and the provider now refuses to renew it
  notesFake.opts.refreshFails = true;
  await rowOf('Notes Hub').getByRole('button', { name: 'Test' }).click();
  await page.locator('.cz-row', { hasText: 'Notes Hub' }).locator('.cz-status-word', { hasText: 'Sign-in expired' }).waitFor({ timeout: 25_000 });
  ok(await rowOf('Notes Hub').getByRole('button', { name: 'Sign in again' }).isVisible(), 'no Sign in again button');
  await shot('d-expired-desktop');
  await size('phone'); await shot('d-expired-390'); await size('desktop');

  // (f) Sign out of Acme Docs: the line at the bottom says whether the provider was told
  await rowOf('Acme Docs').getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#cz-note', { hasText: 'was told to end the access' }).waitFor();
  await shot('f-sign-out-revoked-desktop');
  await size('phone'); await shot('f-sign-out-revoked-390'); await size('desktop');

  // (e) failed with its reason, then cancelled
  await rowOf('Acme Docs').getByRole('button', { name: 'Test' }).click();
  opened = await popupFrom(rowOf('Acme Docs').getByRole('button', { name: 'Sign in' }));
  const acmeAuth = opened.url(); await opened.close();
  const { state } = acmeFake.browse(acmeAuth);
  await back(acmeAuth, { state, code: 'a-code-the-provider-never-gave' });
  await page.locator('.cz-row', { hasText: 'Acme Docs' }).locator('.cz-status-word', { hasText: 'Sign-in failed' }).waitFor({ timeout: 25_000 });
  await shot('e-failed-reason-desktop');
  await size('phone'); await shot('e-failed-reason-390'); await size('desktop');
  opened = await popupFrom(rowOf('Acme Docs').getByRole('button', { name: 'Try again' }));
  const again = opened.url(); await opened.close();
  const denied = acmeFake.browse(again, { deny: true });
  await back(again, denied);
  await page.locator('.cz-row', { hasText: 'Acme Docs' }).locator('.cz-status-word', { hasText: 'Sign-in cancelled' }).waitFor({ timeout: 25_000 });
  await shot('e-cancelled-desktop');
  await size('phone'); await shot('e-cancelled-390'); await size('desktop');

  // (g) a service that does not let apps register themselves asks for a client ID
  await api(`/api/mcp/${acme.id}`, { method: 'DELETE' });
  await api('/api/mcp', { method: 'POST', body: JSON.stringify({ name: 'Acme Docs', url: noRegFake.server.url, enabled: true }) });
  await page.goto('/src/ui/customize.html');
  await rowOf('Acme Docs').getByRole('button', { name: 'Test' }).click();
  await rowOf('Acme Docs').getByRole('button', { name: 'Sign in' }).click();
  await rowOf('Acme Docs').getByLabel(/Client ID/).waitFor();
  await shot('g-client-id-desktop');
  await size('phone'); await shot('g-client-id-390'); await size('desktop');

  // The Automation page uses the same words.
  await page.goto('/src/ui/automation.html');
  await page.waitForSelector('#mcp-list .cz-status-word');
  await shot('i-automation-connectors-desktop');
  await size('phone'); await shot('i-automation-connectors-390'); await size('desktop');

  // (h) the chat step. The model's reply is played from here (a connector that needs a sign-in makes the server send this very event);
  //     the Sign in button talks to the real server, and the sign-in itself is the real flow.
  const hub = notes;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ modelFilter: 'all' }) });
  await page.goto('/src/ui/providers.html'); // connect the test provider as a person would
  await page.waitForSelector('#available .row');
  await page.getByRole('button', { name: 'Connect Anthropic' }).click();
  await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('#connected', { hasText: 'Anthropic' }).waitFor();
  const long = 'I looked for your notes about the Q4 plan, but Notes Hub wants you to sign in first, and I cannot read anything from it until you do. '
    + 'Once you have signed in, I will search again and pick up from where I stopped, so there is nothing to repeat.';
  await page.route('**/api/sessions/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    return route.fulfill({
      status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      body: frame('tool', { tool: 'Notes Hub', status: 'failed', result: 'This connector needs you to sign in.', needsSignIn: true, serverId: hub.id })
        + frame('delta', { text: long })
        + frame('done', { sessionId: route.request().url().match(/sessions\/([^/]+)\/messages/)[1], model: 'offline/bunny-code', context: { used: 400, limit: 200000 } }),
    });
  });
  // The window reads the chat back from the server after the reply; give it the same steps a real run keeps (the shape the route test checks).
  const kept = new Set();
  await page.route(/\/api\/sessions\/[a-f0-9-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const real = await route.fetch();
    const session = await real.json();
    if (kept.has(session.id) && !session.messages.some((m) => m.needsSignIn)) {
      const at = new Date().toISOString();
      session.messages.push(
        { id: crypto.randomUUID(), role: 'user', kind: 'text', content: 'Find my notes about the Q4 plan.', attachments: [], at },
        { id: crypto.randomUUID(), role: 'assistant', kind: 'tool_call', content: '', tool: 'Notes Hub', status: 'failed', result: 'This connector needs you to sign in.', needsSignIn: true, serverId: hub.id, attachments: [], at },
        { id: crypto.randomUUID(), role: 'assistant', kind: 'text', content: long, attachments: [], at },
      );
    }
    return route.fulfill({ response: real, json: session });
  });
  page.on('request', (r) => { const m = /\/api\/sessions\/([a-f0-9-]{36})\/messages$/.exec(r.url()); if (m && r.method() === 'POST') kept.add(m[1]); });
  for (const [theme, width, height] of [['light', 1440, 900], ['dark', 1440, 900], ['light', 390, 844], ['dark', 390, 844]]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForSelector('#input');
    await page.locator('#picker-button').click();
    await page.locator('.picker-panel [role="option"]').nth(1).click(); // not Auto: a named model, so the message goes to the server
    await page.locator('#input').fill('Find my notes about the Q4 plan.');
    await page.locator('#send').click();
    await page.locator('.signin-step').waitFor({ timeout: 25_000 }).catch(async (e) => { await page.screenshot({ path: process.env.DEBUG_SHOT ?? '/dev/null' }).catch(() => {}); console.log((await page.locator('body').innerText()).slice(0, 600)); throw new Error(`no sign-in step; error line: ${await page.locator('#error').innerText().catch(() => '?')}`); });
    ok(await page.locator('.signin-step button', { hasText: 'Sign in' }).isVisible(), 'no Sign in in the chat step');
    ok(await page.locator('.signin-step button', { hasText: 'Skip it' }).isVisible(), 'no Skip it in the chat step');
    await shot(`h-chat-step-${theme}-${width}`, { full: false });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  ok(errs.length === 0, `page errors: ${errs.join(' | ')}`);
  console.log(`wrote ${done.length} pictures to ${OUT}:\n  ${done.join('\n  ')}`);
} finally {
  await browser.close();
  await Promise.all(fakes.map((f) => f.close()));
  await stop();
}
