import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COOKIE, EVERYTHING_IDLE_MS, INTERNET_COOKIE, INTERNET_IDLE_MS, INTERNET_MAX_AGE_MS, KEEP_MAX_AGE_SECONDS, SESSION_IDLE_MS, createRemoteAccess } from '../src/server/remoteAccess.js';

// OPEN-SIGNIN step 1 (OS-5, OS-1): the cookie flags, the session limits, and "Keep devices signed in" (only hashes are saved). Fake clock, real files in a temp folder.
const PASS = 'correct horse battery staple';
const HOUR = 3_600_000;
const MIN = 60_000;
const folder = (t) => { const dir = mkdtempSync(join(tmpdir(), 'bunny-keep-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

function make({ via, keep = { on: false }, dir = null, clock }) {
  const net = via === 'internet';
  return createRemoteAccess({
    now: clock.now, via, file: dir ? join(dir, 'remote-access.json') : null,
    cookieName: net ? INTERNET_COOKIE : COOKIE, secureCookie: net,
    persist: dir ? { file: join(dir, `remote-sessions-${via}.json`) } : null,
    limits: () => (keep.on ? { keep: true } : net ? { idleMs: INTERNET_IDLE_MS, maxAgeMs: INTERNET_MAX_AGE_MS } : {}),
  });
}
const clockAt = (start = 10_000_000) => { let t = start; return { now: () => t, advance: (ms) => { t += ms; } }; };
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('OS-5: the internet cookie is __Host-, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain; the home network keeps today\'s cookie with no Secure', async () => {
  const clock = clockAt();
  const net = make({ via: 'internet', clock: { now: () => clock.now() } });
  const lan = make({ via: 'lan', clock: { now: () => clock.now() } });
  assert.equal(net.cookieFor('abc'), `__Host-bunny_remote=abc; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${INTERNET_IDLE_MS / 1000}`);
  assert.ok(!/Domain/i.test(net.cookieFor('abc')));
  assert.equal(lan.cookieFor('abc'), `bunny_remote=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_MS / 1000}`, 'byte for byte today\'s home-network cookie');
  assert.equal(net.clearCookie(), '__Host-bunny_remote=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  assert.equal(lan.clearCookie(), 'bunny_remote=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
});

test('OS-1: a home-network cookie is never found in the internet instance, and the other way round (each keeps its own sessions and cookie name)', async () => {
  const clock = clockAt();
  const net = make({ via: 'internet', clock });
  const lan = make({ via: 'lan', clock });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  await lan.enable({ lanHost: '192.168.1.5:1', lanAddress: '192.168.1.5', passcode: PASS });
  const a = await net.signIn('1.1.1.1', PASS);
  const b = await lan.signIn('192.168.1.9', PASS);
  assert.ok(net.sessionFor(cookieOf(net.cookieFor(a.secret))));
  assert.equal(lan.sessionFor(cookieOf(net.cookieFor(a.secret))), null, 'an internet cookie is not a home-network session');
  assert.equal(net.sessionFor(cookieOf(lan.cookieFor(b.secret))), null, 'a home-network cookie is not an internet session');
  assert.equal(net.sessionFor(`${COOKIE}=${a.secret}`), null, 'the wrong cookie NAME is not read');
  assert.equal(net.list()[0].via, 'internet');
  assert.equal(lan.list()[0].via, 'lan');
});

test('OS-5: with "Keep devices signed in" OFF an internet session ends after 30 minutes idle and after 12 hours even while it is used', async () => {
  const clock = clockAt();
  const net = make({ via: 'internet', clock });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  const idle = await net.signIn('1.1.1.1', PASS);
  clock.advance(29 * MIN);
  assert.ok(net.sessionFor(`${INTERNET_COOKIE}=${idle.secret}`), 'used inside 30 minutes');
  clock.advance(31 * MIN);
  assert.equal(net.sessionFor(`${INTERNET_COOKIE}=${idle.secret}`), null, '30 minutes idle ends it');
  const busy = await net.signIn('1.1.1.1', PASS);
  for (let i = 1; i < 36; i++) { clock.advance(20 * MIN); assert.ok(net.sessionFor(`${INTERNET_COOKIE}=${busy.secret}`), `still in at ${i * 20} minutes, used every 20`); } // 11 h 40 min, used all along
  clock.advance(20 * MIN + 1);
  assert.equal(net.sessionFor(`${INTERNET_COOKIE}=${busy.secret}`), null, '12 hours ends it even with activity');
  assert.equal(INTERNET_MAX_AGE_MS, 12 * HOUR);
});

test('OS-5: "Keep devices signed in" ON: a 400-day cookie, no idle or maximum end, Everything has no 30-minute drop', async () => {
  const clock = clockAt();
  const keep = { on: true };
  const net = make({ via: 'internet', clock, keep });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  const s = await net.signIn('1.1.1.1', PASS);
  assert.match(net.cookieFor(s.secret), new RegExp(`Max-Age=${KEEP_MAX_AGE_SECONDS}$`));
  net.setLevel(s.session.deviceId, 'everything');
  clock.advance(1000 * HOUR);
  assert.ok(net.sessionFor(`${INTERNET_COOKIE}=${s.secret}`), 'no idle limit and no maximum');
  assert.equal(net.list()[0].level, 'everything', 'Everything did not drop');
});

test('OS-5: with the option on, the saved file holds only SHA-256 hashes, never the cookie value, and a restart keeps the session', async (t) => {
  const dir = folder(t);
  const clock = clockAt();
  const keep = { on: true };
  const first = make({ via: 'internet', clock, keep, dir });
  await first.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  const s = await first.signIn('1.1.1.1', PASS);
  await first.flushSessions();
  const text = readFileSync(join(dir, 'remote-sessions-internet.json'), 'utf8');
  assert.ok(!text.includes(s.secret), 'the raw cookie value is never written');
  assert.match(text, /"sha256":"[0-9a-f]{64}"/);
  // Bunny restarts: a new instance reads the saved sessions back when the route opens again
  const second = make({ via: 'internet', clock, keep, dir });
  assert.equal((await second.enable({ lanHost: 'x.ts.net', lanAddress: null })).ok, true);
  const back = second.sessionFor(`${INTERNET_COOKIE}=${s.secret}`);
  assert.ok(back, 'the session survived the restart');
  assert.equal(back.deviceId, s.session.deviceId);
  assert.equal(second.sessionFor(`${INTERNET_COOKIE}=${'0'.repeat(64)}`), null, 'another cookie finds nothing');
});

test('OS-5: with the option OFF nothing is saved, and a restart signs everyone out', async (t) => {
  const dir = folder(t);
  const clock = clockAt();
  const net = make({ via: 'internet', clock, dir });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  const s = await net.signIn('1.1.1.1', PASS);
  await net.flushSessions();
  assert.equal(existsSync(join(dir, 'remote-sessions-internet.json')), false);
  const again = make({ via: 'internet', clock, dir });
  await again.enable({ lanHost: 'x.ts.net', lanAddress: null });
  assert.equal(again.sessionFor(`${INTERNET_COOKIE}=${s.secret}`), null);
});

test('OS-5: each of these ends the session and deletes its saved hash: sign out, sign out all, a passcode change, the route off, and the shut-off', async (t) => {
  const file = (dir) => join(dir, 'remote-sessions-internet.json');
  const scenarios = {
    'sign out': async (net, s) => { net.signOutDevice(s.session.deviceId); },
    'sign out the cookie': async (net, s) => { net.signOutSecret(s.secret); },
    'sign out all': async (net) => { net.signOutAll(); },
    'a passcode change': async (net) => { await net.setPasscode('another passcode, quite different'); },
    'the route off': async (net) => { net.disable(); },
  };
  for (const [name, end] of Object.entries(scenarios)) {
    const dir = folder(t);
    const clock = clockAt();
    const keep = { on: true };
    const net = make({ via: 'internet', clock, keep, dir });
    await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
    const s = await net.signIn('1.1.1.1', PASS);
    await net.flushSessions();
    assert.equal(existsSync(file(dir)), true, `${name}: saved first`);
    await end(net, s);
    await net.flushSessions();
    assert.equal(existsSync(file(dir)), false, `${name}: the saved hash is gone`);
    assert.equal(net.sessionFor(`${INTERNET_COOKIE}=${s.secret}`), null, `${name}: the session ended`);
    const later = make({ via: 'internet', clock, keep, dir });
    await later.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: name === 'a passcode change' ? null : PASS });
    assert.equal(later.sessionFor(`${INTERNET_COOKIE}=${s.secret}`), null, `${name}: it does not come back after a restart`);
  }
});

test('OS-5: turning the option OFF ends every session older than today\'s limits (12 hours on the internet), and drops the saved file', async (t) => {
  const dir = folder(t);
  const clock = clockAt();
  const keep = { on: true };
  const net = make({ via: 'internet', clock, keep, dir });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  const old = await net.signIn('1.1.1.1', PASS);
  clock.advance(13 * HOUR);
  const fresh = await net.signIn('1.1.1.1', PASS);
  keep.on = false;
  assert.equal(net.sessionFor(`${INTERNET_COOKIE}=${old.secret}`), null, 'older than 12 hours: ended');
  assert.ok(net.sessionFor(`${INTERNET_COOKIE}=${fresh.secret}`), 'inside the limits: stays');
  await net.saveSessions();
  assert.equal(existsSync(join(dir, 'remote-sessions-internet.json')), false, 'nothing is kept while the option is off');
});

test('OS-5 (home network, 705e7cf): with the option on a LAN Chats session is valid after 3 hours and an Everything one after 45 minutes, and both survive a restart; off, today\'s 2 hour and 30 minute limits hold', async (t) => {
  const dir = folder(t);
  const clock = clockAt();
  const keep = { on: true };
  const lan = make({ via: 'lan', clock, keep, dir });
  await lan.enable({ lanHost: '192.168.1.5:1', lanAddress: '192.168.1.5', passcode: PASS });
  const chats = await lan.signIn('192.168.1.9', PASS);
  const all = await lan.signIn('192.168.1.10', PASS);
  lan.setLevel(all.session.deviceId, 'everything');
  clock.advance(3 * HOUR);
  assert.ok(lan.sessionFor(`${COOKIE}=${chats.secret}`));
  assert.ok(lan.sessionFor(`${COOKIE}=${all.secret}`));
  await lan.flushSessions();
  const again = make({ via: 'lan', clock, keep, dir });
  await again.enable({ lanHost: '192.168.1.5:1', lanAddress: '192.168.1.5' });
  assert.ok(again.sessionFor(`${COOKIE}=${chats.secret}`), 'a Chats session survives a restart');
  assert.equal(again.sessionFor(`${COOKIE}=${all.secret}`)?.level, 'everything');
  // a network that is not the saved one: the app forgets the saved sessions
  await again.forgetSaved();
  const other = make({ via: 'lan', clock, keep, dir });
  await other.enable({ lanHost: '10.0.0.5:1', lanAddress: '10.0.0.5' });
  assert.equal(other.sessionFor(`${COOKIE}=${chats.secret}`), null);
  // option off: today's limits
  keep.on = false;
  const off = make({ via: 'lan', clock, keep, dir });
  await off.enable({ lanHost: '192.168.1.5:1', lanAddress: '192.168.1.5', passcode: PASS });
  const a = await off.signIn('192.168.1.9', PASS);
  const b = await off.signIn('192.168.1.10', PASS);
  off.setLevel(b.session.deviceId, 'everything');
  clock.advance(EVERYTHING_IDLE_MS + 1);
  assert.ok(off.sessionFor(`${COOKIE}=${a.secret}`), 'Chats still in after 30 minutes');
  assert.equal(off.sessionFor(`${COOKIE}=${b.secret}`), null, 'Everything drops after 30 minutes idle');
  clock.advance(SESSION_IDLE_MS + 1);
  assert.equal(off.sessionFor(`${COOKIE}=${a.secret}`), null, 'Chats ends after 2 hours idle');
});

test('OS-9: log entries carry via, and the log keeps the names it was given (route, why)', async () => {
  const clock = clockAt();
  const net = make({ via: 'internet', clock });
  await net.enable({ lanHost: 'x.ts.net', lanAddress: null, passcode: PASS });
  net.logAction(null, { kind: 'route-on', route: 'funnel', name: 'x.ts.net', why: 'person' });
  const entry = (await net.actions())[0];
  assert.deepEqual([entry.via, entry.kind, entry.route, entry.name, entry.why], ['internet', 'route-on', 'funnel', 'x.ts.net', 'person']);
  assert.ok(!('ip' in entry), 'no visitor address is ever in the log');
});
