// LOCAL-MODELS: the "Bunny local" card on the Providers page (design-local-models @ 4ee59efc). One module, five states: Not set up, Setting up, Ready, Running, and
// the plain errors. Every button is the window's alone: the server refuses a device (LM-13), and this page shows no button to a page that is not the window.
import { mountPlaces } from './local-places.js';
const GB = 1024 ** 3;
const gb = (n) => `${(n / GB).toFixed(1)} GB`; // one decimal everywhere, so the numbers on a card agree
const IDLE_LABEL = { 5: '5 minutes', 10: '10 minutes', 30: '30 minutes', 60: '60 minutes', 0: 'Only when Bunny closes' };
const STEPS = (mb) => [`Downloaded ${mb} MB from github.com`, 'Fingerprint checked: matches the one Bunny shipped with', 'Unpacking: only the expected files are allowed', 'Trying it on this PC'];
const BADGE = { fits: 'ok', 'fits-gpu': 'ok', tight: 'tight', slow: 'slow', 'too-big': 'big' };
const SHORT = { fits: 'Fits', 'fits-gpu': 'Fits', tight: 'Tight', slow: 'Slow', 'too-big': 'Too big' };
const mins = (sec) => (sec < 90 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`);

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-') || k === 'role') n.setAttribute(k, String(v)); else if (k === 'class') n.className = v; else n[k] = v;
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

export function mountLocalModels(root, { getJSON, sendJSON }) {
  let host = root;
  let status = null;
  let removing = false;
  let adding = false;
  let notice = '';
  let open = false;
  let timer = null;

  const bridge = typeof window !== 'undefined' ? (window.bunnyDesktop ?? window.parent?.bunnyDesktop)?.localModels ?? null : null;
  // the folders, the files from this PC and the download place (design 3c, 3d): the window's alone, so a page that is not the window simply gets no places
  const places = mountPlaces({
    getPlaces: () => sendJSON('/api/local-models/places', 'GET'), // window-only for reads too: in the desktop app this goes through the main process, which adds the secret
    onLoaded: () => { if (!status?.installed) paint(); }, post: (path, body) => sendJSON(`/api/local-models/places/${path}`, 'POST', body ?? {}),
    bridge, say: (t) => { notice = t; paint(); }, models: () => status?.models ?? [],
  });
  const act = async (path, method = 'POST', body = {}) => {
    try { status = await sendJSON(`/api/local-models${path}`, method, body); notice = ''; }
    catch (err) { notice = err.message ?? 'That did not work.'; }
    paint();
    schedule();
    places.refresh();
  };
  const button = (text, onclick, cls = 'ghost small', extra = {}) => el('button', { type: 'button', class: cls, textContent: text, onclick, ...extra });

  function schedule() {
    clearTimeout(timer);
    const busy = status && (status.setup || status.models.some((m) => m.state === 'downloading'));
    if (busy) timer = setTimeout(refresh, 500);
  }
  async function refresh() {
    try { status = await getJSON('/api/local-models'); } catch { /* the card keeps what it has */ }
    paint();
    schedule();
    places.refresh();
  }

  function row(title, sub, ...right) {
    return el('div', { class: 'row lm-row' }, el('div', { class: 'meta-col' }, el('div', { class: 'name', textContent: title }), sub ? el('div', { class: 'desc', textContent: sub }) : null), el('div', { class: 'right' }, ...right));
  }

  function modelRow(m) {
    const meta = el('div', { class: 'lm-meta' },
      el('span', { class: `lm-fit ${BADGE[m.fit]}`, textContent: SHORT[m.fit] }),
      el('span', { class: 'tag', textContent: gb(m.size) }), el('span', { class: 'tag', textContent: m.licence }), el('span', { class: 'tag', textContent: m.publisher }),
      el('span', { class: 'tag', textContent: m.tools ? 'Uses tools' : 'Chat only' }));
    const acts = el('div', { class: 'lm-acts' });
    const id = { id: m.id };
    if (m.state === 'downloading') acts.append(button('Pause', () => act('/pause', 'POST', id), 'btn'), button('Cancel', () => act('/cancel', 'POST', id), 'btn'));
    else if (m.state === 'paused') acts.append(button('Resume', () => act('/resume', 'POST', id), 'btn btn-primary'), button('Cancel', () => act('/cancel', 'POST', id), 'btn'));
    else if (m.state === 'ready') acts.append(el('span', { class: 'tag lm-ready', textContent: 'Ready' }), button('Delete', () => act(`/${m.id}`, 'DELETE'), 'btn', { 'aria-label': `Delete ${m.name}` }));
    else acts.append(button(/fingerprint/.test(m.error ?? '') ? 'Download again' : 'Download', () => act('/download', 'POST', id), 'btn btn-primary', { disabled: !m.canDownload || m.changedOnHub, 'aria-label': `${/fingerprint/.test(m.error ?? '') ? 'Download again' : 'Download'} ${m.name}` }));
    const lines = [];
    if (m.state === 'downloading' || m.state === 'paused') {
      lines.push(el('div', { class: 'lm-prog', role: 'progressbar', 'aria-valuenow': Math.round((m.done / m.size) * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${Math.round((m.done / m.size) * 100)}%` })));
      const speed = m.state === 'downloading' && m.speedBps ? ` · ${Math.round(m.speedBps / 1048576)} MB/s · about ${mins((m.size - m.done) / m.speedBps)} left` : '';
      lines.push(el('small', { class: 'desc', textContent: `${m.state === 'paused' ? 'Paused at ' : ''}${gb(m.done)} of ${gb(m.size)}${speed}${m.state === 'paused' ? '. Picks up where it stopped, even after Bunny restarts' : ''}` }));
    } else if (m.changedOnHub) lines.push(el('small', { class: 'lm-warn', textContent: 'This model changed on Hugging Face. Bunny will offer it again after an update.' }));
    else if (m.error) lines.push(el('small', { class: 'lm-err', textContent: m.error }));
    else if (m.state === 'ready') lines.push(el('small', { class: 'desc', textContent: `Checked · fingerprint ${m.fingerprint}` }));
    else if (m.fit === 'too-big') lines.push(el('small', { class: 'desc', textContent: `Too big for this PC: needs about ${gb(m.needBytes)} free, ${gb(m.availBytes)} is available` }));
    else if (m.fit === 'slow' || m.fit === 'tight' || m.fit === 'fits-gpu') lines.push(el('small', { class: 'desc', textContent: m.fitText }));
    if (m.toolsNote) lines.push(el('small', { class: 'desc', textContent: m.toolsNote }));
    return el('div', { class: `lm-model${m.fit === 'too-big' ? ' dis' : ''}`, 'data-model': m.id }, el('div', { class: 'lm-head' }, el('div', { class: 'lm-l' }, el('b', { textContent: m.name }), meta), acts), ...lines);
  }

  function paint() {
    host.replaceChildren();
    if (!status) return;
    const s = status;
    const label = s.installed ? (open ? 'Close' : 'Manage') : (open ? 'Close' : 'Set up');
    host.append(el('div', { class: 'row lm-provider-row' },
      el('div', { class: 'meta-col' }, el('div', { class: 'name' }, document.createTextNode('Bunny local '), el('span', { class: 'tag lm-new', textContent: 'New' })), el('div', { class: 'desc', textContent: 'Models Bunny downloads and runs on this PC. No key, no account' })),
      el('div', { class: 'right' }, el('span', { class: 'tag', textContent: 'Managed' }), el('button', { type: 'button', class: 'btn btn-primary', textContent: label, 'aria-expanded': String(open), 'aria-controls': 'lm-body', onclick: () => { open = !open; paint(); } }))));
    if (!open) return;
    const body = el('div', { class: 'lm-body', id: 'lm-body' });
    const real = host;
    host = body; // everything below is the card under the row
    try { card(s); } finally { host = real; real.append(body); }
  }

  function card(s) {
    for (const a of s.alerts ?? []) {
      host.append(el('div', { class: 'lm-card warn', 'data-alert': a.kind, role: 'alert' }, el('b', { textContent: a.title }), el('div', { class: 'desc', textContent: a.body }),
        el('div', { class: 'lm-acts' }, button(a.action, async () => { await act('/fake', 'POST', { raise: 'none' }); await act('/setup'); }, 'btn btn-primary'), button('Not now', () => { notice = ''; paint(); }, 'btn'))));
    }
    if (s.installed && !s.setup) host.append(el('div', { class: 'desc lm-state', textContent: (s.alerts ?? []).length ? `Not ready: ${s.alerts[0].kind === 'missing' ? "the program isn't installed" : 'the program changed on disk'}` : s.running ? `Running ${s.running.name}, using about ${gb(s.running.usedBytes)}` : `Ready · Runs on: ${s.runtime.backend === 'vulkan' && s.runtime.useGpu ? 'graphics card (Vulkan)' : 'CPU'}` }));
    if (notice) host.append(el('div', { class: 'lm-err', role: 'alert', textContent: notice }));
    if (removing) { host.append(removeCard()); return; }

    if (s.setup) {
      const list = el('ol', { class: 'lm-steps' });
      STEPS(s.program.sizeMB).forEach((text, i) => list.append(el('li', { class: i + 1 < s.setup.step ? 'done' : i + 1 === s.setup.step ? 'now' : 'wait', textContent: `${i + 1 < s.setup.step ? '✓ ' : ''}${text}` })));
      host.append(el('div', { class: 'lm-card' }, el('b', { textContent: 'Setting up' }), el('div', { class: 'lm-prog', role: 'progressbar', 'aria-valuenow': (s.setup.step - 1) * 25, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${(s.setup.step - 1) * 25 + 12}%` })), list, button('Cancel', () => act('/setup', 'DELETE'), 'btn')));
      return;
    }
    if (!s.installed) {
      for (const line of places.removalLines()) host.append(el('div', { class: 'lm-warn lm-removal', role: 'status', textContent: line }));
      host.append(el('div', { class: 'lm-card' },
        el('b', { textContent: 'Set up Bunny local' }),
        el('div', { class: 'desc', textContent: `Bunny downloads a ${s.program.sizeMB} MB program (${s.program.name}) from its ${s.program.from}, checks its fingerprint, and keeps it in its own folder. Chats with a local model stay on this PC, and downloads talk only to GitHub (the program) and Hugging Face (models).` }),
        el('div', { class: 'lm-meta' }, el('span', { class: 'tag', textContent: `${s.program.sizeMB} MB` }), el('span', { class: 'tag', textContent: `${s.program.licence} licence` }), el('span', { class: 'tag', textContent: s.program.host }), s.program.signed ? null : el('span', { class: 'tag lm-unsigned', textContent: 'Not signed' })),
        s.program.signed ? null : el('div', { class: 'lm-card warn lm-unsigned-note', textContent: "This program from llama.cpp isn't signed by its publisher. Bunny checks every file against a fixed fingerprint instead." }),
        s.fake ? el('div', { class: 'lm-note', textContent: 'Test mode: nothing is really downloaded. The models below are invented.' }) : null,
        button('Set up Bunny local', () => act('/setup'), 'btn btn-primary')));
      return;
    }

    const p = s.pc;
    host.append(el('div', { class: 'desc lm-pc', textContent: `This PC: ${gb(p.totalRam)} memory (${gb(p.freeRam)} free)${p.vram ? ` · graphics card, ${gb(p.vram)} (${gb(p.freeVram)} free)` : ''} · ${gb(p.freeDisk)} free on the data drive` }));
    const sw = el('input', { type: 'checkbox', checked: s.runtime.useGpu, 'aria-label': 'Use graphics card', onchange: (e) => act('/settings', 'POST', { useGpu: e.target.checked }) });
    const idle = el('select', { 'aria-label': 'Stop after idle', onchange: (e) => act('/settings', 'POST', { idleMinutes: Number(e.target.value) }) });
    for (const m of s.runtime.idleChoices) idle.append(el('option', { value: String(m), textContent: IDLE_LABEL[m], selected: m === s.runtime.idleMinutes }));
    host.append(el('div', { class: 'group lm-group' },
      row('Use graphics card', s.runtime.backend === 'vulkan' ? 'Runs on: graphics card (Vulkan). Off uses only the processor: slower, but works on every PC' : 'Runs on: CPU', el('label', { class: 'switch' }, sw)),
      row('Stop after idle', 'Frees memory when you stop chatting', idle)));
    if (s.running) host.append(el('div', { class: 'lm-running-line' }, el('small', { class: 'desc', textContent: `Stops by itself after ${IDLE_LABEL[s.runtime.idleMinutes].toLowerCase()} idle` }), button('Stop now', () => act('/stop'), 'btn')));
    host.append(el('div', { class: 'lm-sub', textContent: 'Models' }));
    host.append(el('div', { class: 'group lm-group lm-models' }, ...s.models.map(modelRow),
      row("A model that isn't on this list", "Only from a publisher you trust. Gated models and private logins aren't supported", button('Add by name…', () => { adding = !adding; paint(); }, 'btn'))));
    if (adding) host.append(addCard());
    if (!places.loaded()) { // no places view (test mode, or a page that is not the window): the one plain row, with no path
      const dl = typeof window !== 'undefined' ? (window.bunnyDesktop ?? window.parent?.bunnyDesktop) : null;
      host.append(el('div', { class: 'group lm-group' }, row('Where models are kept', "Bunny's own folder", el('span', { class: 'tag', textContent: s.usedBytes ? `${gb(s.usedBytes)} used` : 'Nothing downloaded yet' }),
        dl?.localModels ? button('Show in folder', async () => { try { const r = await dl.localModels.showFolder(); if (r && !r.ok) { notice = r.message; paint(); } } catch { notice = 'The folder could not be opened.'; paint(); } }, 'btn') : el('small', { class: 'desc', textContent: "Show in folder: Bunny's window only" }))));
    }
    host.append(places.el);
    host.append(el('div', { class: 'desc lm-foot', textContent: 'Chats with a local model stay on this PC. Downloads talk only to Hugging Face and GitHub. Only this window can set up, download, add, start, stop or delete: not a phone, not another PC, and not Bunny itself.' }));
    host.append(el('div', { class: 'group lm-group lm-remove-row' }, row('Remove Bunny local', 'Deletes the program, every downloaded model and the cache', button('Remove…', () => { removing = true; paint(); }, 'btn btn-danger'))));
  }

  function addCard() {
    return el('div', { class: 'lm-card warn', 'data-card': 'not-on-list' },
      el('b', { textContent: "Add a model that isn't on Bunny's list?" }),
      el('div', { class: 'desc', textContent: "Not on Bunny's list. A model file can carry an attack on the program that loads it, and its chat template is code Bunny has not read. Add one only from a publisher you trust." }),
      el('div', { class: 'desc', textContent: 'Adding a model by its repository name is not part of this version. Bunny shows this card so you can see how it will work: the repository, the exact version, the file, its size and fingerprint, and the licence tag come first.' }),
      el('div', { class: 'lm-acts' }, button("Don't add", () => { adding = false; paint(); }, 'btn btn-primary'), button('Add anyway', () => {}, 'btn', { disabled: true, title: 'Not available in this version' })));
  }

  function removeCard() {
    const ready = status.models.filter((m) => m.state === 'ready');
    const total = ready.reduce((n, m) => n + m.size, 0);
    return el('div', { class: 'lm-card warn', 'data-card': 'remove' },
      el('b', { textContent: 'Remove Bunny local?' }),
      el('div', { class: 'desc', textContent: `This deletes the program and ${ready.length} downloaded model${ready.length === 1 ? '' : 's'} (${gb(total)}). You can set it up and download them again later.` }),
      ...places.whereDownloads().map((w) => el('div', { class: 'desc lm-where', textContent: `${gb(w.bytes)} in ${w.folder}` })),
      el('div', { class: 'desc', textContent: 'Only files Bunny downloaded are deleted, and only if they are still the file it saved. Your own model files and the folders you added are never touched.' }),
      el('div', { class: 'lm-acts' }, button('Remove everything', async () => { removing = false; await act('', 'DELETE'); }, 'btn btn-danger'), button('Keep it', () => { removing = false; paint(); }, 'btn btn-primary')));
  }

  return { refresh: async () => { await refresh(); await places.refresh(); } };
}
