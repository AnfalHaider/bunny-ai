/**
 * OFFICE-MAKE (v0.1.15): Bunny creates Word, Excel and PowerPoint files. This file is the part that does not touch the disk: the tool shapes, every check and limit, the outline for the card,
 * the inline marks, and the build (in a worker thread, so a huge request cannot freeze the server). Where a file goes, and which rules judge it, is in workspace.js (Code mode) and app.js (Chat mode).
 *
 * All input is JSON. Nothing is HTML or raw XML. A string is text: a cell that starts with = + - or @ is TEXT, and a formula exists only through `{ formula }`, which is refused when it could fetch
 * an address, call a program or reach another workbook (so a made sheet never fetches or runs anything when it is opened). Links are https: or mailto: only.
 */
import { Worker } from 'node:worker_threads';

export const OFFICE_TOOLS = Object.freeze(['make_word', 'make_excel', 'make_powerpoint']);
export const OFFICE_EXT = Object.freeze({ make_word: '.docx', make_excel: '.xlsx', make_powerpoint: '.pptx' });
export const OFFICE_KIND = Object.freeze({ make_word: 'Word', make_excel: 'Excel', make_powerpoint: 'PowerPoint' });

export const LIMITS = Object.freeze({
  argsBytes: 4 * 1024 * 1024, textChars: 2_000_000, cells: 200_000, cellChars: 32_767, sheets: 50, blocks: 5_000, bulletItems: 500, tableRows: 200, tableCols: 20,
  slides: 200, slideBullets: 30, slideTableRows: 30, slideTableCols: 10, images: 20, imageBytes: 10 * 1024 * 1024, resultBytes: 50 * 1024 * 1024, buildMs: 30_000, formulaChars: 8192,
});

export class OfficeError extends Error { constructor(message) { super(message); this.name = 'OfficeError'; } }
const refuse = (what) => { throw new OfficeError(`${what} Nothing was written.`); };

// ---------------------------------------------------------------- inline marks

/** `**bold**`, `*italic*`, `[label](https://...)` in plain text. Anything else is text. Returns runs: { text, bold?, italic?, link? }. A link that is not https: or mailto: is written as its label. */
export function parseInline(input) {
  const text = String(input ?? '');
  const runs = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) runs.push({ text: m[2], italic: true });
    else runs.push(/^(https:\/\/|mailto:)/i.test(m[4]) ? { text: m[3], link: m[4] } : { text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text: '' }];
}
/** The text of a string with its marks removed (what a reader sees). */
export const plainText = (input) => parseInline(input).map((r) => r.text).join('');

// ---------------------------------------------------------------- pictures

/** PNG or JPEG by their first bytes (never the name): { type: 'png'|'jpg', width, height } or null. */
export function imageInfo(bytes) {
  const b = Buffer.from(bytes);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { type: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { type: 'jpg', width: 0, height: 0 };
  }
  return null;
}

// ---------------------------------------------------------------- the tool definitions

