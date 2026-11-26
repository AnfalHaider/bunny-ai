/**
 * Bunny's own server, as an address: this PC's loopback in any spelling a browser or an HTTP client accepts, at Bunny's port.
 * Nothing the model or a web page names may be fetched from it: its pages hold the launch token and the person's chats
 * (W610-1, W6-24). Other local servers (a dev server on another port) are not covered.
 */
import { isIP } from 'node:net';

const OWN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0', '[::]', '::']);

/** The ports Bunny's server listens on in this process (set by the app when it starts listening). */
export const ownPorts = new Set();
export const registerOwnPort = (port) => { if (Number(port) > 0) ownPorts.add(String(port)); };

const defaultPort = (u) => u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? '443' : '80');

/** Is this address (URL text or URL) the loopback of this PC at the given port? */
export function isBunnyOwn(value, ownPort) {
  if (!ownPort) return false;
  try {
    const u = value instanceof URL ? value : new URL(String(value));
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    // the URL parser writes an IPv4-mapped address in hex: http://[::ffff:127.0.0.1]/ is [::ffff:7f00:1] (and the compatible form [::7f00:1])
    const mapped = /^\[::(?:ffff:)?(?:7f[0-9a-f]{2}|0):[0-9a-f]{1,4}\]$/.test(host);
    const loopback = OWN_HOSTS.has(host) || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host) || mapped;
    return loopback && defaultPort(u) === String(ownPort);
  } catch { return false; }
}

/** Is this address Bunny's own server, at any port it is listening on? */
export const isOwnServer = (value) => [...ownPorts].some((port) => isBunnyOwn(value, port));

/** Is this resolved IP (not a name) a loopback address of this PC? */
export function isLoopbackAddress(ip) {
  const a = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(a) === 4) return /^127\./.test(a) || a === '0.0.0.0';
  if (isIP(a) !== 6) return false;
  return a === '::1' || a === '::' || /^::(?:ffff:)?(?:7f[0-9a-f]{2}|0):[0-9a-f]{1,4}$/.test(a) || /^::ffff:127\./.test(a);
}

// ---- LOCAL-MODELS LM-17: the model runtime's port is Bunny's own business, like Bunny's server. Nothing a model, a page or a device names may reach it.
import { lookup as dnsLookup } from 'node:dns/promises';

/** The ports the model runtime (llama-server) is listening on right now. The runtime code adds a port when it starts and removes it when it stops. */
export const runtimePorts = new Set();
export const registerRuntimePort = (port) => { if (Number(port) > 0) runtimePorts.add(String(port)); };
export const unregisterRuntimePort = (port) => { runtimePorts.delete(String(port)); };

/** Is this address the runtime, on any loopback spelling (127.0.0.0/8, 0.0.0.0, ::1, localhost., [::ffff:127.0.0.1]) at a live runtime port? Decided on the text. */
export const isRuntimeAddress = (value) => [...runtimePorts].some((port) => isBunnyOwn(value, port));

/** Bunny's own server or the model runtime. */
export const isReservedAddress = (value) => isOwnServer(value) || isRuntimeAddress(value);

/**
 * The same, decided after the host name is resolved (Security R2-2): a name that resolves to a loopback address, at the runtime's or Bunny's port, is refused too.
 * A name that cannot be resolved is not reserved here (it cannot connect either). `resolve` is a stand-in for tests.
 */
export async function isReservedAddressResolved(value, resolve = (host) => dnsLookup(host, { all: true })) {
  if (isReservedAddress(value)) return true;
  let u;
  try { u = value instanceof URL ? value : new URL(String(value)); } catch { return false; }
  const ports = [...ownPorts, ...runtimePorts];
  if (!ports.length) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return false; // an address was judged above
  const port = u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? '443' : '80');
  if (!ports.includes(port)) return false;
  try { return (await resolve(host)).some((a) => isLoopbackAddress(a.address)); } catch { return false; }
}
