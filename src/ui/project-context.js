/**
 * PROJECT-CONTEXT (v0.1.15, Design's drawing "Bunny project context"): the project's memory panel, the suggestion card under a reply,
 * and "What this chat was given". The server decides everything; nothing here stores anything without the person pressing a button.
 */
import { getJSON, sendJSON, sessionSetting } from './api.js';

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
const day = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; };

export const KIND_LABEL = { decision: 'Decision', convention: 'Convention', fact: 'Fact', open: 'Open' };
const GROUPS = [['decision', 'Decisions'], ['convention', 'Conventions'], ['fact', 'Facts'], ['open', 'Open work']];

/** PC-5: where this text goes, said plainly. */
export const PROVIDER_SENTENCE = "This project's instructions, memory and recent work go to the provider of the engine each chat runs on (for example Anthropic for Claude Code, OpenAI for Codex, or the chat's model provider for Bunny's engine).";

export function engineLine(sessions, projectId) {
  const names = { 'claude-code': 'Claude Code', codex: 'Codex CLI', bunny: 'Bunny' };
  const used = new Set((sessions ?? []).filter((s) => s.projectId === projectId).map((s) => names[s.engine] ?? 'Bunny'));
  if (!used.size) used.add('Bunny');
  return `Chats in this project use: ${[...used].join(', ')}.`;
}

/** The project's memory: grouped by kind, each item with its switch, Edit, Delete; add one; clear all (asks first, in the page). */
export function memoryPanel(project, { onChange = () => {} } = {}) {
  const host = el('div', { className: 'pm-panel' });
  const say = (text) => { status.textContent = text; };
  const status = el('div', { className: 'modal-sub', role: 'status' });
  async function paint() {
    let items = [];
    try { items = (await getJSON(`/api/projects/${project.id}/memory`)).items ?? []; } catch (err) { say(err.message); }
    host.replaceChildren(el('div', { className: 'pm-head' }, el('b', { textContent: 'Project memory' }), el('span', { className: 'modal-sub', textContent: ` ${items.length} of 100` })));
    if (!items.length) host.append(el('div', { className: 'pm-empty', textContent: 'Nothing kept for this project yet. Add a decision or a convention, or keep what Bunny suggests under a reply.' }));
    for (const [kind, title] of GROUPS) {
      const rows = items.filter((m) => m.kind === kind);
      if (!rows.length) continue;
      host.append(el('div', { className: 'pm-group', textContent: title }));
      for (const m of rows) host.append(row(m));
    }
    host.append(addRow(), clearRow(items.length), status);
  }
  function row(m) {
    const on = el('input', { type: 'checkbox', 'aria-label': `Use: ${m.text}`, ...(m.enabled !== false ? { checked: '' } : {}) });
    on.checked = m.enabled !== false;
    on.addEventListener('change', async () => { await sendJSON(`/api/projects/${project.id}/memory/${m.id}`, 'PATCH', { enabled: on.checked }).catch((e) => say(e.message)); onChange(); paint(); });
    const text = el('span', { className: 'pm-text' }, m.text, el('small', { textContent: `${m.source === 'suggested' ? 'Kept from a suggestion' : 'Written by you'} · ${day(m.at)}${m.doneAt ? ' · done' : ''}` }));
    const edit = el('button', { type: 'button', className: 'link-btn', textContent: 'Edit', onclick: () => editing(m, r) });
    const del = el('button', { type: 'button', className: 'link-btn', textContent: 'Delete', onclick: async () => { await sendJSON(`/api/projects/${project.id}/memory/${m.id}`, 'DELETE'); onChange(); paint(); } });
    const done = m.kind === 'open' && !m.doneAt ? el('button', { type: 'button', className: 'link-btn', textContent: 'Mark done', onclick: async () => { await sendJSON(`/api/projects/${project.id}/memory/${m.id}`, 'PATCH', { done: true }); paint(); } }) : null;
    const r = el('div', { className: `pm-row${m.enabled === false ? ' is-off' : ''}` }, on, text, el('span', { className: 'pm-acts' }, done, edit, del));
    return r;
  }
  function editing(m, r) {
    const box = el('input', { className: 'pm-input', 'aria-label': 'Edit item', maxlength: '1000' });
    box.value = m.text;
    const save = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Save', onclick: async () => {
      try { await sendJSON(`/api/projects/${project.id}/memory/${m.id}`, 'PATCH', { text: box.value }); onChange(); paint(); } catch (err) { say(err.message); }
    } });
    r.replaceChildren(box, save, el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel', onclick: paint }));
    box.focus();
  }
  function addRow() {
    const kind = el('select', { 'aria-label': 'Kind' }, ...GROUPS.map(([k, t]) => el('option', { value: k, textContent: KIND_LABEL[k] ?? t })));
    const text = el('input', { className: 'pm-input', placeholder: 'Write an item…', 'aria-label': 'New item', maxlength: '1000' });
    const add = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Add', onclick: async () => {
      try { await sendJSON(`/api/projects/${project.id}/memory`, 'POST', { kind: kind.value, text: text.value }); onChange(); paint(); } catch (err) { say(err.message); }
    } });
    return el('div', { className: 'pm-add' }, kind, text, add);
  }
  function clearRow(n) {
    const wrap = el('div', { className: 'pm-clear' });
    if (!n) return wrap;
    wrap.append(el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Clear project memory…', onclick: () => {
      wrap.replaceChildren(el('div', { className: 'modal-sub', textContent: `Clear project memory? This removes all ${n} items kept for ${project.name}. It cannot be undone. Your chats and everyday memory stay as they are.` }),
        el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel', onclick: paint }),
        el('button', { type: 'button', className: 'btn btn-danger', textContent: `Clear ${n} items`, onclick: async () => { await sendJSON(`/api/projects/${project.id}/memory`, 'DELETE'); onChange(); paint(); } }));
    } }));
    return wrap;
  }
  paint();
  return host;
}

