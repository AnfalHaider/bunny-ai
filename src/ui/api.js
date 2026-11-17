/** Thin client for the Bunny AI server. */

import { LOCK_MESSAGE, installRevert, lockPage, showBrowserLockNote, showNotRunning, windowOnlyLocked } from './browser-mode.js';

const refused = () => { try { document.dispatchEvent(new CustomEvent('bunny:window-only-refused')); } catch { /* no page */ } };

/** A request that fails to reach the server at all (a TypeError) in a browser means Bunny is not running: say so. */
async function reach(request) {
  try { return await request(); } catch (err) {
    if (err instanceof TypeError && !desktopBridge() && typeof document !== 'undefined' && document.body) showNotRunning(document);
    throw err;
  }
}

export async function getJSON(path) {
  const res = await reach(() => fetch(path, { headers: { accept: 'application/json' } }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? `HTTP ${res.status}`), body);
  return body;
}

// Writes that only Bunny's own window may make: a copy of src/server/windowOnly.js (the browser cannot import it; test/window-only.test.js keeps them equal).
/** Settings keys that decide what Bunny may do or where it may go. */
export const WINDOW_ONLY_SETTING_KEYS = ['permissionRules', 'defaultPermissionMode', 'aiComputerUse', 'computerUseEnabled', 'customToolsEnabled', 'allowlist', 'aliases', 'connectorsEnabled', 'plugins', 'instructions', 'skillsEnabled', 'updateUrl', 'githubClientId', 'googleClientId', 'googleClientSecret', 'googleWorkspace', 'autoContinueSteps', 'autoContinueMinutes', 'autoContinueTokens', 'scheduledContinueSteps', 'scheduledContinueMinutes', 'scheduledContinueTokens', 'maxTokens', 'helpersEnabled', 'modelFilter', 'autoUpdate', 'fallbackWhenBusy', 'quickAskEnabled', 'quickAskShortcut'];

/** A session setting that decides the same. */
export const WINDOW_ONLY_SESSION_SETTINGS = ['permissionMode'];

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
const UUID = '[a-f0-9-]{36}';
/** Routes that are window-only whatever their body says: [methods, path pattern]. */
export const WINDOW_ONLY_ROUTES = [
  [WRITES, `^/api/mcp(/${UUID}(/call)?)?$`],                // connectors: add, enable, change, remove, call
  [WRITES, `^/api/connectors(/.*)?$`],                      // connector sign-in (W3-6)
  [WRITES, `^/api/schedules(/${UUID})?$`],                  // schedules
  [WRITES, `^/api/hooks(/${UUID})?$`],                      // hooks run commands
  [WRITES, `^/api/skills(/${UUID})?$`],                     // skills are instructions the model follows
  [['POST'], '^/api/plugins/install$'],
  [['POST'], '^/api/plugins$'],                            // a plugin from the catalog or a file (W4-10)
  [['POST'], `^/api/plugins/${UUID}/update$`],             // update a plugin from its source (W4-11 P-4)
  [['DELETE', 'PATCH'], `^/api/plugins/${UUID}$`],         // uninstall a plugin (W4-10), switch one on or off as a whole (W4-11 P-5)
  [['DELETE'], '^/api/tools/[a-z][a-z0-9_]{1,39}$'],        // custom tools
  [['POST'], `^/api/sessions/${UUID}/permission/${UUID}$`], // answering a permission prompt
  [['POST'], `^/api/sessions/${UUID}/capability/${UUID}$`], // answering a capability prompt (computer use, building tools)
  [['POST'], `^/api/sessions/${UUID}/question/${UUID}$`],   // answering a question card ("Keep going?")
  [['POST'], '^/api/computer/.*$'],                         // driving the computer
  [['POST'], '^/api/terminal/(create|write|resize|kill)$'], // a terminal runs commands
  [['POST'], '^/api/providers/custom$'],                    // where model traffic goes
  [['DELETE'], '^/api/providers/custom-[a-z0-9-]+$'],
  [['POST'], '^/api/providers/[a-z0-9-]+/(connect|disconnect)$'],
  [WRITES, '^/api/account/(github|google)(/.*)?$'],         // sign-ins and sign-outs
  [['POST'], '^/api/oauth/[a-z0-9-]+/(start|finish)$'],     // provider sign-in
  [WRITES, '^/api/remote(/.*)?$'],                          // BROWSER step 2: opening Bunny to other devices, and ending their sessions
];

