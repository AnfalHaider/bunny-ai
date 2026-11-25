// FOLDER-RULES v4 + ONE-INSTRUCTIONS (v0.1.15, Design's drawing v4): the folder's instruction files, one set for every engine, frozen when the person says Follow them.
// This file draws: the trust card in the chat, the "Project instructions" block of the Working folder card, "View what was read", and Read again (the diff first, then Use the new text or Keep the old text).
// Everything comes from the server's view (GET /api/sessions/:id/folder-rules); the answers (Follow them, Read again, Ask me again, the chat's own switch) are Bunny's window's alone, and a device page shows them
// as "answer this on the PC". Nothing here reads a file itself.
import { getJSON, sendJSON } from './api.js';

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'className') n.className = v; else if (k === 'textContent') n.textContent = v; else if (k === 'role' || k.startsWith('aria-') || k.startsWith('data-')) n.setAttribute(k, String(v)); else n[k] = v; } n.append(...kids.filter((c) => c !== null && c !== undefined && c !== false)); return n; };
const btn = (label, props = {}) => el('button', { type: 'button', textContent: label, ...props });
const kb = (n) => (n < 1024 ? `${Math.max(1, Math.round(n))} B` : `${Math.round((n / 1024) * 10) / 10} KB`);
export const DEVICE_NOTE = 'Answer this on the PC.';

/** The chip of one file in the list, in the drawing's words. `view` carries what the server says. { text, tone: 'ok' | 'warn' | '' } */
export function fileChip(file) {
  if (file.state === 'off') return { text: 'switched off', tone: '' };
  if (file.state === 'waiting') return { text: 'waiting for you', tone: 'warn' };
  if (file.state === 'changed') return { text: 'changed since it was read', tone: 'warn' };
  if (file.state === 'gone') return { text: 'no longer on disk', tone: 'warn' };
  return { text: file.kind === 'main' ? 'in use' : 'added', tone: 'ok' };
}
/** The note under the list, by where the folder stands. */
export function blockNote(view, { engineId = 'bunny' } = {}) {
  const files = view?.files ?? [];
  if (!view?.enabled) return 'Switched off in Settings, so no engine gets them.';
  if (view.chatSwitch === false) return 'Switched off for this chat, so no engine gets them.';
  if (!view.trusted) return files.length ? 'Not followed yet, so no engine gets them.' : '';
  const parts = [];
  if (files.some((f) => f.state === 'changed')) parts.push('A followed file changed on disk. Every engine still gets the text it was shown. Read again to look at the change.');
  else if (files.some((f) => f.state === 'gone')) parts.push('A followed file is no longer on disk. Every engine still gets the text it was shown. Read again to look at it.');
  else parts.push('Followed for this folder.');
  if (files.some((f) => f.state === 'waiting')) parts.push('A new file is waiting for your answer.');
  if (engineId !== 'bunny') parts.push(`This chat runs on ${engineId === 'codex' ? 'Codex CLI' : 'Claude Code'}. It gets the same text as Bunny and the other engine.`);
  return parts.join(' ');
}

export const loadView = (sid) => getJSON(`/api/sessions/${sid}/folder-rules`);

function modal(label) {
  const backdrop = el('div', { className: 'modal-backdrop' });
  const box = el('div', { className: 'modal folder-rules-modal', role: 'dialog', 'aria-label': label });
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  backdrop.append(box);
  document.body.append(backdrop);
  return { box, close };
}

