/**
 * QA, v0.1.9 S-UPD (ab1d2fc): the updater refuses a release that has no published SHA-512, reads the checksum strictly, saves under a plain file name,
 * and compares versions like semver. The real updater code (electron/updater.js), an invented feed on a local port, an invented 3 MB "installer".
 * Nothing is installed or run (install() is never called).
 *   node e2e/w019-supd.mjs
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { createUpdater, compareVersions } = await import(pathToFileURL(join(process.cwd(), 'electron', 'updater.js')).href);
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : ''}`); };
const installer = randomBytes(2 * 1024 * 1024);
const sha = createHash('sha512').update(installer).digest('base64');
const hex = createHash('sha512').update(installer).digest('hex');
let yml = ''; let assetName = 'Bunny-AI-Setup-9.9.9.exe'; let tag = 'v9.9.9'; let hits = { installer: 0, manifest: 0 }; let manifest = true; let size = installer.length;
const server = createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url === '/feed') {
    const assets = [{ name: assetName, size, browser_download_url: `${base}/installer` }];
    if (manifest) assets.push({ name: 'latest.yml', size: 100, browser_download_url: `${base}/latest.yml` });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: tag, body: 'invented', assets })); return;
  }
  if (req.url === '/latest.yml') { hits.manifest += 1; res.writeHead(200); res.end(yml); return; }
  if (req.url === '/installer') { hits.installer += 1; res.writeHead(200); res.end(installer); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `http://127.0.0.1:${server.address().port}/feed`;
const good = (extra = '') => `version: 9.9.9\nfiles:\n  - url: ${assetName}\n    sha512: ${sha}\n    size: ${installer.length}\npath: ${assetName}\nsha512: ${sha}\n${extra}`;
async function run({ current = '0.1.8', text = good(), name = 'Bunny-AI-Setup-9.9.9.exe', version = 'v9.9.9', withManifest = true, assetSize = installer.length } = {}) {
  yml = text; assetName = name; tag = version; manifest = withManifest; size = assetSize; hits = { installer: 0, manifest: 0 };
  const dir = mkdtempSync(join(tmpdir(), 'bunny-w019-upd-'));
  const u = createUpdater({ currentVersion: current, feed, downloadDir: dir });
  const r = await u.check({ manual: true });
  return { r, u, dir, hits: { ...hits } };
}
const refusedNoDownload = (x) => x.r.state === 'error' && /no published checksum/.test(x.r.message) && x.hits.installer === 0 && readdirSync(x.dir).length === 0 && !x.u.hasUpdate();

const ok = await run();
check('M0', 'a good release (latest.yml with a 88-character SHA-512, matching bytes) downloads and is ready', ok.r.state === 'ready' && ok.u.hasUpdate() && ok.hits.installer === 1, `${ok.r.state}: ${ok.r.message}`);
check('M1', 'no latest.yml in the release: refused with "no published checksum ... will not be installed", and the installer was NEVER requested', refusedNoDownload(await run({ withManifest: false })), '');
const noLine = await run({ text: 'version: 9.9.9\nfiles:\n  - url: x.exe\n    size: 5\n' });
check('M2', 'a latest.yml that has no sha512 line at all is refused before any download', refusedNoDownload(noLine), `${noLine.r.state}: ${noLine.r.message}`);
const emptyLine = await run({ text: 'version: 9.9.9\nsha512:\nsize: 1234\npath: x.exe\n' });
check('M3', 'an EMPTY "sha512:" line (the next key must not be read as its value) is refused', refusedNoDownload(emptyLine), `${emptyLine.r.message}`);
const nextLine = await run({ text: `version: 9.9.9\nsha512:\n  ${sha}\npath: x.exe\n` });
check('M4', 'a sha512 whose value is on the NEXT line is refused (it must be on its own line)', refusedNoDownload(nextLine), `${nextLine.r.message}`);
const onlyIndented = await run({ text: `version: 9.9.9\nfiles:\n  - url: x.exe\n    sha512: ${sha}\n    size: 1\n` });
check('M5', 'only an indented per-file sha512 and no top-level sha512 line: refused (strict) or accepted — which is it', onlyIndented.r.state === 'error', `${onlyIndented.r.state}: ${onlyIndented.r.message}`);
console.log(`INFO  only an indented file entry (no top-level sha512): ${onlyIndented.r.state === 'error' ? 'refused' : 'accepted'}`);
const hexRun = await run({ text: `version: 9.9.9\nsha512: ${hex}\n` });
check('M6', 'a hex digest (128 characters) is not accepted as a base64 SHA-512: refused before any download', refusedNoDownload(hexRun), `${hexRun.r.message}`);
const short = await run({ text: `version: 9.9.9\nsha512: ${sha.slice(0, 40)}\n` });
check('M7', 'a too-short digest is refused before any download', refusedNoDownload(short));
const junk = await run({ text: `version: 9.9.9\nsha512: ${'A'.repeat(86)}==\n` });
check('M8', 'a digest of the right shape but not the installer\'s: the download happens, the checksum does not match, the file is thrown away', junk.r.state === 'error' && /did not match its published checksum/.test(junk.r.message) && readdirSync(junk.dir).length === 0, `${junk.r.message}`);
const quoted = await run({ text: `version: 9.9.9\nsha512: "${sha}"\n` });
console.log(`INFO  a sha512 value in double quotes (valid YAML): ${quoted.r.state === 'ready' ? 'accepted' : `refused (${quoted.r.message.slice(0, 80)})`}`);
const crlf = await run({ text: good().replace(/\n/g, '\r\n') });
console.log(`INFO  a latest.yml with Windows line ends (CRLF): ${crlf.r.state === 'ready' ? 'accepted' : `refused (${crlf.r.message.slice(0, 90)})`}`);
check('M9', 'a latest.yml written with CRLF line ends still works (electron-builder writes LF, but a hand-edited one may not)', crlf.r.state === 'ready', `${crlf.r.state}`);
const trailing = await run({ text: good().replace(`path: ${assetName}\nsha512: ${sha}\n`, `path: ${assetName}\nsha512: ${sha}   \n`) });
check('M10', 'trailing spaces after the digest are fine', trailing.r.state === 'ready', trailing.r.state);
const withComment = await run({ text: good().replace(`sha512: ${sha}\n`, `sha512: ${sha}\n`) + '# comment\n' });
check('M11', 'a comment line after the keys is fine', withComment.r.state === 'ready');
// file name handling
for (const [label, name] of [['a path with ..\\', '..\\..\\evil.exe'], ['a path with ../', '../escape/Bunny-Setup.exe'], ['an absolute path', 'C:\\Windows\\System32\\x.exe'], ['a drive-less rooted path', '\\\\server\\share\\x.exe']]) {
  const x = await run({ name, text: good().replaceAll('Bunny-AI-Setup-9.9.9.exe', name.replace(/\\/g, '/')) });
  const files = readdirSync(x.dir);
  const escaped = existsSync(join(x.dir, '..', 'evil.exe')) || existsSync(join(x.dir, '..', 'Bunny-Setup.exe'));
  check(`N ${label}`, `an installer asset named with ${label} is saved inside the download folder under its plain file name only (nothing outside it)`, (['ready', 'error', 'none'].includes(x.r.state)) && !escaped && files.every((f) => !/[\\/]/.test(f)), `${x.r.state}; files ${files.join(',')}`);
}
const noExe = await run({ name: 'Bunny-AI-Setup-9.9.9.exe.blockmap' });
console.log(`INFO  a release whose only installer-like asset is a .blockmap: ${noExe.r.state} ${noExe.r.message.slice(0, 80)}`);
// sizes
const wrongSize = await run({ assetSize: installer.length + 777 });
check('S1', 'an asset whose published size is not the size of the bytes served is refused and nothing is kept', wrongSize.r.state === 'error' && readdirSync(wrongSize.dir).length === 0, `${wrongSize.r.message}`);

// versions
const table = [['0.1.9-rc.1', '0.1.9', -1], ['0.1.9', '0.1.9-rc.1', 1], ['0.1.9-rc.2', '0.1.9-rc.1', 1], ['0.1.9-rc.10', '0.1.9-rc.2', 1], ['0.1.9-alpha', '0.1.9-beta', -1], ['0.1.9-1', '0.1.9-alpha', -1], ['0.1.9-rc.1', '0.1.9-rc.1', 0], ['0.1.9+build5', '0.1.9', 0], ['v0.1.9', '0.1.9', 0], ['0.1.9-rc', '0.1.9-rc.1', -1], ['0.2.0-rc.1', '0.1.9', 1], ['0.1.8', '0.1.9-rc.1', -1], ['0.1.10', '0.1.9', 1], ['1.0.0-rc.1', '0.9.9', 1], ['0.1.9-rc.1+a', '0.1.9-rc.1+b', 0], ['0.1.9-RC.1', '0.1.9-rc.1', -1]];
for (const [a, b, want] of table) check(`V ${a} vs ${b}`, `compareVersions(${a}, ${b}) = ${want}`, compareVersions(a, b) === want, String(compareVersions(a, b)));
const rcToFinal = await run({ current: '0.1.9-rc.1', version: 'v0.1.9', text: good().replace('9.9.9', '0.1.9') });
check('U1', 'a 0.1.9-rc.1 copy IS offered 0.1.9 (it downloads)', rcToFinal.r.state === 'ready', `${rcToFinal.r.state}`);
const finalToRc = await run({ current: '0.1.9', version: 'v0.1.9-rc.1' });
check('U2', 'a 0.1.9 copy is NOT offered 0.1.9-rc.1 ("You have the latest version"), nothing is downloaded', finalToRc.r.state === 'none' && finalToRc.hits.installer === 0, `${finalToRc.r.state}`);
const sameVersion = await run({ current: '0.1.9', version: 'v0.1.9' });
check('U3', 'the same version is not downloaded again', sameVersion.r.state === 'none' && sameVersion.hits.installer === 0);
const older = await run({ current: '1.0.0', version: 'v0.1.9' });
check('U4', 'a feed that is OLDER than the installed copy never offers a downgrade', older.r.state === 'none' && older.hits.installer === 0);
const bogus = await run({ version: 'latest' });
console.log(`INFO  a release tagged "latest" (no version): ${bogus.r.state} ${bogus.r.message.slice(0, 90)}`);
check('U5', 'a tag that is not a version does not install anything unverified or crash', bogus.r.state !== 'ready' || bogus.hits.installer <= 1, `${bogus.r.state}`);
server.close();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);
