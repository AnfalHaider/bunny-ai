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

/**
 * Numbered marks in an answer: "[1]" becomes a mark when 1 is one of the sources the reply used (and only then). Text nodes are cut and rebuilt, never put in as HTML.
 */
export function markSourceNumbers(root, count) {
  if (!root || !(count > 0)) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const found = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('code, pre, a, .pc-mark')) found.push(n);
  for (const node of found) {
    const text = node.nodeValue;
    if (!/\[\d{1,2}\]/.test(text)) continue;
    const parts = [];
    let pos = 0;
    for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
      const n = Number(m[1]);
      if (n < 1 || n > count) continue;
      if (m.index > pos) parts.push(doc.createTextNode(text.slice(pos, m.index)));
      const mark = doc.createElement('b');
      mark.className = 'pc-mark';
      mark.textContent = m[0];
      mark.title = 'Source ' + n;
      parts.push(mark);
      pos = m.index + m[0].length;
    }
    if (!parts.length) continue;
    if (pos < text.length) parts.push(doc.createTextNode(text.slice(pos)));
    node.replaceWith(...parts);
  }
}

/** The Sources line under an answer: a chip for each file the reply used (number, name, which part was read); a chip opens the file as a result row does, where the desktop bridge is. */
export function sourcesRow(doc, sources, { bridge = null, say = () => {} } = {}) {
  const row = doc.createElement('div');
  row.className = 'pc-sources';
  const label = doc.createElement('span');
  label.className = 'pc-sources-label';
  label.textContent = 'Sources';
  row.append(label);
  const act = bridge?.pcSearch ?? null;
  for (const s of sources) {
    const chip = doc.createElement(act ? 'button' : 'span');
    chip.className = 'pc-chip';
    if (act) chip.type = 'button';
    chip.title = s.folder + ' · ' + s.part;
    const n = doc.createElement('b');
    n.textContent = String(s.n);
    const text = doc.createElement('span');
    text.textContent = ' ' + s.name + ' · ' + s.part;
    chip.append(n, text);
    if (act) chip.addEventListener('click', async () => { try { const r = await (s.openable ? act.open(s.ref) : act.show(s.ref)); if (r && r.ok === false) say(r.message ?? 'That did not work.'); } catch { say('That did not work.'); } });
    row.append(chip);
  }
  return row;
}
