/**
 * IA-0 (Security, install-anywhere review): a connector the MODEL found (add_connector, a remote in an imported plugin, or one added from a device) is reached only at a PUBLIC https address.
 *   - when it is added: https only, no password in the address, and a host that is not, and does not resolve to, loopback, private, link-local, ULA, CGNAT or unspecified (the same test fetchLimited uses);
 *   - at every call: the host is resolved again, a private result is refused (DNS rebinding after the add), the socket connects to the address that was checked, and a redirect is an error.
 * A connector the PERSON adds in Customize (addedBy 'person', set only by the window) may use a private address and http, and is marked as such.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isPrivateAddress } from './download.js';

export const PUBLIC_ONLY = 'Bunny adds a connector the model found only at a public https address. To add your own server, use Settings › Customize.';
export const guarded = (server) => server?.addedBy === 'model' || server?.addedBy === 'device';

const hostOf = (u) => u.hostname.replace(/^\[|\]$/g, '');
const refused = () => Object.assign(new Error(PUBLIC_ONLY), { code: 'mcp.publicOnly' });
const NAMES = (h) => { const x = h.toLowerCase().replace(/\.$/, ''); return x === 'localhost' || x.endsWith('.localhost') || x.endsWith('.local') || x.endsWith('.internal') || !x.includes('.') && isIP(x) === 0; };

/** Resolve a host to the addresses it points at. A literal is itself. Throws on a lookup failure. */
async function resolveAll(host, lookupImpl) {
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  const found = await lookupImpl(host, { all: true });
  return Array.isArray(found) ? found : [found];
}

/**
 * When it is added. The address must be https, plain, and not private. A name that does not resolve now is allowed here (the connector is simply unreachable until it does) because every call checks again.
 * Throws an error with code 'mcp.publicOnly' and the sentence the person reads.
 */
export async function checkPublicAddress(address, { lookupImpl = (h, o) => dnsLookup(h, o) } = {}) {
  let u;
  try { u = new URL(String(address ?? '').trim()); } catch { throw refused(); }
  if (u.protocol !== 'https:' || u.username || u.password) throw refused();
  const host = hostOf(u);
  if (isIP(host) && isPrivateAddress(host)) throw refused();
  if (!isIP(host) && NAMES(host)) throw refused();
  let list = [];
  try { list = await resolveAll(host, lookupImpl); } catch { return u.href; } // unresolvable now: the call-time check decides
  if (list.some((x) => isPrivateAddress(x.address))) throw refused();
  return u.href;
}

/**
 * A fetch-shaped request that connects only to a public address it checked itself, never follows a redirect and answers a real Response whose body streams.
 * `allowHttp` and `allowPrivate` exist for the tests' loopback stand-ins only; nothing in the app passes them.
 */
export function publicFetch(url, init = {}, { lookupImpl = (h, o) => dnsLookup(h, o), allowHttp = false, allowPrivate = false } = {}) {
  // a test may stand in for the network, and only when it says so in the environment (the app never sets this); anything else always goes through the checks below
  if (process.env.BUNNY_TEST_TRANSPORT === '1' && typeof globalThis.__bunnyTestFetch === 'function') return globalThis.__bunnyTestFetch(url, init);
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(String(url)); } catch { reject(refused()); return; }
    if ((u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) || u.username || u.password) { reject(refused()); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const host = hostOf(u);
    if (!allowPrivate && isIP(host) && isPrivateAddress(host)) { reject(refused()); return; }
    const lookup = (hostname, opts, cb) => { // resolved once, here; the socket gets exactly the checked address
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      resolveAll(hostname, lookupImpl).then((list) => {
        if (!list.length) throw new Error(`Could not find the host ${hostname}`);
        if (!allowPrivate && list.some((x) => isPrivateAddress(x.address))) throw refused();
        const first = { address: list[0].address, family: list[0].family || isIP(list[0].address) };
        if (opts?.all) cb(null, [first]); else cb(null, first.address, first.family);
      }).catch((err) => cb(err));
    };
    const headers = {};
    for (const [k, v] of init.headers instanceof Headers ? init.headers.entries() : Object.entries(init.headers ?? {})) headers[k] = v;
    const req = lib.request(u, { method: init.method ?? 'GET', headers, agent: false, lookup, signal: init.signal }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); reject(Object.assign(new Error('The connector tried to send Bunny somewhere else, which is refused.'), { code: 'mcp.redirect' })); return; }
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) { if (Array.isArray(v)) for (const x of v) out.append(k, x); else if (v !== undefined) out.set(k, String(v)); }
      const bodyless = [101, 204, 205, 304].includes(res.statusCode);
      if (bodyless) res.resume();
      resolve(new Response(bodyless ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage ?? '', headers: out }));
    });
    req.on('error', reject);
    req.end(init.body === undefined ? undefined : init.body);
  });
}
