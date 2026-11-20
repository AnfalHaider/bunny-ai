/**
 * REWIND (v0.1.15, Design's drawing "Bunny rewind"): go back further than one reply.
 *
 * - openRewindPanel: one row per reply that changed files (newest first), the result block says what going back to that step does,
 *   then a confirm card in words. Nothing is written until the person presses the red button.
 * - confirmRewind: the same card for one chosen point (a message's "Rewind to here", the Changes pane, the one-reply Undo when a file changed since).
 * The server decides everything (rewind.js); this only shows the preview and asks.
 */
import { getJSON, sendJSON } from './api.js';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The replies that changed files, newest first: { cp, no (the Nth thing the person asked), at, ask, files, restored }. */
export function rewindRows(messages = []) {
  const rows = [];
  let users = 0;
  let ask = '';
  for (const m of messages) {
    if (m.role === 'user') { users += 1; ask = String(m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 90); }
    if (m.role === 'assistant' && m.checkpoint?.id && m.checkpoint.files) rows.push({ cp: m.checkpoint.id, no: Math.max(1, users), at: m.at, ask, files: m.checkpoint.files, restored: Boolean(m.checkpoint.restored), messageId: m.id });
  }
  return rows.reverse();
}

const when = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };

/** What each file in the preview will do, in the drawing's words. */
export function fileWords(f) {
  return {
    restore: 'put back as it was',
    delete: 'removed (a reply made it)',
    changed: 'changed since: left alone',
    big: 'kept (too large to copy)',
    refused: `not touched${f.why ? `: ${f.why}` : ''}`,
    same: 'already as it was',
  }[f.action] ?? f.action;
}

/** The words of the status line after a rewind: "Put back 1 file, removed 4." */
export function doneWords(r) {
  const parts = [];
  if (r.putBack) parts.push(`Put back ${plural(r.putBack, 'file', 'files')}`);
  if (r.removed) parts.push(`${parts.length ? 'removed' : 'Removed'} ${r.removed}`);
  let text = parts.length ? `${parts.join(', ')}.` : 'Nothing needed to change.';
  if (r.left?.length) text += ` Left ${plural(r.left.length, 'file', 'files')} you changed.`;
  if (r.refused?.length) text += ` ${plural(r.refused.length, 'file was', 'files were')} not touched.`;
  if (r.failed?.length) text += ` Stopped: ${r.failed[0].why}`;
  return text;
}

function backdrop(onClose) {
  const back = el('div', { className: 'modal-backdrop rewind-backdrop' });
  const box = el('div', { className: 'modal rewind-modal', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { back.remove(); onClose?.(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  back.append(box);
  document.body.append(back);
  return { box, close };
}

function previewBlock(plan, { ticks, headline }) {
  const block = el('div', { className: 'rewind-result' });
  block.append(el('div', { className: 'rewind-result-head', textContent: headline }));
  if (!plan.files.length) block.append(el('div', { className: 'rewind-file', textContent: 'No files to change.' }));
  for (const f of plan.files) {
    const row = el('div', { className: `rewind-file rewind-${f.action}` });
    if (f.action === 'changed') {
      const box = el('input', { type: 'checkbox', 'aria-label': `Put back ${f.path} anyway` });
      box.addEventListener('change', () => { if (box.checked) ticks.add(f.path); else ticks.delete(f.path); });
      row.append(el('span', { className: 'rewind-name', textContent: f.path }), el('label', { className: 'rewind-tick' }, box, ' Put back anyway'));
    } else row.append(el('span', { className: 'rewind-name', textContent: f.path }), el('span', { className: 'rewind-how', textContent: fileWords(f) }));
    block.append(row);
  }
  if (plan.commandsRan) block.append(el('div', { className: 'rewind-note', textContent: "Commands ran in these replies. Bunny can't put back what a command changed." }));
  if (plan.tooOld) block.append(el('div', { className: 'rewind-note', textContent: 'Some of the replies are older than Bunny keeps, so they are not included.' }));
  return block;
}

/**
 * Ask in words, then do it. spec is { to } | { before } | { cp }; label says where ("before reply 5").
 * ctx: { sessionId, running(), onDone(result), newChatOffered }
 */
export function confirmRewind(ctx, spec, label) {
  let went = false;
  let settle;
  const finished = new Promise((r) => { settle = r; });
  show(ctx, spec, label, () => { went = true; }, () => settle(went)).catch(() => settle(false));
  return finished; // true when the files were put back, false when the person backed out
}

async function show(ctx, spec, label, markWent, onClosed) {
  const { box, close } = backdrop(onClosed);
  const ticks = new Set();
  box.append(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: `Go back to ${label}?` })), el('div', { className: 'modal-body' }, el('p', { className: 'modal-sub', textContent: 'Looking at what would change…' })));
  let plan;
  try { plan = await getJSON(`/api/sessions/${ctx.sessionId}/rewind?${new URLSearchParams(spec)}`); } catch (err) {
    box.replaceChildren(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'Cannot go back' })), el('div', { className: 'modal-body' }, el('p', { className: 'modal-sub', role: 'alert', textContent: err.message })), el('div', { className: 'modal-foot actions' }, el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Close', onclick: close })));
    return;
  }
  const count = (a) => plan.files.filter((f) => a.includes(f.action)).length;
  const put = count(['restore']);
  const gone = count(['delete']);
  const nothing = !put && !gone && !plan.files.some((f) => f.action === 'changed');
  const body = el('div', { className: 'modal-body' });
  const summary = nothing
    ? 'Nothing needs to change: the files are already as they were.'
    : `Bunny puts back ${plural(put, 'file', 'files')} as they were${gone ? ` and removes ${plural(gone, 'file', 'files')} that ${plural(plan.replies, 'reply', 'replies')} created` : ''}.`;
  body.append(el('p', { textContent: summary }), previewBlock(plan, { ticks, headline: `${plural(plan.replies, 'reply is', 'replies are')} rewound together.` }));
  body.append(el('p', { className: 'modal-sub', textContent: 'Edits you made yourself to files that changed since are left alone unless you tick them. The chat messages stay as they are. Bunny keeps a copy of how things are now first, so you can undo this.' }));
  let conversation = 'keep';
  if (spec.to || spec.before) {
    const keep = el('input', { type: 'radio', name: 'rewind-conv', checked: true });
    const fresh = el('input', { type: 'radio', name: 'rewind-conv' });
    keep.addEventListener('change', () => { conversation = 'keep'; });
    fresh.addEventListener('change', () => { conversation = 'new-chat'; });
    body.append(el('div', { className: 'rewind-conv' }, el('label', {}, keep, ' Keep this chat as it is'), el('label', {}, fresh, ' Also continue in a new chat from there (this chat stays whole)')));
  }
  const status = el('div', { className: 'modal-sub', role: 'status' });
  const busy = ctx.running?.();
  if (busy) status.textContent = 'Wait for the reply to finish, or press Stop first.';
  const go = el('button', { type: 'button', className: 'btn btn-danger', textContent: 'Go back', disabled: Boolean(busy) || nothing });
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.textContent = 'Going back…';
    try {
      const r = await sendJSON(`/api/sessions/${ctx.sessionId}/rewind`, 'POST', { ...spec, include: [...ticks], conversation });
      status.textContent = doneWords(r);
      markWent();
      ctx.onDone?.(r);
      go.remove();
      cancel.textContent = 'Close';
      if (r.undoId) foot.prepend(el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Undo the rewind', onclick: async () => {
        try { const u = await sendJSON(`/api/sessions/${ctx.sessionId}/rewind`, 'POST', { cp: r.undoId, include: [] }); status.textContent = `Undone. ${doneWords(u)}`; ctx.onDone?.(u); } catch (err) { status.textContent = err.message; }
      } }));
      if (r.newChatId) ctx.openChat?.(r.newChatId);
    } catch (err) {
      status.textContent = err.message;
      go.disabled = false;
    }
  });
  const cancel = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel', onclick: close });
  const foot = el('div', { className: 'modal-foot actions' }, cancel, go);
  box.replaceChildren(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: `Go back to ${label}?` })), body, status, foot);
  go.focus?.();
}

