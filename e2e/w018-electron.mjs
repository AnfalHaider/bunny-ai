/**
 * QA: the REAL Electron window on an invented profile (the project's own Electron from `npm ci` and its install script).
 * Isolation: BUNNY_DATA_DIR and --user-data-dir are temp folders, so the single-instance lock, the preferences and the chats are invented;
 * %LOCALAPPDATA%\BunnyAI is never read or written (only its folder's last-modified time is looked at, to show it did not change).
 * launchAtLogin is never touched (it would write a Windows login item). The updater stays off (not packaged, no feed).
 * What it covers: launch and isolation, the page, the window-only bridge (the real main process), the quick-ask settings and tray rule with
 * the real globalShortcut, the real Ctrl+Alt+Space (sent once, only when the shortcut is registered by this app), the real bar window, a new chat
 * in the window, spell check and the right-click menu, a second launch handing over to the first.
 *   node e2e/w018-electron.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { mkdtempSync, mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron } from 'playwright';

const root = process.cwd();
const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w018-el-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w018-el-user-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };
const real = join(process.env.LOCALAPPDATA ?? '', 'BunnyAI');
const realMtime = () => { try { return statSync(real).mtimeMs; } catch { return null; } };
const before = realMtime();
const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' };
delete env.BUNNY_UPDATE_FEED;

const app = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env, timeout: 60000 });
const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(e.message)); win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500);
const info = await app.evaluate(({ app: a }) => ({ userData: a.getPath('userData'), packaged: a.isPackaged, version: a.getVersion(), name: a.getName(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }));
check('EL1', 'the real Electron window opens on the invented profile (app name, version, Electron, Chromium)', Boolean(win) && /^http:\/\/127\.0\.0\.1:\d+\//.test(win.url()), `${info.name} ${info.version}; electron ${info.electron}; chrome ${info.chrome}; ${win.url()}`);
check('EL2', 'userData is the invented temp folder (so the lock, prefs and cache are not the owner\'s) and the app is not packaged (updater off)', info.userData.toLowerCase().startsWith(USER.toLowerCase()) && info.packaged === false, info.userData);
check('EL3', 'the chat page is on screen (message box, Send, model picker)', (await win.locator('#input').count()) === 1 && (await win.locator('#send').count()) === 1 && (await win.locator('#picker-button').count()) === 1);
await win.screenshot({ path: join(SHOTS, 'el-main.png') });
const bounds = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds(); return { ...b, visible: w.isVisible(), frame: !w.isFrameless?.() , title: w.getTitle(), menuBar: w.isMenuBarVisible() }; });
check('EL4', 'the window is visible, has a sensible size and a title', bounds.visible && bounds.width >= 800 && bounds.height >= 500 && /bunny/i.test(bounds.title), JSON.stringify(bounds));

// ---- the bridge and window-only writes (real main process)
const bridge = await win.evaluate(() => ({ platform: window.bunnyDesktop?.platform, keys: Object.keys(window.bunnyDesktop ?? {}).sort().join(','), node: typeof require, proc: typeof process }));
check('EL5', 'the page sees only window.bunnyDesktop (no Node, no require, no process)', bridge.platform === 'win32' && bridge.node === 'undefined' && bridge.proc === 'undefined' && /secureWrite/.test(bridge.keys), JSON.stringify(bridge));
const plain = await win.evaluate(async () => (await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultPermissionMode: 'auto' }) })).status);
check('EL6', 'a plain write of a window-only setting from the page (no bridge) is refused with 403', plain === 403, `status ${plain}`);
const viaBridge = await win.evaluate(async () => { const api = await import('/src/ui/api.js'); try { await api.sendJSON('/api/settings', 'PUT', { defaultPermissionMode: 'ask' }); return 'ok'; } catch (e) { return `error ${e.message}`; } });
check('EL7', 'the same kind of write made through the bridge (the main process) works', viaBridge === 'ok', viaBridge);
const folderLock = await win.evaluate(async () => { const r = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', permissionMode: 'auto' }) }); return r.status; });
check('EL8', 'creating a chat that sets the permission mode directly (no bridge) is refused too (403)', folderLock === 403, `status ${folderLock}`);

// ---- quick ask: settings, tray rule, real shortcut
let accel = 'Ctrl+Alt+Space'; let keys = [0x11, 0x12, 0x20]; // Ctrl, Alt, Space
const registered = () => app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accel);
const pressKeys = () => { // the real keys, pressed and released by the operating system; used only when this app has registered the shortcut
  const down = keys.map((k) => `[K]::keybd_event(${k},0,0,$z)`).join('; '); const up = [...keys].reverse().map((k) => `[K]::keybd_event(${k},0,2,$z)`).join('; ');
  const ps = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);}'; $z=[UIntPtr]::Zero; ${down}; Start-Sleep -Milliseconds 80; ${up}`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 });
};
check('EL9', 'quick ask is off by default: the shortcut is not registered', (await registered()) === false);
const prefs0 = await win.evaluate(() => window.bunnyDesktop.getPrefs());
check('EL10', 'the desktop preferences start as: close to tray off, quick ask off, shortcut Ctrl+Alt+Space', prefs0.quickAskEnabled === false && prefs0.closeToTray === false && prefs0.quickAskShortcut === accel, JSON.stringify(prefs0));
await win.evaluate(() => window.bunnyDesktop.setPrefs({ closeToTray: true }));
const enableResult = await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: true }));
await win.waitForTimeout(600);
let onNow = await registered();
console.log(`INFO  switching quick ask on with Ctrl+Alt+Space: registered ${onNow}; answer ${JSON.stringify({ on: enableResult.quickAskEnabled, error: enableResult.quickAskError, note: enableResult.quickAskNote })}`);
check('EL11', 'with the tray on, switching quick ask on either registers the real global shortcut Ctrl+Alt+Space or answers that it is already used by another app (and says so, not a silent failure)', onNow === true || /already used by another app/.test(enableResult.quickAskError ?? ''), `registered ${onNow}; error "${enableResult.quickAskError}"`);
if (!onNow) {
  accel = 'Ctrl+Alt+Shift+Q'; keys = [0x11, 0x12, 0x10, 0x51];
  const r2 = await win.evaluate((a) => window.bunnyDesktop.setPrefs({ quickAskEnabled: true, quickAskShortcut: a }), accel);
  await win.waitForTimeout(600); onNow = await registered();
  check('EL11b', 'the person can change the shortcut: Ctrl+Alt+Shift+Q is registered for real', onNow === true, `registered ${onNow}; error "${r2.quickAskError}"`);
}
let barOpened = false;
if (onNow && process.env.QA_SEND_KEYS !== '1') console.log('INFO  EL12 to EL16 NOT RUN: they need the real keys Ctrl+Alt+Space sent through the operating system (set QA_SEND_KEYS=1 to allow it; the auto-mode classifier refused that, so it was not done)');
if (onNow && process.env.QA_SEND_KEYS === '1') {
  const countBefore = (await app.windows()).length;
  pressKeys();
  await win.waitForTimeout(2500);
  const wins = app.windows();
  const bar = wins.find((w) => /quick-ask\/bar\.html/.test(w.url()));
  barOpened = Boolean(bar);
  check('EL12', 'pressing the real Ctrl+Alt+Space opens the quick-ask bar window (a second window of the app, page quick-ask/bar.html)', barOpened && wins.length === countBefore + 1, `${wins.length} windows; ${wins.map((w) => w.url().slice(-30)).join(' | ')}`);
  if (bar) {
    const props = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /bar\.html/.test(x.webContents.getURL())); const b = w.getBounds(); return { visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), frameless: !w.isMenuBarVisible() && w.getBounds().height <= 320, w: b.width, h: b.height, focused: w.isFocused(), skipTaskbar: undefined }; });
    check('EL13', 'the bar is visible, always on top, 700 x 300 or the screen\'s 95%, and has focus', props.visible && props.alwaysOnTop && props.h === 300 && props.w <= 700 && props.focused, JSON.stringify(props));
    await bar.screenshot({ path: join(SHOTS, 'el-bar.png') });
    await bar.locator('#plus').click(); await bar.waitForTimeout(300);
    const menu = await bar.evaluate(() => { const m = document.getElementById('menu').getBoundingClientRect(); return { bottom: Math.round(m.bottom), inner: window.innerHeight, shown: !document.getElementById('menu').hidden }; });
    check('EL14', 'in the REAL bar window the + menu is open and fully inside the 300 px window (the clipping fix, in the real window)', menu.shown && menu.bottom <= menu.inner, JSON.stringify(menu));
    await bar.screenshot({ path: join(SHOTS, 'el-bar-menu.png') });
    await bar.locator('#plus').click();
    await bar.locator('#text').fill('hello from the real bar');
    await bar.locator('#text').press('Enter');
    await win.waitForTimeout(3500);
    const barGone = !app.windows().some((w) => /bar\.html/.test(w.url()));
    const chatText = await win.locator('.msg.user').last().textContent({ timeout: 8000 }).catch(() => '');
    check('EL15', 'Enter in the bar opens a NEW chat in Bunny\'s window with the typed text as the first message, and the bar closes', /hello from the real bar/.test(chatText ?? '') && barGone, `user message "${(chatText ?? '').trim().slice(0, 50)}"; bar gone ${barGone}`);
    await win.screenshot({ path: join(SHOTS, 'el-after-quick.png') });
    // Esc closes the bar when opened again
    pressKeys();
    await win.waitForTimeout(2000);
    const bar2 = app.windows().find((w) => /bar\.html/.test(w.url()));
    if (bar2) { await bar2.locator('#text').press('Escape'); await win.waitForTimeout(800); }
    check('EL16', 'the shortcut opens the bar again and Esc closes it', Boolean(bar2) && !app.windows().some((w) => /bar\.html/.test(w.url())), `second open ${Boolean(bar2)}`);
  }
}
// tray rule: turning the tray off turns quick ask off
await win.evaluate(() => window.bunnyDesktop.setPrefs({ closeToTray: false }));
await win.waitForTimeout(600);
const prefsAfterTray = await win.evaluate(() => window.bunnyDesktop.getPrefs());
check('EL17', 'turning close-to-tray off switches quick ask off and unregisters the shortcut', prefsAfterTray.quickAskEnabled === false && (await registered()) === false, JSON.stringify(prefsAfterTray));
{ // the rule that decides which shortcuts are allowed (pure function, nothing is registered): common edit keys with Ctrl are allowed
  const { validateAccelerator } = await import(new URL(`file:///${root.replace(/\\/g, '/')}/electron/quick-ask-logic.js`));
  const allowed = ['Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Ctrl+Z', 'Alt+F4', 'Ctrl+Alt+Space', 'Space', 'F5'].map((s) => `${s}:${validateAccelerator(s).ok ? 'allowed' : 'refused'}`);
  console.log(`INFO  shortcut rule: ${allowed.join(', ')}  (in a first run, Ctrl+A given to the window bridge was accepted and registered as a real global shortcut for about a second)`);
}
await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: false, closeToTray: false, quickAskShortcut: 'Ctrl+Alt+Space' }));

// ---- spell check and the right-click menu
await win.reload(); await win.waitForTimeout(1500);
const langs = await app.evaluate(({ session }) => ({ langs: session.defaultSession.getSpellCheckerLanguages(), available: session.defaultSession.availableSpellCheckerLanguages.slice(0, 3) }));
check('EL19', 'the spell checker language is en-US', JSON.stringify(langs.langs) === JSON.stringify(['en-US']), JSON.stringify(langs));
await app.evaluate(({ Menu }) => { globalThis.__menus = []; const orig = Menu.prototype.popup; Menu.prototype.popup = function () { globalThis.__menus.push(this.items.map((i) => i.label || i.role || i.type)); return orig.apply(this, arguments); }; });
await app.evaluate(({ session }) => { const s = session.defaultSession; globalThis.__spell = []; for (const ev of ['spellcheck-dictionary-initialized', 'spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure']) s.on(ev, (_e, lang) => globalThis.__spell.push(`${ev.replace('spellcheck-dictionary-', '')}:${lang}`)); s.setSpellCheckerLanguages([]); s.setSpellCheckerLanguages(['en-US']); });
await win.locator('#input').fill('I wrote teh word hapyness here');
await win.waitForTimeout(9000);
const spellEvents = await app.evaluate(() => globalThis.__spell);
console.log(`INFO  spell-checker dictionary events after setting en-US: ${JSON.stringify(spellEvents)}`);
const box = await win.locator('#input').boundingBox();
await win.mouse.click(box.x + 60, box.y + 12, { button: 'right' });
await win.waitForTimeout(1200);
const menu1 = await app.evaluate(() => globalThis.__menus.at(-1) ?? null);
await win.keyboard.press('Escape');
console.log(`INFO  right-click menu on the message box: ${JSON.stringify(menu1)}`);
check('EL20', 'right-click in the message box shows a menu with Undo, Redo, Cut, Copy, Paste and Select all', Array.isArray(menu1) && ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All'].every((r) => menu1.includes(r)), JSON.stringify(menu1));
await win.locator('#input').fill(''); await win.locator('#input').click();
await win.keyboard.type('teh ', { delay: 60 }); // typed inside the page (a value set from a script is not spell-checked)
await win.waitForTimeout(3500);
await win.mouse.click(box.x + 14, box.y + 12, { button: 'right' });
await win.waitForTimeout(1200);
const menu2 = await app.evaluate(() => globalThis.__menus.at(-1) ?? null);
await win.keyboard.press('Escape');
console.log(`INFO  right-click on the misspelled word "teh": ${JSON.stringify(menu2)}`);
check('EL21', 'right-click on a misspelled word shows suggestions and "Add to dictionary" before the edit items', Array.isArray(menu2) && menu2.includes('Add to dictionary') && menu2.indexOf('Add to dictionary') >= 1, JSON.stringify(menu2));
await win.locator('#input').fill('');
await win.screenshot({ path: join(SHOTS, 'el-spell.png') });

// ---- a second launch hands over to the first
const second = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env, timeout: 30000 }).then((a) => ({ app: a }), (e) => ({ error: e.message }));
await win.waitForTimeout(2000);
const stillOne = app.windows().filter((w) => /127\.0\.0\.1/.test(w.url()) && !/bar\.html/.test(w.url())).length;
check('EL22', 'starting the app a second time (same profile) does not open a second window: it hands over to the first (single instance)', stillOne === 1, `${stillOne} main window(s); ${second.error ? 'second launch ended: ' + second.error.slice(0, 80) : 'second launch connected'}`);
if (second.app) await second.app.close().catch(() => {});

check('EL23', 'no page error in the real window during all of this', errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await app.close().catch(() => {});
const after = realMtime();
check('EL24', 'the owner\'s %LOCALAPPDATA%\\BunnyAI folder was not touched (its last-modified time is unchanged; only that one number was read)', before === after, `${before} -> ${after}`);
check('EL25', 'the invented data folder got the profile (settings or sessions written there)', existsSync(DATA) && readdirSync(DATA).filter((f) => f !== 'shots').length > 0, readdirSync(DATA).join(','));
const bad2 = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad2.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad2.length ? 1 : 0);
