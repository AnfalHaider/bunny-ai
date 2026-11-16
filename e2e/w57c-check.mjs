/**
 * QA check for W5-7 at c1b4c18: the unknown-settings-key rule must not refuse any setting a screen writes.
 * Server started the way Electron starts it (e2e/w27-desktop-server.mjs, invented profile), page with a stand-in preload bridge.
 * 1. the six switches Tech Lead found (charts, fallback when busy, status labels, transcript view, prompt suggestions, auto update) save and survive a reload;
 * 2. a sweep: every checkbox and select on the Settings screen is flipped, and no save answers 400 (HTTP or through the window).
 *
 *   SRC=<worktree> OUT=<folder> [PORT0=6601] node e2e/w57c-check.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fc1'; const PORT = +(process.env.PORT0 ?? 6601); const NL = String.fromCharCode(10);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = async (id, name, fn) => { let v = 'PASS', note = ''; try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; } rows.push({ id, name, v }); console.log(v.padEnd(5), id.padEnd(5), name, '::', String(note).slice(0, 320)); };
const desk = spawn('node', ['e2e/w27-desktop-server.mjs'], { env: { ...process.env, SRC, DATA: mkdtempSync(join(tmpdir(), 'bunny-w57c-data-')), PORT: String(PORT), TOKEN, BUNNY_FAKE_UPSTREAM: '1' }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const relay = async (path, method, body) => { const r = await (await fetch(`http://127.0.0.1:${PORT + 1000}`, { method: 'POST', body: JSON.stringify({ path, method, body }) })).json(); let data = {}; try { data = JSON.parse(r.body); } catch { /* x */ } return { status: r.status, data }; };
const settings = async () => (await fetch(BASE + '/api/settings', { headers: H })).json();
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(desk.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } process.exit(code); };
try {
  browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, baseURL: BASE }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
  const saves = []; // every settings write: how it went
  await page.exposeFunction('__secureWrite', async (method, path, body) => { const r = await relay(path, method, body); if (path === '/api/settings') saves.push({ via: 'window', keys: Object.keys(body ?? {}), status: r.status, message: r.data?.message }); return r; });
  await page.addInitScript(() => { window.bunnyDesktop = { secureWrite: (m, p, b) => window.__secureWrite(m, p, b) }; });
  page.on('response', async (r) => { if (r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings') { let keys = []; try { keys = Object.keys(JSON.parse(r.request().postData() ?? '{}')); } catch { /* x */ } let message = ''; if (r.status() >= 400) message = (await r.json().catch(() => ({}))).message ?? ''; saves.push({ via: 'http', keys, status: r.status(), message }); } });
  const open = async () => { await page.goto('/src/ui/settings.html'); await page.waitForSelector('#perm-rules', { timeout: 10000 }); await page.waitForTimeout(700); };
  await open();
  await row('S1', 'the six switches that were refused (charts, fallback when busy, status labels, transcript view, prompt suggestions, auto update) save through the screen and survive a reload', async () => {
    const before = await settings(); const out = []; const seen = [];
    const flip = async (sel, key) => { const box = page.locator(sel).first(); await box.scrollIntoViewIfNeeded(); const was = await box.isChecked(); await box.click({ force: true }).catch(() => box.evaluate((e) => e.click())); await page.waitForTimeout(500); const now = (await settings())[key]; seen.push(`${key}: ${was} -> ${now}`); if (now === undefined || Boolean(now) === was) out.push(`${key} did not save (${was} -> ${now})`); };
    await flip('input[data-cap=chartsEnabled]', 'chartsEnabled'); await flip('input[data-cap=fallbackWhenBusy]', 'fallbackWhenBusy'); await flip('input.pref[data-key=statusLabels]', 'statusLabels'); await flip('input.pref[data-key=promptSuggestions]', 'promptSuggestions'); await flip('input[data-cap=autoUpdate]', 'autoUpdate');
    const sel = page.locator('select.pref[data-key=transcriptView]'); const options = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value)); for (const v of options) { await sel.selectOption(v); await page.waitForTimeout(400); const got = (await settings()).transcriptView; seen.push(`transcriptView ${v} -> ${got}`); if (got !== v) out.push(`transcriptView ${v} saved as ${got}`); }
    const bad = saves.filter((s) => s.status >= 400); if (bad.length) out.push('refused: ' + bad.map((b) => `${b.keys.join(',')} ${b.status} ${b.message}`).join(' ; '));
    await page.screenshot({ path: `${OUT}/w57c-settings.png` }); await open(); const after = await settings(); ok(JSON.stringify(after.transcriptView) === JSON.stringify(options.at(-1)), 'transcriptView after reload ' + after.transcriptView); ok(!out.length, out.join(' ; ')); void before; return seen.join(' | ');
  });
  await row('S2', 'sweep: every checkbox and select on the Settings screen is flipped; not one save is refused with 400', async () => {
    const start = saves.length; const checks = page.locator('input[type=checkbox]'); const nChecks = await checks.count(); let clicked = 0;
    for (let i = 0; i < nChecks; i++) { const c = checks.nth(i); if (!(await c.isVisible().catch(() => false))) continue; try { await c.evaluate((e) => e.click()); clicked += 1; await page.waitForTimeout(150); } catch { /* not clickable */ } }
    const selects = page.locator('select'); const nSel = await selects.count(); let changed = 0;
    for (let i = 0; i < nSel; i++) { const s = selects.nth(i); const opts = await s.locator('option').evaluateAll((os) => os.map((o) => o.value)); if (opts.length < 2) continue; const cur = await s.inputValue().catch(() => ''); const next = opts.find((v) => v !== cur); try { await s.selectOption(next); changed += 1; await page.waitForTimeout(150); } catch { /* skip */ } }
    await page.waitForTimeout(800); const made = saves.slice(start); const bad = made.filter((s) => s.status >= 400);
    ok(made.length > 5, 'only ' + made.length + ' saves were made'); ok(!bad.length, bad.length + ' refused: ' + bad.slice(0, 5).map((b) => `${b.keys.join(',')} -> ${b.status} ${String(b.message).slice(0, 50)} (${b.via})`).join(' ; '));
    const keys = [...new Set(made.flatMap((s) => s.keys))]; return `${clicked} switches and ${changed} menus changed, ${made.length} saves, all accepted; keys: ${keys.join(', ')}`.slice(0, 600);
  });
  await row('S3', 'a made-up key is still refused (the rule itself is intact)', async () => { const r = await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ notARealSetting: 1 }) }); ok(r.status === 400, 'status ' + r.status); return 'still 400'; });
  await row('S4', 'NEW (2c29444): autoUpdate and fallbackWhenBusy over HTTP with the page token are 403 (Change this in the window) and change nothing; through the window they save', async () => {
    const before = await settings(); const out = [];
    for (const [key, val] of [['autoUpdate', false], ['fallbackWhenBusy', false]]) {
      const r = await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ [key]: val }) }); const t = await r.json().catch(() => ({}));
      if (r.status !== 403 || t.message !== "Change this in Bunny's window.") out.push(key + ' over HTTP: ' + r.status + ' ' + String(t.message).slice(0, 50));
      const after = (await settings())[key]; if (after === val && before[key] !== val) out.push(key + ' changed over HTTP');
      const w = await relay('/api/settings', 'PUT', { [key]: val }); if (w.status !== 200) out.push(key + ' through the window: ' + w.status); else if ((await settings())[key] !== val) out.push(key + ' not saved through the window');
    }
    const mixed = await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ theme: 'dark', autoUpdate: true }) }); if (mixed.status !== 403) out.push('a mixed write with autoUpdate over HTTP: ' + mixed.status);
    ok(!out.length, out.join(' ; ')); return 'both 403 over HTTP, both 200 through the window, a mixed write is 403 as a whole';
  });
  console.log(NL + `${rows.filter((r) => r.v === 'PASS').length} PASS / ${rows.filter((r) => r.v === 'FAIL').length} FAIL of ${rows.length}`);
  await finish(0);
} catch (e) { console.log('HARNESS ERROR', e.stack); await finish(1); }
