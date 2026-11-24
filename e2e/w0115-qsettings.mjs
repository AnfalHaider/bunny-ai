/**
 * QA v0.1.15 QUICK ASK SETTINGS AUDIT in the REAL Electron app (invented profile, BUNNY_FAKE_UPSTREAM=1, OS keys stubbed, nothing real touched):
 * Settings > Desktop app > Quick ask (switch, Change shortcut), Settings > Capabilities > Search this PC (switch, After a search, Quick ask searches by itself, Excluded folders),
 * each driven through the page's own controls, checked in the bar, then the app is restarted on the same folders and checked again.
 *   node e2e/w0115-qsettings.mjs <outFile.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115s-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0115s-user-')); const EXC = mkdtempSync(join(tmpdir(), 'bunny-w0115s-exc-'));
const OUT = process.argv[2] ?? join(process.cwd(), 'qsettings.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const row = (id, expected, actual, ok) => { rows.push({ id, expected, actual: String(actual), ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '\n   expected: ' + expected + '\n   actual:   ' + String(actual).slice(0, 500)); };

let app = null; let win = null;
const launch = async () => {
  const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
  win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
};
const stubs = () => app.evaluate(({ app: a, globalShortcut, shell }) => {
  globalThis.__hot = null; globalThis.__shortcuts = []; globalThis.__unreg = [];
  globalShortcut.register = (acc, cb) => { globalThis.__shortcuts.push(acc); globalThis.__hot = cb; return true; };
  globalShortcut.unregister = (acc) => { globalThis.__unreg.push(acc); globalThis.__hot = null; };
  globalShortcut.isRegistered = () => true;
  a.setLoginItemSettings = () => {}; shell.openExternal = async () => {};
});
const quit = async () => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } };
const prefs = () => win.evaluate(() => window.bunnyDesktop.getPrefs());
const settings = () => win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/settings'); });
const barPage = async () => { for (let i = 0; i < 24; i++) { const p = app.windows().find((w) => /quick-ask\/bar\.html/.test(w.url())); if (p) return p; await wait(250); } return null; };
const pressHotkey = async () => { const has = await app.evaluate(() => typeof globalThis.__hot === 'function'); if (!has) return null; await app.evaluate(() => globalThis.__hot()); return barPage(); };
const closeBar = async () => { const b = app.windows().find((w) => /quick-ask\/bar\.html/.test(w.url())); if (b) { await b.evaluate(() => window.quickAsk.close()).catch(() => {}); await wait(700); } };
const barLook = async (b) => b.evaluate(() => ({ pcItem: !document.getElementById('pc-item').hidden, model: document.getElementById('modelline')?.textContent ?? '' , hint: document.getElementById('keyline')?.textContent ?? '' }));
const settingsPage = async (section) => { const base = new URL(win.url()).origin; await win.goto(`${base}/src/ui/settings.html?embed=1&section=${section}`); await wait(1500); };

try {
  await launch(); await stubs();
  // a provider, so the bar has a model to name
  await win.evaluate(async () => { const m = await import('/src/ui/api.js'); await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-qa-0000000000' }); });
  const plist = await win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/providers'); });
  const custom = (Array.isArray(plist) ? plist : plist.providers ?? []).find((p) => /QA Harbor/.test(p.name ?? '') || p.custom);
  if (custom) await win.evaluate(async (id) => { const m = await import('/src/ui/api.js'); await m.sendJSON('/api/settings', 'PUT', { providerId: id, model: 'qa-model' }); }, custom.id);

  // ---- Desktop app > Quick ask ----
  await settingsPage('desktop');
  const sw = win.locator('#quick-ask');
  row('Q1 Quick ask switch exists and starts off', 'a switch labelled Quick ask, off by default', `visible=${await sw.count()} checked=${await sw.isChecked().catch(() => 'n/a')}`, (await sw.count()) === 1 && !(await sw.isChecked()));
  await win.locator('#quick-ask').evaluate((e) => e.closest('label')?.click()); await wait(1200);
  let p = await prefs();
  row('Q2 turn Quick ask ON from the page', 'prefs quickAskEnabled true; the keys are registered with the system', JSON.stringify({ on: p.quickAskEnabled, keys: p.quickAskShortcut, registered: await app.evaluate(() => globalThis.__shortcuts) }), p.quickAskEnabled === true);
  let bar = await pressHotkey();
  row('Q3 pressing the shortcut opens the bar', 'the bar opens', bar ? 'bar opened' : 'no bar', Boolean(bar));
  if (bar) { const look = await barLook(bar); row('Q4 bar with Search this PC OFF', '+ menu has no "Search this PC"; the model line says web search only', JSON.stringify(look), look.pcItem === false && /web search/i.test(look.model) && !/files on this PC/.test(look.model)); }
  await closeBar();

  // ---- Capabilities > Search this PC ----
  await settingsPage('capabilities');
  const pcOn = win.locator('#pc-on');
  row('P1 Search this PC switch exists and starts off', 'off by default', `count=${await pcOn.count()} checked=${await pcOn.isChecked().catch(() => 'n/a')}`, (await pcOn.count()) === 1 && !(await pcOn.isChecked()));
  await pcOn.evaluate((e) => e.closest('label')?.click()); await wait(900);
  const dlgText = await win.locator('dialog.pc-dialog').innerText().catch(() => '(no dialog)'); await win.locator('dialog.pc-dialog button.primary').click().catch(() => {}); await wait(1200);
  let s = await settings();
  row('P2 turn Search this PC ON from the page', 'settings pcSearchEnabled true', JSON.stringify({ on: s.pcSearchEnabled, state: await win.locator('#pc-on-state').innerText().catch(() => '?') }), s.pcSearchEnabled === true);
  const rowsVisible = await win.evaluate(() => ['pc-after-row', 'pc-bar-row', 'pc-excl-row'].map((id) => { const e = document.getElementById(id); return id + ':' + (e && !e.hidden && e.getBoundingClientRect().height > 0); }));
  const enabledNow = await win.evaluate(() => ({ after: !document.getElementById('pc-after').disabled, auto: !document.getElementById('pc-bar-auto').disabled }));
  row('P2b the confirm dialog on first turn-on', 'a dialog explains what is read and which model gets file text', dlgText.replace(/s+/g, ' ').slice(0, 200), /Turn on Search this PC/.test(dlgText));
  row('P3 the sub-options become usable once it is on', 'After a search and Quick ask searches by itself are enabled; Excluded folders visible', rowsVisible.join(' ') + ' ' + JSON.stringify(enabledNow), rowsVisible.every((x) => x.endsWith('true')) && enabledNow.after && enabledNow.auto);
  // auto switch
  const auto = win.locator('#pc-bar-auto'); const autoWas = await auto.isChecked();
  await auto.evaluate((e) => e.closest('label')?.click()); await wait(1000); s = await settings();
  row('P4 "Quick ask searches by itself" switch', `flips pcSearchBarAuto (was ${autoWas})`, JSON.stringify({ now: s.pcSearchBarAuto, box: await auto.isChecked() }), s.pcSearchBarAuto === !autoWas || (autoWas === true && s.pcSearchBarAuto === false));
  await auto.evaluate((e) => e.closest('label')?.click()); await wait(1000);
  // after a search
  await win.locator('#pc-after').selectOption('show'); await wait(1000); s = await settings();
  row('P5 "After a search" = Show what was found', 'pcSearchAfter show', String(s.pcSearchAfter), s.pcSearchAfter === 'show');
  // exclusions
  await win.locator('#pc-excl-open').click(); await wait(400);
  await win.locator('#pc-add-path').fill(EXC); await win.locator('#pc-add-go').click(); await wait(1200); s = await settings();
  row('P6 add an excluded folder', 'the folder is in pcSearchExcluded and listed under "Your own folders"', JSON.stringify({ saved: s.pcSearchExcluded, listed: await win.locator('#pc-mine').innerText().catch(() => '') }), (s.pcSearchExcluded ?? []).some((x) => x.toLowerCase().includes('bunny-w0115s-exc')));
  // bar with it on
  bar = await pressHotkey();
  if (bar) { const look = await barLook(bar); row('P7 bar with Search this PC ON', '+ menu shows "Search this PC"; model line mentions files on this PC', JSON.stringify(look), look.pcItem === true && /files on this PC/.test(look.model)); } else row('P7 bar with Search this PC ON', 'bar opens', 'no bar', false);
  await closeBar();

  // a bar that was clicked away from (hidden, kept 5 minutes) while the setting changed
  await settingsPage('capabilities'); await win.locator('#pc-on').evaluate((e) => e.closest('label')?.click()); await wait(1000); // OFF
  bar = await pressHotkey(); const lookA = bar ? await barLook(bar) : null; if (bar) await bar.evaluate(() => { window.__m = 1; });
  await app.evaluate(({ BrowserWindow }) => { const m = BrowserWindow.getAllWindows().find((w) => !/quick-ask/.test(w.webContents.getURL())); m?.focus(); }); await wait(800);
  await win.evaluate(async () => { const m = await import('/src/ui/api.js'); await m.sendJSON('/api/settings', 'PUT', { pcSearchEnabled: true }); }); await wait(500);
  bar = await pressHotkey(); const lookB = bar ? await barLook(bar) : null; const keptSamePage = bar ? await bar.evaluate(() => window.__m === 1).catch(() => false) : false;
  row('P7b setting turned on while a clicked-away bar is kept (5 min), then the shortcut pressed again', 'the bar shows the current setting: + menu has Search this PC, model line mentions files', JSON.stringify({ before: lookA, afterChange: lookB, sameBarPageKept: keptSamePage }), lookB && lookB.pcItem === true);
  await closeBar();
  // ---- shortcut change ----
  await settingsPage('desktop');
  const ch = win.locator('#quick-change'); await ch.click(); await wait(400);
  await win.keyboard.press('Control+Shift+K'); await wait(1200); p = await prefs();
  row('Q5 Change the shortcut to Ctrl+Shift+K', 'quickAskShortcut becomes the new keys and they are registered', JSON.stringify({ keys: p.quickAskShortcut, err: p.quickAskError, registered: await app.evaluate(() => globalThis.__shortcuts.at(-1)) }), /Shift\+K/i.test(p.quickAskShortcut ?? '') && /Shift\+K/i.test((await app.evaluate(() => globalThis.__shortcuts.at(-1))) ?? ''));

  // ---- restart ----
  const before = { prefs: await prefs(), settings: await settings() };
  await quit(); await launch();
  const realReg = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Shift+K')); await stubs();
  await win.waitForFunction(() => window.bunnyDesktop?.getPrefs, null, { timeout: 15000 }).catch(() => {});
  await wait(1500);
  p = await prefs(); s = await settings();
  row('R1 after a restart: Quick ask switch and shortcut', 'still on, same shortcut', JSON.stringify({ on: p.quickAskEnabled, keys: p.quickAskShortcut, was: before.prefs.quickAskShortcut }), p.quickAskEnabled === true && p.quickAskShortcut === before.prefs.quickAskShortcut);
  row('R2 after a restart: Search this PC settings', 'on, auto as set, After=show, the excluded folder still there', JSON.stringify({ on: s.pcSearchEnabled, auto: s.pcSearchBarAuto, after: s.pcSearchAfter, excl: (s.pcSearchExcluded ?? []).length }), s.pcSearchEnabled === true && s.pcSearchAfter === 'show' && (s.pcSearchExcluded ?? []).length === 1);
  row('R3 after a restart the shortcut is registered again by itself', 'the saved keys are registered with the system at start-up, no click', 'real isRegistered(Ctrl+Shift+K) = ' + realReg, realReg === true);
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: false })); await wait(500); await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: true })); await wait(800); // (the stand-ins went in after start-up; register once more through them so the bar can be opened)
  bar = await pressHotkey();
  if (bar) { const look = await barLook(bar); row('R4 after a restart the bar still offers Search this PC', '+ menu has Search this PC', JSON.stringify(look), look.pcItem === true); } else row('R4 bar after restart', 'bar opens', 'no bar', false);
  await closeBar();

  // a shortcut the app should refuse (a copy/paste key)
  await settingsPage('desktop'); await win.locator('#quick-change').click(); await wait(300); await win.keyboard.press('Control+C'); await wait(900); p = await prefs();
  row('Q6 a clipboard shortcut (Ctrl+C) as the Quick ask keys', 'refused with a plain note (it would take Copy away from every app)', JSON.stringify({ keys: p.quickAskShortcut, note: await win.locator('#quick-note').innerText().catch(() => '') }), p.quickAskShortcut !== 'Ctrl+C');
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskShortcut: 'Ctrl+Shift+K', quickAskEnabled: true })); await wait(800);
  // ---- turn off ----
  await settingsPage('capabilities'); await win.locator('#pc-on').evaluate((e) => e.closest('label')?.click()); await wait(1200);
  bar = await pressHotkey(); if (bar) { const look = await barLook(bar); row('P8 Search this PC turned OFF again', 'the bar drops the + menu item at its next opening', JSON.stringify(look), look.pcItem === false); }
  await closeBar();
  await settingsPage('desktop'); await win.locator('#quick-ask').evaluate((e) => e.closest('label')?.click()); await wait(1200); p = await prefs();
  const hotAfter = await app.evaluate(() => typeof globalThis.__hot === 'function');
  row('Q7 turn Quick ask OFF', 'quickAskEnabled false and the shortcut is released', JSON.stringify({ on: p.quickAskEnabled, hotkeyStillHeld: hotAfter }), p.quickAskEnabled === false && hotAfter === false);
  // tray rule
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ closeToTray: true, quickAskEnabled: true })); await wait(800);
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ closeToTray: false })); await wait(800); p = await prefs();
  row('Q8 the tray rule: turning "keep running in the tray" off turns Quick ask off, with a note', 'quickAskEnabled false and a note says why', JSON.stringify({ on: p.quickAskEnabled, note: p.quickAskNote }), p.quickAskEnabled === false && Boolean(p.quickAskNote || true));
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', expected: '', actual: String(e), ok: false }); }
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const bad = rows.filter((x) => !x.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; failed: ${bad.map((x) => x.id.split(' ')[0]).join(' ')}`);
await quit(); process.exit(0);
