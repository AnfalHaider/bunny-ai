/**
 * Documents: pull the words (and the pictures) out of files people attach or
 * the model opens, so any model can read them.
 *
 *   PDF                         unpdf (text per page, pictures on pages)
 *   DOCX PPTX XLSX              the XML inside the zip, plus the pictures in it
 *   ODT ODP ODS EPUB            the same idea for OpenDocument and e-books
 *   RTF HTML                    plain text
 *   DOC PPT XLS (old Office)    converted to the new format by Office itself on
 *                               this computer (macros forced off); without Office,
 *                               the readable text is picked out of the file
 *
 * Pictures come back as PNG / JPEG data URLs. The caller decides whether the
 * model sees them and whether to read the text in them (ocr.js).
 */
import { inflateRawSync, deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { powershellPath } from './safeExec.js';

export const MAX_TEXT = 150_000;
const MAX_PICTURES = 8;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;

const EXT_KIND = {
  '.pdf': 'pdf', '.docx': 'docx', '.docm': 'docx', '.dotx': 'docx', '.pptx': 'pptx', '.pptm': 'pptx', '.ppsx': 'pptx',
  '.xlsx': 'xlsx', '.xlsm': 'xlsx', '.odt': 'odt', '.odp': 'odp', '.ods': 'ods', '.epub': 'epub', '.rtf': 'rtf',
  '.doc': 'doc', '.dot': 'doc', '.ppt': 'ppt', '.pps': 'ppt', '.xls': 'xls', '.htm': 'html', '.html': 'html',
};
const MIME_KIND = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/epub+zip': 'epub',
  'application/rtf': 'rtf', 'text/rtf': 'rtf',
  'application/msword': 'doc', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.ms-excel': 'xls',
};
export const DOCUMENT_LABEL = {
  pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', odt: 'OpenDocument text', odp: 'OpenDocument slides',
  ods: 'OpenDocument sheet', epub: 'E-book', rtf: 'Rich text', doc: 'Word 97-2003', ppt: 'PowerPoint 97-2003',
  xls: 'Excel 97-2003', html: 'Web page',
};

/** Which reader a file needs, or null for plain text / images / unknown. HTML only by extension. */
export function documentKind(name, mime = '') {
  const byExt = EXT_KIND[extname(String(name ?? '')).toLowerCase()];
  if (byExt) return byExt;
  return MIME_KIND[String(mime).toLowerCase().split(';')[0].trim()] ?? null;
}

// ---------------------------------------------------------------- zip

/** The files inside a zip, read on demand. Enough of the format for Office and OpenDocument files. */
export function openZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is damaged or is not the format its name says.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.size);
    if (e.method === 0) return Buffer.from(raw);
    if (e.method === 8) return inflateRawSync(raw);
    return null;
  };
  return { names: [...entries.keys()], read, text: (name) => read(name)?.toString('utf8') ?? null };
}

// ---------------------------------------------------------------- xml helpers

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, ''));
const tidy = (s) => String(s).replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const byNumber = (re) => (a, b) => Number(re.exec(a)?.[1] ?? 0) - Number(re.exec(b)?.[1] ?? 0);