/** Is this request one only the window may make? `body` is the parsed JSON body (some writes are judged by what they change). */
export function isWindowOnlyRoute(method, path, body = null) {
  const m = String(method).toUpperCase();
  if (WINDOW_ONLY_ROUTES.some(([methods, re]) => methods.includes(m) && new RegExp(re).test(path))) return true;
  const has = (...keys) => Boolean(body) && typeof body === 'object' && keys.some((k) => Object.hasOwn(body, k));
  if (path === '/api/permission-rules' && m === 'PUT') return true;
  if (path === '/api/settings' && m === 'PUT') return has(...WINDOW_ONLY_SETTING_KEYS);
  if (path === '/api/sessions' && m === 'POST') return has('permissionMode');
  if (new RegExp(`^/api/sessions/${UUID}$`).test(path) && m === 'PATCH') return has('permissionMode');
  // a project's instructions steer the model in every chat that uses it
  if (path === '/api/projects' && m === 'POST') return has('instructions');
  if (new RegExp(`^/api/projects/${UUID}$`).test(path) && m === 'PATCH') return has('instructions');
  const session = new RegExp(`^/api/sessions/${UUID}/setting/([A-Za-z-]+)$`).exec(path);
  if (session && m === 'PATCH') return WINDOW_ONLY_SESSION_SETTINGS.includes(session[1]);
  return false;
}

/**
 * The desktop bridge (window.bunnyDesktop) as THIS page can reach it. Electron's preload exposes it to the main frame only, and the Settings pages (customize,
 * providers, automation, settings) run in an iframe of that frame, so there it is the parent's. The parent is used only when it is the SAME origin (Bunny's own page);
 * a frame from anywhere else, or a parent that cannot be read, gets no bridge and its writes go over plain HTTP, where the server refuses window-only ones.
 * Main-side checks (the sender frame must be a Bunny page, the route must be window-only) are untouched.
 */
export function desktopBridge(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  if (win.bunnyDesktop) return win.bunnyDesktop;
  try {
    const parent = win.parent;
    if (parent && parent !== win && parent.location.origin === win.location.origin) return parent.bunnyDesktop ?? null;
  } catch { /* a parent from another origin cannot be read: no bridge */ }
  return null;
}

export async function sendJSON(path, method, body) {
  // In the desktop app those writes go to the main process (preload and IPC), which makes the request; in a plain browser they go over HTTP.
  const desk = desktopBridge();
  // BROWSER: no bridge and the server keeps window-only changes to the window: say so at once, in the server's own words (the server would answer the same)
  if (!desk && isWindowOnlyRoute(method, path, body) && (await windowOnlyLocked())) { refused(); throw Object.assign(new Error(LOCK_MESSAGE), { code: 'window.only', message: LOCK_MESSAGE }); }
  if (desk?.secureWrite && isWindowOnlyRoute(method, path, body)) {
    const r = await desk.secureWrite(method, path, body ?? {});
    if (r.status >= 400) throw Object.assign(new Error(r.data?.message ?? `HTTP ${r.status}`), r.data);
    return r.data;
  }
  const res = await reach(() => fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (data.code === 'request.windowOnly') refused(); throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), data); }
  return data;
}

// BROWSER: a Settings page opened in a browser (no bridge) on a server that locks window-only changes says so at the top.
if (typeof document !== 'undefined' && document.body && /\/src\/ui\/(settings|customize|providers|automation|index)\.html$/.test(globalThis.location?.pathname ?? '')) {
  windowOnlyLocked().then((on) => {
    if (!on || desktopBridge()) return;
    if (!/index\.html$/.test(location.pathname)) showBrowserLockNote(document);
    installRevert(document);
    lockPage(document, location.pathname, WINDOW_ONLY_SETTING_KEYS);
  }).catch(() => {});
}

/**
 * POST and consume a server-sent token stream.
 *
 * Both the stored-chat route and the incognito one-shot speak the same stream,
 * so there is one reader rather than two that can drift apart.
 *
 * @param {string} path
 * @param {object} body
 * @param {{onDelta?: (t: string) => void, onDone?: (d: any) => void, onError?: (e: any) => void, onCompacted?: (d: any) => void, signal?: AbortSignal}} handlers
 */
