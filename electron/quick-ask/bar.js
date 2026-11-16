// The quick-ask bar's page. Text is only ever put in with textContent / .value, never as HTML.
const $ = (id) => document.getElementById(id);
const text = $('text');
const go = $('go');
let shot = null; // { data } a data:image/png URL, held only in this page until sent
let busy = false;

function message(s) {
  $('msg').textContent = s || '';
  $('msg').hidden = !s;
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
  const img = document.createElement('img');
  img.alt = '';
  img.src = shot.data;
  const label = document.createElement('span');
  label.textContent = 'Screenshot';
  const x = document.createElement('button');
  x.type = 'button';
  x.setAttribute('aria-label', 'Remove the screenshot');
  x.textContent = '×';
  x.addEventListener('click', () => { shot = null; renderChip(); text.focus(); });
  chip.append(img, label, x);
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

async function send() {
  if (busy || !text.value.trim()) return;
  busy = true;
  refresh();
  message('Opening Bunny…');
  try {
    const result = await window.quickAsk.submit(text.value, shot ? [shot] : []);
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
