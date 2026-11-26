/**
 * LOCAL-MODELS LF-17 to LF-24: where Bunny's own downloads go and how they are remembered, checked, moved and removed.
 *  - the download folder is the person's choice; Bunny writes only into `<chosen>\Bunny models\`, which it creates with an owner-only permission set;
 *  - every download has a record in the DATA folder (real path, volume serial, file id, size, mtime, the pinned sha256); nothing in the download folder is trusted as a record;
 *  - before every start the file is compared with its record, and a difference means a full re-hash against the pinned sha256 (LF-18);
 *  - delete and "Remove Bunny local" remove only recorded files that still match, then empty folders, never a tree.
 */
import { createReadStream } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rename, rmdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { dirname, join, win32 as wp } from 'node:path';
import { powershellPath } from './safeExec.js';

import { PlaceError } from './localPlaces.js';
import { FolderError, isInside } from './localFolderRules.js';

export const BUNNY_DIR = 'Bunny models';
const PART = /^[A-Za-z0-9._-]{1,128}$/;
const MSG = Object.freeze({
  unavailable: "The download folder isn't available. Plug in the drive or choose another folder.",
  changed: 'This file changed after Bunny downloaded it.',
  notFound: 'Not found',
  busy: 'Wait for the download to finish or cancel it.',
  perms: "Bunny couldn't lock that folder to your account, so it isn't using it.",
});
export { MSG as STORE_MESSAGES };

/** The permission set of LF-17: the person, SYSTEM and Administrators only, no inheritance. SIDs, so it works in any Windows language. */
/** Security M-1: icacls /inheritance:r only drops INHERITED entries, so an explicit entry an earlier owner left on a folder that already existed would stay. After the lock the permissions are read back:
 * the folder and everything inside it must hold only the person, SYSTEM and Administrators (the folder with inheritance off), and be owned by one of them. Anything else is refused. */
export const ACL_CHECK_SCRIPT = `$d=$env:BUNNY_ACL_DIR; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $ok=@($me,'S-1-5-18','S-1-5-32-544'); $bad=0
$all=@($d)+@(Get-ChildItem -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
foreach($p in $all){ $a=Get-Acl -LiteralPath $p; $o=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($ok -notcontains $o){$bad++}
 if($p -eq $d -and -not $a.AreAccessRulesProtected){$bad++}
 foreach($r in $a.Access){ $s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($ok -notcontains $s){$bad++} } }
if($bad -eq 0){'OK'}else{'BAD'}`;
export const aclAllowed = (dir, { env = process.env, platform = process.platform, powershell = powershellPath() } = {}) => new Promise((resolve) => {
  if (platform !== 'win32') return resolve(true);
  if (!powershell) return resolve(false);
  execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', ACL_CHECK_SCRIPT], { windowsHide: true, timeout: 30_000, env: { ...env, BUNNY_ACL_DIR: dir } }, (err, out) => resolve(!err && String(out).trim() === 'OK'));
});
export const lockFolder = (dir, { env = process.env, platform = process.platform, check = aclAllowed } = {}) => new Promise((resolve) => {
  if (platform !== 'win32') return resolve(true);
  const user = env.USERNAME; if (!user) return resolve(false);
  const grant = (who) => `${who}:(OI)(CI)F`;
  execFile(join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [dir, '/inheritance:r', '/grant:r', grant(user), grant('*S-1-5-18'), grant('*S-1-5-32-544')], { windowsHide: true }, (err) => (err ? resolve(false) : check(dir, { env, platform }).then(resolve, () => resolve(false))));
});

export const sha256File = (path) => new Promise((resolve, reject) => {
  const h = createHash('sha256'); const s = createReadStream(path);
  s.on('data', (c) => h.update(c)); s.on('end', () => resolve(h.digest('hex'))); s.on('error', reject);
});

/** `<root>/<owner>__<repo>/<revision>`: the layout is Bunny's, every part checked. */
export function entryDir(root, entry) {
  const [owner, repo, ...extra] = String(entry.repo ?? '').split('/');
  if (!owner || !repo || extra.length) throw new PlaceError('local.badName', 'That model has no usable repository name.', 400);
  for (const part of [owner, repo, entry.revision, entry.file]) if (!PART.test(String(part)) || part === '.' || part === '..') throw new PlaceError('local.badName', 'That model has a name Bunny will not use as a file name.', 400);
  return join(root, `${owner}__${repo}`, entry.revision);
}

