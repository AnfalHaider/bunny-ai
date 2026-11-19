/**
 * SEARCH-PC (SP-2): which paths on this computer Bunny may ever show, search or read. The fixed list below can be added to by the person, never shortened.
 *
 * A path is judged on its REAL path (junctions, links and 8.3 short names resolved), compared without regard to case and with trailing dots and spaces
 * taken off every part, and judged twice: on every search result before it is shown, and again just before a read or Open.
 */
import { realpath as realpathCallback } from 'node:fs';
import { open as openAsync } from 'node:fs/promises';
import { promisify } from 'node:util';

const realpathNative = promisify(realpathCallback.native);

/** Folder names refused wherever they are. */
export const EXCLUDED_FOLDER_NAMES = Object.freeze(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.git']);
/** A two-part folder refused wherever it is. */
export const EXCLUDED_FOLDER_PAIRS = Object.freeze([['.config', 'gh']]);
/** Folders under every drive's root. */
export const EXCLUDED_ROOT_FOLDERS = Object.freeze(['$recycle.bin', 'system volume information']);
/** File names (a * is any run of characters), wherever they are. */
export const EXCLUDED_FILE_PATTERNS = Object.freeze([
  '.env', '.env.*', '.npmrc', '.pypirc', '.netrc', '_netrc', '.git-credentials', 'credentials*',
  'id_rsa*', 'id_ed25519*', 'id_ecdsa*', 'id_dsa*',
  '*.pem', '*.key', '*.pfx', '*.p12', '*.ppk', '*.kdbx', '*.kdb', '*.keychain*', '*.ovpn',
  'wallet.dat', '*.wallet',
]);

/** What Settings shows, read-only. (The folders that depend on this PC are named by their role; the others as they are.) */
export const FIXED_EXCLUSIONS = Object.freeze({
  folders: Object.freeze([
    "Bunny's own data folder and Electron's", 'AppData (every browser profile and password manager)', 'ProgramData', 'Windows', 'Program Files and Program Files (x86)',
    'The recycle bin and System Volume Information', "Other people's user folders, Public and Default", ...EXCLUDED_FOLDER_NAMES.map((n) => `${n} folders`), '.config\\gh',
  ]),
  files: EXCLUDED_FILE_PATTERNS,
  places: Object.freeze(['Network drives and \\\\server paths']),
});

const BLOCKED_PATTERNS = EXCLUDED_FILE_PATTERNS.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));

/** The parts of a Windows path, lower case, each without trailing dots and spaces. */
export function partsOf(path) {
  return String(path).split(/[\\/]+/).filter((p) => p !== '').map((p) => p.replace(/[. ]+$/, '').toLowerCase());
}
const startsWith = (parts, prefix) => prefix.length > 0 && prefix.length <= parts.length && prefix.every((p, i) => parts[i] === p);

/**
 * @param {{
 *   dataDir?: string, electronData?: string, home?: string, users?: string, personal?: string[], env?: object,
 *   realpath?: (p: string) => Promise<string>, driveType?: (letter: string) => Promise<string|undefined>,
 * }} ctx
 */
