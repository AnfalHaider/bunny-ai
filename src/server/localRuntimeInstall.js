/**
 * LOCAL-MODELS LM-5a and Security's SP-1, SP-2, SP-4: installing the model runtime (llama.cpp's llama-server) from the pinned zip, and checking it again before every start.
 *
 *  - HTTPS only; the hosts are the constants of runtimePins.json (GitHub's own three); every hop is public-only (download.js fetchHop); the size is capped at the pin;
 *    the sha256 is computed while streaming and must equal the pin before anything is unpacked.
 *  - Unpacking is by two exact lists per backend: `allow` (written, and hashed into the manifest) and `skip` (exactly ggml-rpc-server.exe and ggml-rpc.dll: left in the zip, never written).
 *    An entry on neither list fails the WHOLE unpack before a single file is written.
 *  - A manifest {file: sha256, size} is written at install and re-checked before EVERY start; a file that changed, a file that is gone, and a file nobody listed (the skipped RPC files
 *    appearing later too) all mean "the program changed on disk".
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchHop } from './download.js';
import { UnpackError, readZipDirectory, safeEntryPath, unpackZip } from './engines/unpack.js';

export const MAX_REDIRECTS = 5;
export const MANIFEST = 'bunny-manifest.json';

export class RuntimeError extends Error {
  constructor(code, message) { super(message); this.name = 'RuntimeError'; this.code = code; }
}

export function loadRuntimePins(file = fileURLToPath(new URL('./runtimePins.json', import.meta.url))) {
  return JSON.parse(readFileSync(file, 'utf8')).runtimes;
}

/** Problems with the pins (empty = fine). `forShip` adds the lists that must be exact before a release (the zip's entry names, from a real listing). */
export function checkRuntimePins(pins, { forShip = false } = {}) {
  const problems = [];
  const p = pins?.['llama-server'];
  if (!p) return ['no runtime is pinned'];
  const say = (m) => problems.push(`llama-server: ${m}`);
  if (!/^b\d{3,6}$/.test(String(p.tag))) say('no exact b tag');
  if (p.licence !== 'MIT') say('licence is not MIT');
  if (!p.entry) say('no entry program');
  if (!Array.isArray(p.hosts) || !p.hosts.length) say('no download hosts');
  if (JSON.stringify([...(p.skip ?? [])].sort()) !== JSON.stringify(['ggml-rpc-server.exe', 'ggml-rpc.dll'])) say('the skip list must be exactly ggml-rpc-server.exe and ggml-rpc.dll');
  for (const [backend, f] of Object.entries(p.files ?? {})) {
    const at = `${backend}`;
    let u = null; try { u = new URL(f.url); } catch { say(`${at}: bad url`); }
    if (u && u.protocol !== 'https:') say(`${at}: not https`);
    if (u && !p.hosts.includes(u.hostname)) say(`${at}: ${u.hostname} is not on the host list`);
    if (u && !u.pathname.includes(`/${p.tag}/`)) say(`${at}: the address is not the pinned tag`);
    if (!/^[a-f0-9]{64}$/.test(String(f.sha256))) say(`${at}: no sha256`);
    if (!(Number(f.size) > 0)) say(`${at}: no size`);
    if (f.kind !== 'zip') say(`${at}: not a zip`);
    if (!Array.isArray(f.allow) || !f.allow.includes(p.entry)) say(`${at}: the allow list does not hold ${p.entry}`);
    for (const name of f.allow ?? []) if ((p.skip ?? []).includes(name)) say(`${at}: ${name} is on both lists`);
    if (forShip && f.allowComplete !== true) say(`${at}: the allow list is not complete (it needs the zip's real entry names)`);
  }
  return problems;
}

const hostOk = (hosts, u) => u.protocol === 'https:' && !u.username && !u.password && hosts.includes(u.hostname.toLowerCase());

async function sha256File(file) {
  const h = createHash('sha256');
  await new Promise((done, fail) => { const s = createReadStream(file); s.on('data', (c) => h.update(c)); s.on('end', done); s.on('error', fail); });
  return h.digest('hex');
}

