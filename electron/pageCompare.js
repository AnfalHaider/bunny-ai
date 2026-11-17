// W6-11: compare two pages as pictures. Plain JavaScript over two bitmaps (Electron's nativeImage.toBitmap(): 4 bytes per pixel, blue, green, red, alpha),
// no new dependency. The score is the share of pixels that differ by more than a small threshold: 0 for the same picture, 1 for nothing alike.

/** A pixel differs when its colour channels together move by more than this (of a possible 765). Anti-aliasing and compression noise stay under it. */
export const THRESHOLD = 48;

/**
 * @param {Uint8Array|Buffer} a  BGRA bitmap, width * height * 4 bytes
 * @param {Uint8Array|Buffer} b  BGRA bitmap of the same size
 * @returns {{ score: number, different: number, total: number, mask: Uint8Array }}  mask: 1 for each pixel that differs
 */
export function pixelDifference(a, b, width, height, threshold = THRESHOLD) {
  const total = width * height;
  if (a.length < total * 4 || b.length < total * 4) throw new Error('The two pictures are not the same size.');
  const mask = new Uint8Array(total);
  let different = 0;
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
    if (d > threshold) { mask[i] = 1; different += 1; }
  }
  return { score: total ? different / total : 0, different, total, mask };
}

/** Cut or pad (white) a bitmap to exactly width x height, so two pages of different heights can still be compared. */
export function fitBitmap(bitmap, fromWidth, fromHeight, width, height) {
  const out = Buffer.alloc(width * height * 4, 0xff);
  const rows = Math.min(fromHeight, height);
  const cols = Math.min(fromWidth, width);
  for (let y = 0; y < rows; y += 1) {
    const src = y * fromWidth * 4;
    out.set(bitmap.subarray(src, src + cols * 4), y * width * 4);
  }
  return out;
}

/**
 * One picture: A on the left, B in the middle, the differences (red on white) on the right, with a 8-pixel gap between them. BGRA, ready for nativeImage.createFromBitmap.
 */
export function sideBySide(a, b, mask, width, height) {
  const gap = 8;
  const full = width * 3 + gap * 2;
  const out = Buffer.alloc(full * height * 4, 0xc8); // grey gaps
  for (let y = 0; y < height; y += 1) {
    out.set(a.subarray(y * width * 4, (y + 1) * width * 4), (y * full) * 4);
    out.set(b.subarray(y * width * 4, (y + 1) * width * 4), (y * full + width + gap) * 4);
    for (let x = 0; x < width; x += 1) {
      const at = (y * full + width * 2 + gap * 2 + x) * 4;
      if (mask[y * width + x]) { out[at] = 0x30; out[at + 1] = 0x30; out[at + 2] = 0xe0; } else { out[at] = 0xff; out[at + 1] = 0xff; out[at + 2] = 0xff; }
      out[at + 3] = 0xff;
    }
  }
  return { bitmap: out, width: full, height };
}

/** The line the model quotes when it says "this matches the design": the score as a percentage, in words. */
export function describeScore(widthPx, score) {
  const pct = Math.round(score * 1000) / 10;
  const verdict = score === 0 ? 'identical' : score < 0.02 ? 'almost the same' : score < 0.15 ? 'close, with visible differences' : score < 0.5 ? 'clearly different' : 'very different';
  return `At ${widthPx} px wide: ${pct}% of the pixels differ (${verdict}).`;
}
