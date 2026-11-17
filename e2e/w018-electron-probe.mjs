// QA probe: what happens to quick ask when the default shortcut is taken and the person picks another one. Invented profile, real Electron.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-probe-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-probe-user-'));
const app = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }, timeout: 60000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2000);
const reg = (a) => app.evaluate(({ globalShortcut }, x) => globalShortcut.isRegistered(x), a);
const set = async (p) => { try { return await win.evaluate((x) => window.bunnyDesktop.setPrefs(x), p); } catch (e) { return `evaluate failed: ${e.message.slice(0, 80)}`; } };
console.log('1 tray on        ', JSON.stringify(await set({ closeToTray: true })));
console.log('2 quick ask on   ', JSON.stringify(await set({ quickAskEnabled: true })), 'registered default:', await reg('Ctrl+Alt+Space'));
console.log('3 change shortcut', JSON.stringify(await set({ quickAskShortcut: 'Ctrl+Alt+Shift+Q' })), 'registered new:', await reg('Ctrl+Alt+Shift+Q'));
console.log('4 enable+shortcut', JSON.stringify(await set({ quickAskEnabled: true, quickAskShortcut: 'Ctrl+Alt+Shift+Q' })), 'registered new:', await reg('Ctrl+Alt+Shift+Q'));
console.log('window url now:', win.url());
console.log('prefs:', JSON.stringify(await win.evaluate(() => window.bunnyDesktop.getPrefs()).catch((e) => `failed ${e.message.slice(0, 60)}`)));
await set({ quickAskEnabled: false, closeToTray: false });
await app.close().catch(() => {});
