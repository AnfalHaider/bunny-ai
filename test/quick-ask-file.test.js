import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile, checkPath, cleanFileName, validateSubmission, buildNewChatRequest, MAX_SHOT_BYTES } from '../electron/quick-ask-logic.js';
import { createQuickAsk } from '../electron/quick-ask.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-8b: "Add a file…" in the quick-ask bar. The type is decided in the main process from the extension, the bytes must agree, nothing comes from the page but the file itself.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('invented picture bytes')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('invented')]);
const GIF = Buffer.from('GIF89a invented');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7 invented');
const asData = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;

test('the name is only the file\'s own name: no folders, no control characters, at most 120 characters', () => {
  assert.equal(cleanFileName('C:\\Users\\someone\\Docs\\report.txt'), 'report.txt');
  assert.equal(cleanFileName('/home/x/notes.md'), 'notes.md');
  assert.equal(cleanFileName('a\u0000b\u001fc.txt'), 'abc.txt');
  assert.equal(cleanFileName('x'.repeat(200) + '.txt').length, 120);
  assert.equal(cleanFileName('   '), 'file');
});

test('each kind is accepted only when its bytes agree with its name', () => {
  for (const [name, bytes, mime, kind] of [['a.png', PNG, 'image/png', 'image'], ['a.jpg', JPG, 'image/jpeg', 'image'], ['a.jpeg', JPG, 'image/jpeg', 'image'], ['a.gif', GIF, 'image/gif', 'image'], ['a.webp', WEBP, 'image/webp', 'image'], ['a.pdf', PDF, 'application/pdf', 'pdf'], ['notes.md', Buffer.from('# hello\nüñí'), 'text/plain', 'text']]) {
    const r = checkFile(name, bytes);
    assert.equal(r.ok, true, name);
    assert.deepEqual([r.file.mime, r.file.kind, r.file.size], [mime, kind, bytes.length], name);
    assert.equal(r.file.data, asData(mime, bytes));
  }
});

test('refused: an unknown kind, a program renamed as a picture, a binary renamed as text, empty, over 8 MB', () => {
  assert.match(checkFile('tool.exe', Buffer.from('MZ....')).message, /cannot be added/);
  assert.match(checkFile('trick.png', Buffer.from('MZ not a png at all')).message, /not what its name says/);
  assert.match(checkFile('trick.pdf', Buffer.from('<html>')).message, /not what its name says/);
  assert.match(checkFile('binary.txt', Buffer.from([0x68, 0x69, 0x00, 0x01])).message, /not what its name says/, 'a NUL byte');
  assert.match(checkFile('latin.txt', Buffer.from([0x68, 0xe9, 0x69])).message, /not what its name says/, 'not valid UTF-8');
  assert.match(checkFile('empty.txt', Buffer.alloc(0)).message, /empty/);
  assert.match(checkFile('big.txt', Buffer.alloc(MAX_SHOT_BYTES + 1, 0x61)).message, /over 8 MB/);
  assert.equal(checkFile('noext', Buffer.from('x')).ok, false);
});

test('Security W4-8b: no key or password files, a name cannot hide behind invisible characters, and a text file holding a key is refused', () => {
  const secret = 'This file looks like it holds a key or password, so it was not attached.';
  for (const name of ['.env', '.env.local', 'prod.env', 'server.pem', 'a.key', 'a.p12', 'a.pfx', 'a.ppk', 'vault.kdbx', 'id_rsa', 'a.PEM']) assert.equal(checkFile(name, Buffer.from('x')).message, secret, name);
  assert.equal(checkFile('notes.txt', Buffer.from('my key is sk-abcdefghijklmnopqrstuvwx1234')).message, secret);
  assert.equal(checkFile('notes.txt', Buffer.from('lunch at noon')).ok, true);
  assert.equal(checkFile('Makefile', Buffer.from('all:')).ok, false, 'no extension');
  assert.equal(cleanFileName('report\u202Egpj.txt'), 'reportgpj.txt', 'U+202E is removed');
});

test('Security W4-8b: only a local drive path; a share and a device path are refused', () => {
  for (const p of ['\\\\server\\share\\a.txt', '//server/share/a.txt', '\\\\.\\C:\\a.txt', '\\\\?\\C:\\a.txt', '']) assert.equal(checkPath(p).ok, false, p);
  assert.equal(checkPath('C:\\Users\\x\\a.txt').ok, true);
});

/** The main process with a stand-in dialog; files are real, in a temporary folder of invented data. */
function quickAsk(chosenPath) {
  const handlers = new Map();
  const win = {
    isDestroyed: () => false, webContents: { sender: true, setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } },
    on() {}, once() {}, loadFile() {}, setAlwaysOnTop() {}, setBounds() {}, show() {}, focus() {}, hide() {}, destroy() {},
  };
  const sent = [];
  const state = { path: chosenPath };
  const api = createQuickAsk({
    BrowserWindow: function Win() { return win; },
    globalShortcut: { register: () => true, unregister() {} },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    desktopCapturer: {},
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    onSubmit: async (request) => { sent.push(request); return true; },
    dialog: { showOpenDialog: async (window, options) => { sent.push({ dialog: options }); return state.path ? { canceled: false, filePaths: [state.path] } : { canceled: true, filePaths: [] }; } },
  });
  api.open();
  const event = { sender: win.webContents, senderFrame: { url: 'file:///x/quick-ask/bar.html' } };
  return { call: (name, ...args) => handlers.get(name)(event, ...args), sent, handlers, state };
}
const folder = mkdtempSync(join(tmpdir(), 'bunny-qa-file-'));
const put = (name, bytes) => { const p = join(folder, name); writeFileSync(p, bytes); return p; };
test.after(() => rmSync(folder, { recursive: true, force: true }));

