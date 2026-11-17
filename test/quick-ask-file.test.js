import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile, cleanFileName, validateSubmission, buildNewChatRequest, MAX_SHOT_BYTES } from '../electron/quick-ask-logic.js';
import { createQuickAsk } from '../electron/quick-ask.js';

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

test('a submission takes at most one screenshot OR one file, and a file is checked again from its bytes', () => {
  const ok = validateSubmission('read this', [{ kind: 'file', name: 'a.pdf', data: asData('application/pdf', PDF) }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.shot, null);
  assert.equal(ok.file.name, 'a.pdf');
  assert.deepEqual(buildNewChatRequest(ok.text, ok.shot, ok.file).files, [{ name: 'a.pdf', mime: 'application/pdf', kind: 'pdf', data: asData('application/pdf', PDF), size: PDF.length }]);
  assert.match(validateSubmission('x', [{ kind: 'file', name: 'a.pdf', data: asData('application/pdf', PDF) }, { kind: 'file', name: 'b.pdf', data: asData('application/pdf', PDF) }]).message, /Only one/);
  // the page says it is a picture; the bytes say otherwise
  assert.equal(validateSubmission('x', [{ kind: 'file', name: 'a.png', data: asData('image/png', Buffer.from('not a picture')) }]).ok, false);
  // the page cannot choose the type: a .exe is refused whatever it claims
  assert.equal(validateSubmission('x', [{ kind: 'file', name: 'a.exe', mime: 'image/png', data: asData('image/png', PNG) }]).ok, false);
  assert.equal(validateSubmission('x', [{ kind: 'file', name: 'a.txt', data: 'not a data address' }]).ok, false);
  // the screenshot path is unchanged
  assert.equal(validateSubmission('x', [{ data: asData('image/png', PNG) }]).ok, true);
});

/** The main process with a stand-in dialog and stand-in file operations. */
function quickAsk({ chosen, info, bytes }) {
  const handlers = new Map();
  const win = {
    isDestroyed: () => false, webContents: { sender: true, setWindowOpenHandler() {}, on() {}, session: { setPermissionRequestHandler() {} } },
    on() {}, once() {}, loadFile() {}, setAlwaysOnTop() {}, setBounds() {}, show() {}, focus() {}, hide() {}, destroy() {},
  };
  const sent = [];
  const api = createQuickAsk({
    BrowserWindow: function Win() { return win; },
    globalShortcut: { register: () => true, unregister() {} },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    desktopCapturer: {},
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    onSubmit: async (request) => { sent.push(request); return true; },
    dialog: { showOpenDialog: async (window, options) => { sent.push({ dialog: options }); return chosen; } },
    fileOps: { lstat: async () => info, readFile: async () => bytes },
  });
  api.open();
  const event = { sender: win.webContents, senderFrame: { url: 'file:///x/quick-ask/bar.html' } };
  return { call: (name, ...args) => handlers.get(name)(event, ...args), sent, handlers };
}
const plainFile = (size) => ({ isSymbolicLink: () => false, isFile: () => true, size });

test('main: the dialog is the only source of a path; a plain file is read and returned with its checked type', async () => {
  const q = quickAsk({ chosen: { canceled: false, filePaths: ['C:\\invented\\notes.txt'] }, info: plainFile(5), bytes: Buffer.from('hello') });
  const r = await q.call('quickask:pickFile');
  assert.deepEqual([r.ok, r.name, r.mime, r.kind], [true, 'notes.txt', 'text/plain', 'text']);
  assert.deepEqual(q.sent[0].dialog.properties, ['openFile'], 'one file, no folders');
  assert.ok(q.sent[0].dialog.filters[0].extensions.includes('pdf') && !q.sent[0].dialog.filters[0].extensions.includes('exe'));
});

test('main: a link, a folder, an over-large file, a renamed program and a cancel are all refused or ignored plainly', async () => {
  const symlink = quickAsk({ chosen: { canceled: false, filePaths: ['/x/link.txt'] }, info: { isSymbolicLink: () => true, isFile: () => false, size: 1 }, bytes: Buffer.from('x') });
  assert.match((await symlink.call('quickask:pickFile')).message, /plain file/);
  const big = quickAsk({ chosen: { canceled: false, filePaths: ['/x/big.txt'] }, info: plainFile(MAX_SHOT_BYTES + 1), bytes: Buffer.from('x') });
  assert.match((await big.call('quickask:pickFile')).message, /over 8 MB/);
  const trick = quickAsk({ chosen: { canceled: false, filePaths: ['/x/not-a.png'] }, info: plainFile(10), bytes: Buffer.from('MZ program') });
  assert.match((await trick.call('quickask:pickFile')).message, /not what its name says/);
  const cancel = quickAsk({ chosen: { canceled: true, filePaths: [] }, info: plainFile(1), bytes: Buffer.from('x') });
  assert.deepEqual(await cancel.call('quickask:pickFile'), { ok: false, cancelled: true });
});

test('main: a call from anywhere but the bar is refused, and a file sent with the message becomes an ordinary attachment of a new chat', async () => {
  const q = quickAsk({ chosen: { canceled: true, filePaths: [] }, info: plainFile(1), bytes: Buffer.from('x') });
  const stranger = await q.handlers.get('quickask:pickFile')({ sender: {}, senderFrame: { url: 'https://example.test/' } });
  assert.deepEqual(stranger, { ok: false, message: 'Not allowed' });
  const sent = await q.call('quickask:submit', 'read it', [{ kind: 'file', name: 'a.pdf', data: asData('application/pdf', PDF) }]);
  assert.equal(sent.ok, true);
  const request = q.sent.find((x) => x.files);
  assert.deepEqual([request.workMode, request.folder, request.files[0].name, request.files[0].kind], ['chat', null, 'a.pdf', 'pdf']);
});
