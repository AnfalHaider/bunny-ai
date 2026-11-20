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

// QUICK-ASK (v0.1.14.2): when does Bunny look something up itself? A quick answer that ends with no look-up and a refusal ("I cannot browse", "I cannot see files", "open the full app", or the
// needs-window marker) is not shown as it is: if the question is about files on this PC, Bunny searches them itself (with Search this PC on) or says in its own words that the switch is off; any other question
// gets one web_search run by Bunny; either way the model is asked again with the results as labelled data. A real local action (delete, run, install, the screen...) is the only thing that gets the window card.
const ASKED_TO_SEARCH = /\b(search|google|look\s?up|browse|check|find\s?out)\b[\s\S]{0,40}\b(the\s+)?(internet|web|net|online)\b|\b(on|from)\s+the\s+(internet|web)\b|\bonline\b[\s\S]{0,20}\b(search|look)/i;
const REFUSAL = /\b(?:I|we|this (?:model|bar)|the (?:model|bar)|quick ask)\b[^.!?\n]{0,25}\b(?:can(?:no|'|’)t|cannot|can not|(?:am |is |are )?unable to|could not|couldn(?:'|’)t|do not have|don(?:'|’)t have|have no|only (?:support|supports|have|has|can))\b[^.!?\n]{0,70}\b(?:browse|search|see|access|look|read|files?|internet|web|tool|tools|computer|pc)\b|\bas an ai\b|\bopen (?:the |bunny(?:'|’)s |bunny )?(?:full |main )?(?:bunny )?(?:app|window)\b|\bfull (?:bunny )?(?:app|window)\b/i;
// a real local action: something Bunny would have to DO on this computer, which only Bunny's window may ask permission for
const LOCAL_ACTION = /\b(run|execute|install|uninstall|delete|remove|rename|move|copy|paste|screenshot|screen|terminal|command|script|commit|git|clipboard|click|type|keyboard)\b/i;
// a question about files on this computer (no verb needed)
const FILES_WORDS = /\b(files?|folders?|documents?|pdfs?|spreadsheets?|my (?:pc|computer|laptop|desktop|downloads|documents|photos|pictures)|this (?:pc|computer)|on (?:my|this) (?:pc|computer))\b|\b(?:find|search|look for|locate|where is|where's|where are)\b[\s\S]{0,40}\bmy\b/i;
export const realLocalAction = (text) => LOCAL_ACTION.test(String(text ?? ''));
export const isFileQuestion = (text) => FILES_WORDS.test(String(text ?? ''));
export const webCanAnswer = (text) => !realLocalAction(text) && !isFileQuestion(text);
export const askedToSearch = (text) => ASKED_TO_SEARCH.test(String(text ?? ''));
export const isRefusal = (text) => REFUSAL.test(String(text ?? ''));
/** The words to search for: the question without the "search the internet" asking. */
export const searchQueryOf = (text) => String(text ?? '').replace(/\b(please|pls)\b/gi, ' ').replace(/[,.]?\s*\b(search|google|look\s?up|browse|check)\s+(for\s+it\s+)?(on\s+)?(the\s+)?(internet|web|net|online)\b[.!?]*/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const STOP = new Set('find search look looking for my me the a an of in on at to from about with show open where is are and or it that this these those i can you could please last month week year today yesterday file files folder folders document documents pc computer laptop any all some every there here have has had do does did get give need want tell what which who how why when'.split(' '));
/** The words that are worth searching this PC for: a name, a code, an invoice number; the asking and the date words go. */
export const searchTermsOf = (text) => [...new Set(String(text ?? '').replace(/[^\p{L}\p{N}_.\-]+/gu, ' ').split(' ').map((w) => w.replace(/^[.\-_]+|[.\-_]+$/g, '')).filter((w) => w.length >= 2 && !STOP.has(w.toLowerCase())).map((w) => (w.length > 4 && /[^s]s$/i.test(w) ? w.slice(0, -1) : w)))].slice(0, 6);
// Bunny's own words, used whatever the model said
export const PC_OFF_TEXT = "Search this PC is off. Turn it on in Settings › Capabilities to let Bunny look for files on this computer. Nothing was searched.";
export const PC_MENU_TEXT = "Quick ask is not searching your files by itself right now. Choose Search this PC in the + menu under the box, then ask again. Nothing was searched.";

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
export function createAnswerer({ adminFetch, emit, onFinishedDetached = () => {}, getSettings = () => ({}) }) {
  let sessionId = null;
  let controller = null;
  let detached = false;
  const out = (event) => { if (!detached) emit(event); };
  // SEARCH-PC: what the bar is told about a search, as plain data (never a path, never file text)
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  const txt = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
  const sourcesOf = (list) => (Array.isArray(list) ? list : []).slice(0, 3).map((x) => ({ n: num(x?.n), name: txt(x?.name, 260), folder: txt(x?.folder, 400), part: txt(x?.part, 120), ref: txt(x?.ref, 80), openable: x?.openable === true }));
  const pcEvent = (d) => {
    const state = ['searching', 'results', 'none', 'unavailable', 'timeout', 'reading', 'unreadable', 'read'].includes(d.pcState) ? d.pcState : null;
    if (!state) return null;
    const base = { type: 'pc', state, excluded: num(d.pcExcluded) };
    if (state === 'results') return { ...base, title: txt(d.tool, 200), total: num(d.pcTotal), rows: (Array.isArray(d.pcResults) ? d.pcResults : []).slice(0, 50).map((r) => ({ ref: txt(r.ref, 80), name: txt(r.name, 260), folder: txt(r.folder, 400), modified: txt(r.modified, 40), snippet: txt(r.snippet, 220), openable: r.openable === true })) };
    if (state === 'reading') return { ...base, files: (Array.isArray(d.files) ? d.files : []).slice(0, 3).map((f) => txt(f, 260)) };
    if (state === 'unreadable') return { ...base, name: txt(d.name, 260), why: txt(d.why, 200) };
    if (state === 'read') return { ...base, sources: sourcesOf(d.pcSources) };
    return base;
  };
  const pcFlag = (pc) => { const s = getSettings() ?? {}; if (s.pcSearchEnabled !== true) return {}; return pc ? { pcSearch: 'force' } : (s.pcSearchBarAuto === false ? {} : { pcSearch: true }); };

  async function ensureSession(title) {
    if (sessionId) return sessionId;
    const res = await adminFetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: String(title).replace(/\s+/g, ' ').trim().slice(0, 60) || 'Quick ask', workMode: 'chat', origin: 'quick-ask' }) });
    const made = await res.json().catch(() => ({}));
    if (!res.ok || !UUID.test(String(made.id ?? ''))) throw Object.assign(new Error(made.message ?? 'Bunny could not start the chat.'), { code: made.code ?? 'chat.failed' });
    sessionId = made.id;
    return sessionId;
  }

  /** What the bar showed in place of a model's refusal is what the chat keeps as the reply, so a follow-up or Open in Bunny does not carry the refusal. Never throws; a failure leaves the chat as it was. */
  const keepAsReply = (id, content) => { adminFetch(`/api/sessions/${id}/quick-reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {}); };

  /** Ask (or follow up). Resolves when the answer has ended, one way or another. Never throws: every failure is an event. */
  async function ask({ text, files = [], pc = false }) {
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
    let doneSources = null;
    let lookups = 0;
    let retryKind = 'web';
    let lookupText = ''; // what Bunny's own web look-up found, from the server's `done`
    let pcRows = []; // the files Bunny's own search found, from the search events
    let fullText = ''; // everything the model said this round (shown or held), to tell a refusal from an answer
    try {
      const id = await ensureSession(text);
      out({ type: 'start', sessionId: id });
      for (let round = 0; round < 2; round += 1) {
      held = ''; shown = false; needs = false; needsText = ''; finished = false; doneSources = null; lookups = 0; fullText = ''; lookupText = ''; pcRows = [];
      const res = await adminFetch(`/api/sessions/${id}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        // text only: the server offers the model no tools; a screenshot or file goes as an ordinary attachment
        // SEARCH-PC: with the switch on, the bar may search this PC by itself (unless turned off in Settings) or when the person chose it in the + menu; the server honours it for this process only
        body: JSON.stringify({ content: text, workMode: 'chat', textOnly: true, ...(round === 1 ? (retryKind === 'pc' ? { pcLookupFirst: true, pcTerms: searchTermsOf(text) } : { lookupFirst: true, lookupQuery: searchQueryOf(text) || text }) : {}), ...pcFlag(pc), attachments: files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        out({ type: 'error', kind: classifyFailure({ status: res.status, code: body.code, message: body.message }), message: String(body.message ?? `Bunny answered ${res.status}`).slice(0, 400) });
        return { ok: true };
      }
      const decoder = new TextDecoder();
      let buffer = '';
      const push = (piece) => {
        fullText += piece;
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
          else if (ev.name === 'tool' && typeof ev.data?.pcState === 'string') { const p = pcEvent(ev.data); if (p) { out(p); if (p.state === 'results') pcRows = p.rows ?? []; } }
          else if (ev.name === 'done') { doneSources = ev.data?.pcSources; model = typeof ev.data?.model === 'string' ? ev.data.model : model; finished = true; lookups = num(ev.data?.lookups); lookupText = txt(ev.data?.lookupText, 4000); }
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
      // decide from the answer: no look-up and a refusal (or the marker, or the person asked to search and nothing was searched)
      const refused = finished && lookups === 0 ? (needs || isRefusal(fullText) || askedToSearch(text)) : needs;
      const settingsNow = getSettings() ?? {};
      const own = (kind, say) => { if (shown) out({ type: 'restart' }); out({ type: 'delta', text: say }); out({ type: 'done', model, finished: true, lookups: 0, sources: [], own: kind }); keepAsReply(id, say); };
      // the retry's answer is still a refusal: the model did not use what Bunny found, so Bunny shows it itself, sourced, instead of "open the full app"
      if (round === 1 && finished && (needs || isRefusal(fullText))) {
        const rows = pcRows.filter((r) => r && r.name).slice(0, 8);
        const said = retryKind === 'pc' ? (rows.length ? `I searched this PC and found ${rows.length === 1 ? 'one file' : `${rows.length} files`}: ${rows.map((r) => `${r.name}${r.folder ? ` (${r.folder})` : ''}`).join('; ')}.` : '')
          : (lookupText ? `Here is what the web search found (the model did not use it):\n\n${lookupText}` : '');
        if (said) { out({ type: 'restart' }); out({ type: 'delta', text: said }); out({ type: 'done', model, finished: true, lookups, sources: sourcesOf(doneSources) }); keepAsReply(id, said); return { ok: true }; }
      }
      if (round === 0 && refused && !realLocalAction(text)) {
        if (isFileQuestion(text)) {
          // about files on this PC: the person is told in Bunny's own words, or Bunny searches itself; the model's "open the full app" is never the answer
          if (settingsNow.pcSearchEnabled !== true) { held = ''; own('pc-off', PC_OFF_TEXT); return { ok: true }; }
          if (!pc && settingsNow.pcSearchBarAuto === false) { held = ''; own('pc-menu', PC_MENU_TEXT); return { ok: true }; }
          if (searchTermsOf(text).length) { retryKind = 'pc'; out({ type: 'restart' }); continue; }
        } else if (webCanAnswer(text)) { retryKind = 'web'; out({ type: 'restart' }); continue; }
      }
      if (!shown && !needs && held) { shown = true; out({ type: 'delta', text: held }); held = ''; }
      // the window card is for a real local action only: any other question that still ended in the marker is shown as the model's own words
      if (needs && !realLocalAction(text)) { out({ type: 'delta', text: needsText.replace(/^\s+/, '').slice(0, 600) || 'I could not answer that.' }); out({ type: 'done', model, finished: true, lookups, sources: sourcesOf(doneSources) }); }
      else if (needs) out({ type: 'needs-window', text: needsText.replace(/^\s+/, '').slice(0, 600) });
      else out({ type: 'done', model, finished, lookups, sources: sourcesOf(doneSources) });
      return { ok: true };
      }
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
