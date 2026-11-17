// BROWSER step 1: what a page does when it is open in the person's own browser (no desktop bridge) instead of Bunny's window.
//  - Controls that change what Bunny may do or run stay locked, with the one sentence the server also answers: "Change this in Bunny's window."
//  - If Bunny is not running any more, the page says so plainly (and comes back by itself when Bunny does) instead of showing broken screens.
// The server's own lock is the real control; this only says so early and kindly.

export const LOCK_MESSAGE = "Change this in Bunny's window.";
export const NOT_RUNNING_TITLE = 'Bunny is not running';
export const NOT_RUNNING_TEXT = 'Bunny runs on this computer and has been closed. Open Bunny again (or turn on Keep running in the tray in Settings, under Desktop app, so closing the window does not stop it). This page comes back by itself.';

let locked = null;
/** Does this server keep window-only changes to Bunny's own window? (/api/health says so.) Asked once. */
export async function windowOnlyLocked(fetchImpl = globalThis.fetch) {
  if (locked !== null) return locked;
  try {
    const res = await fetchImpl('/api/health', { headers: { accept: 'application/json' } });
    const body = await res.json();
    locked = Boolean(body?.windowOnlyLock);
  } catch {
    return false; // not known (not asked again for a moment): not locked here, the server still decides
  }
  return locked;
}
export const resetBrowserMode = () => { locked = null; };

/** The "Bunny is not running" page, built from text only. Returns the element (also appended to the document). */
export function showNotRunning(doc = globalThis.document, { check = () => globalThis.fetch('/api/health').then((r) => r.ok), reload = () => globalThis.location.reload(), everyMs = 3000 } = {}) {
  if (!doc) return null;
  const existing = doc.getElementById('bunny-not-running');
  if (existing) return existing;
  const wrap = doc.createElement('div');
  wrap.id = 'bunny-not-running';
  wrap.setAttribute('role', 'alert');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:var(--bg,#faf9f6);color:var(--text,#1f2023);font:15px/1.55 system-ui,sans-serif;padding:24px;text-align:center';
  const box = doc.createElement('div');
  box.style.cssText = 'max-width:460px';
  const h = doc.createElement('h1');
  h.textContent = NOT_RUNNING_TITLE;
  h.style.cssText = 'font-size:22px;margin:0 0 8px';
  const p = doc.createElement('p');
  p.textContent = NOT_RUNNING_TEXT;
  p.style.cssText = 'margin:0;color:var(--text-dim,#62666f)';
  box.append(h, p);
  wrap.append(box);
  doc.body.append(wrap);
  const timer = globalThis.setInterval(async () => { try { if (await check()) { globalThis.clearInterval(timer); reload(); } } catch { /* still not running */ } }, everyMs);
  return wrap;
}

/**
 * BROWSER (Design's drawing): in a browser, every control that makes a window-only change is switched off, greyed, and says "Change this in Bunny's window." beside it.
 * Which controls: the Settings page's controls for the window-only settings, everything on the Customize, Providers and Automation pages (all of it is window-only), and the
 * permission-mode button of a chat. The server refuses these writes anyway; this keeps the page from showing a state that was never saved.
 */
const SETTINGS_IDS = ['#default-permission', '#allowlist', '#aliases', '#instructions', '#model-filter', '#max-tokens', '#auto-steps', '#auto-minutes', '#auto-tokens', '#google-workspace', '#github-client-id', '#google-client-id', '#google-client-secret', '#check-update', '#restart-update', '[data-key="helpersEnabled"]'];
const WHOLE_PAGE = 'main button:not([role="tab"]):not([data-scope]):not([data-kind]), main input:not([type="search"]), main select, main textarea';
/** The selectors of the controls to lock on a page (by its path). `keys` are the window-only setting keys (the page's data-cap switches are locked when theirs is one). */
export function lockSelectorsFor(pathname, keys = []) {
  const name = String(pathname ?? '').split('/').pop();
  if (name === 'settings.html') return [...SETTINGS_IDS, '#perm-rules', ...keys.map((k) => `[data-cap="${k}"]`)];
  if (name === 'customize.html' || name === 'providers.html' || name === 'automation.html') return [WHOLE_PAGE];
  if (name === 'index.html') return ['#mode-button'];
  return [];
}

/** Switch one control off with the sentence beside it. A block (like the permission rules) gets the sentence once, at its top, and all its controls are switched off. */
export function lockControl(el, doc = globalThis.document, { note: withNote = true } = {}) {
  if (!el || el.dataset?.windowOnlyLocked) return;
  el.dataset.windowOnlyLocked = '1';
  const controls = el.matches?.('input, select, textarea, button') ? [el] : [...el.querySelectorAll('input, select, textarea, button')];
  for (const c of controls) { c.disabled = true; c.setAttribute('aria-disabled', 'true'); c.style.opacity = '.5'; c.style.cursor = 'not-allowed'; c.title = LOCK_MESSAGE; c.dataset.windowOnlyLocked = '1'; }
  if (!withNote) return; // a whole page of window-only controls (Customize, Providers, Automation) has the one note at the top
  const note = doc.createElement('span');
  note.className = 'window-only-note';
  note.textContent = LOCK_MESSAGE;
  note.style.cssText = 'font-size:12px;color:var(--text-dim,#62666f);margin:0 8px;white-space:normal';
  if (controls.length === 1 && controls[0] === el) (el.closest?.('label') ?? el).after(note);
  else (el.querySelector?.('h3, h2') ?? el).after(note);
}

/** Lock what the page has now and what it adds later (lists are drawn after the page loads). */
export function lockPage(doc = globalThis.document, pathname = globalThis.location?.pathname, keys = []) {
  const selectors = lockSelectorsFor(pathname, keys);
  if (!doc || !selectors.length) return;
  const wholePage = /(customize|providers|automation).html$/.test(String(pathname));
  const run = () => { for (const sel of selectors) for (const el of doc.querySelectorAll(sel)) lockControl(el, doc, { note: !wholePage }); };
  run();
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; run(); }); }).observe(doc.body, { childList: true, subtree: true });
}

