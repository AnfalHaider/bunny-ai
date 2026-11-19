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

  // BANNER-NOTICE (the owner: "No banner on top is required", everywhere; Security's BN-9): a device's page shows NO notice. At Everything a small red "Everything" chip stays in the page's header
  // (a phone gets passed around: whoever holds it can always see it has full control) and cannot be dismissed. At Chats nothing is shown. The server is asked about the level (never the page),
  // and the page starts over when it changes.
  if (window.top !== window) return; // pages inside the Settings window (an iframe) do not repeat it
  let shown = null;
  const BAD = 'var(--bad,#cf3f55)';
  const chipCss = `display:inline-flex;gap:6px;align-items:center;flex:none;border:1px solid ${BAD};border-radius:99px;padding:2px 10px;font:inherit;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer;color:${BAD};background:var(--bad-soft,rgba(207,63,85,.10))`;
  const dot = () => { const d = document.createElement('span'); d.style.cssText = `width:7px;height:7px;border-radius:50%;background:${BAD};flex:none`; return d; };
  const paintChip = (level) => {
    let chip = document.getElementById('device-chip');
    if (level !== 'everything') { chip?.remove(); return; }
    if (chip) return;
    chip = document.createElement('button');
    chip.id = 'device-chip';
    chip.type = 'button';
    chip.setAttribute('role', 'status');
    chip.dataset.level = 'everything';
    chip.title = 'Everything access: press for details';
    chip.setAttribute('aria-label', 'Everything access. Press for details.');
    chip.style.cssText = chipCss;
    const label = document.createElement('span'); label.textContent = 'Everything';
    chip.append(dot(), label);
        const toolbar = document.querySelector('.topbar .toolbar');
    if (toolbar) toolbar.parentElement.insertBefore(chip, toolbar);
    else { chip.style.cssText += ';position:fixed;z-index:2147480000;right:10px;top:calc(env(safe-area-inset-top,0px) + 8px)'; document.body.append(chip); }
  };
  const check = async () => {
    try {
      const res = await window.fetch('/api/remote/me', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const level = (await res.json())?.level === 'everything' ? 'everything' : 'chats';
      if (shown !== null && level !== shown) { location.reload(); return; }
      shown = level;
      paintChip(level);
    } catch { /* offline for a moment: what is shown stays as it was */ }
  };
  const start = () => { check(); setInterval(check, 10000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
