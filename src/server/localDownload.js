/**
 * LOCAL-MODELS LM-5d: Bunny's own downloader for curated GGUF model files from Hugging Face.
 *
 *   https://huggingface.co/<repo>/resolve/<revision>/<file>     (revision = a 40-hex commit, never a branch; `-hf` is never used)
 *
 * Rules, each one tested (test/local-download.test.js, Security's LM-14 item 10):
 *  - only a `.gguf` file, from a repo that is not gated, under a path Bunny builds itself (every part ^[A-Za-z0-9._-]{1,128}$, no link at the target);
 *  - https only, and every redirect hop must be on the host list that spike S-LM3 recorded (constants below, filled from the live redirect, never a wildcard);
 *  - three-way agreement: X-Linked-Size = the pinned size, X-Linked-ETag = the pinned sha256, and the hash computed while streaming = the pinned sha256;
 *  - written as `<file>.part` with a sidecar of bytes done; a resume re-hashes what is on disk first and continues with Range; Cancel removes the .part;
 *  - one download at a time (the caller's job); 429 waits for RateLimit-Reset and retries at most 3 times; at least size + 2 GB free before it starts;
 *  - the finished file is read-only, with a manifest beside it (sha256, size, the time it was verified).
 *
 * The network, the clock and the disk's free space are passed in (`fetchImpl`, `sleep`, `freeBytes`), so tests use stand-in hosts. Nothing here talks to a real host.
 */
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Hosts a model download may touch. S-LM3 records the real CDN hosts from a live redirect; until then only the origin is listed. */
export const MODEL_HOSTS = Object.freeze(['huggingface.co']);
export const FREE_SPACE_MARGIN = 2 * 1024 ** 3;
export const MAX_REDIRECTS = 5;
export const MAX_429_RETRIES = 3;
const PART = /^[A-Za-z0-9._-]{1,128}$/;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class DownloadError extends Error {
  constructor(code, message) { super(message); this.name = 'DownloadError'; this.code = code; }
}

/** The folder a model's file lives in, built by Bunny: <dataDir>/models/<owner>__<repo>/<revision>. Throws on any part that is not plain. */
export function modelDir(dataDir, entry) {
  const [owner, repo, ...extra] = String(entry.repo ?? '').split('/');
  if (!owner || !repo || extra.length) throw new DownloadError('local.badName', 'That model has no usable repository name.');
  for (const part of [owner, repo, entry.revision, entry.file]) {
    if (!PART.test(String(part)) || part === '.' || part === '..') throw new DownloadError('local.badName', 'That model has a name Bunny will not use as a file name.');
  }
  return join(dataDir, 'models', `${owner}__${repo}`, entry.revision);
}

/** Checks a curated entry before anything is fetched. */
export function checkEntry(entry) {
  if (entry.gated !== false) throw new DownloadError('local.gated', 'That model needs a Hugging Face account, which Bunny does not use.');
  if (!/\.gguf$/i.test(String(entry.file ?? ''))) throw new DownloadError('local.notGguf', 'Bunny downloads only .gguf model files.');
  if (!REVISION.test(String(entry.revision ?? ''))) throw new DownloadError('local.badRevision', 'That model is not pinned to a fixed version.');
  if (!SHA256.test(String(entry.sha256 ?? '')) || !(Number(entry.size) > 0)) throw new DownloadError('local.noPin', 'That model has no size or fingerprint on file.');
  return entry;
}

export const urlFor = (entry) => `https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${entry.file}`;

const hostAllowed = (u, hosts) => u.protocol === 'https:' && !u.username && !u.password && hosts.includes(u.hostname.toLowerCase());

async function hashFile(path, hash) {
  await new Promise((done, fail) => { const s = createReadStream(path); s.on('data', (c) => hash.update(c)); s.on('end', done); s.on('error', fail); });
}

/** A path that is not a link, under `root` by real path. */
async function assertPlainTarget(root, path) {
  const real = await realpath(root).catch(() => resolve(root));
  const full = resolve(path);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) throw new DownloadError('local.badPath', 'The model would be saved outside its folder.');
  const info = await lstat(full).catch(() => null);
  if (info?.isSymbolicLink()) throw new DownloadError('local.link', 'A link is in the way of that model file, so Bunny will not write it.');
  return real;
}

/**
 * Download one curated model.
 * @param {object} o
 * @param {string} o.dataDir
 * @param {object} o.entry         a localModels.json entry
 * @param {(url:string, init:{headers:object, signal?:AbortSignal})=>Promise<{status:number, headers:object, body:AsyncIterable<Buffer>}>} o.fetchImpl  one request, redirects NOT followed; header names lowercase
 * @param {()=>Promise<number>} [o.freeBytes]
 * @param {(ms:number)=>Promise<void>} [o.sleep]
 * @param {(p:{done:number,total:number})=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]   Cancel
 * @param {string[]} [o.hosts]
 * @returns {Promise<{path:string, manifest:object}>}
 */
