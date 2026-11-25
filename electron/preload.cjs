// The only bridge between the Bunny AI pages and the desktop shell.
// Pages see window.bunnyDesktop; nothing else from Node or Electron is exposed.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// SB-1: the bridge exists only in Bunny's own pages. A page served from Bunny's address that is not one (a model-written artifact) gets nothing, even if this file was loaded into it.
// Kept equal to OWN_PAGE_PATHS in own-pages.js (a test checks).
const OWN_PAGE_PATHS = ['/src/ui/index.html', '/src/ui/settings.html', '/src/ui/providers.html', '/src/ui/automation.html', '/src/ui/customize.html'];
const isOwnPagePath = (() => { try { return OWN_PAGE_PATHS.includes(new URL(location.href).pathname); } catch { return false; } })();
if (isOwnPagePath) {

contextBridge.exposeInMainWorld('bunnyDesktop', {
  platform: process.platform,
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  quit: () => ipcRenderer.invoke('app:quit'),
  // BROWSER: open Bunny in the person's own browser (main opens its own address; nothing is taken from the page)
  openInBrowser: () => ipcRenderer.invoke('app:open-browser'),
  // BANNER-NOTICE: the chip's newest event, for the tray tooltip (fixed fields: a kind and a device name; main makes the words)
  setRemoteEvent: (event) => ipcRenderer.invoke('remote:tray-event', event && typeof event === 'object' ? { kind: event.kind, label: event.label } : null),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // Security-relevant writes (permission rules and mode) are made by the main process, not by the page.
  secureWrite: (method, path, body) => ipcRenderer.invoke('secure:write', method, path, body),
  browserAct: (frameName, action, args) => ipcRenderer.invoke('browser:act', frameName, action, args),
  // The browser panel's tabs as views laid over the panel (W6-24): commands go to the main process, events come back.
  browserView: {
    send: (msg) => ipcRenderer.invoke('browser:view', msg),
    onEvent: (fn) => { const h = (_e, event) => fn(event); ipcRenderer.on('browser:view-event', h); return () => ipcRenderer.removeListener('browser:view-event', h); },
  },
  // SEARCH-PC: Open, Show in folder and Copy path for a search result, by its ref (the main process looks the path up and judges it)
  pcSearch: {
    open: (ref) => ipcRenderer.invoke('pcsearch:open', ref),
    show: (ref) => ipcRenderer.invoke('pcsearch:show', ref),
    copy: (ref) => ipcRenderer.invoke('pcsearch:copy', ref),
  },
  // OFFICE-MAKE: Open, Save as… and Show in folder for a file made in a chat with no folder, by the chat's id and the file's id (the main process asks the server; no path comes from the page)
  made: {
    open: (chat, file) => ipcRenderer.invoke('made:open', chat, file),
    show: (chat, file) => ipcRenderer.invoke('made:show', chat, file),
    save: (chat, file) => ipcRenderer.invoke('made:save', chat, file),
  },
  // THEME-APPLY: the page tells the shell the theme it applied (light, dark or system): window colours, title bar and browser pane follow at once.
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  // Zoom for the whole window (Ctrl++ / Ctrl+- / Ctrl+0 and the account menu).
  zoom: {
    get: () => webFrame.getZoomFactor(),
    set: (factor) => webFrame.setZoomFactor(Math.min(3, Math.max(0.5, Number(factor) || 1))),
  },
  // Quick ask (W4-8): the bar asks Bunny's window to start a new chat; the window then takes the message.
  quickAsk: {
    take: () => ipcRenderer.invoke('quickask:take'),
    onNewChat: (fn) => { const h = () => fn(); ipcRenderer.on('quickask:new-chat', h); return () => ipcRenderer.removeListener('quickask:new-chat', h); },
  },
  // Updates from GitHub Releases: the status, a check now, and Restart to update.
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('update:status', h); return () => ipcRenderer.removeListener('update:status', h); },
  },
});
}
