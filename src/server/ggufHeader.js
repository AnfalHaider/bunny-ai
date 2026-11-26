/**
 * LOCAL-MODELS LF-3 and LF-4: Bunny reads a GGUF file's header itself, read-only, with hard limits, before anything is started on it.
 * Counts and offsets are BigInt; every length is checked against the bytes left in the file before it is read; nothing here executes or renders anything.
 * Two modes: `full` (a model the person is adding: the tensors are checked too) and `list` (a fixed start of the header: the keys only, a smaller byte cap).
 */
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  headerBytes: 128 * 1024 * 1024, listBytes: 32 * 1024 * 1024,
  string: 1024 * 1024, template: 128 * 1024,
  array: 2_097_152n, keys: 8192n, tensors: 65_536n, alignment: 1024 * 1024,
});

/** ggml type id -> [block size, bytes per block], from ggml.h as of the pinned runner (b12760). An id not here is refused: the runner is not known to load it. */
export const TENSOR_TYPES = Object.freeze({
  0: [1, 4], 1: [1, 2], 2: [32, 18], 3: [32, 20], 6: [32, 22], 7: [32, 24], 8: [32, 34], 9: [32, 36],
  10: [256, 84], 11: [256, 110], 12: [256, 144], 13: [256, 176], 14: [256, 210], 15: [256, 292],
  16: [256, 66], 17: [256, 74], 18: [256, 98], 19: [256, 50], 20: [32, 18], 21: [256, 110], 22: [256, 82], 23: [256, 136],
  24: [1, 1], 25: [1, 2], 26: [1, 4], 27: [1, 8], 28: [1, 8], 29: [256, 56], 30: [1, 2], 34: [256, 54], 35: [256, 66], 39: [32, 17],
});

export class GgufError extends Error {
  constructor(code, message) { super(message); this.name = 'GgufError'; this.code = code; }
}
const refuse = (code, message) => { throw new GgufError(code, message); };
const NOT_GGUF = (name) => `${name} doesn't start like a real GGUF model file. Nothing was added, and the file wasn't changed.`;

const SCALAR = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const WANT = new Set(['general.architecture', 'general.file_type', 'general.license', 'general.name', 'general.type', 'general.alignment', 'split.count', 'general.quantization_version']);
const wantedKey = (k, arch) => WANT.has(k) || (arch && /^[a-z0-9_.-]+\.(context_length|block_count|embedding_length|attention\.head_count|attention\.head_count_kv)$/.test(k) && k.startsWith(`${arch}.`));
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** A sequential reader that never reads past the file, the byte cap or what is left. */
function reader(handle, size, cap, name) {
  let pos = 0n; let block = Buffer.alloc(0); let blockAt = 0n;
  const limit = BigInt(Math.min(size, cap));
  const take = async (n) => {
    const need = BigInt(n);
    if (need < 0n || pos + need > limit) refuse(pos + need > BigInt(size) ? 'incomplete' : 'too-big', pos + need > BigInt(size) ? "This file is incomplete. It ends before the model does. Copy or download it again." : "This file's header is larger than Bunny reads. Bunny won't run it.");
    if (pos < blockAt || pos + need > blockAt + BigInt(block.length)) {
      const len = Number(need > 1048576n ? need : 1048576n > limit - pos ? limit - pos : 1048576n);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await handle.read(buf, 0, len, Number(pos));
      block = buf.subarray(0, bytesRead); blockAt = pos;
      if (BigInt(block.length) < need) refuse('incomplete', 'This file is incomplete. It ends before the model does. Copy or download it again.');
    }
    const out = block.subarray(Number(pos - blockAt), Number(pos - blockAt + need));
    pos += need;
    return out;
  };
  return {
    pos: () => pos,
    skip: async (n) => { const need = BigInt(n); if (pos + need > limit) refuse(pos + need > BigInt(size) ? 'incomplete' : 'too-big', 'This file is incomplete. It ends before the model does. Copy or download it again.'); pos += need; },
    u32: async () => (await take(4)).readUInt32LE(0),
    u64: async () => (await take(8)).readBigUInt64LE(0),
    str: async (max = LIMITS.string) => {
      const n = (await take(8)).readBigUInt64LE(0);
      if (n > BigInt(max)) refuse(max === LIMITS.template ? 'template-too-large' : 'string-too-long', max === LIMITS.template ? "This file's chat format is too large or unreadable. Bunny won't run it. Nothing was added." : `${name} has a text value that is too long. Bunny won't run it.`);
      return take(Number(n));
    },
    take,
  };
}

