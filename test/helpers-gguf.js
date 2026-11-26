/** Test-written tiny GGUF files (a header plus one small tensor). Never a real model. */
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u64(b.length), b]); };
const kvBuf = ([key, type, val]) => {
  let v;
  if (type === 8) v = str(val);
  else if (type === 4) v = u32(val);
  else if (type === 10) v = u64(val);
  else if (type === 9) v = Buffer.concat([u32(val.itemType), u64(val.count), val.raw ?? Buffer.alloc(0)]);
  else throw new Error(`test helper: type ${type}`);
  return Buffer.concat([str(key), u32(type), v]);
};
export function makeGguf({ version = 3, magic = 'GGUF', arch = 'llama', template = 'default', extra = [], tensors = [{ name: 'w', dims: [32], type: 0 }], alignment = 32, keyCountOverride = null, truncateBy = 0, tensorOffsetOverride = null, general = {}, contextLength = 4096 } = {}) {
  const kvs = [['general.architecture', 8, arch], ['general.name', 8, general.name ?? 'Tiny Test'], ['general.file_type', 4, 15], ['general.license', 8, general.license ?? 'apache-2.0'], [`${arch}.context_length`, 4, contextLength], [`${arch}.block_count`, 4, 2]];
  if (template === 'default') kvs.push(['tokenizer.chat_template', 8, '{% for m in messages %}<|{{ m.role }}|>{{ m.content }}{% endfor %}']);
  else if (template !== null) kvs.push(['tokenizer.chat_template', 8, template]);
  kvs.push(...extra);
  const head = [Buffer.from(magic, 'latin1'), u32(version), u64(tensors.length), u64(keyCountOverride ?? kvs.length), ...kvs.map(kvBuf)];
  let off = 0; const infos = [];
  for (const t of tensors) {
    const n = t.dims.reduce((a, b) => a * b, 1) * 4;
    infos.push(Buffer.concat([str(t.name), u32(t.dims.length), ...t.dims.map(u64), u32(t.type), u64(tensorOffsetOverride ?? off)]));
    off += Math.ceil(n / alignment) * alignment;
  }
  const header = Buffer.concat([...head, ...infos]);
  const pad = (alignment - (header.length % alignment)) % alignment;
  const all = Buffer.concat([header, Buffer.alloc(pad), Buffer.alloc(off)]);
  return truncateBy ? all.subarray(0, all.length - truncateBy) : all;
}
export { u32, u64, str, kvBuf };
