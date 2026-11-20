import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineService } from '../src/server/engines/service.js';
import { AUTH_COMMANDS, signInUrlFrom } from '../src/server/engines/claude-code.js';

// v0.1.14.1, CLAUDE SIGN-IN (the owner: "the claude login webpage does not open"): the sign-in program no longer runs hidden with its output thrown away. Bunny reads the page address it prints
// (only an https address on the vendor's own sites), hands it to the dialog, and says only what happened. Every case here uses a stand-in program and an invented data folder.

/** A stand-in for the vendor's `auth login`: prints the given lines, optionally exits with a code. */
function login({ lines = [], code = null, stderr = '', after = 0 } = {}) {
  const calls = [];
  let finish;
  const exited = new Promise((r) => { finish = r; });
  const make = (opts) => {
    calls.push(opts);
    if (code !== null) setTimeout(() => finish(code), after);
    return { lines: (async function* () { for (const l of lines) yield l; await exited; })(), stderr: () => stderr, end() {}, kill() { finish(-1); }, exited };
  };
  return { make, calls };
}
function service(t, stand) {
  const dataDir = mkdtempSync(join(tmpdir(), 'bunny-signin-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, svc: createEngineService({ dataDir, fake: true, openLoginRun: stand.make, loginWaitMs: 400 }) };
}

test('the page address: only https on claude.ai, claude.com or anthropic.com and their sub-sites; nothing else the program printed', () => {
  assert.equal(signInUrlFrom('Opening browser...\nIf it did not open, visit: https://claude.ai/oauth/authorize?code=true&client_id=x'), 'https://claude.ai/oauth/authorize?code=true&client_id=x');
  assert.equal(signInUrlFrom('go to https://console.anthropic.com/login.'), 'https://console.anthropic.com/login');
  assert.equal(signInUrlFrom('https://platform.claude.com/x'), 'https://platform.claude.com/x');
  assert.equal(signInUrlFrom('see https://evil.example/ then https://claude.ai/ok'), 'https://claude.ai/ok', 'a stranger\'s address is skipped, the vendor\'s is found');
  for (const bad of ['http://claude.ai/x', 'https://claude.ai.evil.com/x', 'https://evilclaude.ai/x', 'https://user:pw@claude.ai/x', 'https://evil.example/claude.ai', 'no address here', '']) assert.equal(signInUrlFrom(bad), null, bad);
});

test('a sign-in that prints its page: the address is returned, the program was started with the account folder only, and nothing it printed is kept', async (t) => {
  const stand = login({ lines: ['Opening browser to sign in…', 'If the browser did not open, visit:', 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz'] });
  const { svc, dataDir } = service(t, stand);
  const r = await svc.signIn('claude-code');
  assert.deepEqual(r, { started: true, url: 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz' });
  assert.deepEqual(stand.calls[0].args, AUTH_COMMANDS.login);
  assert.equal(stand.calls[0].cwd, join(dataDir, 'engines', 'claude-code', 'account', 'home'));
  assert.equal(stand.calls[0].extraEnv.CLAUDE_CONFIG_DIR, join(dataDir, 'engines', 'claude-code', 'account', 'home', 'config'), 'the account folder isolation is kept');
  assert.equal(stand.calls[0].extraEnv.USERPROFILE, join(dataDir, 'engines', 'claude-code', 'account', 'home'));
  assert.doesNotMatch(JSON.stringify((await svc.record?.()) ?? ''), /oauth|client_id|state=xyz/, 'the address is not written to the record');
});

test('an address on a stranger\'s site is never returned; a program that prints nothing is "started, no page seen", never "a window opened"', async (t) => {
  const a = service(t, login({ lines: ['visit https://evil.example/steal?x=1'] }));
  assert.deepEqual(await a.svc.signIn('claude-code'), { started: true, url: null });
  const b = service(t, login({ lines: [] }));
  assert.deepEqual(await b.svc.signIn('claude-code'), { started: true, url: null });
});

test('a program that stops without a page says why: its exit code and its last line, with any address hidden', async (t) => {
  const { svc } = service(t, login({ code: 1, stderr: 'Error: login failed, see https://claude.ai/help?trace=abc\nnot a terminal', after: 20 }));
  await assert.rejects(svc.signIn('claude-code'), (err) => {
    assert.match(err.message, /stopped before it showed a page \(exit code 1\)/);
    assert.match(err.message, /not a terminal/);
    assert.doesNotMatch(err.message, /trace=abc/);
    assert.equal(err.status, 502);
    return true;
  });
});

test('a program that cannot even start says so; one that finishes at once with code 0 is reported as finished', async (t) => {
  const { svc } = service(t, { make: () => { throw new Error('spawn EPERM'); }, calls: [] });
  await assert.rejects(svc.signIn('claude-code'), /could not start \(spawn EPERM\)/);
  const done = service(t, login({ code: 0, after: 10 }));
  assert.deepEqual(await done.svc.signIn('claude-code'), { started: true, url: null, finished: true });
});
