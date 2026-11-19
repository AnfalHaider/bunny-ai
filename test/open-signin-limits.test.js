import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteAccess, createScryptGate, INTERNET_COOKIE, INTERNET_GLOBAL_LIMIT, INTERNET_IDLE_MS, INTERNET_MAX_AGE_MS, STRONG_KDF, SCRYPT_MAXMEM, hashPasscode, verifyPasscode, needsStrongerHash } from '../src/server/remoteAccess.js';

// OPEN-SIGNIN step 1 (OS-3, OS-4): the internet instance's own limits, the shared scrypt gate and the passcode cost. No network, no files.
const PASS = 'correct horse battery staple';
const HOST = 'bunny.tail1234.ts.net';
const internet = (extra = {}) => {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const access = createRemoteAccess({ now: clock.now, via: 'internet', cookieName: INTERNET_COOKIE, secureCookie: true, globalLimit: INTERNET_GLOBAL_LIMIT, limits: () => ({ idleMs: INTERNET_IDLE_MS, maxAgeMs: INTERNET_MAX_AGE_MS }), ...extra });
  return { access, clock };
};
const open = async (access) => { assert.equal((await access.enable({ lanHost: HOST, lanAddress: null, passcode: PASS })).ok, true); };
const wrong = (access, ip, n = 1) => Promise.all(Array.from({ length: n }, () => access.signIn(ip, 'nope')));

test('OS-3: 10 wrong passcodes in 10 minutes pause every new internet sign-in, the wait doubles up to an hour, and signed-in sessions keep working', async () => {
  const { access, clock } = internet();
  await open(access);
  const first = await access.signIn('1.1.1.1', PASS);
  assert.equal(first.ok, true);
  for (let i = 0; i < 10; i++) { await access.signIn(`9.9.9.${i}`, 'nope'); } // ten different visitors, so no single one is waiting
  const paused = await access.signIn('8.8.8.8', PASS);
  assert.equal(paused.status, 429);
  assert.ok(paused.waitSeconds >= 55 && paused.waitSeconds <= 60, `one minute, got ${paused.waitSeconds}`);
  assert.ok(access.sessionFor(`${INTERNET_COOKIE}=${first.secret}`), 'a signed-in session is not affected');
  clock.advance(61_000);
  assert.equal((await access.signIn('8.8.8.8', PASS)).ok, true, 'after the wait the right passcode signs in');
  // a wrong try inside the same 10-minute window starts the second wait, twice as long
  await access.signIn('7.7.7.7', 'nope');
  const second = await access.signIn('6.6.6.6', PASS);
  assert.equal(second.status, 429);
  assert.ok(second.waitSeconds > 100 && second.waitSeconds <= 120, `two minutes, got ${second.waitSeconds}`);
});

test('OS-3: the wait never goes over an hour, and Reset (the window) clears it', async () => {
  const { access, clock } = internet({ globalLimit: { ...INTERNET_GLOBAL_LIMIT, shutoff: { fails: 1000, perMs: 24 * 3_600_000 } } });
  await open(access);
  for (let round = 0; round < 9; round++) {
    for (let i = 0; i < 10; i++) await access.signIn(`5.5.${round}.${i}`, 'nope');
    clock.advance(access.waitSeconds * 1000 + 1000);
  }
  assert.ok(access.waitSeconds <= 3600);
  for (let i = 0; i < 10; i++) await access.signIn(`4.4.4.${i}`, 'nope');
  assert.ok(access.waitSeconds > 0 && access.waitSeconds <= 3600);
  access.resetWait();
  assert.equal(access.waitSeconds, 0);
  assert.equal((await access.signIn('3.3.3.3', PASS)).ok, true);
});

test('OS-3: the home network keeps signing in while the internet is paused (separate counters)', async () => {
  const { access } = internet();
  let t = 5_000_000;
  const lan = createRemoteAccess({ now: () => t });
  await open(access);
  assert.equal((await lan.enable({ lanHost: '192.168.1.5:1', lanAddress: '192.168.1.5', passcode: PASS })).ok, true);
  for (let i = 0; i < 10; i++) await access.signIn(`2.2.2.${i}`, 'nope');
  assert.equal((await access.signIn('1.2.3.4', PASS)).status, 429);
  assert.equal((await lan.signIn('192.168.1.9', PASS)).ok, true);
});

