// Bunny AI desktop shell.
// Runs the Bunny AI server inside this process on a free local port (127.0.0.1 only),
// then shows the UI in a native window. Data lives where the web version keeps it
// (%LOCALAPPDATA%\BunnyAI), so the desktop app and `npm start` share chats and keys.
import { app, BrowserWindow, WebContentsView, nativeTheme, Menu, Notification, Tray, dialog, ipcMain, shell, nativeImage, session, clipboard, globalShortcut, screen, desktopCapturer } from 'electron';
import { buildContextMenuTemplate } from './context-menu.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { controlFrame } from './browserAgent.js';
import { createBrowserViews, senderAllowed } from './browserViews.js';
import { fromOwnFrame } from './own-ipc.js';
import { createUpdater } from './updater.js';
import { clearOldWorkersOnce } from './clear-old-workers.js';
import { createQuickAsk } from './quick-ask.js';
import { DEFAULT_SHORTCUT, applyTrayRule, validateAccelerator } from './quick-ask-logic.js';
import { cleanTrayEvent, trayTooltip } from './tray-words.js';
import { childWindowOptions, isOwnPage, navigationAllowed, openDecision } from './own-pages.js';
import { createPcOpen } from './pc-open.js';
import { createMadeFile, findMadeFile } from './made-file.js';
import { copyFile } from 'node:fs/promises';
import { browserAddress, listenWithFallback, portToKeepNow, wantedPort } from './browser-access.js';

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
let prefs = { theme: 'system', launchAtLogin: false, closeToTray: false, quickAskEnabled: false, quickAskShortcut: DEFAULT_SHORTCUT, keepAddress: false, fixedPort: null };
try { prefs = { ...prefs, ...JSON.parse(readFileSync(prefsFile, 'utf8')) }; } catch { /* first run */ }
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  mkdirSync(dirname(prefsFile), { recursive: true });
  writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: Boolean(prefs.launchAtLogin) });
  return prefs;
}

// THEME-APPLY: the window's own colours (behind the page, the title bar, the browser pane's tabs) follow the chosen theme. nativeTheme makes every page in the
// window (the browser pane's sites too) see the same prefers-color-scheme, and the native frame take the same look; the last choice is kept so the next start
// opens in the right colours (no light flash before a dark page).
const WINDOW_COLORS = { light: '#faf9f6', dark: '#141518' };
const windowColor = () => (nativeTheme.shouldUseDarkColors ? WINDOW_COLORS.dark : WINDOW_COLORS.light);
nativeTheme.themeSource = ['light', 'dark'].includes(prefs.theme) ? prefs.theme : 'system';
function paintWindows() {
  const color = windowColor();
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.setBackgroundColor(color);
      for (const child of w.contentView?.children ?? []) child.setBackgroundColor?.(color); // the browser pane's tab views
    } catch { /* a window that is closing */ }
  }
}
nativeTheme.on('updated', paintWindows); // "System": the PC's own switch

let win = null;
let tray = null;
let origin = '';
let quitting = false;
let bunnyApp = null;
let addressNote = '';

