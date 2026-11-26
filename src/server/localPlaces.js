/**
 * LOCAL-MODELS (LF-1 to LF-26): the places model files come from and go to.
 *   - model folders the person adds (and LM Studio's, found by the rules of LF-8): listed, never written;
 *   - single files the person picks: read in place, checked, added with the person's yes, checked again before every start;
 *   - the download folder the person chooses for what Bunny downloads (the writing itself is in localDownload.js and localMove.js).
 * Paths live only here and in the data folder's `local-places.json`. A caller never passes a path from a request: it passes an entry id or a token this module made.
 */
import { lstat, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, win32 as wp } from 'node:path';
import { homedir } from 'node:os';

import { readGguf, GgufError, cleanLabel, looksSplitOrProjector, fileTypeName } from './ggufHeader.js';
import { FolderError, MESSAGES, isInside } from './localFolderRules.js';

export class PlaceError extends Error {
  constructor(code, message, status = 409) { super(message); this.name = 'PlaceError'; this.code = code; this.status = status; }
}
export const MAX_MODEL_FOLDERS = 20;
export const WALK = Object.freeze({ depth: 3, entries: 5000 });
const TOKEN_MS = 10 * 60_000;
const TRUST_SENTENCE = "Bunny didn't download this file and can't check where it came from. A model file can carry an attack on the program that loads it, and its chat format is run as given. Add it only if you trust where you got it.";
export { TRUST_SENTENCE };

const idOf = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
const asText = (n) => (typeof n === 'bigint' ? n.toString() : String(n));

