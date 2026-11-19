// Test helpers: build a small .zip and a small .tar.gz in memory, with the odd entries the unpackers must refuse.
import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync } from 'node:zlib';

const crc32 = (buf) => {
  let c; let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
};

/** entries: [{ name, data (string|Buffer), dir?, link?, store? }] */
export function makeZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data ?? '');
    const method = e.store || e.dir || raw.length === 0 ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    const mode = e.link ? 0o120777 : e.dir ? 0o40755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** entries: [{ name, data, dir?, type? ('1' hard link, '2' symlink) }] -> a gzipped tar */
export function makeTgz(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8'); h.write('0000644\0', 100, 8); h.write('0000000\0', 108, 8); h.write('0000000\0', 116, 8);
    h.write(`${(e.dir || e.type ? 0 : data.length).toString(8).padStart(11, '0')}\0`, 124, 12); h.write('00000000000\0', 136, 12);
    h.write('        ', 148, 8); h.write(e.type ?? (e.dir ? '5' : '0'), 156, 1); h.write('ustar\0', 257, 6); h.write('00', 263, 2);
    if (e.type) h.write('target', 157, 100);
    let sum = 0; for (const b of h) sum += b; h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(h);
    if (!e.dir && !e.type && data.length) { blocks.push(data); const pad = (512 - (data.length % 512)) % 512; if (pad) blocks.push(Buffer.alloc(pad)); }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
