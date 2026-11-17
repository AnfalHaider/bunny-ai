// W6-24: the browser panel's tabs as real browser views (Electron WebContentsView) laid over the panel, instead of iframes.
//
// Why: a site in an iframe can refuse to be framed, frame-bust, and loses its sign-in (third-party cookies in a frame are blocked).
// A view is a top-level page: it loads like a browser tab, and keeps its cookies in a partition of its own, `persist:bunny-browser`,
// which Bunny's own pages never share (and the reverse).
//
// What a view is allowed to be: sandboxed, no Node, no preload, no webview tag; it can open only http(s) addresses; a link that wants a
// new window becomes a new tab in the panel; it asks for no permission (camera, location, notifications...) and is told no.
// Only Bunny's own page may command a view (main.js checks the sender before it gets here), and only the views that page opened.
import { controlView } from './browserAgent.js';

export const PARTITION = 'persist:bunny-browser';
const TAB = /^bunny-tab-\d+$/;
const MAX_VIEWS = 12;

/** Only http and https may be loaded or navigated to: never file:, javascript:, data:, blob:, chrome:, devtools: ... */
export function allowedUrl(value) {
  try { const u = new URL(String(value)); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; }
}

/**
 * @param {object} o
 * @param {Function} o.WebContentsView  Electron's class (a fake in tests)
 * @param {object} o.session            Electron's session module (fromPartition)
 * @param {() => object | null} o.getWindow  the Bunny window (has contentView, getContentBounds)
 */
