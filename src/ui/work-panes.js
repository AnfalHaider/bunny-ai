/**
 * The Changes and Files panes (D-2).
 *
 * Both only READ: the server lists changes from the copies Bunny saved before each change (any folder, git or not),
 * and lists and reads files inside the chat's own folder. Files Bunny changed are tinted, and the lines it wrote
 * carry a bar. Undo reuses the checkpoint restore Bunny already has.
 */
import { getJSON, sendJSON } from './api.js';
import { confirmRewind, openRewindPanel } from './rewind.js';

const $ = (id) => document.getElementById(id);

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

/** "2 minutes ago", plain words, for "edited 2m ago". */
export function ago(iso, now = Date.now()) {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(secs)) return '';
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export function initWorkPanes({ getSessionId, getPendingFolder = () => null, onChanged = () => {}, copy, rewindCtx = null }) {
  let changes = { checkpoints: [], totals: { files: 0, added: 0, removed: 0 }, folder: null, git: false };
  let openFilePath = null;
  const expanded = new Set(); // folders open in the tree
  const cache = new Map(); // folder path -> entries

  const session = () => getSessionId();
  const changed = () => {
    const map = new Map(); // path -> { status, at, addedAt }
    for (const cp of changes.checkpoints) for (const f of cp.files) map.set(f.path, { status: f.status, at: cp.at, addedAt: f.addedAt ?? [] });
    return map;
  };

  // ------------------------------------------------------------ Changes

  function diffView(file) {
    const box = el('div', { className: 'diff-view' });
    if (file.tooLarge) { box.append(el('div', { className: 'diff-note', textContent: 'This file is too large to show line by line.' })); return box; }
    for (const line of file.lines) {
      if (line === '@@') box.append(el('div', { className: 'diff-line hunk', textContent: '···' }));
      else box.append(el('div', { className: `diff-line ${line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'}`, textContent: line.slice(1) || ' ' }));
    }
    return box;
  }

  /** REWIND: each checkpoint goes back to before itself (or, for the safety copy of a rewind, undoes the rewind), asked in words with the preview. */
  function rewindFrom(cp, index) {
    const ctx = rewindCtx?.();
    if (!ctx) return;
    if (cp.kind === 'rewind') confirmRewind(ctx, { cp: cp.id }, 'how things were before the rewind');
    else confirmRewind(ctx, { before: cp.id }, `before checkpoint ${index + 1}`);
  }

  function paintChanges() {
    const host = $('diff-content');
    if (!host) return;
    host.replaceChildren();
    const total = changes.totals.files;
    if (!total && !changes.checkpoints.some((c) => c.files.length)) {
      host.append(el('div', { className: 'pane-empty diff-empty' }, el('span', { textContent: 'No changes yet.' })));
      return;
    }
    host.append(el('div', { className: 'changes-head' },
      rewindCtx ? el('button', { className: 'btn btn-ghost small', type: 'button', textContent: 'Rewind', onclick: () => openRewindPanel(rewindCtx()) }) : null,
      el('span', { className: 'badge', textContent: `${total} file${total === 1 ? '' : 's'}` }),
      el('span', { className: 'ok', textContent: `+${changes.totals.added}` }),
      el('span', { className: 'bad', textContent: `−${changes.totals.removed}` })));
    if (!changes.git) {
      host.append(el('p', { className: 'changes-banner', textContent: 'These come from the copies Bunny saves before each change, so they work in any folder, with or without git.' }));
    }
    [...changes.checkpoints].reverse().forEach((cp, reverseIndex) => {
      const index = changes.checkpoints.length - 1 - reverseIndex;
      if (!cp.files.length) return;
      const card = el('div', { className: 'checkpoint-card' });
      const head = el('div', { className: 'checkpoint-head' },
        el('span', { className: 'checkpoint-title', textContent: cp.kind === 'rewind' ? 'Before the rewind' : `Checkpoint ${index + 1}` }),
        el('span', { className: 'checkpoint-time', textContent: ago(cp.at) }));
      head.append(cp.restored
        ? el('span', { className: 'checkpoint-done', textContent: 'Undone' })
        : el('button', { className: 'btn btn-ghost small', type: 'button', textContent: cp.kind === 'rewind' ? 'Undo the rewind' : 'Rewind to before this', onclick: () => rewindFrom(cp, index) }));
      card.append(head);
      for (const f of cp.files) {
        const row = el('div', { className: 'change-row', role: 'button', tabindex: '0', 'aria-expanded': 'false' },
          el('span', { className: 'path', textContent: f.path }),
          el('span', { className: `badge file-${f.status}`, textContent: f.status }),
          el('span', { className: 'counts' }, el('span', { className: 'ok', textContent: `+${f.added}` }), ' ', el('span', { className: 'bad', textContent: `−${f.removed}` })));
        let view = null;
        const toggle = () => {
          if (view) { view.remove(); view = null; row.setAttribute('aria-expanded', 'false'); return; }
          view = diffView(f);
          row.after(view);
          row.setAttribute('aria-expanded', 'true');
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        card.append(row);
      }
      host.append(card);
    });
  }

  async function refreshChanges() {
    const id = session();
    if (!id) { changes = { checkpoints: [], totals: { files: 0, added: 0, removed: 0 }, folder: null, git: false }; paintChanges(); return; }
    try { changes = await getJSON(`/api/sessions/${id}/changes`); } catch { /* keep what is shown */ }
    paintChanges();
  }

  // ------------------------------------------------------------ Files

  /** Where to read from: the chat's own folder, or (before the first message) the folder just chosen. */
  const source = (kind, path) => (session()
    ? `/api/sessions/${session()}/${kind}?path=${encodeURIComponent(path)}`
    : `/api/folder/${kind}?folder=${encodeURIComponent(getPendingFolder() ?? '')}&path=${encodeURIComponent(path)}`);
  const hasSource = () => Boolean(session() || getPendingFolder());

  async function loadFolder(path) {
    if (!cache.has(path)) cache.set(path, await getJSON(source('files', path)));
    return cache.get(path);
  }

  let paintSeq = 0; // only the newest paint of the Files pane may touch the page (two quick clicks must not stack two views)

  async function paintTree(listEl, path, depth, mine) {
    const data = await loadFolder(path);
    if (mine !== paintSeq) return;
    const marks = changed();
    for (const entry of data.entries) {
      const full = path ? `${path}/${entry.name}` : entry.name;
      const mark = marks.get(full);
      const row = el('div', { className: `tree-row ${entry.type}${mark ? ` is-${mark.status}` : ''}${openFilePath === full ? ' is-open' : ''}`, role: 'treeitem', tabindex: '0', style: `padding-left:${8 + depth * 14}px`, 'data-path': full });
      row.append(el('span', { className: 'tree-caret', textContent: entry.type === 'folder' ? (expanded.has(full) ? '▾' : '▸') : '' }),
        el('span', { className: 'tree-name', textContent: entry.name }));
      if (mark) row.append(el('span', { className: 'tree-mark', textContent: `${mark.status === 'new' ? 'new' : 'edited'} ${ago(mark.at)}` }));
      const act = async () => {
        if (entry.type === 'folder') {
          if (expanded.has(full)) expanded.delete(full); else expanded.add(full);
          await paintFiles();
        } else await openFile(full);
      };
      row.addEventListener('click', act);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      listEl.append(row);
      if (entry.type === 'folder' && expanded.has(full)) await paintTree(listEl, full, depth + 1, mine);
    }
  }

  async function paintFiles() {
    const host = $('file-content');
    if (!host) return;
    const mine = (paintSeq += 1);
    host.replaceChildren();
    if (!hasSource()) { host.append(el('div', { className: 'pane-empty file-empty' }, el('span', { textContent: 'Open a file to read it.' }))); return; }
    let top;
    try { top = await loadFolder(''); } catch { top = null; }
    if (mine !== paintSeq) return;
    if (!top || (!top.entries.length && !changes.folder)) {
      host.append(el('div', { className: 'pane-empty file-empty' }, el('span', { textContent: 'Open a file to read it.' })));
      return;
    }
    const tree = el('div', { className: `file-tree${openFilePath ? ' has-file' : ''}`, role: 'tree', 'aria-label': 'Files' });
    tree.append(el('div', { className: 'file-folder-name', textContent: top.root }));
    await paintTree(tree, '', 0, mine);
    const view = el('div', { className: 'file-view', id: 'file-view' });
    if (openFilePath) await paintFile(view, openFilePath);
    else view.append(el('div', { className: 'pane-empty file-empty' }, el('span', { textContent: 'Open a file to read it.' })));
    if (mine !== paintSeq) return; // a newer paint took over while this one was reading
    host.replaceChildren(tree, view);
  }

  async function paintFile(view, path) {
    view.replaceChildren();
    let file;
    try { file = await getJSON(source('file', path)); } catch (err) {
      view.append(el('div', { className: 'pane-empty' }, el('span', { textContent: err.message ?? 'That file could not be opened.' })));
      return;
    }
    const mark = changed().get(path);
    const head = el('div', { className: 'file-head' },
      el('button', { className: 'btn btn-ghost small file-back', type: 'button', textContent: '← Files', onclick: () => { openFilePath = null; paintFiles(); } }),
      el('span', { className: 'file-name', textContent: file.path }),
      el('button', { className: 'btn btn-ghost small', type: 'button', textContent: 'Copy path', onclick: () => copy?.(`${changes.folder ?? getPendingFolder() ?? ''}${changes.folder || getPendingFolder() ? '/' : ''}${file.path}`) }));
    view.append(head);
    if (file.binary) { view.append(el('div', { className: 'pane-empty' }, el('span', { textContent: `This is a binary file (${file.bytes} bytes), so it is not shown.` }))); return; }
    const hot = new Set(mark?.addedAt ?? []);
    const body = el('div', { className: 'file-lines', role: 'region', 'aria-label': `Contents of ${file.path}` });
    file.text.replace(/\n$/, '').split('\n').forEach((line, i) => {
      body.append(el('div', { className: `file-line${hot.has(i + 1) ? ' is-changed' : ''}` }, el('span', { className: 'ln', textContent: String(i + 1) }), el('span', { className: 'lt', textContent: line || ' ' })));
    });
    view.append(body);
    if (file.truncated) view.append(el('div', { className: 'diff-note', textContent: 'Only the start of this file is shown.' }));
  }

  async function openFile(path) {
    openFilePath = path;
    // make the parent folders open so the file is visible in the tree
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) expanded.add(parts.slice(0, i).join('/'));
    await paintFiles();
  }

  async function refreshFiles() { cache.clear(); await paintFiles(); }

  async function refresh() {
    await refreshChanges();
    await refreshFiles();
  }

  $('pane-diff-refresh')?.addEventListener('click', () => refreshChanges());
  for (const view of ['diff', 'file']) document.querySelectorAll(`[data-view="${view}"]`).forEach((b) => b.addEventListener('click', () => refresh()));

  return { refresh, openFile, reset() { openFilePath = null; expanded.clear(); cache.clear(); changes = { checkpoints: [], totals: { files: 0, added: 0, removed: 0 }, folder: null, git: false }; paintChanges(); paintFiles(); } };
}
