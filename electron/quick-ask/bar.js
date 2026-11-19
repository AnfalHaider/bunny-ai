// The quick-ask bar's page. Text is only ever put in with textContent / .value, never as HTML. A model's reply is untrusted: it is only ever shown through the app's own
// sanitising markdown renderer, with every link made inert and every picture removed (the page's CSP also allows no network and no script but this one).
// QUICK-UI (v0.1.13): one airy pill; buttons appear only when they matter; the keys are a quiet line from the first keystroke; earlier turns stay, folded; a long answer can be read
// while it streams. Design: docs/design/review-v0113-quick-ask (version 2, option A).
import { renderMarkdown } from '../../src/ui/markdown.js';
const $ = (id) => document.getElementById(id);
const text = $('text');
const go = $('go');
const plus = $('plus');
const copyBtn = $('copy');
let shot = null; // { data, name?, kind? } a screenshot (a data:image/png URL) or a file the person chose, held only in this page until sent
let busy = false;

// the icons are fixed pictures of our own, read as an SVG document (never as HTML). The namespace is what makes DOMParser read them as SVG: without it they were unknown elements that measured 0 x 0.
const ICON = {
  send: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  stop: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
};
const picture = (svg) => document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true);
copyBtn.replaceChildren(picture(ICON.copy));

// kind 'busy': the normal sending moment (text colour, a small spinner). Anything else is a problem (amber).
function message(s, kind = 'problem') {
  const box = $('msg');
  box.replaceChildren();
  box.classList.toggle('is-problem', Boolean(s) && kind !== 'busy');
  if (s && kind === 'busy') {
    const spin = document.createElement('span');
    spin.className = 'spin';
    spin.setAttribute('aria-hidden', 'true');
    box.append(spin);
  }
  if (s) box.append(document.createTextNode(s));
  box.hidden = !s;
}

// ---- the window follows the pill ----
/**
 * Tell main how tall the content is, so the window is exactly as tall as the pill (its 8 px margin included), and a little taller while the + menu is open (main keeps it under
 * about 560 px and on the screen). Called whenever the content changes, and by a size observer, so no case is forgotten (the answer opening is eased, so it is followed frame by frame).
 */
const NOSCROLL = { preventScroll: true }; // a focus() must never scroll the overflow-hidden page: while the window is still short it would push the pill's top out of view
/** The page cannot be scrolled by the person (overflow hidden), only by the browser keeping something in view while the window is still short (the body is the scroller here): always show it from the top. */
function unscroll() {
  if (window.scrollY || document.scrollingElement?.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); if (document.scrollingElement) document.scrollingElement.scrollTop = 0; document.body.scrollTop = 0; }
}
document.addEventListener('scroll', unscroll, true); // body's own scroll does not bubble; the capture sees it
function fit() {
  unscroll();
  const pill = $('bar').getBoundingClientRect();
  const menu = $('menu').hidden ? null : $('menu').getBoundingClientRect();
  const bottom = Math.max(pill.bottom, menu ? menu.bottom : 0);
  window.quickAsk.resize(Math.ceil(bottom) + 8).catch(() => {});
}
let fitQueued = false;
function scheduleFit() { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); }
new ResizeObserver(scheduleFit).observe($('bar'));

// ---- the state of the pill ----
let answerText = '';
let question = '';
let answering = false;
let asked = false; // the first question has been sent: the bar is now an answer panel
let chatReady = false; // there is a chat to open in Bunny (an answer, or an error, has come)
let modelLine = ''; // "Answers with Auto · text only", when the app told us
const turns = []; // earlier questions and answers of this chat, folded above the current one

// What the card on screen allows: '' (an answer, a follow-up is possible), 'settings' (no model: the card's only action is Open Bunny settings), 'chat' (a card that can open the chat in Bunny)
let cardKind = '';

