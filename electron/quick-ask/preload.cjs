// The quick-ask bar's only bridge: two functions, nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAsk', {
  submit: (text, attachments) => ipcRenderer.invoke('quickask:submit', text, attachments),
  captureScreenshot: () => ipcRenderer.invoke('quickask:capture'),
  pickFile: () => ipcRenderer.invoke('quickask:pickFile'),
});
