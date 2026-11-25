// W6-24: the browser panel's tabs as real browser views (Electron WebContentsView) laid over the panel, instead of iframes.
//
// Why: a site in an iframe can refuse to be framed, frame-bust, and loses its sign-in (third-party cookies in a frame are blocked).
// A view is a top-level page: it loads like a browser tab, and keeps its cookies in a partition of its own, `persist:bunny-browser`,
// which Bunny's own pages never share (and the reverse).
//
// What a view is allowed to be (Security's rules, 2026-11-17):
//  - sandboxed, no Node, no preload, no webview tag; web security on; dialogs are the safe kind;
//  - it can load only http(s) pages, and never Bunny's own server (its port on this PC): not by address, not by redirect, not by window.open,
//    and no request from a panel page may reach that port (the partition cancels it, for every kind of request);
//  - a link that wants a new window becomes a new tab in the panel, never a new app window;
//  - it asks for nothing (camera, location, devices...) and is told no; a download is stopped and the panel says so;
//  - only Bunny's own page, in a Bunny window, may command a view, and only the views that page opened.
import { controlView } from './browserAgent.js';
import { pixelDifference, fitBitmap, sideBySide, describeScore } from './pageCompare.js';
import { isBunnyOwn } from '../src/server/ownAddress.js';
import { isLocalHost } from '../src/server/capture.js';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isPrivateAddress } from '../src/server/download.js';

/** A page on this computer or a private network (an address, localhost, or a name that only a network inside a building answers to). */
/**
 * W6-11 (Security LOW): the host TEXT is not enough (192.168.1.1.nip.io is a public name that answers with a private address). A name is resolved and every address it gives is checked,
 * so the check is on what the window would connect to. (A name that changes its answer between this check and the connection is the one case left; the windows have no cookies
 * and no storage, and see only what they fetch.)
 */
export async function isLanAddressResolved(url, resolve = (host) => lookup(host, { all: true })) {
  if (isLanAddress(url)) return true;
  try {
    const host = new URL(String(url)).hostname.replace(/^\[|\]$/g, '');
    if (/^[0-9.]+$/.test(host) || host.includes(':')) return false; // an address, already judged above
    const answers = await resolve(host);
    return answers.length === 0 || answers.some((a) => isPrivateAddress(a.address));
  } catch { return true; } // a name that cannot be resolved is not fetched
}
export const isLanAddress = (url) => {
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return isLocalHost(host) || /[.](local|lan|internal|home|corp|intranet|localdomain)$/.test(host) || (!host.includes('.') && !host.includes(':'));
  } catch { return true; }
};

export const PARTITION = 'persist:bunny-browser';
const TAB = /^bunny-tab-\d+$/;
const MAX_VIEWS = 12;
const ISOLATED_WORLD = 1999; // the page cannot redefine the functions the model's actions use

/** Only http and https may be loaded or navigated to: never file:, javascript:, data:, blob:, chrome:, devtools:, view-source: ... */
export function allowedUrl(value) {
  try { const u = new URL(String(value)); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; }
}

// One definition of Bunny's own server for the app and the panel (src/server/ownAddress.js).
export { isBunnyOwn };

/** A page of the panel may be loaded as a page: http(s), and not Bunny itself. */
export const loadable = (url, ownPort) => allowedUrl(url) && !isBunnyOwn(url, ownPort);

/**
 * May this request leave a panel page? Pages need http(s) and websockets, and small inline things (data: and blob: images, fonts...);
 * a TOP-LEVEL page or frame must be http(s). Nothing may reach Bunny's own port, and nothing may be file:, chrome:, devtools:, view-source: ...
 */
export function requestAllowed({ url, resourceType }, ownPort) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (isBunnyOwn(url, ownPort)) return false;
  const isPage = resourceType === 'mainFrame' || resourceType === 'subFrame';
  if (isPage) return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  return ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(u.protocol);
}

/**
 * Is this IPC message from Bunny's own page, in a Bunny window? (The panel's own views are never allowed to command anything.)
 * @param {{sender: object, senderFrame?: object}} event
 * @param {(url: string) => boolean} isOwn
 * @param {(sender: object) => object | null} windowOf  the Bunny window that has this page as its own web contents, or null
 */
