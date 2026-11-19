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
    if (res.status === 401) { location.replace('/'); }
    return res;
  };

  // BANNER-NOTICE (Design's drawing v3, Security's BN-1 to BN-5): what the person at the PC gave this device is said in a notification the person can dismiss, and at Everything a small
  // red "Everything" chip stays in the page's header (a phone gets passed around: whoever holds it can always see it has full control). At Chats nothing is left behind.
  // The server is asked about the level (never the page), and the page starts over when it changes, so the notification shows again then and on every load.
  // A dismissal is the variable below and nothing else: it is not saved in a setting, localStorage, a cookie or a file (BN-4); a new page load brings the notification back.
  if (window.top !== window) return; // pages inside the Settings window (an iframe) do not repeat it
  let shown = null;
  let dismissed = false;
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
    chip.addEventListener('click', () => { dismissed = false; paintToast('everything'); });
    const toolbar = document.querySelector('.topbar .toolbar');
    if (toolbar) toolbar.parentElement.insertBefore(chip, toolbar);
    else { chip.style.cssText += ';position:fixed;z-index:2147480000;right:10px;top:calc(env(safe-area-inset-top,0px) + 8px)'; document.body.append(chip); }
  };
  const paintToast = (level) => {
    document.getElementById('device-note')?.remove();
    if (dismissed) return;
    const all = level === 'everything';
    const accent = all ? BAD : 'var(--accent,#6a4fd8)';
    const box = document.createElement('div');
    box.id = 'device-note';
    box.setAttribute('role', 'status');
    box.dataset.level = level;
    box.style.cssText = `position:fixed;z-index:2147480000;right:10px;top:calc(var(--topbar-h,48px) + env(safe-area-inset-top,0px) + 6px);width:min(340px,calc(100vw - 20px));box-sizing:border-box;background:var(--surface,#fff);color:var(--text,#1f2023);border:1px solid ${accent};border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.22);padding:9px 11px;display:grid;gap:3px;font:12.5px/1.45 var(--font-sans,system-ui,sans-serif);text-align:left`;
    const head = document.createElement('div');
    head.style.cssText = `display:flex;gap:6px;align-items:center;font-weight:700;color:${accent}`;
    const title = document.createElement('span'); title.textContent = all ? 'Everything access' : 'You have Chats access';
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×'; x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = 'margin-left:auto;background:none;border:0;color:var(--text-dim,#62666f);font:inherit;font-size:16px;line-height:1;padding:0 4px;cursor:pointer';
    const dismiss = () => { dismissed = true; box.remove(); };
    x.addEventListener('click', dismiss);
    head.append(title, x);
    const msg = document.createElement('span');
    msg.style.color = 'var(--text-dim,#62666f)';
    msg.textContent = all ? 'The PC gave this device every tool and setting. Ends after 30 minutes idle.' : 'The PC can give this device more. Change it in Bunny, on the PC.';
    box.append(head, msg);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } });
    document.body.append(box);
  };
  const check = async () => {
    try {
      const res = await window.fetch('/api/remote/me', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const level = (await res.json())?.level === 'everything' ? 'everything' : 'chats';
      if (shown !== null && level !== shown) { location.reload(); return; }
      const first = shown === null;
      shown = level;
      paintChip(level);
      if (first) paintToast(level);
    } catch { /* offline for a moment: what is shown stays as it was */ }
  };
  const start = () => { check(); setInterval(check, 10000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
