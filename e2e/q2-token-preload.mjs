// Node preload for the Q-2 scripts when the server runs with the request guard ON and a fixed test token
// (invented profile only: BUNNY_FAKE_UPSTREAM=1 BUNNY_API_TOKEN=<token>). It adds the token to this process's own
// fetch calls to the app, the way the app's pages do. Pages opened in the browser get their token from the server.
//   node --import ./e2e/q2-token-preload.mjs e2e/q2-controls.mjs
const token = process.env.BUNNY_API_TOKEN;
const base = process.env.BASE;
if (token && base) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) return real(input, init);
    const headers = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
    headers.set('x-bunny-token', token);
    return real(input, { ...init, headers });
  };
}
