/**
 * SEARCH-PC: asking the Windows Search index for files (SP-1, SP-7). Read-only, the index only, never a scan of the disk.
 *
 * The question never becomes query text: the caller gives at most 8 terms, each is cleaned to letters, digits, spaces and - _ . (64 characters at most), has the
 * LIKE wildcards escaped and its quotes doubled, and goes into a FIXED template with fixed columns. The kind and the date come from fixed choices only.
 * The query reaches PowerShell in an environment variable, never on the command line, and PowerShell runs a script that is a fixed string in this file.
 */
import { execFile } from 'node:child_process';
import { powershellPath, safeEnv, taskkillPath } from './safeExec.js';

export const MAX_TERMS = 8;
export const MAX_TERM_CHARS = 64;
export const MAX_ROWS = 50;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const SEARCH_TIMEOUT_MS = 10_000;
export const MAX_SEARCHES_PER_TURN = 5;
export const SNIPPET_CHARS = 200;

/** The kinds a search may ask for, each a fixed list of file types. */
export const KINDS = Object.freeze({
  any: null,
  document: ['.doc', '.docx', '.odt', '.rtf', '.txt', '.md'],
  spreadsheet: ['.xls', '.xlsx', '.csv', '.ods'],
  presentation: ['.ppt', '.pptx', '.odp'],
  pdf: ['.pdf'],
  text: ['.txt', '.md', '.csv', '.log'],
  picture: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic'],
});
export const WHEN = Object.freeze(['any', '7d', '30d', '1y']);

