/**
 * download_file(url, path): fetch an http(s) address into the workspace folder.
 * Plain http/https only, at most 5 redirects (each hop re-checked), no loopback/private/link-local hosts
 * (unless allowLoopback), 50 MB cap, 60 s total. No cookies or auth are sent; no response headers are echoed.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

/** Is this literal IP loopback, private, link-local, unspecified or otherwise not a public address? */
export function isPrivateAddress(ip) {
  let a = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number);
    return p === 127 || p === 10 || p === 0 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254);
  }
  if (isIP(a) === 6) {
    return a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return false;
}

async function checkHost(hostname, allowLoopback) {
  if (allowLoopback) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error(`Could not find the host ${hostname}`); });
  if (addrs.some((x) => isPrivateAddress(x.address))) throw new Error(`${hostname} is on this computer or a private network; download_file only fetches public addresses.`);
}

const stopped = (signal) => new Error(signal?.aborted ? 'Stopped by the person.' : `The download took longer than ${DOWNLOAD_TIMEOUT_MS / 1000} s and was stopped.`);

/** Returns { bytes: Buffer, type, url }. Throws a readable error; nothing is written here. */
export async function fetchLimited(url, { signal, allowLoopback = false, fetchImpl = globalThis.fetch } = {}) {
  let current;
  try { current = new URL(String(url ?? '').trim()); } catch { throw new Error('download_file needs a full http or https address'); }
  const sig = AbortSignal.any([AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), ...(signal ? [signal] : [])]);
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Error(`download_file only fetches http or https addresses, not ${current.protocol}`);
    await checkHost(current.hostname, allowLoopback);
    let res;
    try {
      res = await fetchImpl(current, { redirect: 'manual', credentials: 'omit', signal: sig, headers: { 'user-agent': 'Bunny-AI', accept: '*/*' } });
    } catch (err) {
      if (sig.aborted) throw stopped(signal);
      throw new Error(`Could not download: ${err.cause?.code || err.message}`);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!next) throw new Error(`The server redirected (${res.status}) without saying where`);
      if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
      try { current = new URL(next, current); } catch { throw new Error('The server redirected to an invalid address'); }
      continue;
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`The server answered ${res.status}`); }
    const tooBig = () => new Error(`The file is larger than the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit, so nothing was saved.`);
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_DOWNLOAD_BYTES) { await res.body?.cancel().catch(() => {}); throw tooBig(); }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body ?? []) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) { await res.body.cancel().catch(() => {}); throw tooBig(); }
        chunks.push(chunk);
      }
    } catch (err) {
      if (err.message.includes('MB limit')) throw err;
      if (sig.aborted) throw stopped(signal);
      throw new Error(`The download was interrupted: ${err.message}`);
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim() || 'unknown';
    return { bytes: Buffer.concat(chunks), type, url: current.href };
  }
}
