/**
 * LOCAL-MODELS LF-2, LF-14, LF-15, LF-19, LF-22, LF-23: which folders and files Bunny will use for models it did not download, and where it will save the ones it did.
 * Everything is decided on the real path (`realpath.native`), taken when the person chooses and again before each use.
 * The PC is passed in (`realpath`, `lstat`, `driveType`, `knownFolders`, the environment), so tests use invented folders and never the real drives.
 */
import { lstat as fsLstat } from 'node:fs/promises';
import { realpath as realpathCb } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { win32 as wp } from 'node:path';
import { powershellPath } from './safeExec.js';

export class FolderError extends Error {
  constructor(code, message) { super(message); this.name = 'FolderError'; this.code = code; }
}
const refuse = (code, message) => { throw new FolderError(code, message); };

export const MESSAGES = Object.freeze({
  network: "Bunny only uses folders on this PC's own drives.",
  link: 'This folder is a link. Choose the folder it points to.',
  fileLink: 'This file is a link. Pick the file it points to.',
  system: "Bunny can't use a system folder.",
  data: "Bunny can't use its own data folder.",
  install: "Bunny can't use its own program folder.",
  root: "Bunny can't use a whole drive. Choose a folder on it.",
  profile: "Bunny can't use your whole user folder. Choose a folder inside it.",
  moved: 'This folder has moved. Choose it again.',
  overlap: 'This folder overlaps your download folder. Choose a separate folder.',
  removable: 'Pick a folder on a drive that stays in this PC.',
  place: 'Pick a folder only you use for models.',
  missing: 'Folder not found',
  tooMany: 'Bunny lists up to 20 folders.',
});

/** Case-insensitive Windows path helpers. */
const norm = (p) => wp.normalize(String(p)).replace(/[\\/]+$/, '').toLowerCase();
export const isInside = (child, parent) => { const c = norm(child); const p = norm(parent); return c === p || c.startsWith(`${p}\\`); };
const sameOrInside = isInside;
const drive = (p) => /^([A-Za-z]):\\/.exec(String(p))?.[1]?.toUpperCase() ?? null;

const psRun = (script) => new Promise((resolve) => {
  const ps = powershellPath();
  if (!ps) return resolve('');
  execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out)));
});
/** The type of a drive ("Fixed", "Removable", "Network", ...) from the main process; '' when it cannot be told. */
export async function windowsDriveType(letter) {
  if (!/^[A-Za-z]$/.test(letter)) return '';
  return (await psRun(`[System.IO.DriveInfo]::new('${letter}').DriveType`)).trim();
}
/** Where Windows keeps Desktop and Downloads for this person (they may have moved them). */
export async function windowsKnownFolders() {
  const out = await psRun("[Environment]::GetFolderPath('Desktop'); (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path");
  const [desktop, downloads] = out.split(/\r?\n/).map((s) => s.trim());
  return { desktop: desktop || null, downloads: downloads || null };
}
const realNative = (p) => new Promise((resolve, reject) => realpathCb.native(p, (e, r) => (e ? reject(e) : resolve(r))));

