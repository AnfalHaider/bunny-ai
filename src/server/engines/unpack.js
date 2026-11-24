/**
 * CLI-ENGINES (CE-5.3): unpacking a downloaded engine, safely. Written here (no dependency) for the two shapes the pins use: a .zip (Codex) and a .tgz (the npm package of Claude Code).
 *
 * Refused, with a plain message, and the caller removes the staging folder:
 *  - a path outside the folder: absolute, with a drive letter, with `..`, or backslash tricks;
 *  - an alternate data stream (a `:` after the first segment), a Windows reserved name (CON, NUL, COM1...), a name ending in a dot or a space;
 *  - a symbolic link or a hard link (never created, never followed);
 *  - more than MAX_TOTAL_BYTES in all (an archive bomb), or an entry larger than the size it declares.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createGunzip, createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB in all
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export class UnpackError extends Error {
  constructor(message) { super(message); this.name = 'UnpackError'; }
}

/** The relative path an archive entry may be written to (forward slashes), or throws UnpackError. `strip` removes a leading folder name (the "package/" of an npm tarball). */
export function safeEntryPath(name, strip = '') {
  let p = String(name ?? '').replace(/\\/g, '/');
  if (!p || p.includes('\0')) throw new UnpackError(`The archive has an entry with no usable name.`);
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new UnpackError(`The archive has an entry with an absolute path ("${p.slice(0, 60)}").`);
  if (strip) {
    const prefix = strip.endsWith('/') ? strip : `${strip}/`;
    if (p === strip || p === prefix) return '';
    if (!p.startsWith(prefix)) throw new UnpackError(`The archive has an entry outside "${strip}" ("${p.slice(0, 60)}").`);
    p = p.slice(prefix.length);
  }
  const parts = p.split('/').filter((x) => x !== '');
  for (const part of parts) {
    if (part === '..') throw new UnpackError(`The archive has an entry that climbs out of its folder ("${p.slice(0, 60)}").`);
    if (part === '.') continue;
    if (part.includes(':')) throw new UnpackError(`The archive has an entry with an alternate data stream ("${p.slice(0, 60)}").`);
    if (RESERVED.test(part)) throw new UnpackError(`The archive has an entry with a reserved Windows name ("${part}").`);
    if (/[. ]$/.test(part)) throw new UnpackError(`The archive has an entry whose name ends in a dot or a space ("${part}").`);
    if (/[<>"|?*\u0000-\u001f]/.test(part)) throw new UnpackError(`The archive has an entry with a character Windows does not allow ("${part.slice(0, 40)}").`);
  }
  return parts.filter((x) => x !== '.').join('/');
}

/** Where an entry goes under `dest`, checked once more after resolving (belt and braces). */
function target(dest, rel) {
  const full = resolve(dest, ...rel.split('/'));
  const root = resolve(dest);
  if (full !== root && !full.startsWith(root + sep)) throw new UnpackError('The archive has an entry that would be written outside its folder.');
  return full;
}

/** Counts bytes through a stream and stops it when the total passes the limit or the entry passes its declared size. */
function counter(state, declared) {
  let mine = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      mine += chunk.length; state.total += chunk.length;
      if (state.total > state.max) return cb(new UnpackError(`The archive is bigger than ${Math.round(state.max / 1048576)} MB unpacked: stopped.`));
      if (declared !== undefined && mine > declared) return cb(new UnpackError('An archive entry is larger than it says it is: stopped.'));
      return cb(null, chunk);
    },
  });
}

// ---------------------------------------------------------------- zip

/** Read the central directory of a zip file: [{ name, method, compressed, size, offset, attrs, isDir }]. */
export async function readZipDirectory(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) { if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new UnpackError('The download is not a zip file.');
    let entries = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new UnpackError('Zip64 archives are not supported here.');
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const list = [];
    let p = 0;
    while (entries > 0 && p + 46 <= cd.length) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new UnpackError('The zip file is damaged.');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const compressed = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const attrs = cd.readUInt32LE(p + 38);
      const offset = cd.readUInt32LE(p + 42);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
      list.push({ name, method, compressed, size: usize, offset, attrs, isDir: name.endsWith('/'), encrypted: Boolean(flags & 1) });
      p += 46 + nameLen + extraLen + commentLen;
      entries -= 1;
    }
    return list;
  } finally { await handle.close(); }
}

/** Unpack a zip into `dest`. Returns the relative paths written. */
export async function unpackZip(file, dest, { max = MAX_TOTAL_BYTES, strip = '' } = {}) {
  const entries = await readZipDirectory(file);
  const state = { total: 0, max };
  const written = [];
  const handle = await open(file, 'r');
  try {
    for (const e of entries) {
      const rel = safeEntryPath(e.name, strip);
      if (e.encrypted) throw new UnpackError('The zip file has an encrypted entry.');
      const unixMode = e.attrs >>> 16; // zip made on Unix keeps the mode in the high bits: a link is 0o120000
      if ((unixMode & 0o170000) === 0o120000) throw new UnpackError(`The archive has a symbolic link ("${e.name.slice(0, 60)}").`);
      if (!rel) continue;
      const out = target(dest, rel);
      if (e.isDir) { await mkdir(out, { recursive: true }); continue; }
      if (e.method !== 0 && e.method !== 8) throw new UnpackError('The zip file uses a compression this check does not accept.');
      await mkdir(dirname(out), { recursive: true });
      const head = Buffer.alloc(30);
      await handle.read(head, 0, 30, e.offset);
      if (head.readUInt32LE(0) !== 0x04034b50) throw new UnpackError('The zip file is damaged.');
      const dataStart = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      if (e.size === 0) { await writeFile(out, '', { flag: 'wx' }); written.push(rel); continue; }
      const raw = createReadStream(file, { start: dataStart, end: dataStart + e.compressed - 1 });
      await pipeline(...[raw, e.method === 8 ? createInflateRaw() : null, counter(state, e.size), createWriteStream(out, { flags: 'wx' })].filter(Boolean));
      written.push(rel);
    }
  } finally { await handle.close(); }
  return written;
}

