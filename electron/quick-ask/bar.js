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
function fit() {
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

function keysText() {
  if (!asked) return 'Enter to send · Shift+Enter new line · Esc to close';
  if (answering) return 'Esc stops the answer · it stays in the chat';
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
  x.addEventListener('click', () => { if (shot?.kind === 'file') window.quickAsk.dropFile().catch(() => {}); shot = null; renderChip(); text.focus(); });
  if (img.src) chip.append(img);
  chip.append(label, x);
  host.append(chip);
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
  if (open) $('shot-item').focus();
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
  text.focus();
});

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
  text.focus();
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
  $('latest').hidden = true;
  $('card').hidden = true; $('card').replaceChildren();
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
  scheduleFit();
  row.querySelector('button')?.focus(); // after an error the focus is on the card's main button
}

const again = ['Try again', () => ask(question, [], true), 'ghost'];
const openBunny = ['Open in Bunny', () => openInBunny(), 'plain'];

function ended() { answering = false; chatReady = true; $('busy')?.remove(); setGo('send'); go.classList.remove('on'); refreshButtons(); }

function onAnswer(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'start') return;
  if (event.type === 'delta' && typeof event.text === 'string') { $('busy')?.remove(); answerText += event.text; showAnswer(true); return; }
  if (event.type === 'done' || event.type === 'stopped') {
    ended(); showAnswer(false); showCopy(true);
    if (event.type === 'done' && typeof event.model === 'string' && event.model) { $('meta').textContent = `Answered by ${event.model} · text only`; $('meta').hidden = false; }
    $('follow').disabled = false; $('follow').focus(); scheduleFit();
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
    else if (event.kind === 'none') card('bad', 'Bunny could not answer', "No model is connected yet. Connect a provider in Bunny's settings, then ask again.", [['Open Bunny settings', () => openInBunny('settings'), 'fill']]);
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
    const result = await window.quickAsk.ask(q, attachments);
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
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && chatReady) { e.preventDefault(); openInBunny(); }
});

text.addEventListener('input', () => { message(''); refresh(); });
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) { e.preventDefault(); send(); }
});

// Esc does one thing at a time: the + menu open, close it (focus back on +); an answer coming, stop it and keep what arrived; otherwise close the bar.
window.quickAsk.onEscape(() => {
  if (!$('menu').hidden) { closeMenu(); plus.focus(); window.quickAsk.escHandled().catch(() => {}); return; }
  if (answering) { window.quickAsk.stop().catch(() => {}); window.quickAsk.escHandled().catch(() => {}); return; }
  window.quickAsk.close().catch(() => {});
});
window.addEventListener('focus', () => { if (!asked) text.focus(); else if (!$('follow').disabled) $('follow').focus(); });
setGo('send');
refresh();
text.focus();
