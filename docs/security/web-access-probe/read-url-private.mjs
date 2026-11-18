// WEB-ACCESS (Security): does read_url (the tool Quick ask now offers with no card) fetch this PC or the local network?
// Usage: node read-url-private.mjs <path to src/server/pluginImport.js>
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const { readUrl } = await import(pathToFileURL(process.argv[2]).href);
const server = createServer((req, res) => {
  if (req.url === '/hop') { res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/admin` }); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ROUTER-ADMIN-PAGE: wifi password hunter2');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
for (const url of [`http://127.0.0.1:${port}/admin`, `http://localhost:${port}/admin`, `http://[::1]:${port}/admin`, `http://127.0.0.1:${port}/hop`]) {
  try { console.log(`${url.replace(String(port), '<port>')} -> READ: ${(await readUrl(url)).slice(0, 60)}`); }
  catch (e) { console.log(`${url.replace(String(port), '<port>')} -> refused: ${e.message}`); }
}
server.close();