export function createExclusions({ dataDir = '', electronData = '', home = '', users = '', personal = [], env = process.env, realpath = realpathNative, driveType = null } = {}) {
  const fixedRaw = [dataDir, electronData, env.APPDATA, env.LOCALAPPDATA, env.ProgramData, env.windir ?? env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  let fixedResolved = null;
  const resolveAll = async (list) => {
    const out = [];
    for (const p of list) {
      out.push(partsOf(p));
      try { out.push(partsOf(await realpath(p))); } catch { /* a folder that is not there */ }
    }
    return out.filter((x) => x.length);
  };
  const fixedFolders = async () => (fixedResolved ??= await resolveAll(fixedRaw));
  const homeParts = partsOf(home);
  const usersParts = partsOf(users || (homeParts.length ? homeParts.slice(0, -1).join('/') : ''));
  const ownName = homeParts.at(-1);
  const systemDrive = String(env.SystemDrive ?? 'C:').toUpperCase();

  async function isNetworkDrive(letter) {
    const l = `${letter.toUpperCase()}:`;
    let type;
    try { type = await driveType?.(l); } catch { type = undefined; }
    if (type === 'network') return true;
    if (type === 'local') return false;
    return l !== systemDrive; // A2: a drive whose type cannot be read is refused, except the system drive
  }

  /** @returns {Promise<{ ok: true, real: string } | { ok: false, reason: string }>} */
  async function allowedPath(path) {
    const text = String(path ?? '');
    if (/^[\\/]{2}/.test(text)) return { ok: false, reason: 'a network or device path' };
    const drive = /^([A-Za-z]):[\\/]/.exec(text);
    if (!drive) return { ok: false, reason: 'not a full path on a drive' };
    if (text.slice(2).includes(':')) return { ok: false, reason: 'an alternate data stream' };
    if (await isNetworkDrive(drive[1])) return { ok: false, reason: 'a network drive' };
    let real;
    try { real = await realpath(text); } catch { return { ok: false, reason: 'it cannot be resolved' }; }
    if (/^[\\/]{2}/.test(real) || /^[A-Za-z]:/.test(real) === false) return { ok: false, reason: 'a network or device path' };
    if (real.slice(2).includes(':')) return { ok: false, reason: 'an alternate data stream' };
    const verdict = await judge(real);
    return verdict ?? { ok: true, real };
  }

  /** The reason a resolved path is not allowed, or null. */
  async function judge(real) {
    const parts = partsOf(real);
    const folders = await fixedFolders();
    for (const f of folders) if (startsWith(parts, f)) return { ok: false, reason: 'Bunny or Windows keeps its own data here' };
    for (const f of personal) { const p = partsOf(f); if (startsWith(parts, p)) return { ok: false, reason: 'a folder you excluded' }; }
    if (parts.length >= 2 && EXCLUDED_ROOT_FOLDERS.includes(parts[1])) return { ok: false, reason: 'the recycle bin or a system folder' };
    if (usersParts.length && startsWith(parts, usersParts) && parts.length > usersParts.length) {
      const who = parts[usersParts.length];
      if (who !== ownName) return { ok: false, reason: "another person's folder" };
    }
    for (let i = 1; i < parts.length - 1; i += 1) {
      if (EXCLUDED_FOLDER_NAMES.includes(parts[i])) return { ok: false, reason: 'a folder that holds keys' };
      if (EXCLUDED_FOLDER_PAIRS.some(([a, b]) => parts[i] === a && parts[i + 1] === b)) return { ok: false, reason: 'a folder that holds keys' };
    }
    if (parts.length >= 2 && EXCLUDED_FOLDER_NAMES.includes(parts.at(-1))) return { ok: false, reason: 'a folder that holds keys' };
    const name = parts.at(-1) ?? '';
    if (BLOCKED_PATTERNS.some((re) => re.test(name))) return { ok: false, reason: 'a file that may hold a key or password' };
    return null;
  }

  /**
   * Read a file the checked way (SP-2): refuse a path that is not allowed; open it; look at its real path AGAIN (a junction swapped in between is caught);
   * read at most `maxBytes`. Returns { ok: true, buffer, real, size, partial } or { ok: false, reason }.
   */
  async function readAllowed(path, { maxBytes = 8 * 1024 * 1024 } = {}) {
    const first = await allowedPath(path);
    if (!first.ok) return first;
    let handle;
    try {
      handle = await openAsync(first.real, 'r');
      const again = await allowedPath(first.real);
      if (!again.ok || partsOf(again.real).join('/') !== partsOf(first.real).join('/')) return { ok: false, reason: 'the file changed while it was being opened' };
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return { ok: true, buffer: buffer.subarray(0, bytesRead), real: first.real, size, partial: size > maxBytes };
    } catch (err) {
      return { ok: false, reason: err?.code === 'EBUSY' || err?.code === 'EPERM' || err?.code === 'EACCES' ? 'the file is in use or not readable' : 'the file could not be read' };
    } finally { await handle?.close().catch(() => {}); }
  }

  /** A folder the person adds to the list: it must be a real folder, kept by its real path. */
  async function resolveFolder(path) {
    const text = String(path ?? '').trim();
    if (!/^[A-Za-z]:[\\/]/.test(text) || /^[\\/]{2}/.test(text)) return null;
    try { return await realpath(text); } catch { return null; }
  }

  return { allowedPath, readAllowed, resolveFolder, setPersonal: (list) => { personal = (list ?? []).filter((x) => typeof x === 'string'); } };
}