function keysText() {
  if (!asked) return 'Enter to send · Shift+Enter new line · Esc to close';
  if (answering) return 'Esc stops the answer · it stays in the chat';
  if (cardKind === 'settings') return 'Esc closes'; // nothing else works until a model is connected: no follow-up, no chat to open
  if (cardKind === 'chat') return 'Ctrl+Enter opens it in Bunny · Esc closes'; // a problem or "this needs Bunny's window": no follow-up, the card has the buttons
  return 'Enter sends a follow-up · Ctrl+Enter opens it in Bunny · Esc closes';
}

/** What shows: + and Send appear with the first keystroke (or an attachment); the keys line stays from then on; Stop while thinking; Copy once an answer is here. */
function refreshButtons() {
  const has = text.value.trim().length > 0 || Boolean(shot);
  if (!asked) {
    go.classList.toggle('on', has && !busy);
    plus.classList.toggle('on', has || !$('menu').hidden);
    $('hint').hidden = !has;
  } else {
    plus.classList.remove('on');
    $('hint').hidden = false;
  }
  $('keyline').textContent = keysText();
  $('modelline').textContent = modelLine;
  $('modelline').hidden = !modelLine;
}

function refresh() {
  text.style.height = '38px';
  text.style.height = `${Math.min(128, Math.max(38, text.scrollHeight))}px`;
  $('row').classList.toggle('top', text.scrollHeight > 44);
  refreshButtons();
  scheduleFit();
}

function renderChip() {
  const host = $('chips');
  host.replaceChildren();
  host.hidden = !shot;
  refreshButtons();
  if (!shot) return;
  const chip = document.createElement('span');
  chip.className = 'chip';
  const isFile = shot.kind === 'file';
  const img = document.createElement('img');
  img.alt = '';
  if (!isFile) img.src = shot.data;
  else if (shot.preview) img.src = shot.preview;
  const label = document.createElement('span');
  label.textContent = isFile ? shot.name : 'Screenshot';
  const x = document.createElement('button');
  x.type = 'button';
  x.setAttribute('aria-label', isFile ? 'Remove the file' : 'Remove the screenshot');
  x.textContent = '×';
  x.addEventListener('click', () => { if (shot?.kind === 'file') window.quickAsk.dropFile().catch(() => {}); shot = null; renderChip(); text.focus(NOSCROLL); });
  if (img.src) chip.append(img);
  chip.append(label, x);
  host.append(chip);
}