function wordXml(xml) {
  // A table: one line per row, cells joined with |, before paragraphs are split.
  const withTables = String(xml ?? '').replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((tr) => [...tr[0].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)]
      .map((tc) => stripTags(tc[1].replace(/<\/w:p>/g, ' ')).replace(/\s+/g, ' ').trim()).join(' | '));
    const text = rows.map((r) => `| ${r} |`).join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<w:p><w:t>${text}</w:t></w:p>`;
  });
  const paras = withTables.split(/<\/w:p>/);
  return paras.map((p) => {
    const heading = /<w:pStyle w:val="(?:Heading|heading)\s?(\d)"/.exec(p) ?? /<w:pStyle w:val="Title"/.exec(p);
    const list = /<w:numPr>/.test(p);
    const text = stripTags(p.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, ''));
    if (!text.trim()) return '';
    if (heading) return `${'#'.repeat(Math.min(Number(heading[1] ?? 1), 6))} ${text.trim()}`;
    return list ? `- ${text.trim()}` : text;
  }).join('\n');
}

function slideXml(xml) {
  return String(xml ?? '').split(/<\/a:p>/).map((p) => stripTags(p.replace(/<a:br\/>/g, '\n'))).filter((l) => l.trim()).join('\n');
}

function colNumber(ref) {
  let n = 0;
  for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function sheetXml(xml, shared) {
  const rows = [];
  for (const row of String(xml ?? '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= 3000) { rows.push('… (more rows)'); break; }
    const cells = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? '';
      const col = colNumber(/\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '');
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      if (type === 's') value = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') value = stripTags(inner);
      else value = decodeEntities(value);
      if (col) while (cells.length < col - 1) cells.push('');
      cells.push(String(value).replace(/\s+/g, ' ').trim());
    }
    if (cells.some(Boolean)) rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

function openDocumentXml(xml) {
  return stripTags(String(xml ?? '')
    // A cell's paragraphs stay on the cell's line.
    .replace(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g, (_m, inner) => `${inner.replace(/<\/text:(p|h)>/g, ' ').trim()}</table:table-cell>`)
    .replace(/<office:annotation[\s\S]*?<\/office:annotation>/g, '')
    .replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_m, n) => ' '.repeat(Number(n ?? 1)))
    .replace(/<\/text:(p|h)>/g, '\n').replace(/<\/table:table-cell>/g, '\t').replace(/<\/table:table-row>/g, '\n')
    .replace(/<draw:page\b[^>]*draw:name="([^"]*)"[^>]*>/g, '\n--- $1 ---\n'));
}

export function htmlToText(html) {
  return tidy(decodeEntities(String(html ?? '')
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')));
}

export function rtfToText(rtf) {
  // Line breaks in the source mean nothing in RTF.
  let s = String(rtf ?? '').replace(/\r?\n/g, '');
  // Drop groups that are not body text, however deeply nested: {\* ...} groups,
  // fonts, colours, styles, pictures, metadata.
  for (const word of ['*', 'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'listtable', 'listoverridetable', 'themedata', 'datastore', 'latentstyles']) {
    let i;
    while ((i = s.indexOf(`{\\${word}`)) !== -1) {
      let depth = 0; let j = i;
      for (; j < s.length; j += 1) { if (s[j] === '{') depth += 1; else if (s[j] === '}') { depth -= 1; if (!depth) break; } }
      s = s.slice(0, i) + s.slice(j + 1);
    }
  }
  return tidy(s
    .replace(/\\(par|line|row)\b ?/g, '\n').replace(/\\(tab|cell)\b ?/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
    .replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, ''));
}

/** Last resort for an old binary file: the runs of readable text inside it. */
export function readableRuns(buf) {
  const out = [];
  const ascii = buf.toString('latin1').match(/[\x20-\x7e\t\r\n -ÿ]{6,}/g) ?? [];
  const utf16 = buf.toString('utf16le').match(/[\x20-\x7e -ɏЀ-ӿ؀-ۿ\t\r\n]{6,}/g) ?? [];
  for (const run of [...utf16, ...ascii]) {
    const t = run.replace(/\s+/g, ' ').trim();
    if (t.length >= 6 && /[a-z]{3}/i.test(t) && !/^[\W\d_]+$/.test(t)) out.push(t);
  }
  return [...new Set(out)].join('\n');
}

// ---------------------------------------------------------------- pictures

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/** Raw pixels (1, 3 or 4 channels) to PNG, shrunk to fit `max` pixels a side. */
export function encodePng({ data, width, height, channels }, max = 1600) {
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const ch = channels === 1 || channels === 3 || channels === 4 ? channels : 4;
  const row = w * ch;
  const raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      for (let k = 0; k < ch; k += 1) raw[y * (row + 1) + 1 + x * ch + k] = data[(sy * width + sx) * ch + k];
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = { 1: 0, 3: 2, 4: 6 }[ch];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PICTURE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
function zipPictures(zip, prefixes) {
  const out = [];
  for (const name of zip.names) {
    if (out.length >= MAX_PICTURES) break;
    const mime = PICTURE_MIME[extname(name).toLowerCase()];
    if (!mime || !prefixes.some((p) => name.startsWith(p))) continue;
    const body = zip.read(name);
    if (!body || body.length < 3000 || body.length > MAX_PICTURE_BYTES) continue; // icons and bullets are not worth it
    out.push({ name: name.split('/').pop(), mime, data: `data:${mime};base64,${body.toString('base64')}` });
  }
  return out;
}

// ---------------------------------------------------------------- readers

async function readPdf(buf) {
  const { getDocumentProxy, extractText, extractImages } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  const pictures = [];
  const scanned = [];
  for (let i = 0; i < Math.min(totalPages, 40) && pictures.length < MAX_PICTURES; i += 1) {
    const pageText = String(pages[i] ?? '').trim();
    let images = [];
    try { images = await extractImages(pdf, i + 1); } catch { images = []; }
    for (const img of images) {
      if (pictures.length >= MAX_PICTURES) break;
      if (img.width < 120 || img.height < 120) continue;
      const png = encodePng(img);
      pictures.push({ name: `page ${i + 1}`, mime: 'image/png', data: `data:image/png;base64,${png.toString('base64')}`, page: i + 1 });
    }
    if (pageText.length < 30 && images.length) scanned.push(i + 1);
  }
  const body = pages.map((t, i) => `--- Page ${i + 1} ---\n${tidy(t)}`).join('\n\n');
  const note = scanned.length ? `Page(s) ${scanned.slice(0, 10).join(', ')} look scanned: their words are in pictures.` : '';
  return { text: body, pages: totalPages, pictures, note };
}

function readDocx(zip) {
  const parts = [wordXml(zip.text('word/document.xml'))];
  for (const n of zip.names.filter((x) => /^word\/(footnotes|endnotes)\.xml$/.test(x))) {
    const t = wordXml(zip.text(n)).trim();
    if (t) parts.push(`--- ${n.includes('foot') ? 'Footnotes' : 'Endnotes'} ---\n${t}`);
  }
  return { text: parts.join('\n\n'), pictures: zipPictures(zip, ['word/media/']) };
}

function readPptx(zip) {
  const slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber(/slide(\d+)\.xml/));
  const text = slides.map((n, i) => {
    const notes = zip.text(n.replace('slides/slide', 'notesSlides/notesSlide'));
    const notesText = notes ? slideXml(notes).replace(/^\d+$/m, '').trim() : '';
    return `--- Slide ${i + 1} ---\n${slideXml(zip.text(n))}${notesText ? `\nNotes: ${notesText}` : ''}`;
  }).join('\n\n');
  return { text, pages: slides.length, pictures: zipPictures(zip, ['ppt/media/']) };
}

function readXlsx(zip) {
  const sharedXml = zip.text('xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => stripTags(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  const names = [...(zip.text('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const sheets = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber(/sheet(\d+)\.xml/));
  const text = sheets.map((n, i) => `--- Sheet: ${names[i] ?? i + 1} ---\n${sheetXml(zip.text(n), shared)}`).join('\n\n');
  return { text, pages: sheets.length, pictures: zipPictures(zip, ['xl/media/']) };
}

function readOpenDocument(zip) {
  return { text: openDocumentXml(zip.text('content.xml')), pictures: zipPictures(zip, ['Pictures/', 'media/']) };
}

function readEpub(zip) {
  const opfName = /full-path="([^"]+)"/.exec(zip.text('META-INF/container.xml') ?? '')?.[1];
  const opf = opfName ? zip.text(opfName) ?? '' : '';
  const base = opfName?.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/') + 1) : '';
  const items = new Map([...opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], base + decodeURIComponent(m[2])]));
  let order = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => items.get(m[1])).filter(Boolean);
  if (!order.length) order = zip.names.filter((n) => /\.x?html?$/.test(n)).sort();
  return { text: order.map((n) => htmlToText(zip.text(n) ?? '')).filter(Boolean).join('\n\n'), pictures: zipPictures(zip, [base]) };
}

function powershell(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(String(stdout))));
  });
}

/** Old Office file to the new format, by Office on this computer. Macros are forced off. */
async function convertWithOffice(buf, kind) {
  if (process.platform !== 'win32') return null;
  const app = { doc: 'Word', ppt: 'PowerPoint', xls: 'Excel' }[kind];
  const dir = join(tmpdir(), `bunny-doc-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const input = join(dir, `in.${kind}`);
  const output = join(dir, `out.${kind}x`);
  const q = (p) => `'${p.replace(/'/g, "''")}'`;
  await writeFile(input, buf);
  const scripts = {
    Word: `$a = New-Object -ComObject Word.Application; $a.Visible = $false; $a.DisplayAlerts = 0; $a.AutomationSecurity = 3; try { $d = $a.Documents.Open(${q(input)}, $false, $true, $false); $d.SaveAs2(${q(output)}, 16); $d.Close($false) } finally { $a.Quit() }`,
    PowerPoint: `$a = New-Object -ComObject PowerPoint.Application; $a.AutomationSecurity = 3; try { $d = $a.Presentations.Open(${q(input)}, -1, 0, 0); $d.SaveAs(${q(output)}, 24); $d.Close() } finally { $a.Quit() }`,
    Excel: `$a = New-Object -ComObject Excel.Application; $a.Visible = $false; $a.DisplayAlerts = $false; $a.AutomationSecurity = 3; try { $d = $a.Workbooks.Open(${q(input)}, 0, $true); $d.SaveAs(${q(output)}, 51); $d.Close($false) } finally { $a.Quit() }`,
  };
  try {
    await powershell(scripts[app], 120_000);
    return await readFile(output);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Read a document.
 * @returns {Promise<{ kind: string, label: string, text: string, pages?: number, pictures: Array<{name, mime, data, page?}>, note?: string, truncated?: boolean }>}
 */
export async function readDocument(buf, { name = '', mime = '' } = {}) {
  let kind = documentKind(name, mime);
  if (!kind) throw new Error(`${name || 'This file'} is not a document Bunny can read.`);
  let result;
  let note = '';
  if (kind === 'doc' || kind === 'ppt' || kind === 'xls') {
    // Some ".doc" files are really RTF, HTML or the new format with an old name.
    const head = buf.subarray(0, 8).toString('latin1');
    if (head.startsWith('{\\rtf')) kind = 'rtf';
    else if (head.startsWith('PK')) kind = { doc: 'docx', ppt: 'pptx', xls: 'xlsx' }[kind];
    else if (/^\s*</.test(head)) kind = 'html';
    else {
      const converted = await convertWithOffice(buf, kind);
      if (converted) {
        result = await readDocument(converted, { name: `file.${kind}x` });
        result.kind = kind;
      } else {
        result = { text: readableRuns(buf), pictures: [] };
        note = 'Microsoft Office is not available to open this old-format file, so only its readable text was picked out; formatting and tables are lost. Saving it as the newer format (.docx, .pptx, .xlsx) gives a better read.';
      }
    }
  }
  if (!result) {
    if (kind === 'pdf') result = await readPdf(buf);
    else if (kind === 'rtf') result = { text: rtfToText(buf.toString('latin1')), pictures: [] };
    else if (kind === 'html') result = { text: htmlToText(buf.toString('utf8')), pictures: [] };
    else {
      const zip = openZip(buf);
      result = { docx: readDocx, pptx: readPptx, xlsx: readXlsx, odt: readOpenDocument, odp: readOpenDocument, ods: readOpenDocument, epub: readEpub }[kind](zip);
    }
  }
  let text = tidy(result.text ?? '');
  const truncated = text.length > MAX_TEXT;
  if (truncated) text = `${text.slice(0, MAX_TEXT)}\n… (the rest of the document was cut to fit)`;
  return {
    kind: result.kind ?? kind,
    label: DOCUMENT_LABEL[result.kind ?? kind] ?? 'Document',
    text,
    pages: result.pages,
    pictures: result.pictures ?? [],
    note: [result.note, note].filter(Boolean).join(' ') || undefined,
    truncated,
  };
}
