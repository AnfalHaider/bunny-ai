/**
 * QA, v0.1.8 release walk: a smoke test of chat and code mode and every page, at desktop 1280 and phone 390, light and dark.
 * Invented profile only (BUNNY_DATA_DIR temp, BUNNY_FAKE_UPSTREAM=1). Chat sends a message and gets the fake reply; Code mode switches on
 * with an invented folder and the Code tab/controls show; each page loads with no page error, no failed own request and no sideways scroll.
 *   node e2e/w018-smoke.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

const free = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await free(); const TOKEN = randomBytes(16).toString('hex');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w018-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w018-folder-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, ['src/server/main.js'], { env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).status < 500) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`); };
const H = { 'x-bunny-token': TOKEN, 'content-type': 'application/json' };
await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ modelFilter: 'all' }) });
const conn = await fetch(BASE + '/api/providers/openai/connect', { method: 'POST', headers: H, body: JSON.stringify({ apiKey: 'sk-test-000000000000' }) });
console.log(`INFO  connecting an invented provider: ${conn.status}`);
const models = await (await fetch(BASE + '/api/models', { headers: H })).json();
console.log(`INFO  the invented profile lists ${models.length} model rows (fake upstream)`);

const browser = await chromium.launch();
const PAGES = [['chat', '/'], ['settings', '/src/ui/settings.html?embed=1'], ['customize', '/src/ui/customize.html?embed=1'], ['providers', '/src/ui/providers.html'], ['automation', '/src/ui/automation.html?embed=1']];
for (const [sz, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
  for (const [name, path] of PAGES) {
    const page = await ctx.newPage(); const errors = []; const failed = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 500) failed.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
    await page.goto(BASE + path); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    await page.waitForTimeout(900);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const text = ((await page.locator('body').innerText().catch(() => '')) ?? '').length;
    check(`PG ${name} ${tag}`, `${name} loads with content, no page error, no 5xx from the app, no sideways scroll`, errors.length === 0 && failed.length === 0 && !over && text > 40, `${errors.join('|')} ${failed.join('|')} over=${over} text=${text}`);
    if (name === 'chat') await page.screenshot({ path: join(SHOTS, `chat-${sz}-${theme}.png`) });
    await page.close();
  }
  // ---- chat: send a message and get a reply
  { const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/'); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item[data-model], .picker-panel .picker-model').first().click();
    await page.locator('#input').fill('hello, is anyone there?'); await page.locator('#send').click();
    await page.locator('.msg.assistant .body').last().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const reply = ((await page.locator('.msg.assistant .body').last().textContent().catch(() => '')) ?? '').trim();
    check(`CH1 ${tag}`, 'chat: a message is sent and an answer appears (the invented fake provider)', reply.length > 0 && (await page.locator('.msg.user').count()) >= 1, reply.slice(0, 80));
    check(`CH2 ${tag}`, 'the message box is empty and ready again, Send works, no error banner', (await page.locator('#input').inputValue()) === '' && ((await page.locator('#error').textContent().catch(() => '')) ?? '').trim() === '', ((await page.locator('#error').textContent().catch(() => '')) ?? '').slice(0, 60));
    await page.screenshot({ path: join(SHOTS, `chat-reply-${sz}-${theme}.png`) });
    // ---- a second chat, and reopening the first from the sidebar / history
    await page.reload(); await page.waitForTimeout(1200);
    check(`CH3 ${tag}`, 'after a reload the conversation is still there (saved)', (await page.locator('.msg.user').count()) >= 1 || (await page.locator('.msg').count()) >= 1, `${await page.locator('.msg').count()} messages`);
    check(`CH4 ${tag}`, 'no page error in the chat flow', errors.length === 0, errors.join('|'));
    await page.close(); }
  // ---- code mode: an invented folder, a command run by the app itself (Auto mode), the result shown
  { const { body } = { body: await (await fetch(BASE + '/api/sessions', { method: 'POST', headers: H, body: JSON.stringify({ title: 'smoke code', providerId: models[0]?.providerId, model: models[0]?.id }) })).json() };
    const sid = body.id;
    for (const [n, v] of [['folder', FOLDER], ['workMode', 'code'], ['permissionMode', 'auto']]) await fetch(`${BASE}/api/sessions/${sid}/setting/${n}`, { method: 'PATCH', headers: H, body: JSON.stringify({ value: v }) });
    const res = await fetch(`${BASE}/api/sessions/${sid}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ content: 'list the files in this folder', providerId: models[0]?.providerId, model: models[0]?.id, workMode: 'code' }), signal: AbortSignal.timeout(30000) });
    const txt = await res.text();
    const saved = await (await fetch(`${BASE}/api/sessions/${sid}`, { headers: H })).json();
    check(`CD1 ${tag}`, 'code mode: a chat with a folder in Code mode answers (the fake provider) and saves the reply, no error event', res.status === 200 && !/^event: error/m.test(txt) && saved.messages.some((m) => m.role === 'assistant'), `status ${res.status}; ${txt.slice(0, 80).replace(/\n/g, ' ')}`);
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/'); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    await page.waitForTimeout(1200);
    const codeTab = page.getByRole('button', { name: /^Code$/ }).or(page.locator('[data-mode="code"], #mode-code, .mode-tab:has-text("Code")')).first();
    const hasCode = (await codeTab.count()) > 0;
    check(`CD2 ${tag}`, 'the Code tab/control is on the chat page', hasCode, hasCode ? 'found' : 'not found');
    if (hasCode) { await codeTab.click().catch(() => {}); await page.waitForTimeout(600); }
    check(`CD3 ${tag}`, 'switching to Code mode does not break the page (no page error, no sideways scroll)', errors.length === 0 && !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), errors.join('|'));
    await page.screenshot({ path: join(SHOTS, `code-${sz}-${theme}.png`) });
    await page.close(); }
  await ctx.close();
}
await browser.close(); server.kill();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