export function senderAllowed(event, isOwn, windowOf) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !frame) return false;
  if (!windowOf(sender)) return false; // not the page of a Bunny window (a view, a pop-up, anything else)
  if (frame !== sender.mainFrame) return false; // not a frame inside the page
  return isOwn(String(frame.url ?? ''));
}

/**
 * @param {object} o
 * @param {Function} o.WebContentsView  Electron's class (a fake in tests)
 * @param {object} o.session            Electron's session module (fromPartition)
 * @param {(sender: object) => object | null} o.getWindow  the Bunny window of a page (has contentView, getContentBounds)
 * @param {() => string | number | null} o.getOwnPort  the port of Bunny's own server
 */
export function createBrowserViews({ WebContentsView, session, getWindow, getOwnPort = () => null, siteAllows = () => true, BrowserWindow = null, nativeImage = null, resolveName = (host) => lookup(host, { all: true }) }) {
  const views = new Map(); // tab name -> { view, owner, window, visible }
  const watched = new WeakSet(); // pages already watched for leaving
  let partitionReady = false;
  const ownPort = () => String(getOwnPort() ?? '');

  function prepareSession() {
    if (partitionReady) return;
    const ses = session.fromPartition(PARTITION);
    // The page asks for nothing: no camera, microphone, location, notifications, clipboard, MIDI, devices, screen capture...
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    for (const picker of ['select-hid-device', 'select-serial-port', 'select-usb-device']) {
      ses.on?.(picker, (event, _details, callback) => { event.preventDefault?.(); callback?.(''); });
    }
    // Every request of a panel page: only what a page may fetch, and never Bunny's own server.
    // PG1-c: and the person's website rules, for EVERY request (frames, scripts, fetch and XHR, images), not only the address the tab was sent to.
    ses.webRequest?.onBeforeRequest((details, callback) => callback({ cancel: !requestAllowed(details, ownPort()) || !siteAllows(details) }));
    // No silent downloads: stopped, and the panel says so (the model can use download_file).
    ses.on?.('will-download', (event, item, contents) => {
      event.preventDefault?.();
      try { item.cancel?.(); } catch { /* nothing to cancel */ }
      const entry = [...views.entries()].find(([, e]) => e.view.webContents === contents);
      if (entry) emit(entry[1], entry[0], { event: 'download-blocked', filename: String(item?.getFilename?.() ?? '').slice(0, 120) });
    });
    partitionReady = true;
  }

  const isView = (contents) => [...views.values()].some((e) => e.view.webContents === contents);
  /** main.js's own guard must not run on these pages (it sends every link to the person's browser). */
  const ownsSession = (ses) => Boolean(ses) && ses === session.fromPartition(PARTITION);

  function emit(entry, tab, payload) {
    try { if (!entry.owner.isDestroyed?.()) entry.owner.send('browser:view-event', { tab, ...payload }); } catch { /* the window is gone */ }
  }

  const canBack = (contents) => contents.navigationHistory?.canGoBack?.() ?? contents.canGoBack?.() ?? false;
  const canForward = (contents) => contents.navigationHistory?.canGoForward?.() ?? contents.canGoForward?.() ?? false;

  function wire(entry, tab) {
    const contents = entry.view.webContents;
    // A page that wants a new window gets a new tab in the panel (when the address is fine), never a new app window.
    contents.setWindowOpenHandler(({ url }) => {
      if (loadable(url, ownPort())) emit(entry, tab, { event: 'new-tab', url });
      return { action: 'deny' };
    });
    const guardNavigation = (event, url) => { if (!loadable(url, ownPort())) event.preventDefault(); };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.on('will-frame-navigate', guardNavigation);
    // a page may not lock the panel with "are you sure you want to leave": the leave goes ahead
    contents.on('will-prevent-unload', (event) => event.preventDefault());
    const navigated = (url) => emit(entry, tab, { event: 'navigated', url, title: contents.getTitle?.() ?? '', canGoBack: canBack(contents), canGoForward: canForward(contents) });
    contents.on('did-navigate', (_e, url) => navigated(url));
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame !== false) navigated(url); });
    contents.on('page-title-updated', (_e, title) => emit(entry, tab, { event: 'title', title: String(title ?? '').slice(0, 200) }));
    contents.on('did-start-loading', () => emit(entry, tab, { event: 'loading', loading: true }));
    contents.on('did-stop-loading', () => emit(entry, tab, { event: 'loading', loading: false }));
    // -3 is "aborted": the page moved on before it finished, which is not a failure.
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) emit(entry, tab, { event: 'failed', url: String(url ?? ''), code, description: String(description ?? '') });
    });
    contents.on('select-bluetooth-device', (event, _devices, callback) => { event.preventDefault?.(); callback?.(''); });
  }

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
    try { entry.window?.contentView?.removeChildView?.(entry.view); } catch { /* already off */ }
    try { entry.view.webContents.close?.(); } catch { /* already closed */ }
  }

  /**
   * One command from Bunny's page. `sender` is the page's webContents (main.js has already checked it is Bunny's own page in a Bunny window).
   * @returns {{ok: boolean, error?: string}}
   */
  function handle(sender, msg) {
    const op = String(msg?.op ?? '');
    const win = getWindow(sender);
    if (!win) return { ok: false, error: 'No window.' };
    if (op === 'closeAll') { for (const [tab, e] of [...views]) if (e.owner === sender) drop(tab); return { ok: true }; }
    if (op === 'hideAll') { for (const e of views.values()) if (e.owner === sender) { e.visible = false; e.view.setVisible(false); } return { ok: true }; }
    const tab = String(msg?.tab ?? '');
    if (!TAB.test(tab)) return { ok: false, error: 'Not a browser tab.' };

    if (op === 'open') {
      if (views.has(tab)) return own(sender, tab) ? { ok: true } : { ok: false, error: 'That tab belongs to another page.' };
      if (views.size >= MAX_VIEWS) return { ok: false, error: 'Too many tabs are open.' };
      if (msg.url !== undefined && !loadable(msg.url, ownPort())) return { ok: false, reason: isBunnyOwn(msg.url, ownPort()) ? 'own' : 'scheme', error: 'Only http and https pages can be opened, and not Bunny AI itself.' };
      prepareSession();
      const view = new WebContentsView({
        webPreferences: {
          partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
          webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, safeDialogs: true, spellcheck: true,
        },
      });
      const entry = { view, owner: sender, window: win, visible: false };
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
      if (msg.url !== undefined) view.webContents.loadURL(String(msg.url)).catch(() => {}); // a failure arrives as a did-fail-load event
      return { ok: true };
    }

    const entry = own(sender, tab);
    if (!entry) return { ok: false, error: 'The browser tab is not open.' };
    const contents = entry.view.webContents;

    if (op === 'navigate') {
      if (!loadable(msg.url, ownPort())) return { ok: false, reason: isBunnyOwn(msg.url, ownPort()) ? 'own' : 'scheme', error: 'Only http and https pages can be opened, and not Bunny AI itself.' };
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

  /** The model working a page: the same actions as for a frame (read, click, type, scroll, screenshot), run in a world of their own. */
  async function control(sender, tab, action, args) {
    const entry = own(sender, tab);
    if (!entry) return null; // not a view: the caller falls back to the frame
    return controlView(entry.view.webContents, tab, action, args, ISOLATED_WORLD);
  }

  /**
   * W6-11: compare two pages as pictures. Each address is opened in a hidden, off-screen window of the panel's own partition (same request rules as a tab: http(s) only, never Bunny itself),
   * photographed at each width at the same height, and the two pictures are compared pixel by pixel. Needs the Electron classes (a fake in tests).
   * @returns {Promise<{note?: string, image?: string, images?: string[], error?: string}>}
   */
  async function compare(sender, { a, b, widths } = {}) {
    if (!BrowserWindow || !nativeImage) return { error: 'Comparing pages needs the desktop app.' };
    for (const [label, url] of [['first', a], ['second', b]]) {
      if (!loadable(url, ownPort())) return { error: `The ${label} address must be an http or https page, and not Bunny AI itself.` };
    }
    const list = (Array.isArray(widths) && widths.length ? widths : [1280, 390]).map(Number).filter((w) => Number.isFinite(w) && w >= 320 && w <= 1920).slice(0, 3);
    if (!list.length) return { error: 'widths must be between 320 and 1920 pixels.' };
    // W6-11 (Security): the hidden windows share nothing with the panel: a fresh partition in memory (no cookies, no storage, gone with the comparison), and a page on this
    // computer or a private network is refused unless the panel already has that very page open (the person has seen it).
    const openHosts = new Set([...views.values()].filter((e) => e.owner === sender).map((e) => { try { return new URL(e.view.webContents.getURL()).host.toLowerCase(); } catch { return ''; } }));
    for (const [label, url] of [['first', a], ['second', b]]) {
      if ((await isLanAddressResolved(url, resolveName)) && !openHosts.has(new URL(String(url)).host.toLowerCase())) return { error: `The ${label} address is on this computer or a private network. Open that page in the browser panel first (then it can be compared), or compare pages on the internet.` };
    }
    const partition = `bunny-compare-${randomUUID()}`; // no "persist:" prefix: in memory only
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest?.onBeforeRequest(async (details, callback) => {
      let host = '';
      try { host = new URL(details.url).host.toLowerCase(); } catch { /* refused below */ }
      if (!requestAllowed(details, ownPort()) || !siteAllows(details)) { callback({ cancel: true }); return; }
      const lan = isLanAddress(details.url) || (/^https?:/i.test(details.url) && (await isLanAddressResolved(details.url, resolveName)));
      callback({ cancel: lan && !openHosts.has(host) });
    });
    const HEIGHT = 800;
    const shoot = async (url, width) => {
      const win = new BrowserWindow({
        show: false, width, height: HEIGHT, useContentSize: true, frame: false, skipTaskbar: true, focusable: false,
        webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, safeDialogs: true, offscreen: true },
      });
      try {
        const contents = win.webContents;
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const guard = (event, target) => { if (!loadable(target, ownPort())) event.preventDefault(); };
        contents.on('will-navigate', guard);
        contents.on('will-redirect', guard);
        await Promise.race([
          new Promise((resolve, reject) => { contents.once('did-fail-load', (_e, code, description, _url, isMain) => { if (isMain !== false && code !== -3) reject(new Error(`Could not load ${url}: ${description}`)); }); contents.loadURL(String(url)).then(resolve, () => {}); }),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`${url} took more than 25 seconds to load.`)), 25_000)),
        ]);
        await new Promise((r) => setTimeout(r, 700)); // late scripts and pictures
        const image = (await contents.capturePage()).resize({ width, height: HEIGHT });
        return Buffer.from(image.toBitmap());
      } finally { try { win.destroy(); } catch { /* already gone */ } }
    };
    const lines = [`Compared ${a} with ${b}.`];
    const images = [];
    try {
      for (const width of list) {
        const first = await shoot(a, width);
        const second = await shoot(b, width);
        const diff = pixelDifference(fitBitmap(first, width, HEIGHT, width, HEIGHT), fitBitmap(second, width, HEIGHT, width, HEIGHT), width, HEIGHT);
        lines.push(describeScore(width, diff.score));
        const side = sideBySide(first, second, diff.mask, width, HEIGHT);
        let picture = nativeImage.createFromBitmap(side.bitmap, { width: side.width, height: side.height });
        if (side.width > 1600) picture = picture.resize({ width: 1600 });
        images.push(picture.toDataURL());
      }
    } catch (err) { return { error: String(err?.message ?? err) }; } finally { try { await ses.clearStorageData?.(); } catch { /* nothing kept */ } }
    lines.push('The picture shows the first page, the second page, and where they differ (red).');
    return { note: lines.join('\n'), image: images[0], images };
  }

  return { handle, control, compare, has: (tab) => views.has(tab), isView, ownsSession, count: () => views.size, closeAll: () => { for (const tab of [...views.keys()]) drop(tab); } };
}
