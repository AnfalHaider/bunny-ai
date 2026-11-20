import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApp, post, json } from './helpers.js';
import { openZip, readDocument } from '../src/server/documents.js';
import { LIMITS, OfficeError, buildOffice, columnName, formulaProblem, imageInfo, outline, parseInline, validateOffice } from '../src/server/officeMake.js';
import { createWorkspace } from '../src/server/workspace.js';

// OFFICE-MAKE (v0.1.15): Bunny makes Word, Excel and PowerPoint files. Invented content only. Each file is read back with Bunny's own readDocument.

const word = (blocks, extra = {}) => ({ path: 'doc.docx', blocks, ...extra });
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const made = async (name, args, opts) => buildOffice(validateOffice(name, args, opts), opts?.build);
const entry = async (buf, name) => openZip(buf).text(name);

test('1. each tool makes a file that readDocument reads back: headings, paragraphs, bullets, a table; cells and sheets; slide titles, bullets and notes', async () => {
  const w = await made('make_word', word([{ type: 'heading', level: 1, text: 'Invented report' }, { type: 'paragraph', text: 'Plain words.' }, { type: 'bullets', items: ['one', 'two'] }, { type: 'bullets', items: ['x'], numbered: true }, { type: 'table', rows: [['a', 'b'], ['1', '2']] }, { type: 'page_break' }, { type: 'paragraph', text: 'after' }]));
  const wr = await readDocument(w, { name: 'doc.docx' });
  assert.match(wr.text, /^# Invented report/); for (const s of ['Plain words.', '- one', '- two', '- x', '| a | b |', '| 1 | 2 |', 'after']) assert.ok(wr.text.includes(s), s);
  const x = await made('make_excel', { path: 'a.xlsx', sheets: [{ name: 'Sales', rows: [['Name', 'Amount'], ['Tea', 3.5]], column_widths: [20, 10], freeze_header: true }, { name: 'Notes', rows: [['hello']] }] });
  const xr = await readDocument(x, { name: 'a.xlsx' });
  assert.match(xr.text, /--- Sheet: Sales ---\nName\tAmount\nTea\t3\.5/); assert.match(xr.text, /--- Sheet: Notes ---\nhello/);
  const p = await made('make_powerpoint', { path: 'a.pptx', slides: [{ title: 'Invented deck', bullets: ['a', 'b'], notes: 'speak' }, { title: 'Numbers', table: { rows: [['h', 'v'], ['1', '2']] } }, { text: 'only words' }] });
  const pr = await readDocument(p, { name: 'a.pptx' });
  for (const s of ['--- Slide 1 ---', 'Invented deck', 'Numbers', 'only words', 'Notes: speak']) assert.ok(pr.text.includes(s), s);
});

test('2. inline marks: **bold** is a bold run, *italic* an italic one, an https: link a link, a javascript: link plain text; nothing else is read', async () => {
  const runs = parseInline('a **b** *i* [ok](https://example.test/x) [bad](javascript:alert(1)) [mail](mailto:a@example.test) <b>no</b>');
  assert.deepEqual(runs.filter((r) => r.bold || r.italic || r.link).map((r) => [r.text, r.bold, r.italic, r.link]), [['b', true, undefined, undefined], ['i', undefined, true, undefined], ['ok', undefined, undefined, 'https://example.test/x'], ['mail', undefined, undefined, 'mailto:a@example.test']]);
  assert.ok(runs.some((r) => r.text === 'bad' && !r.link), 'a javascript: link is plain text');
  const w = await made('make_word', word([{ type: 'paragraph', text: '**Bold** [ok](https://example.test/x) [bad](javascript:alert(1)) <script>x</script>' }]));
  const xml = await entry(w, 'word/document.xml'); const rels = await entry(w, 'word/_rels/document.xml.rels');
  assert.match(xml, /<w:b\/>/); assert.match(rels, /https:\/\/example\.test\/x/); assert.doesNotMatch(rels + xml, /javascript:/);
  assert.match(xml, /&lt;script&gt;/, 'markup is text, never read');
});

test('3. Excel cells: a string starting with = + - @ is TEXT; { formula } is kept as a formula; every refused name, an external workbook and a program call are refused', async () => {
  const x = await made('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: [['=1+1', '+2', '-3', '@x'], [1, 2], [{ formula: 'SUM(A2:B2)' }, { value: '2026-03-04', type: 'date' }, { value: 7, format: '0.00', bold: true }, true, null]] }] });
  const sheet = await entry(x, 'xl/worksheets/sheet1.xml');
  assert.doesNotMatch(sheet.split('<f>').slice(2).join(''), /1\+1/);
  assert.equal((sheet.match(/<f>/g) ?? []).length, 1, 'exactly one formula: the one sent as { formula }');
  assert.match(sheet, /<f>SUM\(A2:B2\)<\/f>/);
  const shared = (await entry(x, 'xl/sharedStrings.xml')) ?? sheet;
  for (const t of ['=1+1', '+2', '-3', '@x']) assert.ok((shared + sheet).includes(t), `${t} is written as text`);
  assert.match((await readDocument(x, { name: 'a.xlsx' })).text, /=1\+1\t\+2\t-3\t@x/);
  for (const f of ['WEBSERVICE("http://x.test")', 'FILTERXML(A1,"//a")', 'HYPERLINK("http://x.test")', 'CALL("a","b")', 'REGISTER("a")', 'RTD("a","b","c")', 'IMPORTDATA("u")', 'IMPORTXML("u","//a")', '[book.xlsx]Sheet1!A1', "cmd|'/c calc'!A1", "'C:\\x.xlsx'!A1", 'A1+B1)&webservice(']) {
    assert.notEqual(formulaProblem(f), '', f);
    assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: [[{ formula: f }]] }] }), (e) => e instanceof OfficeError && /Nothing was written/.test(e.message), f);
  }
  assert.equal(formulaProblem('SUM(A1:A2)'), ''); assert.equal(formulaProblem("'Sheet 2'!A1*2"), ''); assert.equal(formulaProblem('IF(A1>1,"a","b")'), '');
  for (const bad of [{ name: '' }, { name: 'a/b' }, { name: 'x'.repeat(32) }, { name: '[x]' }]) assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: [{ ...bad, rows: [] }] }), OfficeError);
  assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: [{ name: 'A', rows: [] }, { name: 'a', rows: [] }] }), /Two sheets/);
  assert.equal(columnName(0), 'A'); assert.equal(columnName(26), 'AA');
});

