/**
 * LOCAL-MODELS T1, T2, T3 (Tech Lead's review of 521abb71): every model call goes through this wrapper.
 *  - T1: a call to Bunny local is counted while it runs, so the idle stop and a switch to another model wait for it, and each chunk keeps the server awake;
 *  - T2: a call that names no address (Bunny local is stopped: a scheduled run, a helper, another chat) says LM-18's sentence and starts nothing (R2-3);
 *  - T3: a call that names another local model than the one that runs is refused, never answered by the wrong model.
 */
import { LocalError } from './localModels.js';

export function trackLocalCalls({ streamChat, localModels, isFake = () => false }) {
  return async function* tracked(opts) {
    if (!opts.fake && !opts.baseUrl) throw new LocalError('local.notRunning', "Bunny local was stopped, so this run didn't use it.", 409);
    const mine = !opts.fake && Boolean(localModels.ownsAddress?.(opts.baseUrl));
    if (mine) {
      const runs = localModels.runningModelId?.();
      if (runs && opts.model && opts.model !== runs) throw new LocalError('local.notRunning', "Bunny local is running another model, so this run didn't use it.", 409);
    }
    const end = mine ? localModels.beginCall() : null;
    try { for await (const delta of streamChat(opts)) { if (mine) localModels.touch(); yield delta; } } finally { end?.(); }
  };
}
