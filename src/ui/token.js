// S-1: the server puts this page's launch token in a <meta> tag; every call this page
// makes to its own /api/ carries it, so the local API answers Bunny's pages and no one else.
(() => {
  const token = document.querySelector('meta[name="bunny-token"]')?.content;
  if (!token) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-bunny-token', token);
    return nativeFetch(input, { ...init, headers });
  };
})();