/** View what was read: the exact text the engines are sent, per file, read only. */
export async function openViewRead(sid, startName = null) {
  const { box, close } = modal('What this chat was given');
  let data;
  try { data = await getJSON(`/api/sessions/${sid}/folder-rules?text=1`); } catch (err) { box.append(el('p', { className: 'modal-sub', textContent: err.message })); return; }
  const shown = data.read ?? [];
  const view = el('pre', { className: 'fr-view' });
  const tabs = el('div', { className: 'fr-tabs' });
  const show = (f) => { view.textContent = `# ${f.name}${f.cut ? ' (the first 32 KB)' : ''}\n${f.text}`; for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.name === f.name)); };
  for (const f of shown) { const b = btn(f.name, { className: 'fr-tab', 'data-name': f.name }); b.addEventListener('click', () => show(f)); tabs.append(b); }
  const first = shown.find((f) => f.name === startName) ?? shown[0];
  if (first) show(first); else view.textContent = 'Nothing was read yet: no file is followed in this folder.';
  box.append(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'What this chat was given' }),
    el('p', { className: 'modal-sub', textContent: 'One text, the same for Bunny, Claude Code and Codex CLI. If a file in the folder changes, Read again shows the difference first.' })),
    el('div', { className: 'modal-body' }, tabs, view), el('div', { className: 'modal-foot' }, btn('Close', { className: 'btn btn-primary', onclick: close })));
}

/** A small line diff (LCS) of two texts: [{ t: ' ' | '-' | '+', s }]. For files of instruction size. */
export function lineDiff(a, b) {
  const x = String(a ?? '').split('\n'); const y = String(b ?? '').split('\n');
  if (x.length * y.length > 400_000) return [...x.map((s) => ({ t: '-', s })), ...y.map((s) => ({ t: '+', s }))];
  const n = x.length; const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { out.push({ t: ' ', s: x[i] }); i += 1; j += 1; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ t: '-', s: x[i] }); i += 1; } else { out.push({ t: '+', s: y[j] }); j += 1; } }
  while (i < n) { out.push({ t: '-', s: x[i] }); i += 1; }
  while (j < m) { out.push({ t: '+', s: y[j] }); j += 1; }
  return out;
}

/** Read again: the diff first, per file, then "Use the new text" or "Keep the old text". onDone() after an answer. */
export async function openReadAgain(sid, onDone = () => {}) {
  const { box, close } = modal('Read again');
  let d;
  try { d = await getJSON(`/api/sessions/${sid}/folder-rules/diff`); } catch (err) { box.append(el('p', { className: 'modal-sub', textContent: err.message })); return; }
  const status = el('div', { className: 'modal-sub', role: 'status' });
  const body = el('div', { className: 'modal-body' });
  const changed = d.files.some((f) => f.status !== 'same');
  if (!changed && !d.added.length) body.append(el('p', { className: 'es-p', textContent: 'Nothing changed: the files in the folder are the same as the text Bunny was given.' }));
  for (const f of d.files) {
    const head = el('div', { className: 'fr-dh' }, el('b', { textContent: f.name }), el('span', { className: `fr-chip ${f.status === 'same' ? 'ok' : 'warn'}`, textContent: f.status === 'same' ? 'same' : f.status === 'removed' ? 'will no longer be followed' : 'changed' }));
    body.append(head);
    if (f.status === 'changed') { const pre = el('pre', { className: 'fr-diff' }); for (const row of lineDiff(f.frozen, f.now)) pre.append(el('div', { className: `fr-l fr-${row.t === '+' ? 'add' : row.t === '-' ? 'del' : 'same'}`, textContent: `${row.t} ${row.s}` })); body.append(pre); }
    if (f.status === 'removed') body.append(el('p', { className: 'modal-sub', textContent: 'The file is gone from the folder. Until you choose, every engine still gets the text it was shown.' }));
  }
  if (d.added.length) body.append(el('p', { className: 'modal-sub', textContent: `New files, not followed yet (Read again never adds them): ${d.added.map((f) => f.name).join(', ')}. Choose Follow them to add them.` }));
  const answer = async (use) => {
    status.textContent = '';
    try {
      const shas = {}; for (const f of d.files) if (f.nowSha256) shas[f.name] = f.nowSha256;
      await sendJSON(`/api/sessions/${sid}/folder-rules/read-again`, 'POST', { use, shas });
      close(); onDone(use);
    } catch (err) { status.textContent = err.message; }
  };
  const keep = btn('Keep the old text', { className: 'btn btn-ghost', onclick: () => answer('old') });
  const use = btn('Use the new text', { className: 'btn btn-primary', onclick: () => answer('new') });
  use.disabled = !changed;
  box.append(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'Read again' }),
    el('p', { className: 'modal-sub', textContent: 'The text in use is shown against the files in the folder now. Nothing changes until you choose.' })),
    body, status, el('div', { className: 'modal-foot' }, btn('Close', { className: 'btn btn-ghost', onclick: close }), keep, use));
}