export function createBrowserViews({ WebContentsView, session, getWindow }) {
  const views = new Map(); // tab name -> { view, owner, visible }
  const watched = new WeakSet(); // pages already watched for leaving
  let partitionReady = false;

  function prepareSession() {
    if (partitionReady) return;
    const ses = session.fromPartition(PARTITION);
    // The page asks for nothing: no camera, microphone, location, notifications, clipboard reads...
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    partitionReady = true;
  }

  const isView = (contents) => [...views.values()].some((e) => e.view.webContents === contents);
  /** main.js's own guard must not run on these pages (it sends every link to the person's browser). */
  const ownsSession = (ses) => Boolean(ses) && ses === session.fromPartition(PARTITION);

  function emit(entry, tab, payload) {
    try { if (!entry.owner.isDestroyed?.()) entry.owner.send('browser:view-event', { tab, ...payload }); } catch { /* the window is gone */ }
  }

  function wire(entry, tab) {
    const contents = entry.view.webContents;
    // A page that wants a new window gets a new tab in the panel, never a new app window.
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedUrl(url)) emit(entry, tab, { event: 'new-tab', url });
      return { action: 'deny' };
    });
    const guardNavigation = (event, url) => { if (!allowedUrl(url)) event.preventDefault(); };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.on('will-frame-navigate', guardNavigation);
    contents.on('did-navigate', (_e, url) => emit(entry, tab, { event: 'navigated', url, title: contents.getTitle?.() ?? '', canGoBack: canBack(contents), canGoForward: canForward(contents) }));
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame !== false) emit(entry, tab, { event: 'navigated', url, title: contents.getTitle?.() ?? '', canGoBack: canBack(contents), canGoForward: canForward(contents) }); });
    contents.on('page-title-updated', (_e, title) => emit(entry, tab, { event: 'title', title: String(title ?? '').slice(0, 200) }));
    contents.on('did-start-loading', () => emit(entry, tab, { event: 'loading', loading: true }));
    contents.on('did-stop-loading', () => emit(entry, tab, { event: 'loading', loading: false }));
    // -3 is "aborted": the page moved on before it finished, which is not a failure.
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) emit(entry, tab, { event: 'failed', url: String(url ?? ''), code, description: String(description ?? '') });
    });
  }

  const canBack = (contents) => contents.navigationHistory?.canGoBack?.() ?? contents.canGoBack?.() ?? false;
  const canForward = (contents) => contents.navigationHistory?.canGoForward?.() ?? contents.canGoForward?.() ?? false;

  function own(sender, tab) {
    const entry = views.get(tab);
    return entry && entry.owner === sender ? entry : null;
  }

  /** Where the panel is, in the page's pixels, to window pixels inside the window's content area: whole numbers, never outside it. */
  function clamp(sender, win, rect) {
    const zoom = sender.getZoomFactor?.() ?? 1;
    const bounds = win.getContentBounds();
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const edge = (start, size, limit) => { // the part of [start, start + size] that is inside [0, limit]
      const from = Math.max(0, Math.min(Math.round(num(start) * zoom), limit));
      const to = Math.max(0, Math.min(Math.round((num(start) + Math.max(0, num(size))) * zoom), limit));
      return [from, Math.max(0, to - from)];
    };
    const [x, width] = edge(rect.x, rect.width, bounds.width);
    const [y, height] = edge(rect.y, rect.height, bounds.height);
    return { x, y, width, height };
  }

  function drop(tab) {
    const entry = views.get(tab);
    if (!entry) return;
    views.delete(tab);
    try { getWindow()?.contentView?.removeChildView?.(entry.view); } catch { /* already off */ }
    try { entry.view.webContents.close?.(); } catch { /* already closed */ }
  }

  /**
   * One command from Bunny's page. `sender` is the page's webContents (main.js has already checked it is Bunny's own page).
   * @returns {{ok: boolean, error?: string}}
   */
  function handle(sender, msg) {
    const op = String(msg?.op ?? '');
    const win = getWindow();
    if (!win) return { ok: false, error: 'No window.' };
    if (op === 'closeAll') { for (const [tab, e] of [...views]) if (e.owner === sender) drop(tab); return { ok: true }; }
    if (op === 'hideAll') { for (const e of views.values()) if (e.owner === sender) { e.visible = false; e.view.setVisible(false); } return { ok: true }; }
    const tab = String(msg?.tab ?? '');
    if (!TAB.test(tab)) return { ok: false, error: 'Not a browser tab.' };

    if (op === 'open') {
      if (views.has(tab)) return own(sender, tab) ? { ok: true } : { ok: false, error: 'That tab belongs to another page.' };
      if (views.size >= MAX_VIEWS) return { ok: false, error: 'Too many tabs are open.' };
      prepareSession();
      const view = new WebContentsView({
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true },
      });
      const entry = { view, owner: sender, visible: false };
      views.set(tab, entry);
      wire(entry, tab);
      view.setVisible(false);
      win.contentView.addChildView(view);
      // when Bunny's page goes away (window closed, or the page reloaded or went elsewhere) its views go with it: nothing is left floating over a page that cannot see it
      if (!watched.has(sender)) {
        watched.add(sender);
        const closeOwn = () => { for (const [t, e] of [...views]) if (e.owner === sender) drop(t); };
        sender.once?.('destroyed', () => { watched.delete(sender); closeOwn(); });
        sender.on?.('did-navigate', closeOwn);
      }
      if (msg.url !== undefined) {
        if (!allowedUrl(msg.url)) return { ok: false, error: 'Only http and https pages can be opened.' };
        view.webContents.loadURL(String(msg.url)).catch(() => {}); // a failure arrives as a did-fail-load event
      }
      return { ok: true };
    }

    const entry = own(sender, tab);
    if (!entry) return { ok: false, error: 'The browser tab is not open.' };
    const contents = entry.view.webContents;

    if (op === 'navigate') {
      if (!allowedUrl(msg.url)) return { ok: false, error: 'Only http and https pages can be opened.' };
      contents.loadURL(String(msg.url)).catch(() => {});
      return { ok: true };
    }
    if (op === 'rect') {
      const next = clamp(sender, win, msg.rect ?? {});
      const show = msg.visible !== false && next.width >= 4 && next.height >= 4;
      entry.view.setBounds(next);
      entry.visible = show;
      entry.view.setVisible(show);
      return { ok: true };
    }
    if (op === 'show' || op === 'hide') { entry.visible = op === 'show'; entry.view.setVisible(entry.visible); return { ok: true }; }
    if (op === 'back') { if (canBack(contents)) { if (contents.navigationHistory?.goBack) contents.navigationHistory.goBack(); else contents.goBack(); } return { ok: true }; }
    if (op === 'forward') { if (canForward(contents)) { if (contents.navigationHistory?.goForward) contents.navigationHistory.goForward(); else contents.goForward(); } return { ok: true }; }
    if (op === 'reload') { contents.reload(); return { ok: true }; }
    if (op === 'stop') { contents.stop(); return { ok: true }; }
    if (op === 'close') { drop(tab); return { ok: true }; }
    return { ok: false, error: 'Unknown command.' };
  }

  /** The model working a page: the same actions as for a frame (read, click, type, scroll, screenshot). */
  async function control(sender, tab, action, args) {
    const entry = own(sender, tab);
    if (!entry) return null; // not a view: the caller falls back to the frame
    return controlView(entry.view.webContents, tab, action, args);
  }

  return { handle, control, has: (tab) => views.has(tab), isView, ownsSession, count: () => views.size, closeAll: () => { for (const tab of [...views.keys()]) drop(tab); } };
}
