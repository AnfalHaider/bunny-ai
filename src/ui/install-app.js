// Installing Bunny as an app (Design's drawing, approved 2026-11-18) and updating it without a silent switch.
//  - The browser decides whether it offers an install (the beforeinstallprompt event, which only the TOP page of a tab receives). The top page keeps it, and the Settings page
//    (in a frame of it, or on its own) reads it from there.
//  - An update waits: when a new service worker is ready the person is shown "Update ready · Reload"; nothing replaces the page under them.

export const NETWORK_LINE = 'On other devices over the network, browsers allow only a home-screen shortcut, unless Bunny has HTTPS.';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const isLocalHost = (host) => LOCAL.has(String(host ?? '').toLowerCase());

/**
 * Which state the "Install as an app" row is in:
 *  'window'    Bunny's own window (the desktop app): no row, only a pointer line
 *  'network'   opened over the network (not this computer): a shortcut at most, Install off
 *  'installed' already installed, or this is the installed window
 *  'ready'     the browser offered an install: the Install button works
 *  'none'      this browser does not offer to install from here
 */
export function installRowState({ bridge = false, host = '127.0.0.1', installed = false, hasPrompt = false } = {}) {
  if (bridge) return 'window';
  if (!isLocalHost(host)) return 'network';
  if (installed) return 'installed';
  return hasPrompt ? 'ready' : 'none';
}

/** The words of each state (the drawing's), and whether the Install button is on. */
export function installRowText(state) {
  const text = {
    window: { title: 'Open in your browser', body: 'To install it as an app, open it in your browser and use Install as an app in Settings there.', button: null },
    ready: { title: 'Install as an app', body: 'Installs Bunny as its own window on this computer, with an icon in the Start menu and the taskbar. It still runs only while Bunny is running.', button: 'Install' },
    installed: { title: 'Install as an app', body: 'Bunny is installed on this computer. Open it from the Start menu. To remove it, use your browser\'s menu: Apps, then Uninstall.', button: 'Installed', badge: 'Installed' },
    none: { title: 'Install as an app', body: 'This browser does not offer to install apps from here. Chrome and Edge do. Open Bunny in one of them to install it.', button: 'Install' },
    network: { title: 'Install as an app', body: 'You opened Bunny over the network, where browsers allow only a shortcut. In your browser\'s menu choose Add to Home Screen; it will open Bunny in a browser tab. A full install needs HTTPS.', button: 'Install' },
  }[state];
  return { ...text, enabled: state === 'ready', network: NETWORK_LINE }; // the network line shows in every state
}

/** The top page of a tab: keep the browser's install offer for the Settings page, and remember that the app was installed. */
export function watchInstall(win = globalThis.window) {
  if (!win || win.__bunnyInstall) return;
  const state = { prompt: null, installed: false, listeners: new Set() };
  const tell = () => { for (const fn of state.listeners) { try { fn(); } catch { /* a listener's own problem */ } } };
  try { state.installed = win.localStorage?.getItem('bunny.installed') === '1'; } catch { /* private window */ }
  try { if (win.matchMedia?.('(display-mode: standalone)').matches) state.installed = true; } catch { /* no media query */ }
  win.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.prompt = event; tell(); }); // the page decides when to ask, not the browser's mini-bar
  win.addEventListener('appinstalled', () => { state.installed = true; state.prompt = null; try { win.localStorage?.setItem('bunny.installed', '1'); } catch { /* private window */ } tell(); });
  win.__bunnyInstall = state;
}

/** The install state a page can see: its own, or its parent's (Settings runs in a frame of the app page). */
export function installContext(win = globalThis.window) {
  try { if (win.parent && win.parent !== win && win.parent.location.origin === win.location.origin && win.parent.__bunnyInstall) return win.parent.__bunnyInstall; } catch { /* a parent from another origin */ }
  if (!win.__bunnyInstall) watchInstall(win);
  return win.__bunnyInstall;
}

/** Ask the browser to install. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function runInstall(ctx) {
  const prompt = ctx?.prompt;
  if (!prompt) return 'unavailable';
  ctx.prompt = null; // an install offer can be used once
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { return 'unavailable'; }
}

/**
 * A new service worker WAITS. When one is ready (and an older one is in charge, so this is an update and not the first install) `onReady(apply)` is called;
 * `apply()` tells it to take over and the page reloads once it has. Nothing happens until then.
 */
export function watchUpdates(registration, onReady, { serviceWorker = globalThis.navigator?.serviceWorker, reload = () => globalThis.location.reload() } = {}) {
  if (!registration || !serviceWorker) return;
  let reloading = false;
  const apply = (worker) => () => {
    serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; reload(); });
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
  const ready = (worker) => { if (serviceWorker.controller) onReady(apply(worker)); };
  if (registration.waiting) ready(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => { if (worker.state === 'installed') ready(worker); });
  });
}

/** The small "Update ready · Reload" line, a thin line under the top bar so it never covers the composer or its controls. Built from text; the person decides. */
export function showUpdateBar(doc, apply) {
  if (!doc || doc.getElementById('update-ready')) return null;
  const bar = doc.createElement('div');
  bar.id = 'update-ready';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(var(--topbar-h, 56px) + env(safe-area-inset-top, 0px) + 6px);z-index:2147482000;display:flex;gap:12px;align-items:center;padding:4px 12px;border:1px solid var(--line,#e6e2da);border-radius:999px;background:var(--surface,#fff);color:var(--text,#1f2023);font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18)';
  const text = doc.createElement('span');
  text.textContent = 'Update ready';
  const dot = doc.createElement('span');
  dot.textContent = '·';
  const reload = doc.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.style.cssText = 'font:inherit;font-weight:600;color:var(--accent,#6a4fd8);background:transparent;border:0;cursor:pointer;padding:0';
  reload.addEventListener('click', () => { reload.disabled = true; apply(); });
  bar.append(text, dot, reload);
  doc.body.append(bar);
  return bar;
}