const textProp = { type: 'string', description: 'Plain text. **bold**, *italic* and [label](https://link) are read; nothing else.' };
export function officeToolDefinitions({ code = false } = {}) {
  const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
  const imageNote = code ? ' Pictures: a path inside the workspace to a PNG or JPEG.' : '';
  return [
    fn('make_word', `Create a Word (.docx) file from structured content: headings, paragraphs, bullet lists, tables${code ? ', pictures' : ''} and page breaks. It makes a NEW file; it never edits one.${imageNote}`,
      { path: { type: 'string', description: code ? 'Where to save it, relative to the workspace root, ending .docx' : 'A file name ending .docx' }, title: { type: 'string' },
        blocks: { type: 'array', description: 'At most 5,000 blocks, in order', items: { type: 'object', properties: { type: { type: 'string', enum: ['heading', 'paragraph', 'bullets', 'table', ...(code ? ['image'] : []), 'page_break'] }, level: { type: 'integer', description: 'heading: 1 to 4' }, text: textProp, align: { type: 'string', enum: ['left', 'center', 'right'] }, items: { type: 'array', items: { type: 'string' } }, numbered: { type: 'boolean' }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, header: { type: 'boolean' }, ...(code ? { path: { type: 'string' }, width_cm: { type: 'number' } } : {}) }, required: ['type'] } },
        ...(code ? { overwrite: { type: 'boolean', description: 'Replace a file that already exists. Default false' } } : {}) }, ['path', 'blocks']),
    fn('make_excel', 'Create an Excel (.xlsx) file: sheets of rows. A cell is a string, number, boolean or null, or { value, type: "text"|"number"|"date", format, bold }, or { formula: "SUM(A1:A2)" }. A string is always text, even if it starts with =. A formula can use only plain functions: none that fetch an address, call a program or open another workbook.',
      { path: { type: 'string', description: code ? 'Where to save it, relative to the workspace root, ending .xlsx' : 'A file name ending .xlsx' },
        sheets: { type: 'array', description: 'At most 50 sheets', items: { type: 'object', properties: { name: { type: 'string', description: '1 to 31 characters, none of []:*?/\\' }, rows: { type: 'array', items: { type: 'array', items: {} } }, column_widths: { type: 'array', items: { type: 'number' } }, freeze_header: { type: 'boolean' } }, required: ['name', 'rows'] } },
        ...(code ? { overwrite: { type: 'boolean', description: 'Replace a file that already exists. Default false' } } : {}) }, ['path', 'sheets']),
    fn('make_powerpoint', `Create a PowerPoint (.pptx) file: 16:9 slides with a title, bullets, text, a table${code ? ', a picture' : ''} and speaker notes.${imageNote}`,
      { path: { type: 'string', description: code ? 'Where to save it, relative to the workspace root, ending .pptx' : 'A file name ending .pptx' }, title: { type: 'string' },
        slides: { type: 'array', description: 'At most 200 slides', items: { type: 'object', properties: { title: textProp, bullets: { type: 'array', items: { type: 'string' } }, text: textProp, table: { type: 'object', properties: { rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, header: { type: 'boolean' } } }, ...(code ? { image: { type: 'object', properties: { path: { type: 'string' } } } } : {}), notes: textProp } } },
        ...(code ? { overwrite: { type: 'boolean', description: 'Replace a file that already exists. Default false' } } : {}) }, ['path', 'slides']),
  ];
}

export function describeOffice(name, args = {}) {
  return `Make ${OFFICE_KIND[name] ?? ''} file ${args.path ?? ''}`.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- validation

/** OM-2: the only functions a made sheet may call. Anything else followed by "(" is refused: a denylist missed IMAGE(), which fetches an address when the sheet opens in Excel 365. */
export const FORMULA_FUNCTIONS = Object.freeze(new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS', 'SUMIF', 'SUMIFS', 'AVERAGEIF', 'AVERAGEIFS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'INT', 'MOD', 'POWER', 'SQRT', 'PRODUCT', 'MEDIAN',
  'IF', 'IFS', 'IFERROR', 'AND', 'OR', 'NOT',
  'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH',
  'CONCAT', 'CONCATENATE', 'TEXT', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'TRIM',
  'TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY',
]));
/** Functions newer than Excel 2007 are stored with this prefix in the file; without it Excel shows #NAME?. */
export const FUTURE_FUNCTIONS = Object.freeze(new Set(['IFS', 'XLOOKUP', 'CONCAT']));
const ADDRESS_LIKE = /(https?:|ftp:|file:|ldap:|\\\\|\/\/|www\.|[a-z]:[\\/])/i;
/** Why a formula is refused, or ''. Allowlist of function names; no external workbook ("["), no program call ("|"), no quoted path, no string that looks like an address. */
export function formulaProblem(formula) {
  const f = String(formula ?? '').trim().replace(/^=/, '');
  if (!f) return 'A formula is empty.';
  if (f.length > LIMITS.formulaChars) return `A formula is longer than ${LIMITS.formulaChars} characters.`;
  if (/[|]/.test(f)) return 'The formula has a "|", the form a program call (DDE) takes.';
  if (/\[/.test(f)) return 'The formula reaches into another workbook ("[").';
  // the string literals ("...") are text: judged for an address, then taken out so a name inside one is not mistaken for a function
  const literals = f.match(/"(?:[^"]|"")*"/g) ?? [];
  for (const lit of literals) if (ADDRESS_LIKE.test(lit)) return 'The formula holds text that looks like an address or a file, which a sheet may not fetch.';
  const bare = f.replace(/"(?:[^"]|"")*"/g, '""');
  if (/'[^']*'!/.test(bare) && /'[^']*(?:[\\/]|[a-z]:)[^']*'!/i.test(bare)) return 'The formula names a file path.';
  if (/(^|[^A-Za-z0-9_.])[A-Za-z]:[\\/]|\\\\|https?:\/\//i.test(bare)) return 'The formula names a file or an address.';
  for (const m of bare.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const name = m[1].toUpperCase();
    if (!FORMULA_FUNCTIONS.has(name)) return `The formula uses ${m[1]}, which is not one of the functions a made sheet may use (${[...FORMULA_FUNCTIONS].slice(0, 8).join(', ')} and others of the plain maths, logic, look-up, text and date kind).`;
  }
  return '';
}

