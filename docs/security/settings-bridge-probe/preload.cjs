// Same shape as electron/preload.cjs: one function exposed to the main world through contextBridge.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bridge', { ping: (label) => ipcRenderer.invoke('probe:ping', label) });
