// The quick-ask bar's page. Text is only ever put in with textContent / .value, never as HTML.
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

async function send() {
  if (busy || !text.value.trim()) return;
  busy = true;
  refresh();
  message('Opening Bunny…', 'busy');
  try {
    const result = await window.quickAsk.submit(text.value, shot ? [shot.kind === 'file' ? { kind: 'file', id: shot.id } : shot] : []); // a file goes by its id only
    if (result && result.ok) return; // the bar is closed by the app
    message((result && result.message) || 'Bunny could not open.');
  } catch {
    message('Bunny could not open.');
  }
  busy = false;
  refresh();
}

text.addEventListener('input', () => { message(''); refresh(); });
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
go.addEventListener('click', send);
window.addEventListener('focus', () => text.focus());
refresh();
text.focus();