/** Download the pinned zip to `dest`: pinned hosts at every hop, public addresses only, the size cap, the sha256 while streaming. */
export async function downloadRuntimeZip({ pins, backend, dest, fetchImpl = fetchHop, signal, onProgress = () => {} }) {
  const p = pins['llama-server'];
  const f = p.files[backend];
  if (!f) throw new RuntimeError('runtime.backend', 'That program build is not on the list.');
  await mkdir(join(dest, '..'), { recursive: true });
  let url = new URL(f.url);
  let res;
  for (let hop = 0; ; hop += 1) {
    if (!hostOk(p.hosts, url)) throw new RuntimeError('runtime.host', 'That download led to a website Bunny does not use for this program, so it was stopped.');
    res = await fetchImpl(url.href, { signal });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (hop >= MAX_REDIRECTS || !res.headers.location) throw new RuntimeError('runtime.redirects', 'The download was passed around too many times.');
      url = new URL(res.headers.location, url);
      continue;
    }
    break;
  }
  if (res.status !== 200) throw new RuntimeError('runtime.http', `GitHub answered ${res.status}.`);
  const hash = createHash('sha256');
  const out = await open(dest, 'w');
  let done = 0;
  try {
    for await (const chunk of res.body) {
      if (signal?.aborted) throw new RuntimeError('runtime.cancelled', 'The set-up was cancelled.');
      done += chunk.length;
      if (done > Number(f.size)) throw new RuntimeError('runtime.tooBig', 'The program file is larger than expected, so it was thrown away.');
      hash.update(chunk);
      await out.write(chunk);
      onProgress({ done, total: Number(f.size) });
    }
  } catch (err) { await out.close().catch(() => {}); await rm(dest, { force: true }); throw err; }
  await out.close();
  if (done !== Number(f.size) || hash.digest('hex') !== f.sha256) { await rm(dest, { force: true }); throw new RuntimeError('runtime.hash', 'The downloaded program does not match its fingerprint, so it was deleted.'); }
  return { path: dest, size: done };
}

/** Which entries of the zip are written, which are left alone; throws (before anything is written) for an entry on neither list. */
export function classifyEntries(entries, { allow, skip }) {
  const toWrite = []; const left = [];
  for (const e of entries) {
    const rel = safeEntryPath(e.name);
    if (!rel || e.isDir) continue;
    if (rel.includes('/')) throw new UnpackError(`The program archive has a file in a folder ("${rel.slice(0, 60)}"), which is not on the list.`);
    if (skip.includes(rel)) { left.push(rel); continue; }
    if (!allow.includes(rel)) throw new UnpackError(`The program archive has a file that is not on the list ("${rel.slice(0, 60)}"), so nothing was unpacked.`);
    toWrite.push(rel);
  }
  const missing = allow.filter((n) => !toWrite.includes(n));
  if (missing.length) throw new UnpackError(`The program archive is missing ${missing.slice(0, 3).join(', ')}, so nothing was unpacked.`);
  return { toWrite, left };
}

/** Unpack the checked zip into `dir` (a new folder), write the manifest, and return it. On any failure the folder is removed. */
export async function installFromZip({ zip, dir, pins, backend }) {
  const p = pins['llama-server'];
  const f = p.files[backend];
  const staging = `${dir}.tmp-${Date.now()}`;
  try {
    const entries = await readZipDirectory(zip);
    const { toWrite, left } = classifyEntries(entries, { allow: f.allow, skip: p.skip });
    await mkdir(staging, { recursive: true });
    const keep = new Set(toWrite);
    await unpackZip(zip, staging, { skip: (rel) => !keep.has(rel) });
    const files = {};
    for (const name of toWrite) { const s = await stat(join(staging, name)); files[name] = { sha256: await sha256File(join(staging, name)), size: s.size }; }
    const manifest = { tag: p.tag, backend, entry: p.entry, installedAt: new Date().toISOString(), zipSha256: f.sha256, files, leftInZip: left };
    await writeFile(join(staging, MANIFEST), JSON.stringify(manifest, null, 2));
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    return manifest;
  } catch (err) { await rm(staging, { recursive: true, force: true }).catch(() => {}); await rm(dir, { recursive: true, force: true }).catch(() => {}); throw err; }
}

/** Before EVERY start: every listed file is there with its hash, and no other file is. Returns { ok } or { ok: false, why, file }. */
export async function verifyRuntime(dir) {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')); } catch { return { ok: false, missing: true, why: 'The program is not set up.' }; }
  const names = await readdir(dir).catch(() => null);
  if (!names) return { ok: false, missing: true, why: 'The program is not set up.' };
  for (const name of names) if (name !== MANIFEST && !manifest.files[name]) return { ok: false, changed: true, file: name, why: 'A file nobody listed is in the program folder.' };
  for (const [name, want] of Object.entries(manifest.files)) {
    let got; try { got = await sha256File(join(dir, name)); } catch { return { ok: false, changed: true, file: name, why: 'A program file is missing.' }; }
    if (got !== want.sha256) return { ok: false, changed: true, file: name, why: 'A program file changed.' };
  }
  return { ok: true, manifest, exe: join(dir, manifest.entry) };
}
