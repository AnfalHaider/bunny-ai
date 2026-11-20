/**
 * QA v0.1.15 SETTINGS CHANGE + RESTART: every input, select and textarea in every Settings section is changed through the page, the requests it sends are recorded,
 * the app is restarted on the same invented folders, and each control is read again. Real Electron, BUNNY_FAKE_UPSTREAM=1, nothing real.
 *   node e2e/w0115-sapply.mjs <inventory.json> <outFile.json>
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115a-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0115a-user-'));
const inv = JSON.parse(readFileSync(process.argv[2], 'utf8')); const OUT = process.argv[3] ?? join(process.cwd(), 'sapply.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let app = null; let win = null; let base = '';
const launch = async () => {
  const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
  await app.evaluate(({ app: a, globalShortcut, shell }) => { globalShortcut.register = () => true; globalShortcut.unregister = () => {}; globalShortcut.isRegistered = () => true; a.setLoginItemSettings = () => {}; shell.openExternal = async () => {}; });
  win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500); base = new URL(win.url()).origin;
};
const quit = async () => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } };
const SKIP = /^(photo-|github-|google-|remote-|start-import|import-|run-memory|copy-import|check-update|restart-update|open-browser|install-app|quick-change|manage-memory|engine-default$|pc-add|pc-excl|pc-act|rules-(tab|add|try|folder)|save-models|open-appearance)/;
const controls = inv.filter((x) => x.id !== undefined && ['input:checkbox', 'select', 'input:text', 'input:number', 'textarea', 'input:password'].includes(x.kind) && !SKIP.test(x.id));
const results = [];
const open = async (section) => { await win.goto(`${base}/src/ui/settings.html?embed=1&section=${section}`); await win.evaluate(() => {
  window.__reqs = []; const f = window.fetch; window.fetch = async (u, i) => { if (i && i.method && i.method !== 'GET') window.__reqs.push({ m: i.method, u: String(u), b: typeof i.body === 'string' ? i.body.slice(0, 300) : '' }); return f(u, i); };
  const d = window.bunnyDesktop; if (d?.setPrefs) { const sp = d.setPrefs.bind(d); window.__prefs = []; d.setPrefs = (p) => { window.__prefs.push(JSON.stringify(p)); return sp(p); }; }
}); await wait(1500); };
const kindSel = (c) => (c.kind.startsWith('input:checkbox') ? 'input[type=checkbox]' : c.kind === 'select' ? 'select' : c.kind === 'textarea' ? 'textarea' : c.kind === 'input:text' ? 'input[type=text]' : c.kind === 'input:number' ? 'input[type=number]' : 'input');
const locatorFor = (c, nth) => (c.id ? win.locator('#' + c.id) : c.name ? win.locator(`[data-section="${c.section}"] .row:has(> .meta-col > .name:text-is(${JSON.stringify(c.name)}))`).locator(kindSel(c)).first() : win.locator(`[data-section="${c.section}"]`).locator(kindSel(c)).nth(nth));
const locatorForOld = (c, nth) => (c.id ? win.locator('#' + c.id) : win.locator(`[data-section="${c.section}"]`).locator(c.kind.startsWith('input:checkbox') ? 'input[type=checkbox]' : c.kind === 'select' ? 'select' : c.kind === 'input:text' ? 'input[type=text]' : 'input').nth(nth));
const answerDialogs = async () => { for (let i = 0; i < 3; i++) { const b = win.locator('dialog[open] button.primary, .engine-confirm button.primary, [role=dialog] button.primary'); if (await b.count()) { await b.first().click().catch(() => {}); await wait(600); } else break; } };

try {
  await launch();
  // a model, so model-dependent controls exist
  await win.evaluate(async () => { const m = await import('/src/ui/api.js'); await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-qa-0000000000' }); });
  const bySection = new Map(); for (const c of controls) { if (!bySection.has(c.section)) bySection.set(c.section, []); bySection.get(c.section).push(c); }
  for (const [section, list] of bySection) {
    await open(section);
    const counters = {};
    for (const c of list) {
      const key = c.kind + ':' + section; counters[key] = (counters[key] ?? -1) + 1; const nth = counters[key];
      const loc = locatorFor(c, nth); const rec = { section: c.section, group: c.group, id: c.id, kind: c.kind, name: c.name || c.aria, desc: c.desc, before: c.value, options: c.options };
      try {
        if ((await loc.count()) === 0) { rec.note = 'control not found again'; results.push(rec); continue; }
        if (await loc.isDisabled()) { rec.note = 'disabled at this point (depends on another switch)'; rec.disabled = true; results.push(rec); continue; }
        await win.evaluate(() => { window.__reqs.length = 0; if (window.__prefs) window.__prefs.length = 0; window.__ls = JSON.stringify(Object.entries(localStorage)); });
        let want;
        if (c.kind === 'input:checkbox') { want = !(await loc.isChecked()); await loc.evaluate((e) => { const l = e.closest('label'); if (l) l.click(); else e.click(); }); }
        else if (c.kind === 'select') { const cur = await loc.inputValue(); const opts = await loc.evaluate((s) => [...s.options].filter((o) => !o.disabled).map((o) => o.value)); want = opts.find((o) => o !== cur) ?? cur; await loc.selectOption(want); }
        else if (c.kind === 'input:number') { const cur = Number(await loc.inputValue()) || 0; want = String(cur + 7 > 99999999 ? cur - 7 : cur + 7); await loc.fill(want); await loc.blur(); await loc.dispatchEvent('change'); }
        else { want = 'qa-' + (c.id || 'x'); await loc.fill(want); await loc.blur(); await loc.dispatchEvent('change'); }
        await wait(900); await answerDialogs(); await wait(500);
        const saveBtn = win.locator(`[data-section="${c.section}"] button:visible`).filter({ hasText: /^(Save|Save models|Save rules|Save instructions|Apply)$/ }); if (await saveBtn.count() && (c.id === 'instructions' || /allowlist|aliases|max-tokens|auto-tokens/.test(c.id))) { await saveBtn.first().click().catch(() => {}); rec.clickedSave = true; await wait(900); }
        rec.localStorageChanged = await win.evaluate(() => JSON.stringify(Object.entries(localStorage)) !== window.__ls);
        const reqs = await win.evaluate(() => ({ reqs: window.__reqs, prefs: window.__prefs ?? [] }));
        rec.want = want; rec.sent = reqs.reqs.map((r) => `${r.m} ${r.u.replace(/^https?:\/\/[^/]+/, '')} ${r.b}`).concat(reqs.prefs.map((p) => 'setPrefs ' + p));
        rec.after = c.kind === 'input:checkbox' ? await loc.isChecked() : await loc.inputValue();
        rec.error = (await win.locator('[role=alert]:visible, .error:visible').first().innerText({ timeout: 300 }).catch(() => '')) || undefined;
      } catch (e) { rec.note = 'script: ' + String(e.message ?? e).split('\n')[0].slice(0, 160); }
      results.push(rec);
    }
  }
  const prefsBefore = await win.evaluate(() => window.bunnyDesktop.getPrefs()); const settingsBefore = await win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/settings'); });
  await quit(); await launch();
  // after the restart: read each control again
  const prefsAfter = await win.evaluate(() => window.bunnyDesktop.getPrefs()); const settingsAfter = await win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/settings'); });
  const seen = new Map();
  for (const rec of results) {
    if (rec.want === undefined) continue;
    if (!seen.has(rec.section)) { await open(rec.section); seen.set(rec.section, {}); }
    const key = rec.kind + ':' + rec.section; const st = seen.get(rec.section); st[key] = (st[key] ?? -1) + 1;
    const loc = locatorFor(rec, st[key]);
    try { rec.restarted = rec.kind === 'input:checkbox' ? await loc.isChecked() : await loc.inputValue(); } catch { rec.restarted = '(not readable)'; }
    rec.stuck = String(rec.restarted) === String(rec.want);
    rec.changed = rec.sent?.length > 0;
  }
  writeFileSync(OUT, JSON.stringify({ results, settingsBefore, settingsAfter, prefsBefore, prefsAfter }, null, 1));
  const n = results.filter((r) => r.want !== undefined);
  console.log('controls changed', n.length, 'sent a request', n.filter((r) => r.changed).length, 'stuck', n.filter((r) => r.stuck).length, 'disabled/skipped', results.length - n.length);
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); }
await quit(); process.exit(0);