// ---------------------------------------------------------------- the Code mode write path (workspace.js)

async function folder() { const f = await mkdtemp(join(tmpdir(), 'bunny-office-')); await mkdir(join(f, 'docs')); return f; }

test('4. paths: .. , an absolute path, .git, a link that leads out, a wrong extension and x.docx.exe are refused; an existing file needs overwrite: true; nothing is written in a refusal', async (t) => {
  const f = await folder(); const outside = await mkdtemp(join(tmpdir(), 'bunny-office-out-'));
  t.after(async () => { await rm(f, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const seen = []; const w = createWorkspace(f, { beforeWrite: (p) => seen.push(p) });
  const call = (path, extra = {}) => w.run('make_word', { path, blocks: [{ type: 'paragraph', text: 'hi' }], ...extra });
  await mkdir(join(f, '.git'));
  let linked = false; try { await symlink(outside, join(f, 'jump'), 'junction'); linked = true; } catch { /* no links on this PC */ }
  for (const bad of ['..\\x.docx', '../x.docx', join(outside, 'x.docx'), 'C:\\x.docx', '.git\\hooks\\x.docx', '.git/x.docx', 'x.doc', 'x.docx.exe', 'x.txt', '.docx', ...(linked ? ['jump\\x.docx'] : [])]) {
    await assert.rejects(() => call(bad), Error, bad);
  }
  assert.deepEqual(seen, [], 'beforeWrite never ran for a refusal');
  assert.equal(existsSync(join(outside, 'x.docx')), false);
  assert.match(await call('docs/a.docx'), /^Made docs\/a\.docx \(Word, 1 blocks, \d+ KB\)$/);
  await assert.rejects(() => call('docs/a.docx'), /already exists.*overwrite: true/);
  assert.match(await call('docs/a.docx', { overwrite: true }), /^Made docs\/a\.docx/);
  assert.equal(seen.length, 2);
  assert.match((await readDocument(await readFile(join(f, 'docs/a.docx')), { name: 'a.docx' })).text, /hi/);
});

test('4b. pictures: a PNG or JPEG judged by its first bytes, read inside the folder; a text file named .png, a path outside and too many are refused', async (t) => {
  const f = await folder(); t.after(() => rm(f, { recursive: true, force: true }));
  await writeFile(join(f, 'pic.png'), png1); await writeFile(join(f, 'fake.png'), 'not a picture');
  const w = createWorkspace(f);
  assert.deepEqual(imageInfo(png1), { type: 'png', width: 1, height: 1 });
  assert.match(await w.run('make_word', { path: 'p.docx', blocks: [{ type: 'image', path: 'pic.png', width_cm: 5 }] }), /^Made p\.docx/);
  assert.ok((await stat(join(f, 'p.docx'))).size > 1000);
  assert.match(await w.run('make_powerpoint', { path: 'p.pptx', slides: [{ title: 'Pic', image: { path: 'pic.png' } }] }), /^Made p\.pptx/);
  await assert.rejects(() => w.run('make_word', { path: 'q.docx', blocks: [{ type: 'image', path: 'fake.png' }] }), /not a PNG or JPEG/);
  await assert.rejects(() => w.run('make_word', { path: 'q.docx', blocks: [{ type: 'image', path: '..\\pic.png' }] }), Error);
  await assert.rejects(() => w.run('make_word', { path: 'q.docx', blocks: Array.from({ length: 21 }, () => ({ type: 'image', path: 'pic.png' })) }), /at most 20 pictures/);
  assert.equal(existsSync(join(f, 'q.docx')), false);
  assert.throws(() => validateOffice('make_word', { path: 'a.docx', blocks: [{ type: 'image', path: 'x.png' }] }), /only in a chat that has a folder/);
});

// ---------------------------------------------------------------- limits

test('7. limits: 200,001 cells, 51 sheets, 5,001 blocks, 201 slides, a long cell and a 51 MB result are each refused with the limit named; the build limit stops a worker that never answers', async (t) => {
  const row = (n) => Array.from({ length: n }, () => 1);
  assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: Array.from({ length: 200 }, () => row(1000)).concat([row(1)]) }] }), /more than 200,000 cells.*Nothing was written/);
  assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: Array.from({ length: 51 }, (_, i) => ({ name: `S${i}`, rows: [] })) }), /at most 50 sheets/);
  assert.throws(() => validateOffice('make_word', word(Array.from({ length: 5001 }, () => ({ type: 'page_break' })))), /at most 5,000 blocks/);
  assert.throws(() => validateOffice('make_powerpoint', { path: 'a.pptx', slides: Array.from({ length: 201 }, () => ({})) }), /at most 200 slides/);
  assert.throws(() => validateOffice('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: [['x'.repeat(32768)]] }] }), /32,767/);
  assert.throws(() => validateOffice('make_word', word([{ type: 'table', rows: Array.from({ length: 201 }, () => ['a']) }])), /at most 200 rows/);
  assert.throws(() => validateOffice('make_word', word([{ type: 'bullets', items: Array(501).fill('a') }])), /at most 500 items/);
  assert.throws(() => validateOffice('make_word', word([{ type: 'paragraph', text: 'x'.repeat(1_000_000) }, { type: 'paragraph', text: 'x'.repeat(1_000_001) }])), /2,000,000 characters/);
  assert.throws(() => validateOffice('make_word', word([{ type: 'paragraph', text: 'x'.repeat(4 * 1024 * 1024 + 1) }])), /bigger than 4 MB/);
  // a stand-in worker: one never answers (the 30 s limit, shortened), one answers with 51 MB
  const dir = await mkdtemp(join(tmpdir(), 'bunny-office-worker-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'silent.mjs'), 'setInterval(() => {}, 1000);\n');
  await writeFile(join(dir, 'big.mjs'), "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ ok: true, bytes: new Uint8Array(51 * 1024 * 1024) });\n");
  await writeFile(join(dir, 'bad.mjs'), "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ ok: false, message: 'boom' });\n");
  const spec = validateOffice('make_word', word([{ type: 'paragraph', text: 'x' }]));
  assert.equal(LIMITS.buildMs, 30_000);
  const t0 = Date.now();
  await assert.rejects(() => buildOffice(spec, { timeoutMs: 300, workerUrl: pathToFileURL(join(dir, 'silent.mjs')) }), /longer than 0 seconds|took longer/);
  assert.ok(Date.now() - t0 < 5000, 'the worker was terminated');
  await assert.rejects(() => buildOffice(spec, { workerUrl: pathToFileURL(join(dir, 'big.mjs')) }), /51 MB.*50 MB limit.*Nothing was written/);
  await assert.rejects(() => buildOffice(spec, { workerUrl: pathToFileURL(join(dir, 'bad.mjs')) }), /boom.*Nothing was written/);
});

test('the card outline: Word the headings and counts, Excel the sheets and EVERY formula, PowerPoint the slide titles', () => {
  const o = (n, a, c) => outline(validateOffice(n, a, c));
  const ow = o('make_word', word([{ type: 'heading', level: 1, text: 'Top' }, { type: 'heading', level: 2, text: 'Sub **x**' }, { type: 'paragraph', text: 'p' }], { overwrite: true }));
  assert.match(ow, /Replaces doc\.docx/); assert.match(ow, /3 blocks: 2 heading, 1 paragraph/); assert.match(ow, /Top\n {2}Sub x/);
  const ox = o('make_excel', { path: 'a.xlsx', sheets: [{ name: 'Sales', rows: [[1, 2], [{ formula: 'SUM(A1:B1)' }]] }] });
  assert.match(ox, /Sales: 2 rows x 2 columns/); assert.match(ox, /Sales!A2: =SUM\(A1:B1\)/);
  const op = o('make_powerpoint', { path: 'a.pptx', slides: [{ title: 'One' }, { title: 'Two' }, {}] });
  assert.match(op, /1\. One\n2\. Two\n3\. \(no title\)/);
  assert.doesNotMatch(ow + ox + op, /"type"|\{/, 'an outline, not JSON');
});

// ---------------------------------------------------------------- through the app: rules, Undo, modes, Chat mode, deletion

async function scripted(t, steps) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const step = steps[seen.length - 1];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}
const J = { 'content-type': 'application/json' };

async function setup(t, steps, { folder: dir = null, mode = 'auto', rules = null } = {}) {
  const started = await startApp(t, { fake: false });
  const { base } = started;
  const provider = await scripted(t, steps);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: provider.url });
  if (rules) assert.equal((await fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: J, body: JSON.stringify(rules) })).status, 200);
  const { body: session } = await post(base, '/api/sessions', { title: 'Office' });
  const set = (key, value) => fetch(`${base}/api/sessions/${session.id}/setting/${key}`, { method: 'PATCH', headers: J, body: JSON.stringify({ value }) });
  await set('permissionMode', mode); if (dir) await set('folder', dir);
  const cards = [];
  const send = async (content, { answer = true } = {}) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: dir ? 'code' : 'chat' }) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let all = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^event: permission/m.test(block)) { const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card); await fetch(`${base}/api/sessions/${session.id}/permission/${card.id}`, { method: 'POST', headers: J, body: JSON.stringify({ allowed: answer }) }); }
      }
    }
    return all;
  };
  return { base, session, send, cards, provider, dataDir: started.dataDir };
}
const word1 = (path, extra = {}) => ({ name: 'make_word', args: { path, blocks: [{ type: 'heading', level: 1, text: 'Hello' }, { type: 'paragraph', text: 'World' }], ...extra } });