// ---- SEARCH-PC: the + menu's Search this PC, and the list of what was found (built with textContent only; the buttons name a result by its ref) ----
let forcePc = false;
let pcRows = [];
let pcChosen = 0;
const pcRowsEl = () => [...$('pc-list').querySelectorAll('.pcr')];
function pcChoose(i) {
  const rows = pcRowsEl();
  if (!rows.length) return;
  pcChosen = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('chosen', k === pcChosen));
  rows[pcChosen].scrollIntoView({ block: 'nearest' });
}
function pcMarked(parent, textValue, words) {
  const source = String(textValue ?? '');
  const lower = source.toLowerCase();
  const spans = [];
  for (const w of words) for (let at = lower.indexOf(w); at !== -1 && w; at = lower.indexOf(w, at + w.length)) spans.push([at, at + w.length]);
  spans.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [from, to] of spans) {
    if (from < pos) continue;
    if (from > pos) parent.append(document.createTextNode(source.slice(pos, from)));
    const m = document.createElement('mark'); m.textContent = source.slice(from, to); parent.append(m);
    pos = to;
  }
  if (pos < source.length) parent.append(document.createTextNode(source.slice(pos)));
}
function pcShowResults(event) {
  const list = $('pc-list');
  pcRows = Array.isArray(event.rows) ? event.rows : [];
  list.replaceChildren();
  const words = [...new Set((/“([^”]*)”/.exec(String(event.title ?? ''))?.[1] ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1))];
  const head = document.createElement('div'); head.className = 'pcs'; head.textContent = String(event.title ?? 'Searched this PC'); list.append(head);
  pcRows.slice(0, 8).forEach((r) => {
    const row = document.createElement('div'); row.className = 'pcr'; row.dataset.ref = r.ref;
    const n = document.createElement('div'); n.className = 'n'; n.textContent = r.name;
    const f = document.createElement('div'); f.className = 'f'; f.textContent = r.folder;
    row.append(n, f);
    if (r.snippet) { const sn = document.createElement('div'); sn.className = 'sn'; pcMarked(sn, r.snippet, words); row.append(sn); }
    const acts = document.createElement('div'); acts.className = 'pa';
    const add = (label, run) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { run(); }); acts.append(b); };
    add(r.openable ? 'Open' : 'Show in folder', () => (r.openable ? window.quickAsk.pcOpen(r.ref) : window.quickAsk.pcShow(r.ref)).then((x) => { if (x && x.ok === false) message(x.message || 'That did not work.'); }).catch(() => message('That did not work.')));
    add('Ask about this file', () => pcAsk(r));
    add('Copy path', () => window.quickAsk.pcCopy(r.ref).catch(() => message('That did not work.')));
    row.append(acts);
    list.append(row);
  });
  if (pcRows.length > 8) { const more = document.createElement('div'); more.className = 'pcs'; more.textContent = (pcRows.length - 8) + ' more: ask Bunny to narrow it (for example "only the PDFs", "from last year").'; list.append(more); }
  list.hidden = false;
  pcChoose(0);
  scheduleFit();
}
function pcAsk(r) { if (!answering) ask('Read “' + r.name + '” (ref ' + r.ref + ') and tell me what it says.', []); }
function pcKey(e) {
  if (!pcRowsEl().length || answering) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pcChoose(pcChosen + (e.key === 'ArrowDown' ? 1 : -1)); return true; }
  const r = pcRows[pcChosen];
  if (!r) return false;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pcAsk(r); return true; }
  if (e.key === 'Enter' && !e.shiftKey && !$('follow').value.trim()) { e.preventDefault(); (r.openable ? window.quickAsk.pcOpen(r.ref) : window.quickAsk.pcShow(r.ref)).catch(() => {}); return true; }
  return false;
}

function closeMenu() {
  $('menu').hidden = true;
  plus.setAttribute('aria-expanded', 'false');
  refreshButtons();
  scheduleFit();
}

plus.addEventListener('click', () => {
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  plus.setAttribute('aria-expanded', String(open));
  refreshButtons();
  fit(); // the window grows for the menu, then follows the pill again when it closes
  if (open) $('shot-item').focus(NOSCROLL);
});

$('shot-item').addEventListener('click', async () => {
  closeMenu();
  message('');
  try {
    const result = await window.quickAsk.captureScreenshot();
    if (result && result.ok && typeof result.data === 'string') { shot = { data: result.data }; renderChip(); }
    else message((result && result.message) || 'Bunny could not take a screenshot.');
  } catch {
    message('Bunny could not take a screenshot.');
  }
  text.focus(NOSCROLL);
});

$('pc-item').addEventListener('click', () => { closeMenu(); forcePc = true; message('Search this PC is on for this question.'); text.focus(NOSCROLL); });

$('file-item').addEventListener('click', async () => {
  closeMenu();
  message('');
  try {
    const result = await window.quickAsk.pickFile();
    if (result && result.ok && typeof result.id === 'string') { shot = { kind: 'file', id: result.id, name: String(result.name), preview: typeof result.preview === 'string' ? result.preview : undefined }; renderChip(); }
    else if (!(result && result.cancelled)) message((result && result.message) || 'Bunny could not add that file.');
  } catch {
    message('Bunny could not add that file.');
  }
  text.focus(NOSCROLL);
});

// ---- the answer, in place ----
let following = true; // the answer scrolls with what arrives until the reader scrolls up
let settingScroll = false;

/** A reply is untrusted text: render it with the app's sanitising markdown, then make links inert and drop pictures and anything interactive. */
function renderSafe(markdown) {
  const holder = document.createElement('div');
  holder.append(renderMarkdown(markdown, { foldCode: false }));
  for (const a of holder.querySelectorAll('a')) { const span = document.createElement('span'); span.textContent = a.textContent; span.title = a.getAttribute('href') ?? ''; a.replaceWith(span); }
  for (const el of holder.querySelectorAll('img, iframe, object, embed, script, link, form, input, button, video, audio')) el.remove();
  return holder;
}

