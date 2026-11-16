/**
 * W27-3 / W5-7: security-relevant writes that only Bunny's own window may make.
 *
 * Every page of the app carries the launch token, so any program on this computer that can read a page (or a model that can run a command)
 * could drive the whole local API with it. In the desktop app (folderPickerOnly) these writes therefore need a second secret that only the
 * Electron main process knows: the window asks main through preload and IPC, and main makes the request. Over plain HTTP they get
 * 403 "Change this in Bunny's window." The plain-browser dev mode (no main process) keeps HTTP.
 *
 * src/ui/api.js carries a copy of these lists (the browser cannot import this file); test/window-only.test.js keeps the two equal.
 */

/** Settings keys that decide what Bunny may do without asking. */
export const WINDOW_ONLY_SETTING_KEYS = ['permissionRules', 'defaultPermissionMode'];

/** A session setting that decides the same. */
export const WINDOW_ONLY_SESSION_SETTINGS = ['permissionMode'];

/** Is this request one only the window may make? `body` is the parsed JSON body (settings writes are judged by what they change). */
export function isWindowOnlyRoute(method, path, body = null) {
  const m = String(method).toUpperCase();
  if (path === '/api/permission-rules' && m === 'PUT') return true;
  if (path === '/api/settings' && m === 'PUT') return Boolean(body) && typeof body === 'object' && WINDOW_ONLY_SETTING_KEYS.some((k) => Object.hasOwn(body, k));
  const session = /^\/api\/sessions\/[a-f0-9-]{36}\/setting\/([A-Za-z-]+)$/.exec(path);
  if (session && m === 'PATCH') return WINDOW_ONLY_SESSION_SETTINGS.includes(session[1]);
  return false;
}
