// A stand-in for a PC whose resolver is slow: every lookup of a name that is not an IP literal or localhost fails with ENOTFOUND after BUNNY_SLOW_DNS_MS
// (12 s by default, what the gate PC took). It is injected only in the process that asks for it (node --import test/support/slow-resolver.mjs), never by the runner:
// it shows what the unit tests would cost without test/support/no-network.mjs, and that no-network.mjs, loaded after it, makes the cost independent of it.
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const delay = Number(process.env.BUNNY_SLOW_DNS_MS ?? 12_000);
const fail = (hostname) => Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { errno: -3008, code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname });
const real = dns.lookup;

dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (!hostname || net.isIP(hostname) || /^localhost$/i.test(hostname)) return real.call(dns, hostname, options, callback);
  setTimeout(() => callback(fail(hostname)), delay); // referenced: the process waits, as it does for a real slow answer
};
const slowPromise = (hostname, options) => new Promise((resolve, reject) => dns.lookup(hostname, options, (err, address, family) => (err ? reject(err) : resolve(typeof address === 'object' ? address : { address, family }))));
dns.promises.lookup = slowPromise;
dnsPromises.lookup = slowPromise;
syncBuiltinESMExports();
