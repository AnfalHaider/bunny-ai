// W4-8: the quick-ask bar. A global shortcut opens a small frameless prompt bar over any app.
// The bar only starts a new chat and brings Bunny's window forward; it never runs tools or shows answers.
// A screenshot is taken only when the person chooses "Add a screenshot" in the bar, and lives only in the message it is sent with.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { FILE_DIALOG_FILTERS, MAX_SHOT_BYTES, TAKEN_MESSAGE, buildNewChatRequest, checkFile, checkPath, validateAccelerator, validateSubmission } from './quick-ask-logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const BAR_DIR = join(here, 'quick-ask');
const KEEP_TEXT_MS = 5 * 60 * 1000; // clicking away hides the bar and keeps the text this long

/** The window options of the bar, kept as data so a test can check them. */
export function barWindowOptions(preload = join(BAR_DIR, 'preload.cjs')) {
  return {
    width: 700,
    height: 300,
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

export function createQuickAsk({ BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, onSubmit, dialog = null, fileOps = { lstat, open } }) {
  let bar = null;
  let registered = null; // the accelerator currently held
  let keepTimer = null;
  let held = null; // W4-8b: the one file the person picked, { id, file }: the checked bytes live only here until sent, removed or the bar closes

  const alive = () => bar && !bar.isDestroyed();
  const fromBar = (event) => alive() && event.sender === bar.webContents && /^file:\/\/.*\/quick-ask\/bar\.html$/.test(event.senderFrame?.url ?? '');

  function destroyBar() {
    clearTimeout(keepTimer);
    held = null;
    if (alive()) bar.destroy();
    bar = null;
  }

  function place() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    const w = Math.min(700, Math.floor(width * 0.95));
    bar.setBounds({ x: Math.round(x + (width - w) / 2), y: Math.round(y + Math.max(0, height * 0.2 - 8)), width: w, height: 300 });
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
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); destroyBar(); } // closes and forgets the text
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
      for (let i = 0; i < 4 && png.length > MAX_SHOT_BYTES; i += 1) { // shrink until it fits the limit
        const s = image.getSize();
        image = image.resize({ width: Math.max(320, Math.floor(s.width * 0.7)) });
        png = image.toPNG();
      }
      if (!png.length || png.length > MAX_SHOT_BYTES) return { ok: false, message: 'The screenshot is over 8 MB.' };
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

  ipcMain.handle('quickask:pickFile', async (event) => (fromBar(event) ? pickFile() : { ok: false, message: 'Not allowed' }));
  ipcMain.handle('quickask:dropFile', (event) => { if (fromBar(event)) held = null; return { ok: true }; });
  ipcMain.handle('quickask:capture', async (event) => (fromBar(event) ? capture() : { ok: false, message: 'Not allowed' }));
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