export function createFolderRules({
  dataDir, installDirs = [], home = homedir(), env = process.env, realpath = realNative, lstat = fsLstat,
  driveType = windowsDriveType, knownFolders = windowsKnownFolders, isProtected = () => false, projectFolders = () => [],
} = {}) {
  const systemFolders = () => [env.SystemRoot ?? env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData, env.APPDATA, env.LOCALAPPDATA, wp.join(home, 'AppData', 'LocalLow')].filter(Boolean);

  /** The real path of an existing file or folder. */
  async function real(path) {
    try { return await realpath(String(path)); } catch { return refuse('missing', MESSAGES.missing); }
  }
  /** Local drives only (LF-2, LF-14): a real path that starts with a drive letter, on a drive that is not a network drive. */
  async function local(realPath) {
    if (!/^[A-Za-z]:\\/.test(realPath)) refuse('network', MESSAGES.network); // \\server\share, \\?\..., \\.\...
    const type = await driveType(drive(realPath));
    if (type === 'Network') refuse('network', MESSAGES.network);
    return type;
  }
  const insideOrContains = (a, b) => isInside(a, b) || isInside(b, a);

  /** LF-2: a model file the person picked. Returns { real, lstat } or throws. */
  async function checkFile(path) {
    const raw = String(path ?? '');
    if (/^\\\\/.test(raw)) refuse('network', MESSAGES.network);
    let info; try { info = await lstat(raw); } catch { return refuse('missing', 'That file isn\'t there.'); }
    if (info.isSymbolicLink()) refuse('link', MESSAGES.fileLink);
    const r = await real(raw);
    await local(r);
    if (insideOrContains(r, dataDir) && isInside(r, dataDir)) refuse('data', MESSAGES.data);
    for (const d of installDirs) if (isInside(r, d)) refuse('install', MESSAGES.install);
    if (isProtected(r)) refuse('system', MESSAGES.system);
    return { real: r, info };
  }

  /** LF-14, LF-15: a folder (model folder or download folder). `download` adds the rules only a place Bunny writes needs. */
  async function checkFolder(path, { kind = 'model', models = [], download = null } = {}) {
    const raw = String(path ?? '');
    if (/^\\\\/.test(raw)) refuse('network', MESSAGES.network);
    if (kind === 'download') { // the download folder itself must not be a link (Bunny writes there); links in its parents are fine
      const info = await lstat(raw).catch(() => null);
      if (!info) refuse('missing', MESSAGES.missing);
      if (info.isSymbolicLink()) refuse('link', MESSAGES.link);
    }
    const r = await real(raw);
    const type = await local(r);
    if (/^[A-Za-z]:\\?$/.test(r)) refuse('root', MESSAGES.root);
    if (insideOrContains(r, dataDir)) refuse('data', MESSAGES.data);
    for (const d of installDirs) if (insideOrContains(r, d)) refuse('install', MESSAGES.install);
    if (norm(r) === norm(home) || isInside(home, r)) refuse('profile', MESSAGES.profile); // the profile folder itself, C:\Users, anything that contains it
    for (const s of systemFolders()) if (insideOrContains(r, s)) refuse('system', MESSAGES.system);
    if (norm(r).split('\\').some((seg) => seg === '$recycle.bin' || seg === 'system volume information' || seg === '.git')) refuse('system', MESSAGES.system);
    if (isProtected(r)) refuse('system', MESSAGES.system);
    if (kind === 'download') {
      if (type === 'Removable') refuse('removable', MESSAGES.removable); // LF-22
      const known = await knownFolders();
      for (const p of [known?.desktop, known?.downloads, wp.join(home, 'Downloads'), wp.join(home, 'Desktop')].filter(Boolean)) if (isInside(r, p)) refuse('place', MESSAGES.place); // LF-23
      for (const p of projectFolders()) if (insideOrContains(r, p)) refuse('place', MESSAGES.place);
      for (const m of models) if (insideOrContains(r, m)) refuse('overlap', MESSAGES.overlap); // LF-19
    } else if (download && insideOrContains(r, download)) refuse('overlap', MESSAGES.overlap);
    return { real: r, type };
  }

  /** Before each use of a stored folder: the real path must still be the stored one (LF-14). */
  async function stillThere(stored, { kind = 'model' } = {}) {
    let now; try { now = await realpath(stored.real); } catch { return { ok: false, reason: 'missing', message: MESSAGES.missing }; }
    if (norm(now) !== norm(stored.real)) return { ok: false, reason: 'moved', message: MESSAGES.moved };
    if (kind === 'download') { const info = await lstat(stored.real).catch(() => null); if (info?.isSymbolicLink()) return { ok: false, reason: 'link', message: MESSAGES.link }; }
    return { ok: true };
  }

  return { real, local, checkFile, checkFolder, stillThere, isInside, drive };
}

export { sameOrInside };