/** Each code block gets a Copy button of our own (added after the renderer's own buttons were removed), which says "Copied" when it has copied. */
function addCodeCopy(root) {
  for (const pre of root.querySelectorAll('pre')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cpy';
    b.textContent = 'Copy';
    b.setAttribute('aria-label', 'Copy this code');
    b.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      navigator.clipboard?.writeText(code).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }).catch(() => {});
    });
    pre.append(b);
  }
}

function showAnswer(streaming) {
  const ans = $('ans');
  const holder = renderSafe(answerText);
  addCodeCopy(holder);
  const keep = ans.scrollTop;
  settingScroll = true;
  ans.replaceChildren(...holder.childNodes);
  if (streaming) { const c = document.createElement('i'); c.className = 'caret'; ans.append(c); }
  // follow the end only until the reader scrolls up: then the place is kept and "Latest" brings them back
  ans.scrollTop = following ? ans.scrollHeight : keep;
  requestAnimationFrame(() => { settingScroll = false; });
  $('latest').hidden = following || !streaming;
  scheduleFit();
}

$('ans').addEventListener('scroll', () => {
  if (settingScroll) return;
  const ans = $('ans');
  following = ans.scrollHeight - ans.scrollTop - ans.clientHeight < 24;
  if (following) $('latest').hidden = true;
  else if (answering) $('latest').hidden = false;
});
$('latest').addEventListener('click', () => { following = true; $('latest').hidden = true; $('ans').scrollTop = $('ans').scrollHeight; });

function setGo(kind) { // the round button at the right: Send, or Stop while an answer is coming
  go.replaceChildren(picture(kind === 'stop' ? ICON.stop : ICON.send));
  go.setAttribute('aria-label', kind === 'stop' ? 'Stop' : 'Send');
  go.classList.toggle('on', kind === 'stop');
}

function showCopy(on) { copyBtn.hidden = !on; }

function renderEarlier() {
  const host = $('earlier');
  const list = $('earlier-list');
  const open = $('earlier-toggle').getAttribute('aria-expanded') === 'true';
  host.hidden = turns.length === 0;
  $('earlier-toggle').textContent = `${open ? '▾' : '▸'} Earlier in this chat (${turns.length})`;
  list.replaceChildren();
  for (const t of turns) {
    const item = document.createElement('div');
    const q = document.createElement('div'); q.className = 'eq'; q.textContent = t.q;
    const a = document.createElement('div'); a.className = 'ea'; a.textContent = t.a.replace(/\s+/g, ' ').slice(0, 600);
    item.append(q, a);
    list.append(item);
  }
  list.hidden = host.hidden || !open;
  scheduleFit();
}
$('earlier-toggle').addEventListener('click', () => {
  $('earlier-toggle').setAttribute('aria-expanded', String($('earlier-toggle').getAttribute('aria-expanded') !== 'true'));
  renderEarlier();
});

function enterPanel(q) {
  asked = true;
  chatReady = false;
  following = true;
  plus.classList.remove('on');
  plus.hidden = true;
  text.hidden = true;
  let qEl = $('q');
  if (!qEl) { qEl = document.createElement('div'); qEl.id = 'q'; qEl.className = 'q'; text.after(qEl); }
  qEl.textContent = q;
  qEl.title = q; // a long question is cut to three lines; the whole of it is in the tooltip
  $('row').classList.add('top');
  $('chips').hidden = true;
  $('panel').hidden = false;
  $('panel-wrap').classList.add('on');
  $('ans').replaceChildren();
  $('pc-list').replaceChildren(); $('pc-list').hidden = true; pcRows = [];
  $('latest').hidden = true;
  $('card').hidden = true; $('card').replaceChildren();
  cardKind = '';
  $('foot').hidden = false;
  $('meta').hidden = true;
  const thinking = document.createElement('div'); thinking.className = 'think'; thinking.id = 'busy';
  const spin = document.createElement('span'); spin.className = 'spin'; thinking.append(spin, document.createTextNode('Bunny is thinking…'));
  $('ans').append(thinking);
  showCopy(false);
  setGo('stop');
  $('follow').value = ''; $('follow').disabled = true;
  refreshButtons();
  scheduleFit();
}

