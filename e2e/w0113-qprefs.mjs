/**
 * QA, v0.1.13: Quick ask kept across restarts, on an UNUSUAL shortcut (so another program holding Ctrl+Alt+Space cannot spoil it), real Electron, invented profile.
 * Also says whether the default shortcut is free on this PC (informational). Three launches.
 *   node e2e/w0113-qprefs.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113q-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0113q-user-'));
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).slice(0, 300) : '')); };
const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const ACC = 'Ctrl+Alt+Shift+F9';
async function launch() {
  const app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
  const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
  await app.evaluate(({ app: a, shell }) => { a.setLoginItemSettings = () => {}; shell.openExternal = async () => {}; });
  return { app, win };
}
const quit = async (app) => { try { await Promise.race([app.close(), wait(20000)]); } catch { /* x */ } try { app.process().kill(); } catch { /* x */ } await wait(1500); };
let { app, win } = await launch();
const defFree = await app.evaluate(({ globalShortcut }) => { const ok = globalShortcut.register('Ctrl+Alt+Space', () => {}); globalShortcut.unregister('Ctrl+Alt+Space'); return ok; });
console.log('INFO the default shortcut Ctrl+Alt+Space is ' + (defFree ? 'free' : 'HELD by another program') + ' on this PC');
const set = await win.evaluate((acc) => window.bunnyDesktop.setPrefs({ quickAskEnabled: true, quickAskShortcut: acc }), ACC);
check('QP-1', 'Quick ask on with an unusual shortcut: accepted, tray rule turns the tray on, shortcut registered', set.quickAskEnabled === true && set.closeToTray === true && !set.quickAskError && await app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), ACC), JSON.stringify(set));
await quit(app);
for (const n of [2, 3]) {
  ({ app, win } = await launch());
  const p = await win.evaluate(() => window.bunnyDesktop.getPrefs());
  check('QP-' + n, `launch ${n}: Quick ask still on, same shortcut, tray on, and the shortcut is registered again`, p.quickAskEnabled === true && p.quickAskShortcut === ACC && p.closeToTray === true && await app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), ACC), JSON.stringify(p).slice(0, 200));
  await quit(app);
}
const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); process.exit(bad.length ? 1 : 0);