/** The question "This folder has instruction files": the files with their text to read, then Follow them or Not now. Resolves true when followed. */
export async function openFollowCard(sid) {
  const view = await loadView(sid);
  const diff = await getJSON(`/api/sessions/${sid}/folder-rules/diff`);
  const texts = new Map(diff.added.map((f) => [f.name, f]));
  const waiting = view.files.filter((f) => f.state === 'waiting');
  return new Promise((resolve) => {
    const { box, close } = modal('This folder has instruction files');
    const done = (v) => { close(); resolve(v); };
    const status = el('div', { className: 'modal-sub', role: 'status' });
    const list = el('div', { className: 'fr-files' });
    const reader = el('pre', { className: 'fr-view', hidden: true });
    for (const f of waiting) {
      const row = el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: f.name }), el('small', { textContent: kb(f.size) }), el('span', { className: `fr-chip ${f.kind === 'main' ? 'ok' : ''}`, textContent: f.kind === 'main' ? 'main file' : 'added' }));
      const read = btn('Read', { className: 'lnk', onclick: () => { const t = texts.get(f.name); reader.hidden = false; reader.textContent = `# ${f.name}\n${t?.text ?? ''}`; } });
      row.append(read); list.append(row);
    }
    for (const n of view.notUsed) list.append(el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: n.name }), el('small', { textContent: '' }), el('span', { className: 'fr-chip', textContent: n.why.startsWith('points') ? 'points to AGENTS.md' : 'not used' })));
    const follow = btn('Follow them', { className: 'btn btn-primary', onclick: async () => {
      const shas = {}; for (const f of waiting) { const t = texts.get(f.name); if (t) shas[f.name] = t.sha256; }
      // only the files this card showed: Follow never re-freezes a file that was followed before (that is Read again)
      try { await sendJSON(`/api/sessions/${sid}/folder-rules/follow`, 'POST', { names: waiting.map((f) => f.name), shas }); done(true); } catch (err) { status.textContent = err.message; }
    } });
    const later = btn('Not now', { className: 'btn btn-ghost', onclick: () => done(false) });
    box.append(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'This folder has instruction files' }),
      el('p', { className: 'modal-sub', textContent: view.folder })),
      el('div', { className: 'modal-body' },
        el('p', { className: 'es-p', textContent: 'If I follow them, they steer what I do here whichever engine this chat uses, including commands run in Auto mode. Bunny, Claude Code and Codex CLI all get the same text.' }),
        list, reader,
        el('p', { className: 'modal-sub', textContent: 'Read them first. Follow them only if you trust whoever wrote them, for example if you cloned this project from someone else. They stay under your rules.' }), status),
      el('div', { className: 'modal-foot' }, later, follow));
  });
}

/**
 * The card in the chat, above the composer: the first time a Code chat starts in a folder nobody has answered for. One card, up to two answers (F12):
 * question 1 "Follow its instruction files?" (only when the folder has some; it goes through FOLDER-RULES' own Follow card, which shows the text and sends its shas),
 * question 2 "Run in Auto here?" (only when `auto` is given: a git folder, Smart, the check on). Not on a device (the answers are the PC's).
 */
