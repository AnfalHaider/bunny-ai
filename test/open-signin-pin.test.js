import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClientIpHeader, checkHttpsName, internetPin, pinHost } from '../src/server/internetPin.js';

// OPEN-SIGNIN step 2 (OS-2, OS-6): what the internet listener trusts about a request. Pure: no sockets.
const NAME = 'pc.tail1234.ts.net';
const req = (headers = {}, peer = '127.0.0.1') => ({ headers: { host: NAME, 'tailscale-funnel-request': '?1', ...headers }, socket: { remoteAddress: peer } });
const funnel = (extra = {}) => internetPin({ route: 'funnel', name: () => NAME, ...extra });
const own = (extra = {}) => internetPin({ route: 'https', name: () => 'bunny.example.com', ...extra });
const ownReq = (headers = {}, peer = '127.0.0.1') => ({ headers: { host: 'bunny.example.com', ...headers }, socket: { remoteAddress: peer } });

test('OS-2 Funnel: a request with the right Host, from the loopback peer, with the Funnel header, passes; the visitor is "unknown" until X-Forwarded-For is trusted', () => {
  const check = funnel();
  const ok = check(req({ 'x-forwarded-for': '203.0.113.7' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.ip, 'unknown', 'X-Forwarded-For is ignored while trustForwardedFor is false');
  assert.equal(ok.origin, `https://${NAME}`);
});

test('OS-2 Funnel: a missing or wrong Tailscale-Funnel-Request is refused, and so is a peer that is not loopback', () => {
  const check = funnel();
  const { 'tailscale-funnel-request': _drop, ...noHeader } = req().headers;
  assert.equal(check({ headers: noHeader, socket: { remoteAddress: '127.0.0.1' } }).ok, false);
  assert.equal(check({ headers: noHeader, socket: { remoteAddress: '127.0.0.1' } }).code, 'request.notFunnel');
  assert.equal(check(req({ 'tailscale-funnel-request': '1' })).ok, false);
  assert.equal(check(req({}, '192.168.1.20')).ok, false);
  assert.equal(check(req({}, '203.0.113.7')).code, 'request.badHost');
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(check(req({}, peer)).ok, true, `${peer} is loopback`);
});

test('OS-2 Funnel: with trustForwardedFor the right-most X-Forwarded-For entry is the visitor (a prepended fake is ignored); a bad value is "unknown"', () => {
  const check = funnel({ trustForwardedFor: true });
  assert.equal(check(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })).ip, '203.0.113.7');
  assert.equal(check(req({ 'x-forwarded-for': 'not an address' })).ip, 'unknown');
  assert.equal(check(req({ 'x-forwarded-for': '2001:db8::1' })).ip, '2001:db8::1');
  assert.equal(check(req()).ip, 'unknown');
});

test('OS-2 own HTTPS: only the named header counts, X-Forwarded-For never does, and a bad value is "unknown"', () => {
  assert.equal(own({ clientIpHeader: () => 'CF-Connecting-IP' })(ownReq({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '1.1.1.1' })).ip, '198.51.100.9');
  assert.equal(own()(ownReq({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '1.1.1.1' })).ip, 'unknown', 'with no header named, every visitor is unknown');
  assert.equal(own({ clientIpHeader: () => 'X-Forwarded-For' })(ownReq({ 'x-forwarded-for': '1.1.1.1' })).ip, 'unknown', 'X-Forwarded-For cannot be chosen');
  assert.equal(own({ clientIpHeader: () => 'CF-Connecting-IP' })(ownReq({ 'cf-connecting-ip': 'evil, 1.1.1.1' })).ip, 'unknown');
  assert.equal(own()(ownReq({}, '10.0.0.4')).ok, false, 'a peer that is not loopback is refused here too');
  assert.equal(own()(ownReq()).ok, true, 'no Funnel header is needed on the own-HTTPS route');
});

