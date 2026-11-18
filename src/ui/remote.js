// BROWSER step 2: a page served to a signed-in device. It has no launch token (none is ever handed to another device); its session cookie is sent by the browser,
// and every write to this server's API also carries this session's CSRF token, read from the page's own <meta>.
(() => {
  const meta = document.querySelector('meta[name="bunny-csrf"]');
  if (!meta?.content) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (method !== 'GET' && method !== 'HEAD') headers.set('x-bunny-csrf', meta.content);
    const res = await nativeFetch(input, { ...init, headers });
    // the session ended (signed out from the computer, or idle too long): back to the sign-in page
    if (res.status === 401) { location.replace('/?signedout=1'); }
    return res;
  };

  // DEVICE-FULL (Design's drawing): a thin line across the top says which level the person at the PC gave this device, always. The server is asked (never the page),
  // and the page starts over when the level changes, so what it locks is always what the server will refuse.
  if (window.top !== window) return; // pages inside the Settings window (an iframe) do not repeat it
  const GLYPH = {
    lock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    warn: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2zM12 10v5M12 18v.1"/></svg>',
  };
  let shown = null;
  let bar = null;
  const paint = (level) => {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'device-level-line';
      bar.setAttribute('role', 'status');
      document.body.prepend(bar);
    }
    const all = level === 'everything';
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 12px;font-size:12px;border-bottom:1px solid var(--line,#e6e2da);' + (all ? 'background:var(--bad-soft,rgba(207,63,85,.10));color:var(--bad,#cf3f55)' : 'background:var(--accent-soft,rgba(106,79,216,.08));color:var(--accent,#6a4fd8)');
    bar.dataset.level = level;
    bar.innerHTML = (all ? GLYPH.warn : GLYPH.lock) + '<span><b style="font-weight:600"></b></span>';
    const b = bar.querySelector('b');
    b.textContent = all ? 'Everything access' : 'Chats access';
    b.parentElement.append(all ? " · ends after 30 min idle" : ' · the PC can give this device more');
  };
  const check = async () => {
    try {
      const res = await window.fetch('/api/remote/me', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const level = (await res.json())?.level === 'everything' ? 'everything' : 'chats';
      if (shown !== null && level !== shown) { location.reload(); return; }
      shown = level;
      paint(level);
    } catch { /* offline for a moment: the line stays as it was */ }
  };
  const start = () => { check(); setInterval(check, 10000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
