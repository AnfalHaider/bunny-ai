// SEARCH-PC: the result list of "Search this PC", in the chat and in the Quick ask bar. Everything is built with textContent and text nodes (SP-7): a snippet is cut into
// pieces and the matches wrapped in <mark> elements, never put in as HTML. The buttons (Open, Show in folder, Copy path) exist only where the desktop bridge does: a device's page
// shows the list without them. A result is named to the shell by its ref, never by a path.

/** Split text on the words and return DOM nodes: plain text and <mark> pieces. */
export function markedNodes(doc, text, words) {
  const clean = [...new Set((words ?? []).map((w) => String(w).trim().toLowerCase()).filter((w) => w.length > 1))];
  const source = String(text ?? '');
  if (!clean.length) return [doc.createTextNode(source)];
  const lower = source.toLowerCase();
  const spans = [];
  for (const w of clean) {
    for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + w.length)) spans.push([at, at + w.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  for (const [from, to] of spans) {
    if (from < pos) continue;
    if (from > pos) out.push(doc.createTextNode(source.slice(pos, from)));
    const mark = doc.createElement('mark');
    mark.textContent = source.slice(from, to);
    out.push(mark);
    pos = to;
  }
  if (pos < source.length) out.push(doc.createTextNode(source.slice(pos)));
  return out;
}

const dateOf = (iso) => {
  const d = new Date(String(iso).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** The words of a search label (the text between the curly quotes of a step's title), for marking. */
export const wordsOfStep = (title) => String(/“([^”]*)”/.exec(String(title ?? ''))?.[1] ?? '').split(/\s+/).filter(Boolean);

/**
 * @param {Document} doc
 * @param {Array<{ ref: string, name: string, folder: string, modified?: string, snippet?: string, openable?: boolean }>} rows
 * @param {{ terms?: string[], bridge?: object|null, onAsk?: (row: object) => void, shown?: number, say?: (text: string) => void }} [options]
 */
export function pcResultsView(doc, rows, { terms = [], bridge = null, onAsk = null, shown = 8, say = () => {} } = {}) {
  const root = doc.createElement('div');
  root.className = 'pc-results';
  root.setAttribute('role', 'list');
  const act = bridge?.pcSearch ?? null;
  const rowEl = (row, i) => {
    const el = doc.createElement('div');
    el.className = 'pc-row';
    el.setAttribute('role', 'listitem');
    el.dataset.ref = row.ref;
    if (i >= shown) el.hidden = true;
    const top = doc.createElement('div');
    top.className = 'pc-row-top';
    const name = doc.createElement('strong');
    name.className = 'pc-name';
    name.textContent = row.name;
    const when = doc.createElement('span');
    when.className = 'pc-when';
    when.textContent = dateOf(row.modified);
    top.append(name, when);
    const folder = doc.createElement('div');
    folder.className = 'pc-folder';
    folder.textContent = row.folder;
    el.append(top, folder);
    if (row.snippet) {
      const snip = doc.createElement('div');
      snip.className = 'pc-snippet';
      snip.append(...markedNodes(doc, row.snippet, terms));
      el.append(snip);
    }
    const buttons = doc.createElement('div');
    buttons.className = 'pc-actions';
    const add = (label, run) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ghost small';
      b.textContent = label;
      b.addEventListener('click', async (e) => { e.stopPropagation(); try { const r = await run(); if (r && r.ok === false) say(r.message ?? 'That did not work.'); else if (r?.message) say(r.message); } catch { say('That did not work.'); } });
      buttons.append(b);
      return b;
    };
    if (act) {
      add(row.openable ? 'Open' : 'Show in folder', () => (row.openable ? act.open(row.ref) : act.show(row.ref)));
      if (row.openable) add('Show in folder', () => act.show(row.ref));
    }
    if (onAsk) add('Ask about this file', () => onAsk(row));
    if (act) add('Copy path', () => act.copy(row.ref));
    if (buttons.childNodes.length) el.append(buttons);
    return el;
  };
  rows.forEach((row, i) => root.append(rowEl(row, i)));
  if (rows.length > shown) {
    const more = doc.createElement('button');
    more.type = 'button';
    more.className = 'ghost small pc-more';
    more.textContent = `Show more (${rows.length - shown})`;
    more.addEventListener('click', () => { for (const el of root.querySelectorAll('.pc-row[hidden]')) el.hidden = false; more.remove(); });
    root.append(more);
  }
  return root;
}
