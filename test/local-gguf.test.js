/** LOCAL-MODELS LF-3 and LF-4: the GGUF header parser. Every refusal happens before anything could be started. Test-written tiny files only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { readGguf, GgufError, cleanLabel, looksSplitOrProjector, LIMITS } from '../src/server/ggufHeader.js';
import { makeGguf, u32, u64 } from './helpers-gguf.js';

async function put(t, buf, name = 'tiny.gguf') {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-gguf-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = join(dir, name); await writeFile(f, buf); return f;
}
const refused = async (t, buf, code, name) => assert.rejects(readGguf(await put(t, buf, name)), (e) => e instanceof GgufError && e.code === code, code);

test('a valid tiny GGUF is read: architecture, type, licence, context, and the template with its sha256', async (t) => {
  const g = await readGguf(await put(t, makeGguf()));
  assert.equal(g.architecture, 'llama'); assert.equal(g.fileType, 15); assert.equal(g.license, 'apache-2.0'); assert.equal(g.contextLength, 4096); assert.equal(g.tensorCount, 1);
  assert.equal(g.templates.default.sha256, createHash('sha256').update(g.templates.default.text).digest('hex'));
});

test('LF-12.2: refused before anything starts: bad magic, version 1 and 4, a truncated file, a tensor past the end', async (t) => {
  await refused(t, makeGguf({ magic: 'GGUX' }), 'not-gguf');
  await refused(t, makeGguf({ version: 1 }), 'version');
  await refused(t, makeGguf({ version: 4 }), 'version');
  await refused(t, makeGguf({ truncateBy: 40 }), 'incomplete');
  await refused(t, makeGguf({ tensorOffsetOverride: 1 << 20 }), 'incomplete');
  await refused(t, makeGguf().subarray(0, 100), 'incomplete');
  await refused(t, Buffer.from('hello'), 'not-gguf');
});

test('LF-12.2: a string length past the end, an array count of 2^63, a key count over the cap, an alignment that is not a power of two', async (t) => {
  const badStr = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), u64(12), Buffer.from('general.name'), u32(8), u64(5_000_000)]);
  await refused(t, badStr, 'string-too-long');
  const pastEnd = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), u64(12), Buffer.from('general.name'), u32(8), u64(500_000), Buffer.alloc(10)]);
  await refused(t, pastEnd, 'incomplete');
  await refused(t, makeGguf({ extra: [['x.tokens', 9, { itemType: 8, count: 2n ** 63n }]] }), 'array-too-long');
  await refused(t, makeGguf({ keyCountOverride: Number(LIMITS.keys) + 1 }), 'too-many-keys');
  await refused(t, makeGguf({ extra: [['general.alignment', 4, 33]] }), 'alignment');
  await refused(t, makeGguf({ extra: [['general.alignment', 4, 2 * 1024 * 1024]] }), 'alignment');
});

test('LF-12.2: a split file and a projector file are refused (by key and by name)', async (t) => {
  await refused(t, makeGguf({ extra: [['split.count', 4, 3]] }), 'split');
  await refused(t, makeGguf(), 'split', 'model-00001-of-00003.gguf');
  await refused(t, makeGguf({ extra: [['general.type', 8, 'mmproj']] }), 'projector');
  await refused(t, makeGguf({ arch: 'clip' }), 'projector');
  await refused(t, makeGguf(), 'projector', 'mmproj-tiny-f16.gguf');
  assert.equal(looksSplitOrProjector('a-00002-of-00004.gguf'), 'split');
  assert.equal(looksSplitOrProjector('mmproj-x.gguf'), 'projector');
  assert.equal(looksSplitOrProjector('plain.Q4_K_M.gguf'), null);
});

test('a tensor of an unknown type, with no dimensions, or with an impossible shape is refused', async (t) => {
  await refused(t, makeGguf({ tensors: [{ name: 'w', dims: [32], type: 4 }] }), 'tensor-type');
  await refused(t, makeGguf({ tensors: [{ name: 'w', dims: [], type: 0 }] }), 'tensor-dims');
  await refused(t, makeGguf({ tensors: [{ name: 'w', dims: [1, 1, 1, 1, 1], type: 0 }] }), 'tensor-dims');
  await refused(t, makeGguf({ tensors: [{ name: 'w', dims: [33], type: 2 }] }), 'tensor-shape');
});

test('LF-12.3: a template over 128 KiB is refused; no template is allowed (the caller then uses chatml, tools off)', async (t) => {
  await refused(t, makeGguf({ template: 'x'.repeat(LIMITS.template + 1) }), 'template-too-large');
  const none = await readGguf(await put(t, makeGguf({ template: null })));
  assert.deepEqual(none.templates, {});
});

test('a named template variant is read too, and a NUL in a template is refused', async (t) => {
  const g = await readGguf(await put(t, makeGguf({ extra: [['tokenizer.chat_template.tool_use', 8, 'TOOLS {{ x }}']] })));
  assert.deepEqual(Object.keys(g.templates).sort(), ['default', 'tool_use']);
  await refused(t, makeGguf({ template: 'a\0b' }), 'bad-template');
});

test('list mode reads only the header keys with the smaller cap, and still refuses a split file', async (t) => {
  const f = await put(t, makeGguf({ tensors: [{ name: 'w', dims: [32], type: 4 }] })); // a bad tensor is not looked at while listing
  assert.equal((await readGguf(f, { mode: 'list' })).architecture, 'llama');
  await assert.rejects(readGguf(await put(t, makeGguf({ extra: [['split.count', 4, 2]] })), { mode: 'list' }), (e) => e.code === 'split');
});

test('names and labels taken from files are cleaned: control characters and bidi overrides removed, cut to 200', () => {
  assert.equal(cleanLabel('a‮b\u0007c⁦d'), 'abcd');
  assert.equal(cleanLabel('x'.repeat(500)).length, 200);
  assert.equal(cleanLabel(null), '');
});
