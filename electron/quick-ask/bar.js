// The quick-ask bar's page. Text is only ever put in with textContent / .value, never as HTML. A model's reply is untrusted: it is only ever shown through the app's own
// sanitising markdown renderer, with every link made inert and every picture removed (the page's CSP also allows no network and no script but this one).
import { renderMarkdown } from '../../src/ui/markdown.js';
const $ = (id) => document.getElementById(id);
const text = $('text');
const go = $('go');
let shot = null; // { data, name?, kind? } a screenshot (a data:image/png URL) or a file the person chose, held only in this page until sent
let busy = false;

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

function refresh() {
  go.classList.toggle('on', text.value.trim().length > 0 && !busy);
  text.style.height = '44px';
  text.style.height = `${Math.min(128, Math.max(44, text.scrollHeight))}px`;
}

function renderChip() {
  const host = $('chips');
  host.replaceChildren();
  host.hidden = !shot;
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
  $('plus').setAttribute('aria-expanded', 'false');
}

$('plus').addEventListener('click', () => {
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  $('plus').setAttribute('aria-expanded', String(open));
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

// ---- QA-ANSWERS: the answer, in place ----
let answerText = '';
let question = '';
let answering = false;
let asked = false; // the first question has been sent: the bar is now an answer panel
const ICON = {
  stop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
};

/** Tell main how tall the content is, so the bar grows to fit (main keeps it under about 560 px and on the screen). */
function fit() { window.quickAsk.resize(Math.ceil($('bar').getBoundingClientRect().height) + 20).catch(() => {}); }

/** A reply is untrusted text: render it with the app's sanitising markdown, then make links inert and drop pictures and anything interactive. */
function showAnswer(streaming) {
  const frag = renderMarkdown(answerText, { foldCode: false });
  const holder = document.createElement('div');
  holder.append(frag);
  for (const a of holder.querySelectorAll('a')) { const span = document.createElement('span'); span.textContent = a.textContent; span.title = a.getAttribute('href') ?? ''; a.replaceWith(span); }
  for (const el of holder.querySelectorAll('img, iframe, object, embed, script, link, form, input, button, video, audio')) el.remove();
  const ans = $('ans');
  ans.replaceChildren(...holder.childNodes);
  if (streaming) { const c = document.createElement('i'); c.className = 'caret'; ans.append(c); }
  ans.scrollTop = ans.scrollHeight;
  fit();
}

function topButton(kind) {
  const host = $('go');
  host.classList.remove('on');
  // the icons are fixed pictures of our own, read as an SVG document (never as HTML)
  const picture = (svg) => document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true);
  host.className = kind === 'stop' ? 'stop' : 'ibtn';
  host.setAttribute('aria-label', kind === 'stop' ? 'Stop' : 'Copy the answer');
  host.replaceChildren(picture(kind === 'stop' ? ICON.stop : ICON.copy));
}

function enterPanel(q) {
  asked = true;
  $('plus').hidden = true;
  const old = text; old.hidden = true;
  let qEl = $('q');
  if (!qEl) { qEl = document.createElement('div'); qEl.id = 'q'; qEl.className = 'q'; old.after(qEl); }
  qEl.textContent = q;
  $('hint').hidden = true;
  $('chips').hidden = true;
  $('panel').hidden = false;
  $('ans').replaceChildren();
  $('card').hidden = true; $('card').replaceChildren();
  $('meta').hidden = true;
  const busy = document.createElement('div'); busy.className = 'msg'; busy.id = 'busy';
  const spin = document.createElement('span'); spin.className = 'spin'; busy.append(spin, document.createTextNode('Bunny is thinking…'));
  $('ans').append(busy);
  topButton('stop');
  $('follow').value = ''; $('follow').disabled = true;
  fit();
}

function card(kind, title, bodyText, { tryAgain = false, fill = false } = {}) {
  const c = $('card');
  c.replaceChildren();
  const box = document.createElement('div');
  box.className = `cardx ${kind}`;
  const t = document.createElement('div'); t.className = 't'; t.textContent = title;
  const b = document.createElement('div'); b.className = 'b'; b.textContent = bodyText;
  const acts = document.createElement('div'); acts.className = 'acts';
  if (tryAgain) { const again = document.createElement('button'); again.type = 'button'; again.className = 'ghostbtn'; again.textContent = 'Try again'; again.addEventListener('click', () => ask(question, [], true)); acts.append(again); }
  const open = document.createElement('button'); open.type = 'button'; open.className = `ob${fill ? ' fill' : ''}`; open.textContent = 'Open in Bunny'; open.addEventListener('click', openInBunny);
  acts.append(open);
  box.append(t, b, acts);
  c.append(box);
  c.hidden = false;
  fit();
}

function onAnswer(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'start') return;
  if (event.type === 'delta' && typeof event.text === 'string') { $('busy')?.remove(); answerText += event.text; showAnswer(true); return; }
  if (event.type === 'done' || event.type === 'stopped') {
    answering = false; $('busy')?.remove(); showAnswer(false); topButton('copy');
    if (event.type === 'done' && typeof event.model === 'string' && event.model) { $('meta').textContent = `Answered by ${event.model} · text only`; $('meta').hidden = false; }
    $('follow').disabled = false; $('follow').focus(); fit();
    return;
  }
  if (event.type === 'needs-window') {
    answering = false; $('busy')?.remove(); topButton('copy');
    answerText = typeof event.text === 'string' ? event.text : '';
    if (answerText) showAnswer(false); else $('ans').replaceChildren();
    card('warn', "This needs Bunny's window", "This needs a tool, and Bunny asks your permission for tools in its own window, never here. Nothing has been touched.", { fill: true });
    return;
  }
  if (event.type === 'error') {
    answering = false; $('busy')?.remove(); topButton('copy');
    const why = typeof event.message === 'string' ? event.message : '';
    if (event.kind === 'offline') card('warn', 'You are offline', 'Bunny could not reach a model. Your question is kept. Try again when the network is back, or open Bunny and it will send the question when it is.', { tryAgain: true });
    else if (event.kind === 'none') card('bad', 'Bunny could not answer', "No model is connected yet. Connect a provider in Bunny's window, then ask again.", { tryAgain: true });
    else card('bad', 'Bunny could not answer', why || 'Something went wrong. Try again.', { tryAgain: true });
  }
}
window.quickAsk.onAnswer(onAnswer);

