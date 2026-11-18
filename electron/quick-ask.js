// W4-8 / QA-ANSWERS: the quick-ask bar. A global shortcut opens a small frameless prompt bar over any app.
// The bar answers a question in place, as TEXT ONLY (no tool is offered, no permission is ever asked here: anything that needs one is handed to Bunny's window,
// which asks there under the person's own rules). The reply is untrusted text, shown through the sanitised markdown and a strict CSP. "Open in Bunny" carries the chat over.
// A screenshot is taken only when the person chooses "Add a screenshot" in the bar, and lives only in the message it is sent with.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { createAnswerer } from './quick-ask-answer.js';
import { FILE_DIALOG_FILTERS, MAX_IMAGE_BYTES, MAX_SHOT_BYTES, TAKEN_MESSAGE, barLook, buildNewChatRequest, checkFile, checkPath, validateAccelerator, validateSubmission } from './quick-ask-logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const BAR_DIR = join(here, 'quick-ask');
const KEEP_TEXT_MS = 5 * 60 * 1000; // clicking away hides the bar and keeps the text this long

const BAR_WIDTH = 640;
const ESC_ANSWER_MS = 600; // how long the page has to answer an Esc before the bar closes by itself

/** The window options of the bar, kept as data so a test can check them. */
export function barWindowOptions(preload = join(BAR_DIR, 'preload.cjs')) {
  return {
    width: BAR_WIDTH,
    height: MIN_BAR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    title: 'Bunny AI quick ask',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  };
}

export const MIN_BAR_HEIGHT = 80; // the pill alone (about 70 px with its margin); the page asks for more while the + menu is open or an answer is shown
export const MAX_BAR_HEIGHT = 560; // a long answer grows the bar to about this and then scrolls inside it

