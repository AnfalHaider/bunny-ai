/**
 * CLI-ENGINES §1.3: the event union every adapter produces, and the checks that keep a malformed event out of the rest of Bunny.
 *
 *   text {delta}  thinking {delta}  tool-start {callId, name, input, engineTool}  tool-end {callId, ok, output}
 *   approval {requestId, name, input}  question {requestId, text, options}  edit {path}  usage {input, output}
 *   session {engineSessionId}  done {stopReason}  error {code, message}
 *
 * An adapter that gets a line it cannot read, or an event of a kind it does not know, ends the run with an `error` (M6: nothing goes on unjudged).
 */

export const EVENT_TYPES = Object.freeze(['text', 'thinking', 'tool-start', 'tool-end', 'approval', 'question', 'edit', 'usage', 'session', 'done', 'error']);

/** Bunny's step names for what an engine does (§1.3 "Tool names"). */
export const STEP_NAMES = Object.freeze(['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'find_files']);

/** The longest a line from an engine may be (jsonl): 1 MB. */
export const MAX_LINE_BYTES = 1024 * 1024;

export class EngineEventError extends Error {
  constructor(message, code = 'engine.event') { super(message); this.name = 'EngineEventError'; this.code = code; }
}

const isText = (v, max = 200_000) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** Check an event; returns it, or throws EngineEventError. */
export function checkEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new EngineEventError('An engine event was not an object.');
  if (!EVENT_TYPES.includes(e.type)) throw new EngineEventError(`An engine event of an unknown kind ("${String(e.type).slice(0, 40)}") ended the run.`);
  const need = (ok, what) => { if (!ok) throw new EngineEventError(`An engine event (${e.type}) had a bad ${what}.`); };
  switch (e.type) {
    case 'text': case 'thinking': need(isText(e.delta), 'delta'); break;
    case 'tool-start': need(isId(e.callId), 'callId'); need(isId(e.name), 'name'); need(e.input === undefined || typeof e.input === 'object', 'input'); break;
    case 'tool-end': need(isId(e.callId), 'callId'); need(typeof e.ok === 'boolean', 'ok'); need(e.output === undefined || isText(e.output, 5_000_000), 'output'); break;
    case 'approval': need(isId(e.requestId), 'requestId'); need(isId(e.name), 'name'); break;
    case 'question': need(isId(e.requestId), 'requestId'); need(isText(e.text, 20_000), 'text'); need(e.options === undefined || Array.isArray(e.options), 'options'); break;
    case 'edit': need(isText(e.path, 4000) && e.path.length > 0, 'path'); break;
    case 'usage': need(Number.isFinite(e.input) && Number.isFinite(e.output), 'counts'); break;
    case 'session': need(isId(e.engineSessionId), 'session id'); break;
    case 'done': need(isText(e.stopReason ?? '', 200), 'stopReason'); break;
    case 'error': need(isText(e.message, 20_000), 'message'); break;
    default: break;
  }
  return e;
}

/** A queue that an adapter pushes events into and Bunny reads as an async iterable. `end()` finishes it; `fail(err)` ends it with an error for the reader. */
export function createEventQueue() {
  const items = []; const waiters = []; let ended = false; let failure = null; let hadError = false; let hadDone = false;
  const wake = () => { while (waiters.length) waiters.shift()(); };
  return {
    push(e) { if (ended) return; const ok = checkEvent(e); if (ok.type === 'error') hadError = true; if (ok.type === 'done') hadDone = true; items.push(ok); wake(); },
    end() { ended = true; wake(); },
    fail(err) { failure = err; ended = true; wake(); },
    get ended() { return ended; },
    get hadError() { return hadError; },
    get hadDone() { return hadDone; },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length) { yield items.shift(); continue; }
        if (failure) throw failure;
        if (ended) return;
        await new Promise((r) => waiters.push(r));
      }
    },
  };
}

/** Cut a result for the steps: `result` up to 1 200 characters (the page), `modelResult` up to 8 000 (what the model may keep), never a secret-looking one (§1.3 keepForModel is applied by the caller). */
export const cutResult = (text, max = 1200) => { const t = String(text ?? ''); return t.length > max ? `${t.slice(0, max)}…` : t; };