test('OS-2/OS-6: Host must equal the pin, X-Forwarded-Host too; X-Forwarded-Proto and -Host never change the pin; Origin and Sec-Fetch-Site are checked', () => {
  const check = funnel();
  assert.equal(check(req({ host: '127.0.0.1:5173' })).code, 'request.badHost', 'a direct request to the loopback port is refused');
  assert.equal(check(req({ host: 'evil.example.com' })).ok, false, 'a DNS-rebinding page has the wrong Host');
  assert.equal(check(req({ host: `${NAME}:8443` })).ok, false);
  assert.equal(check(req({ host: undefined })).ok, false);
  assert.equal(check(req({ 'x-forwarded-host': 'evil.example.com' })).ok, false);
  assert.equal(check(req({ 'x-forwarded-host': NAME.toUpperCase() })).ok, true, 'the same name in another case is the same name');
  assert.equal(check(req({ 'x-forwarded-proto': 'http' })).origin, `https://${NAME}`, 'X-Forwarded-Proto never builds the origin');
  assert.equal(check(req({ origin: `https://${NAME}` })).ok, true);
  assert.equal(check(req({ origin: `http://${NAME}` })).code, 'request.badOrigin');
  assert.equal(check(req({ origin: 'https://evil.example.com' })).code, 'request.badOrigin');
  assert.equal(check(req({ 'sec-fetch-site': 'cross-site' })).code, 'request.badOrigin');
  assert.equal(check(req({ 'sec-fetch-site': 'same-site' })).ok, false);
  for (const site of ['same-origin', 'none']) assert.equal(check(req({ 'sec-fetch-site': site })).ok, true);
});

test('OS-6: the pinned name is read at every request, with a port other than 443 in the Host', () => {
  let name = NAME;
  let port = 443;
  const check = internetPin({ route: 'https', name: () => name, port: () => port });
  assert.equal(check({ headers: { host: NAME }, socket: { remoteAddress: '127.0.0.1' } }).ok, true);
  port = 8443;
  assert.equal(check({ headers: { host: NAME }, socket: { remoteAddress: '127.0.0.1' } }).ok, false);
  assert.equal(check({ headers: { host: `${NAME}:8443` }, socket: { remoteAddress: '127.0.0.1' } }).ok, true);
  name = '';
  assert.equal(check({ headers: { host: `${NAME}:8443` }, socket: { remoteAddress: '127.0.0.1' } }).ok, false, 'no name pinned: nothing passes');
  assert.equal(pinHost('a.example.com', 443), 'a.example.com');
  assert.equal(pinHost('a.example.com', 8443), 'a.example.com:8443');
});

test('OS-6: invalid own-HTTPS names are refused when saved (wildcard, IP, localhost, scheme, path, bad labels, bad ports)', () => {
  const bad = ['', '*.example.com', 'https://bunny.example.com', 'bunny.example.com/path', '192.168.1.5', '10.0.0.1:8443', 'localhost', 'app.localhost', 'single', 'a_b.example.com', '-a.example.com', 'bunny.example.com:80', 'bunny.example.com:99999', 'bunny.example.com:abc', 'x'.repeat(64) + '.example.com', 'user@bunny.example.com', 'bunny example.com', '1.2.3.4.5'];
  for (const value of bad) assert.equal(checkHttpsName(value).ok, false, `"${value}" must be refused`);
  assert.deepEqual(checkHttpsName(' Bunny.Example.com '), { ok: true, name: 'bunny.example.com', port: 443 });
  assert.deepEqual(checkHttpsName('bunny.example.com.'), { ok: true, name: 'bunny.example.com', port: 443 }, 'a trailing dot is removed');
  assert.equal(checkHttpsName('bunny.example.com:8443').port, 8443);
  assert.equal(checkHttpsName('bunny.example.com:10000').port, 10000);
  assert.equal(checkHttpsName(`${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(20)}`).ok, false, 'over 253 characters');
});

test('OS-2: the visitor-address header the person names: letters, digits and -, at most 40, never X-Forwarded-For', () => {
  assert.deepEqual(checkClientIpHeader(''), { ok: true, value: '' });
  assert.deepEqual(checkClientIpHeader('CF-Connecting-IP'), { ok: true, value: 'CF-Connecting-IP' });
  for (const value of ['X-Forwarded-For', 'x-forwarded-for', 'a b', 'a'.repeat(41), 'bad_name', 'a:b']) assert.equal(checkClientIpHeader(value).ok, false, value);
});