export async function streamAt(path, body, handlers = {}) {
  const { onDelta, onDone, onError, onCompacted, signal } = handlers;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    onError?.(data);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'delta') onDelta?.(parsed.text ?? '');
      else if (event === 'done') onDone?.(parsed);
      else if (event === 'error') onError?.(parsed);
      else if (event === 'compacted') onCompacted?.(parsed);
      else if (event === 'working') handlers.onWorking?.(parsed);
      else if (event === 'tool') handlers.onTool?.(parsed);
      else if (event === 'permission') handlers.onPermission?.(parsed);
      else if (event === 'browser') handlers.onBrowser?.(parsed);
      else if (event === 'capability') handlers.onCapability?.(parsed);
      else if (event === 'notice') handlers.onNotice?.(parsed);
      else if (event === 'tasks') handlers.onTasks?.(parsed);
      else if (event === 'thinking') handlers.onThinking?.(parsed);
      else if (event === 'question') handlers.onQuestion?.(parsed);
      else if (event === 'waiting') handlers.onWaiting?.(parsed);
      else if (event === 'newChat') handlers.onNewChat?.(parsed);
    }
  }
}

/** A message in a stored conversation. */
export function streamMessage(sessionId, body, handlers) {
  return streamAt(`/api/sessions/${sessionId}/messages`, body, handlers);
}

/** A one-shot completion that is never written to disk (incognito). */
export function streamComplete(body, handlers) {
  return streamAt('/api/complete', body, handlers);
}

/** Computer use operations. */
export async function computerScreenshot(sessionId) {
  return sendJSON('/api/computer/screenshot', 'POST', { sessionId });
}
export async function computerClick(sessionId, x, y, button = 'left', count = 1) {
  return sendJSON('/api/computer/click', 'POST', { sessionId, x, y, button, count });
}
export async function computerType(sessionId, text) {
  return sendJSON('/api/computer/type', 'POST', { sessionId, text });
}
export async function computerKey(sessionId, keys) {
  return sendJSON('/api/computer/key', 'POST', { sessionId, keys });
}
export async function computerWait(sessionId, ms) {
  return sendJSON('/api/computer/wait', 'POST', { sessionId, ms });
}
export async function computerReset(sessionId) {
  return sendJSON('/api/computer/reset', 'POST', { sessionId });
}

/** Terminal operations. */
export async function terminalCreate({ shell = 'powershell.exe', cwd, rows = 40, cols = 120 } = {}) {
  return sendJSON('/api/terminal/create', 'POST', { shell, cwd, rows, cols });
}
export async function terminalWrite(id, text) {
  return sendJSON('/api/terminal/write', 'POST', { id, text });
}
export async function terminalRead(id) {
  return getJSON(`/api/terminal/read?id=${encodeURIComponent(id)}`);
}
export async function terminalResize(id, rows, cols) {
  return sendJSON('/api/terminal/resize', 'POST', { id, rows, cols });
}
export async function terminalKill(id) {
  return sendJSON('/api/terminal/kill', 'POST', { id });
}
export async function terminalList() {
  return getJSON('/api/terminal/list');
}

/** Session setting (folder, branch, permissionMode, effort). */
export async function sessionSetting(sessionId, name, value) {
  return sendJSON(`/api/sessions/${sessionId}/setting/${name}`, 'PATCH', { value });
}

/** Model ability labels. */
export async function fetchAbilities() {
  return getJSON('/api/abilities');
}

/** Escape text for safe insertion into HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Apply a saved theme. Anything other than light or dark clears the override so
 * the stylesheet's prefers-color-scheme rules decide.
 */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark' ? theme : '';
}

// ---------------------------------------------------------------------------
// Appearance: fonts, transcript size and width, motion, and the colours of code.

const FONTS = {
  system: null,
  serif: 'Georgia, "Cambria", "Times New Roman", serif',
  sans: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, monospace',
};
const SIZES = { small: '13px', medium: null, large: '16px', xlarge: '18px' };
const WIDTHS = { narrow: null, medium: '880px', wide: '1080px', full: 'none' };

