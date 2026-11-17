// Bunny AI desktop shell.
// Runs the Bunny AI server inside this process on a free local port (127.0.0.1 only),
// then shows the UI in a native window. Data lives where the web version keeps it
// (%LOCALAPPDATA%\BunnyAI), so the desktop app and `npm start` share chats and keys.
import { app, BrowserWindow, WebContentsView, Menu, Tray, dialog, ipcMain, shell, nativeImage, session, clipboard, globalShortcut, screen, desktopCapturer } from 'electron';
import { buildContextMenuTemplate } from './context-menu.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { controlFrame } from './browserAgent.js';
import { createBrowserViews, senderAllowed } from './browserViews.js';
import { createUpdater } from './updater.js';
import { createQuickAsk } from './quick-ask.js';
import { DEFAULT_SHORTCUT, applyTrayRule, validateAccelerator } from './quick-ask-logic.js';
import { childWindowOptions, isOwnPage, navigationAllowed, openDecision } from './own-pages.js';

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
let prefs = { launchAtLogin: false, closeToTray: false, quickAskEnabled: false, quickAskShortcut: DEFAULT_SHORTCUT };
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

// SB-1: Bunny's own page means one of the allow-listed page paths (own-pages.js), NOT everything on Bunny's address: a model-written artifact at /api/artifacts/<id>/raw
// is served from the same address and must neither get the desktop bridge nor be believed by any IPC check below.
const isOwn = (url) => isOwnPage(String(url ?? ''), origin);
const webPreferences = () => ({
  preload: join(here, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true,
});

function contextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      copyLink: (url) => clipboard.writeText(url),
    });
    if (template.length) Menu.buildFromTemplate(template).popup();
  });
}

// W6-24: the panel's tabs are views with a session of their own; they have their own rules (browserViews.js), not this guard's.
// A view may only be put in a Bunny window, by the page of that window; and never shows Bunny's own server (its port).
const windowOf = (sender) => { const w = BrowserWindow.fromWebContents(sender); return w && w.webContents === sender ? w : null; };
const browserViews = createBrowserViews({ WebContentsView, session, getWindow: windowOf, getOwnPort: () => { try { return new URL(origin).port; } catch { return ''; } } });

function guard(contents) {
  if (browserViews.ownsSession(contents.session)) return;
  contextMenu(contents);
  try { contents.session.setSpellCheckerLanguages(['en-US']); } catch { /* dictionary unavailable: spell check stays off */ }
  // Bunny's own pages may open in new Bunny windows (pop-out chat); everything
  // else opens in the person's normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    const kind = openDecision(url, origin);
    // 'bunny': a Bunny page (pop-out chat), with the preload. 'plain': a page from Bunny's server that is not one of its own pages (an artifact): a window with NO preload.
    if (kind === 'bunny' || kind === 'plain') return { action: 'allow', overrideBrowserWindowOptions: childWindowOptions(kind, { icon: ICON, bunnyPreferences: webPreferences }) };
    if (kind === 'web') shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    // SB1-a: loading anything on Bunny's own server is fine (an artifact window's first load is a navigation); the IPC checks still use isOwn (the allow-list)
    if (!navigationAllowed(url, origin)) {
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
  if (typeof patch?.quickAskEnabled === 'boolean') clean.quickAskEnabled = patch.quickAskEnabled;
  if (typeof patch?.quickAskShortcut === 'string') clean.quickAskShortcut = patch.quickAskShortcut;
  // Quick ask (W4-8) keeps Bunny running in the tray; the two preferences move together.
  const ruled = applyTrayRule(prefs, clean);
  const saved = savePrefs(ruled.prefs);
  const quick = applyQuickAsk(patch);
  return { ...saved, quickAskNote: ruled.note, quickAskError: quick.error ?? null };
});

// ---- Quick ask (W4-8): see quick-ask.js ----
let quickAsk = null;
let pendingQuick = null;
// Make the global shortcut match the saved preferences. A shortcut that cannot be used is refused with a plain message.
function applyQuickAsk(patch = {}) {
  if (!quickAsk) return {};
  if (!prefs.quickAskEnabled) { quickAsk.disable(); return {}; }
  const checked = validateAccelerator(prefs.quickAskShortcut);
  const result = quickAsk.enable(checked.ok ? checked.accelerator : '');
  if (result.ok) {
    if (prefs.quickAskShortcut !== result.accelerator) savePrefs({ quickAskShortcut: result.accelerator });
    return {};
  }
  // Refused (invalid or taken): keep the last good shortcut if there is one; otherwise Quick ask stays off.
  if (!quickAsk.isEnabled()) savePrefs({ quickAskEnabled: false });
  else if (typeof patch?.quickAskShortcut === 'string') savePrefs({ quickAskShortcut: quickAsk.accelerator() });
  return { error: result.message };
}
// The bar sends a new chat: Bunny's window comes forward and starts it (Chat mode, no folder). Only plain data crosses.
ipcMain.handle('quickask:take', (event) => {
  if (!isOwn(event.senderFrame?.url ?? '')) return null;
  const request = pendingQuick;
  pendingQuick = null;
  return request;
});
function startQuickChat(request) {
  pendingQuick = request;
  const existing = win && !win.isDestroyed() && !win.webContents.isLoading();
  if (!request?.quiet) showWindow(); // an answer that finished after Open in Bunny only refreshes the chat; it does not pull the window forward again
  if (existing) win.webContents.send('quickask:new-chat'); // a window that is still loading takes the request when its page starts
  return true;
}
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
  if (!senderAllowed(event, isOwn, windowOf)) return { error: 'Not allowed' };
  try {
    // a tab that is a view (W6-24) is worked in its own page; otherwise it is a frame in the panel
    const worked = await browserViews.control(event.sender, name, action, args ?? {});
    if (worked) return worked;
    return await controlFrame(event.sender, name, action, args ?? {});
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
});

// The panel's tabs as views (W6-24): only Bunny's own page, and only the views that page opened.
ipcMain.handle('browser:view', (event, msg) => {
  if (!senderAllowed(event, isOwn, windowOf)) return { ok: false, error: 'Not allowed' };
  try { return browserViews.handle(event.sender, msg); } catch (err) { return { ok: false, error: String(err?.message ?? err) }; }
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
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => {
  if (!prefs.closeToTray) app.quit();
});
app.on('web-contents-created', (_event, contents) => guard(contents));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // W6-24: the browser panel's tabs are views with a session of their own (browserViews.js), so Bunny's own session no longer drops any frame header:
  // Bunny's own pages keep X-Frame-Options and CSP frame-ancestors like any other page.
  try {
    await startServer();
  } catch (err) {
    dialog.showErrorBox('Bunny AI could not start', String(err?.message ?? err));
    app.quit();
    return;
  }
  createTray();
  quickAsk = createQuickAsk({
    BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, dialog, onSubmit: startQuickChat,
    // QA-ANSWERS: the bar answers through Bunny's own server (text only); Open in Bunny and a finished answer tell the window which chat
    adminFetch: (path, init) => bunnyApp.adminFetch(path, init),
    onOpenChat: (sessionId) => startQuickChat({ openChat: sessionId }),
    onAnswerFinished: (sessionId) => startQuickChat({ openChat: sessionId, refresh: true, quiet: true }),
  });
  createWindow();
  applyQuickAsk();
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