async function value(r, type, keep) {
  if (type === 8) { const b = await r.str(); return keep ? (() => { try { return utf8.decode(b); } catch { return refuse('bad-text', 'This file holds text that is not valid. Bunny won\'t run it.'); } })() : null; }
  if (type === 9) {
    const it = await r.u32(); const n = await r.u64();
    if (n > LIMITS.array) refuse('array-too-long', 'This file has a list that is far too long. Bunny won\'t run it.');
    if (it === 9) refuse('nested', 'This file has lists inside lists. Bunny won\'t run it.');
    if (it === 8) { for (let i = 0n; i < n; i++) await r.str(); } else { const sz = SCALAR[it]; if (!sz) refuse('bad-type', 'This file uses a value type Bunny doesn\'t know.'); await r.skip(n * BigInt(sz)); }
    return null;
  }
  const sz = SCALAR[type]; if (!sz) refuse('bad-type', 'This file uses a value type Bunny doesn\'t know.');
  const b = await r.take(sz);
  if (!keep) return null;
  switch (type) {
    case 0: return b.readUInt8(0); case 1: return b.readInt8(0); case 2: return b.readUInt16LE(0); case 3: return b.readInt16LE(0);
    case 4: return b.readUInt32LE(0); case 5: return b.readInt32LE(0); case 6: return b.readFloatLE(0); case 7: return b.readUInt8(0) !== 0;
    case 10: { const v = b.readBigUInt64LE(0); return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : String(v); }
    case 11: { const v = b.readBigInt64LE(0); return v >= BigInt(-Number.MAX_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : String(v); }
    default: return b.readDoubleLE(0);
  }
}

const isSplitName = (name) => /-\d{5}-of-\d{5}\.gguf$/i.test(name);
const isProjectorName = (name) => /^mmproj[-_.]/i.test(name) || /[-_.]mmproj[-_.]/i.test(name);
export const looksSplitOrProjector = (name) => (isSplitName(name) ? 'split' : isProjectorName(name) ? 'projector' : null);

/**
 * @param {string} file  an absolute path (the real path, decided by the caller)
 * @param {{mode?:'full'|'list', name?:string}} [o]
 * @returns the facts a card shows: architecture, file type, licence, name, context length, template shas, tensor count; throws GgufError (plain message) when the file must be refused.
 */
export async function readGguf(file, { mode = 'full', name = null } = {}) {
  const label = name ?? String(file).split(/[\\/]/).pop();
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const r = reader(handle, size, mode === 'full' ? LIMITS.headerBytes : LIMITS.listBytes, label);
    if (size < 24) refuse('not-gguf', NOT_GGUF(label));
    const magic = await r.take(4);
    if (magic.toString('latin1') !== 'GGUF') refuse('not-gguf', NOT_GGUF(label));
    const version = await r.u32();
    if (version !== 2 && version !== 3) refuse('version', `${label} is GGUF version ${version}; Bunny runs versions 2 and 3 only.`);
    const tensorCount = await r.u64(); const keyCount = await r.u64();
    if (keyCount > LIMITS.keys) refuse('too-many-keys', 'This file has far too many settings in its header. Bunny won\'t run it.');
    if (tensorCount > LIMITS.tensors) refuse('too-many-tensors', 'This file has far too many tensors. Bunny won\'t run it.');
    const kv = {}; const templates = {};
    let arch = null;
    for (let i = 0n; i < keyCount; i++) {
      const key = (await r.str()).toString('latin1');
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key)) refuse('bad-key', 'This file has a setting name Bunny doesn\'t accept.');
      const type = await r.u32();
      if (key === 'tokenizer.chat_template' || key.startsWith('tokenizer.chat_template.')) {
        if (type !== 8) refuse('bad-template', "This file's chat format is too large or unreadable. Bunny won't run it. Nothing was added.");
        const b = await r.str(LIMITS.template);
        let text; try { text = utf8.decode(b); } catch { refuse('bad-template', "This file's chat format is too large or unreadable. Bunny won't run it. Nothing was added."); }
        if (text.includes('\0')) refuse('bad-template', "This file's chat format is too large or unreadable. Bunny won't run it. Nothing was added.");
        templates[key === 'tokenizer.chat_template' ? 'default' : key.slice('tokenizer.chat_template.'.length)] = { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
        continue;
      }
      const keep = wantedKey(key, arch);
      const v = await value(r, type, keep);
      if (keep) kv[key] = v;
      if (key === 'general.architecture') {
        if (typeof v !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(v)) refuse('bad-arch', 'This file names no model type Bunny recognises.');
        arch = v;
      }
    }
    if (!arch) refuse('no-arch', 'This file names no model type Bunny recognises.');
    const splitCount = Number(kv['split.count'] ?? 1);
    if (splitCount > 1) refuse('split', "Bunny can't run split model files yet. This is one piece of a model stored in several files.");
    if (kv['general.type'] === 'mmproj' || arch === 'clip') refuse('projector', "Bunny can't use vision helper files. This belongs with a vision model; it isn't a chat model on its own.");
    const split = looksSplitOrProjector(label);
    if (split === 'split') refuse('split', "Bunny can't run split model files yet. This is one piece of a model stored in several files.");
    if (split === 'projector') refuse('projector', "Bunny can't use vision helper files. This belongs with a vision model; it isn't a chat model on its own.");
    let alignment = 32n;
    if (kv['general.alignment'] !== undefined) {
      const a = BigInt(kv['general.alignment']);
      if (a <= 0n || (a & (a - 1n)) !== 0n || a > BigInt(LIMITS.alignment)) refuse('alignment', 'This file has an odd internal layout. Bunny won\'t run it.');
      alignment = a;
    }
    const facts = {
      version, architecture: arch, fileType: kv['general.file_type'] ?? null, license: kv['general.license'] ?? null, modelName: kv['general.name'] ?? null,
      contextLength: Number(kv[`${arch}.context_length`] ?? 0) || null, blockCount: Number(kv[`${arch}.block_count`] ?? 0) || null,
      embeddingLength: Number(kv[`${arch}.embedding_length`] ?? 0) || null, headCount: Number(kv[`${arch}.attention.head_count`] ?? 0) || null, headCountKv: Number(kv[`${arch}.attention.head_count_kv`] ?? 0) || null,
      tensorCount: Number(tensorCount), templates, size,
    };
    if (mode === 'list') return facts;
    // the tensors: dimensions, a known type, and every one inside the file
    const infos = [];
    for (let i = 0n; i < tensorCount; i++) {
      await r.str(256);
      const nd = await r.u32();
      if (nd < 1 || nd > 4) refuse('tensor-dims', 'This file has a tensor with an impossible shape. Bunny won\'t run it.');
      const ne = []; for (let d = 0; d < nd; d++) ne.push(await r.u64());
      const type = await r.u32(); const offset = await r.u64();
      const t = TENSOR_TYPES[type];
      if (!t) refuse('tensor-type', 'This file uses a tensor type Bunny\'s program doesn\'t know. Bunny won\'t run it.');
      const [blk, bytes] = t.map(BigInt);
      if (ne[0] === 0n || ne[0] % blk !== 0n) refuse('tensor-shape', 'This file has a tensor with an impossible shape. Bunny won\'t run it.');
      let n = (ne[0] / blk) * bytes; for (let d = 1; d < ne.length; d++) n *= ne[d];
      infos.push({ offset, n });
    }
    const headerEnd = r.pos();
    const dataStart = ((headerEnd + alignment - 1n) / alignment) * alignment;
    const fileEnd = BigInt(size);
    if (dataStart > fileEnd && infos.length) refuse('incomplete', 'This file is incomplete. It ends before the model does. Copy or download it again.');
    for (const t of infos) if (t.offset % alignment !== 0n || dataStart + t.offset + t.n > fileEnd) refuse('incomplete', 'This file is incomplete. It ends before the model does. Copy or download it again.');
    return facts;
  } finally { await handle.close(); }
}

/** The one-line name of a file type id (general.file_type). Only the ones that matter on a card. */
export const FILE_TYPES = Object.freeze({ 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 32: 'BF16' });
export const fileTypeName = (id) => (id == null ? null : FILE_TYPES[id] ?? `type ${id}`);

/** Text taken from a file or a folder name, made safe to show: control characters and bidi overrides removed, cut to 200. (Always put into the page with textContent.) */
export function cleanLabel(text, max = 200) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏]/g, '').slice(0, max);
}