/** OM-3: a picture is a path inside the workspace folder, never an address, a network path, a drive or "..": Bunny reads it itself and gives the library only bytes. */
export function pictureProblem(p) {
  const t = String(p ?? '').trim();
  if (!t) return 'A picture needs a path.';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) || t.startsWith('\\\\') || t.startsWith('//') || t.startsWith('/') || t.startsWith('\\') || t.includes('\0') || t.split(/[\\/]/).some((x) => x === '..')) return `The picture "${t.slice(0, 60)}" must be a path inside the workspace folder (not an address, a network path, a drive path or one with ..).`;
  return '';
}
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const count = { chars: 0 };
const addChars = (s) => { count.chars += String(s ?? '').length; if (count.chars > LIMITS.textChars) refuse(`The file would hold more than ${LIMITS.textChars.toLocaleString('en')} characters of text.`); };

/** The checked, plain form of a tool call. `code` is true in a chat with a folder (pictures are allowed there). Throws OfficeError naming the limit. */
export function validateOffice(name, args, { code = false } = {}) {
  if (!OFFICE_TOOLS.includes(name)) throw new OfficeError(`There is no tool called ${name}.`);
  if (!isObj(args)) refuse('The call was not an object.');
  if (JSON.stringify(args).length > LIMITS.argsBytes) refuse(`The call is bigger than ${LIMITS.argsBytes / 1024 / 1024} MB.`);
  count.chars = 0;
  const path = text(args.path).trim();
  if (!path) refuse(`${name} needs a path.`);
  const ext = OFFICE_EXT[name];
  if (!path.toLowerCase().endsWith(ext) || path.length <= ext.length) refuse(`The file name must end in ${ext}.`);
  const base = { path, overwrite: args.overwrite === true };
  if (name === 'make_word') {
    const blocks = Array.isArray(args.blocks) ? args.blocks : refuse('make_word needs a list of blocks.');
    if (blocks.length > LIMITS.blocks) refuse(`A Word file holds at most ${LIMITS.blocks.toLocaleString('en')} blocks (this has ${blocks.length}).`);
    let images = 0;
    const out = blocks.map((b, i) => {
      if (!isObj(b)) refuse(`Block ${i + 1} is not an object.`);
      switch (b.type) {
        case 'heading': { const level = Math.min(4, Math.max(1, Math.round(Number(b.level) || 1))); addChars(b.text); return { type: 'heading', level, text: text(b.text) }; }
        case 'paragraph': addChars(b.text); return { type: 'paragraph', text: text(b.text), align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'left' };
        case 'bullets': {
          const items = Array.isArray(b.items) ? b.items.map(text) : refuse(`Block ${i + 1} (bullets) needs items.`);
          if (items.length > LIMITS.bulletItems) refuse(`A bullet list holds at most ${LIMITS.bulletItems} items.`);
          items.forEach(addChars); return { type: 'bullets', items, numbered: b.numbered === true };
        }
        case 'table': return { type: 'table', rows: tableRows(b.rows, LIMITS.tableRows, LIMITS.tableCols, 'A Word table'), header: b.header !== false };
        case 'image': {
          if (!code) refuse('Pictures can be added only in a chat that has a folder.');
          images += 1; if (images > LIMITS.images) refuse(`A file holds at most ${LIMITS.images} pictures.`);
          const ip = text(b.path).trim(); { const why = pictureProblem(ip); if (why) refuse(why); }
          const w = Number(b.width_cm); return { type: 'image', path: ip, width_cm: Number.isFinite(w) ? Math.min(17, Math.max(1, w)) : 12 };
        }
        case 'page_break': return { type: 'page_break' };
        default: return refuse(`Block ${i + 1} has an unknown type.`);
      }
    });
    return { ...base, name, title: text(args.title).slice(0, 200), blocks: out };
  }
  if (name === 'make_excel') {
    const sheets = Array.isArray(args.sheets) ? args.sheets : refuse('make_excel needs a list of sheets.');
    if (!sheets.length) refuse('A workbook needs at least one sheet.');
    if (sheets.length > LIMITS.sheets) refuse(`A workbook holds at most ${LIMITS.sheets} sheets (this has ${sheets.length}).`);
    let cells = 0; const names = new Set();
    const out = sheets.map((s, i) => {
      if (!isObj(s)) refuse(`Sheet ${i + 1} is not an object.`);
      const nm = text(s.name).trim();
      if (!nm || nm.length > 31 || /[\[\]:*?/\\]/.test(nm)) refuse(`Sheet ${i + 1}'s name must be 1 to 31 characters with none of []:*?/\\.`);
      if (names.has(nm.toLowerCase())) refuse(`Two sheets are called "${nm}".`);
      names.add(nm.toLowerCase());
      const rows = Array.isArray(s.rows) ? s.rows : refuse(`Sheet "${nm}" needs rows.`);
      const outRows = rows.map((row, r) => {
        if (!Array.isArray(row)) refuse(`Row ${r + 1} of "${nm}" is not a list.`);
        return row.map((cell) => {
          cells += 1; if (cells > LIMITS.cells) refuse(`The workbook would hold more than ${LIMITS.cells.toLocaleString('en')} cells.`);
          return checkCell(cell, nm, r + 1);
        });
      });
      const widths = Array.isArray(s.column_widths) ? s.column_widths.slice(0, 200).map((w) => Math.min(100, Math.max(1, Number(w) || 10))) : [];
      return { name: nm, rows: outRows, column_widths: widths, freeze_header: s.freeze_header === true };
    });
    return { ...base, name, sheets: out, cellCount: cells };
  }
  const slides = Array.isArray(args.slides) ? args.slides : refuse('make_powerpoint needs a list of slides.');
  if (!slides.length) refuse('A deck needs at least one slide.');
  if (slides.length > LIMITS.slides) refuse(`A deck holds at most ${LIMITS.slides} slides (this has ${slides.length}).`);
  let images = 0;
  const out = slides.map((s, i) => {
    if (!isObj(s)) refuse(`Slide ${i + 1} is not an object.`);
    const o = {};
    if (s.title !== undefined) { addChars(s.title); o.title = text(s.title); }
    if (s.bullets !== undefined) {
      const items = Array.isArray(s.bullets) ? s.bullets.map(text) : refuse(`Slide ${i + 1}'s bullets are not a list.`);
      if (items.length > LIMITS.slideBullets) refuse(`A slide holds at most ${LIMITS.slideBullets} bullets.`);
      items.forEach(addChars); o.bullets = items;
    }
    if (s.text !== undefined) { addChars(s.text); o.text = text(s.text); }
    if (isObj(s.table)) o.table = { rows: tableRows(s.table.rows, LIMITS.slideTableRows, LIMITS.slideTableCols, 'A slide table'), header: s.table.header !== false };
    if (isObj(s.image)) {
      if (!code) refuse('Pictures can be added only in a chat that has a folder.');
      images += 1; if (images > LIMITS.images) refuse(`A file holds at most ${LIMITS.images} pictures.`);
      const ip = text(s.image.path).trim(); { const why = pictureProblem(ip); if (why) refuse(why); }
      o.image = { path: ip };
    }
    if (s.notes !== undefined) { addChars(s.notes); o.notes = text(s.notes); }
    return o;
  });
  return { ...base, name, title: text(args.title).slice(0, 200), slides: out };
}

