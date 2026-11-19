/**
 * OPEN-SIGNIN (OS-2, OS-6): what the internet listener trusts about a request, and nothing more. Pure: no sockets, no files.
 *
 * The listener binds 127.0.0.1 only; a tunnel (Tailscale Funnel) or the person's own proxy forwards to it. So the TCP peer must be loopback, the Host must be exactly the pinned public
 * name, and the headers that say who the visitor is are read from one place only:
 *  - Funnel: `Tailscale-Funnel-Request: ?1` must be there (Tailscale deletes any incoming copy and sets its own). The visitor's address is unknown to the code until the Funnel test shows that
 *    X-Forwarded-For is the real phone address (`trustForwardedFor`, set in code, never a setting).
 *  - Own HTTPS: only the one header the person named (`clientIpHeader`) is read, never X-Forwarded-For, which a proxy such as Cloudflare appends to.
 * X-Forwarded-Proto and X-Forwarded-Host never decide the pin or how a cookie is built.
 */

export const NOT_THROUGH_FUNNEL = 'That request did not come through Bunny AI\'s Tailscale Funnel.';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** A header value that is an IP address (v4 or v6), or null. The visitor's address is only ever used to count tries, never saved. */
const asAddress = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text) && text.split('.').every((n) => Number(n) <= 255)) return text;
  if (/^[0-9a-f:]{2,45}$/i.test(text) && text.includes(':')) return text.toLowerCase();
  return null;
};

/**
 * OS-6: the name the person typed for "Your own HTTPS address", checked when it is saved: a hostname of letters, digits, `-` and dots, at most 253 characters with labels of at most 63;
 * no wildcard, no IP literal, not localhost or *.localhost, no scheme or path. An optional port of 443, 8443 or 1024-65535 is kept separately.
 * @returns {{ ok: true, name: string, port: number } | { ok: false, message: string }}
 */
export function checkHttpsName(value) {
  let text = String(value ?? '').trim().toLowerCase();
  if (!text) return { ok: false, message: 'Type the address your proxy serves, for example bunny.example.com.' };
  if (/[/\\?#@\s*]/.test(text) || text.includes('://')) return { ok: false, message: 'Type only the name, with no https://, path, wildcard or spaces.' };
  let port = 443;
  const at = text.lastIndexOf(':');
  if (at > -1) {
    const digits = text.slice(at + 1);
    if (!/^\d{1,5}$/.test(digits)) return { ok: false, message: 'The port after the colon must be a number.' };
    port = Number(digits);
    text = text.slice(0, at);
    if (!(port === 443 || port === 8443 || (port >= 1024 && port <= 65535))) return { ok: false, message: 'The port must be 443, 8443 or between 1024 and 65535.' };
  }
  text = text.replace(/\.$/, '');
  if (text.length > 253) return { ok: false, message: 'That name is too long.' };
  const labels = text.split('.');
  if (labels.length < 2) return { ok: false, message: 'That is not a public name (it needs at least one dot).' };
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return { ok: false, message: 'A name may have only letters, digits, - and dots, and each part is at most 63 characters.' };
  if (/^\d+(\.\d+){3}$/.test(text) || labels.every((l) => /^\d+$/.test(l))) return { ok: false, message: 'Use a name, not an IP address.' };
  if (text === 'localhost' || text.endsWith('.localhost')) return { ok: false, message: 'localhost is not a public name.' };
  return { ok: true, name: text, port };
}

/** The Host a request must carry for this name and port. */
export const pinHost = (name, port = 443) => (Number(port) === 443 ? name : `${name}:${port}`);

/**
 * The checks every request on the internet listener passes before anything else.
 * @param {{ route: 'funnel' | 'https', name: () => string, port?: () => number, trustForwardedFor?: boolean, clientIpHeader?: () => string }} options
 *   name and port are read on every request (the person can change them).
 * @returns {(req: { headers: object, socket?: { remoteAddress?: string } }) => { ok: true, ip: string, host: string, origin: string } | { ok: false, code: string, message: string | null }}
 */
export function internetPin({ route, name, port = () => 443, trustForwardedFor = false, clientIpHeader = () => '' }) {
  return (req) => {
    const headers = req.headers ?? {};
    const refuse = (code, message = null) => ({ ok: false, code, message });
    // 1. the peer is the tunnel or proxy on this PC: loopback only
    if (!LOOPBACK.has(String(req.socket?.remoteAddress ?? ''))) return refuse('request.badHost');
    const pinned = name();
    if (!pinned) return refuse('request.badHost');
    const host = pinHost(pinned, port());
    // 2. Host exactly the pinned name (a direct 127.0.0.1 request, or a DNS-rebinding page, has another Host)
    const sent = typeof headers.host === 'string' ? headers.host.trim().toLowerCase() : '';
    if (!sent || sent !== host) return refuse('request.badHost');
    const forwardedHost = headers['x-forwarded-host'];
    if (forwardedHost !== undefined && String(forwardedHost).trim().toLowerCase() !== host) return refuse('request.badHost');
    // 3. Origin (when sent) exactly https://<host>; fetch metadata only from this site or a typed address
    const origin = `https://${host}`;
    if (headers.origin !== undefined && headers.origin !== origin) return refuse('request.badOrigin');
    const site = headers['sec-fetch-site'];
    if (site !== undefined && !['same-origin', 'none'].includes(site)) return refuse('request.badOrigin');
    // 4. who is asking (only to count tries; never saved, never shown)
    let ip = 'unknown';
    if (route === 'funnel') {
      if (headers['tailscale-funnel-request'] !== '?1') return refuse('request.notFunnel', NOT_THROUGH_FUNNEL);
      if (trustForwardedFor) { // the right-most entry is the one the trusted hop added; anything a visitor prepended is to its left
        const last = String(headers['x-forwarded-for'] ?? '').split(',').pop();
        ip = asAddress(last) ?? 'unknown';
      }
    } else {
      const named = String(clientIpHeader() ?? '').trim().toLowerCase();
      if (named && /^[a-z0-9-]{1,40}$/.test(named) && named !== 'x-forwarded-for') ip = asAddress(headers[named]) ?? 'unknown';
    }
    return { ok: true, ip, host, origin };
  };
}

/** The header name the person may choose for the visitor's address: letters, digits and `-`, at most 40, never X-Forwarded-For (OS-2). */
export function checkClientIpHeader(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true, value: '' };
  if (!/^[A-Za-z0-9-]{1,40}$/.test(text)) return { ok: false, message: 'A header name has only letters, digits and -, at most 40 characters.' };
  if (text.toLowerCase() === 'x-forwarded-for') return { ok: false, message: 'X-Forwarded-For cannot be used: a proxy adds to it instead of replacing it.' };
  return { ok: true, value: text };
}
