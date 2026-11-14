import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { documentKind, readDocument, rtfToText, htmlToText, readableRuns, encodePng } from '../src/server/documents.js';
import { normaliseAttachments, toModelMessage } from '../src/server/attachments.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url));
const read = (name) => readDocument(fixture(name), { name });

test('a document is recognised by its name or its type', () => {
  assert.equal(documentKind('Report.PDF'), 'pdf');
  assert.equal(documentKind('notes.docx'), 'docx');
  assert.equal(documentKind('old.doc'), 'doc');
  assert.equal(documentKind('file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
  assert.equal(documentKind('notes.txt', 'text/plain'), null);
  assert.equal(documentKind('photo.png', 'image/png'), null);
});

test('Word: headings, paragraphs and a table as rows', async () => {
  const doc = await read('report.docx');
  assert.equal(doc.label, 'Word');
  assert.match(doc.text, /^# Bunny Quarterly Report/m);
  assert.match(doc.text, /Revenue grew 42 percent/);
  assert.match(doc.text, /\| Region \| Sales \|\n\| Lahore \| 640k \|/);
});

test('PDF: the words on each page', async () => {
  const doc = await read('report.pdf');
  assert.equal(doc.label, 'PDF');
  assert.equal(doc.pages, 1);
  assert.match(doc.text, /--- Page 1 ---/);
  assert.match(doc.text, /Revenue grew 42 percent/);
});

test('Excel, PowerPoint and OpenDocument read as text', async () => {
  assert.match((await read('sales.xlsx')).text, /--- Sheet: Sales ---\nMonth\tCarrots\nJuly\t1200\nAugust\t1750/);
  assert.match((await read('sales.ods')).text, /August\t1750/);
  assert.match((await read('report.odt')).text, /Lahore\t640k/);
  const deck = await read('deck.pptx');
  assert.equal(deck.pages, 1);
  assert.match(deck.text, /--- Slide 1 ---[\s\S]*Launch plan[\s\S]*Ship Bunny AI desktop in December/);
});

test('RTF and HTML become plain text', async () => {
  assert.match((await read('report.rtf')).text, /Bunny Quarterly Report\nRevenue grew 42 percent/);
  assert.equal(rtfToText(String.raw`{\rtf1{\fonttbl{\f0 Arial;}}{\*\generator x;}Hello\par W\u246?rld}`), 'Hello\nWörld');
  assert.equal(htmlToText('<style>p{}</style><h1>Title</h1><p>One &amp; two</p><script>x()</script>'), '# Title\nOne & two');
});

test('an old .doc without Office still gives its readable text', () => {
  assert.match(readableRuns(fixture('report.doc')), /Revenue grew 42 percent/);
});

test('raw pixels become a real PNG, shrunk to fit', () => {
  const data = new Uint8Array(400 * 200 * 3).fill(200);
  const png = encodePng({ data, width: 400, height: 200, channels: 3 }, 100);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 100); // width
  assert.equal(png.readUInt32BE(20), 50);  // height
  const idat = png.indexOf('IDAT');
  assert.equal(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, (100 * 3 + 1) * 50);
});

test('a document attachment waits as a file until it is read', () => {
  const [att] = normaliseAttachments([{ name: 'report.pdf', mime: 'application/pdf', data: `data:application/pdf;base64,${fixture('report.pdf').toString('base64')}` }]);
  assert.equal(att.kind, 'document');
  assert.equal(att.unread, true);
});

test('a model that cannot see gets the words read from pictures instead', () => {
  const message = {
    role: 'user', content: 'What does it say?',
    attachments: [
      { kind: 'image', name: 'shot.png', data: 'data:image/png;base64,AAAA', ocr: 'Hello there' },
      { kind: 'document', name: 'scan.pdf', label: 'PDF', pages: 1, data: '--- Page 1 ---', pictures: [{ name: 'page 1', page: 1, data: 'data:image/png;base64,BBBB', ocr: 'Scanned words' }] },
    ],
  };
  const blind = toModelMessage(message, { vision: false });
  assert.equal(typeof blind.content, 'string');
  assert.match(blind.content, /cannot see pictures\. Words in it: Hello there/);
  assert.match(blind.content, /\[attached PDF: scan\.pdf, 1 page\]/);
  assert.match(blind.content, /picture 1 in scan\.pdf, page 1\. Words in it: Scanned words/);

  const seeing = toModelMessage(message, { vision: true });
  assert.equal(seeing.content.filter((p) => p.type === 'image_url').length, 2);
  assert.match(seeing.content[0].text, /words read from the image shot\.png: Hello there/);
});