async function ask(q, attachments, again = false) {
  question = q;
  answerText = '';
  answering = true;
  enterPanel(q);
  try {
    const result = await window.quickAsk.ask(q, attachments);
    if (!(result && result.ok)) { answering = false; $('busy')?.remove(); card('bad', 'Bunny could not answer', (result && result.message) || 'Bunny could not start the answer.', { tryAgain: true }); }
  } catch {
    answering = false; $('busy')?.remove(); card('bad', 'Bunny could not answer', 'Bunny could not start the answer.', { tryAgain: true });
  }
}

async function openInBunny() {
  try { await window.quickAsk.openInBunny(); } catch { /* the bar stays */ }
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const q = $('follow').value.trim();
    if (!q || answering) return;
    $('follow').value = '';
    ask(q, []);
  }
});
$('open').addEventListener('click', openInBunny);
// the button at the top is Stop while an answer comes in, and Copy once it is here
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('#go');
  if (!b || !asked) return;
  if (answering) { window.quickAsk.stop().catch(() => {}); return; }
  navigator.clipboard?.writeText(answerText).catch(() => {});
}, true);
// a link in a reply never goes anywhere
document.addEventListener('click', (e) => { if (e.target.closest?.('a')) e.preventDefault(); }, true);


text.addEventListener('input', () => { message(''); refresh(); });
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
go.addEventListener('click', () => { if (!asked) send(); });
window.addEventListener('focus', () => text.focus());
refresh();
text.focus();
