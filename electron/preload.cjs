// The only bridge between the Bunny AI pages and the desktop shell.
// Pages see window.bunnyDesktop; nothing else from Node or Electron is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bunnyDesktop', {
  platform: process.platform,
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  quit: () => ipcRenderer.invoke('app:quit'),
});