function tableRows(rows, maxRows, maxCols, label) {
  if (!Array.isArray(rows) || !rows.length) refuse(`${label} needs rows.`);
  if (rows.length > maxRows) refuse(`${label} holds at most ${maxRows} rows (this has ${rows.length}).`);
  return rows.map((row) => {
    if (!Array.isArray(row)) refuse(`${label} has a row that is not a list.`);
    if (row.length > maxCols) refuse(`${label} holds at most ${maxCols} columns (a row has ${row.length}).`);
    return row.map((c) => { addChars(c); return text(c); });
  });
}

/** One Excel cell, checked: { kind: 'text'|'number'|'boolean'|'date'|'formula'|'empty', value, format?, bold? }. */
function checkCell(cell, sheet, row) {
  const long = (s) => { if (s.length > LIMITS.cellChars) refuse(`A cell in "${sheet}" row ${row} holds more than ${LIMITS.cellChars.toLocaleString('en')} characters.`); addChars(s); return s; };
  if (cell === null || cell === undefined) return { kind: 'empty' };
  if (typeof cell === 'string') return { kind: 'text', value: long(cell) };
  if (typeof cell === 'number') return Number.isFinite(cell) ? { kind: 'number', value: cell } : { kind: 'empty' };
  if (typeof cell === 'boolean') return { kind: 'boolean', value: cell };
  if (!isObj(cell)) refuse(`A cell in "${sheet}" row ${row} is not text, a number, a boolean or an object.`);
  if (cell.formula !== undefined) {
    const f = text(cell.formula).trim().replace(/^=/, '');
    const why = formulaProblem(f); if (why) refuse(`${why} (sheet "${sheet}", row ${row}).`);
    addChars(f);
    return { kind: 'formula', value: f, format: cell.format ? text(cell.format).slice(0, 100) : undefined, bold: cell.bold === true };
  }
  const type = ['text', 'number', 'date'].includes(cell.type) ? cell.type : (typeof cell.value === 'number' ? 'number' : 'text');
  const format = cell.format ? text(cell.format).slice(0, 100) : undefined;
  const bold = cell.bold === true;
  if (type === 'number') { const n = Number(cell.value); return Number.isFinite(n) ? { kind: 'number', value: n, format, bold } : { kind: 'empty' }; }
  if (type === 'date') { const d = new Date(text(cell.value)); return Number.isNaN(d.getTime()) ? refuse(`A date in "${sheet}" row ${row} is not a date.`) : { kind: 'date', value: d.toISOString(), format: format ?? 'yyyy-mm-dd', bold }; }
  return { kind: 'text', value: long(text(cell.value)), format, bold };
}

