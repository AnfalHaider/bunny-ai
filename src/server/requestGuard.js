/**
 * S-1: who may talk to Bunny AI's local server.
 *
 * Any web page open on this PC can reach 127.0.0.1, so every request is checked
 * before a route runs: the Host header (stops DNS rebinding), Sec-Fetch-Site and
 * Origin (stops other pages), and a per-launch token that only Bunny's own pages
 * are given. Pure: it reads headers and returns a verdict, so it needs no socket.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

const NOT_BUNNY = 'That request did not come from Bunny AI.';
const STALE = 'This window is out of date. Close it and open Bunny AI again (or reload the page).';

// A browser cannot put a header on <img src> or window.open(), so these four GETs
// skip the token. They still pass the Host and Sec-Fetch-Site rules.
const HEADERLESS = [
  /^\/api\/health$/,
  /^\/api\/profile\/photo$/,
  /^\/api\/screens\/[a-f0-9-]{36}\.png$/,
  /^\/api\/artifacts\/[a-f0-9-]{36}\/raw$/,
];

const refuse = (code, message) => ({ ok: false, code, message });

function sameToken(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeToken() {
  return randomBytes(32).toString('hex');
}

export function createRequestGuard({ token = makeToken() } = {}) {
  function check(req, path, method) {
    const headers = req.headers ?? {};
    const port = req.socket?.localPort;

    // 1. Host: exactly our own address and port.
    const host = typeof headers.host === 'string' ? headers.host.trim().toLowerCase() : '';
    if (!port || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return refuse('request.badHost', NOT_BUNNY);
    }

    const isApi = path.startsWith('/api/');
    const headerless = method === 'GET' && HEADERLESS.some((re) => re.test(path));

    // 2. Fetch metadata, when the browser sends it.
    const site = headers['sec-fetch-site'];
    if (site !== undefined) {
      const allowed = isApi && !headerless ? ['same-origin'] : ['same-origin', 'none'];
      if (typeof site !== 'string' || !allowed.includes(site)) return refuse('request.badOrigin', NOT_BUNNY);
    }

    // 3. Origin, when present, on any method: our own page and nothing else (including "null").
    const origin = headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return refuse('request.badOrigin', NOT_BUNNY);

    // 4. The launch token, for the API. Static files hand it out instead.
    if (isApi && !headerless && !sameToken(headers['x-bunny-token'], token)) {
      return refuse('request.noToken', STALE);
    }
    return { ok: true };
  }

  return { check, token, headerless: (path, method) => method === 'GET' && HEADERLESS.some((re) => re.test(path)) };
}