async function startServer() {
  const bunny = await createApp({ dataDir, electronData: app.getPath('userData'), folderPickerOnly: true });
  bunnyApp = bunny;
  // BROWSER: a free port, or the same one as last time when "Keep the same address after restart" is on (with a plain note when it is taken). Always 127.0.0.1.
  const listening = await listenWithFallback(bunny.server, '127.0.0.1', wantedPort(prefs));
  addressNote = listening.note;
  if (prefs.keepAddress && listening.fixed && prefs.fixedPort !== listening.port) savePrefs({ fixedPort: listening.port });
  origin = `http://127.0.0.1:${listening.port}`;
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
const browserViews = createBrowserViews({ WebContentsView, session, BrowserWindow, nativeImage, getWindow: windowOf, getOwnPort: () => { try { return new URL(origin).port; } catch { return ''; } } });

function guard(contents) {
  if (browserViews.ownsSession(contents.session)) return;
  contextMenu(contents);
  try { contents.session.setSpellCheckerLanguages(['en-US']); } catch { /* dictionary unavailable: spell check stays off */ }
  // Bunny's own pages may open in new Bunny windows (pop-out chat); everything
  // else opens in the person's normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    const kind = openDecision(url, origin);
    // 'bunny': a Bunny page (pop-out chat), with the preload. 'plain': a page from Bunny's server that is not one of its own pages (an artifact): a window with NO preload.
    if (kind === 'bunny' || kind === 'plain') return { action: 'allow', overrideBrowserWindowOptions: { ...childWindowOptions(kind, { icon: ICON, bunnyPreferences: webPreferences }), backgroundColor: windowColor() } };
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
    backgroundColor: windowColor(),
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

// REMOTE-STAY (RS-5): the tray says so while Bunny is open to other devices, even when it started hidden (tray or start at login).
let trayEvent = null; // the newest thing the window's chip is saying (fixed fields, see tray-words.js); the window sets and clears it
const syncTrayTooltip = () => { try { tray?.setToolTip(trayTooltip(bunnyApp?.remote?.enabled, trayEvent)); } catch { /* the tray is going away */ } };
async function resumeOpenToDevices() {
  try {
    const result = await bunnyApp.resumeRemote(); // only on the network it was turned on with (RS-4); every device signs in again
    if (Notification.isSupported()) {
      if (result.resumed) new Notification({ title: 'Bunny AI', body: 'Open to other devices on this network. Turn it off in Settings.' }).show();
      else if (result.reason) new Notification({ title: 'Bunny AI', body: result.reason }).show();
    }
  } catch { /* it stays closed; Settings says it is off */ }
  syncTrayTooltip();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('Bunny AI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Bunny AI', click: showWindow },
    { label: 'Open in your browser', click: openInBrowser },
    { type: 'separator' },
    { label: 'Quit Bunny AI', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// BROWSER: open Bunny in the person's own browser at this server's exact address (127.0.0.1, no token, no path). Only a Bunny page may ask, and nothing is taken from it.
function openInBrowser() {
  const url = browserAddress(origin);
  if (!url) return false;
  shell.openExternal(url);
  return true;
}
ipcMain.handle('theme:set', (event, theme) => {
  if (!isOwn(event.senderFrame?.url ?? '') || !['light', 'dark', 'system'].includes(theme)) return { ok: false };
  nativeTheme.themeSource = theme;
  paintWindows();
  if (prefs.theme !== theme) savePrefs({ theme });
  return { ok: true, dark: nativeTheme.shouldUseDarkColors };
});
// SEARCH-PC SP-4: Open, Show in folder and Copy path for a result, from Bunny's window and the Quick ask bar only; each names a result by ref and the server judges the path again
const pcOpen = createPcOpen({
  shell, clipboard,
  resolve: async (ref) => (await bunnyApp.adminFetch('/api/pcsearch/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref }) })).json(),
  allowedSender: (event) => isOwn(event.senderFrame?.url ?? '') || Boolean(quickAsk?.fromBar?.(event)),
});
ipcMain.handle('pcsearch:open', (event, ref) => pcOpen.open(event, ref));
ipcMain.handle('pcsearch:show', (event, ref) => pcOpen.show(event, ref));
ipcMain.handle('pcsearch:copy', (event, ref) => pcOpen.copy(event, ref));
// OFFICE-MAKE: Open, Save as… and Show in folder for a file made in a chat with no folder: Bunny's window only, two ids, the server finds the file under that chat's own folder
const madeFile = createMadeFile({
  shell, dialog, copyFile, windowOf,
  resolve: (chat, file) => findMadeFile(dataDir, chat, file), // the main process resolves the ids itself, under <data>/made/<chat>/
  allowedSender: (event) => isOwn(event.senderFrame?.url ?? ''),
});
ipcMain.handle('made:open', (event, chat, file) => madeFile.open(event, chat, file));
ipcMain.handle('made:show', (event, chat, file) => madeFile.show(event, chat, file));
ipcMain.handle('made:save', (event, chat, file) => madeFile.save(event, chat, file));
ipcMain.handle('remote:tray-event', (event, raw) => { // window-only, fixed fields only
  if (!isOwn(event.senderFrame?.url ?? '')) return { ok: false };
  trayEvent = cleanTrayEvent(raw);
  syncTrayTooltip();
  return { ok: true };
});
ipcMain.handle('app:open-browser', (event) => (isOwn(event.senderFrame?.url ?? '') ? { ok: openInBrowser() } : { ok: false }));
ipcMain.handle('prefs:get', () => ({ ...prefs, address: browserAddress(origin), addressNote }));
ipcMain.handle('prefs:set', (event, patch) => {
  // PREFS-OWN: only Bunny's own page may change the desktop preferences (as theme:set and app:open-browser already require): a page the window happens to show (a site in the panel, a pop-up) cannot
  if (!fromOwnFrame(event, isOwn)) return { ok: false, error: 'Not allowed' };
  const clean = {};
  if (typeof patch?.launchAtLogin === 'boolean') clean.launchAtLogin = patch.launchAtLogin;
  if (typeof patch?.closeToTray === 'boolean') clean.closeToTray = patch.closeToTray;
  if (typeof patch?.quickAskEnabled === 'boolean') clean.quickAskEnabled = patch.quickAskEnabled;
  if (typeof patch?.quickAskShortcut === 'string') clean.quickAskShortcut = patch.quickAskShortcut;
  if (typeof patch?.keepAddress === 'boolean') clean.keepAddress = patch.keepAddress; // takes effect the next time Bunny starts
  // Quick ask (W4-8) keeps Bunny running in the tray; the two preferences move together.
  const ruled = applyTrayRule(prefs, clean);
  // "Keep the same address": the port in use now is kept at once, so the next start is on this address, not only the one after it
  const keep = portToKeepNow(ruled.prefs, Number(new URL(origin || 'http://127.0.0.1').port));
  const saved = savePrefs(keep ? { ...ruled.prefs, fixedPort: keep } : ruled.prefs);
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
    if (action === 'compare') return await browserViews.compare(event.sender, args ?? {}); // W6-11: not tied to a tab
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
  Promise.all([bunnyApp.processes.stopAll(), bunnyApp.localMcp.stopAll()]).catch(() => {}).finally(async () => {
    // A downloaded update installs as the app closes (and reopens it after Restart to update). S-7: it is checked against its published fingerprint once more first.
    if (updater?.hasUpdate()) await updater.install({ relaunch: installOnQuit === 'relaunch' }).catch(() => {});
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
  void clearOldWorkersOnce({ session: session.defaultSession, flagFile: join(app.getPath('userData'), 'old-workers-cleared-0.1.12') }); // once, in the background (never held up the window): the 0.1.9/0.1.10 worker
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
  setInterval(syncTrayTooltip, 5000).unref();
  quickAsk = createQuickAsk({
    BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, dialog, onSubmit: startQuickChat,
    // QA-ANSWERS: the bar answers through Bunny's own server (text only); Open in Bunny and a finished answer tell the window which chat
    adminFetch: (path, init) => bunnyApp.adminFetch(path, init),
    getSettings: () => bunnyApp?.getSettings() ?? {},
    onOpenChat: (sessionId) => startQuickChat({ openChat: sessionId }),
    onOpenSettings: (section) => startQuickChat({ openSettings: true, ...(section === 'capabilities' ? { section } : {}) }),
    onAnswerFinished: (sessionId) => startQuickChat({ openChat: sessionId, refresh: true, quiet: true }),
  });
  createWindow();
  // START-WAIT: the first window does not wait for the network lookup (it can take 5 s). Resuming runs alongside; RS-5 still holds because the banner and the tray text follow what
  // is actually open (the page asks the server, the tray tooltip is synced when the resume ends and every 5 s), so neither says "open" before it is, and both say it as soon as it is.
  void resumeOpenToDevices();
  applyQuickAsk();
  // Only the installed app updates itself (or a test pointing at its own feed).
  if (app.isPackaged || process.env.BUNNY_UPDATE_FEED) {
    updater = createUpdater({
      currentVersion: app.getVersion(),
      enabled: () => bunnyApp?.getSettings().autoUpdate !== false,
      onStatus: sendUpdate,
      downloadDir: join(dataDir, 'updates'), // S-7: a folder under Bunny's own data folder, not the shared temp folder
    });
    updater.start({ firstCheckMs: Number(process.env.BUNNY_UPDATE_FIRST_CHECK_MS) || 15_000 });
  }
});