export function createQuickAsk({ BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, onSubmit, dialog = null, fileOps = { lstat, open }, adminFetch = null, getSettings = () => ({}), onOpenChat = () => {}, onOpenSettings = () => {}, onAnswerFinished = () => {} }) {
  let bar = null;
  let registered = null; // the accelerator currently held
  let keepTimer = null;
  let barHeight = MIN_BAR_HEIGHT;
  const answerer = adminFetch ? createAnswerer({
    adminFetch,
    emit: (event) => { if (alive()) bar.webContents.send('quickask:answer', event); },
    onFinishedDetached: (sessionId) => onAnswerFinished(sessionId),
  }) : null;
  let escTimer = null;
  let held = null; // W4-8b: the one file the person picked, { id, file }: the checked bytes live only here until sent, removed or the bar closes

  const alive = () => bar && !bar.isDestroyed();
  const fromBar = (event) => alive() && event.sender === bar.webContents && /^file:\/\/.*\/quick-ask\/bar\.html$/.test(event.senderFrame?.url ?? '');

  function destroyBar({ keepAnswer = false } = {}) {
    clearTimeout(keepTimer);
    clearTimeout(escTimer);
    held = null;
    if (answerer && !keepAnswer) { answerer.stop(); answerer.reset(); } // Esc and closing stop a running answer; what arrived is kept in the chat
    barHeight = MIN_BAR_HEIGHT;
    if (alive()) bar.destroy();
    bar = null;
  }

  function place() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    const w = Math.min(BAR_WIDTH, Math.floor(width * 0.95));
    bar.setBounds({ x: Math.round(x + (width - w) / 2), y: Math.round(y + Math.max(0, height * 0.2 - 8)), width: w, height: barHeight });
  }

  function open() {
    clearTimeout(keepTimer);
    if (alive()) { // a second press while open just focuses
      place();
      bar.show();
      bar.focus();
      bar.webContents.focus();
      return;
    }
    bar = new BrowserWindow(barWindowOptions());
    const win = bar;
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('will-redirect', (event) => event.preventDefault());
    wc.on('will-attach-webview', (event) => event.preventDefault());
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      event.preventDefault();
      // QUICK-UI 3: Esc does one thing at a time. The page decides: the + menu open, it closes the menu; an answer coming, it stops it and keeps what arrived; otherwise it closes the bar
      // (and forgets the text). A page that does not answer in 600 ms is stuck: the bar closes, so Esc can always close it.
      clearTimeout(escTimer);
      try { wc.send('quickask:esc'); } catch { destroyBar(); return; }
      escTimer = setTimeout(() => { if (bar === win) destroyBar(); }, ESC_ANSWER_MS);
    });
    win.on('blur', () => {
      if (bar !== win || !alive() || capturing || picking) return;
      win.hide();
      clearTimeout(keepTimer);
      keepTimer = setTimeout(() => { if (bar === win) destroyBar(); }, KEEP_TEXT_MS);
    });
    win.on('closed', () => { if (bar === win) bar = null; });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(join(BAR_DIR, 'bar.html'));
    win.once('ready-to-show', () => { if (bar === win) { place(); win.show(); win.focus(); } });
  }

  let capturing = false;
  let picking = false; // the file dialog is open: the bar losing focus to it is not the person clicking away

  /** One picture of the screen the bar is on. Called only from the bar's "Add a screenshot". */
  async function capture() {
    if (!alive() || capturing) return { ok: false, message: 'Bunny could not take a screenshot.' };
    capturing = true;
    const win = bar;
    try {
      const display = screen.getDisplayNearestPoint({ x: win.getBounds().x, y: win.getBounds().y });
      win.hide(); // the bar must not be in the picture
      await new Promise((r) => setTimeout(r, 250));
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0];
      if (!source) return { ok: false, message: 'Bunny could not take a screenshot.' };
      let image = source.thumbnail;
      let png = image.toPNG();
      for (let i = 0; i < 5 && png.length > MAX_IMAGE_BYTES; i += 1) { // shrink until it fits what the chat accepts
        const s = image.getSize();
        image = image.resize({ width: Math.max(320, Math.floor(s.width * 0.7)) });
        png = image.toPNG();
      }
      if (!png.length || png.length > MAX_IMAGE_BYTES) return { ok: false, message: 'The screenshot is over 3 MB.' };
      return { ok: true, data: `data:image/png;base64,${png.toString('base64')}` };
    } catch {
      return { ok: false, message: 'Bunny could not take a screenshot.' };
    } finally {
      capturing = false;
      if (bar === win && alive()) { win.show(); win.focus(); }
    }
  }

  /**
   * W4-8b: one file the person chooses in the native dialog. The page sends no path; the dialog is the only source of one. The file must be a real file
   * (a link is refused), at most 8 MB, of a kind in the table, and its bytes must agree with its name. Held in memory until sent; nothing is written.
   */
  async function pickFile() {
    if (!alive() || picking || !dialog) return { ok: false, message: 'Bunny could not open the file dialog.' };
    picking = true;
    const win = bar;
    try {
      const chosen = await dialog.showOpenDialog(win, { title: 'Add a file', properties: ['openFile'], filters: FILE_DIALOG_FILTERS });
      if (chosen.canceled || !chosen.filePaths?.length) return { ok: false, cancelled: true };
      const path = chosen.filePaths[0];
      const where = checkPath(path);
      if (!where.ok) return where;
      const info = await fileOps.lstat(path); // a link is refused (Windows has no O_NOFOLLOW, so this and the handle check below are both done)
      if (info.isSymbolicLink() || !info.isFile()) return { ok: false, message: 'That is not a plain file.' };
      if (info.size > MAX_SHOT_BYTES) return { ok: false, message: 'The file is over 8 MB.' };
      // read ONCE from ONE handle: the handle's own size and kind are checked, and at most 8 MB + 1 is read
      let bytes;
      const handle = await fileOps.open(path, 'r');
      try {
        const hinfo = await handle.stat();
        if (!hinfo.isFile()) return { ok: false, message: 'That is not a plain file.' };
        if (hinfo.size > MAX_SHOT_BYTES) return { ok: false, message: 'The file is over 8 MB.' };
        const buffer = Buffer.alloc(Math.min(hinfo.size, MAX_SHOT_BYTES) + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
          if (!bytesRead) break;
          total += bytesRead;
        }
        if (total > MAX_SHOT_BYTES || total > hinfo.size) return { ok: false, message: 'The file is over 8 MB.' }; // it grew while it was being read
        bytes = buffer.subarray(0, total);
      } finally {
        await handle.close().catch(() => {});
      }
      const checked = checkFile(path, bytes);
      if (!checked.ok) return checked;
      const { file } = checked;
      held = { id: randomUUID(), file };
      // the page gets the id, the name, the kind, the size and (a small picture only) a preview. Never the bytes, never the type.
      const preview = file.kind === 'image' && file.size <= 200 * 1024 ? file.data : undefined;
      return { ok: true, id: held.id, name: file.name, kind: file.kind, size: file.size, ...(preview ? { preview } : {}) };
    } catch {
      return { ok: false, message: 'Bunny could not read that file.' };
    } finally {
      picking = false;
      if (bar === win && alive()) { win.show(); win.focus(); }
    }
  }

  // QUICK-UI 8 and 9: when the bar opens it asks once how Bunny looks (theme, interface font, reduced motion) and which model will answer. Read in this process from Bunny's own settings,
  // cleaned to fixed keys (barLook); the page gets plain words and nothing it could run. If anything fails it gets nothing, and shows the defaults and no model line.
  ipcMain.handle('quickask:init', (event) => {
    if (!fromBar(event)) return {};
    try { return barLook(getSettings() ?? {}); } catch { return {}; }
  });
  ipcMain.handle('quickask:pickFile', async (event) => (fromBar(event) ? pickFile() : { ok: false, message: 'Not allowed' }));
  ipcMain.handle('quickask:dropFile', (event) => { if (fromBar(event)) held = null; return { ok: true }; });
  ipcMain.handle('quickask:capture', async (event) => (fromBar(event) ? capture() : { ok: false, message: 'Not allowed' }));
  // QA-ANSWERS: the question is answered in the bar. Same checks as a submission (one screenshot or one held file, the text limits), then text only.
  ipcMain.handle('quickask:ask', async (event, text, attachments) => {
    if (!fromBar(event)) return { ok: false, message: 'Not allowed' };
    if (!answerer) return { ok: false, message: 'Bunny could not answer here.' };
    if (answerer.answering) return { ok: false, message: 'Bunny is still answering.' };
    const checked = validateSubmission(text, attachments, held);
    if (!checked.ok) return checked;
    const request = buildNewChatRequest(checked.text, checked.shot, checked.file);
    held = null; // the file or screenshot lives only in this message
    answerer.ask({ text: request.text, files: request.files }); // events come back through quickask:answer
    return { ok: true };
  });
  ipcMain.handle('quickask:stop', (event) => { if (fromBar(event) && answerer) answerer.stop(); return { ok: true }; });
  // QUICK-UI 3: the page says what it did with an Esc: it dealt with it itself (menu closed, answer stopped), or the bar should close. Both only from the bar's own page.
  ipcMain.handle('quickask:escHandled', (event) => { if (fromBar(event)) clearTimeout(escTimer); return { ok: true }; });
  ipcMain.handle('quickask:close', (event) => { if (!fromBar(event)) return { ok: false }; destroyBar(); return { ok: true }; });
  // Open in Bunny: the chat (and an answer still coming) is carried over to the main window; the bar closes.
  ipcMain.handle('quickask:open', (event, target) => {
    if (!fromBar(event) || !answerer) return { ok: false, message: 'Not allowed' };
    // QUICK-UI 10: "No model connected" leads with Open Bunny settings: the window comes forward on its Providers page; the bar closes (nothing is carried over: there is no chat worth keeping)
    if (target === 'settings') { onOpenSettings(); destroyBar(); return { ok: true }; }
    const id = answerer.sessionId;
    if (!id) return { ok: false, message: 'There is no chat to open yet.' };
    answerer.detach();
    onOpenChat(id);
    destroyBar({ keepAnswer: true });
    return { ok: true };
  });
  // The page tells how tall its content is; the bar grows to fit, never past MAX_BAR_HEIGHT or the screen.
  ipcMain.handle('quickask:resize', (event, height) => {
    if (!fromBar(event) || !alive()) return { ok: false };
    const wanted = Math.round(Number(height));
    if (!Number.isFinite(wanted)) return { ok: false };
    const display = screen.getDisplayNearestPoint({ x: bar.getBounds().x, y: bar.getBounds().y });
    barHeight = Math.max(MIN_BAR_HEIGHT, Math.min(MAX_BAR_HEIGHT, wanted, display.workArea.height - 40));
    const b = bar.getBounds();
    bar.setBounds({ x: b.x, y: b.y, width: b.width, height: barHeight });
    return { ok: true, height: barHeight };
  });
  ipcMain.handle('quickask:submit', async (event, text, attachments) => {
    if (!fromBar(event)) return { ok: false, message: 'Not allowed' };
    const checked = validateSubmission(text, attachments, held);
    if (!checked.ok) return checked;
    const opened = await onSubmit(buildNewChatRequest(checked.text, checked.shot, checked.file));
    if (opened === false) return { ok: false, message: 'Bunny could not open.' };
    held = null;
    destroyBar(); // the screenshot is gone with the bar; it now lives only in the new chat
    return { ok: true };
  });

  function unregister() {
    if (registered) { try { globalShortcut.unregister(registered); } catch { /* already gone */ } }
    registered = null;
  }

  /** Turn the shortcut on. Returns { ok: true, accelerator } or { ok: false, message }. */
  function enable(shortcut) {
    const checked = validateAccelerator(shortcut);
    if (!checked.ok) return checked;
    if (registered === checked.accelerator) return checked;
    const previous = registered;
    let ok = false;
    try { ok = globalShortcut.register(checked.accelerator, open); } catch { ok = false; }
    if (!ok) return { ok: false, message: TAKEN_MESSAGE };
    if (previous) { try { globalShortcut.unregister(previous); } catch { /* already gone */ } }
    registered = checked.accelerator;
    return checked;
  }

  function disable() {
    unregister();
    destroyBar();
  }

  return { enable, disable, open, isEnabled: () => Boolean(registered), accelerator: () => registered };
}
