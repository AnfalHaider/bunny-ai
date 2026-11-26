import test from 'node:test';
import assert from 'node:assert/strict';
import { GB, needBytes, fitFor, chooseContext, OVERHEAD, FIT_TEXT } from '../src/server/localFit.js';

// An invented 4 B model: 2.5 GB file, 100 KB of cache per token, native context 40960
const M = { size: 2.5 * GB, kvBytesPerToken: 100 * 1024, nativeCtx: 40960, tools: true };

test('LM-7: need is the file plus the cache for the context plus 1.5 GB', () => {
  assert.equal(needBytes(M, 8192), 2.5 * GB + 100 * 1024 * 8192 + OVERHEAD);
});

test('LM-7: the four results from fixed RAM inputs', () => {
  const need = needBytes(M, 8192);
  assert.equal(fitFor(M, 8192, { freeRam: need / 0.7 }).result, 'fits');
  assert.equal(fitFor(M, 8192, { freeRam: need / 0.9 }).result, 'tight');
  const big = fitFor(M, 8192, { freeRam: need / 0.96 });
  assert.equal(big.result, 'too-big');
  assert.equal(big.canDownload, false, 'Download is disabled, with no override');
  assert.equal(big.text, 'Too big for this PC');
});

test('LM-7: with the graphics card in use, VRAM decides; partly in RAM is Slow; too big for both is Too big', () => {
  const need = needBytes(M, 8192);
  const pc = (vram, ram) => ({ gpu: true, freeVram: vram, freeRam: ram });
  assert.equal(fitFor(M, 8192, pc(need / 0.7, 0)).result, 'fits-gpu');
  assert.equal(fitFor(M, 8192, pc(need / 0.9, 0)).result, 'tight');
  assert.equal(fitFor(M, 8192, pc(need / 2, need)).result, 'slow');
  assert.equal(fitFor(M, 8192, pc(need / 4, need / 4)).result, 'too-big');
  assert.equal(fitFor(M, 8192, { gpu: true, freeVram: null, freeRam: need / 0.7 }).result, 'fits', 'VRAM unknown: RAM only');
});

test('LM-7: the context is 32768 if it fits, else 16384, else 8192, and never above the model\'s own', () => {
  const roomy = chooseContext(M, { freeRam: 64 * GB });
  assert.equal(roomy.ctx, 32768);
  assert.equal(roomy.tools, true);
  const mid = chooseContext(M, { freeRam: needBytes(M, 16384) / 0.7 });
  assert.equal(mid.ctx, 16384);
  const small = chooseContext(M, { freeRam: needBytes(M, 8192) / 0.7 });
  assert.equal(small.ctx, 8192);
  assert.equal(chooseContext({ ...M, nativeCtx: 8192 }, { freeRam: 64 * GB }).ctx, 8192, 'never above nativeCtx');
});

test('LM-7: tools need 16384 or more; below that the model is chat-only with the reason', () => {
  const small = chooseContext(M, { freeRam: needBytes(M, 8192) / 0.7 });
  assert.equal(small.tools, false);
  assert.equal(small.toolsNote, 'Not enough memory for tools on this PC');
  assert.equal(chooseContext({ ...M, tools: false }, { freeRam: 64 * GB }).tools, false, 'tools only for a family that passed S-LM2');
  assert.equal(chooseContext({ ...M, tools: false }, { freeRam: needBytes(M, 8192) / 0.7 }).toolsNote, null);
});

test('LM-7: every result has its words', () => {
  for (const k of ['fits', 'fits-gpu', 'tight', 'slow', 'too-big']) assert.ok(FIT_TEXT[k]);
});
