// QA-ANSWERS: the Quick ask bar answers in place. This is the main-process side: it asks Bunny's own server for a TEXT-ONLY answer and hands plain events to the bar.
// Safety (Security, HIGH): the only tools offered are web_search and read_url, which only read the web (the request says textOnly, and the server then offers just those two and refuses any other); nothing in here can ask a permission; the bar only ever
// receives plain data (text, the model's name, a kind of failure), never anything it could run; and a reply that asks for a tool becomes a card that sends the person to Bunny's window.

export const NEEDS_WINDOW_MARKER = '[[NEEDS_BUNNY_WINDOW]]';
const UUID = /^[a-f0-9-]{36}$/;

/** Parse server-sent events out of a growing text. Returns the complete events and what is left over. */
export function parseSse(buffer) {
  const events = [];
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end < 0) break;
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    let name = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    let payload = null;
    try { payload = JSON.parse(data.join('\n')); } catch { payload = null; }
    events.push({ name, data: payload });
  }
  return { events, rest };
}

/** What kind of failure is this, for the card: the network is down, no model is set up, or something else (with its own plain reason). */
export function classifyFailure({ status = 0, code = '', reason = '', message = '' } = {}) {
  if (reason === 'unreachable' || code === 'network.offline' || code === 'chat.unreachable' || /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(String(message)) && !status) return 'offline';
  if (code === 'model.notSelected' || code === 'provider.notConnected') return 'none';
  return 'other';
}

/**
 * @param {object} o
 * @param {(path: string, init?: object) => Promise<Response>} o.adminFetch  Bunny's own server, as the window (main process only)
 * @param {(event: object) => void} o.emit  plain data to the bar
 * @param {(sessionId: string) => void} [o.onFinishedDetached]  an answer that finished after the person pressed Open in Bunny
 */
export function createAnswerer({ adminFetch, emit, onFinishedDetached = () => {} }) {
  let sessionId = null;
  let controller = null;
  let detached = false;
  const out = (event) => { if (!detached) emit(event); };

  async function ensureSession(title) {
    if (sessionId) return sessionId;
    const res = await adminFetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: String(title).replace(/\s+/g, ' ').trim().slice(0, 60) || 'Quick ask', workMode: 'chat', origin: 'quick-ask' }) });
    const made = await res.json().catch(() => ({}));
    if (!res.ok || !UUID.test(String(made.id ?? ''))) throw Object.assign(new Error(made.message ?? 'Bunny could not start the chat.'), { code: made.code ?? 'chat.failed' });
    sessionId = made.id;
    return sessionId;
  }

  /** Ask (or follow up). Resolves when the answer has ended, one way or another. Never throws: every failure is an event. */
  async function ask({ text, files = [] }) {
    if (controller) return { ok: false, message: 'Bunny is still answering.' };
    controller = new AbortController();
    const signal = controller.signal;
    detached = false;
    let held = ''; // text not yet shown: the first characters, until we know whether the reply is the "needs Bunny's window" marker
    let shown = false;
    let needs = false;
    let needsText = '';
    let model = null;
    let finished = false;
    try {
      const id = await ensureSession(text);
      out({ type: 'start', sessionId: id });
      const res = await adminFetch(`/api/sessions/${id}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        // text only: the server offers the model no tools; a screenshot or file goes as an ordinary attachment
        body: JSON.stringify({ content: text, workMode: 'chat', textOnly: true, attachments: files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        out({ type: 'error', kind: classifyFailure({ status: res.status, code: body.code, message: body.message }), message: String(body.message ?? `Bunny answered ${res.status}`).slice(0, 400) });
        return { ok: true };
      }
      const decoder = new TextDecoder();
      let buffer = '';
      const push = (piece) => {
        if (needs) { needsText += piece; return; }
        if (shown) { out({ type: 'delta', text: piece }); return; }
        held += piece;
        const probe = held.trimStart();
        if (probe.startsWith(NEEDS_WINDOW_MARKER)) { needs = true; needsText = probe.slice(NEEDS_WINDOW_MARKER.length); held = ''; return; }
        if (NEEDS_WINDOW_MARKER.startsWith(probe)) return; // it could still become the marker: wait for more
        shown = true;
        out({ type: 'delta', text: held });
        held = '';
      };
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.name === 'delta' && typeof ev.data?.text === 'string') push(ev.data.text);
          else if (ev.name === 'done') { model = typeof ev.data?.model === 'string' ? ev.data.model : model; finished = true; }
          else if (ev.name === 'error') {
            out({ type: 'error', kind: classifyFailure({ code: ev.data?.code, reason: ev.data?.reason, message: ev.data?.message }), message: String(ev.data?.message ?? 'Bunny could not answer.').slice(0, 400) });
            return { ok: true };
          } else if (ev.name === 'permission' || ev.name === 'question' || ev.name === 'capability') {
            // never answered here: the bar has no Allow button and no prompt. The request is dropped and the person is sent to Bunny's window.
            controller.abort();
            out({ type: 'needs-window', text: '' });
            return { ok: true };
          }
        }
      }
      if (!shown && !needs && held) { shown = true; out({ type: 'delta', text: held }); held = ''; }
      if (needs) out({ type: 'needs-window', text: needsText.replace(/^\s+/, '').slice(0, 600) });
      else out({ type: 'done', model, finished });
      return { ok: true };
    } catch (err) {
      if (signal.aborted) { out({ type: 'stopped' }); return { ok: true }; }
      out({ type: 'error', kind: classifyFailure({ message: err?.message, code: err?.code }), message: String(err?.message ?? 'Bunny could not answer.').slice(0, 400) });
      return { ok: true };
    } finally {
      controller = null;
      if (detached && sessionId) onFinishedDetached(sessionId);
    }
  }

  return {
    ask,
    /** Stop the answer. What arrived is kept by the server as the chat's reply. */
    stop() { if (controller) controller.abort(); },
    /** Open in Bunny: the answer goes on, but nothing more is sent to the bar; the window is told when it ends. */
    detach() { detached = true; },
    get sessionId() { return sessionId; },
    get answering() { return Boolean(controller); },
    /** A new bar session starts with no chat. (The chat itself is kept.) */
    reset() { sessionId = null; detached = false; },
  };
}