// ---------------------------------------------------------------- the outline for the card

/** What the person sees on the card instead of the JSON: Word the headings and counts, Excel the sheets (and every formula), PowerPoint the slide titles. */
export function outline(spec) {
  const head = spec.overwrite ? `Replaces ${spec.path} if it is there.\n` : '';
  if (spec.name === 'make_word') {
    const counts = {}; for (const b of spec.blocks) counts[b.type] = (counts[b.type] ?? 0) + 1;
    const lines = spec.blocks.filter((b) => b.type === 'heading').slice(0, 60).map((b) => `${'  '.repeat(b.level - 1)}${plainText(b.text).slice(0, 100)}`);
    return `${head}Word file ${spec.path}\n${spec.blocks.length} blocks: ${Object.entries(counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}.${lines.length ? `\n\nHeadings:\n${lines.join('\n')}` : ''}`;
  }
  if (spec.name === 'make_excel') {
    const formulas = [];
    const sheets = spec.sheets.map((s) => {
      const cols = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
      s.rows.forEach((r, ri) => r.forEach((c, ci) => { if (c.kind === 'formula') formulas.push(`${s.name}!${columnName(ci)}${ri + 1}: =${c.value}`); }));
      return `${s.name}: ${s.rows.length} rows x ${cols} columns`;
    });
    return `${head}Excel file ${spec.path}\n${spec.sheets.length} sheet${spec.sheets.length === 1 ? '' : 's'}, ${spec.cellCount} cells.\n\n${sheets.join('\n')}${formulas.length ? `\n\nFormulas (${formulas.length}):\n${formulas.slice(0, 40).join('\n')}${formulas.length > 40 ? `\n… and ${formulas.length - 40} more` : ''}` : ''}`;
  }
  return `${head}PowerPoint file ${spec.path}\n${spec.slides.length} slide${spec.slides.length === 1 ? '' : 's'}.\n\n${spec.slides.slice(0, 60).map((s, i) => `${i + 1}. ${plainText(s.title ?? '(no title)').slice(0, 100)}`).join('\n')}`;
}
export function columnName(i) { let n = i; let s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }

