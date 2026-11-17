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

/** A page-wide note on a Settings page opened in a browser, so a locked control is not a surprise. */
export function showBrowserLockNote(doc = globalThis.document) {
  if (!doc) return null;
  const existing = doc.getElementById('browser-lock-note');
  if (existing) return existing;
  const note = doc.createElement('div');
  note.id = 'browser-lock-note';
  note.setAttribute('role', 'note');
  note.textContent = `You are using Bunny in a browser. Anything that changes what Bunny may do or run (permissions, connectors, installs, updates) is locked here. ${LOCK_MESSAGE}`;
  note.style.cssText = 'margin:0 0 12px;padding:8px 12px;border:1px solid var(--line,#e6e2da);border-radius:10px;background:var(--bg-sidebar,#f3f1ec);color:var(--text-dim,#62666f);font-size:13px';
  doc.body.prepend(note);
  return note;
}