test('5. rules: an edit deny rule on docs/** refuses make_word at docs/a.docx; an ask rule asks even in Auto, and a no writes nothing; a read deny rule on a picture refuses the call; Allow with no rule runs', async (t) => {
  const f = await mkdtemp(join(tmpdir(), 'bunny-office-app-')); t.after(() => rm(f, { recursive: true, force: true })); await mkdir(join(f, 'docs')); await writeFile(join(f, 'secret.png'), png1);
  const rules = { global: [{ kind: 'path', effect: 'deny', pattern: 'docs/**', ops: 'edits' }, { kind: 'path', effect: 'ask', pattern: 'ask/**', ops: 'edits' }, { kind: 'path', effect: 'deny', pattern: 'secret.png', ops: 'reads' }] };
  const { send, cards } = await setup(t, [word1('docs/a.docx'), word1('ask/a.docx'), { name: 'make_word', args: { path: 'pic.docx', blocks: [{ type: 'image', path: 'secret.png' }] } }, word1('fine.docx')], { folder: f, rules });
  const out = await send('make files', { answer: false });
  assert.match(out, /Blocked by your permission rule/);
  assert.equal(existsSync(join(f, 'docs', 'a.docx')), false, 'denied by the edit rule');
  assert.equal(cards.length, 1, 'only the ask rule asked, in Auto mode'); assert.match(cards[0].title, /Make Word file ask\/a\.docx/); assert.match(cards[0].detail, /Word file ask\/a\.docx\n2 blocks/);
  assert.equal(existsSync(join(f, 'ask', 'a.docx')), false, 'answered no: nothing written');
  assert.equal(existsSync(join(f, 'pic.docx')), false, 'a read rule on the picture refuses the call');
  assert.match(out, /the picture secret\.png/);
  assert.equal(existsSync(join(f, 'fine.docx')), true, 'no rule: Auto runs it');
});

