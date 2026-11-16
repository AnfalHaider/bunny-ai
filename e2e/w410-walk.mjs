/**
 * QA walk for W4-10 (plugin install and uninstall). Invented profile only. The server is started the way Electron starts it
 * (folderPickerOnly) through e2e/w27-desktop-server.mjs; the page gets a stand-in for the preload bridge (secureWrite -> relay).
 *
 *   SRC=<worktree at the commit under test> OUT=<folder> [PORT0=6301] node e2e/w410-walk.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fc2'; const PORT = +(process.env.PORT0 ?? 6301); const NL = String.fromCharCode(10);
const rows = []; const ok = (c, m) => { if (!c) throw new Error(m); };
let pageRef = null;
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; if (pageRef) { try { await pageRef.screenshot({ path: join(OUT, 'fail-' + id + '.png') }); } catch { /* x */ } } }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(6), name, '::', String(note).slice(0, 300));
};
const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w410-data-'));
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
let desk;
const startServer = async () => {
  desk = spawn('node', ['e2e/w27-desktop-server.mjs'], { env: { ...process.env, SRC, DATA: dataDir, PORT: String(PORT), TOKEN, BUNNY_FAKE_UPSTREAM: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start');
};
const stopServer = async () => { try { execFileSync('taskkill', ['/PID', String(desk.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 500)); };
const http = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b == null ? undefined : JSON.stringify(b) });
const relay = async (path, method, body) => { const r = await (await fetch(`http://127.0.0.1:${PORT + 1000}`, { method: 'POST', body: JSON.stringify({ path, method, body }) })).json(); let data = {}; try { data = JSON.parse(r.body); } catch { /* not json */ } return { status: r.status, data }; };
const pack = (name) => ({ name, description: `${name} (invented)`, connectors: [{ name: `${name} one`, url: `https://example.invalid/${name}/one` }, { name: `${name} two`, url: `https://example.invalid/${name}/two` }], skills: [{ name: `${name} skill`, description: 'invented', instructions: 'Say hello.' }] });
const listOf = async (p) => { const r = await http(p === '/api/plugins' ? '/api/settings' : p); const d = await r.json(); if (p === '/api/plugins') return d.plugins ?? []; return Array.isArray(d) ? d : (d.servers ?? d.skills ?? d.items ?? d.connectors ?? []); };
const counts = async () => ({ connectors: (await listOf('/api/mcp')).length, skills: (await listOf('/api/skills')).length, plugins: (await listOf('/api/plugins')).length });
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } await stopServer(); writeFileSync(join(OUT, 'w410-results.json'), JSON.stringify(rows, null, 1)); const f = rows.filter((r) => r.verdict !== 'PASS').length; console.log(`${NL}${rows.length - f} of ${rows.length} PASS`); process.exit(code ?? (f ? 1 : 0)); };
try {
  await startServer();
  ok((await (await http('/api/health')).json()).fake, 'refusing: not an invented profile');
  const base = await counts(); console.log('baseline', JSON.stringify(base));

  await row('A1', 'over HTTP with only the token: install and uninstall are refused (window-only)', async () => {
    const i = await http('/api/plugins', 'POST', pack('Nope')); const d = await http('/api/plugins/11111111-1111-1111-1111-111111111111', 'DELETE'); const g = await http('/api/plugins/install', 'POST', { url: 'https://github.com/x/y' });
    ok(i.status === 403 && d.status === 403 && g.status === 403, `statuses ${i.status} ${d.status} ${g.status}`); return 'POST /api/plugins, DELETE /api/plugins/:id, POST /api/plugins/install -> 403 403 403';
  });
  let P1;
  await row('A2', 'install through the window path: one plugin row, its 2 connectors and 1 skill appear', async () => {
    const r = await relay('/api/plugins', 'POST', pack('Alpha')); ok(r.status === 200 && r.data.plugin?.id, 'install ' + r.status + JSON.stringify(r.data).slice(0, 120)); P1 = r.data.plugin.id;
    const c = await counts(); ok(c.plugins === base.plugins + 1 && c.connectors === base.connectors + 2 && c.skills === base.skills + 1, 'counts ' + JSON.stringify(c)); return JSON.stringify(c);
  });
  await row('A3', 'installing the same plugin twice gives one row (400 already installed), also two at once', async () => {
    const r = await relay('/api/plugins', 'POST', pack('Alpha')); ok(r.status === 400, 'second install ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 100));
    const two = await Promise.all([relay('/api/plugins', 'POST', pack('Beta')), relay('/api/plugins', 'POST', pack('Beta'))]); const st = two.map((x) => x.status).sort().join(','); ok(st === '200,400', 'two at once ' + st);
    const c = await counts(); ok(c.plugins === base.plugins + 2 && c.connectors === base.connectors + 4 && c.skills === base.skills + 2, 'counts ' + JSON.stringify(c)); return `second:400 "${r.data.message}"; at once: ${st}; ${JSON.stringify(c)}`;
  });
  await row('A4', 'uninstall removes the plugin, its connectors and its skill; gone after a server restart', async () => {
    const d = await relay(`/api/plugins/${P1}`, 'DELETE', {}); ok(d.status === 200, 'delete ' + d.status);
    const c = await counts(); ok(c.plugins === base.plugins + 1 && c.connectors === base.connectors + 2 && c.skills === base.skills + 1, 'after delete ' + JSON.stringify(c));
    await stopServer(); await startServer(); const c2 = await counts(); ok(JSON.stringify(c2) === JSON.stringify(c), 'after restart ' + JSON.stringify(c2));
    ok(!/Alpha/.test(JSON.stringify(await listOf('/api/mcp')) + JSON.stringify(await listOf('/api/skills')) + JSON.stringify(await listOf('/api/plugins'))), 'Alpha still listed'); return `after delete ${JSON.stringify(c)}; after restart ${JSON.stringify(c2)}`;
  });
  await row('A5', 'unknown id; and a plugin whose connectors were removed by hand', async () => {
    const u = await relay('/api/plugins/22222222-2222-2222-2222-222222222222', 'DELETE', {}); ok(u.status === 200, 'unknown id ' + u.status);
    const g = await relay('/api/plugins', 'POST', pack('Gamma')); ok(g.status === 200, 'install Gamma'); const mine = (await listOf('/api/mcp')).filter((m) => /Gamma/.test(m.name));
    for (const m of mine) { const r = await relay(`/api/mcp/${m.id}`, 'DELETE', {}); ok(r.status < 500, 'hand remove ' + r.status); }
    const d = await relay(`/api/plugins/${g.data.plugin.id}`, 'DELETE', {}); ok(d.status === 200, 'uninstall with parts missing ' + d.status); ok(!/Gamma/.test(JSON.stringify(await listOf('/api/plugins')) + JSON.stringify(await listOf('/api/skills'))), 'Gamma left behind'); return `unknown id 200; hand-removed ${mine.length} connector(s) first, then uninstall 200`;
  });

  // ------------------------------------------------------------- the screen
  browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const page = await ctx.newPage(); pageRef = page;
  const bridge = []; let failNext = null;
  await page.exposeFunction('__secureWrite', async (method, path, body) => { if (failNext && method === failNext.method) { const f = failNext; failNext = null; bridge.push(`${method} ${path} FORCED ${f.status}`); return { status: f.status, data: { message: f.message } }; } const r = await relay(path, method, body); bridge.push(`${method} ${path} ${r.status}`); return r; });
  await page.addInitScript(() => { window.bunnyDesktop = { secureWrite: (m, p, b) => window.__secureWrite(m, p, b) }; });
  let dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const open = async () => { await page.goto('/src/ui/customize.html'); await page.waitForTimeout(700); await page.locator('.cz-tab[data-kind="plugins"]').click(); await page.waitForTimeout(200); const y = page.locator('.cz-scope [data-scope="yours"]'); if (await y.count()) await y.click(); await page.waitForTimeout(200); };
  const listText = async () => (await page.locator('#cz-list').innerText()).replace(/\s+/g, ' ');
  const fileOf = (name) => { const f = join(OUT, `${name}.json`); writeFileSync(f, JSON.stringify(pack(name))); return f; };
  const addFile = async (f) => { await page.locator('#cz-add').click(); await page.waitForTimeout(150); const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Plugin from file/ }).click()]); await fc.setFiles(f); await page.waitForTimeout(900); ok(await page.locator('#cz-add-menu').isHidden(), 'the Add menu stayed open after choosing'); };
  const u0 = await counts(); console.log('screen baseline', JSON.stringify(u0));

  await row('B1', 'screen: install a plugin from a file; its row shows on the Plugins tab', async () => {
    await open(); await addFile(fileOf('Delta')); const t = await listText(); ok(/Delta/.test(t), 'row missing: ' + t.slice(0, 160)); await page.screenshot({ path: join(OUT, 'b1-installed.png') });
    const c = await counts(); ok(c.plugins === u0.plugins + 1 && c.connectors === u0.connectors + 2 && c.skills === u0.skills + 1, JSON.stringify(c)); return `${t.slice(0, 120)} | ${bridge.slice(-1)}`;
  });
  await row('B2', 'screen: the same file again shows an error in words and still one row', async () => {
    await addFile(fileOf('Delta')); const e = await page.locator('#cz-error').innerText(); ok(/could not be installed/.test(e) && /already/i.test(e), 'error line: ' + e);
    const c = await counts(); ok(c.plugins === u0.plugins + 1, 'plugins ' + c.plugins); const t = await listText(); ok((t.match(/Delta \(invented\)/g) ?? []).length === 1, 'rows: ' + t.slice(0, 200)); await page.screenshot({ path: join(OUT, 'b2-twice.png') }); return e;
  });
  await row('B3', 'screen: a failing uninstall shows an error and keeps the plugin', async () => {
    failNext = { method: 'DELETE', status: 500, message: 'the disk is full (invented)' };
    await page.locator('#cz-list > *').filter({ hasText: 'Delta (invented)' }).getByRole('button', { name: /Uninstall/ }).click(); await page.waitForTimeout(700); const e = await page.locator('#cz-error').innerText(); ok(/Delta could not be uninstalled: the disk is full/.test(e), 'error line: ' + e);
    const c = await counts(); ok(c.plugins === u0.plugins + 1 && c.connectors === u0.connectors + 2, JSON.stringify(c)); ok(/Delta/.test(await listText()), 'row vanished'); await page.screenshot({ path: join(OUT, 'b3-failed.png') }); return e;
  });
  await row('B4', 'screen: Uninstall removes the row, connectors and skill; still gone after a reload', async () => {
    await page.locator('#cz-list > *').filter({ hasText: 'Delta (invented)' }).getByRole('button', { name: /Uninstall/ }).click(); await page.waitForTimeout(900); ok(!/Delta/.test(await listText()), 'row still shown'); ok((await page.locator('#cz-error').innerText()) === '', 'error line not cleared');
    await page.reload(); await page.waitForTimeout(700); await page.locator('.cz-tab[data-kind="plugins"]').click(); await page.waitForTimeout(300); ok(!/Delta/.test(await listText()), 'row back after reload');
    for (const k of ['connectors', 'skills']) { await page.locator(`.cz-tab[data-kind="${k}"]`).click(); await page.waitForTimeout(300); ok(!/Delta/.test(await listText()), `${k} tab still lists Delta`); }
    const c = await counts(); ok(c.plugins === u0.plugins && c.connectors === u0.connectors && c.skills === u0.skills, JSON.stringify(c)); return JSON.stringify(c);
  });
  await row('B5', 'screen: bulk Uninstall removes several plugins at once', async () => {
    await open(); for (const n of ['Eps', 'Zeta', 'Eta']) await addFile(fileOf(n)); await page.waitForTimeout(300);
    const c1 = await counts(); ok(c1.plugins === u0.plugins + 3, 'installed ' + JSON.stringify(c1));
    await page.locator('.cz-tab[data-kind="plugins"]').click(); await page.waitForTimeout(200); await page.locator('#cz-all').check(); await page.waitForTimeout(300);
    const label = await page.locator('#cz-bulk [data-bulk="remove"]').innerText(); ok(/Uninstall/.test(label), 'bulk label: ' + label); dialogs = [];
    await page.locator('#cz-bulk [data-bulk="remove"]').click(); await page.waitForTimeout(1500); await page.screenshot({ path: join(OUT, 'b5-bulk.png') });
    ok(dialogs.some((d) => /Uninstall 4 plugins\?/.test(d)), 'confirm text: ' + JSON.stringify(dialogs)); const c2 = await counts(); ok(c2.plugins === 0 && c2.connectors === 0 && c2.skills === 0, 'after bulk ' + JSON.stringify(c2));
    await page.reload(); await page.waitForTimeout(600); await page.locator('.cz-tab[data-kind="plugins"]').click(); await page.waitForTimeout(300); ok(!/Beta|Eps|Zeta|Eta/.test(await listText()), 'rows back after reload'); return `label "${label}"; confirm "${dialogs[0]}"; ${JSON.stringify(c2)}`;
  });
  await row('B6', 'every screen write to a protected route went through the window bridge', async () => {
    const via = bridge.filter((b) => /plugins/.test(b)); ok(via.length >= 8, 'bridge calls ' + via.length); return `${via.length} plugin writes via the bridge, e.g. ${via.slice(0, 3).join(' | ')}`;
  });
  await finish();
} catch (e) { console.log('ABORT', e.message); rows.push({ id: 'X', name: 'abort', verdict: 'FAIL', note: e.message }); await finish(1); }