// ---------------------------------------------------------------- tar.gz

function octal(buf, from, len) {
  const text = buf.toString('latin1', from, from + len).replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

/** Unpack a .tgz (an npm tarball) into `dest`. Returns the relative paths written. */
/** The records of a PAX extended header ("<length> <key>=<value>\n" repeated): only path and size are taken, the rest is ignored. A record that does not add up is an error. */
export function parsePax(buffer) {
  const out = {};
  let at = 0;
  while (at < buffer.length) {
    const space = buffer.indexOf(0x20, at);
    if (space < 0) break;
    const len = Number(buffer.toString('utf8', at, space));
    if (!Number.isInteger(len) || len <= space - at + 1 || at + len > buffer.length) throw new UnpackError('The archive has an extended header that cannot be read.');
    const record = buffer.toString('utf8', space + 1, at + len - 1); // without the trailing newline
    const eq = record.indexOf('=');
    if (eq > 0) {
      const key = record.slice(0, eq); const value = record.slice(eq + 1);
      if (key === 'path') out.path = value;
      else if (key === 'size') { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new UnpackError('The archive has an extended header with a size that cannot be read.'); out.size = n; }
    }
    at += len;
  }
  return out;
}

export async function unpackTgz(file, dest, { max = MAX_TOTAL_BYTES, strip = '' } = {}) {
  const state = { total: 0, max };
  const written = [];
  const gunzip = createGunzip();
  const source = createReadStream(file).pipe(gunzip);
  let buf = Buffer.alloc(0);
  let current = null; // { out, remaining, pad, stream }
  let longName = null;
  let pax = null; // IA4-a: the records of a PAX 'x' header ({ path, size }) apply to the NEXT entry
  let zeroBlocks = 0;
  const finishEntry = async () => { if (current) { await new Promise((r) => current.stream.end(r)); current = null; } };
  try {
    for await (const chunk of source) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (current) {
          if (current.remaining > 0) {
            if (!buf.length) break;
            const take = Math.min(current.remaining, buf.length);
            state.total += take;
            if (state.total > state.max) throw new UnpackError(`The archive is bigger than ${Math.round(state.max / 1048576)} MB unpacked: stopped.`);
            const piece = buf.subarray(0, take);
            if (current.stream) { if (!current.stream.write(piece)) await new Promise((r) => current.stream.once('drain', r)); } else current.collected.push(Buffer.from(piece));
            buf = buf.subarray(take); current.remaining -= take;
            if (current.remaining > 0) break;
          }
          if (current.pad > 0) {
            if (buf.length < current.pad) break;
            buf = buf.subarray(current.pad); current.pad = 0;
          }
          if (current.stream) { await finishEntry(); } else if (current.pax) { pax = parsePax(Buffer.concat(current.collected)); current = null; } else { longName = Buffer.concat(current.collected).toString('utf8').replace(/\0.*$/s, ''); current = null; }
          continue;
        }
        if (buf.length < 512) break;
        const header = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (header.every((b) => b === 0)) { zeroBlocks += 1; if (zeroBlocks >= 2) { buf = Buffer.alloc(0); } continue; }
        zeroBlocks = 0;
        let name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
        const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/s, '');
        const type = String.fromCharCode(header[156] || 48);
        let size = octal(header, 124, 12);
        if (prefix) name = `${prefix}/${name}`;
        if (longName) { name = longName; longName = null; }
        if (pax && type !== 'x' && type !== 'g' && type !== 'L') { // the PAX path and size are the entry's real ones, checked like any other name
          if (pax.path) name = pax.path;
          if (pax.size !== undefined) size = pax.size;
          pax = null;
        }
        const pad = (512 - (size % 512)) % 512;
        if (type === 'L') { current = { remaining: size, pad, collected: [], stream: null }; continue; }
        if (type === 'x' || type === 'g') { current = { remaining: size, pad, collected: [], stream: null, pax: type === 'x' }; continue; } // pax: an 'x' header's path and size are read for the next entry (IA4-a); a global 'g' one is ignored
        if (type === '1' || type === '2') throw new UnpackError(`The archive has a ${type === '2' ? 'symbolic' : 'hard'} link ("${name.slice(0, 60)}").`);
        const rel = safeEntryPath(name, strip);
        if (type === '5') { if (rel) await mkdir(target(dest, rel), { recursive: true }); continue; }
        if (type !== '0' && type !== '\0') throw new UnpackError(`The archive has an entry of a kind this check does not accept ("${name.slice(0, 60)}").`);
        if (!rel) { current = { remaining: size, pad, stream: createWriteStream(join(dest, '.discard')) }; continue; }
        const out = target(dest, rel);
        await mkdir(dirname(out), { recursive: true });
        current = { remaining: size, pad, stream: createWriteStream(out, { flags: 'wx' }) };
        written.push(rel);
        if (size === 0) { current.pad = 0; await finishEntry(); }
      }
    }
    await finishEntry();
  } catch (err) {
    if (current?.stream) current.stream.destroy();
    source.destroy();
    throw err;
  }
  return written;
}

/** The size on disk of a folder (files only; links are not followed). */
export async function folderBytes(dir) {
  const { readdir, lstat } = await import('node:fs/promises');
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await folderBytes(p);
    else { const info = await lstat(p).catch(() => null); if (info && info.isFile()) total += info.size; }
  }
  return total;
}