/** A card for what needs the person: a problem, or "this needs Bunny's window". `acts` are [label, handler, style]. */
function card(kind, title, bodyText, acts) {
  const c = $('card');
  c.replaceChildren();
  const box = document.createElement('div');
  box.className = `cardx ${kind}`;
  const t = document.createElement('div'); t.className = 't'; t.textContent = title;
  const b = document.createElement('div'); b.className = 'b'; b.textContent = bodyText;
  const row = document.createElement('div'); row.className = 'acts';
  for (const [label, handler, style] of acts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = style === 'ghost' ? 'ghostbtn' : `ob2${style === 'fill' ? ' fill' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', handler);
    row.append(btn);
  }
  box.append(t, b, row);
  c.append(box);
  c.hidden = false;
  if (!cardKind) cardKind = 'chat';
  $('foot').hidden = true; // in a problem state the card is the whole panel: no follow-up field and no second "Open in Bunny" under it
  refreshButtons();
  scheduleFit();
  row.querySelector('button')?.focus(NOSCROLL); // after an error the focus is on the card's main button
}

const again = ['Try again', () => ask(question, [], true), 'ghost'];
const openBunny = ['Open in Bunny', () => openInBunny(), 'plain'];

function ended() { answering = false; chatReady = true; $('busy')?.remove(); setGo('send'); go.classList.remove('on'); refreshButtons(); }

function onAnswer(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'start') return;
  if (event.type === 'results') { $('busy')?.remove(); pcShowResults(event); return; }
  if (event.type === 'step') { const l = $('pc-list'); const s2 = document.createElement('div'); s2.className = 'pcs'; s2.textContent = String(event.text ?? ''); l.append(s2); l.hidden = false; scheduleFit(); return; }
  if (event.type === 'delta' && typeof event.text === 'string') { $('busy')?.remove(); answerText += event.text; showAnswer(true); return; }
  if (event.type === 'done' || event.type === 'stopped') {
    ended(); showAnswer(false); showCopy(true);
    if (event.type === 'done' && typeof event.model === 'string' && event.model) { $('meta').textContent = `Answered by ${event.model} · text only`; $('meta').hidden = false; }
    $('follow').disabled = false; $('follow').focus(NOSCROLL); scheduleFit();
    return;
  }
  if (event.type === 'needs-window') {
    ended(); showCopy(true);
    answerText = typeof event.text === 'string' ? event.text : '';
    if (answerText) showAnswer(false); else $('ans').replaceChildren();
    card('warn', "This needs Bunny's window", "This needs a tool, and Bunny asks your permission for tools in its own window, never here. Nothing has been touched.", [['Open in Bunny', () => openInBunny(), 'fill']]);
    return;
  }
  if (event.type === 'error') {
    ended(); showCopy(false);
    const why = typeof event.message === 'string' ? event.message : '';
    if (event.kind === 'offline') card('warn', 'You are offline', 'Bunny could not reach a model. Your question is kept. Try again when the network is back, or open Bunny and it will send the question when it is.', [again, openBunny]);
    // no provider yet: Try again cannot work until one exists, so the card leads with the way to set one up
    else if (event.kind === 'none') { cardKind = 'settings'; chatReady = false; card('bad', 'Bunny could not answer', "No model is connected yet. Connect a provider in Bunny's settings, then ask again.", [['Open Bunny settings', () => openInBunny('settings'), 'fill']]); }
    else card('bad', 'Bunny could not answer', why || 'Something went wrong. Try again.', [again, openBunny]);
  }
}
window.quickAsk.onAnswer(onAnswer);

async function ask(q, attachments, retry = false) {
  // the earlier turn stays, folded, when a follow-up is asked (not when the same question is asked again)
  if (asked && !retry && (answerText || question)) { turns.push({ q: question, a: answerText }); renderEarlier(); }
  question = q;
  answerText = '';
  answering = true;
  enterPanel(q);
  try {
    const mode = forcePc ? 'search-pc' : undefined;
    forcePc = false;
    const result = await window.quickAsk.ask(q, attachments, mode);
    if (!(result && result.ok)) { ended(); card('bad', 'Bunny could not answer', (result && result.message) || 'Bunny could not start the answer.', [again, openBunny]); }
  } catch {
    ended(); card('bad', 'Bunny could not answer', 'Bunny could not start the answer.', [again, openBunny]);
  }
}

async function openInBunny(target) {
  try { await window.quickAsk.openInBunny(target); } catch { /* the bar stays */ }
}

async function send() {
  if (busy || answering || !text.value.trim()) return;
  busy = true;
  refresh();
  message('');
  const q = text.value.trim();
  const attachments = shot ? [shot.kind === 'file' ? { kind: 'file', id: shot.id } : shot] : []; // a file goes by its id only
  shot = null;
  busy = false;
  await ask(q, attachments);
}

$('follow').addEventListener('keydown', (e) => {
  if (pcKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
    e.preventDefault();
    const q = $('follow').value.trim();
    if (!q || answering) return;
    $('follow').value = '';
    ask(q, []);
  }
});
$('open').addEventListener('click', () => openInBunny());

// Send, then Stop while an answer comes in
go.addEventListener('click', () => {
  if (!asked) { send(); return; }
  if (answering) window.quickAsk.stop().catch(() => {});
});
// Copy says "Copied"
copyBtn.addEventListener('click', () => {
  navigator.clipboard?.writeText(answerText).then(() => {
    const said = document.createElement('span'); said.className = 'copied'; said.textContent = 'Copied'; said.setAttribute('role', 'status');
    copyBtn.before(said);
    setTimeout(() => said.remove(), 1500);
  }).catch(() => {});
});
// a link in a reply never goes anywhere
document.addEventListener('click', (e) => { if (e.target.closest?.('a')) e.preventDefault(); }, true);

// Ctrl+Enter opens the chat in Bunny, once there is one (an answer or an error)
document.addEventListener('keydown', (e) => {
  if (pcRowsEl().length && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return; // with a list shown, Ctrl+Enter asks about the chosen file
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && chatReady) { e.preventDefault(); openInBunny(); }
});

text.addEventListener('input', () => { message(''); refresh(); });
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) { e.preventDefault(); send(); }
});

// Esc does one thing at a time: the + menu open, close it (focus back on +); an answer coming, stop it and keep what arrived; otherwise close the bar.
window.quickAsk.onEscape(() => {
  if (!$('menu').hidden) { closeMenu(); plus.focus(NOSCROLL); window.quickAsk.escHandled().catch(() => {}); return; }
  if (answering) { window.quickAsk.stop().catch(() => {}); window.quickAsk.escHandled().catch(() => {}); return; }
  window.quickAsk.close().catch(() => {});
});
window.addEventListener('focus', () => { if (!asked) text.focus(NOSCROLL); else if (!$('follow').disabled) $('follow').focus(NOSCROLL); });
// ---- QUICK-UI 8 and 9: Bunny's theme and interface font, and which model answers ----
// The font files are the app's own bundled ones (src/ui/fonts, SIL OFL), read from the package: the page's policy allows fonts from its own folder only. Each key maps to a fixed
// family and fixed files here; main sends only the key, so nothing it sends can name a file or a style.
const STACK_SANS = '"Segoe UI", system-ui, sans-serif';
const STACK_SERIF = 'Georgia, "Times New Roman", serif';
const STACK_MONO = 'ui-monospace, Consolas, monospace';
const FONT_STACKS = {
  system: null,
  serif: 'Georgia, "Cambria", "Times New Roman", serif',
  sans: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  'inter': `"Bunny Inter", ${STACK_SANS}`, 'source-sans-3': `"Bunny Source Sans 3", ${STACK_SANS}`, 'ibm-plex-sans': `"Bunny IBM Plex Sans", ${STACK_SANS}`,
  'atkinson-hyperlegible': `"Bunny Atkinson Hyperlegible", ${STACK_SANS}`, 'lexend': `"Bunny Lexend", ${STACK_SANS}`, 'nunito': `"Bunny Nunito", ${STACK_SANS}`, 'quicksand': `"Bunny Quicksand", ${STACK_SANS}`,
  'lora': `"Bunny Lora", ${STACK_SERIF}`, 'literata': `"Bunny Literata", ${STACK_SERIF}`, 'source-serif-4': `"Bunny Source Serif 4", ${STACK_SERIF}`, 'noto-serif': `"Bunny Noto Serif", ${STACK_SERIF}`,
  'jetbrains-mono': `"Bunny JetBrains Mono", ${STACK_MONO}`, 'ibm-plex-mono': `"Bunny IBM Plex Mono", ${STACK_MONO}`,
};
const FONT_FACES = { // [family, weight, file]
  'inter': [['Bunny Inter', '400 700', 'inter-400-700']], 'source-sans-3': [['Bunny Source Sans 3', '400 700', 'source-sans-3-400-700']], 'ibm-plex-sans': [['Bunny IBM Plex Sans', '400 700', 'ibm-plex-sans-400-700']],
  'atkinson-hyperlegible': [['Bunny Atkinson Hyperlegible', '400', 'atkinson-hyperlegible-400'], ['Bunny Atkinson Hyperlegible', '700', 'atkinson-hyperlegible-700']],
  'lexend': [['Bunny Lexend', '400 700', 'lexend-400-700']], 'nunito': [['Bunny Nunito', '400 700', 'nunito-400-700']], 'quicksand': [['Bunny Quicksand', '400 700', 'quicksand-400-700']],
  'lora': [['Bunny Lora', '400 700', 'lora-400-700']], 'literata': [['Bunny Literata', '400 700', 'literata-400-700']], 'source-serif-4': [['Bunny Source Serif 4', '400 700', 'source-serif-4-400-700']],
  'noto-serif': [['Bunny Noto Serif', '400 700', 'noto-serif-400-700']], 'jetbrains-mono': [['Bunny JetBrains Mono', '400 700', 'jetbrains-mono-400-700']],
  'ibm-plex-mono': [['Bunny IBM Plex Mono', '400', 'ibm-plex-mono-400'], ['Bunny IBM Plex Mono', '600', 'ibm-plex-mono-600']],
};

function applyLook(look) {
  const root = document.documentElement;
  const theme = look && look.theme;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme; // anything else follows the system
  if (look && look.motion === 'reduced') root.dataset.motion = 'reduce'; else delete root.dataset.motion;
  const key = look && typeof look.font === 'string' && Object.hasOwn(FONT_STACKS, look.font) ? look.font : 'system';
  if (FONT_STACKS[key]) {
    const faces = (FONT_FACES[key] ?? []).map(([family, weight, file]) => `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url("../../src/ui/fonts/${file}.woff2") format("woff2"); }`).join('\n');
    if (faces) { const style = document.createElement('style'); style.id = 'bar-fonts'; style.textContent = faces; document.head.append(style); }
    root.style.setProperty('--font', FONT_STACKS[key]);
  }
  const model = look && typeof look.model === 'string' ? look.model.trim().slice(0, 60) : '';
  $('pc-item').hidden = !(look && look.pcSearch === true);
  modelLine = model ? `Answers with ${model} · text only` : '';
  refreshButtons();
}

const showPage = () => document.documentElement.removeAttribute('data-pending');
setTimeout(showPage, 300); // whatever happens, the bar shows itself
Promise.resolve(window.quickAsk.init?.()).then((look) => applyLook(look ?? {})).catch(() => {}).finally(showPage);

setGo('send');
refresh();
text.focus(NOSCROLL);
