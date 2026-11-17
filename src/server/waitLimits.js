/**
 * W4-9: how long Bunny waits before trying another model. The person picks the wait for a FIRST reply (seconds);
 * reasoning, image and video models and the silence-while-streaming limit get twice that, capped at 600 s.
 * The default (30) gives exactly the old 30 / 60 / 60 seconds. A missing or unusable stored value falls back to 30.
 */
export const WAIT_DEFAULT_SECONDS = 30;
export const WAIT_MIN_SECONDS = 10;
export const WAIT_MAX_SECONDS = 600;
export const WAIT_PRESETS = [15, 30, 60, 90, 120];

/** A whole number from 10 to 600 (a number, not a string), or null. */
export const validWaitSeconds = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= WAIT_MIN_SECONDS && v <= WAIT_MAX_SECONDS ? v : null);

/** The stored setting as seconds; anything missing or unknown is 30. */
export const waitSeconds = (setting) => validWaitSeconds(setting) ?? WAIT_DEFAULT_SECONDS;

/** Limits in milliseconds for a setting: first reply, slow-model first reply, and silence while streaming. */
export function waitLimits(setting) {
  const s = waitSeconds(setting);
  const doubled = Math.min(s * 2, WAIT_MAX_SECONDS);
  return { firstMs: s * 1000, slowFirstMs: doubled * 1000, gapMs: doubled * 1000 };
}