export function trustCard({ sid, view, onAnswered, device = false, auto = null }) {
  const waiting = view.files.filter((f) => f.state === 'waiting');
  const card = el('div', { className: 'fr-card', role: 'group', 'aria-label': 'Trust this folder?' });
  card.append(el('b', { textContent: 'Trust this folder?' }), el('p', { className: 'modal-sub', textContent: view.folder }));
  let open = (waiting.length ? 1 : 0) + (auto && !device ? 1 : 0);
  let followed = false;
  const answered = (isFollow, yes) => { if (isFollow) followed = yes; open -= 1; if (open <= 0) { card.remove(); onAnswered?.(followed); } };
  if (waiting.length) {
    const q = el('div', { className: 'fr-q' });
    q.append(el('b', { textContent: 'Follow its instruction files?' }),
      el('p', { className: 'fr-p', textContent: `The project has instruction files (${waiting.map((f) => f.name).join(', ')}). If I follow them, they steer what I do here whichever engine this chat uses, including commands run in Auto mode.` }));
    if (device) q.append(el('span', { className: 'modal-sub', textContent: DEVICE_NOTE }));
    else q.append(el('div', { className: 'fr-acts' },
      btn('Follow them', { className: 'btn btn-primary', onclick: async () => { const ok = await openFollowCard(sid).catch(() => false); if (ok) { q.remove(); answered(true, true); } } }),
      btn('Not now', { className: 'btn btn-ghost', onclick: () => { q.remove(); answered(true, false); } })));
    card.append(q);
  }
  if (auto && !device) {
    const q = el('div', { className: 'fr-q', id: 'fr-auto-q' });
    q.append(el('b', { textContent: 'Run in Auto here?' }),
      el('p', { className: 'fr-p', textContent: "Commands and changes run without asking you, unless Bunny's check stops them or a rule asks." }),
      el('p', { className: 'fr-p', textContent: 'A second model checks each risky action before it runs, and Bunny asks you when it cannot. This is a git folder, so changes can be undone. You can change this any time in Settings, under Trusted folders.' }),
      el('div', { className: 'fr-acts' },
        btn('Trust this folder for Auto', { className: 'btn btn-primary', onclick: async () => { try { await sendJSON('/api/folder-trust', 'PUT', { folder: auto.folder, auto: true }); q.remove(); answered(false, false); } catch (err) { q.append(el('span', { className: 'modal-sub', textContent: err.message })); } } }),
        btn('Not now, ask me each time', { className: 'btn btn-ghost', onclick: () => { q.remove(); answered(false, false); } })));
    card.append(q);
  }
  return card;
}