test('OS-3: 100 wrong passcodes in 24 hours turn the route off by itself, end every session, call onShutoff, and only clearShutoff clears it', async () => {
  let fired = 0;
  const { access, clock } = internet({ onShutoff: () => { fired += 1; } });
  await open(access);
  const kept = await access.signIn('1.1.1.1', PASS);
  assert.equal(kept.ok, true);
  for (let i = 0; i < 100 && access.enabled; i++) { await access.signIn(`10.0.${Math.floor(i / 250)}.${i % 250}`, 'nope'); clock.advance(access.waitSeconds * 1000 + 1); }
  assert.equal(access.enabled, false, 'the route closed itself');
  assert.equal(fired, 1);
  assert.ok(access.shutoffAt, 'the shut-off is remembered');
  assert.equal(access.sessionFor(`${INTERNET_COOKIE}=${kept.secret}`), null, 'every session ended');
  assert.equal((await access.signIn('1.1.1.1', PASS)).status, 403);
  access.clearShutoff();
  assert.equal(access.shutoffAt, null);
  const log = await access.actions();
  assert.ok(log.some((e) => e.kind === 'shutoff' && e.via === 'internet'));
});

test('OS-3 (5.3): the shared scrypt gate lets at most 2 internet and 4 overall hash at once, and releases when done', () => {
  const gate = createScryptGate({ internet: 2, total: 4 });
  const a = gate.acquire('internet');
  const b = gate.acquire('internet');
  assert.equal(gate.acquire('internet'), null, 'a third internet hash gets no slot');
  const c = gate.acquire('lan');
  const d = gate.acquire('lan');
  assert.equal(gate.acquire('lan'), null, 'a fifth overall gets no slot');
  a();
  a(); // releasing twice frees only one slot
  assert.equal(gate.active.all, 3);
  const again = gate.acquire('internet');
  assert.ok(again, 'a freed internet slot can be taken again');
  [b, c, d, again].forEach((release) => release());
  assert.deepEqual(gate.active, { all: 0, internet: 0 });
});

test('OS-3: a sign-in with no gate slot gets a 429 and does not spend one of the visitor\'s tries', async () => {
  const gate = createScryptGate({ internet: 0, total: 4 });
  const { access } = internet({ scrypt: gate });
  await open(access);
  for (let i = 0; i < 8; i++) assert.equal((await access.signIn('1.1.1.1', 'nope')).status, 429);
  const open2 = createScryptGate({ internet: 2, total: 4 });
  const { access: other } = internet({ scrypt: open2 });
  await open(other);
  assert.equal((await other.signIn('1.1.1.1', PASS)).ok, true);
  assert.deepEqual(open2.active, { all: 0, internet: 0 });
});

test('OS-3: 60 parallel wrong passcodes from one visitor give at most the allowed 401s, then waits', async () => {
  const { access } = internet();
  await open(access);
  const results = await wrong(access, '1.1.1.1', 60);
  assert.ok(results.filter((r) => r.status === 401).length <= 5, 'a visitor has 5 tries in all');
  assert.ok(results.filter((r) => r.status === 429).length >= 55);
});

test('OS-4: a record keeps its own cost, N=65536 needs the larger maxmem and works, and an older record is read at its own cost', async () => {
  const strong = await hashPasscode(PASS, STRONG_KDF);
  assert.equal(strong.N, 65536);
  assert.ok(SCRYPT_MAXMEM >= 128 * 1024 * 1024);
  assert.equal(await verifyPasscode(PASS, strong), true, 'a sign-in at N=65536 does not throw');
  assert.equal(await verifyPasscode('wrong', strong), false);
  const old = await hashPasscode(PASS);
  assert.equal(old.N, 16384);
  assert.equal(await verifyPasscode(PASS, old), true, 'the cost comes from the record, not from the module');
  assert.equal(needsStrongerHash(old), true);
  assert.equal(needsStrongerHash(strong), false);
  assert.equal(needsStrongerHash(null), true);
  assert.equal(await verifyPasscode(PASS, { ...strong, N: 2 ** 30 }), false, 'a record asking for an absurd cost is refused, not run');
});

test('OS-4: an old record is rehashed at the new cost after one confirmation (verify, then setPasscode)', async () => {
  const { access } = internet();
  await access.enable({ lanHost: HOST, lanAddress: null, passcode: PASS }); // saved at today's cost
  assert.equal(await access.needsStrongPasscode(), true);
  assert.equal(await access.verify(PASS), true);
  await access.setPasscode(PASS, STRONG_KDF);
  assert.equal(await access.needsStrongPasscode(), false);
  assert.equal(access.passcodeRecord.N, 65536);
  assert.equal(await access.verify(PASS), true);
});
