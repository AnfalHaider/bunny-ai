/**
 * SEARCH-PC: the one place that puts the exclusions, the index search, the two tools, the activity record and the refs together. app.js only calls this.
 */
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { createExclusions } from './pcExclusions.js';
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

  const enabled = () => getSettings().pcSearchEnabled === true;
  const after = () => (getSettings().pcSearchAfter === 'show' ? 'show' : 'read');
  const labelOf = (terms) => (Array.isArray(terms) ? terms : []).map((t) => String(t ?? '').replace(/[^\p{L}\p{N} \-_.]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, LABEL_CHARS);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /**
   * Run one of the two tools. Returns what the model is told (a string); `send` shows steps to the person.
   * @param {{ name: string, parsed: object, turn: object, who: string, incognito?: boolean, gate: string, send: Function, logStep?: Function }} call
   */
  async function runTool({ name, parsed, turn, who, incognito = false, gate, send, logStep = async () => {} }) {
    if (!enabled()) { send('tool', { tool: 'Search this PC', status: 'denied', result: 'Search this PC is off. Turn it on in Settings, Capabilities.' }); return 'Search this PC is off. The person can turn it on in Settings, Capabilities.'; }
    if (name === 'read_pc_file') {
      const got = await readResult(turn, parsed?.ref, { readAllowed: (p, o) => exclusions.readAllowed(p, o), ...(readDocument ? { read: readDocument } : {}) });
      if (!got.ok) { send('tool', { tool: 'Read a file', status: 'failed', result: got.message }); return got.message; }
      activity.log({ who, kind: 'read', files: [{ name: got.entry.name, folder: got.entry.folder }] });
      const step = `Read 1 file: ${got.entry.name}`;
      await logStep({ role: 'assistant', kind: 'tool_call', tool: step, status: 'done', content: '', result: `${got.entry.name} (${got.part})`, fullResult: got.block, saveable: !incognito });
      send('tool', { tool: step, status: 'done', result: `${got.entry.name} · ${got.entry.folder} · ${got.part}` });
      return got.block;
    }
    // search_pc
    const found = await searcher.search({ terms: parsed?.terms, kind: parsed?.kind, modified: parsed?.modified }, { gate, turn });
    const label = incognito ? '' : labelOf(parsed?.terms);
    const said = label ? ` for “${label}”` : '';
    if (found.state !== 'ok') {
      const text = found.state === 'nothing' ? (found.message ?? 'No results.') : found.message;
      send('tool', { tool: `Searched this PC${said}`, status: found.state === 'nothing' ? 'done' : 'failed', result: text });
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
      send('tool', { tool: `Searched this PC${said}`, status: 'done', result: 'No results (some were in folders Bunny never searches).' });
      return 'No results.';
    }
    const entries = addRefs(turn, allowed);
    remember(entries);
    activity.log({ who, kind: 'search', results: entries.length, label });
    const shown = entries.map((e) => ({ ref: e.ref, name: e.name, folder: e.folder, modified: e.modified, snippet: e.snippet, openable: canOpen(e.path) }));
    const step = `Searched this PC${said} · ${plural(entries.length, 'result', 'results')}`;
    await logStep({ role: 'assistant', kind: 'tool_call', tool: step, status: 'done', content: '', result: entries.slice(0, SHOWN_ROWS).map((e) => `${e.name} (${e.folder})`).join('\n') });
    send('tool', { tool: step, status: 'done', result: entries.slice(0, SHOWN_ROWS).map((e) => `${e.name}\n${e.folder}`).join('\n\n'), pcResults: shown, pcShown: SHOWN_ROWS });
    let text = `${plural(entries.length, 'result', 'results')} (names, folders and dates; read one with read_pc_file and its ref):\n${listForModel(entries.slice(0, 20))}`;
    if (after() === 'read') {
      // "Read the files, then answer": Bunny itself reads the top matches, shown to the person as "Read N files", and hands them to the model as marked data
      const blocks = [];
      const readNames = [];
      const skipped = [];
      const toRead = entries.slice(0, MAX_READS_PER_TURN);
      // what one tool result may hold is 50,000 characters (RESULT_LIMIT), so the files share that: 20,000 each for one or two, about 14,600 each for three
      const each = Math.min(MAX_FILE_CHARS, Math.floor(44_000 / toRead.length));
      for (const e of toRead) {
        const got = await readResult(turn, e.ref, { readAllowed: (p, o) => exclusions.readAllowed(p, o), maxChars: each, ...(readDocument ? { read: readDocument } : {}) });
        if (got.ok) { blocks.push(got.block); readNames.push({ name: got.entry.name, folder: got.entry.folder }); } else skipped.push(got.message);
      }
      if (readNames.length) {
        activity.log({ who, kind: 'read', files: readNames });
        const stepRead = `Read ${plural(readNames.length, 'file', 'files')}: ${readNames.map((f) => f.name).join(', ')}`;
        const joined = blocks.join('\n');
        await logStep({ role: 'assistant', kind: 'tool_call', tool: stepRead, status: 'done', content: '', result: readNames.map((f) => `${f.name} (${f.folder})`).join('\n'), fullResult: joined, saveable: !incognito });
        send('tool', { tool: stepRead, status: 'done', result: readNames.map((f) => `${f.name} · ${f.folder}`).join('\n') });
        text += `\n\nBunny read the best ${plural(readNames.length, 'match', 'matches')} for you:\n${joined}`;
      }
      if (skipped.length) { send('tool', { tool: 'Some files were not read', status: 'done', result: skipped.join('\n') }); text += `\n\nNot read: ${skipped.join(' ')}`; }
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

  return { exclusions, searcher, activity, refStore, runTool, resolveRef, enabled, after, setPersonal: (list) => exclusions.setPersonal(list) };
}