/** The "Project instructions" block of the Working folder card. */
export function projectInstructions({ sid, view, engineId = 'bunny', device = false, onChanged = () => {} }) {
  const block = el('div', { className: 'fr-block' });
  const total = view.files.length + view.notUsed.length;
  const sw = el('input', { type: 'checkbox', id: 'fr-switch', checked: view.chatSwitch !== false, disabled: device || !view.enabled, 'aria-label': 'Use project instructions in this chat' });
  sw.addEventListener('change', async () => { try { await sendJSON(`/api/sessions/${sid}`, 'PATCH', { folderRules: sw.checked }); } catch { sw.checked = !sw.checked; } onChanged(); });
  block.append(el('div', { className: 'fr-hd' }, el('span', {}, el('b', { textContent: 'Project instructions' }), ' ', el('span', { className: 'modal-sub', textContent: `· ${total} file${total === 1 ? '' : 's'}` })), sw));
  for (const f of view.files) { const c = fileChip(f); block.append(el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: f.name }), el('small', { textContent: kb(f.size) }), el('span', { className: `fr-chip ${c.tone}`, textContent: c.text }), f.cut ? el('span', { className: 'fr-chip', textContent: 'first 32 KB' }) : null, btn('View', { className: 'lnk', onclick: () => openViewRead(sid, f.name) }))); }
  for (const n of view.notUsed) block.append(el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: n.name }), el('small', { textContent: '' }), el('span', { className: 'fr-chip', textContent: n.why.startsWith('points') ? 'points to AGENTS.md' : 'not used' }), el('small', { className: 'fr-why', textContent: n.why.startsWith('points') ? 'Same set.' : n.why.replace(/^not used: /, 'Not used: ') })));
  for (const s of view.skipped) block.append(el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: s.name }), el('small', { textContent: '' }), el('span', { className: 'fr-chip warn', textContent: 'skipped' }), el('small', { className: 'fr-why', textContent: `It ${s.why}.` })));
  for (const l of view.leftOut) block.append(el('div', { className: 'fr-row' }, el('span', { className: 'fr-n', textContent: l.name }), el('small', { textContent: '' }), el('span', { className: 'fr-chip warn', textContent: 'left out: too much text' })));
  const note = el('div', { className: 'fr-note' });
  note.append(blockNote(view, { engineId }));
  const links = el('div', { className: 'fr-links' });
  if (device) links.append(el('span', { className: 'modal-sub', textContent: DEVICE_NOTE }));
  else {
    if (!view.trusted && view.files.some((f) => f.state === 'waiting')) links.append(btn('Follow them…', { className: 'lnk', onclick: async () => { if (await openFollowCard(sid).catch(() => false)) onChanged(); } }));
    if (view.trusted) {
      links.append(btn('View what was read', { className: 'lnk', onclick: () => openViewRead(sid) }), btn('Read again', { className: 'lnk', onclick: () => openReadAgain(sid, onChanged) }),
        btn('Ask me again for this folder', { className: 'lnk', onclick: async () => { try { await sendJSON(`/api/sessions/${sid}/folder-rules/ask-again`, 'POST', {}); } catch { /* shown by the next view */ } onChanged(); } }));
    } else if (view.files.some((f) => f.state === 'waiting')) {
      // a new file name asks first
    }
    if (view.trusted && view.files.some((f) => f.state === 'waiting')) links.append(btn('Follow the new file…', { className: 'lnk', onclick: async () => { if (await openFollowCard(sid).catch(() => false)) onChanged(); } }));
  }
  block.append(note, links);
  return block;
}

/**
 * F13: the Working folder card's "Confine commands" block: what is set for this chat and, once the folder carries Bunny's label, "Remove the label" (window only; it puts the label back as it was).
 * Returns null where there is nothing to say (not Windows, or the setting is off and the folder has no label).
 */
export async function confineBlock({ sid, device = false, onChanged = () => {} }) {
  let v; try { v = await getJSON(`/api/sessions/${sid}/confine`); } catch { return null; }
  if (!v?.supported || (v.mode === 'off' && !v.labelled)) return null;
  const block = el('div', { className: 'fr-block', id: 'confine-block' });
  const status = el('div', { className: 'fr-note' });
  const say = (labelled) => { status.textContent = labelled ? 'Commands in this chat run in a low-rights mode that can only write inside this folder.' : v.applies ? 'Bunny will ask once before it labels this folder and confines commands.' : 'This chat runs commands normally: the setting confines them only in Auto.'; };
  say(v.labelled);
  block.append(el('div', { className: 'fr-hd' }, el('b', { textContent: 'Confine commands' })), status);
  block.append(el('div', { className: 'fr-note' }, el('small', { textContent: `Not covered: ${(v.notCovered ?? []).join(' ')}` })));
  if (v.labelled) {
    const out = el('div', { className: 'fr-note' });
    const link = el('button', { type: 'button', className: 'lnk', textContent: 'Remove the label', disabled: device, title: device ? "Answer this in Bunny's window on the PC." : '' });
    link.addEventListener('click', async () => {
      link.disabled = true;
      try { await sendJSON(`/api/sessions/${sid}/confine/remove`, 'POST', {}); say(false); link.remove(); out.textContent = 'The label is removed. The folder is as it was before.'; onChanged(); } catch (err) { link.disabled = false; out.textContent = err.message; }
    });
    block.append(el('div', { className: 'fr-links' }, link), out);
  }
  return block;
}