export function createStore({ dataDir, places, rules, lock = lockFolder, hashFile = sha256File, freeBytes = async () => Infinity } = {}) {
  const defaultRoot = join(dataDir, 'models');
  const st = () => places.state();
  const key = (real) => places.statKey(real);

  const same = (a, b) => isInside(a, b) && isInside(b, a);
  /** Empty folders only, never a tree: the revision folder, the `<owner>__<repo>` folder, and `Bunny models` itself when it was Bunny's own subfolder of the chosen place. */
  async function pruneEmpty(file) {
    let d = dirname(file);
    for (let i = 0; i < 2; i++) { if (isInside(d, defaultRoot)) { if (same(d, defaultRoot)) return; } else if (wp.basename(d).toLowerCase() === BUNNY_DIR.toLowerCase()) break; try { await rmdir(d); } catch { return; } d = dirname(d); }
    if (wp.basename(d).toLowerCase() === BUNNY_DIR.toLowerCase() && !isInside(d, defaultRoot)) await rmdir(d).catch(() => {});
  }

  // ---------------------------------------------------------------- the download folder
  const custom = () => st().downloadFolder ?? null;
  /** The folder new downloads go into, checked now (LF-17: unavailable means unavailable, never a fall-back). */
  async function root() {
    await places.load();
    const c = custom();
    if (!c) return defaultRoot;
    const now = await rules.stillThere({ real: c.real }, { kind: 'download' });
    if (!now.ok) throw new PlaceError('place.unavailable', MSG.unavailable);
    try { await rules.checkFolder(c.real, { kind: 'download', models: st().modelFolders.map((f) => f.real) }); } catch (e) { if (e instanceof FolderError) throw new PlaceError('place.unavailable', e.message.length ? e.message : MSG.unavailable); throw e; }
    const info = await lstat(c.root).catch(() => null);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) throw new PlaceError('place.unavailable', MSG.unavailable);
    return c.root;
  }
  async function setDownloadFolder(path, { busy = false } = {}) {
    await places.load();
    if (busy) throw new PlaceError('place.busy', MSG.busy);
    const r = await rules.checkFolder(path, { kind: 'download', models: st().modelFolders.map((f) => f.real) });
    const lm = await places.lmStudio(); if (lm.state === 'found' && (isInside(lm.real, r.real) || isInside(r.real, lm.real))) throw new FolderError('overlap', 'This folder overlaps your download folder. Choose a separate folder.');
    const bunny = join(r.real, BUNNY_DIR);
    const existing = await lstat(bunny).catch(() => null);
    if (existing?.isSymbolicLink()) throw new PlaceError('place.link', 'This folder is a link. Choose the folder it points to.');
    if (!existing) await mkdir(bunny);
    if (!(await lock(bunny))) { throw new PlaceError('place.perms', MSG.perms); }
    st().downloadFolder = { real: r.real, root: bunny, cloud: /onedrive/i.test(r.real) };
    await places.save();
    return { real: r.real, root: bunny, cloud: st().downloadFolder.cloud };
  }
  async function clearDownloadFolder({ busy = false } = {}) { await places.load(); if (busy) throw new PlaceError('place.busy', MSG.busy); st().downloadFolder = null; await places.save(); }
  /** What isProtected must also refuse while the folder is set (LF-23): Bunny's own write tools never touch it. */
  const protectedPaths = () => (custom() ? [custom().root] : []);

  // ---------------------------------------------------------------- records (LF-17, LF-18)
  const records = () => st().downloads;
  async function record(id, real, sha256) { const k = await key(real); records()[id] = { real, ...k, sha256 }; await places.save(); return records()[id]; }
  const drop = async (id) => { delete records()[id]; await places.save(); };

  /**
   * LF-18: before every start. Same real path, file id, volume serial, size and mtime: fine. Anything else: hash it all against the pinned sha256; a match updates the record,
   * a mismatch refuses ("This file changed after Bunny downloaded it"). Missing: "Not found", never re-downloaded.
   */
  async function verify(id, entry) {
    await places.load();
    const rec = records()[id];
    if (!rec) return { state: 'none' };
    const info = await lstat(rec.real).catch(() => null);
    if (!info) return { state: 'notFound', message: MSG.notFound, real: rec.real };
    if (info.isSymbolicLink()) return { state: 'changed', message: MSG.changed, real: rec.real };
    let now; try { now = await rules.real(rec.real); } catch { return { state: 'notFound', message: MSG.notFound, real: rec.real }; }
    const k = await key(now);
    const same = now.toLowerCase() === rec.real.toLowerCase() && k.dev === rec.dev && k.ino === rec.ino && k.size === rec.size && k.mtimeMs === rec.mtimeMs && k.ctimeMs === rec.ctimeMs;
    if (same) return { state: 'ok', real: rec.real, record: rec };
    if (k.size !== Number(entry.size)) return { state: 'changed', message: MSG.changed, real: rec.real };
    if ((await hashFile(now)) !== entry.sha256) return { state: 'changed', message: MSG.changed, real: rec.real };
    return { state: 'ok', real: now, record: await record(id, now, entry.sha256) };
  }

  /** LF-17: delete only the recorded file, only if it still is that file; then empty folders up to the root, never a tree. */
  async function removeRecorded(id) {
    await places.load();
    const rec = records()[id];
    if (!rec) return { state: 'none' };
    const info = await lstat(rec.real).catch(() => null);
    if (!info) { await drop(id); return { state: 'gone', real: rec.real }; }
    if (info.isSymbolicLink()) return { state: 'left', real: rec.real };
    const k = await key(rec.real).catch(() => null);
    let nowReal = null; try { nowReal = await rules.real(rec.real); } catch { /* handled below */ }
    if (!k || !nowReal || nowReal.toLowerCase() !== rec.real.toLowerCase() || k.dev !== rec.dev || k.ino !== rec.ino) return { state: 'left', real: rec.real };
    await chmod(rec.real, 0o666).catch(() => {});
    await rm(rec.real, { force: true });
    await rm(`${rec.real}.part`, { force: true }).catch(() => {});
    await drop(id);
    await pruneEmpty(rec.real);
    return { state: 'removed', real: rec.real };
  }

  /** LF-24: "Remove Bunny local": every recorded download that still matches goes; changed files stay and are named; a missing drive is named and its records dropped. */
  async function removeAllRecorded() {
    await places.load();
    const out = { removed: 0, left: [], missing: [] };
    for (const id of Object.keys(records())) {
      const rec = records()[id]; const r = await removeRecorded(id);
      if (r.state === 'removed') out.removed += 1;
      else if (r.state === 'left') out.left.push({ id, folder: dirname(rec.real) });
      else if (r.state === 'gone') out.missing.push({ id, folder: dirname(rec.real) });
    }
    return out;
  }
  /** Where the recorded downloads are, and how much, for the second confirmation (LF-24). */
  async function whereDownloads() {
    await places.load();
    const by = new Map();
    for (const rec of Object.values(records())) { const f = rec.real.split('\\').slice(0, -3).join('\\') || dirname(rec.real); by.set(f, (by.get(f) ?? 0) + rec.size); }
    return [...by].map(([folder, bytes]) => ({ folder, bytes }));
  }

  // ---------------------------------------------------------------- Move (LF-21)
  /**
   * Move every recorded download into the current download folder. One model at a time: check the old copy (LF-18), copy to a .part with exclusive create, hash the copy against the PINNED sha256,
   * make the final name (a stranger there is adopted only if its sha equals the pin), write the new record, and only then delete the old file if it still matches its old record.
   * A failure or Cancel leaves that model, and every model after it, on its old copy and record.
   */
  async function move({ entries, signal, onProgress = () => {} }) {
    await places.load();
    const target = await root();
    const todo = [];
    for (const id of Object.keys(records())) {
      const entry = entries.find((e) => e.id === id); if (!entry) continue;
      const rec = records()[id];
      if (rec.real.toLowerCase().startsWith(target.toLowerCase() + '\\')) continue; // already there
      todo.push({ id, entry, rec });
    }
    const total = todo.reduce((n, t) => n + t.entry.size, 0);
    if (total > 0 && (await freeBytes(target)) < total + 2 * 1024 ** 3) throw new PlaceError('place.noSpace', `There isn't enough room on that drive. The move needs ${(total / 1024 ** 3).toFixed(1)} GB plus 2 GB free.`);
    const result = { moved: [], failed: [], untouched: [] };
    let doneBytes = 0;
    for (const t of todo) {
      if (signal?.aborted) { result.untouched.push(t.id); continue; }
      const v = await verify(t.id, t.entry);
      if (v.state !== 'ok') { result.failed.push({ id: t.id, reason: v.message ?? MSG.changed }); continue; }
      const dir = entryDir(target, t.entry); const finalPath = join(dir, t.entry.file); const part = `${finalPath}.part`;
      try {
        await mkdir(dir, { recursive: true });
        const realDir = await rules.real(dir);
        if (!isInside(realDir, target)) throw new PlaceError('place.badPath', 'The model would be saved outside its folder.');
        await copyExclusive(v.real, part, signal, (n) => onProgress({ id: t.id, done: doneBytes + n, total }));
        if ((await hashFile(part)) !== t.entry.sha256) { await rm(part, { force: true }); throw new PlaceError('place.hash', 'The copy does not match its fingerprint, so it was deleted. The model was not moved.'); }
        await finalize(part, finalPath, t.entry, hashFile);
        const old = records()[t.id];
        await record(t.id, await rules.real(finalPath), t.entry.sha256);
        await deleteIfStill(old, rules, key);
        doneBytes += t.entry.size;
        result.moved.push(t.id);
        await pruneEmpty(old.real);
      } catch (e) {
        await rm(part, { force: true }).catch(() => {});
        if (e?.code === 'place.aborted') { result.untouched.push(t.id); continue; }
        result.failed.push({ id: t.id, reason: e.message ?? 'The move failed.' });
      }
    }
    return result;
  }

  return { root, setDownloadFolder, clearDownloadFolder, protectedPaths, record, verify, drop, removeRecorded, removeAllRecorded, whereDownloads, move, custom, defaultRoot, records };
}

