// TEST-DNS: a unit test never waits on the real network. Loaded before every test file (node --import), also in child node processes (NODE_OPTIONS).
//
// - dns.lookup / dns.promises.lookup / dns.resolve*: answer AT ONCE. localhost and *.localhost resolve to loopback, an IP literal to itself, a name a test registered
//   with allowHost() to its (loopback) address; every other name fails with ENOTFOUND exactly as Node's own error looks. So a name nobody can resolve costs
//   under a millisecond on every PC, not the 12 s a slow resolver takes.
// - net.Socket.prototype.connect (net, tls, http and undici's fetch all go through it): a connect to an IP literal that is not loopback fails at once with
//   ECONNREFUSED and says which file tried: "NO-NETWORK: <file> tried to reach <address>:<port>".
// BUNNY_TEST_NETWORK=1 turns it off, for a person who runs one file against the real network on purpose (scripts/unit-tests.mjs refuses to start with it set).
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { getSystemErrorMap } from 'node:util';

const KEY = Symbol.for('bunny.testNetwork');
if (process.env.BUNNY_TEST_NETWORK !== '1' && !globalThis[KEY]) {
  const hosts = new Map(); // name -> loopback address, from allowHost()
  globalThis[KEY] = { hosts };

  const errno = (name) => { for (const [n, [code]] of getSystemErrorMap()) if (code === name) return n; return undefined; };
  const notFound = (hostname, syscall = 'getaddrinfo') => Object.assign(new Error(`${syscall} ENOTFOUND ${hostname}`), { errno: errno('EAI_NONAME') ?? -3008, code: 'ENOTFOUND', syscall, hostname });
  const refused = (address, port) => Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), { errno: errno('ECONNREFUSED') ?? -4078, code: 'ECONNREFUSED', syscall: 'connect', address, port });

  const isLoopback = (ip) => {
    const a = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    if (net.isIPv4(a)) return a.startsWith('127.');
    if (net.isIPv6(a)) return a === '::1' || /^::ffff:127\./.test(a);
    return false;
  };
  const loopbackName = (h) => h === 'localhost' || h.endsWith('.localhost');

  /** What a lookup of this name answers, or null when it is not one Bunny's tests may resolve. [{address, family}] */
  const answerFor = (hostname, options) => {
    const h = String(hostname).trim().toLowerCase().replace(/\.$/, '');
    const family = typeof options === 'number' ? options : Number(options?.family) || 0;
    let list = null;
    if (net.isIP(h)) list = [{ address: h, family: net.isIP(h) }];
    else if (loopbackName(h)) list = [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];
    else if (hosts.has(h)) { const address = hosts.get(h); list = [{ address, family: net.isIP(address) }]; }
    if (!list) return null;
    if (family === 4 || family === 6) list = list.filter((x) => x.family === family);
    return list;
  };
  const toLookupResult = (list, options) => (options && typeof options === 'object' && options.all ? list : list[0]);

  const lookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (!hostname) return originalLookup(hostname, options, callback); // Node's own answer for an empty name
    const list = answerFor(hostname, options);
    process.nextTick(() => {
      if (!list || !list.length) return callback(notFound(hostname));
      const out = toLookupResult(list, options);
      if (Array.isArray(out)) callback(null, out); else callback(null, out.address, out.family);
    });
  };
  const originalLookup = dns.lookup;
  const originalLookupPromise = dnsPromises.lookup; // kept before patching: Node's own answer for an empty name
  const lookupPromise = async (hostname, options) => {
    if (!hostname) return originalLookupPromise.call(dnsPromises, hostname, options);
    const list = answerFor(hostname, options);
    if (!list || !list.length) throw notFound(hostname);
    return toLookupResult(list, options);
  };
  dns.lookup = lookup;
  dns.promises.lookup = lookupPromise;
  dnsPromises.lookup = lookupPromise;

  // resolve*: loopback names answer, everything else is not found, at once
  for (const [fn, family] of [['resolve', 0], ['resolve4', 4], ['resolve6', 6], ['resolveAny', 0], ['resolveCname', -1], ['resolveMx', -1], ['resolveNs', -1], ['resolveTxt', -1], ['resolveSrv', -1], ['resolveNaptr', -1], ['resolveSoa', -1], ['resolvePtr', -1], ['reverse', -1]]) {
    const syscall = fn === 'reverse' ? 'getHostByAddr' : `query${fn.replace(/^resolve/, '') || 'A'}`;
    const answer = (name) => {
      const list = family >= 0 ? answerFor(name, family) : null;
      return list && list.length ? list.map((x) => x.address) : null;
    };
    dns[fn] = (name, ...rest) => {
      const callback = rest.at(-1);
      const got = answer(name);
      process.nextTick(() => (typeof callback === 'function' ? (got ? callback(null, got) : callback(notFound(name, syscall))) : undefined));
    };
    const promised = async (name) => { const got = answer(name); if (!got) throw notFound(name, syscall); return got; };
    dns.promises[fn] = promised;
    dnsPromises[fn] = promised;
  }

  // sockets: only loopback is reachable
  const originalConnect = net.Socket.prototype.connect;
  const fileOf = () => { const f = process.argv.find((a, i) => i > 0 && /\.(test\.)?[mc]?js$/.test(a)); return f ? basename(f) : basename(process.argv[1] ?? 'a test'); };
  net.Socket.prototype.connect = function connect(...args) {
    let options; // Node passes its own already-normalised array to connect()
    try { options = (Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args))[0]; } catch { return originalConnect.apply(this, args); }
    if (options.path || !options.port) return originalConnect.apply(this, args); // a pipe, or a call Node itself refuses
    const host = String(options.host ?? 'localhost');
    if (net.isIP(host) && !isLoopback(host)) {
      process.stderr.write(`NO-NETWORK: ${fileOf()} tried to reach ${host}:${options.port}\n`);
      process.nextTick(() => this.destroy(refused(host, options.port)));
      return this;
    }
    return originalConnect.apply(this, args);
  };
  void os;

  syncBuiltinESMExports();
}

export {};
