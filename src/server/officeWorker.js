/**
 * OFFICE-MAKE: the worker thread that builds one file from a CHECKED spec (officeMake.js validateOffice) and the bytes of its pictures, and posts back one Buffer. It never touches the disk and
 * never fetches anything. The libraries load here, only when a file is made, so start-up does not pay for them.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { imageInfo, parseInline } from './officeMake.js';

const ACCENT = '6A4FD8'; const INK = '1F2023'; const DIM = '62666F'; const LINE = 'E6E2DA'; const FONT = 'Segoe UI';

async function word(spec, images) {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ExternalHyperlink, ImageRun, PageBreak, AlignmentType, WidthType, LevelFormat, ShadingType } = docx;
  const runs = (str, base = {}) => parseInline(str).map((r) => (r.link
    ? new ExternalHyperlink({ link: r.link, children: [new TextRun({ text: r.text, style: 'Hyperlink', ...base })] })
    : new TextRun({ text: r.text, bold: r.bold || base.bold, italics: r.italic, font: FONT, ...(base.size ? { size: base.size } : {}) })));
  const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };
  const children = [];
  for (const b of spec.blocks) {
    if (b.type === 'heading') children.push(new Paragraph({ heading: HEAD[b.level - 1], children: runs(b.text) }));
    else if (b.type === 'paragraph') children.push(new Paragraph({ alignment: ALIGN[b.align], children: runs(b.text) }));
    else if (b.type === 'bullets') for (const it of b.items) children.push(new Paragraph({ ...(b.numbered ? { numbering: { reference: 'bunny-numbers', level: 0 } } : { bullet: { level: 0 } }), children: runs(it) }));
    else if (b.type === 'table') {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.rows.map((row, ri) => new TableRow({ tableHeader: b.header && ri === 0, children: row.map((c) => new TableCell({ shading: b.header && ri === 0 ? { type: ShadingType.CLEAR, fill: 'F3F1EC', color: 'auto' } : undefined, children: [new Paragraph({ children: runs(c, b.header && ri === 0 ? { bold: true } : {}) })] })) })),
      }));
      children.push(new Paragraph({ children: [] }));
    } else if (b.type === 'image') {
      const bytes = images.get(b.path); const info = bytes ? imageInfo(bytes) : null;
      if (!info) throw new Error(`The picture ${b.path} is not a PNG or JPEG.`);
      const w = Math.round(b.width_cm * 37.8); const h = info.width ? Math.round(w * (info.height / info.width)) : w;
      children.push(new Paragraph({ children: [new ImageRun({ type: info.type, data: Buffer.from(bytes), transformation: { width: w, height: h }, altText: { title: 'Picture', description: b.path, name: 'Picture' } })] }));
    } else if (b.type === 'page_break') children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  const doc = new Document({
    creator: 'Bunny AI', title: spec.title || undefined,
    numbering: { config: [{ reference: 'bunny-numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

async function excel(spec) {
  const { default: writeExcelFile } = await import('write-excel-file/node');
  const toCell = (c, bold) => {
    const fontWeight = (bold || c.bold) ? 'bold' : undefined;
    if (c.kind === 'empty') return null;
    if (c.kind === 'text') return { value: c.value, type: String, ...(c.format ? { format: c.format } : {}), ...(fontWeight ? { fontWeight } : {}) }; // text stays text, even "=1+1"
    if (c.kind === 'number') return { value: c.value, type: Number, ...(c.format ? { format: c.format } : {}), ...(fontWeight ? { fontWeight } : {}) };
    if (c.kind === 'boolean') return { value: c.value, type: Boolean };
    if (c.kind === 'date') return { value: new Date(c.value), type: Date, format: c.format, ...(fontWeight ? { fontWeight } : {}) };
    // no leading "=": the writer puts the text verbatim into <f>, and OOXML has no "=" there
    return { value: c.value, type: 'Formula', ...(c.format ? { format: c.format } : {}), ...(fontWeight ? { fontWeight } : {}) };
  };
  const sheets = spec.sheets.map((s) => ({
    sheet: s.name,
    data: s.rows.map((row, ri) => row.map((c) => toCell(c, s.freeze_header && ri === 0))),
    ...(s.column_widths.length ? { columns: s.column_widths.map((width) => ({ width })) } : {}),
    ...(s.freeze_header ? { stickyRowsCount: 1 } : {}),
  }));
  return writeExcelFile(sheets).toBuffer();
}

async function powerpoint(spec, images) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
  pres.author = 'Bunny AI'; if (spec.title) pres.title = spec.title;
  const runs = (str, base = {}) => parseInline(str).map((r) => ({ text: r.text, options: { ...base, bold: r.bold || base.bold, italic: r.italic, ...(r.link ? { hyperlink: { url: r.link }, color: ACCENT, underline: { style: 'sng' } } : {}) } }));
  for (const s of spec.slides) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    let y = 0.4;
    if (s.title) { slide.addText(runs(s.title, { fontFace: FONT, fontSize: 30, color: INK, bold: true }), { x: 0.6, y, w: 8.8, h: 0.9, valign: 'middle' }); y += 1.0; slide.addShape(pres.ShapeType.rect, { x: 0.6, y: y - 0.05, w: 1.2, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } }); y += 0.2; }
    const room = 5.2 - y;
    if (s.bullets?.length) {
      slide.addText(s.bullets.flatMap((b, i) => runs(b, { fontFace: FONT, fontSize: 18, color: INK, bullet: true, breakLine: true, ...(i === s.bullets.length - 1 ? { breakLine: false } : {}) })), { x: 0.7, y, w: s.image ? 4.6 : 8.6, h: s.table || s.text ? room * 0.5 : room, valign: 'top', paraSpaceAfter: 6 });
      y += s.table || s.text ? room * 0.5 : room;
    }
    if (s.text) { slide.addText(runs(s.text, { fontFace: FONT, fontSize: 18, color: DIM }), { x: 0.7, y, w: s.image ? 4.6 : 8.6, h: s.table ? 0.9 : 5.2 - y, valign: 'top' }); y += s.table ? 1.0 : 5.2 - y; }
    if (s.table) {
      slide.addTable(s.table.rows.map((row, ri) => row.map((c) => ({ text: runs(c, { fontFace: FONT, fontSize: 14, color: INK, bold: s.table.header && ri === 0 }), options: { fill: { color: s.table.header && ri === 0 ? 'F3F1EC' : 'FFFFFF' }, border: { type: 'solid', color: LINE, pt: 1 } } }))), { x: 0.7, y, w: 8.6, colW: Array(Math.max(...s.table.rows.map((r) => r.length))).fill(8.6 / Math.max(...s.table.rows.map((r) => r.length))) });
    }
    if (s.image) {
      const bytes = images.get(s.image.path); const info = bytes ? imageInfo(bytes) : null;
      if (!info) throw new Error(`The picture ${s.image.path} is not a PNG or JPEG.`);
      const box = { x: s.bullets?.length || s.text ? 5.5 : 0.7, y: s.title ? 1.6 : 0.5, w: s.bullets?.length || s.text ? 4.0 : 8.6, h: s.title ? 3.6 : 4.6 };
      const ratio = info.width && info.height ? info.width / info.height : 1.5;
      let w = box.w; let h = w / ratio; if (h > box.h) { h = box.h; w = h * ratio; }
      slide.addImage({ data: `image/${info.type === 'jpg' ? 'jpeg' : 'png'};base64,${Buffer.from(bytes).toString('base64')}`, x: box.x, y: box.y, w, h });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const out = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(out);
}

try {
  const { spec } = workerData;
  const images = new Map((workerData.images ?? []).map(([p, b]) => [p, Buffer.from(b)]));
  const buf = spec.name === 'make_word' ? await word(spec, images) : spec.name === 'make_excel' ? await excel(spec) : await powerpoint(spec, images);
  const bytes = new Uint8Array(buf);
  parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
} catch (err) {
  parentPort.postMessage({ ok: false, message: String(err?.message ?? err) });
}
