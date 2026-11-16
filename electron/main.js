// Bunny AI desktop shell.
// Runs the Bunny AI server inside this process on a free local port (127.0.0.1 only),
// then shows the UI in a native window. Data lives where the web version keeps it
// (%LOCALAPPDATA%\BunnyAI), so the desktop app and `npm start` share chats and keys.
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, nativeImage, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { controlFrame } from './browserAgent.js';
import { createUpdater } from './updater.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const ICON = join(root, 'build', 'icons', 'icon-256.png');
const TRAY_ICON = join(root, 'build', 'icons', 'icon-32.png');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('ai.bunny.desktop');

const dataDir = process.env.BUNNY_DATA_DIR
  ?? join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'BunnyAI');

// ---- desktop preferences (only the shell reads these) ----
const prefsFile = join(app.getPath('userData'), 'desktop-prefs.json');
let prefs = { launchAtLogin: false, closeToTray: false };
try { prefs = { ...prefs, ...JSON.parse(readFileSync(prefsFile, 'utf8')) }; } catch { /* first run */ }
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  mkdirSync(dirname(prefsFile), { recursive: true });
  writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: Boolean(prefs.launchAtLogin) });
  return prefs;
}

let win = null;
let tray = null;
let origin = '';
let quitting = false;
let bunnyApp = null;

async function startServer() {
  const bunny = await createApp({ dataDir, folderPickerOnly: true });
  bunnyApp = bunny;
  await new Promise((resolve, reject) => {
    bunny.server.once('error', reject);
    bunny.server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${bunny.server.address().port}`;
  // Scheduled tasks run while the app (or its tray icon) is alive.
  setInterval(() => { bunny.runDueSchedules().catch(() => {}); }, 60_000).unref();
  return bunny;
}

const isOwn = (url) => url.startsWith(`${origin}/`);
const webPreferences = () => ({
  preload: join(here, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true,
});

function guard(contents) {
  // Bunny's own pages may open in new Bunny windows (pop-out chat); everything
  // else opens in the person's normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: '#faf9f6', webPreferences: webPreferences() } };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isOwn(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: 'Bunny AI',
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#faf9f6',
    webPreferences: webPreferences(),
  });
  guard(win.webContents);
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (prefs.closeToTray && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(`${origin}/src/ui/index.html`);
}

function showWindow() {
  if (!win) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('Bunny AI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bunny AI', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Bunny AI', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

ipcMain.handle('prefs:get', () => prefs);
ipcMain.handle('prefs:set', (_event, patch) => {
  const clean = {};
  if (typeof patch?.launchAtLogin === 'boolean') clean.launchAtLogin = patch.launchAtLogin;
  if (typeof patch?.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
  return savePrefs(clean);
});
ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
// The native "choose a folder" dialog, for the folder a chat works in.
// W27-3 / W5-7: a security-relevant write (permission rules and mode...) goes through here, so only Bunny's own window can make it: main adds
// the window-only secret that no page and no other program has. Anything else is refused.
ipcMain.handle('secure:write', async (event, method, path, body) => {
  const from = event.senderFrame?.url ?? event.sender.getURL();
  if (!isOwn(from)) throw new Error('Not a Bunny page.');
  if (!isWindowOnlyRoute(method, path, body)) throw new Error('That is not a window-only change.');
  const res = await bunnyApp.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
});

ipcMain.handle('dialog:pickFolder', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? win;
  const result = await dialog.showOpenDialog(owner, { title: 'Choose a folder to work in', properties: ['openDirectory'] });
  const picked = result.canceled ? null : result.filePaths[0] ?? null;
  // Only a folder the person picked here may be browsed by the Files pane before a chat exists.
  if (picked && !(await bunnyApp?.chooseFolder(picked).catch(() => false))) return null; // refused (a drive root, Bunny's own data): not chosen
  return picked;
});

// The model working a page in the browser panel (see browserAgent.js). Only Bunny's
// own pages may ask, and only for frames inside the page that asked.
ipcMain.handle('browser:act', async (event, name, action, args) => {
  if (!isOwn(event.senderFrame?.url ?? '')) return { error: 'Not allowed' };
  try {
    return await controlFrame(event.sender, name, action, args ?? {});
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
});

// ---- updates from GitHub Releases ----
let updater = null;
const sendUpdate = (status) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status); };
ipcMain.handle('update:get', () => updater?.status() ?? { state: 'unavailable', current: app.getVersion() });
ipcMain.handle('update:check', () => updater?.check({ manual: true }) ?? { state: 'unavailable', current: app.getVersion(), message: 'Updates work in the installed app.' });
ipcMain.handle('update:install', () => {
  // Restart to update: the installer runs once Bunny AI has closed, then opens the new version.
  if (!updater?.hasUpdate()) return false;
  installOnQuit = 'relaunch';
  quitting = true;
  app.quit();
  return true;
});
let installOnQuit = 'quietly';

app.on('second-instance', showWindow);
// Programs the AI started (dev servers and the like) stop before the app does.
let programsStopped = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (programsStopped || !bunnyApp) return;
  event.preventDefault();
  programsStopped = true;
  Promise.all([bunnyApp.processes.stopAll(), bunnyApp.localMcp.stopAll()]).catch(() => {}).finally(() => {
    // A downloaded update installs as the app closes (and reopens it after Restart to update).
    if (updater?.hasUpdate()) updater.install({ relaunch: installOnQuit === 'relaunch' });
    app.quit();
  });
});
app.on('window-all-closed', () => {
  if (!prefs.closeToTray) app.quit();
});
app.on('web-contents-created', (_event, contents) => guard(contents));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // The browser panel shows sites in frames. Many sites forbid being framed; for
  // frames only, drop that one rule (X-Frame-Options and CSP frame-ancestors) so
  // the panel works like a browser tab. Top-level pages keep every header.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame') return callback({});
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options') delete headers[key];
      if (lower === 'content-security-policy') {
        headers[key] = headers[key].map((v) => v.split(';').filter((d) => !/^\s*frame-ancestors\b/i.test(d)).join(';'));
      }
    }
    callback({ responseHeaders: headers });
  });
  try {
    await startServer();
  } catch (err) {
    dialog.showErrorBox('Bunny AI could not start', String(err?.message ?? err));
    app.quit();
    return;
  }
  createTray();
  createWindow();
  // Only the installed app updates itself (or a test pointing at its own feed).
  if (app.isPackaged || process.env.BUNNY_UPDATE_FEED) {
    updater = createUpdater({
      currentVersion: app.getVersion(),
      enabled: () => bunnyApp?.getSettings().autoUpdate !== false,
      onStatus: sendUpdate,
    });
    updater.start({ firstCheckMs: Number(process.env.BUNNY_UPDATE_FIRST_CHECK_MS) || 15_000 });
  }
});
