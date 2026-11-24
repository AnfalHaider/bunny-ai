/**
 * SEARCH-PC: the one place that puts the exclusions, the index search, the two tools, the activity record and the refs together. app.js only calls this.
 */
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { createExclusions, FIXED_EXCLUSIONS } from './pcExclusions.js';
import { createPcSearch } from './pcSearch.js';
import { createPcActivity, LABEL_CHARS } from './pcActivity.js';
import { addRefs, listForModel, MAX_FILE_CHARS, textLooksSecret, MAX_READS_PER_TURN, readResult, SHOWN_ROWS } from './pcTools.js';
import { powershellPath, safeEnv } from './safeExec.js';
import { execFile } from 'node:child_process';

/** SP-4: what Open may open. Everything else gets Show in folder only. Judged on the real path (the target, never a link). */
export const OPEN_ALLOW = Object.freeze(['.txt', '.md', '.csv', '.log', '.rtf', '.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic']);
export const canOpen = (path) => OPEN_ALLOW.includes(extname(String(path)).toLowerCase());

/** Drive letters and whether each is a network drive (A2): read from Windows once a minute; a failure leaves every drive but the system drive refused. */
export function windowsDriveTypes({ execFileImpl = execFile } = {}) {
  let cache = null;
  let at = 0;
  return async (letter) => {
    if (!cache || Date.now() - at > 60_000) {
      cache = await new Promise((resolve) => {
        const ps = powershellPath();
        if (!ps) return resolve({});
        execFileImpl(ps, ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_LogicalDisk | ForEach-Object { $_.DeviceID + '=' + $_.DriveType }"],
          { env: safeEnv(), windowsHide: true, timeout: 8000 }, (err, stdout) => {
            const map = {};
            if (!err) for (const l of String(stdout).split(/\r?\n/)) { const m = /^([A-Za-z]:)=(\d+)$/.exec(l.trim()); if (m) map[m[1].toUpperCase()] = m[2] === '4' ? 'network' : 'local'; }
            resolve(map);
          });
      });
      at = Date.now();
    }
    return cache[letter.toUpperCase()];
  };
}

/**
 * @param {{ dataDir: string, electronData?: string, getSettings: () => object, run?: Function, readDocument?: Function, driveType?: Function, home?: string, now?: () => number }} options
 */
