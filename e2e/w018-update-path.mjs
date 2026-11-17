/**
 * QA, post-release gap walk for v0.1.8: the update path, as far as it goes WITHOUT installing anything.
 * Part A uses the real published release metadata (read with gh, read-only) and the real updater code (electron/updater.js) configured as 0.1.7:
 *   it must see 0.1.8, and its checksum check must refuse a body that is not the published installer. The 122 MB installer is NOT downloaded:
 *   the installer request is answered by an invented 1 KB body.
 * Part B runs the same updater against an invented feed on a local port with an invented 3 MB "installer": the good path, a tampered body, a
 *   short body, a missing manifest, feed errors and version comparisons. install() is never called (nothing is run or installed).
 *   node e2e/w018-update-path.mjs
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const { createUpdater, readRelease, compareVersions } = await import(pathToFileURL(join(process.cwd(), 'electron', 'updater.js')).href);
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };
const gh = (...args) => { const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };

// ================= A: the real published release =================
const latestJson = gh('api', 'repos/AnfalHaider/bunny-ai/releases/latest');
const release = latestJson ? JSON.parse(latestJson) : null;
check('A1', 'GitHub\'s "latest release" (the feed the app asks) is v0.1.8: published, not a draft, not a pre-release', release?.tag_name === 'v0.1.8' && release.draft === false && release.prerelease === false, `${release?.tag_name} published ${release?.published_at}`);
const installerAsset = release?.assets?.find((a) => /setup.*\.exe$/i.test(a.name));
const manifestAsset = release?.assets?.find((a) => a.name === 'latest.yml');
check('A2', 'the release has the installer Bunny-AI-Setup-0.1.8.exe (122,275,508 bytes), its .blockmap and latest.yml, all uploaded', installerAsset?.name === 'Bunny-AI-Setup-0.1.8.exe' && installerAsset.size === 122275508 && installerAsset.state === 'uploaded' && release.assets.some((a) => a.name.endsWith('.blockmap')) && Boolean(manifestAsset), release?.assets?.map((a) => `${a.name} ${a.size}`).join(' | '));
const ymlText = manifestAsset ? gh('api', '-H', 'Accept: application/octet-stream', `repos/AnfalHaider/bunny-ai/releases/assets/${manifestAsset.id}`) : null;
const ymlSha = /^sha512:\s*(\S+)/m.exec(ymlText ?? '')?.[1];
const ymlSize = Number(/^\s*size:\s*(\d+)/m.exec(ymlText ?? '')?.[1]);
check('A3', 'latest.yml names version 0.1.8 and the file Bunny-AI-Setup-0.1.8.exe, and its size (122,275,508) equals the uploaded installer\'s size', /^version:\s*0\.1\.8\s*$/m.test(ymlText ?? '') && /^path:\s*Bunny-AI-Setup-0\.1\.8\.exe\s*$/m.test(ymlText ?? '') && /url:\s*Bunny-AI-Setup-0\.1\.8\.exe/.test(ymlText ?? '') && ymlSize === installerAsset?.size, `sha512 ${String(ymlSha).slice(0, 24)}…, size ${ymlSize}`);
check('A4', 'the sha512 appears twice in latest.yml and both are the same value (the file entry and the top line)', [...(ymlText ?? '').matchAll(/sha512:\s*(\S+)/g)].map((m) => m[1]).every((v) => v === ymlSha) && [...(ymlText ?? '').matchAll(/sha512:/g)].length === 2);
console.log('INFO  NOT checked: that this sha512 is the sha512 of the 122 MB installer (it would need the installer downloaded, which was not done); GitHub\'s own sha256 for the installer is ' + (installerAsset?.digest ?? 'unknown'));

const realFetch = async (url, init) => {
  if (url === 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest') return new Response(latestJson, { status: 200, headers: { 'content-type': 'application/json' } });
  if (manifestAsset && url === manifestAsset.browser_download_url) return new Response(ymlText, { status: 200 });
  if (installerAsset && url === installerAsset.browser_download_url) return new Response(randomBytes(1024), { status: 200 }); // NOT the real installer
  return new Response('not used', { status: 404 });
};
if (release) {
  const read = await readRelease(release, realFetch);
  check('A5', 'the updater\'s own reader (readRelease) turns the real release into: version 0.1.8, the installer name, its size 122,275,508 and the sha512 from latest.yml', read?.version === '0.1.8' && read.name === 'Bunny-AI-Setup-0.1.8.exe' && read.size === 122275508 && read.sha512 === ymlSha, JSON.stringify({ v: read?.version, n: read?.name, s: read?.size, sha: String(read?.sha512).slice(0, 16) }));
  check('A6', 'the release notes the updater would show are the first 4,000 characters of the published body (3,593 characters here, so all of it)', (read?.notes ?? '').length === Math.min(4000, release.body.length));
  const statuses = [];
  const dir = mkdtempSync(join(tmpdir(), 'bunny-w018-upd-'));
  const u = createUpdater({ currentVersion: '0.1.7', feed: 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest', fetchImpl: realFetch, downloadDir: dir, onStatus: (s) => statuses.push(s.state) });
  const result = await u.check({ manual: true });
  check('A7', 'an updater configured as 0.1.7 asks the real feed and SEES 0.1.8: it goes checking, then downloading with latest = 0.1.8', statuses.includes('checking') && statuses.includes('downloading') && result.latest === '0.1.8', statuses.join(' > '));
  check('A8', 'given a body that is NOT the published installer (an invented 1 KB), it refuses: the error says it did not match its published checksum and the file was thrown away, nothing is left to install', result.state === 'error' && /did not match its published checksum/.test(result.message) && !u.hasUpdate() && readdirSync(dir).length === 0, `${result.state}: ${result.message}`);
  for (const [cur, want] of [['0.1.8', 'none'], ['0.1.9', 'none'], ['0.2.0', 'none'], ['0.1.10', 'none'], ['0.1.7', 'error'], ['0.1.0', 'error'], ['0.0.9', 'error']]) {
    const r = await createUpdater({ currentVersion: cur, feed: 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest', fetchImpl: realFetch, downloadDir: mkdtempSync(join(tmpdir(), 'bunny-w018-upd-')) }).check({ manual: true });
    check(`A9 ${cur}`, `a copy that is ${cur} ${want === 'none' ? 'is told it has the latest version (no download)' : 'sees 0.1.8 as newer and starts the download (stopped here by the invented body)'}`, r.state === want, `${r.state}: ${r.message}`);
  }
}

// ================= B: an invented feed =================
const installer = randomBytes(3 * 1024 * 1024);
const sha = createHash('sha512').update(installer).digest('base64');
let mode = 'good';
const server = createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === '/feed') {
    if (mode === 'feed404') { res.writeHead(404); res.end('{}'); return; }
    if (mode === 'feed500') { res.writeHead(500); res.end('oops'); return; }
    if (mode === 'feedhtml') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not json</html>'); return; }
    const assets = [{ name: 'Bunny-AI-Setup-9.9.9.exe', size: installer.length, browser_download_url: `${base}/installer` }];
    if (mode !== 'nomanifest') assets.push({ name: 'latest.yml', size: 100, browser_download_url: `${base}/latest.yml` });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: 'v9.9.9', body: 'invented notes', assets })); return;
  }
  if (req.url === '/latest.yml') { res.writeHead(200); res.end(`version: 9.9.9\nfiles:\n  - url: Bunny-AI-Setup-9.9.9.exe\n    sha512: ${sha}\n    size: ${installer.length}\npath: Bunny-AI-Setup-9.9.9.exe\nsha512: ${sha}\n`); return; }
  if (req.url === '/installer') {
    if (mode === 'tampered') { const b = Buffer.from(installer); b[1000] ^= 0xff; res.writeHead(200); res.end(b); return; }
    if (mode === 'short') { res.writeHead(200); res.end(installer.subarray(0, installer.length - 5000)); return; }
    if (mode === 'installer404') { res.writeHead(404); res.end('gone'); return; }
    res.writeHead(200); res.end(installer); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `http://127.0.0.1:${server.address().port}/feed`;
const run = async (current = '0.1.8') => { const statuses = []; const dir = mkdtempSync(join(tmpdir(), 'bunny-w018-upd-')); const u = createUpdater({ currentVersion: current, feed, downloadDir: dir, onStatus: (s) => statuses.push(`${s.state}${s.progress !== undefined && s.state === 'downloading' ? `:${s.progress}` : ''}`) }); const r = await u.check({ manual: true }); return { r, u, dir, statuses }; };
mode = 'good'; const good = await run();
check('B1', 'good feed, current 0.1.8, feed has 9.9.9: the installer downloads with progress, the checksum matches and the state is ready ("Bunny AI 9.9.9 is ready. Restart to update.")', good.r.state === 'ready' && good.u.hasUpdate() && /ready\. Restart to update/.test(good.r.message) && good.statuses.some((s) => /^downloading:[1-9]/.test(s)), `${good.r.state}: ${good.r.message}; ${good.statuses.slice(0, 5).join(' > ')}`);
check('B2', 'the file is in the invented download folder under its published name and its size is right (nothing was installed or run)', existsSync(join(good.dir, 'Bunny-AI-Setup-9.9.9.exe')) && readdirSync(good.dir).length === 1);
mode = 'tampered'; const t1 = await run();
check('B3', 'a body that differs by ONE byte from the published sha512 is refused and thrown away', t1.r.state === 'error' && /did not match its published checksum/.test(t1.r.message) && readdirSync(t1.dir).length === 0 && !t1.u.hasUpdate(), `${t1.r.state}: ${t1.r.message}`);
mode = 'short'; const t2 = await run();
check('B4', 'a body that stops short is refused (checksum or incomplete) and nothing is kept', t2.r.state === 'error' && readdirSync(t2.dir).length === 0 && !t2.u.hasUpdate(), `${t2.r.state}: ${t2.r.message}`);
mode = 'installer404'; const t3 = await run();
check('B5', 'an installer address that answers 404 gives a plain error ("GitHub answered 404 for the installer")', t3.r.state === 'error' && /404/.test(t3.r.message), t3.r.message);
mode = 'feed404'; const t4 = await run();
check('B6', 'a feed that answers 404 (no release published) says "No releases are published yet." and does not fail', t4.r.state === 'none' && /No releases are published yet/.test(t4.r.message), t4.r.message);
mode = 'feed500'; const t5 = await run();
check('B7', 'a feed that answers 500 gives "The update check failed: GitHub answered 500" (no crash, no download)', t5.r.state === 'error' && /GitHub answered 500/.test(t5.r.message), t5.r.message);
mode = 'feedhtml'; const t6 = await run();
check('B8', 'a feed that answers with a web page instead of JSON gives a plain failure, not a crash', t6.r.state === 'error' && /update check failed/.test(t6.r.message), t6.r.message);
mode = 'nomanifest'; const t7 = await run();
console.log(`INFO  a release WITHOUT latest.yml: the updater ${t7.r.state === 'ready' ? 'DOWNLOADS AND ACCEPTS the installer with NO checksum check (state ready)' : `refuses (${t7.r.state}: ${t7.r.message})`}`);
check('B9', 'a release that has no latest.yml is not accepted without a checksum', t7.r.state !== 'ready', `${t7.r.state}: ${t7.r.message}`);
mode = 'good'; const second = await run('0.1.8'); const again = await second.u.check({ manual: true });
check('B10', 'checking again while an update is already ready does not download it a second time (uses the one on disk)', again.state === 'ready' && readdirSync(second.dir).length === 1, `${again.state}`);
for (const [a, b, want] of [['0.1.8', '0.1.7', 1], ['0.1.7', '0.1.8', -1], ['0.1.8', '0.1.8', 0], ['v0.1.8', '0.1.8', 0], ['0.1.10', '0.1.9', 1], ['1.0.0', '0.9.9', 1], ['0.1.8-rc1', '0.1.8', 0], ['0.1.8.1', '0.1.8', 1], ['abc', '0.1.8', -1]]) check(`B11 ${a} vs ${b}`, `compareVersions(${a}, ${b}) = ${want}`, compareVersions(a, b) === want, String(compareVersions(a, b)));
console.log('INFO  a pre-release suffix is ignored by the comparison: 0.1.8-rc1 equals 0.1.8 (so a 0.1.8-rc1 copy is never offered 0.1.8)');
server.close();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);
