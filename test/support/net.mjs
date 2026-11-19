// For the few tests that need a name to resolve: point it at a local test server on 127.0.0.1. (Injecting lookupImpl / fetchImpl stays the better way.)
const KEY = Symbol.for('bunny.testNetwork');
const state = () => globalThis[KEY];

/** Let `name` resolve to `address` (a loopback address only) in this process, until resetHosts(). */
export function allowHost(name, address = '127.0.0.1') {
  if (!/^127\./.test(address) && address !== '::1') throw new Error('allowHost only points a name at loopback; a test must never reach another computer.');
  const s = state();
  if (!s) return; // BUNNY_TEST_NETWORK=1: the real network is on, nothing to register
  s.hosts.set(String(name).trim().toLowerCase().replace(/\.$/, ''), address);
}

export function resetHosts() { state()?.hosts.clear(); }