export function createPcService({ dataDir, electronData = '', getSettings, run, readDocument, driveType = windowsDriveTypes(), home = homedir(), env = process.env, now = () => Date.now() }) {
  const exclusions = createExclusions({ dataDir, electronData, home, users: dirname(home), env, driveType, personal: getSettings().pcSearchExcluded ?? [] });
  const searcher = createPcSearch(run ? { run } : {});
  const activity = createPcActivity({ file: join(dataDir, 'pcsearch-activity.json'), now });
  /** ref -> result, kept across replies so Open, Show in folder and Copy path can name a result (never a raw path from a page). */
  const refStore = new Map();
  const remember = (entries) => { for (const e of entries) refStore.set(e.ref, e); while (refStore.size > 3000) refStore.delete(refStore.keys().next().value); };

  // QUICK-ASK-JUST-WORKS (the owner: "Yes, finding only"): on where the person never chose (no value saved); a saved false stays off. Reading the best matches defaults to showing what it found.
  const enabled = () => getSettings().pcSearchEnabled !== false;
  const after = () => (getSettings().pcSearchAfter === 'read' ? 'read' : 'show');
  const labelOf = (terms) => (Array.isArray(terms) ? terms : []).map((t) => String(t ?? '').replace(/[^\p{L}\p{N} \-_.]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, LABEL_CHARS);
  /** How many folders are skipped, as the screens say it: the fixed list and the person's own. */
  const excludedCount = () => FIXED_EXCLUSIONS.folders.length + (getSettings().pcSearchExcluded?.length ?? 0);
  /** The numbered sources a reply used (names and parts only, never text), for the chips under the answer. */
  const sourcesOf = (turn) => turn.files.map((f) => ({ n: f.n, name: f.name, folder: f.folder, part: f.part, ref: f.ref, openable: canOpen(f.path) }));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /**
   * Run one of the two tools. Returns what the model is told (a string); `send` shows steps to the person.
   * @param {{ name: string, parsed: object, turn: object, who: string, incognito?: boolean, gate: string, send: Function, logStep?: Function }} call
   */
  async function runTool({ name, parsed, turn, who, incognito = false, gate, chat = gate, send, logStep = async () => {} }) {
    if (!enabled()) { send('tool', { tool: 'Search this PC', status: 'denied', result: 'Search this PC is off. Turn it on in Settings, Capabilities.' }); return 'Search this PC is off. The person can turn it on in Settings, Capabilities.'; }
    if (name === 'read_pc_file') {
      // "Ask about this file" comes in a later reply of the same chat: a ref this chat's earlier search handed out is still its own
      const earlier = refStore.get(String(parsed?.ref ?? ''));
      if (earlier && earlier.chat === chat && !turn.refs.has(earlier.ref)) turn.refs.set(earlier.ref, earlier);
      const got = await readResult(turn, parsed?.ref, { readAllowed: (p, o) => exclusions.readAllowed(p, o), ...(readDocument ? { read: readDocument } : {}) });
      if (!got.ok) { send('tool', { tool: got.name ? `Could not read “${got.name}”` : 'Read a file', status: 'failed', result: got.message, pcState: 'unreadable', name: got.name, why: got.why }); return got.message; }
      activity.log({ who, kind: 'read', files: [{ name: got.entry.name, folder: got.entry.folder }] });
      const step = `Read 1 file: ${got.entry.name}`;
      await logStep({ role: 'assistant', kind: 'tool_call', tool: step, status: 'done', content: '', result: `${got.entry.name} (${got.part})`, fullResult: got.block, saveable: !incognito });
      send('tool', { tool: step, status: 'done', result: `${got.entry.name} · ${got.entry.folder} · ${got.part}`, pcTainted: true, pcSources: sourcesOf(turn) });
      return got.block;
    }
    // search_pc
    const excluded = excludedCount();
    send('tool', { tool: 'Searching this PC…', status: 'running', pcState: 'searching', pcExcluded: excluded });
    const found = await searcher.search({ terms: parsed?.terms, kind: parsed?.kind, modified: parsed?.modified }, { gate, turn });
    const label = incognito ? '' : labelOf(parsed?.terms);
    const said = label ? ` for “${label}”` : '';
    if (found.state !== 'ok') {
      const text = found.state === 'nothing' ? (found.message ?? 'No results.') : found.message;
      send('tool', { tool: `Searched this PC${said}`, status: found.state === 'nothing' ? 'done' : 'failed', result: text, pcState: found.state === 'nothing' ? 'none' : found.state === 'unavailable' || found.state === 'timeout' ? found.state : 'other', pcExcluded: excluded });
      if (found.state === 'nothing') activity.log({ who, kind: 'search', results: 0, label });
      return text;
    }
    const allowed = [];
    for (const row of found.rows) {
      const v = await exclusions.allowedPath(row.path);
      // SP-2: a snippet that looks like a key or password is never shown or sent (the file itself is skipped whole when read)
      if (v.ok) allowed.push({ ...row, path: v.real, snippet: textLooksSecret(row.snippet) ? '' : row.snippet });
    }
    if (!allowed.length) {
      activity.log({ who, kind: 'search', results: 0, label });
      send('tool', { tool: `Searched this PC${said}`, status: 'done', result: 'No results (some were in folders Bunny never searches).', pcState: 'none', pcExcluded: excluded });
      return 'No results.';
    }
    const entries = addRefs(turn, allowed);
    for (const e of entries) e.chat = chat;
    remember(entries);
    activity.log({ who, kind: 'search', results: entries.length, label });
    const shown = entries.map((e) => ({ ref: e.ref, name: e.name, folder: e.folder, modified: e.modified, snippet: e.snippet, openable: canOpen(e.path) }));
    const step = `Searched this PC${said} · ${plural(entries.length, 'result', 'results')}`;
    await logStep({ role: 'assistant', kind: 'tool_call', tool: step, status: 'done', content: '', result: entries.slice(0, SHOWN_ROWS).map((e) => `${e.name} (${e.folder})`).join('\n'), pcResults: shown.map(({ snippet, ...rest }) => rest) }); // names, folders and dates are kept; a snippet is file text and is not (SP-8)
    send('tool', { tool: step, status: 'done', result: entries.slice(0, SHOWN_ROWS).map((e) => `${e.name}\n${e.folder}`).join('\n\n'), pcResults: shown, pcShown: SHOWN_ROWS, pcState: 'results', pcTotal: entries.length, pcExcluded: excluded });
    let text = `${plural(entries.length, 'result', 'results')} (names, folders and dates; read one with read_pc_file and its ref):\n${listForModel(entries.slice(0, 20))}`;
    if (after() === 'read') {
      // "Read the files, then answer": Bunny itself reads the top matches, shown to the person as "Read N files", and hands them to the model as marked data
      const blocks = [];
      const readNames = [];
      const skipped = [];
      const toRead = entries.slice(0, MAX_READS_PER_TURN);
      send('tool', { tool: `Reading ${plural(toRead.length, 'file', 'files')}…`, status: 'running', pcState: 'reading', files: toRead.map((e) => e.name) });
      // what one tool result may hold is 50,000 characters (RESULT_LIMIT), so the files share that: 20,000 each for one or two, about 14,600 each for three
      const each = Math.min(MAX_FILE_CHARS, Math.floor(44_000 / toRead.length));
      for (const e of toRead) {
        const got = await readResult(turn, e.ref, { readAllowed: (p, o) => exclusions.readAllowed(p, o), maxChars: each, ...(readDocument ? { read: readDocument } : {}) });
        if (got.ok) { blocks.push(got.block); readNames.push({ name: got.entry.name, folder: got.entry.folder, part: got.part }); } else { skipped.push(got.message); send('tool', { tool: `Could not read “${got.name ?? e.name}”`, status: 'failed', result: got.message, pcState: 'unreadable', name: got.name ?? e.name, why: got.why }); }
      }
      if (readNames.length) {
        activity.log({ who, kind: 'read', files: readNames });
        const stepRead = `Read ${plural(readNames.length, 'file', 'files')}: ${readNames.map((f) => f.name).join(', ')}`;
        const joined = blocks.join('\n');
        await logStep({ role: 'assistant', kind: 'tool_call', tool: stepRead, status: 'done', content: '', result: readNames.map((f) => `${f.name} (${f.folder})`).join('\n'), fullResult: joined, saveable: !incognito });
        send('tool', { tool: stepRead, status: 'done', result: readNames.map((f) => `${f.name} · ${f.folder} · ${f.part}`).join('\n'), pcTainted: true, pcSources: sourcesOf(turn), pcState: 'read', excludedFiles: skipped.length });
        text += `\n\nBunny read the best ${plural(readNames.length, 'match', 'matches')} for you:\n${joined}`;
      }
      if (skipped.length) text += `\n\nNot read: ${skipped.join(' ')}`;
    }
    return text;
  }

  /** For Open, Show in folder and Copy path (called from the main process only): the real path of a result, judged again, and whether Open is allowed. */
  async function resolveRef(ref) {
    const e = refStore.get(String(ref ?? ''));
    if (!e) return { ok: false, reason: 'That result is no longer available. Search again.' };
    const v = await exclusions.allowedPath(e.path);
    if (!v.ok) return { ok: false, reason: 'Bunny does not open files there.' };
    return { ok: true, real: v.real, openable: canOpen(v.real) };
  }

  return { exclusions, searcher, activity, refStore, runTool, resolveRef, enabled, after, sourcesOf, excludedCount, setPersonal: (list) => exclusions.setPersonal(list) };
}
