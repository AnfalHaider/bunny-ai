// LOCAL-MODELS (design-local-models 3c and 3d, Security LF-1 to LF-26): where downloads go, models already on this PC, and the folders Bunny lists models from.
// The window's alone. Every string taken from a file, a folder or a model is put into the page with textContent; nothing here uses innerHTML.
// A path is never typed or sent from here: the folders and the file come from the system dialogs in the main process (window.bunnyDesktop.localModels), and a listed file is named by its id.
const GB = 1024 ** 3;
const gb = (n) => `${(n / GB).toFixed(1)} GB`;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-') || k === 'role') n.setAttribute(k, String(v)); else if (k === 'class') n.className = v; else n[k] = v;
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}
const inside = (child, parent) => { const c = String(child).replace(/\//g, '\\').toLowerCase(); const p = String(parent).replace(/\//g, '\\').toLowerCase().replace(/\\+$/, ''); return c === p || c.startsWith(`${p}\\`); };

/**
 * @param {object} o
 * @param {()=>Promise<object>} o.getPlaces        GET /api/local-models/places
 * @param {(path:string, body?:object)=>Promise<object>} o.post   POST /api/local-models/places/<path>
 * @param {object|null} o.bridge                   window.bunnyDesktop.localModels (the dialogs), or null in a plain browser
 * @param {(text:string)=>void} o.say              a plain message under the card
 * @param {(m: number)=>string} [o.fmt]
 */
export function mountPlaces({ getPlaces, post, bridge, say, models = () => [], onLoaded = () => {} }) {
  const host = el('div', { class: 'lm-places' });
  let view = null; let card = null; let showTemplate = false; let trusted = false; let confirmRemove = null; let timer = null; let leftKey = null;
  const KEY = 'bunny.local.leave';
  try { leftKey = localStorage.getItem(KEY); } catch { /* no storage: the card simply asks again */ }

  const button = (text, onclick, cls = 'btn', extra = {}) => el('button', { type: 'button', class: cls, textContent: text, onclick, ...extra });
  const row = (title, sub, ...right) => el('div', { class: 'row lm-row' }, el('div', { class: 'meta-col' }, el('div', { class: 'name', textContent: title }), sub ? el('div', { class: 'desc', textContent: sub }) : null), el('div', { class: 'right' }, ...right));
  const take = (r) => { if (r?.places) view = r.places; else if (r && r.download) view = r; };

  async function refresh() {
    try { view = await getPlaces(); } catch { view = null; }
    paint(); schedule(); onLoaded();
  }
  function schedule() { clearTimeout(timer); if (view?.move) timer = setTimeout(refresh, 600); }
  async function call(path, body) {
    try { take(await post(path, body)); say(''); } catch (err) { say(err.message ?? 'That did not work.'); }
    paint(); schedule();
  }
  async function dialog(run, after) {
    if (!bridge) { say("This is chosen in Bunny's window on this PC."); return; }
    const r = await run();
    if (r?.canceled) return;
    if (!r?.ok) { say(r?.message ?? 'That did not work.'); return; }
    say(''); if (r.places) view = r.places; after?.(r);
    paint(); schedule();
  }

  function downloadRow(v) {
    const d = v.download;
    const left = Object.entries(v.downloads).filter(([, x]) => d.root && !inside(x.where, d.root));
    const used = models().filter((m) => m.state === 'ready').reduce((n, m) => n + m.size, 0);
    const where = d.custom ? d.where : "Bunny's own folder";
    const rows = [row('Where Bunny saves models', where, el('span', { class: 'tag', textContent: used ? `${gb(used)} used` : 'Nothing downloaded yet' }),
      bridge ? button('Change…', () => dialog(() => bridge.chooseDownloadFolder()), 'btn') : el('small', { class: 'desc', textContent: "Change: Bunny's window only" }),
      d.custom ? button("Use Bunny's folder", () => call('download-default'), 'btn') : null,
      bridge ? button('Show in folder', async () => { try { const r = await bridge.showFolder(); if (r && !r.ok) say(r.message); } catch { say('The folder could not be opened.'); } }, 'btn') : null)];
    if (d.custom) rows.push(el('div', { class: 'row lm-row' }, el('small', { class: 'desc', textContent: d.cloud ? 'This folder syncs to the cloud; several GB will upload. Bunny saves into a folder it makes inside it, named Bunny models.' : 'Bunny saves into a folder it makes inside your pick, named Bunny models. Each model keeps the place it was saved in.' })));
    if (!d.available) rows.push(el('div', { class: 'lm-err', role: 'alert', textContent: d.message }));
    const notFound = (models() ?? []).filter((m) => m.notFound);
    for (const m of notFound) rows.push(el('div', { class: 'row lm-row' }, el('small', { class: 'lm-warn', textContent: `${m.name}: Not found. It comes back when the folder does; Bunny doesn't download it again on its own.` })));
    const wrap = el('div', { class: 'group lm-group lm-download', 'data-places': 'download' }, ...rows);
    if (v.move) {
      const pct = v.move.total ? Math.round((v.move.done / v.move.total) * 100) : 0;
      wrap.append(el('div', { class: 'lm-card' }, el('b', { textContent: 'Moving your models' }), el('div', { class: 'lm-prog', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${pct}%` })),
        el('div', { class: 'desc', textContent: `${gb(v.move.done)} of ${gb(v.move.total)}. Each copy is checked against Bunny's fingerprint before the old one is deleted.` }), button('Cancel', () => call('move-cancel'), 'btn')));
    } else if (left.length && leftKey !== JSON.stringify([d.root, left.map(([id]) => id)])) {
      const size = left.reduce((n, [id]) => n + (models().find((m) => m.id === id)?.size ?? 0), 0);
      wrap.append(el('div', { class: 'lm-card', 'data-card': 'move' }, el('b', { textContent: `Move your ${left.length} downloaded model${left.length === 1 ? '' : 's'} to the new folder?` }),
        el('div', { class: 'desc', textContent: `Moving needs ${gb(size)} plus 2 GB free on the new drive. If they stay behind they sit in two places, and Remove Bunny local has two places to clean.` }),
        el('div', { class: 'lm-acts' }, button('Move', () => call('move'), 'btn btn-primary'), button('Leave them', () => { leftKey = JSON.stringify([d.root, left.map(([id]) => id)]); try { localStorage.setItem(KEY, leftKey); } catch { /* kept for this page only */ } paint(); }, 'btn'))));
    }
    if (v.lastMove && !v.move) {
      const { moved, failed, untouched } = v.lastMove;
      wrap.append(el('div', { class: 'row lm-row' }, el('small', { class: failed.length ? 'lm-warn' : 'desc', textContent: `Moved ${moved.length}.${failed.length ? ` ${failed.length} not moved: ${failed.map((f) => f.reason).join(' ')}` : ''}${untouched.length ? ` ${untouched.length} left where they were.` : ''}` })));
    }
    return wrap;
  }

  function ownGroup(v) {
    const rows = v.own.map((o) => el('div', { class: 'lm-model', 'data-own': o.id },
      el('div', { class: 'lm-head' }, el('div', { class: 'lm-l' }, el('b', { textContent: o.name }),
        el('div', { class: 'lm-meta' }, el('span', { class: 'tag', textContent: gb(o.size) }), el('span', { class: 'tag', textContent: 'Your file' }), el('span', { class: 'tag', textContent: "Not on Bunny's list" }), el('span', { class: 'tag', textContent: o.toolsOn && o.format !== 'none' ? 'Tools on' : 'Tools off' }))),
        el('div', { class: 'lm-acts' }, button('Remove from list', () => call('remove-file', { id: o.id }), 'btn', { 'aria-label': `Remove ${o.name} from the list` }))),
      el('small', { class: 'desc', textContent: `The file stays where it is. ${o.real}` }),
      o.format === 'none' ? el('small', { class: 'desc', textContent: 'This file has no chat format; Bunny uses a plain one, and tools stay off.' }) : el('label', { class: 'lm-tools' },
        el('input', { type: 'checkbox', checked: o.toolsOn, onchange: (e) => call('file-tools', { id: o.id, on: e.target.checked }), 'aria-label': `Use tools with ${o.name}` }), document.createTextNode(' Use tools with this model')),
      o.format !== 'none' && o.toolsOn ? el('small', { class: 'lm-warn', textContent: "Tools with a model Bunny hasn't checked may be called wrongly. Your permission mode still applies." }) : null));
    return el('div', { class: 'group lm-group lm-own', 'data-places': 'own' }, ...rows,
      row('A model file on this PC', 'Pick a .gguf file. Bunny uses it where it is and never changes it', bridge ? button('Add a model from this PC…', () => dialog(() => bridge.pickModelFile(), (r) => { card = r.card; showTemplate = false; trusted = false; }), 'btn') : el('small', { class: 'desc', textContent: "Bunny's window only" })));
  }

  function addCard() {
    const c = card;
    const kids = [
      el('b', { textContent: c.fromLmStudio ? `From LM Studio's models folder: add ${c.name}?` : `Add ${c.name}?` }),
      el('div', { class: 'mono lm-facts' },
        el('div', { textContent: `File: ${c.name} · ${gb(c.size)}` }), el('div', { textContent: `In: ${c.where}` }),
        el('div', { textContent: `Architecture: ${c.architecture}${c.quant ? ` · ${c.quant}` : ''}` }),
        el('div', { textContent: `Memory: ${gb(c.memory.freeRam)} free${c.memory.freeVram != null ? ` · graphics card ${gb(c.memory.freeVram)} free` : ''}` }),
        el('div', { textContent: c.license }),
        el('div', { class: 'lm-format', textContent: `Chat format: ${c.format.text}` })),
    ];
    if (c.memory.mayNotFit) kids.push(el('small', { class: 'lm-warn', textContent: 'This may not fit in memory and can make the PC slow.' }));
    if (c.template != null) {
      const pre = el('pre', { class: 'mono lm-template', hidden: !showTemplate });
      pre.textContent = c.template; // never innerHTML: a template is the file's own text
      kids.push(el('div', {}, button(showTemplate ? 'Hide the template' : 'Show the template', () => { showTemplate = !showTemplate; paint(); }, 'btn link'), pre));
    }
    kids.push(el('div', { class: 'desc', textContent: c.trust }), el('div', { class: 'lm-note', textContent: 'Tools are off for this model. You can turn them on for it later.' }));
    kids.push(el('label', { class: 'lm-trust' }, el('input', { type: 'checkbox', checked: trusted, onchange: (e) => { trusted = e.target.checked; paint(); } }), document.createTextNode(' I trust where I got this file, and I may use it.')));
    kids.push(el('div', { class: 'lm-acts' }, button("Don't add", () => { card = null; paint(); }, 'btn btn-primary'),
      button('Add', async () => { const t = c.token; card = null; await call('add-file', { token: t }); }, 'btn', { disabled: !trusted })));
    return el('div', { class: 'lm-card warn', 'data-card': 'add-file' }, ...kids);
  }

  function foldersGroup(v) {
    const out = [];
    for (const f of v.folders) {
      const head = row(f.name, f.state === 'ok' ? `${f.real ?? ''}` : (f.message ?? ''), el('span', { class: 'tag', textContent: f.state === 'ok' ? `${f.count} model${f.count === 1 ? '' : 's'}` : f.state === 'missing' ? 'Folder not found' : f.state === 'moved' ? 'Moved' : f.state === 'none' ? 'Not installed' : 'Not used' }),
        f.auto ? el('span', { class: 'tag', textContent: 'Found automatically' }) : null,
        button('Refresh', () => call('refresh'), 'btn'),
        confirmRemove === f.id ? null : button('Remove', () => { confirmRemove = f.id; paint(); }, 'btn', { 'aria-label': `Remove ${f.name} from the list` }));
      const parts = [head];
      if (confirmRemove === f.id) parts.push(el('div', { class: 'lm-card', 'data-card': 'remove-folder' }, el('div', { class: 'desc', textContent: "Your files and anything you downloaded elsewhere aren't touched. Models you added from this folder stop being listed until you add the folder again." }),
        el('div', { class: 'lm-acts' }, button('Remove from list', async () => { confirmRemove = null; await call('remove-folder', { id: f.id }); }, 'btn btn-danger'), button('Keep it', () => { confirmRemove = null; paint(); }, 'btn btn-primary'))));
      for (const m of f.models ?? []) parts.push(el('div', { class: 'lm-model', 'data-entry': m.id }, el('div', { class: 'lm-head' }, el('div', { class: 'lm-l' }, el('b', { textContent: m.name }),
        el('div', { class: 'lm-meta' }, el('span', { class: 'tag', textContent: gb(m.size) }), m.quant ? el('span', { class: 'tag', textContent: m.quant }) : null, el('span', { class: 'tag', textContent: m.architecture }), m.where ? el('span', { class: 'tag', textContent: m.where }) : null)),
        el('div', { class: 'lm-acts' }, m.added ? el('span', { class: 'tag lm-ready', textContent: 'Added' }) : button('Add…', async () => { try { card = await post('inspect', { entryId: m.id }); showTemplate = false; trusted = false; say(''); } catch (err) { say(err.message); } paint(); }, 'btn', { 'aria-label': `Add ${m.name}` })))));
      const sk = f.skipped ?? {}; const skipped = (sk.split ?? 0) + (sk.projector ?? 0) + (sk.unreadable ?? 0);
      if (skipped) parts.push(el('div', { class: 'row lm-row' }, el('small', { class: 'desc', textContent: `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that aren't chat models (vision helper files, pieces of split models, files Bunny can't read). Bunny only reads this folder.` })));
      if (f.truncated) parts.push(el('div', { class: 'row lm-row' }, el('small', { class: 'lm-warn', textContent: 'This folder has a lot in it; Bunny listed the first 5,000 entries.' })));
      out.push(...parts);
    }
    if (!v.folders.some((f) => f.id === 'lmstudio')) out.push(row("LM Studio's models folder", "It isn't listed. Bunny only reads this folder; it doesn't start LM Studio or read its settings or chats.", button('List it again', () => call('lmstudio-back'), 'btn')));
    out.push(row('Add a folder of models', 'Bunny lists the .gguf files in it, three levels deep, and never changes them', bridge ? button('Add a folder…', () => dialog(() => bridge.addModelFolder()), 'btn') : el('small', { class: 'desc', textContent: "Bunny's window only" })));
    return el('div', { class: 'group lm-group lm-folders', 'data-places': 'folders' }, ...out);
  }

  function paint() {
    host.replaceChildren();
    if (!view) return;
    host.append(downloadRow(view));
    host.append(el('div', { class: 'lm-sub', textContent: 'From this PC' }), ownGroup(view));
    if (card) host.append(addCard());
    host.append(el('div', { class: 'lm-sub', textContent: 'Model folders' }), foldersGroup(view));
    host.append(el('div', { class: 'desc lm-foot', textContent: 'Bunny reads model files where they are and never changes them. It lists only the folders you add and LM Studio\'s models folder.' }));
  }

  /** Where the downloads are, for the second confirmation of Remove Bunny local (LF-24). */
  const whereDownloads = () => {
    const by = new Map();
    for (const [id, x] of Object.entries(view?.downloads ?? {})) { const m = models().find((q) => q.id === id); const folder = x.where.split('\\').slice(0, -3).join('\\') || x.where; by.set(folder, (by.get(folder) ?? 0) + (m?.size ?? 0)); }
    return [...by].map(([folder, bytes]) => ({ folder, bytes }));
  };

  /** What Remove Bunny local left behind or could not reach, named by folder (LF-24). */
  const removalLines = () => {
    const r = view?.removal; if (!r) return [];
    const by = (list) => { const m = new Map(); for (const x of list) m.set(x.folder, (m.get(x.folder) ?? 0) + 1); return [...m]; };
    return [
      ...by(r.left ?? []).map(([folder, n]) => `${n} model${n === 1 ? ' was' : 's were'} left in ${folder} because ${n === 1 ? 'it' : 'they'} changed after Bunny downloaded ${n === 1 ? 'it' : 'them'}.`),
      ...by(r.missing ?? []).map(([folder, n]) => `${n} model${n === 1 ? '' : 's'} on ${folder} ${n === 1 ? "wasn't" : "weren't"} removed because the drive isn't connected.`),
    ];
  };
  return { el: host, refresh, whereDownloads, paint, loaded: () => view !== null, removalLines };
}