/** Terms as the template takes them: cleaned, at most 8, each at most 64 characters, empty ones dropped. */
export function cleanTerms(terms) {
  const list = Array.isArray(terms) ? terms : [];
  const out = [];
  for (const raw of list) {
    const t = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} \-_.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS).trim();
    if (t) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const likeEscape = (s) => String(s).replace(/[%_[\]]/g, (c) => `[${c}]`);
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00`;

/** The query text, or null when nothing is left to search for. Pure: `now` is given for the dates. */
export function buildQuery({ terms, kind = 'any', modified = 'any', now = new Date() } = {}) {
  const clean = cleanTerms(terms);
  if (!clean.length) return null;
  if (!Object.hasOwn(KINDS, kind)) throw new Error('That kind of file is not one of the choices.');
  const parts = clean.map((t) => `(CONTAINS(${quote(`"${t}"`)}) OR System.ItemName LIKE ${quote(`%${likeEscape(t)}%`)})`);
  let where = `SCOPE='file:' AND ${parts.join(' AND ')}`;
  const exts = KINDS[kind];
  if (exts) where += ` AND (${exts.map((e) => `System.FileExtension = ${quote(e)}`).join(' OR ')})`;
  const when = String(modified ?? 'any');
  if (when === '7d' || when === '30d' || when === '1y') {
    const from = new Date(now.getTime() - ({ '7d': 7, '30d': 30, '1y': 365 }[when]) * 86_400_000);
    where += ` AND System.DateModified >= ${quote(day(from))}`;
  } else if (/^\d{4}$/.test(when)) {
    const y = Number(when);
    if (y < 1980 || y > 2200) throw new Error('That year is not one of the choices.');
    where += ` AND System.DateModified >= ${quote(`${y}-01-01 00:00:00`)} AND System.DateModified < ${quote(`${y + 1}-01-01 00:00:00`)}`;
  } else if (when !== 'any') throw new Error('That time is not one of the choices.');
  return `SELECT TOP ${MAX_ROWS} System.ItemPathDisplay, System.ItemName, System.DateModified, System.Size, System.Search.AutoSummary FROM SystemIndex WHERE ${where} ORDER BY System.Search.Rank DESC`;
}

/** The script PowerShell runs: fixed text. It reads the query from the environment and writes one JSON line per row. It never prints an error's own words. */
export const SEARCH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  "  $service = Get-Service -Name WSearch -ErrorAction SilentlyContinue",
  "  if (-not $service -or $service.Status -ne 'Running') { '{\"error\":\"service\"}'; exit 0 }",
  "  $c = New-Object System.Data.OleDb.OleDbConnection(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows'\")",
  '  $c.Open()',
  '  $m = $c.CreateCommand()',
  '  $m.CommandText = $env:BUNNY_PCSEARCH_SQL',
  '  $r = $m.ExecuteReader()',
  '  while ($r.Read()) {',
  '    [pscustomobject]@{ p = [string]$r[0]; n = [string]$r[1]; m = [string]$r[2]; s = [string]$r[3]; a = [string]$r[4] } | ConvertTo-Json -Compress',
  '  }',
  "  '{\"done\":true}'",
  "} catch { '{\"error\":\"' + $_.Exception.GetType().Name + '\"}' }",
].join('\n');

/**
 * The real runner: PowerShell by its full path, the query in the environment. Resolves { lines, timedOut, tooBig } and never throws.
 * @param {string} sql
 */
export function runPowerShell(sql, { timeoutMs = SEARCH_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    const ps = powershellPath();
    if (!ps) return resolve({ lines: ['{"error":"platform"}'], timedOut: false, tooBig: false });
    let out = '';
    let tooBig = false;
    let timedOut = false;
    const child = execFileImpl(ps, ['-NoProfile', '-NonInteractive', '-Command', SEARCH_SCRIPT], {
      env: safeEnv({ BUNNY_PCSEARCH_SQL: sql }), windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES * 2,
    }, () => {});
    const kill = () => { try { execFileImpl(taskkillPath(), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch { /* it is gone */ } try { child.kill(); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += chunk; if (out.length > MAX_OUTPUT_BYTES) { tooBig = true; kill(); } });
    child.on('close', () => { clearTimeout(timer); resolve({ lines: out.split(/\r?\n/).filter(Boolean), timedOut, tooBig }); });
    child.on('error', () => { clearTimeout(timer); resolve({ lines: ['{"error":"start"}'], timedOut, tooBig }); });
  });
}

const cutSnippet = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS);

/**
 * One search. `run(sql)` is the runner (the real one, or a fake in tests). One search at a time per `gate` (a chat or the bar).
 * @returns {Promise<{ state: 'ok', rows: object[], truncated: boolean } | { state: 'nothing' } | { state: 'unavailable' | 'timeout' | 'busy' | 'limit' | 'bad', message: string }>}
 */
export function createPcSearch({ run = runPowerShell, now = () => new Date(), maxPerTurn = MAX_SEARCHES_PER_TURN } = {}) {
  const busy = new Set();
  /** @param {{ terms: string[], kind?: string, modified?: string }} request @param {{ gate?: string, turn?: { searches: number } }} [where] */
  async function search(request, { gate = 'chat', turn = { searches: 0 } } = {}) {
    let sql;
    try { sql = buildQuery({ ...request, now: now() }); } catch (err) { return { state: 'bad', message: err.message }; }
    if (!sql) return { state: 'nothing', message: 'Nothing to search for.' };
    if (turn.searches >= maxPerTurn) return { state: 'limit', message: `A reply may search this PC ${maxPerTurn} times. Answer with what you have.` };
    if (busy.has(gate)) return { state: 'busy', message: 'A search is already running here. Wait for it.' };
    busy.add(gate);
    turn.searches += 1;
    try {
      const { lines, timedOut, tooBig } = await run(sql);
      if (timedOut) return { state: 'timeout', message: 'Windows Search did not answer in time.' };
      const rows = [];
      for (const line of lines) {
        let x;
        try { x = JSON.parse(line); } catch { continue; }
        if (x.error) return { state: 'unavailable', message: 'Windows Search is not available.' };
        if (x.done) continue;
        if (typeof x.p !== 'string' || !x.p) continue;
        if (rows.length >= MAX_ROWS) break;
        rows.push({ path: x.p, name: String(x.n ?? ''), modified: String(x.m ?? ''), size: Number(x.s) || 0, snippet: cutSnippet(x.a) });
      }
      if (!rows.length) return { state: 'nothing', message: 'No results.' };
      return { state: 'ok', rows, truncated: tooBig || rows.length >= MAX_ROWS };
    } finally { busy.delete(gate); }
  }
  return { search };
}
