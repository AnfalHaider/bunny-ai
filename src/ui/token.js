// S-1: the server puts this page's launch token in a <meta> tag; every call this page
// makes to its own /api/ carries it, so the local API answers Bunny's pages and no one else.
//
// Q2-23: when the server restarted since this page loaded (plain-browser mode keeps its port), the token
// is stale and the server answers 403 request.noToken. The page asks the server for its own page again,
// reads the new token, and retries the call once. If that fails it says so, instead of failing silently.
(() => {
  const meta = document.querySelector('meta[name="bunny-token"]');
  if (!meta?.content) return;
  const nativeFetch = window.fetch.bind(window);
  let refreshing = null;

  const isApi = (url) => url.origin === location.origin && url.pathname.startsWith('/api/');

  const refreshToken = () => {
    refreshing ??= (async () => {
      try {
        const res = await nativeFetch(location.pathname + location.search, { cache: 'no-store', headers: { accept: 'text/html' } });
        const fresh = /<meta name="bunny-token" content="([^"<>]+)">/.exec(await res.text())?.[1];
        if (fresh && fresh !== meta.content) { meta.content = fresh; return 'changed'; }
        return 'same'; // the server answered with the token this window already has: this 403 is not about a restart
      } catch { /* the server is not there */ }
      return 'unreachable';
    })().finally(() => { refreshing = null; });
    return refreshing;
  };

  const say = () => {
    if (document.getElementById('bunny-restarted')) return;
    const bar = document.createElement('div');
    bar.id = 'bunny-restarted';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:10px 16px;text-align:center;font:14px system-ui,sans-serif;background:#fff3cd;color:#3d2f00;border-bottom:1px solid #e6d28a';
    bar.textContent = 'Bunny AI restarted, so this window is out of date. ';
    const link = document.createElement('a');
    link.href = location.href;
    link.textContent = 'Reload';
    link.style.cssText = 'color:inherit;font-weight:600;text-decoration:underline';
    link.addEventListener('click', (e) => { e.preventDefault(); location.reload(); });
    bar.append(link);
    document.body.prepend(bar);
  };

  const withToken = (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-bunny-token', meta.content);
    return nativeFetch(input, { ...init, headers });
  };

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    if (!isApi(url)) return nativeFetch(input, init);
    const again = input instanceof Request ? input.clone() : input; // a Request body can be read only once
    const sent = meta.content; // the token this call went out with
    const res = await withToken(input, init);
    if (res.status !== 403) return res;
    const body = await res.clone().json().catch(() => null);
    if (body?.code !== 'request.noToken') return res;
    // another call already fetched a new token while this one was on its way: just send this one again with it
    if (meta.content !== sent) return withToken(again, init);
    const outcome = await refreshToken();
    if (outcome === 'changed') return withToken(again, init);
    if (outcome === 'unreachable') say(); // only say "restarted" when the server really is not answering as before
    return res;
  };
})();
