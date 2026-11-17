// SETTINGS-BRIDGE probe (Security): a stand-alone Electron app, no Bunny code and no profile, with the same webPreferences and
// window-open rule as electron/main.js. It answers:
//  (c) which senderFrame main sees when a same-origin child iframe calls the PARENT's bridge;
//  (b) whether a sandboxed srcdoc frame (the artifact frame's flags) can reach the parent's bridge;
//  (P) whether a page served with `content-security-policy: sandbox ...` (like /api/artifacts/<id>/raw) and opened with
//      window.open from the main window still gets the preload bridge, and what senderFrame.url main sees for it.
// Run: "<electron.exe>" docs/security/settings-bridge-probe/main.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { join } = require('node:path');

const pages = {
  '/': `<!doctype html><body>main
    <iframe id="child" src="/child"></iframe>
    <iframe id="art" sandbox="allow-scripts allow-forms allow-modals" srcdoc="<script>let r;try{r=typeof parent.bridge+' '+String(parent.location.origin)}catch(e){r='blocked: '+e.name}try{window.bridge&&window.bridge.ping('srcdoc-own')}catch(e){}top.postMessage('art:'+r,'*')</script>"></iframe>
    <script>
      addEventListener('message', (e) => bridge.ping('report ' + e.data));
      setTimeout(() => window.open('/raw', '_blank', 'noopener'), 800);
    </script>`,
  '/child': `<!doctype html><script>parent.bridge.ping('child-via-parent')</script>`,
  '/raw': `<!doctype html><script>document.title = typeof window.bridge; if (window.bridge) window.bridge.ping('raw-own-bridge origin=' + location.origin)</script>`,
};
const server = createServer((req, res) => {
  const headers = { 'content-type': 'text/html' };
  if (req.url === '/raw') headers['content-security-policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups';
  res.writeHead(pages[req.url] ? 200 : 404, headers);
  res.end(pages[req.url] ?? '');
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const isOwn = (url) => url.startsWith(`${origin}/`);
  const webPreferences = () => ({ preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false });
  ipcMain.handle('probe:ping', (event, label) => {
    const url = event.senderFrame?.url ?? '';
    const top = event.senderFrame === event.sender.mainFrame;
    console.log(`PING ${String(label).padEnd(40)} senderFrame.url=${url.replace(origin, '<origin>')} mainFrame=${top} isOwn=${isOwn(url)}`);
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => (isOwn(url) ? { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: webPreferences() } } : { action: 'deny' }));
  });
  const win = new BrowserWindow({ show: false, webPreferences: webPreferences() });
  await win.loadURL(`${origin}/`);
  setTimeout(() => { for (const w of BrowserWindow.getAllWindows()) console.log(`WINDOW ${w.webContents.getURL().replace(origin, '<origin>')} title(typeof bridge)=${w.getTitle()}`); app.exit(0); }, 4000);
});