/** The card under a reply: Remember for <project>? Nothing is stored until Keep. It waits; it never turns into a yes. */
export function suggestionCard(m, { sessionId, projectName = 'this project', onChange = () => {} } = {}) {
  const card = el('div', { className: 'pm-card' });
  const err = el('div', { className: 'modal-sub', role: 'alert' });
  const post = async (body) => { try { await sendJSON(`/api/sessions/${sessionId}/project-memory`, 'POST', { messageId: m.id, ...body }); onChange(); } catch (e) { err.textContent = e.message; throw e; } };
  const paint = () => {
    const open = m.suggestion.items.filter((i) => i.state === 'open');
    card.replaceChildren(el('div', { className: 'pm-card-head' }, el('b', { textContent: `Remember for ${projectName}?` }),
      open.length > 1 ? el('button', { type: 'button', className: 'btn btn-ghost small', textContent: 'Keep all', onclick: async () => { await post({ action: 'keepAll' }).catch(() => {}); open.forEach((i) => { i.state = 'kept'; }); paint(); } }) : null));
    for (const item of m.suggestion.items) {
      const line = el('div', { className: 'pm-item' });
      const body = el('div', { className: 'pm-item-body' }, el('span', { className: 'pm-kind', textContent: `${KIND_LABEL[item.kind] ?? item.kind}${item.replaces ? ' · replaces an older item' : ''}` }),
        el('div', { textContent: item.replaces ? `Replace "${item.replacesText}" with "${item.text}"?` : item.text }));
      if (item.state !== 'open') { line.append(body, el('span', { className: 'modal-sub', textContent: item.state === 'kept' ? 'Kept' : 'Discarded' })); card.append(line); continue; }
      const keep = el('button', { type: 'button', className: 'link-btn', textContent: item.replaces ? 'Replace' : 'Keep', onclick: async () => { await post({ action: 'keep', itemId: item.id }).catch(() => {}); item.state = 'kept'; paint(); } });
      const edit = el('button', { type: 'button', className: 'link-btn', textContent: 'Edit', onclick: () => {
        const box = el('textarea', { className: 'pm-input', rows: '2', 'aria-label': 'Edit item', maxlength: '1000' });
        box.value = item.text;
        line.replaceChildren(el('div', { className: 'pm-item-body' }, box), el('span', { className: 'pm-acts' },
          el('button', { type: 'button', className: 'link-btn', textContent: 'Keep', onclick: async () => { await post({ action: 'keep', itemId: item.id, text: box.value }).catch(() => {}); item.state = err.textContent ? 'open' : 'kept'; if (item.state === 'kept') item.text = box.value; paint(); } }),
          el('button', { type: 'button', className: 'link-btn', textContent: 'Cancel', onclick: paint })));
      } });
      const drop = el('button', { type: 'button', className: 'link-btn', textContent: 'Discard', onclick: async () => { await post({ action: 'discard', itemId: item.id }).catch(() => {}); item.state = 'discarded'; paint(); } });
      line.append(body, el('span', { className: 'pm-acts' }, keep, edit, drop));
      card.append(line);
    }
    card.append(el('div', { className: 'modal-sub', textContent: 'Nothing is stored until you press Keep. This card waits; it never turns into a yes.' }), err);
  };
  paint();
  return card;
}