/** Copy with exclusive create (a file or link that is already there is never followed or overwritten). */
export async function copyExclusive(from, to, signal, onBytes = () => {}) {
  const out = await open(to, 'wx');
  let n = 0;
  try {
    await new Promise((resolve, reject) => {
      const rs = createReadStream(from);
      rs.on('data', (c) => { if (signal?.aborted) { rs.destroy(); reject(Object.assign(new Error('cancelled'), { code: 'place.aborted' })); return; } rs.pause(); out.write(c).then(() => { n += c.length; onBytes(n); rs.resume(); }, reject); });
      rs.on('end', resolve); rs.on('error', reject);
    });
  } finally { await out.close().catch(() => {}); }
}

/** LF-17: the final name is created without overwriting. A stranger already there is adopted only if its sha256 equals the pin. */
export async function finalize(part, finalPath, entry, hashFile = sha256File) {
  const there = await lstat(finalPath).catch(() => null);
  if (there) {
    if (there.isSymbolicLink() || !there.isFile()) throw new PlaceError('place.exists', 'A different file with this name is already there.');
    if ((await hashFile(finalPath)) !== entry.sha256) throw new PlaceError('place.exists', 'A different file with this name is already there.');
    await rm(part, { force: true }); // the one that is there is the right one
    return finalPath;
  }
  try { await link(part, finalPath); await rm(part, { force: true }); } catch (e) {
    if (e?.code === 'EEXIST') throw new PlaceError('place.exists', 'A different file with this name is already there.');
    const raced = await lstat(finalPath).catch(() => null); if (raced) throw new PlaceError('place.exists', 'A different file with this name is already there.');
    await rename(part, finalPath); // drives that cannot hard-link: rename after the check above
  }
  return finalPath;
}

async function deleteIfStill(rec, rules, key) {
  const info = await lstat(rec.real).catch(() => null);
  if (!info || info.isSymbolicLink()) return false;
  const k = await key(rec.real).catch(() => null);
  const real = await rules.real(rec.real).catch(() => null);
  if (!k || !real || real.toLowerCase() !== rec.real.toLowerCase() || k.dev !== rec.dev || k.ino !== rec.ino) return false; // it is not the file Bunny recorded: left alone
  await chmod(rec.real, 0o666).catch(() => {});
  await rm(rec.real, { force: true });
  return true;
}
export { stat as _stat };
