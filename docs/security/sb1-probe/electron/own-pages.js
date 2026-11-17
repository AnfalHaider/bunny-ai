// SB-1: which pages are really Bunny's own. Only these get the desktop bridge (the preload) and are believed by main's IPC checks.
// Anything else on Bunny's own address (the API, a model-written artifact at /api/artifacts/<id>/raw, ...) is only a page FROM Bunny's server, never Bunny's own page:
// it is opened without the preload and every IPC check refuses it. An allow-list of paths, never a prefix of the address.

/** The paths of Bunny's own pages: the app and the Settings pages (the Settings pages run in an iframe of the app). Kept equal to the list in preload.cjs (a test checks). */
export const OWN_PAGE_PATHS = Object.freeze([
  '/src/ui/index.html',
  '/src/ui/settings.html',
  '/src/ui/providers.html',
  '/src/ui/automation.html',
  '/src/ui/customize.html',
]);

const parse = (value) => { try { return new URL(String(value ?? '')); } catch { return null; } };

/** Is this address on Bunny's own server (same origin), whatever the path? */
export function isOwnOrigin(url, origin) {
  const u = parse(url);
  const o = parse(origin);
  return Boolean(u && o && o.origin !== 'null' && u.origin === o.origin);
}

/** Is this address one of Bunny's own pages (same origin AND an allowed path)? Dot segments and encoded dots are resolved by the address parser before the check. */
export function isOwnPage(url, origin) {
  if (!isOwnOrigin(url, origin)) return false;
  return OWN_PAGE_PATHS.includes(parse(url).pathname);
}

/**
 * May a window go to this address (will-navigate)? Anything on Bunny's own server may be LOADED (an artifact window's own first load is a navigation too);
 * everything else goes to the person's browser. This is only about loading: what a page may DO is decided by isOwnPage (IPC checks) and by having no preload.
 */
export function navigationAllowed(url, origin) {
  return isOwnOrigin(url, origin);
}

/**
 * What a window.open to this address becomes:
 *  'bunny'  Bunny's own page: a Bunny window, with the preload (pop-out chat)
 *  'plain'  a page from Bunny's own server that is not Bunny's own page (an artifact): a window with NO preload, so no bridge
 *  'web'    anything else on the web: the person's own browser
 *  'deny'   anything else
 */
export function openDecision(url, origin) {
  if (isOwnPage(url, origin)) return 'bunny';
  if (isOwnOrigin(url, origin)) return 'plain';
  return /^https?:\/\//i.test(String(url ?? '')) ? 'web' : 'deny';
}

/** The window options of each kind. `preload` is only ever given to 'bunny'; a 'plain' window is sandboxed, isolated and has no preload at all. */
export function childWindowOptions(kind, { icon, bunnyPreferences }) {
  if (kind === 'bunny') return { icon, autoHideMenuBar: true, backgroundColor: '#faf9f6', webPreferences: bunnyPreferences() };
  return {
    icon, autoHideMenuBar: true, backgroundColor: '#faf9f6',
    webPreferences: { preload: undefined, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  };
}