/**
 * If a window-only write is refused anyway (the server's lock, or this page's), the control goes back to what it showed before the person touched it,
 * and the page never shows a state that was not saved.
 */
export function installRevert(doc = globalThis.document) {
  const before = new WeakMap(); // control -> what it showed when last focused or last accepted
  const valueOf = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
  const setValue = (el, v) => { if (el.type === 'checkbox' || el.type === 'radio') el.checked = Boolean(v); else el.value = v; };
  let touched = null;
  doc.addEventListener('focusin', (e) => { if (e.target && 'value' in e.target) before.set(e.target, valueOf(e.target)); }, true);
  doc.addEventListener('change', (e) => { const el = e.target; if (!el || !('value' in el)) return; touched = { el, was: before.has(el) ? before.get(el) : undefined }; before.set(el, valueOf(el)); }, true);
  doc.addEventListener('bunny:window-only-refused', () => {
    if (touched && touched.was !== undefined) { setValue(touched.el, touched.was); before.set(touched.el, touched.was); touched.el.dispatchEvent(new Event('bunny:reverted', { bubbles: true })); }
    touched = null;
  });
  // a refused write that nobody caught is not an error page: it is said, not logged
  globalThis.addEventListener?.('unhandledrejection', (e) => { if (e.reason?.code === 'window.only') e.preventDefault(); });
}

/** A page-wide note on a Settings page opened in a browser, so a locked control is not a surprise. */
export function showBrowserLockNote(doc = globalThis.document) {
  if (!doc) return null;
  const existing = doc.getElementById('browser-lock-note');
  if (existing) return existing;
  const note = doc.createElement('div');
  note.id = 'browser-lock-note';
  note.setAttribute('role', 'note');
  note.textContent = `You are using Bunny in a browser. Anything that changes what Bunny may do or run (permissions, connectors, installs, updates) is locked here. ${LOCK_MESSAGE}`;
  note.style.cssText = 'margin:12px 16px;padding:10px 14px;border:1px solid var(--line,#e6e2da);border-radius:10px;background:var(--bg-sidebar,#f3f1ec);color:var(--text-dim,#62666f);font-size:13px';
  doc.body.prepend(note);
  return note;
}
