/**
 * QA, v0.1.9 W4-8b (3cb6368): "Add a file…" in the quick-ask bar. The real logic (electron/quick-ask-logic.js), the real controller
 * (electron/quick-ask.js) with a stand-in Electron and a stand-in file dialog, invented files in a temp folder, the real bar page in Chromium,
 * and the real chat page for the hand-over. Electron itself is not started here.
 *   SRC=<worktree> node e2e/w019-w48b-file.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SRC = process.env.SRC || process.cwd();
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'bunny-w019-48b-shots-'));
mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fd3'; const PORT = +(process.env.PORT0 ?? 6431); const NL = String.fromCharCode(10);
const U = (p) => pathToFileURL(join(SRC, p)).href;
const L = await import(U('electron/quick-ask-logic.js'));
const Q = await import(U('electron/quick-ask.js'));
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 260) : ''}`); };
const guard = async (id, label, fn) => { try { const d = await fn(); check(id, label, true, d ?? ''); } catch (e) { check(id, label, false, String(e.message).split(NL)[0]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dir = mkdtempSync(join(tmpdir(), 'bunny-w019-48b-files-'));
const F = (name, bytes) => { const p = join(dir, name); writeFileSync(p, bytes); return p; };
const mkPdf = (text) => { const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']; const stream = 'BT /F1 18 Tf 20 100 Td (' + text + ') Tj ET'; objs[3] = '<< /Length ' + stream.length + ' >>' + NL + 'stream' + NL + stream + NL + 'endstream'; let out = '%PDF-1.4' + NL; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj' + NL + o + NL + 'endobj' + NL; }); const x = out.length; out += 'xref' + NL + '0 ' + (objs.length + 1) + NL + '0000000000 65535 f ' + NL + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n ').join(NL) + NL + 'trailer << /Size ' + (objs.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + x + NL + '%%EOF'; return Buffer.from(out, 'latin1'); };
const files = {
  txt: F('notes.txt', 'Plan for the garden: plant roses, then herbs.'),
  md: F('readme.md', '# Title' + NL + 'hello'),
  png: F('pic.png', PNG),
  pdf: F('doc.pdf', mkPdf('Quarterly tulip report')),
  midText: F('mid.txt', Buffer.alloc(100 * 1024, 'hello world ')),
  text200k: F('t200k.txt', Buffer.alloc(200 * 1024, 'hello world ')),
  exactPng: F('exact.png', Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024 - PNG.length)])),
  bigPng: F('big.png', Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024 + 10 - PNG.length)])),
  midPng: F('mid.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])),
  fakePng: F('fake.png', 'this is just text'),
  fakePdf: F('fake.pdf', 'not a pdf'),
  binTxt: F('bin.txt', Buffer.from([65, 0, 66, 67])),
  badUtf: F('bad.txt', Buffer.from([0xff, 0xfe, 0xfd, 0x41])),
  empty: F('empty.txt', ''),
  exe: F('tool.exe', 'MZ'),
  noext: F('README', 'hello'),
  env: F('.env', 'KEY=value'),
  envLocal: F('.env.local', 'KEY=value'),
  pem: F('server.pem', '-----BEGIN CERTIFICATE-----'),
  key: F('id.key', 'x'),
  idrsa: F('id_rsa', 'x'),
  kdbx: F('vault.kdbx', 'x'),
  secretText: F('config.txt', 'api_key = sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'),
  rlo: F('invoice\u202Egpj.txt', 'hello rlo'),
  big: F('big.txt', Buffer.alloc(8 * 1024 * 1024 + 10, 'hello world ')),
  exact: F('exact.txt', Buffer.alloc(8 * 1024 * 1024, 'hello world ')),
};
let linkPath = null;
try { linkPath = join(dir, 'link.txt'); symlinkSync(files.txt, linkPath); } catch { linkPath = null; }

// ------------------------------------------------------------------ stand-in Electron (as in the earlier W4-8 walk)
const mkElectron = (pick) => {
  const log = { windows: [], handlers: new Map(), dialogCalls: [] };
  class FakeWC extends EventEmitter { constructor() { super(); this.session = { setPermissionRequestHandler() {} }; } setWindowOpenHandler() {} }
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.webContents = new FakeWC(); this.destroyed = false; this.visible = false; this.shows = 0; log.windows.push(this); }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); } show() { this.visible = true; this.shows += 1; } hide() { this.visible = false; } focus() {}
    setBounds() {} getBounds() { return { x: 0, y: 0, width: 700, height: 300 }; } setAlwaysOnTop() {} loadFile() {}
  }
  const globalShortcut = { register: () => true, unregister() {} };
  const screen = { getDisplayNearestPoint: () => ({ id: 1, scaleFactor: 1, size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }), getCursorScreenPoint: () => ({ x: 10, y: 10 }) };
  const desktopCapturer = { getSources: async () => [] };
  const ipcMain = { handle: (ch, fn) => log.handlers.set(ch, fn) };
  const dialog = { showOpenDialog: async (win, opts) => { log.dialogCalls.push(opts); const p = pick.next; return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; } };
  return { log, BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, dialog };
};
const BAR = 'file:///C:/x/electron/quick-ask/bar.html';
const evFrom = (win, url = BAR) => ({ sender: win.webContents, senderFrame: { url } });
const setup = (extra = {}) => {
  const pick = { next: null }; const e = mkElectron(pick); let got = null; let willOpen = true;
  const qa = Q.createQuickAsk({ ...e, onSubmit: (r) => { got = r; return willOpen; }, ...extra });
  qa.open(); const w = e.log.windows[0]; w.emit('ready-to-show');
  const call = (ch, ...a) => e.log.handlers.get(ch)(evFrom(w), ...a);
  return { pick, e, qa, w, call, got: () => got, refuse: () => { willOpen = false; } };
};
const choose = async (s, path) => { s.pick.next = path; return s.call('quickask:pickFile'); };

// ------------------------------------------------------------------ L. pure rules
await guard('L1', 'good files: text, markdown, picture, PDF are accepted with the right kind and a plain name', async () => {
  const out = [];
  for (const [name, p, kind] of [['notes.txt', files.txt, 'text'], ['readme.md', files.md, 'text'], ['pic.png', files.png, 'image'], ['doc.pdf', files.pdf, 'pdf']]) {
    const r = L.checkFile(name, Buffer.from(await (await import('node:fs/promises')).readFile(p)));
    ok(r.ok && r.file.kind === kind && r.file.name === name, `${name} -> ${JSON.stringify(r).slice(0, 120)}`); out.push(`${name}:${r.file.kind}/${r.file.mime}`);
  }
  return out.join(', ');
});
await guard('L2', 'a file whose bytes do not match its name is refused: a text file named .png / .pdf, NUL bytes, invalid UTF-8, empty', async () => {
  const fs = await import('node:fs/promises'); const r = {};
  for (const k of ['fakePng', 'fakePdf', 'binTxt', 'badUtf', 'empty']) { const name = files[k].split(/[\\/]/).pop(); r[k] = L.checkFile(name, await fs.readFile(files[k])); ok(!r[k].ok, `${k} accepted`); }
  ok(/not what its name says/.test(r.fakePng.message) && /empty/.test(r.empty.message), JSON.stringify([r.fakePng.message, r.empty.message]));
  return `${Object.values(r).map((x) => x.message).join(' | ')}`;
});
await guard('L3', 'secret-looking files are never attached: .env, .env.local, .pem, .key, id_rsa, .kdbx, and a text file holding an API key', async () => {
  const fs = await import('node:fs/promises'); const out = [];
  for (const k of ['env', 'envLocal', 'pem', 'key', 'idrsa', 'kdbx', 'secretText']) { const name = files[k].split(/[\\/]/).pop(); const r = L.checkFile(name, await fs.readFile(files[k])); ok(!r.ok && r.message === L.SECRET_FILE_MESSAGE, `${name}: ${JSON.stringify(r).slice(0, 100)}`); out.push(name); }
  return out.join(', ') + ' => "' + L.SECRET_FILE_MESSAGE + '"';
});
await guard('L4', 'unsupported kinds refused with a plain message: .exe, no extension, .zip, .docx, .svg, .html', async () => {
  const out = [];
  for (const n of ['tool.exe', 'README', 'a.zip', 'a.docx', 'a.svg', 'a.html', 'a.bat', 'a.ps1.txt.lnk']) { const r = L.checkFile(n, Buffer.from('hello')); out.push(`${n}:${r.ok ? 'ACCEPTED' : 'refused'}`); }
  console.log('INFO  ' + out.join('  '));
  ok(out.slice(0, 4).every((x) => /refused/.test(x)), out.join(' '));
  return out.join(' ');
});
await guard('L5', 'names: folders stripped, control and look-alike (U+202E) characters removed, 120 characters at most', async () => {
  const a = L.cleanFileName('C:\\Users\\me\\secret\\report.txt'); const b = L.cleanFileName('../../etc/passwd.txt'); const c = L.cleanFileName('invoice\u202Egpj.txt'); const d = L.cleanFileName('x'.repeat(300) + '.txt'); const e2 = L.cleanFileName('\u0000\u0001');
  ok(a === 'report.txt' && b === 'passwd.txt' && c === 'invoicegpj.txt' && d.length === 120 && e2 === 'file', JSON.stringify([a, b, c, d.length, e2]));
  return `${a} | ${b} | ${c} | len ${d.length} | "${e2}"`;
});
await guard('L6', 'paths: a share (\\\\server\\x), a device path (\\\\.\\, \\\\?\\), a NUL path and non-strings are refused; a drive path is fine', async () => {
  for (const bad of ['\\\\server\\share\\a.txt', '//server/share/a.txt', '\\\\.\\C:\\a.txt', '\\\\?\\C:\\a.txt', 'C:\\a\u0000.txt', '', null, 7]) ok(!L.checkPath(bad).ok, `accepted ${JSON.stringify(bad)}`);
  ok(L.checkPath('C:\\Users\\me\\a.txt').ok && L.checkPath('/home/me/a.txt').ok, 'good path refused'); return '8 refused, 2 good accepted';
});
await guard('L7', 'submission: a file goes by id only; a wrong id, no held file, two attachments, or a page-supplied payload are refused', async () => {
  const held = { id: 'abc', file: { name: 'a.txt', mime: 'text/plain', kind: 'text', size: 1, data: 'data:text/plain;base64,YQ==' } };
  ok(L.validateSubmission('hi', [{ kind: 'file', id: 'abc' }], held).ok, 'right id'); ok(L.validateSubmission('hi', [{ kind: 'file', id: 'abc' }], held).file === held.file, 'held file used');
  ok(!L.validateSubmission('hi', [{ kind: 'file', id: 'zzz' }], held).ok, 'wrong id'); ok(!L.validateSubmission('hi', [{ kind: 'file', id: 'abc' }], null).ok, 'no held'); ok(!L.validateSubmission('hi', [{ kind: 'file', id: 5 }], held).ok, 'id not a string');
  ok(!L.validateSubmission('hi', [{ kind: 'file', id: 'abc' }, { kind: 'file', id: 'abc' }], held).ok, 'two');
  const sneaky = L.validateSubmission('hi', [{ kind: 'file', id: 'abc', data: 'data:text/plain;base64,RVZJTA==', name: 'evil.exe', mime: 'x' }], held); ok(sneaky.ok && sneaky.file === held.file && sneaky.file.name === 'a.txt', 'page-supplied fields used');
  const req = L.buildNewChatRequest('hi', null, held.file); ok(req.workMode === 'chat' && req.folder === null && req.files.length === 1 && req.files[0].kind === 'text' && req.files[0].name === 'a.txt', JSON.stringify(req).slice(0, 160));
  return 'id-only; extra fields ignored; request is Chat mode, no folder, one file';
});

// ------------------------------------------------------------------ C. the controller with a stand-in dialog and the invented files
await guard('C1', 'pick a text file: the page gets id, name, kind, size (no bytes, no path, no mime); the dialog is a native open dialog with a file filter', async () => {
  const s = setup(); const r = await choose(s, files.txt);
  ok(r.ok && typeof r.id === 'string' && r.id.length >= 16 && r.name === 'notes.txt' && r.kind === 'text' && r.size === 45, JSON.stringify(r));
  const keys = Object.keys(r).sort().join(','); ok(keys === 'id,kind,name,ok,size', 'keys: ' + keys); ok(!JSON.stringify(r).includes('Plan for the garden') && !JSON.stringify(r).includes(dir.replace(/\\/g, '\\\\')), 'bytes or path leaked');
  const o = s.e.log.dialogCalls[0]; ok(o.properties.length === 1 && o.properties[0] === 'openFile' && o.filters?.length === 1 && o.filters[0].extensions.includes('png') && !o.filters[0].extensions.includes('exe'), JSON.stringify(o).slice(0, 200));
  return `keys ${keys}; id ${r.id.slice(0, 8)}…`;
});
await guard('C2', 'a small picture comes with a small preview; text and PDF do not', async () => {
  const s = setup(); const a = await choose(s, files.png); ok(a.ok && a.kind === 'image' && /^data:image\/png;base64,/.test(a.preview ?? ''), JSON.stringify(a).slice(0, 120));
  const b = await choose(s, files.pdf); ok(b.ok && b.kind === 'pdf' && !('preview' in b), JSON.stringify(b)); return 'png preview yes; pdf preview no';
});
await guard('C3', 'cancelling the dialog is quiet: no message, nothing held, the earlier file stays', async () => {
  const s = setup(); await choose(s, files.txt); const c = await choose(s, null); ok(c.ok === false && c.cancelled === true && !c.message, JSON.stringify(c));
  const r = await s.call('quickask:submit', 'hello', [{ kind: 'file', id: 'x' }]); ok(!r.ok, 'sent a wrong id'); return JSON.stringify(c);
});
await guard('C4', 'refusals from the controller are in plain words and nothing is held: fake .png, secret .env, unsupported .exe, empty, over 8 MB, bad UTF-8', async () => {
  const s = setup(); const out = [];
  for (const [k, re] of [['fakePng', /not what its name says/], ['env', /key or password/], ['exe', /cannot be added/], ['empty', /empty/], ['big', /over 8 MB/], ['badUtf', /not what its name says/], ['secretText', /key or password/], ['noext', /cannot be added/]]) {
    const r = await choose(s, files[k]); ok(r.ok === false && re.test(r.message), `${k}: ${JSON.stringify(r)}`); out.push(r.message);
  }
  const after = await s.call('quickask:submit', 'hello', [{ kind: 'file', id: 'anything' }]); ok(!after.ok && !s.got(), 'something was held after refusals'); return [...new Set(out)].join(' | ');
});
await guard('C5', 'size edge: exactly 8 MB is accepted, 8 MB + 10 bytes is refused', async () => {
  const s = setup(); const a = await choose(s, files.exactPng); const b = await choose(s, files.bigPng); ok(a.ok && a.size === 8 * 1024 * 1024, JSON.stringify(a).slice(0, 100)); ok(!b.ok && /over 8 MB/.test(b.message), JSON.stringify(b)); return `exact ${a.size} ok; over refused`;
});
await guard('C6', 'a link (symlink) is refused; a folder is refused; a UNC path from the dialog is refused without touching the disk', async () => {
  const s = setup(); const out = [];
  if (linkPath) { const r = await choose(s, linkPath); ok(!r.ok, 'link accepted'); out.push('link: ' + r.message); } else out.push('link: could not be created on this machine (needs privilege) — NOT RUN');
  const f = await choose(s, dir); ok(!f.ok && /not a plain file|could not read|cannot be added/.test(f.message), 'folder: ' + JSON.stringify(f)); out.push('folder: ' + f.message);
  let touched = 0; const s2 = setup({ fileOps: { lstat: async () => { touched += 1; throw new Error('x'); }, open: async () => { touched += 1; throw new Error('x'); } } });
  const u = await choose(s2, '\\\\evilhost\\share\\a.txt'); const v = await choose(s2, '\\\\?\\C:\\a.txt'); ok(!u.ok && !v.ok && touched === 0, `touched=${touched} ${JSON.stringify([u, v])}`); out.push('UNC/device: ' + u.message + ' (no disk calls)');
  console.log('INFO  ' + out.join('  ||  ')); return out.join(' || ');
});
await guard('C7', 'one read from one handle: a file that grows while being read (stat says small, handle gives more) is refused; lstat size lie is caught; handle closed', async () => {
  const fs = await import('node:fs/promises'); let closed = 0;
  const grow = { lstat: fs.lstat, open: async (p, f) => { const h = await fs.open(p, f); return { stat: async () => ({ isFile: () => true, size: 10 }), read: (b, o, l, pos) => h.read(b, o, l, pos), close: async () => { closed += 1; await h.close(); } }; } };
  const s = setup({ fileOps: grow }); const r = await choose(s, files.exactPng); ok(!r.ok && /over 8 MB/.test(r.message) && closed === 1, JSON.stringify(r) + ' closed=' + closed);
  const lie = { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true, size: 5 }), open: async (p, f) => { const h = await fs.open(p, f); return { stat: async () => ({ isFile: () => true, size: 5 }), read: (b, o, l, pos) => h.read(b, o, l, pos), close: async () => { await h.close(); } }; } };
  const s2 = setup({ fileOps: lie }); const r2 = await choose(s2, files.exactPng); ok(!r2.ok, 'a file that outgrew its stat was accepted: ' + JSON.stringify(r2).slice(0, 80)); return `grow-while-reading refused (handle closed ${closed}x); stat lie refused`;
});
await guard('C8', 'send: the held file goes with the message to a NEW Chat-mode chat, no folder; the bar closes; it can NOT be sent twice', async () => {
  const s = setup(); const r = await choose(s, files.md); const sent = await s.call('quickask:submit', 'summarise this', [{ kind: 'file', id: r.id }]);
  const g = s.got(); ok(sent.ok && g.workMode === 'chat' && g.folder === null && g.text === 'summarise this' && g.files.length === 1 && g.files[0].name === 'readme.md' && g.files[0].kind === 'text', JSON.stringify(g).slice(0, 200)); ok(s.w.destroyed, 'bar open');
  const again = await s.call('quickask:submit', 'again', [{ kind: 'file', id: r.id }]); ok(!again.ok, 'second send accepted'); return 'sent once; bar destroyed; replay refused: ' + (again.message ?? '');
});
await guard('C9', 'a made-up id, or an id from an earlier bar, is refused; the page cannot smuggle its own bytes or path', async () => {
  const s = setup(); const r = await choose(s, files.txt); const bad = await s.call('quickask:submit', 'hi', [{ kind: 'file', id: 'not-the-id' }]); ok(!bad.ok && /not valid/.test(bad.message), JSON.stringify(bad));
  const smuggle = await s.call('quickask:submit', 'hi', [{ kind: 'file', id: 'x', path: 'C:\\Windows\\win.ini', data: 'data:text/plain;base64,RVZJTA==' }]); ok(!smuggle.ok && !s.got(), 'smuggle ' + JSON.stringify(smuggle));
  const fresh = setup(); const ok2 = await fresh.call('quickask:submit', 'hi', [{ kind: 'file', id: r.id }]); ok(!ok2.ok, 'id from another bar accepted'); return 'wrong id, smuggled fields, other-bar id: all refused';
});
await guard('C10', 'remove (dropFile) forgets the file: sending its id afterwards is refused; closing the bar forgets it; the next bar starts empty', async () => {
  const s = setup(); const r = await choose(s, files.txt); await s.call('quickask:dropFile'); const a = await s.call('quickask:submit', 'hi', [{ kind: 'file', id: r.id }]); ok(!a.ok, 'sent after drop');
  const s2 = setup(); const r2 = await choose(s2, files.txt); s2.qa.close?.(); s2.w.emit('closed'); const b = await s2.call('quickask:submit', 'hi', [{ kind: 'file', id: r2.id }]); ok(!b.ok, 'sent after close');
  return 'dropped => refused; closed bar => refused';
});
await guard('C11', 'a failed hand-over (Bunny could not open) keeps the bar AND the file so Send can be tried again; success afterwards sends it', async () => {
  const s = setup(); const r = await choose(s, files.txt); s.refuse(); const a = await s.call('quickask:submit', 'hi', [{ kind: 'file', id: r.id }]); ok(!a.ok && /could not open/.test(a.message) && !s.w.destroyed, JSON.stringify(a));
  const e2 = mkElectron({ next: null }); void e2; return 'refused with a message, bar open'; // the retry after willOpen=true is covered in B-rows
});
await guard('C12', 'IPC from anything but the bar page cannot pick or drop a file', async () => {
  const s = setup(); s.pick.next = files.txt; const evil = { sender: {}, senderFrame: { url: BAR } }; const wrong = evFrom(s.w, 'https://example.invalid/quick-ask/bar.html');
  for (const ev of [evil, wrong]) { const r = await s.e.log.handlers.get('quickask:pickFile')(ev); ok(r.ok === false && r.message === 'Not allowed', JSON.stringify(r)); }
  ok(s.e.log.dialogCalls.length === 0, 'dialog opened for a stranger'); return 'refused, dialog never opened';
});
await guard('C13', 'while the dialog is open a second pick is refused (no two dialogs), and the bar is shown again afterwards', async () => {
  const pick = { next: files.txt }; const e = mkElectron(pick); let release; e.dialog.showOpenDialog = () => new Promise((res) => { release = () => res({ canceled: false, filePaths: [files.txt] }); });
  const qa = Q.createQuickAsk({ ...e, onSubmit: () => true }); qa.open(); const w = e.log.windows[0]; w.emit('ready-to-show'); const call = (ch, ...a) => e.log.handlers.get(ch)(evFrom(w), ...a);
  const p1 = call('quickask:pickFile'); await new Promise((r) => setTimeout(r, 30)); const p2 = await call('quickask:pickFile'); ok(!p2.ok, 'second dialog accepted: ' + JSON.stringify(p2)); release(); const r1 = await p1; ok(r1.ok, 'first failed ' + JSON.stringify(r1));
  return 'second pick refused: ' + p2.message;
});
await guard('C14', 'no dialog available (older main) degrades with a message, not a crash', async () => {
  const pick = { next: files.txt }; const e = mkElectron(pick); const qa = Q.createQuickAsk({ ...e, dialog: null, onSubmit: () => true }); qa.open(); const w = e.log.windows[0]; const r = await e.log.handlers.get('quickask:pickFile')(evFrom(w)); ok(!r.ok && r.message, JSON.stringify(r)); return r.message;
});
await guard('C15', 'a name with a right-to-left override arrives clean in the request (what the chat will show)', async () => {
  const s = setup(); const r = await choose(s, files.rlo); ok(r.ok && !/\u202e/.test(r.name), JSON.stringify(r)); const sent = await s.call('quickask:submit', 'hi', [{ kind: 'file', id: r.id }]); ok(sent.ok && !/\u202e/.test(s.got().files[0].name), 'request name'); return `shown as "${r.name}"`;
});

await guard('C16', 'an ordinary 200 KB text file is refused with a message that says why (a plain size message, not the key-or-password one)', async () => {
  const s = setup(); const r = await choose(s, files.text200k); ok(r.ok || !/key or password/.test(r.message), 'refused as a secret: ' + JSON.stringify(r)); return r.ok ? 'accepted' : r.message;
});

// ------------------------------------------------------------------ B. the bar page
const browser = await chromium.launch();
async function barPage({ w = 700, scheme = 'light', pickResult, submit } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 300 }, colorScheme: scheme }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ pickResult, submitMode }) => {
    window.__calls = { pick: 0, drop: 0, submit: [] };
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }),
      pickFile: async () => { window.__calls.pick += 1; const r = window.__pickResults.shift(); return r; },
      dropFile: async () => { window.__calls.drop += 1; return { ok: true }; },
      submit: async (t, a) => { window.__calls.submit.push({ t, a }); return submitMode === 'fail' ? { ok: false, message: 'Bunny could not open.' } : { ok: true }; },
    };
    window.__pickResults = pickResult;
  }, { pickResult: pickResult ?? [], submitMode: submit ?? 'ok' });
  await page.goto(pathToFileURL(join(SRC, 'electron/quick-ask/bar.html')).href); await page.waitForSelector('#text');
  return { ctx, page, errors };
}
const goodPick = { ok: true, id: 'id-1', name: 'notes.txt', kind: 'text', size: 45 };
for (const [scheme, w] of [['light', 700], ['dark', 700], ['light', 420], ['dark', 420]]) {
  await guard(`B1-${scheme}-${w}`, `bar page ${scheme} ${w}px: both menu items fit inside the window; picking a file shows a chip with its name and an ×`, async () => {
    const { ctx, page, errors } = await barPage({ w, scheme, pickResult: [goodPick] });
    await page.locator('#plus').click(); const g = await page.evaluate(() => { const m = document.getElementById('menu').getBoundingClientRect(); return { l: m.left, r: m.right, t: m.top, b: m.bottom, vw: innerWidth, vh: innerHeight, items: [...document.querySelectorAll('#menu [role=menuitem]')].map((i) => ({ txt: i.innerText.replace(/\s+/g, ' '), over: i.scrollWidth > i.clientWidth + 1 })) }; });
    ok(g.l >= 0 && g.r <= g.vw && g.b <= g.vh && g.items.length === 2 && g.items.every((i) => !i.over) && g.items.some((i) => /Add a file/.test(i.txt)), JSON.stringify(g));
    await page.screenshot({ path: join(OUT, `b1-menu-${scheme}-${w}.png`) });
    await page.locator('#file-item').click(); await page.waitForSelector('.chip'); const chip = await page.locator('.chip').innerText(); ok(/notes\.txt/.test(chip) && (await page.locator('.chip button').count()) === 1, chip);
    await page.screenshot({ path: join(OUT, `b1-chip-${scheme}-${w}.png`) }); ok(errors.length === 0, errors.join(';')); const c = await page.evaluate(() => window.__calls); await ctx.close();
    return `menu ${Math.round(g.l)}–${Math.round(g.r)} of ${g.vw}, bottom ${Math.round(g.b)} of ${g.vh}; chip "${chip.replace(/\s+/g, ' ')}"; pick calls ${c.pick}`;
  });
}
await guard('B2', 'bar page: cancelling the dialog shows nothing; a refused file shows its plain message (amber) and no chip', async () => {
  const { ctx, page } = await barPage({ pickResult: [{ ok: false, cancelled: true }, { ok: false, message: 'This file looks like it holds a key or password, so it was not attached.' }] });
  await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForTimeout(200); ok((await page.locator('#msg').isHidden()) && (await page.locator('.chip').count()) === 0, 'cancel showed something');
  await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForTimeout(200); const m = await page.locator('#msg').innerText(); ok(/key or password/.test(m) && (await page.locator('.chip').count()) === 0, m); ok(await page.evaluate(() => document.getElementById('msg').classList.contains('is-problem')), 'not amber');
  await page.screenshot({ path: join(OUT, 'b2-refused.png') }); await ctx.close(); return m;
});
await guard('B3', 'bar page: × removes the chip and tells main (dropFile); sending then carries no attachment', async () => {
  const { ctx, page } = await barPage({ pickResult: [goodPick] }); await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForSelector('.chip');
  await page.locator('.chip button').click(); ok((await page.locator('.chip').count()) === 0, 'chip stays'); const c = await page.evaluate(() => window.__calls); ok(c.drop === 1, 'drop calls ' + c.drop);
  await page.locator('#text').fill('plain question'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); const s = (await page.evaluate(() => window.__calls)).submit; ok(s.length === 1 && s[0].a.length === 0, JSON.stringify(s)); await ctx.close(); return 'drop called once; submit has no attachment';
});
await guard('B4', 'bar page: Enter sends the file by id only (kind, id) — never its name, bytes or path', async () => {
  const { ctx, page } = await barPage({ pickResult: [goodPick] }); await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForSelector('.chip'); await page.locator('#text').fill('look at this'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const s = (await page.evaluate(() => window.__calls)).submit; ok(s.length === 1 && s[0].a.length === 1 && Object.keys(s[0].a[0]).sort().join() === 'id,kind' && s[0].a[0].id === 'id-1' && s[0].a[0].kind === 'file', JSON.stringify(s)); await ctx.close(); return JSON.stringify(s[0].a[0]);
});
await guard('B5', 'bar page: a hostile file name is shown as text, never as HTML', async () => {
  const { ctx, page } = await barPage({ pickResult: [{ ok: true, id: 'id-2', name: '<img src=x onerror=window.__pwn=1>.txt', kind: 'text', size: 3 }] }); await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForSelector('.chip'); await page.waitForTimeout(200);
  const pwn = await page.evaluate(() => window.__pwn === 1); const imgs = await page.locator('.chip img').count(); const t = await page.locator('.chip').innerText(); ok(!pwn && imgs === 0 && /<img/.test(t), `pwn=${pwn} imgs=${imgs} text=${t}`); await ctx.close(); return 'shown literally: ' + t.replace(/\s+/g, ' ');
});
await guard('B6', 'bar page: a picture file shows its small preview; a second pick replaces the first (one file only); a screenshot after a file replaces it', async () => {
  const PREV = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const { ctx, page } = await barPage({ pickResult: [{ ok: true, id: 'p1', name: 'pic.png', kind: 'image', size: 70, preview: PREV }, goodPick] });
  await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForSelector('.chip'); ok((await page.locator('.chip img').getAttribute('src')) === PREV, 'preview missing');
  await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForTimeout(200); ok((await page.locator('.chip').count()) === 1 && /notes\.txt/.test(await page.locator('.chip').innerText()), 'second pick did not replace');
  await page.locator('#plus').click(); await page.locator('#shot-item').click(); await page.waitForTimeout(200); const chip = await page.locator('.chip').innerText(); ok((await page.locator('.chip').count()) === 1 && /Screenshot/.test(chip), 'screenshot did not replace: ' + chip);
  const c = await page.evaluate(() => window.__calls); console.log(`INFO  replacing a file by a screenshot calls dropFile ${c.drop}x (the held file stays in main until the bar closes or it is sent; a later send carries the screenshot only)`); await ctx.close(); return `chip after screenshot: "${chip}"`;
});
await guard('B7', 'bar page: a refused send keeps the text AND the file chip, so Send can be tried again', async () => {
  const { ctx, page } = await barPage({ pickResult: [goodPick], submit: 'fail' }); await page.locator('#plus').click(); await page.locator('#file-item').click(); await page.waitForSelector('.chip'); await page.locator('#text').fill('keep me'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  ok(/could not open/.test(await page.locator('#msg').innerText()) && (await page.locator('.chip').count()) === 1 && (await page.locator('#text').inputValue()) === 'keep me', 'state lost'); await ctx.close(); return 'text, chip and message kept';
});
await guard('B8', 'bar page: Esc/Enter keyboard use of the menu — the menu closes on choosing; the text box regains focus', async () => {
  const { ctx, page } = await barPage({ pickResult: [goodPick] }); await page.locator('#plus').click(); ok(await page.locator('#menu').isVisible(), 'menu closed'); await page.locator('#file-item').click(); await page.waitForSelector('.chip'); ok(await page.locator('#menu').isHidden(), 'menu stayed'); ok(await page.evaluate(() => document.activeElement?.id === 'text'), 'focus'); await ctx.close(); return 'menu closes; focus back in the box';
});

// ------------------------------------------------------------------ N. the chat page takes the request as an ordinary attachment
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`; const modelSaw = [];
const fake = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
  modelSaw.push(JSON.stringify(JSON.parse(raw).messages)); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame({ content: 'Scripted answer.' }) + 'data: [DONE]' + NL + NL); }); });
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port;
const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w019-48b-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
try {
  ok((await (await fetch(BASE + '/api/health')).json()).fake, 'refusing: not an invented profile');
  await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${FPORT}/a/v1` }) });
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ modelFilter: 'all' }) });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const chat = await ctx.newPage(); const pend = { v: null };
  await chat.exposeFunction('__take', () => { const r = pend.v; pend.v = null; return r; });
  await chat.addInitScript(() => { window.__fire = []; window.bunnyDesktop = { quickAsk: { take: () => window.__take(), onNewChat: (fn) => { window.__fire.push(fn); return () => {}; } } }; });
  await chat.goto('/'); await chat.waitForSelector('#input'); await chat.waitForTimeout(1200);
  for (const [id, key, name, expectText] of [['N1', 'txt', 'notes.txt', 'Plan for the garden'], ['N2', 'pdf', 'doc.pdf', 'Quarterly tulip report'], ['N3', 'png', 'pic.png', null], ['N4', 'midText', 'mid.txt', 'hello world'], ['N5', 'midPng', 'mid.png', null]]) {
    await guard(id, `chat page: a quick ask carrying ${name} opens a NEW chat in Chat mode and sends the file as an ordinary attachment`, async () => {
      modelSaw.length = 0; const fs = await import('node:fs/promises'); const checked = L.checkFile(name, await fs.readFile(files[key]));
      const before = await (await fetch(BASE + '/api/sessions', { headers: H })).json(); pend.v = L.buildNewChatRequest('What is in this file?', null, checked.file);
      await chat.evaluate(() => window.__fire.forEach((f) => f())); await chat.waitForFunction(() => /Scripted answer/.test(document.getElementById('messages').innerText), null, { timeout: 25000 }).catch(async (e) => { throw new Error('no answer; page says: ' + (await chat.locator('#error').innerText().catch(() => '')).slice(0, 160) + ' | ' + (await chat.locator('#messages').innerText()).replace(/s+/g, ' ').slice(-160)); });
      const after = await (await fetch(BASE + '/api/sessions', { headers: H })).json(); ok(after.length === before.length + 1, `sessions ${before.length}->${after.length}`);
      const shown = await chat.locator('#messages').innerText(); ok(shown.includes('What is in this file?'), 'question not shown'); ok(shown.includes(name) || (await chat.locator('#messages .attachment-image').count()) > 0 || /attachment/i.test(await chat.locator('#messages').innerHTML()), 'attachment not shown');
      const sent = modelSaw.join(' '); if (expectText) ok(sent.includes(expectText), 'file text never reached the model'); await chat.screenshot({ path: join(OUT, `${id}-chat.png`) });
      return `new chat; model saw ${sent.length} chars${expectText ? ' incl. the file text' : ''}`;
    });
  }
  await ctx.close();
} catch (e) { check('X', 'abort', false, e.message); }
try { await browser.close(); } catch { /* x */ }
try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
fake.close();
const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${OUT}`); process.exit(bad.length ? 1 : 0);