/** The panel: pick a reply, see what it restores, go. */
export function openRewindPanel(ctx) {
  const rows = rewindRows(ctx.messages());
  const { box, close } = backdrop();
  let sel = rows.find((r) => !r.restored)?.cp ?? null;
  const head = el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'Rewind' }), el('p', { className: 'modal-sub', textContent: 'Go back to how the project was before a reply. Chat messages stay as they are.' }));
  const list = el('div', { className: 'rewind-list', role: 'radiogroup', 'aria-label': 'Replies that changed files' });
  const result = el('div', { className: 'rewind-preview' });
  const go = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Go back…', disabled: true });
  const foot = el('div', { className: 'modal-foot actions' }, el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Close', onclick: close }), go);
  box.append(head, el('div', { className: 'modal-body' }, list, result), foot);
  if (!rows.length) {
    list.append(el('div', { className: 'rewind-empty', textContent: 'No reply has changed files yet. Nothing to go back to.' }));
    return;
  }
  const paintPreview = async () => {
    result.replaceChildren();
    const row = rows.find((r) => r.cp === sel);
    go.disabled = true;
    if (!row || row.restored) { result.append(el('div', { className: 'rewind-note', textContent: row?.restored ? 'These changes are already undone.' : '' })); return; }
    const mine = rows.slice(0, rows.indexOf(row) + 1).filter((r) => !r.restored);
    const last = mine[0].no;
    try {
      const plan = await getJSON(`/api/sessions/${ctx.sessionId}/rewind?${new URLSearchParams({ before: row.cp })}`);
      result.append(previewBlock(plan, { ticks: new Set(), headline: `Goes back to before reply ${row.no}. ${row.no === last ? `Only reply ${last} is rewound.` : `Replies ${row.no} to ${last} are rewound together.`}` }));
    } catch (err) { result.append(el('div', { className: 'rewind-note', role: 'alert', textContent: err.message })); return; }
    go.textContent = `Go back to before reply ${row.no}…`;
    go.disabled = Boolean(ctx.running?.());
    if (ctx.running?.()) result.append(el('div', { className: 'rewind-note', textContent: 'Wait for the reply to finish, or press Stop first.' }));
  };
  const paintList = () => {
    list.replaceChildren(...rows.map((r) => {
      const item = el('div', { className: `rewind-row${r.restored ? ' is-undone' : ''}`, role: 'radio', tabindex: '0', 'aria-checked': r.cp === sel ? 'true' : 'false' },
        el('span', { className: 'rewind-dot' }),
        el('span', { className: 'rewind-what' }, el('b', { textContent: `Reply ${r.no} · ${when(r.at)}${r.restored ? ' · undone' : ''}` }), el('span', { textContent: r.ask })),
        el('span', { className: 'rewind-count', textContent: plural(r.files, 'file', 'files') }));
      const pick = () => { sel = r.cp; paintList(); paintPreview(); };
      item.addEventListener('click', pick);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      return item;
    }));
  };
  go.addEventListener('click', () => {
    const row = rows.find((r) => r.cp === sel);
    if (!row) return;
    close();
    confirmRewind(ctx, { before: row.cp }, `before reply ${row.no}`);
  });
  paintList();
  paintPreview();
}
