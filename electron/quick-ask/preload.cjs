// The quick-ask bar's only bridge: a few plain calls (ask, stop, open in Bunny's window, grow to fit, the screenshot and file choices) and one listener for the plain answer; nothing else from Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickAsk', {
  submit: (text, attachments) => ipcRenderer.invoke('quickask:submit', text, attachments),
  captureScreenshot: () => ipcRenderer.invoke('quickask:capture'),
  pickFile: () => ipcRenderer.invoke('quickask:pickFile'),
  // QA-ANSWERS: ask (text only), stop, open the chat in Bunny's window, grow to fit, and hear the plain events of the answer
  ask: (text, attachments) => ipcRenderer.invoke('quickask:ask', text, attachments),
  stop: () => ipcRenderer.invoke('quickask:stop'),
  openInBunny: (target) => ipcRenderer.invoke('quickask:open', target), // target: nothing (open the chat) or 'settings' (open Bunny's settings, when no model is connected)
  resize: (height) => ipcRenderer.invoke('quickask:resize', height),
  onAnswer: (fn) => { const h = (_e, event) => fn(event); ipcRenderer.on('quickask:answer', h); return () => ipcRenderer.removeListener('quickask:answer', h); },
  dropFile: () => ipcRenderer.invoke('quickask:dropFile'),
  // QUICK-UI 3: Esc is decided by the page: main sends one plain message, the page answers with close or "handled"
  pcOpen: (ref) => ipcRenderer.invoke('pcsearch:open', ref),
  pcShow: (ref) => ipcRenderer.invoke('pcsearch:show', ref),
  pcCopy: (ref) => ipcRenderer.invoke('pcsearch:copy', ref),
  init: () => ipcRenderer.invoke('quickask:init'), // QUICK-UI 8 and 9: how Bunny looks and which model answers, as plain words
  close: () => ipcRenderer.invoke('quickask:close'),
  escHandled: () => ipcRenderer.invoke('quickask:escHandled'),
  onEscape: (fn) => { const h = () => fn(); ipcRenderer.on('quickask:esc', h); return () => ipcRenderer.removeListener('quickask:esc', h); },
});
