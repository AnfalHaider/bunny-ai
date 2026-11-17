/**
 * download_file(url, path): fetch an http(s) address into the workspace folder.
 * Plain http/https only, at most 5 redirects (each hop re-validated), no loopback/private/link-local/reserved
 * hosts (unless allowLoopback), 50 MB cap, 60 s total. No cookies or auth are sent; no response headers are echoed.
 * The host is resolved ONCE, every address is validated, and the socket connects to that same validated address
 * (no second lookup, so a DNS rebind cannot swap it); the hostname is kept for Host and TLS SNI.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { isOwnServer, isLoopbackAddress, ownPorts } from './ownAddress.js';

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

const blocked4 = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32]]) blocked4.addSubnet(net, bits, 'ipv4');

/** The 8 sixteen-bit groups of an IPv6 text address (any spelling, dotted tail allowed), or null. */
function groups6(text) {
  let s = text;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    s = s.slice(0, dotted.index) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail, extra] = s.split('::');
  if (extra !== undefined) return null;
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? null : tail ? tail.split(':') : [];
  let all = h;
  if (t) {
    const fill = 8 - h.length - t.length;
    if (fill < 1) return null;
    all = [...h, ...Array(fill).fill('0'), ...t];
  }
  if (all.length !== 8) return null;
  const nums = all.map((x) => parseInt(x, 16));
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : nums;
}

/** Is this literal IP (v4 or v6, any spelling) one that download_file must not connect to? Unparseable counts as blocked. */
export function isPrivateAddress(ip) {
  const a = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(a) === 4) return blocked4.check(a, 'ipv4');
  if (isIP(a) !== 6) return true;
  const g = groups6(a);
  if (!g) return true;
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::, ::1, IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the embedded IPv4 decides.
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;
    return blocked4.check(v4(g[6], g[7]), 'ipv4');
  }
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return blocked4.check(v4(g[6], g[7]), 'ipv4'); // W613-2: IPv4-translated (::ffff:0:a.b.c.d), the embedded IPv4 decides
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blocked4.check(v4(g[6], g[7]), 'ipv4'); // NAT64
  if (g[0] === 0x2002) return blocked4.check(v4(g[1], g[2]), 'ipv4'); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

const hostOf = (u) => u.hostname.replace(/^\[|\]$/g, '');
const refusedOwn = () => new Error('Bunny AI will not fetch its own server (its address on this computer): its pages hold things only the person may see.');
const refusedHost = (name) => new Error(`${name} is on this computer or a private network; download_file only fetches public addresses.`);

const stopped = (signal) => new Error(signal?.aborted ? 'Stopped by the person.' : `The download took longer than ${DOWNLOAD_TIMEOUT_MS / 1000} s and was stopped.`);

/** One request that connects only to the address validated for it. Resolves with the response (body not read). */
function requestOnce(url, { sig, allowLoopback, lookupImpl }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const literal = isIP(hostOf(url)) !== 0;
    if (literal && !allowLoopback && isPrivateAddress(hostOf(url))) { reject(refusedHost(url.hostname)); return; }
    // Resolved once here; the socket is handed exactly the validated address.
    const lookup = (hostname, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      Promise.resolve(lookupImpl(hostname, { all: true })).then((found) => {
        const list = Array.isArray(found) ? found : [found];
        if (!list.length) throw new Error(`Could not find the host ${hostname}`);
        // a name that points at this PC's own loopback at Bunny's own port is Bunny's server, whatever the name says
        if (ownPorts.has(String(url.port || (url.protocol === 'https:' ? '443' : '80'))) && list.some((x) => isLoopbackAddress(x.address))) throw refusedOwn();
        if (!allowLoopback && list.some((x) => isPrivateAddress(x.address))) throw refusedHost(hostname);
        const first = { address: list[0].address, family: list[0].family || isIP(list[0].address) };
        if (opts?.all) cb(null, [first]); else cb(null, first.address, first.family);
      }).catch((err) => cb(err));
    };
    const req = lib.request(url, {
      method: 'GET', agent: false, signal: sig, lookup,
      headers: { 'user-agent': 'Bunny-AI', accept: '*/*', 'accept-encoding': 'identity' },
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** Returns { bytes: Buffer, type, url }. Throws a readable error; nothing is written here. */
export async function fetchLimited(url, { signal, allowLoopback = false, lookupImpl = (h, o) => dnsLookup(h, o) } = {}) {
  let current;
  try { current = new URL(String(url ?? '').trim()); } catch { throw new Error('download_file needs a full http or https address'); }
  const sig = AbortSignal.any([AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), ...(signal ? [signal] : [])]);
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Error(`download_file only fetches http or https addresses, not ${current.protocol}`);
    if (isOwnServer(current)) throw refusedOwn(); // every hop, so a redirect cannot lead there either
    let res;
    try {
      // allowLoopback may be a function of the address, asked again on every hop
      res = await requestOnce(current, { sig, allowLoopback: typeof allowLoopback === 'function' ? allowLoopback(current) : allowLoopback, lookupImpl });
    } catch (err) {
      if (sig.aborted) throw stopped(signal);
      if (/private network|find the host|will not fetch its own server/.test(err.message)) throw err;
      throw new Error(`Could not download: ${err.code || err.message}`);
    }
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const next = res.headers.location;
      res.destroy();
      if (!next) throw new Error(`The server redirected (${res.statusCode}) without saying where`);
      if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
      try { current = new URL(next, current); } catch { throw new Error('The server redirected to an invalid address'); }
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) { res.destroy(); throw new Error(`The server answered ${res.statusCode}`); }
    const tooBig = () => new Error(`The file is larger than the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit, so nothing was saved.`);
    if (Number(res.headers['content-length']) > MAX_DOWNLOAD_BYTES) { res.destroy(); throw tooBig(); }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) { res.destroy(); throw tooBig(); }
        chunks.push(chunk);
      }
    } catch (err) {
      if (err.message.includes('MB limit')) throw err;
      if (sig.aborted) throw stopped(signal);
      throw new Error(`The download was interrupted: ${err.message}`);
    }
    const type = String(res.headers['content-type'] ?? '').split(';')[0].trim() || 'unknown';
    return { bytes: Buffer.concat(chunks), type, url: current.href };
  }
}