test('6. Undo: after make_excel the reply\'s checkpoint holds the file as not existing, and restoring removes it; Manual mode shows the outline card first', async (t) => {
  const f = await mkdtemp(join(tmpdir(), 'bunny-office-undo-')); t.after(() => rm(f, { recursive: true, force: true }));
  const { base, session, send, cards } = await setup(t, [{ name: 'make_excel', args: { path: 'out/sales.xlsx', sheets: [{ name: 'S', rows: [['a', { formula: 'SUM(1,2)' }]] }] } }], { folder: f, mode: 'ask' });
  await send('make a sheet');
  assert.equal(cards.length, 1); assert.match(cards[0].detail, /Excel file out\/sales\.xlsx\n1 sheet, 2 cells/); assert.match(cards[0].detail, /Formulas \(1\):\nS!B1: =SUM\(1,2\)/);
  assert.equal(existsSync(join(f, 'out', 'sales.xlsx')), true);
  const reply = (await json(base, `/api/sessions/${session.id}`)).body.messages.at(-1);
  assert.equal(reply.checkpoint.files, 1);
  const undone = await post(base, `/api/sessions/${session.id}/checkpoints/${reply.checkpoint.id}/restore`, {});
  assert.equal(undone.status, 200);
  assert.equal(existsSync(join(f, 'out', 'sales.xlsx')), false, 'Undo removes the new file');
});

