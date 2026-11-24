import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConfiner, labelRefusal, parseLabel, confineApplies, confineMode, NOT_COVERED } from '../src/server/confine.js';

// F13 command confinement, option A (Tech Lead's spec, Security's F13-1 to F13-5). The Windows tests use invented temp folders only, never a real project and never the real profile; each cleans up after itself.
const windows = process.platform === 'win32';
const sys = (name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
const icacls = (folder) => execFileSync(sys('icacls.exe'), [folder], { encoding: 'utf8', windowsHide: true });

test('F13-1: the label is refused on a drive root, the home folder, Desktop, Documents, Downloads, Windows, and any folder holding Bunny\'s data or key folders', () => {
  const home = 'C:\\Users\\Sam';
  const data = 'C:\\Users\\Sam\\AppData\\Local\\BunnyAI';
  const refuse = (p, opts = {}) => labelRefusal(p, { home, protect: [data], ...opts });
  assert.match(refuse('C:\\'), /whole drive/);
  assert.match(refuse('D:\\'), /whole drive/);
  assert.match(refuse(home), /home folder/);
  assert.match(refuse(`${home}\\Desktop`), /Desktop/);
  assert.match(refuse(`${home}\\Documents`), /Documents/);
  assert.match(refuse(`${home}\\Downloads`), /Downloads/);
  assert.match(refuse('C:\\Users'), /holds Bunny's own data/);
  assert.match(refuse('C:\\Users', { protect: [] }), /holds your home folder/);
  assert.match(refuse('C:\\Users\\Sam\\AppData\\Local'), /holds Bunny's own data/);
  assert.match(refuse(`${home}\\AppData`), /holds Bunny's own data/);
  assert.match(refuse(`${data}\\secrets`), /inside Bunny's own data/, 'nothing inside the data folder either');
  assert.match(refuse(`${data}\\worktrees`), /inside Bunny's own data/, 'the worktrees folder itself is refused');
  assert.equal(refuse(`${data}\\worktrees\\shop-ab12cd\\chat1`, { allowInside: [`${data}\\worktrees`] }), null, "a chat's own copy of a project, strictly inside worktrees, may be labelled");
  assert.match(refuse('C:\\Windows\\System32'), /system folder/);
  assert.equal(refuse(`${home}\\Documents\\carrot-shop`), null, 'a project inside Documents is fine');
  assert.equal(refuse('D:\\work\\shop'), null);
  assert.equal(refuse(`${home}\\Desktop\\`.replace(/\\$/, '')), refuse(`${home}\\Desktop`), 'a trailing slash changes nothing');
});

test('the icacls output is read for the folder\'s current label, and the setting means what the help says', () => {
  assert.deepEqual(parseLabel('x S-1-1-0:(OI)(CI)(M)\n   Mandatory Label\\Low Mandatory Level:(OI)(CI)(NW)\n\nSuccessfully processed 1 files'), { level: 'Low', flags: '(OI)(CI)(NW)' });
  assert.deepEqual(parseLabel('x S-1-1-0:(OI)(CI)(M)\n\nSuccessfully processed 1 files'), { level: null, flags: '' });
  assert.equal(confineMode({}), 'off'); assert.equal(confineMode({ confineCommands: 'nonsense' }), 'off');
  assert.equal(confineApplies({ confineCommands: 'auto' }, 'auto'), true);
  assert.equal(confineApplies({ confineCommands: 'auto' }, 'manual'), false);
  assert.equal(confineApplies({ confineCommands: 'always' }, 'manual'), true);
  assert.equal(confineApplies({ confineCommands: 'off' }, 'auto'), false);
  assert.ok(NOT_COVERED.some((t) => /Reading files/.test(t) && /data folder/.test(t) && /decrypted/.test(t)) && NOT_COVERED.some((t) => /network/.test(t)) && NOT_COVERED.some((t) => /Claude Code on Windows has none/.test(t)));
});

test('a non-Windows server never confines and never claims to', async () => {
  const c = createConfiner({ dataDir: tmpdir(), windows: false });
  assert.equal((await c.use()).ok, false);
  assert.equal((await c.label(tmpdir())).ok, false);
  assert.equal((await c.wrap({ root: tmpdir(), cwd: tmpdir(), script: 'x' })).ok, false);
});

function runWrapped(w, ms = 60_000) {
  return new Promise((res) => {
    const p = spawn(w.file, w.args, { env: w.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill(), ms);
    p.on('close', (code) => { clearTimeout(t); res({ code, out }); });
  });
}

test('F13 on Windows: inside the labelled folder writes work; outside it, the home folder and the registry are refused; node, git and npm work; the child is Low', { skip: !windows }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'bunny-confine-test-'));
  const dataDir = join(base, 'data'); const root = join(base, 'project'); const sibling = join(base, 'sibling');
  for (const d of [dataDir, root, sibling]) mkdirSync(d, { recursive: true });
  const probe = `bunny-probe-${randomBytes(4).toString('hex')}`;
  const homeProbe = join(process.env.USERPROFILE ?? homedir(), `${probe}.txt`);
  t.after(() => { rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); rmSync(homeProbe, { force: true }); try { execFileSync(sys('reg.exe'), ['delete', `HKCU\\Software\\${probe}`, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { /* never made */ } });
  const c = createConfiner({ dataDir });
  const before = icacls(root);
  const labelled = await c.label(root);
  assert.equal(labelled.ok, true, labelled.why);
  assert.equal(labelled.before.level, null, 'a fresh folder has no label of its own');
  const go = async (script) => runWrapped(await c.wrap({ root, cwd: root, script }));
  const rel = (p) => p.replace(/'/g, "''");

  const inside = await go(`Set-Content -LiteralPath '${rel(join(root, 'in.txt'))}' -Value x -ErrorAction Stop; 'inside ok'`);
  assert.match(inside.out, /inside ok/); assert.equal(inside.code, 0); assert.ok(existsSync(join(root, 'in.txt')));
  for (const [what, script, file] of [
    ['a sibling folder', `Set-Content -LiteralPath '${rel(join(sibling, 'out.txt'))}' -Value x -ErrorAction Stop`, join(sibling, 'out.txt')],
    ['the home folder', `Set-Content -LiteralPath '${rel(homeProbe)}' -Value x -ErrorAction Stop`, homeProbe],
  ]) { const r = await go(script); assert.notEqual(r.code, 0, `${what}: refused`); assert.match(r.out, /denied/i, what); assert.equal(existsSync(file), false, `${what}: nothing written`); }
  const reg = await go(`New-Item -Path 'HKCU:\\Software\\${probe}' -ErrorAction Stop | Out-Null`);
  assert.notEqual(reg.code, 0, 'the registry is refused'); assert.match(reg.out, /denied|not allowed|Requested registry access/i);

  const groups = await go(`& '${rel(sys('whoami.exe'))}' /groups /fo csv`);
  assert.match(groups.out, /Mandatory Label\\Low Mandatory Level","Label","S-1-16-4096"/, 'whoami /groups inside the child shows S-1-16-4096');
  const priv = await go(`& '${rel(sys('whoami.exe'))}' /priv /fo csv`);
  assert.doesNotMatch(priv.out, /SeImpersonatePrivilege|SeDebugPrivilege|SeBackupPrivilege|SeRestorePrivilege|SeTakeOwnershipPrivilege/, 'no extra privileges (F13-3)');

  const dev = await go("node -p '40+2'; git init -q; git -c user.name=t -c user.email=t@example.invalid commit --allow-empty -q -m first; git log --oneline");
  assert.match(dev.out, /^42$/m); assert.match(dev.out, /first/); assert.equal(dev.code, 0, dev.out);
  const stand = join(root, 'stand-in'); mkdirSync(stand);
  writeFileSync(join(stand, 'package.json'), JSON.stringify({ name: 'stand-in', version: '1.0.0', main: 'i.js' })); writeFileSync(join(stand, 'i.js'), 'module.exports = 7;');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
  const npm = await go('npm install ./stand-in --no-audit --no-fund --loglevel=error; if (Test-Path node_modules/stand-in) { "installed" }');
  assert.match(npm.out, /installed/, `npm install with the cache redirect works: ${npm.out.slice(0, 300)}`);
  assert.ok(existsSync(join(root, '.bunny', 'tmp')), 'the caches live in <folder>/.bunny/tmp');
  assert.equal(readFileSync(join(root, '.bunny', '.gitignore'), 'utf8').trim(), '*', 'F13-5: git ignores Bunny\'s scratch');

  // F13-1: the recorded label goes back EXACTLY, and the caches go with it
  const removed = await c.unlabel(root, labelled.before);
  assert.equal(removed.ok, true, removed.why);
  assert.equal(existsSync(join(root, '.bunny', 'tmp')), false, 'F13-5: Remove the label deletes .bunny/tmp');
  assert.equal(icacls(root).replace(/\r/g, ''), before.replace(/\r/g, ''), 'the folder\'s icacls output is exactly what it was before labelling');
  assert.equal(parseLabel(icacls(root)).level, null);
  assert.equal(parseLabel(icacls(join(root, 'in.txt'))).level, null, 'files made while confined lose their inherited label too');
});

test('F13-1 on Windows: a folder that was already labelled Medium gets Medium back, not "none"; the label is refused on a drive root without touching it', { skip: !windows }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'bunny-confine-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  const root = join(base, 'project'); mkdirSync(root);
  execFileSync(sys('icacls.exe'), [root, '/setintegritylevel', '(OI)(CI)M'], { windowsHide: true });
  const c = createConfiner({ dataDir: join(base, 'data') });
  const labelled = await c.label(root);
  assert.equal(labelled.ok, true, labelled.why);
  assert.equal(labelled.before.level, 'Medium');
  assert.equal(parseLabel(icacls(root)).level, 'Low');
  assert.equal((await c.unlabel(root, labelled.before)).ok, true);
  assert.equal(parseLabel(icacls(root)).level, 'Medium');
  const drive = await c.label(`${process.env.SystemDrive ?? 'C:'}\\`);
  assert.equal(drive.ok, false); assert.equal(drive.refused, true);
  const home = await c.label(process.env.USERPROFILE ?? homedir());
  assert.equal(home.ok, false); assert.equal(home.refused, true);
});

test('F13-2 on Windows: a tampered or missing helper is not used (the caller shows the card), is rebuilt, and works again', { skip: !windows }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'bunny-confine-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  const root = join(base, 'project'); mkdirSync(root);
  const c = createConfiner({ dataDir: join(base, 'data') });
  assert.equal((await c.use()).ok, true, 'built on first use');
  const bytes = readFileSync(c.exe); bytes[bytes.length - 3] ^= 0xff; // one byte
  writeFileSync(c.exe, bytes);
  const bad = await c.use();
  assert.equal(bad.ok, false); assert.equal(bad.changed, true);
  assert.equal((await c.wrap({ root, cwd: root, script: 'echo hi' })).ok, false, 'no wrap, so no run, while the helper is wrong');
  await c.rebuild();
  assert.equal((await c.use()).ok, true, 'rebuilt');
  rmSync(c.exe);
  assert.equal((await c.use()).ok, false, 'a missing helper is not used either');
  await c.rebuild();
  assert.equal((await c.use()).ok, true);
});

test('F13 on Windows: the median time a confined command adds is recorded (target under 0.3 s)', { skip: !windows }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'bunny-confine-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  const root = join(base, 'project'); mkdirSync(root);
  const c = createConfiner({ dataDir: join(base, 'data') });
  assert.equal((await c.label(root)).ok, true);
  const timeIt = async (make) => { const a = []; for (let i = 0; i < 5; i += 1) { const t0 = performance.now(); await runWrapped(await make()); a.push(performance.now() - t0); } return a.sort((x, y) => x - y)[2]; };
  const confined = await timeIt(() => c.wrap({ root, cwd: root, script: '$null' }));
  const plain = await timeIt(async () => ({ file: sys('WindowsPowerShell/v1.0/powershell.exe'), args: ['-NoProfile', '-NonInteractive', '-Command', '$null'], env: process.env }));
  const added = confined - plain;
  console.log(`F13 timing: confined median ${Math.round(confined)} ms, plain ${Math.round(plain)} ms, added ${Math.round(added)} ms`);
  assert.ok(added < 1500, `the helper adds ${Math.round(added)} ms`);
  await c.unlabel(root, { level: null, flags: '' });
});

test('F13 on Windows: a junction planted as .bunny or .bunny/tmp (a confined command may make one) is never written through or deleted through', { skip: !windows }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'bunny-confine-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  const root = join(base, 'project'); const elsewhere = join(base, 'elsewhere'); mkdirSync(root); mkdirSync(join(elsewhere, 'tmp'), { recursive: true });
  writeFileSync(join(elsewhere, 'tmp', 'keep.txt'), 'must survive');
  const c = createConfiner({ dataDir: join(base, 'data') });
  assert.equal((await c.label(root)).ok, true);
  rmSync(join(root, '.bunny'), { recursive: true, force: true });
  symlinkSync(elsewhere, join(root, '.bunny'), 'junction'); // .bunny -> elsewhere
  const w = await c.wrap({ root, cwd: root, script: '$null' });
  assert.equal(w.ok, true, w.why);
  assert.equal(lstatSync(join(root, '.bunny')).isSymbolicLink(), false, 'the junction was replaced by a real folder');
  assert.equal(existsSync(join(elsewhere, '.gitignore')), false, 'nothing was written through the junction');
  assert.equal(readFileSync(join(elsewhere, 'tmp', 'keep.txt'), 'utf8'), 'must survive');
  // a junction as .bunny/tmp, then "Remove the label": the target is not emptied
  rmSync(join(root, '.bunny', 'tmp'), { recursive: true, force: true });
  symlinkSync(join(elsewhere, 'tmp'), join(root, '.bunny', 'tmp'), 'junction');
  assert.equal((await c.unlabel(root, { level: null, flags: '' })).ok, true);
  assert.equal(readFileSync(join(elsewhere, 'tmp', 'keep.txt'), 'utf8'), 'must survive', 'Remove the label did not delete through the junction');
});
