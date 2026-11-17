// W6-13 probe (Security): download_file's address rules, redirects, size cap, write location, and the permission rules.
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const dl = await import(`file:///${CO}/src/server/download.js`);
const { createWorkspace } = await import(`file:///${CO}/src/server/workspace.js`);
const pr = await import(`file:///${CO}/src/server/permissionRules.js`);
console.log('--- isPrivateAddress (expect true = refused)');
const lit = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.100.100.200', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12::1', 'ff02::1', '[::1]', '0:0:0:0:0:0:0:1', '0000::1', '::ffff:10.0.0.1', '::ffff:a00:1', 'garbage', '1.2.3', '', '::ffff:0:127.0.0.1'];
for (const a of lit) { const r = dl.isPrivateAddress(a); if (!r) console.log('**PUBLIC** ' + JSON.stringify(a)); }
console.log('--- must be public (expect false)');
for (const a of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1', '192.0.2.1', '198.17.0.1', '198.20.0.1']) { if (dl.isPrivateAddress(a)) console.log('over-refused: ' + a); }
console.log('--- fetchLimited with stubbed DNS');
const t = async (label, url, lookupImpl, opts = {}) => { try { const r = await dl.fetchLimited(url, { lookupImpl, ...opts }); console.log('FETCHED  ' + label.padEnd(54) + r.bytes.length + ' bytes'); } catch (e) { console.log('refused  ' + label.padEnd(54) + e.message.slice(0, 90)); } };
await t('name resolving to 127.0.0.1', 'http://evil.example/x', async () => [{ address: '127.0.0.1', family: 4 }]);
await t('name resolving to 10.0.0.5 and a public one', 'http://evil.example/x', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }]);
await t('name resolving to ::ffff:192.168.1.1', 'http://evil.example/x', async () => [{ address: '::ffff:192.168.1.1', family: 6 }]);
await t('name resolving to 169.254.169.254', 'http://evil.example/x', async () => [{ address: '169.254.169.254', family: 4 }]);
for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://localhost/', 'http://localhost./', 'http://0/', 'http://[::ffff:7f00:1]/', 'file:///C:/Windows/win.ini', 'ftp://x/y', 'gopher://x/', 'data:text/plain,x', 'javascript:1', 'http://user:pw@127.0.0.1/', '']) await t('literal ' + JSON.stringify(u), u, async () => [{ address: '127.0.0.1', family: 4 }]);
// a local server that redirects to private addresses and serves big bodies; allowLoopback lets the test reach it
const big = Buffer.alloc(60 * 1024 * 1024, 65);
const srv = http.createServer((req, res) => {
  if (req.url === '/r1') { res.writeHead(302, { location: 'http://169.254.169.254/latest/' }); res.end(); }
  else if (req.url === '/r2') { res.writeHead(302, { location: 'file:///C:/Windows/win.ini' }); res.end(); }
  else if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); }
  else if (req.url === '/big') { res.writeHead(200, { 'content-length': String(big.length) }); res.end(big); }
  else if (req.url === '/bigchunked') { res.writeHead(200); res.write(big); res.end(); }
  else if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'a=b' }); res.end('hello'); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
await t('loopback server without allowLoopback', base + '/ok', undefined);
await t('loopback server, allowLoopback (test switch), ok', base + '/ok', undefined, { allowLoopback: true });
// redirect hops: private target is refused even though the first hop was allowed (allowLoopback only for the test server)
await t('redirect to 169.254.169.254 (allowLoopback is on, still a literal private)', base + '/r1', undefined, { allowLoopback: true });
await t('redirect to file://', base + '/r2', undefined, { allowLoopback: true });
await t('redirect loop', base + '/loop', undefined, { allowLoopback: true });
await t('declared 60 MB', base + '/big', undefined, { allowLoopback: true });
await t('chunked 60 MB', base + '/bigchunked', undefined, { allowLoopback: true });
srv.close();
console.log('--- the workspace tool and the permission rules');
const root = mkdtempSync(join(tmpdir(), 'bunny-dl-'));
mkdirSync(join(root, 'secrets'), { recursive: true });
const srv2 = http.createServer((q, s) => { s.writeHead(200); s.end('PLANTED'); });
await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
const u2 = `http://127.0.0.1:${srv2.address().port}/x`;
const ws = createWorkspace(root, { allowLoopback: true });
const BSL = String.fromCharCode(92); for (const p0 of ['out.txt', 'sub/dir/out.txt', '../escape.txt', '..@escape.txt', 'C:/Windows/Temp/dl-escape.txt', '/dl-escape.txt', '.git/hooks/pre-commit', 'AGENTS.md', 'con', 'out.txt::$DATA', 'secrets/..@..@x.txt']) { const p = p0.split('@').join(BSL);
  try { const r = await ws.run('download_file', { url: u2, path: p }); console.log('WROTE    ' + JSON.stringify(p).padEnd(34) + r.split('\n')[0].slice(0, 70)); } catch (e) { console.log('refused  ' + JSON.stringify(p).padEnd(34) + e.message.slice(0, 70)); }
}
const rules = [{ id: 'a', kind: 'path', effect: 'deny', pattern: 'secrets/**', ops: 'edits', scope: 'All folders' }, { id: 'b', kind: 'path', effect: 'deny', pattern: '.env', ops: 'edits', scope: 'All folders' }];
for (const tool of ['write_file', 'edit_file', 'multi_edit', 'download_file']) console.log('Deny-edit rule on secrets/x for ' + tool.padEnd(14), pr.checkToolCall(rules, tool, { path: 'secrets/x' }, 'secrets/x')?.effect ?? 'NONE (rule not applied)');
srv2.close();
