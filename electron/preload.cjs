// The only bridge between the Bunny AI pages and the desktop shell.
// Pages see window.bunnyDesktop; nothing else from Node or Electron is exposed.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('bunnyDesktop', {
  platform: process.platform,
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  quit: () => ipcRenderer.invoke('app:quit'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // Security-relevant writes (permission rules and mode) are made by the main process, not by the page.
  secureWrite: (method, path, body) => ipcRenderer.invoke('secure:write', method, path, body),
  browserAct: (frameName, action, args) => ipcRenderer.invoke('browser:act', frameName, action, args),
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
