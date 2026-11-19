/**
 * CLI-ENGINES §4 (CE-5): downloading, verifying, unpacking, switching and rolling back an engine, and the record of what was done.
 *
 *   <data>\engines\<id>\<version>\...        one folder per downloaded version
 *   <data>\engines\<id>\current.json         { version, sha256 }  which version runs (sha256 is the entry program's)
 *   <data>\engines\<id>\previous.json        the version before (rollback)
 *   <data>\engines\record.json               what was done: download, update, switch, rollback, remove (CE-7), 500 entries at most
 *
 * Every byte that runs is hash-pinned: the download is refused unless every file's sha256 equals the pin's. Over HTTPS only; a redirect must stay on the
 * pin's own host list (GitHub's release downloads go to a second host, so it is on the list). The archive is unpacked with unpack.js (no path outside the folder,
 * no links, no alternate streams, 2 GB at most). The program must then print the pinned version and carry the vendor's signature. Nothing here asks for elevation.
 * A failed step removes its staging folder. The engines' own self-update is off elsewhere (adapters); only this flow changes what runs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { powershellPath, safeEnv } from '../safeExec.js';
import { removeTree } from '../toolInstall.js';
import { MAX_TOTAL_BYTES, UnpackError, folderBytes, safeEntryPath, unpackTgz, unpackZip } from './unpack.js';

export const ENGINES_DIR = 'engines';
export const RECORD_MAX = 500;
const MAX_REDIRECTS = 5;
const VERSION_TIMEOUT_MS = 10_000;

/** A failure with a sentence to show the person as it is. */
export class EngineStoreError extends Error {
  constructor(message, code = 'engine.store') { super(message); this.name = 'EngineStoreError'; this.code = code; }
}

const hex = (buf) => Buffer.from(buf).toString('hex');
export const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

/** Fetch one pinned URL over HTTPS with the redirects checked hop by hop against the pin's host list. Returns the final Response (body not read). */
export async function fetchPinned(url, hosts, { fetchImpl = globalThis.fetch, signal } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let u;
    try { u = new URL(current); } catch { throw new EngineStoreError('The download address is not valid.', 'engine.url'); }
    if (u.protocol !== 'https:') throw new EngineStoreError('The download is not over HTTPS: stopped.', 'engine.https');
    if (!hosts.includes(u.hostname)) throw new EngineStoreError(`The download went to ${u.hostname}, which is not one of this engine's download sites: stopped.`, 'engine.host');
    const res = await fetchImpl(u.toString(), { redirect: 'manual', signal, headers: { 'user-agent': 'BunnyAI-engine-download', accept: 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = res.headers.get('location');
      if (!next) throw new EngineStoreError('The download site sent a redirect with nowhere to go.', 'engine.redirect');
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      current = new URL(next, u).toString();
      continue;
    }
    if (!res.ok) throw new EngineStoreError(`The download failed (the site answered ${res.status}).`, 'engine.http');
    return res;
  }
  throw new EngineStoreError('The download was redirected too many times: stopped.', 'engine.redirect');
}

/** Download one file to `dest`, hashing as it goes. Returns { sha256, bytes }. Stops over `limit` bytes. */
export async function downloadTo(url, hosts, dest, { fetchImpl, signal, onProgress, limit = MAX_TOTAL_BYTES } = {}) {
  const res = await fetchPinned(url, hosts, { fetchImpl, signal });
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > limit) throw new EngineStoreError('The download is bigger than expected: stopped.', 'engine.size');
  const h = createHash('sha256');
  let bytes = 0;
  const source = Readable.fromWeb ? Readable.fromWeb(res.body) : Readable.from(res.body);
  source.on('data', (c) => {
    bytes += c.length; h.update(c);
    if (bytes > limit) source.destroy(new EngineStoreError('The download is bigger than expected: stopped.', 'engine.size'));
    onProgress?.({ bytes, total });
  });
  await pipeline(source, createWriteStream(dest, { flags: 'wx' }), signal ? { signal } : {});
  return { sha256: h.digest('hex'), bytes };
}

/** The vendor's signature on a program (Windows). `subject` is a part of the signer's name. Resolves { ok, signer }. */
export function verifyAuthenticode(file, subject) {
  return new Promise((resolve) => {
    const ps = powershellPath();
    if (!ps) return resolve({ ok: true, signer: 'not checked (not Windows)' });
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', '$s = Get-AuthenticodeSignature -LiteralPath $env:BUNNY_CHECK_FILE; Write-Output ($s.Status.ToString() + "|" + $s.SignerCertificate.Subject)'],
      { env: safeEnv({ BUNNY_CHECK_FILE: file }), windowsHide: true, timeout: 60_000 }, (err, stdout) => {
        if (err) return resolve({ ok: false, signer: 'could not be checked' });
        const [status, signer = ''] = String(stdout).trim().split('|');
        resolve({ ok: status === 'Valid' && signer.includes(subject), signer: signer.slice(0, 120) });
      });
  });
}

