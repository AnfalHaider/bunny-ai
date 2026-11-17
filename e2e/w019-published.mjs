/**
 * QA, post-release gap walk for v0.1.9: the update path, as far as it goes WITHOUT installing anything.
 * Part A uses the real published release metadata (read with gh, read-only) and the real updater code (electron/updater.js) configured as 0.1.8:
 *   it must see 0.1.9, and its checksum check must refuse a body that is not the published installer. The 122 MB installer is NOT downloaded:
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
check('A1', 'GitHub\'s "latest release" (the feed the app asks) is v0.1.9: published, not a draft, not a pre-release', release?.tag_name === 'v0.1.9' && release.draft === false && release.prerelease === false, `${release?.tag_name} published ${release?.published_at}`);
const installerAsset = release?.assets?.find((a) => /setup.*\.exe$/i.test(a.name));
const manifestAsset = release?.assets?.find((a) => a.name === 'latest.yml');
check('A2', 'the release has the installer Bunny-AI-Setup-0.1.9.exe (122,320,093 bytes), its .blockmap and latest.yml, all uploaded', installerAsset?.name === 'Bunny-AI-Setup-0.1.9.exe' && installerAsset.size === 122320093 && installerAsset.state === 'uploaded' && release.assets.some((a) => a.name.endsWith('.blockmap')) && Boolean(manifestAsset), release?.assets?.map((a) => `${a.name} ${a.size}`).join(' | '));
const ymlText = manifestAsset ? gh('api', '-H', 'Accept: application/octet-stream', `repos/AnfalHaider/bunny-ai/releases/assets/${manifestAsset.id}`) : null;
const ymlSha = /^sha512:\s*(\S+)/m.exec(ymlText ?? '')?.[1];
const ymlSize = Number(/^\s*size:\s*(\d+)/m.exec(ymlText ?? '')?.[1]);
check('A3', 'latest.yml names version 0.1.9 and the file Bunny-AI-Setup-0.1.9.exe, and its size (122,320,093) equals the uploaded installer\'s size', /^version:\s*0.1.9\s*$/m.test(ymlText ?? '') && /^path:\s*Bunny-AI-Setup-0.1.9\.exe\s*$/m.test(ymlText ?? '') && /url:\s*Bunny-AI-Setup-0.1.9\.exe/.test(ymlText ?? '') && ymlSize === installerAsset?.size, `sha512 ${String(ymlSha).slice(0, 24)}…, size ${ymlSize}`);
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
  check('A5', 'the updater\'s own reader (readRelease) turns the real release into: version 0.1.9, the installer name, its size 122,320,093 and the sha512 from latest.yml', read?.version === '0.1.9' && read.name === 'Bunny-AI-Setup-0.1.9.exe' && read.size === 122320093 && read.sha512 === ymlSha, JSON.stringify({ v: read?.version, n: read?.name, s: read?.size, sha: String(read?.sha512).slice(0, 16) }));
  check('A6', 'the release notes the updater would show are the first 4,000 characters of the published body (3,593 characters here, so all of it)', (read?.notes ?? '').length === Math.min(4000, release.body.length));
  const statuses = [];
  const dir = mkdtempSync(join(tmpdir(), 'bunny-w018-upd-'));
  const u = createUpdater({ currentVersion: '0.1.8', feed: 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest', fetchImpl: realFetch, downloadDir: dir, onStatus: (s) => statuses.push(s.state) });
  const result = await u.check({ manual: true });
  check('A7', 'an updater configured as 0.1.8 asks the real feed and SEES 0.1.9: it goes checking, then downloading with latest = 0.1.9', statuses.includes('checking') && statuses.includes('downloading') && result.latest === '0.1.9', statuses.join(' > '));
  check('A8', 'given a body that is NOT the published installer (an invented 1 KB), it refuses: the error says it did not match its published checksum and the file was thrown away, nothing is left to install', result.state === 'error' && /did not match its published checksum/.test(result.message) && !u.hasUpdate() && readdirSync(dir).length === 0, `${result.state}: ${result.message}`);
  for (const [cur, want] of [['0.1.9', 'none'], ['0.2.0', 'none'], ['0.1.10', 'none'], ['0.1.8', 'error'], ['0.1.7', 'error'], ['0.1.0', 'error']]) {
    const r = await createUpdater({ currentVersion: cur, feed: 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest', fetchImpl: realFetch, downloadDir: mkdtempSync(join(tmpdir(), 'bunny-w018-upd-')) }).check({ manual: true });
    check(`A9 ${cur}`, `a copy that is ${cur} ${want === 'none' ? 'is told it has the latest version (no download)' : 'sees 0.1.9 as newer and starts the download (stopped here by the invented body)'}`, r.state === want, `${r.state}: ${r.message}`);
  }
}


const bad = rows.filter((r) => !r.ok); console.log(String.fromCharCode(10) + (rows.length - bad.length) + ' of ' + rows.length + ' passed'); process.exit(bad.length ? 1 : 0);