// ---------------------------------------------------------------- the build (a worker, so a huge request cannot freeze Bunny)

/**
 * Build the file. `images` maps a path to its bytes (Code mode; already read through the workspace and judged by the person's read rules). Resolves a Buffer of at most 50 MB.
 * `workerUrl` is for the tests (a stand-in worker that never answers shows the 30 s limit; `timeoutMs` shortens it).
 */
export function buildOffice(spec, { images = new Map(), timeoutMs = LIMITS.buildMs, workerUrl = new URL('./officeWorker.js', import.meta.url) } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const worker = new Worker(workerUrl, { workerData: { spec, images: [...images.entries()].map(([p, b]) => [p, new Uint8Array(b)]) }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); worker.terminate().catch(() => {}); fn(value); };
    const timer = setTimeout(() => finish(reject, new OfficeError(`Building the file took longer than ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. Nothing was written.`)), timeoutMs);
    worker.once('message', (m) => {
      if (!m?.ok) return finish(reject, new OfficeError(`${String(m?.message ?? 'The file could not be built.').slice(0, 300)} Nothing was written.`));
      const buf = Buffer.from(m.bytes);
      if (buf.length > LIMITS.resultBytes) return finish(reject, new OfficeError(`The finished file would be ${Math.round(buf.length / 1024 / 1024)} MB, more than the ${LIMITS.resultBytes / 1024 / 1024} MB limit. Nothing was written.`));
      return finish(resolve, buf);
    });
    worker.once('error', (err) => finish(reject, new OfficeError(`The file could not be built (${String(err?.message ?? err).slice(0, 120)}). Nothing was written.`)));
    worker.once('exit', (code) => finish(reject, new OfficeError(`The builder stopped (${code}). Nothing was written.`)));
  });
}

/** The line the model gets back. */
export function madeLine(spec, bytes) {
  const kb = `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (spec.name === 'make_word') return `Made ${spec.path} (Word, ${spec.blocks.length} blocks, ${kb})`;
  if (spec.name === 'make_excel') return `Made ${spec.path} (Excel, ${spec.sheets.length} sheet${spec.sheets.length === 1 ? '' : 's'}, ${spec.cellCount} cells, ${kb})`;
  return `Made ${spec.path} (PowerPoint, ${spec.slides.length} slide${spec.slides.length === 1 ? '' : 's'}, ${kb})`;
}