test('main: the dialog is the only source of a path; the page gets an id, the name, the kind and the size, and never the bytes or a type', async () => {
  const q = quickAsk(put('notes.txt', 'hello'));
  const r = await q.call('quickask:pickFile');
  assert.deepEqual(Object.keys(r).sort(), ['id', 'kind', 'name', 'ok', 'size']);
  assert.deepEqual([r.ok, r.name, r.kind, r.size], [true, 'notes.txt', 'text', 5]);
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(q.sent[0].dialog.properties, ['openFile'], 'one file, no folders');
  assert.ok(q.sent[0].dialog.filters[0].extensions.includes('pdf') && !q.sent[0].dialog.filters[0].extensions.includes('exe') && !q.sent[0].dialog.filters[0].extensions.includes('env'));
  const small = await quickAsk(put('a.png', PNG)).call('quickask:pickFile');
  assert.match(small.preview, /^data:image\/png;base64,/, 'a small picture has a preview');
});

test('main: a share, a folder, an over-large file, a renamed program, a key file and a cancel are refused or ignored plainly', async () => {
  assert.match((await quickAsk('\\\\server\\share\\a.txt').call('quickask:pickFile')).message, /on this computer/);
  assert.match((await quickAsk(folder).call('quickask:pickFile')).message, /plain file/);
  assert.match((await quickAsk(put('big.txt', Buffer.alloc(MAX_SHOT_BYTES + 1, 0x61))).call('quickask:pickFile')).message, /over 8 MB/);
  assert.match((await quickAsk(put('not-a.png', 'MZ program')).call('quickask:pickFile')).message, /not what its name says/);
  assert.match((await quickAsk(put('.env', 'A=1')).call('quickask:pickFile')).message, /key or password/);
  assert.match((await quickAsk(put('keys.txt', 'token = sk-abcdefghijklmnopqrstuvwx1234')).call('quickask:pickFile')).message, /key or password/);
  assert.deepEqual(await quickAsk(null).call('quickask:pickFile'), { ok: false, cancelled: true });
});

test('main: the file is sent as it was when picked, by its id; an id the bar never received, a second attachment and a stranger are refused', async () => {
  const path = put('plan.txt', 'the original words');
  const q = quickAsk(path);
  const stranger = await q.handlers.get('quickask:pickFile')({ sender: {}, senderFrame: { url: 'https://example.test/' } });
  assert.deepEqual(stranger, { ok: false, message: 'Not allowed' });
  const picked = await q.call('quickask:pickFile');
  writeFileSync(path, 'CHANGED after the pick'); // the file changes between the pick and the send
  assert.match((await q.call('quickask:submit', 'read it', [{ kind: 'file', id: 'not-an-id-the-bar-received' }])).message, /not valid/);
  assert.match((await q.call('quickask:submit', 'read it', [{ kind: 'file', id: picked.id }, { kind: 'file', id: picked.id }])).message, /Only one/);
  assert.match((await q.call('quickask:submit', 'read it', [{ kind: 'file', name: 'a.txt', data: asData('text/plain', Buffer.from('bytes from the page')) }])).message, /not valid/, 'bytes from the page are never taken');
  const sent = await q.call('quickask:submit', 'read it', [{ kind: 'file', id: picked.id }]);
  assert.equal(sent.ok, true);
  const request = q.sent.find((x) => x.files);
  assert.deepEqual([request.workMode, request.folder, request.files[0].name, request.files[0].kind], ['chat', null, 'plan.txt', 'text']);
  assert.equal(request.files[0].data, asData('text/plain', Buffer.from('the original words')), 'the original bytes, not the changed file');
  assert.match((await q.call('quickask:submit', 'again', [{ kind: 'file', id: picked.id }])).message, /not valid|Not allowed/, 'once sent, the bytes are dropped and the id works no more');
});

test('main: removing the file (x) drops the bytes, and a new pick replaces the old one', async () => {
  const q = quickAsk(put('one.txt', 'one'));
  const a = await q.call('quickask:pickFile');
  await q.call('quickask:dropFile');
  assert.match((await q.call('quickask:submit', 'x', [{ kind: 'file', id: a.id }])).message, /not valid/);
  const b = await q.call('quickask:pickFile');
  q.state.path = put('two.txt', 'two');
  const c = await q.call('quickask:pickFile');
  assert.match((await q.call('quickask:submit', 'x', [{ kind: 'file', id: b.id }])).message, /not valid/, 'the first id is gone');
  assert.equal((await q.call('quickask:submit', 'x', [{ kind: 'file', id: c.id }])).ok, true);
});

test('a submission without a file still takes one screenshot, and a held file becomes an ordinary attachment of a new chat', () => {
  assert.equal(validateSubmission('x', [{ data: asData('image/png', PNG) }]).ok, true);
  const file = checkFile('a.pdf', PDF).file;
  assert.deepEqual(buildNewChatRequest('t', null, file).files, [{ name: 'a.pdf', mime: 'application/pdf', kind: 'pdf', data: asData('application/pdf', PDF), size: PDF.length }]);
});

test('QA: the bar refuses by the chat\'s own limits with a plain size message (never the key message): text over 128 KB, a picture over 3 MB; a 5 MB PDF passes', () => {
  assert.equal(checkFile('notes.txt', Buffer.alloc(128 * 1024, 0x61)).ok, true, 'exactly 128 KB');
  const text = checkFile('notes.txt', Buffer.alloc(128 * 1024 + 1, 0x61));
  assert.equal(text.message, 'The text file is over 128 KB.');
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  assert.equal(checkFile('a.png', big).message, 'The picture is over 3 MB.');
  assert.equal(checkFile('a.png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])).ok, true);
  assert.equal(checkFile('a.pdf', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])).ok, true);
});
