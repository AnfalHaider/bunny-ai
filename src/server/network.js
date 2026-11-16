/**
 * Is this computer online? (T-3)
 *
 * A bare request to a few neutral hosts, in parallel, each with its own short limit. ANY answer at all (even an
 * error page) means the network is up; only when every one fails to connect is the computer offline. Nothing from
 * the person is sent: no chat, key or profile detail, no cookies, no body. The window asks this only after a first
 * failure, never on every send. The hosts are listed here, in one place, and named in the help text for the setting.
 */
export const PROBE_ENDPOINTS = [
  'https://www.gstatic.com/generate_204',
  'https://cp.cloudflare.com/generate_204',
  'https://captive.apple.com/hotspot-detect.html',
];

/** @returns {Promise<{ online: boolean }>} */
export async function probeNetwork({ fetchImpl = globalThis.fetch, endpoints = PROBE_ENDPOINTS, timeoutMs = 3000 } = {}) {
  const attempts = (Array.isArray(endpoints) ? endpoints : []).map(async (endpoint) => {
    let url;
    try {
      url = new URL(String(endpoint));
    } catch {
      throw new Error('not an address'); // a malformed entry is one failed probe, never an exception
    }
    if (url.protocol !== 'https:') throw new Error('not https');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetchImpl(url, { method: 'GET', cache: 'no-store', redirect: 'manual', credentials: 'omit', signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    await Promise.any(attempts);
    return { online: true };
  } catch {
    return { online: false };
  }
}