test('8. Plan mode refuses all three tools; Chat mode writes only under <data>/made/<chat>/ with a plain name for a path like ..\\..\\x.docx, and keeps the card with the message', async (t) => {
  const f = await mkdtemp(join(tmpdir(), 'bunny-office-plan-')); t.after(() => rm(f, { recursive: true, force: true }));
  const plan = await setup(t, [word1('p.docx'), { name: 'make_excel', args: { path: 'p.xlsx', sheets: [{ name: 'S', rows: [] }] } }, { name: 'make_powerpoint', args: { path: 'p.pptx', slides: [{ title: 'x' }] } }], { folder: f, mode: 'plan' });
  await plan.send('plan it');
  for (const n of ['p.docx', 'p.xlsx', 'p.pptx']) assert.equal(existsSync(join(f, n)), false, n);
  // Chat mode: no folder
  const chat = await setup(t, [word1('..\\..\\x.docx'), { name: 'make_powerpoint', args: { path: 'deck.pptx', slides: [{ title: 'Invented deck' }] } }]);
  const out = await chat.send('make files');
  assert.match(out, /"madeFile":\{"id":"[a-f0-9-]{36}","name":"x\.docx","kind":"Word"/);
  const saved = (await json(chat.base, `/api/sessions/${chat.session.id}`)).body;
  const cardsKept = saved.messages.filter((m) => m.madeFile);
  assert.deepEqual(cardsKept.map((m) => [m.madeFile.name, m.madeFile.kind]), [['x.docx', 'Word'], ['deck.pptx', 'PowerPoint']]);
  const dir = join(chat.dataDir, 'made', chat.session.id);
  assert.ok(existsSync(dir)); assert.equal(existsSync(join(chat.dataDir, '..', 'x.docx')), false);
  assert.equal(existsSync(join(chat.dataDir, 'x.docx')), false);
  // the route: only this chat's own folder, always a download
  const m = cardsKept[0].madeFile;
  const res = await fetch(`${chat.base}/api/sessions/${chat.session.id}/made/${m.id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="x\.docx"$/); assert.equal(res.headers.get('x-content-type-options'), 'nosniff'); assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match((await readDocument(Buffer.from(await res.arrayBuffer()), { name: 'x.docx' })).text, /# Hello/);
  assert.equal((await fetch(`${chat.base}/api/sessions/${plan.session.id}/made/${m.id}`)).status, 404, 'another chat cannot reach it');
  assert.equal((await fetch(`${chat.base}/api/sessions/${chat.session.id}/made/not-an-id`)).status, 404);
  // 9. deleting the chat deletes its made files
  assert.equal((await fetch(`${chat.base}/api/sessions/${chat.session.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(dir), false, 'the chat\'s made folder is gone');
});

test('the tools are offered: in Code mode (edit tools), in Chat mode without pictures; not in Plan mode\'s list of runnable tools', async (t) => {
  const f = await mkdtemp(join(tmpdir(), 'bunny-office-defs-')); t.after(() => rm(f, { recursive: true, force: true }));
  const code = await setup(t, [], { folder: f });
  await code.send('hi');
  const names = (r) => (r.tools ?? []).map((d) => d.function.name);
  assert.ok(['make_word', 'make_excel', 'make_powerpoint'].every((n) => names(code.provider.seen[0]).includes(n)));
  const codeWord = code.provider.seen[0].tools.find((d) => d.function.name === 'make_word');
  assert.ok(JSON.stringify(codeWord).includes('"image"'), 'pictures are offered in Code mode');
  const chat = await setup(t, []);
  await chat.send('hi');
  const chatWord = chat.provider.seen[0].tools.find((d) => d.function.name === 'make_word');
  assert.ok(chatWord, 'offered in Chat mode'); assert.ok(!JSON.stringify(chatWord).includes('"image"'), 'no pictures in Chat mode');
  assert.ok(!JSON.stringify(chatWord).includes('overwrite'), 'no overwrite in Chat mode: it never replaces a file');
});