/** Code colours. Each: background, text, then the token kinds highlight.js marks. */
export const CODE_THEMES = {
  'bunny-light': { label: 'Bunny Light', dark: false, bg: '#f4f3f1', text: '#1f2023', keyword: '#7c4dcc', string: '#1f8a5b', number: '#b5560f', comment: '#8a8e96', type: '#2f6fb8', literal: '#b5560f', tag: '#c03a5b', attr: '#8a6a12' },
  'github-light': { label: 'GitHub Light', dark: false, bg: '#f6f8fa', text: '#1f2328', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', type: '#8250df', literal: '#0550ae', tag: '#116329', attr: '#953800' },
  'solarized-light': { label: 'Solarized Light', dark: false, bg: '#fdf6e3', text: '#586e75', keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#93a1a1', type: '#b58900', literal: '#cb4b16', tag: '#268bd2', attr: '#b58900' },
  'carrot-light': { label: 'Carrot Patch', dark: false, bg: '#fff7f0', text: '#3b2a20', keyword: '#d4537e', string: '#3b6d11', number: '#c2410c', comment: '#a08b7d', type: '#7c4dcc', literal: '#c2410c', tag: '#d4537e', attr: '#9a6b00' },
  'bunny-dark': { label: 'Bunny Dark', dark: true, bg: '#1f2023', text: '#ececee', keyword: '#c4b5ff', string: '#7fdcae', number: '#f2b37a', comment: '#7d818a', type: '#8cc3ff', literal: '#f2b37a', tag: '#f59ab0', attr: '#e6c66e' },
  'one-dark': { label: 'One Dark', dark: true, bg: '#282c34', text: '#abb2bf', keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370', type: '#e5c07b', literal: '#d19a66', tag: '#e06c75', attr: '#d19a66' },
  dracula: { label: 'Dracula', dark: true, bg: '#282a36', text: '#f8f8f2', keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', type: '#8be9fd', literal: '#bd93f9', tag: '#ff79c6', attr: '#50fa7b' },
  'midnight-bunny': { label: 'Midnight Bunny', dark: true, bg: '#17131c', text: '#e9e3f0', keyword: '#ed93b1', string: '#9fe1cb', number: '#fac775', comment: '#6f6680', type: '#afa9ec', literal: '#fac775', tag: '#ed93b1', attr: '#f0997b' },
};
const TOKENS = ['keyword', 'string', 'number', 'comment', 'type', 'literal', 'tag', 'attr'];

/** The CSS variables for one code theme: used on the page, and on the previews in Settings. */
export function codeThemeVars(id, dark) {
  const t = CODE_THEMES[id] ?? CODE_THEMES[dark ? 'bunny-dark' : 'bunny-light'];
  const vars = { '--code-bg': t.bg, '--code-text': t.text };
  for (const k of TOKENS) vars[`--tk-${k}`] = t[k];
  return vars;
}

let lastAppearance = {};
const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
};

/** Apply every appearance setting to this page. Safe to call again whenever settings change. */
export function applyAppearance(settings = {}) {
  lastAppearance = settings;
  applyTheme(settings.theme ?? 'system');
  const root = document.documentElement;
  const set = (name, value) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
  set('--font-sans', FONTS[settings.interfaceFont] ?? null);
  const reply = settings.responseFont && settings.responseFont !== 'match' ? FONTS[settings.responseFont] : null;
  set('--font-reply', reply);
  set('--fs-transcript', SIZES[settings.transcriptSize] ?? null);
  set('--thread-max', WIDTHS[settings.transcriptWidth] ?? null);
  root.dataset.motion = settings.motion === 'reduced' || settings.motion === 'full' ? settings.motion : '';
  const font = String(settings.codeFont ?? '').replace(/["';{}<>]/g, '').trim();
  set('--font-mono', font ? `"${font}", ui-monospace, "Cascadia Code", Consolas, monospace` : null);
  const size = Number(settings.codeFontSize);
  set('--fs-code', size >= 10 && size <= 24 ? `${size}px` : null);
  const dark = isDark();
  // Bunny's own code colours are the stylesheet's; another theme overrides them.
  const id = dark ? settings.codeThemeDark : settings.codeThemeLight;
  const custom = Boolean(CODE_THEMES[id]) && !String(id).startsWith('bunny-');
  for (const [name, value] of Object.entries(codeThemeVars(id, dark))) set(name, custom ? value : null);
}

// Following the system theme: the code colours switch with it.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyAppearance(lastAppearance));
