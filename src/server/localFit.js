/**
 * LOCAL-MODELS LM-7: will this model fit on this PC? Bunny's estimate, shown before a download and before each start.
 *
 *   need = size + kvBytesPerToken x ctx + 1.5 GB
 *
 * RAM is os.totalmem()/os.freemem(); VRAM comes from `llama-server --list-devices` on the Vulkan build, or is unknown (null), in which case only RAM counts.
 * The fixed overhead and the 0.75 and 0.95 factors are changed from spike S-LM5's measurements, not guessed again. Pure: no I/O.
 */

export const GB = 1024 ** 3;
export const OVERHEAD = 1.5 * GB;
export const FITS_FACTOR = 0.75;
export const TIGHT_FACTOR = 0.95;
export const CONTEXTS = [32768, 16384, 8192];
export const TOOLS_MIN_CTX = 16384;

/** The words each result gets on the card. */
export const FIT_TEXT = {
  fits: 'Fits on this PC',
  'fits-gpu': 'Runs on your graphics card',
  tight: 'Fits, but close other apps first',
  slow: 'Partly on your graphics card: slower',
  'too-big': 'Too big for this PC',
};

export const needBytes = ({ size, kvBytesPerToken = 0 }, ctx) => Number(size) + Number(kvBytesPerToken) * ctx + OVERHEAD;

/**
 * The result for one context length.
 * @param {{size:number, kvBytesPerToken?:number}} model
 * @param {number} ctx
 * @param {{freeRam:number, freeVram?:number|null, gpu?:boolean}} pc  gpu: the Vulkan build is the one in use
 * @returns {{result:'fits'|'fits-gpu'|'tight'|'slow'|'too-big', need:number, text:string, canDownload:boolean}}
 */
export function fitFor(model, ctx, pc) {
  const need = needBytes(model, ctx);
  const ram = Math.max(0, Number(pc.freeRam) || 0);
  const vram = pc.gpu && Number.isFinite(pc.freeVram) ? Math.max(0, pc.freeVram) : null;
  let result;
  if (vram !== null) {
    if (need <= FITS_FACTOR * vram) result = 'fits-gpu';
    else if (need <= TIGHT_FACTOR * vram) result = 'tight';
    else if (need <= TIGHT_FACTOR * (ram + vram)) result = 'slow'; // it fits in memory only if part of it stays in RAM
    else result = 'too-big';
  } else if (need <= FITS_FACTOR * ram) result = 'fits';
  else if (need <= TIGHT_FACTOR * ram) result = 'tight';
  else result = 'too-big';
  return { result, need, text: FIT_TEXT[result], canDownload: result !== 'too-big' };
}

/**
 * The context Bunny chooses: 32768 if the model still fits with it, else 16384, else 8192; never above the model's own `nativeCtx`.
 * A chat with tools needs 16384 or more; below that the model is chat-only on this PC.
 * @returns {{ctx:number, fit:object, tools:boolean, toolsNote:string|null}}
 */
export function chooseContext(model, pc) {
  const native = Number(model.nativeCtx) > 0 ? Number(model.nativeCtx) : 8192;
  const options = CONTEXTS.filter((c) => c <= native);
  if (!options.length) options.push(Math.min(native, 8192));
  const fits = options.map((ctx) => ({ ctx, fit: fitFor(model, ctx, pc) }));
  // the biggest context that fits comfortably; else the smallest one that is not too big (tight, slow); else the smallest (too big)
  const pick = fits.find((o) => o.fit.result === 'fits' || o.fit.result === 'fits-gpu')
    ?? [...fits].reverse().find((o) => o.fit.result !== 'too-big')
    ?? fits[fits.length - 1];
  const tools = model.tools === true && pick.ctx >= TOOLS_MIN_CTX && pick.fit.result !== 'too-big';
  return { ...pick, tools, toolsNote: model.tools === true && pick.ctx < TOOLS_MIN_CTX ? 'Not enough memory for tools on this PC' : null };
}
