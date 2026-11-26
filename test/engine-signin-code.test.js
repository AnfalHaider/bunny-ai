import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineService } from '../src/server/engines/service.js';
import { isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { ENGINE_REFUSED_MESSAGE, deviceRefusal } from '../src/server/remoteAccess.js';

// v0.1.16, CLAUDE SIGN-IN (the owner: the browser showed a code to copy back and Bunny had no place to paste it). Seen with the real program 2.1.311 (docs/spikes/cli-engines/s-login): the address it PRINTS is the one whose page
// shows a code (redirect to the vendor's code page, then "Paste code here if prompted >" on stdin); the address it gives its BROWSER calls back to a port it listens on, so no code is needed.
// Part A: the "browser" Bunny gives the program only records that address. Part B: the code goes to the waiting program's stdin. Every case here uses a stand-in program and an invented data folder.

const PRINTED = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=s1';
const CALLBACK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A60075%2Fcallback&state=s1';
const GOOD = 'abcDEF123456_-.~#xyz';

/** A stand-in for `auth login`: prints the address, calls its browser (writes the file the recorder would write) and waits on stdin; the right code finishes it. */
function login({ browser = CALLBACK, printed = PRINTED, rightCode = GOOD } = {}) {
  const calls = []; const written = [];
  let finish;
  const exited = new Promise((r) => { finish = r; });
  const make = (opts) => {
    calls.push(opts);
    if (browser) { mkdirSync(opts.cwd, { recursive: true }); writeFileSync(join(opts.cwd, 'browser-address.txt'), `"${browser}" \r\n`); } // what record-browser.cmd writes
    return {
      lines: (async function* () { yield 'Opening browser to sign in…'; yield `If the browser didn't open, visit: ${printed}`; await exited; })(),
      stderr: () => '',
      write(text) { written.push(text); if (text === `${rightCode}\n`) { mkdirSync(join(opts.cwd, 'config'), { recursive: true }); writeFileSync(join(opts.cwd, 'config', 'fake-signed-in'), '1'); finish(0); } },
      end() {}, kill() { finish(-1); }, exited,
    };
  };
  return { make, calls, written, finish: (c) => finish(c) };
}
function service(t, stand, extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'bunny-signin-code-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, svc: createEngineService({ dataDir, fake: true, openLoginRun: stand.make, loginWaitMs: 600, codeWaitMs: 400, ...extra }) };
}

test('part A: the address the program gives its browser is the one Bunny offers first; the printed (code) address is kept as the second choice', async (t) => {
  const { svc } = service(t, login());
  const r = await svc.signIn('claude-code');
  assert.equal(r.url, CALLBACK);
  assert.equal(r.manualUrl, PRINTED);
  assert.equal(r.canPaste, true);
});

test('part A: with no browser address (the program did not call its browser), the printed address is offered and the paste box is still available; a stranger\'s browser address is ignored', async (t) => {
  const a = service(t, login({ browser: null }));
  const r = await a.svc.signIn('claude-code');
  assert.deepEqual([r.url, r.manualUrl, r.canPaste], [PRINTED, null, true]);
  const b = service(t, login({ browser: 'https://evil.example/claude.ai?x=1' }));
  const s = await b.svc.signIn('claude-code');
  assert.equal(s.url, PRINTED, 'an address on a stranger\'s site is never taken from the browser file');
  assert.equal(s.manualUrl, null);
});

test('part B: the pasted code is written to the waiting program, exactly, with the Enter it waits for; the right code finishes the sign-in', async (t) => {
  const stand = login();
  const { svc } = service(t, stand);
  await svc.signIn('claude-code');
  const r = await svc.submitCode('claude-code', `  ${GOOD}  `);
  assert.deepEqual(stand.written, [`${GOOD}\n`], 'nothing else is written, and the spaces around it are gone');
  assert.deepEqual(r, { ok: true, signedIn: true, waiting: false });
});

test('part B: a wrong code leaves the program waiting (answer: not signed in, still waiting) and a second try works', async (t) => {
  const stand = login();
  const { svc } = service(t, stand);
  await svc.signIn('claude-code');
  const wrong = await svc.submitCode('claude-code', 'not-the-right-code-0000');
  assert.deepEqual(wrong, { ok: true, signedIn: false, waiting: true });
  const right = await svc.submitCode('claude-code', GOOD);
  assert.equal(right.signedIn, true);
  assert.equal(stand.written.length, 2);
});

test('part B: with no sign-in waiting the answer is 409, before the sign-in starts and after it ended; a code that callback already finished is not written anywhere', async (t) => {
  const stand = login();
  const { svc } = service(t, stand);
  await assert.rejects(svc.submitCode('claude-code', GOOD), (e) => e.status === 409 && /Press Sign in first/.test(e.message));
  await svc.signIn('claude-code');
  stand.finish(0); // the browser's callback finished it first
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(svc.submitCode('claude-code', GOOD), (e) => e.status === 409);
  assert.deepEqual(stand.written, []);
  await assert.rejects(svc.submitCode('codex', GOOD), (e) => e.status === 400);
});

test('part B: a code that is empty, short, long, has spaces or control characters, or is not text is refused with 400 and never written; the sixth try is refused with 429', async (t) => {
  const stand = login();
  const { svc } = service(t, stand);
  await svc.signIn('claude-code');
  for (const bad of ['', '   ', 'short', 'x'.repeat(513), 'has a space inside 123', 'tab\tinside12345', 'new\nline12345', 'esc\u001b12345678', 42, null, undefined, { code: GOOD }]) {
    await assert.rejects(svc.submitCode('claude-code', bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  assert.deepEqual(stand.written, []);
  for (let i = 0; i < 5; i += 1) await svc.submitCode('claude-code', `wrong-code-number-${i}`);
  await assert.rejects(svc.submitCode('claude-code', 'wrong-code-number-6'), (e) => e.status === 429);
  assert.equal(stand.written.length, 5, 'the sixth try was not written');
});

test('part B: the code is nowhere but the program\'s stdin: not in the answer, not in an error, not in the engine record, not in anything printed', async (t) => {
  const SECRET = 'SECRETcode123456789';
  const stand = login({ rightCode: 'another-one-12345' });
  const { svc } = service(t, stand);
  await svc.signIn('claude-code');
  const logged = [];
  const spy = (name) => { const o = console[name]; console[name] = (...a) => { logged.push(a.map(String).join(' ')); }; return () => { console[name] = o; }; };
  const undo = ['log', 'error', 'warn', 'info', 'debug'].map(spy);
  let answer; let failure;
  try { answer = await svc.submitCode('claude-code', SECRET); await svc.submitCode('claude-code', 'bad code'); } catch (e) { failure = e; } finally { undo.forEach((u) => u()); }
  assert.equal(JSON.stringify(answer).includes(SECRET), false, 'not in the answer');
  assert.equal(String(failure?.message ?? '').includes(SECRET), false, 'not in an error');
  assert.equal(JSON.stringify(await svc.store.record()).includes(SECRET), false, 'not in the engine record');
  assert.equal(logged.join('\n').includes(SECRET), false, 'not printed');
  assert.deepEqual(stand.written, [`${SECRET}\n`]);
});

test('the route and the box are Bunny\'s window only: the route is on the window-only list and a device at any level is refused it', () => {
  assert.equal(isWindowOnlyRoute('POST', '/api/engines/claude-code/signin/code'), true);
  assert.equal(deviceRefusal('POST', '/api/engines/claude-code/signin/code'), ENGINE_REFUSED_MESSAGE);
});