/** Run the program with --version (no network is asked for; a 10 s limit) and return what it printed. */
export function runVersion(file) {
  return new Promise((resolve, reject) => {
    execFile(file, ['--version'], { env: safeEnv(), windowsHide: true, timeout: VERSION_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) return reject(new EngineStoreError('The engine did not start to print its version.', 'engine.version'));
      resolve(String(stdout || stderr).trim());
    });
  });
}

const atomicWrite = async (file, text) => { const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`; await writeFile(tmp, text); await rename(tmp, file); };
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

/**
 * The store. `pins` is { <id>: { version, entry, hosts, signature, files: [{ url, sha256, kind: 'zip'|'tgz', strip? }] } }.
 * `deps` lets tests replace the network, the version run and the signature check.
 */
export function createEngineStore({ dataDir, pins, fetchImpl = globalThis.fetch, versionOf = runVersion, signatureOf = verifyAuthenticode, busy = () => false, now = () => new Date() } = {}) {
  const root = join(dataDir, ENGINES_DIR);
  const dirOf = (id) => join(root, id);
  const recordFile = join(root, 'record.json');
  const active = new Map(); // id -> AbortController while a download runs
  const hashCache = new Map(); // exe path -> { size, mtimeMs, sha256 }

  const pinOf = (id) => { const p = pins?.[id]; if (!p) throw new EngineStoreError('Bunny does not know that engine.', 'engine.unknown'); return p; };

  async function addRecord(entry) {
    await mkdir(root, { recursive: true });
    const list = await readJson(recordFile, []);
    list.unshift({ at: now().toISOString(), who: 'window', ...entry });
    await atomicWrite(recordFile, JSON.stringify(list.slice(0, RECORD_MAX), null, 1));
  }

  async function exeSha(exe) {
    const info = await stat(exe);
    const hit = hashCache.get(exe);
    if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.sha256;
    const sha256 = await sha256File(exe);
    hashCache.set(exe, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
    return sha256;
  }

  /** Which version runs, checked on disk: { ok, id, version, exe, sha256 } or { ok: false, reason, canRollBack }. */
  async function locate(id) {
    const pin = pinOf(id);
    const current = await readJson(join(dirOf(id), 'current.json'), null);
    const previous = await readJson(join(dirOf(id), 'previous.json'), null);
    if (!current?.version) return { ok: false, reason: 'not-downloaded', canRollBack: false };
    const exe = join(dirOf(id), current.version, pin.entry);
    if (!existsSync(exe)) return { ok: false, reason: 'missing', canRollBack: Boolean(previous) };
    let sha256;
    try { sha256 = await exeSha(exe); } catch { return { ok: false, reason: 'unreadable', canRollBack: Boolean(previous) }; }
    if (current.sha256 && sha256 !== current.sha256) return { ok: false, reason: 'changed', canRollBack: Boolean(previous) };
    return { ok: true, id, version: current.version, exe, sha256, dir: join(dirOf(id), current.version) };
  }

  async function status() {
    const out = {};
    for (const id of Object.keys(pins)) {
      const pin = pins[id];
      const current = await readJson(join(dirOf(id), 'current.json'), null);
      const previous = await readJson(join(dirOf(id), 'previous.json'), null);
      out[id] = {
        id, downloaded: Boolean(current?.version), version: current?.version ?? null, available: pin.version, updateAvailable: Boolean(current?.version) && current.version !== pin.version,
        previous: previous?.version ?? null, sizeBytes: current?.version || previous?.version ? await folderBytes(dirOf(id)) : 0, downloading: active.has(id),
      };
    }
    return out;
  }

  /** Download (or update to) the pinned version. Resolves { ok: true, version }. Throws EngineStoreError with a plain sentence; the staging folder is gone either way. */
  async function download(id, { signal: outer, onProgress } = {}) {
    const pin = pinOf(id);
    if (active.has(id)) throw new EngineStoreError('That engine is already downloading.', 'engine.busy');
    if (busy(id)) throw new EngineStoreError('An answer is still running on that engine: the update waits until it is done.', 'engine.inUse');
    const control = new AbortController();
    outer?.addEventListener?.('abort', () => control.abort(), { once: true });
    active.set(id, control);
    await mkdir(dirOf(id), { recursive: true });
    const staging = join(dirOf(id), `.staging-${randomBytes(4).toString('hex')}`);
    try {
      await mkdir(staging, { recursive: true });
      const unpacked = join(staging, 'files');
      await mkdir(unpacked, { recursive: true });
      let done = 0;
      for (const file of pin.files) {
        const archive = join(staging, `dl-${done}.bin`);
        const got = await downloadTo(file.url, pin.hosts, archive, { fetchImpl, signal: control.signal, onProgress: (p) => onProgress?.({ file: done + 1, files: pin.files.length, ...p }) });
        if (got.sha256 !== String(file.sha256).toLowerCase()) throw new EngineStoreError(`The download of ${id} does not match its pinned fingerprint: it was not installed.`, 'engine.hash');
        try {
          if (file.kind === 'zip') await unpackZip(archive, unpacked, { strip: file.strip ?? '' });
          else if (file.kind === 'tgz') await unpackTgz(archive, unpacked, { strip: file.strip ?? '' });
          else await rename(archive, join(unpacked, safeEntryPath(file.name ?? 'file.bin'))); // kind 'file': one program as it is
        } catch (err) {
          if (err instanceof UnpackError) throw new EngineStoreError(`${err.message} Nothing was installed.`, 'engine.unpack');
          throw err;
        }
        await unlink(archive).catch(() => {});
        done += 1;
      }
      const exe = join(unpacked, pin.entry);
      if (!existsSync(exe)) throw new EngineStoreError('The download did not hold the engine program: it was not installed.', 'engine.entry');
      const sig = await signatureOf(exe, pin.signature);
      if (!sig.ok) throw new EngineStoreError(`The engine program is not signed by ${pin.signature}: it was not installed.`, 'engine.signature');
      let printed;
      try { printed = await versionOf(exe); } catch (err) { throw err instanceof EngineStoreError ? err : new EngineStoreError('The engine did not start to print its version: it was not installed.', 'engine.version'); }
      if (!String(printed).includes(pin.version)) throw new EngineStoreError(`The engine says it is ${String(printed).slice(0, 40)}, not ${pin.version}: it was not installed.`, 'engine.version');
      const sha256 = await sha256File(exe);
      // switch: the new folder first, then the pointer (an atomic write), then the old ones are tidied
      const before = await readJson(join(dirOf(id), 'current.json'), null);
      const target = join(dirOf(id), pin.version);
      await removeTree(target).catch(() => {});
      await rename(unpacked, target);
      await removeTree(staging).catch(() => {});
      if (before?.version && before.version !== pin.version) await atomicWrite(join(dirOf(id), 'previous.json'), JSON.stringify(before));
      await atomicWrite(join(dirOf(id), 'current.json'), JSON.stringify({ version: pin.version, sha256, at: now().toISOString() }));
      const prev = await readJson(join(dirOf(id), 'previous.json'), null);
      for (const name of await readdir(dirOf(id))) {
        if (/^\d/.test(name) && name !== pin.version && name !== prev?.version) await removeTree(join(dirOf(id), name)).catch(() => {});
      }
      await addRecord({ engine: id, action: before?.version ? 'update' : 'download', from: before?.version ?? null, to: pin.version, sha12: sha256.slice(0, 12) });
      return { ok: true, version: pin.version, sha256 };
    } catch (err) {
      await removeTree(staging).catch(() => {});
      if (control.signal.aborted) throw new EngineStoreError('The download was cancelled.', 'engine.cancelled');
      throw err;
    } finally { active.delete(id); }
  }

  function cancel(id) { active.get(id)?.abort(); return active.has(id); }

  /** Switch back to the previous version. */
  async function rollback(id) {
    pinOf(id);
    if (busy(id)) throw new EngineStoreError('An answer is still running on that engine: the switch waits until it is done.', 'engine.inUse');
    const current = await readJson(join(dirOf(id), 'current.json'), null);
    const previous = await readJson(join(dirOf(id), 'previous.json'), null);
    if (!previous?.version || !existsSync(join(dirOf(id), previous.version))) throw new EngineStoreError('There is no earlier version to go back to.', 'engine.noPrevious');
    await atomicWrite(join(dirOf(id), 'current.json'), JSON.stringify({ version: previous.version, sha256: previous.sha256, at: now().toISOString() }));
    if (current?.version) await atomicWrite(join(dirOf(id), 'previous.json'), JSON.stringify(current)); else await unlink(join(dirOf(id), 'previous.json')).catch(() => {});
    await addRecord({ engine: id, action: 'rollback', from: current?.version ?? null, to: previous.version, sha12: String(previous.sha256 ?? '').slice(0, 12) });
    return { ok: true, version: previous.version };
  }

  /** Delete every version, home and staged copy of one engine. */
  async function remove(id) {
    pinOf(id);
    if (busy(id)) throw new EngineStoreError('An answer is still running on that engine: it can be removed after that.', 'engine.inUse');
    cancel(id);
    const current = await readJson(join(dirOf(id), 'current.json'), null);
    await removeTree(dirOf(id));
    await addRecord({ engine: id, action: 'remove', from: current?.version ?? null, to: null, sha12: String(current?.sha256 ?? '').slice(0, 12) });
    return { ok: true };
  }

  const record = async () => readJson(recordFile, []);
  return { root, status, download, cancel, rollback, remove, locate, record, addRecord };
}

export { MAX_TOTAL_BYTES, hex };
