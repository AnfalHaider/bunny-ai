/**
 * The app server the way Electron starts it (folderPickerOnly: true), on an invented profile, plus a tiny control port that plays
 * the Electron main process (app.adminFetch carries the window-only secret). Test only.
 *   SRC=<worktree> DATA=<folder> PORT=<port> TOKEN=<hex> node e2e/w27-desktop-server.mjs
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'node:http';
const { createApp } = await import(pathToFileURL(join(process.env.SRC, 'src/server/app.js')).href);
if (process.env.BUNNY_FAKE_UPSTREAM !== '1') throw new Error('refusing: not an invented profile');
const app = await createApp({ dataDir: process.env.DATA, apiToken: process.env.TOKEN, folderPickerOnly: true });
await new Promise((r) => app.server.listen(+process.env.PORT, '127.0.0.1', r));
// the "main process": relays one request with the admin secret
const control = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const { path, method, body, choose } = JSON.parse(raw || '{}');
    if (choose) { const okc = await app.chooseFolder(choose); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: okc ? 200 : 400, body: JSON.stringify({ chosen: Boolean(okc) }) })); return; }
    const r = await app.adminFetch(path, { method, headers: { 'content-type': 'application/json', 'x-bunny-token': process.env.TOKEN }, body: body ? JSON.stringify(body) : undefined });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: r.status, body: await r.text() }));
  });
});
await new Promise((r) => control.listen(+process.env.PORT + 1000, '127.0.0.1', r));
console.log('ready');
const stop = () => { Promise.all([app.processes.stopAll(), app.localMcp.stopAll()]).catch(() => {}).finally(() => process.exit(0)); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
