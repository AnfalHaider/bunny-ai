// The quick-ask bar's only bridge: a few plain calls (ask, stop, open in Bunny's window, grow to fit, the screenshot and file choices) and one listener for the plain answer; nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAsk', {
  submit: (text, attachments) => ipcRenderer.invoke('quickask:submit', text, attachments),
  captureScreenshot: () => ipcRenderer.invoke('quickask:capture'),
  pickFile: () => ipcRenderer.invoke('quickask:pickFile'),
  // QA-ANSWERS: ask (text only), stop, open the chat in Bunny's window, grow to fit, and hear the plain events of the answer
  ask: (text, attachments) => ipcRenderer.invoke('quickask:ask', text, attachments),
  stop: () => ipcRenderer.invoke('quickask:stop'),
  openInBunny: () => ipcRenderer.invoke('quickask:open'),
  resize: (height) => ipcRenderer.invoke('quickask:resize', height),
  onAnswer: (fn) => { const h = (_e, event) => fn(event); ipcRenderer.on('quickask:answer', h); return () => ipcRenderer.removeListener('quickask:answer', h); },
  dropFile: () => ipcRenderer.invoke('quickask:dropFile'),
});