/** "What this chat was given": the five parts with their sizes and the exact text, and the per-chat switch. */
export async function openContextView({ sessionId, onChange = () => {} }) {
  const back = el('div', { className: 'modal-backdrop pm-backdrop' });
  const box = el('div', { className: 'modal pm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What this chat was given' });
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  back.append(box);
  document.body.append(back);
  const paint = async () => {
    let v;
    try { v = await getJSON(`/api/sessions/${sessionId}/project-context`); } catch (err) { box.replaceChildren(el('div', { className: 'modal-body' }, el('p', { role: 'alert', textContent: err.message }))); return; }
    const rows = v.parts.map((p) => {
      const shown = el('pre', { className: 'pm-text-view', hidden: true, textContent: p.text ?? '' });
      const view = p.text ? el('button', { type: 'button', className: 'link-btn', textContent: 'View', onclick: () => { shown.hidden = !shown.hidden; } }) : null;
      return el('div', { className: 'pm-part' }, el('span', { className: 'pm-no', textContent: `P${p.n}` }), el('span', {}, p.title, el('small', { textContent: p.state || `${(p.size / 1024).toFixed(1)} KB` })), el('span', { className: 'pm-acts' }, el('span', { className: 'pm-count', textContent: p.size ? `${(p.size / 1024).toFixed(1)} KB` : '0 KB' }), view), shown);
    });
    const on = el('input', { type: 'checkbox', id: 'pc-chat-switch', ...(v.enabled ? { checked: '' } : {}) });
    on.checked = v.enabled;
    on.addEventListener('change', async () => { await sessionSetting(sessionId, 'projectContext', on.checked); onChange(); paint(); });
    box.replaceChildren(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'What this chat was given' }), v.project ? el('p', { className: 'modal-sub', textContent: `Project: ${v.project.name}` }) : el('p', { className: 'modal-sub', textContent: 'This chat is not in a project, so it has only your own instructions.' })),
      el('div', { className: 'modal-body' }, ...rows,
        v.project ? el('label', { className: 'pm-tick' }, on, ' Use project context in this chat (off sends only your instructions and this project\'s own instructions)') : null,
        v.cut?.length ? el('p', { className: 'modal-sub', textContent: `Left out to fit: ${v.cut.join(', then ')}.` }) : null,
        el('p', { className: 'modal-sub', textContent: "Your parts come first; the folder's files and recent work are quoted as data, never instructions." })),
      el('div', { className: 'modal-foot actions' }, el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Close', onclick: close })));
  };
  await paint();
}

/** The one quiet sign in a chat: "Project context: 5 parts ▾". Returns the number of parts that carry text, or null when there is no project. */
export async function contextPartCount(sessionId) {
  try {
    const v = await getJSON(`/api/sessions/${sessionId}/project-context`);
    return v.project ? v.parts.filter((p) => p.size > 0).length : null;
  } catch { return null; }
}
export { plural };

/** /remember in a project chat: "Remember for this project, or everywhere?" Resolves 'project', 'everywhere' or null (cancel). */
export function askRememberWhere(text, projectName = 'this project') {
  return new Promise((resolve) => {
    const back = el('div', { className: 'modal-backdrop pm-backdrop' });
    const done = (v) => { back.remove(); resolve(v); };
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    const box = el('div', { className: 'modal pm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Remember' },
      el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'Remember for this project, or everywhere?' }), el('p', { className: 'modal-sub', textContent: `"${String(text).slice(0, 200)}"` })),
      el('div', { className: 'modal-foot actions' },
        el('button', { type: 'button', className: 'btn btn-primary', textContent: `For ${projectName}`, onclick: () => done('project') }),
        el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Everywhere', onclick: () => done('everywhere') }),
        el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel', onclick: () => done(null) })));
    back.append(box);
    document.body.append(back);
    box.querySelector('button')?.focus();
  });
}
