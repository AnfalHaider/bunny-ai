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
})();