export async function downloadModel({ dataDir, entry, fetchImpl, freeBytes = async () => Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress = () => {}, signal, hosts = MODEL_HOSTS }) {
  checkEntry(entry);
  const dir = modelDir(dataDir, entry);
  const finalPath = join(dir, entry.file);
  const partPath = `${finalPath}.part`;
  const sidePath = `${finalPath}.part.json`;
  await mkdir(dir, { recursive: true });
  await assertPlainTarget(join(dataDir, 'models'), finalPath);
  if ((await freeBytes()) < Number(entry.size) + FREE_SPACE_MARGIN) throw new DownloadError('local.noSpace', 'There is not enough free space on this drive for that model.');

  const cancelled = () => signal?.aborted;
  const cancel = async () => { await rm(partPath, { force: true }); await rm(sidePath, { force: true }); throw new DownloadError('local.cancelled', 'The download was cancelled.'); };

  // resume: the bytes already on disk are hashed again first (a resumed file is hashed whole)
  const hash = createHash('sha256');
  let have = 0;
  const side = await readFile(sidePath, 'utf8').then(JSON.parse, () => null);
  const partInfo = await stat(partPath).catch(() => null);
  if (partInfo && side && side.bytes === partInfo.size && partInfo.size < Number(entry.size)) { await hashFile(partPath, hash); have = partInfo.size; }
  else { await rm(partPath, { force: true }); await rm(sidePath, { force: true }); }

  let retries = 0;
  for (;;) {
    if (cancelled()) await cancel();
    let url = new URL(urlFor(entry));
    let res;
    for (let hop = 0; ; hop += 1) {
      if (!hostAllowed(url, hosts)) throw new DownloadError('local.host', 'That download led to a website Bunny does not use for models, so it was stopped.');
      res = await fetchImpl(url.href, { headers: have ? { range: `bytes=${have}-` } : {}, signal });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (hop >= MAX_REDIRECTS || !res.headers.location) throw new DownloadError('local.redirects', 'The download was passed around too many times.');
        // the pin's own headers are on the first answer from the origin; a later hop is the CDN
        if (hop === 0) checkLinked(res.headers, entry);
        url = new URL(res.headers.location, url);
        continue;
      }
      break;
    }
    if (res.status === 429) {
      if ((retries += 1) > MAX_429_RETRIES) throw new DownloadError('local.rateLimited', 'Hugging Face asked Bunny to wait. Try again in a few minutes.');
      await sleep(Math.min(Math.max(Number(res.headers['ratelimit-reset']) || 5, 1), 300) * 1000);
      continue;
    }
    if (res.status !== 200 && res.status !== 206) throw new DownloadError('local.http', `Hugging Face answered ${res.status}.`);
    if (have && res.status !== 206) { await rm(partPath, { force: true }); await rm(sidePath, { force: true }); throw new DownloadError('local.resume', 'The download could not be resumed. Start it again.'); }

    const out = await open(partPath, have ? 'a' : 'w');
    let done = have;
    try {
      for await (const chunk of res.body) {
        if (cancelled()) { await out.close(); await cancel(); }
        done += chunk.length;
        if (done > Number(entry.size)) { await out.close(); await rm(partPath, { force: true }); await rm(sidePath, { force: true }); throw new DownloadError('local.tooBig', 'The file is larger than expected, so it was thrown away.'); }
        hash.update(chunk);
        await out.write(chunk);
        onProgress({ done, total: Number(entry.size) });
        await writeFile(sidePath, JSON.stringify({ bytes: done }));
      }
    } finally { await out.close().catch(() => {}); }

    if (done !== Number(entry.size)) { await writeFile(sidePath, JSON.stringify({ bytes: done })); throw new DownloadError('local.short', 'The download stopped early. Start it again to carry on.'); }
    const sum = hash.digest('hex');
    if (sum !== entry.sha256) { await rm(partPath, { force: true }); await rm(sidePath, { force: true }); throw new DownloadError('local.hash', 'The downloaded file does not match its fingerprint, so it was deleted.'); }
    await assertPlainTarget(join(dataDir, 'models'), finalPath);
    await rename(partPath, finalPath);
    await rm(sidePath, { force: true });
    await chmod(finalPath, 0o444); // read-only: the runtime reads it and never writes it
    const manifest = { sha256: sum, size: done, verifiedAt: new Date().toISOString(), repo: entry.repo, revision: entry.revision, file: entry.file };
    await writeFile(`${finalPath}.manifest.json`, JSON.stringify(manifest, null, 2));
    return { path: finalPath, manifest };
  }
}

/** The origin's own headers must agree with the pin: nothing is downloaded if they do not (and the pin is never followed to a new value). */
export function checkLinked(headers, entry) {
  const size = headers['x-linked-size'];
  const etag = String(headers['x-linked-etag'] ?? '').replace(/^W\//, '').replace(/"/g, '');
  if ((size !== undefined && Number(size) !== Number(entry.size)) || (etag && etag !== entry.sha256)) {
    throw new DownloadError('local.changed', 'This model changed on Hugging Face. Bunny will offer it again after an update.');
  }
}

/** Delete a model: its folder goes, links refused, nothing outside the models folder is touched. */
export async function deleteModel({ dataDir, entry }) {
  const dir = modelDir(dataDir, entry);
  const models = resolve(dataDir, 'models');
  const real = await realpath(dir).catch(() => null);
  if (!real) return false;
  const realModels = await realpath(models);
  if (!real.startsWith(realModels + sep)) throw new DownloadError('local.badPath', 'That folder is not inside the models folder, so Bunny will not delete it.');
  if ((await lstat(dir)).isSymbolicLink()) throw new DownloadError('local.link', 'That folder is a link, so Bunny will not delete it.');
  await rm(dir, { recursive: true, force: true });
  return true;
}