/** Everything the person's own and downloaded files are remembered by lives in one small file in the data folder. */
export function createPlaces({
  dataDir, rules, home = homedir(), curatedTemplates = () => new Map(), readHeader = readGguf, memory = async () => ({ freeRam: 0, freeVram: null, gpu: false }),
  clock = Date.now, lmReadCap = 1024 * 1024,
} = {}) {
  const file = join(dataDir, 'local-places.json');
  let st = { downloadFolder: null, modelFolders: [], lmRemoved: false, own: [], downloads: {} };
  let loaded = false;
  const tokens = new Map(); // token -> { real, name, facts, source, folderId, at }
  const listings = new Map(); // entry id -> { real, folderId } from the last listing: the only way a page names a file in a folder

  async function load() {
    if (loaded) return;
    loaded = true;
    try { st = { ...st, ...JSON.parse(await readFile(file, 'utf8')) }; } catch { /* first run */ }
  }
  const save = async () => { await mkdir(dataDir, { recursive: true }); await writeFile(file, JSON.stringify(st, null, 1), 'utf8'); };

  const statKey = async (real) => { const s = await stat(real, { bigint: true }); return { dev: asText(s.dev), ino: asText(s.ino), size: Number(s.size), mtimeMs: Number(s.mtimeMs), ctimeMs: Number(s.ctimeMs) }; }; // ctime is the change time: a write moves it and no program can set it back

  // ---------------------------------------------------------------- LM Studio (LF-8)
  async function readSmallJson(path) {
    try {
      const h = await open(path, 'r');
      try {
        const { size } = await h.stat();
        if (size > lmReadCap) return null; // over 1 MiB: use the default
        return JSON.parse((await h.readFile()).toString('utf8'));
      } finally { await h.close(); }
    } catch { return null; }
  }
  const readSmallText = async (path) => {
    try { const h = await open(path, 'r'); try { const { size } = await h.stat(); if (size > lmReadCap) return null; return (await h.readFile()).toString('utf8'); } finally { await h.close(); } } catch { return null; }
  };
  /**
   * LM Studio's models folder: its own setting (`downloadsFolder` in settings.json of its home folder, which `.lmstudio-home-pointer` may move), else the defaults.
   * Only these files are read, only under the person's profile folder. Returns { path|null, note|null }; nothing is listed from a network path.
   */
  async function lmStudioCandidate() {
    const dir = (...p) => wp.join(home, ...p);
    let lmHome = null;
    const pointer = await readSmallText(dir('.lmstudio-home-pointer'));
    if (pointer) { // the pointer must be a local drive path that passes the folder rules BEFORE anything inside it is read (opening a UNC path would send the sign-in hash)
      const line = pointer.split(/\r?\n/)[0].trim();
      if (/^[A-Za-z]:\\/.test(line)) { try { await rules.checkFolder(line, { kind: 'model' }); lmHome = line; } catch { /* not usable: the defaults */ } }
    }
    const homes = [lmHome, dir('.lmstudio'), dir('.cache', 'lm-studio')].filter(Boolean);
    for (const h of homes) {
      const settings = await readSmallJson(wp.join(h, 'settings.json'));
      const v = settings && typeof settings.downloadsFolder === 'string' ? settings.downloadsFolder.trim() : '';
      if (v.startsWith('\\\\')) return { path: null, network: true }; // a network path is only named, never opened
      if (/^[A-Za-z]:\\/.test(v) && v.length < 1024 && !v.includes('\0')) return { path: v }; // an absolute local path only: a relative, UNC or ~ value falls through to the defaults
    }
    const defaults = [...(lmHome ? [wp.join(lmHome, 'models')] : []), dir('.lmstudio', 'models'), dir('.cache', 'lm-studio', 'models')];
    for (const d of defaults) { try { if ((await stat(d)).isDirectory()) return { path: d }; } catch { /* next */ } }
    return { path: null };
  }
  async function lmStudio() {
    await load();
    if (st.lmRemoved) return { state: 'removed' };
    const c = await lmStudioCandidate();
    if (c.network) return { state: 'network', message: "LM Studio's models folder is on a network drive; Bunny only runs files from this PC." };
    if (!c.path) return { state: 'none' };
    try {
      const r = await rules.checkFolder(c.path, { kind: 'model', download: st.downloadFolder?.real ?? join(dataDir, 'models') });
      return { state: 'found', real: r.real };
    } catch (e) {
      if (e instanceof FolderError && e.code === 'network') return { state: 'network', message: "LM Studio's models folder is on a network drive; Bunny only runs files from this PC." };
      if (e instanceof FolderError && e.code === 'missing') return { state: 'none' };
      return { state: 'refused', message: e.message };
    }
  }

  // ---------------------------------------------------------------- the walk (LF-8, LF-16, LF-25)
  async function walk(root, dupes = new Set()) {
    const out = []; const skipped = { split: 0, projector: 0, unreadable: 0 }; let seen = 0; let truncated = false;
    const visit = async (dir, depth) => {
      let names; try { names = await readdir(dir); } catch { return; }
      for (const name of names) {
        if (++seen > WALK.entries) { truncated = true; return; }
        const full = join(dir, name);
        let info; try { info = await lstat(full); } catch { continue; }
        if (info.isSymbolicLink()) continue; // never follow a link or junction
        if (info.isDirectory()) { if (depth + 1 < WALK.depth) await visit(full, depth + 1); continue; }
        if (!info.isFile() || !/\.gguf$/i.test(name)) continue;
        const kind = looksSplitOrProjector(name);
        if (kind) { skipped[kind] += 1; continue; }
        let facts; try { facts = await readHeader(full, { mode: 'list', name }); } catch (e) { if (e instanceof GgufError && (e.code === 'split' || e.code === 'projector')) skipped[e.code] += 1; else skipped.unreadable += 1; continue; }
        let key; try { key = await statKey(full); } catch { continue; }
        const dedupe = `${key.dev}:${key.ino}`;
        if (dupes.has(dedupe)) continue;
        dupes.add(dedupe);
        out.push({ full, name, facts, key, rel: wp.relative(root, dir) });
      }
    };
    await visit(root, 0);
    return { files: out, skipped, truncated };
  }

  const memoryLine = async (size) => {
    const m = await memory();
    const free = m.gpu && Number.isFinite(m.freeVram) ? Math.max(m.freeRam, m.freeVram) : m.freeRam;
    return { size, freeRam: m.freeRam, freeVram: m.gpu ? m.freeVram : null, mayNotFit: size * 1.1 > free };
  };

  /** The one place the format line of the card comes from (LF-4): known (equal to a curated entry's recorded sha), unknown (shown, person decides), or none (chatml, tools off). */
  function formatOf(templates) {
    const entries = Object.entries(templates ?? {}).map(([k, t]) => [k, t.sha256 ?? t]);
    if (!entries.length) return { kind: 'none', text: 'This file has no chat format; Bunny will use a plain one.', tools: false };
    const known = curatedTemplates();
    // known only when EVERY template in the file (the default and each named variant such as tool_use) is one Bunny recorded; one unknown variant makes the whole format unknown
    const names = entries.map(([, sha]) => known.get(sha));
    if (names.every(Boolean) && entries.some(([k]) => k === 'default') && new Set(names).size === 1) return { kind: 'known', entry: names[0], text: `Same chat format as ${names[0]}` };
    return { kind: 'unknown', text: 'Unknown chat format' };
  }
  /** The whole of every template for the "Show the template" view: control characters and bidi marks removed, newlines kept; shown with textContent only. */
  const templateView = (templates) => Object.entries(templates ?? {}).map(([k, t]) => (k === 'default' ? '' : `--- tokenizer.chat_template.${cleanLabel(k, 60)} ---\n`) + String(t.text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')).join('\n\n');

  // ---------------------------------------------------------------- listing model folders
  async function folderView(f) {
    const now = await rules.stillThere({ real: f.real }, { kind: 'model' });
    const base = { id: f.id, name: cleanLabel(f.auto === 'lmstudio' ? "LM Studio's models folder" : wp.basename(f.real) || f.real), real: f.real, auto: f.auto ?? null };
    if (!now.ok) return { ...base, state: now.reason === 'missing' ? 'missing' : 'moved', message: now.message, models: [] };
    return { ...base, state: 'ok' };
  }
  async function listFolder(f, dupes = new Set()) {
    const v = await folderView(f);
    if (v.state !== 'ok') return { ...v, count: 0, models: [], skipped: { split: 0, projector: 0, unreadable: 0 } };
    const { files, skipped, truncated } = await walk(f.real, dupes);
    const added = new Set(st.own.map((o) => `${o.dev}:${o.ino}`));
    const models = files.map((x) => {
      const id = idOf('file', x.full);
      listings.set(id, { real: x.full, folderId: f.id });
      return { id, name: cleanLabel(x.name), where: cleanLabel(x.rel), size: x.facts.size, architecture: x.facts.architecture, quant: fileTypeName(x.facts.fileType), format: formatOf(x.facts.templates).kind, added: added.has(`${x.key.dev}:${x.key.ino}`) };
    });
    return { ...v, count: models.length, models, skipped, truncated };
  }

  async function folders() {
    await load();
    const out = []; const seen = new Set(); // a file two folders both reach is listed once
    const lm = await lmStudio();
    if (lm.state === 'found') out.push(await listFolder({ id: 'lmstudio', real: lm.real, auto: 'lmstudio' }, seen));
    else if (lm.state === 'network') out.push({ id: 'lmstudio', auto: 'lmstudio', name: "LM Studio's models folder", state: 'network', message: lm.message, models: [], count: 0, skipped: {} });
    else if (lm.state === 'none') out.push({ id: 'lmstudio', auto: 'lmstudio', name: "LM Studio's models folder", state: 'none', message: 'LM Studio is not installed here. Nothing to list.', models: [], count: 0, skipped: {} });
    for (const f of st.modelFolders) out.push(await listFolder(f, seen));
    return out;
  }
  async function addModelFolder(path) {
    await load();
    if (st.modelFolders.length >= MAX_MODEL_FOLDERS) throw new PlaceError('place.tooMany', MESSAGES.tooMany, 400);
    const r = await rules.checkFolder(path, { kind: 'model', download: st.downloadFolder?.real ?? join(dataDir, 'models') });
    const others = [...st.modelFolders.map((f) => f.real)];
    const lm = await lmStudio(); if (lm.state === 'found') others.push(lm.real);
    if (others.some((o) => o.toLowerCase() === r.real.toLowerCase())) throw new PlaceError('place.listed', 'That folder is already in the list.', 400);
    const f = { id: idOf('folder', r.real), real: r.real, auto: null };
    st.modelFolders.push(f); await save();
    return listFolder(f);
  }
  async function removeModelFolder(id) {
    await load();
    if (id === 'lmstudio') { st.lmRemoved = true; st.own = st.own.filter((o) => o.folderId !== 'lmstudio'); await save(); return true; } // files added from it stop being listed too
    const n = st.modelFolders.length; st.modelFolders = st.modelFolders.filter((f) => f.id !== id);
    if (st.modelFolders.length !== n) { st.own = st.own.filter((o) => o.folderId !== id); await save(); return true; } // models added from that folder stop being listed
    return false;
  }
  async function addLmStudioBack() { await load(); st.lmRemoved = false; await save(); }

  // ---------------------------------------------------------------- one file: the add card
  /** Reads and checks the file; returns the card and a token. Nothing is stored until add(token). `source` is a path from the system dialog, or an entry id from the last listing. */
  async function inspect({ dialogPath = null, entryId = null } = {}) {
    await load();
    let real; let source = 'pick'; let folderId = null;
    if (entryId) { const l = listings.get(entryId); if (!l) throw new PlaceError('place.unknownEntry', 'That file is not in the list. Refresh the list and try again.', 404); real = l.real; source = 'folder'; folderId = l.folderId; }
    else if (dialogPath) real = dialogPath;
    else throw new PlaceError('place.noFile', 'Pick a file.', 400);
    const ok = await rules.checkFile(real);
    const name = cleanLabel(wp.basename(ok.real));
    const kind = looksSplitOrProjector(name);
    if (kind) throw new GgufError(kind, kind === 'split' ? "Bunny can't run split model files yet. This is one piece of a model stored in several files." : "Bunny can't use vision helper files. This belongs with a vision model; it isn't a chat model on its own.");
    const facts = await readHeader(ok.real, { mode: 'full', name });
    const key = await statKey(ok.real);
    const fmt = formatOf(facts.templates);
    const mem = await memoryLine(key.size);
    const token = randomBytes(12).toString('hex');
    tokens.set(token, { real: ok.real, name, facts, key, source, folderId, at: clock() });
    for (const [t, v] of tokens) if (clock() - v.at > TOKEN_MS) tokens.delete(t);
    return {
      token, name, where: cleanLabel(wp.dirname(ok.real)), size: key.size, architecture: facts.architecture, quant: fileTypeName(facts.fileType),
      license: facts.license ? `The file says: ${cleanLabel(facts.license, 80)}` : 'The file names no licence', format: fmt,
      template: fmt.kind === 'unknown' ? templateView(facts.templates) : null, // all of it, shown with textContent, in the window only
      memory: mem, fromLmStudio: source === 'folder' && folderId === 'lmstudio', trust: TRUST_SENTENCE, toolsOff: true,
    };
  }
  async function add(token) {
    await load();
    const t = tokens.get(token);
    if (!t || clock() - t.at > TOKEN_MS) throw new PlaceError('place.expired', 'That card is out of date. Check the file again.', 410);
    tokens.delete(token);
    const same = st.own.find((o) => o.dev === t.key.dev && o.ino === t.key.ino);
    if (same) return publicOwn(same);
    const rec = {
      id: idOf('own', t.key.dev, t.key.ino), name: t.name, real: t.real, ...t.key, source: t.source, folderId: t.folderId,
      architecture: t.facts.architecture, fileType: t.facts.fileType, license: t.facts.license ?? null,
      templates: Object.fromEntries(Object.entries(t.facts.templates).map(([k, v]) => [k, v.sha256])), format: formatOf(t.facts.templates).kind,
      contextLength: t.facts.contextLength, kvBytesPerToken: kvBytes(t.facts), toolsOn: false, addedAt: clock(),
    };
    st.own.push(rec); await save();
    return publicOwn(rec);
  }
  const kvBytes = (f) => (f.blockCount && f.embeddingLength && f.headCount && f.headCountKv ? Math.round(2 * f.blockCount * (f.embeddingLength / f.headCount) * f.headCountKv * 2) : 131072);
  const publicOwn = (o) => ({ id: o.id, name: o.name, size: o.size, architecture: o.architecture, quant: fileTypeName(o.fileType), format: o.format, toolsOn: o.toolsOn, kvBytesPerToken: o.kvBytesPerToken, contextLength: o.contextLength });
  async function removeAllOwn() { await load(); st.own = []; await save(); }
  async function removeOwn(id) { await load(); const n = st.own.length; st.own = st.own.filter((o) => o.id !== id); if (st.own.length !== n) { await save(); return true; } return false; }
  async function setTools(id, on) { await load(); const o = st.own.find((x) => x.id === id); if (!o) throw new PlaceError('place.unknownEntry', 'That model is not in the list.', 404); o.toolsOn = on === true; await save(); return publicOwn(o); }
  const ownList = async () => { await load(); return st.own.map((o) => ({ ...publicOwn(o), real: o.real })); };

  /**
   * LF-2: before every start, the file must still be what was added: not a link, the same real path, file id, size and mtime. Anything else runs the full checks again;
   * a changed template (or a file that now fails) is refused and the person is sent back to the add card. Returns { real, rec }.
   */
  async function verifyForStart(id) {
    await load();
    const o = st.own.find((x) => x.id === id);
    if (!o) throw new PlaceError('place.unknownEntry', 'That model is not in the list.', 404);
    let ok;
    try { ok = await rules.checkFile(o.real); } catch (e) {
      if (e instanceof FolderError && e.code === 'missing') throw new PlaceError('place.missing', `${o.name} isn't where it was. Find it again, or choose another model.`);
      if (e instanceof FolderError) throw new PlaceError('place.refused', e.message);
      throw e;
    }
    const key = await statKey(ok.real);
    const same = ok.real.toLowerCase() === o.real.toLowerCase() && key.dev === o.dev && key.ino === o.ino && key.size === o.size && key.mtimeMs === o.mtimeMs && key.ctimeMs === o.ctimeMs;
    if (!same) {
      let facts; try { facts = await readHeader(ok.real, { mode: 'full', name: o.name }); } catch (e) { throw new PlaceError('place.changed', `${o.name} changed since you added it and Bunny can't run it any more. ${e.message ?? ''}`.trim()); }
      const now = Object.fromEntries(Object.entries(facts.templates).map(([k, v]) => [k, v.sha256]));
      if (JSON.stringify(now) !== JSON.stringify(o.templates)) throw new PlaceError('place.templateChanged', `${o.name} changed since you added it, including its chat format. Add it again to check it.`);
      Object.assign(o, { real: ok.real, ...key }); await save(); // the checks pass and the chat format is the same: the record follows the file
    }
    return { real: o.real, rec: o, tools: o.toolsOn === true && o.format !== 'none' };
  }

  return { load, folders, addModelFolder, removeModelFolder, addLmStudioBack, lmStudio, inspect, add, removeOwn, removeAllOwn, setTools, ownList, verifyForStart, listings, state: () => st, save, statKey, walk, isInside };
}
