/**
 * How far one reply may go (W6-2). Settings hold the numbers; they are clamped whatever is stored.
 * Steps and minutes: a stored 0 means "off" (the reply stops at its normal step limit).
 * Tokens: never 0. The token budget is the cost brake, so 0 (or nonsense) becomes the smallest allowed budget, not "no limit".
 */
const clampOrOff = (v, lo, hi, fallback) => {
  const n = Number(v ?? fallback);
  return n === 0 ? 0 : Math.min(hi, Math.max(lo, Math.round(n) || fallback));
};
const MIN_TOKENS = 100_000;
const clampTokens = (v) => {
  const n = Number(v ?? 5_000_000);
  return Number.isFinite(n) ? Math.min(100_000_000, Math.max(MIN_TOKENS, Math.round(n))) : 5_000_000;
};

export function replyCaps(settings, scheduled) {
  return scheduled
    ? { steps: clampOrOff(settings.scheduledContinueSteps, 1, 2000, 100), minutes: clampOrOff(settings.scheduledContinueMinutes, 1, 600, 30), tokens: 2_000_000 }
    : { steps: clampOrOff(settings.autoContinueSteps, 1, 2000, 500), minutes: clampOrOff(settings.autoContinueMinutes, 1, 600, 120), tokens: clampTokens(settings.autoContinueTokens) };
}
