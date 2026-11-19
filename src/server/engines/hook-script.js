/**
 * CLI-ENGINES §3.2 (CE-1.7, CE-1): the fixed text of the PreToolUse hook that Bunny writes into Claude Code's isolated home. It is rewritten at EVERY run start, and its sha256 is
 * checked before the run starts (a changed file is not run). It is started as `process.execPath` with ELECTRON_RUN_AS_NODE=1 and the script's absolute path, never a bare `node`.
 *
 * What it does: reads the hook event from stdin, asks Bunny's bridge on 127.0.0.1 with the run's token (from the environment, never the command line), waits, and prints Claude Code's decision.
 * ON EVERY PATH it prints a deny unless the bridge answered {"allow":true}: a throw, a crash handler, a bad or empty answer, an unreachable bridge, its own timeout, a stdin that does not parse.
 * It NEVER exits with 1 (Claude Code treats that as "non-blocking": the tool would run); a failure after the deny is printed exits 0.
 *
 * What it cannot catch (S1 (c)): its own process being killed, or the runtime missing. Those are covered by the other layers: --permission-prompts none, the deny rules in Bunny's settings,
 * and the stream watchdog.
 */
import { createHash } from 'node:crypto';

export const HOOK_FILE_NAME = 'bunny-pretooluse.cjs';

export const HOOK_SOURCE = `'use strict';
// Bunny AI: PreToolUse hook. Written by Bunny at every run start. Do not edit: a changed file is not run.
const http = require('http');
let done = false;
// Exit 0 only from the write callback, after the answer was written. If the write does not finish in time, exit 2 with the reason on stderr: exit 2 blocks the tool, exit 0 with no answer would not.
const finish = (text, reason) => {
  const bail = () => { try { process.stderr.write(String(reason)); } catch (e) { /* nothing more */ } process.exit(2); };
  const timer = setTimeout(bail, 1500);
  try { process.stdout.write(text, (err) => { clearTimeout(timer); if (err) bail(); else process.exit(0); }); } catch (e) { bail(); }
};
const deny = (why) => {
  if (done) return; done = true;
  const reason = String(why || 'Bunny did not allow this.').slice(0, 400);
  finish(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }), reason);
};
const allow = () => {
  finish(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Allowed by Bunny.' } }), 'Bunny could not finish its answer, so this was not allowed.');
  done = true;
};
process.on('uncaughtException', () => deny('Bunny check failed'));
process.on('unhandledRejection', () => deny('Bunny check failed'));
try {
  const port = Number(process.env.BUNNY_BRIDGE_PORT);
  const token = String(process.env.BUNNY_BRIDGE_TOKEN || '');
  const limit = Number(process.env.BUNNY_HOOK_LIMIT_MS) || 600000;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 32) { deny('Bunny check is not set up'); }
  const timer = setTimeout(() => deny('Bunny did not answer in time'), limit);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; if (raw.length > 4000000) deny('request too big'); });
  process.stdin.on('error', () => deny('could not read the request'));
  process.stdin.on('end', () => {
    let ev;
    try { ev = JSON.parse(raw); } catch (e) { deny('could not read the request'); return; }
    if (!ev || typeof ev !== 'object' || typeof ev.tool_name !== 'string') { deny('could not read the request'); return; }
    const body = JSON.stringify({ tool: ev.tool_name, input: ev.tool_input === undefined ? null : ev.tool_input, id: typeof ev.tool_use_id === 'string' ? ev.tool_use_id : '', agent: typeof ev.agent_id === 'string' ? ev.agent_id : '' });
    const req = http.request({ host: '127.0.0.1', port, path: '/decide', method: 'POST', headers: { host: '127.0.0.1:' + port, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer ' + token } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; if (text.length > 100000) deny('bad answer'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) { deny('Bunny check refused'); return; }
        let ans;
        try { ans = JSON.parse(text); } catch (e) { deny('bad answer from Bunny'); return; }
        if (ans && ans.allow === true) { if (done) return; allow(); } else deny(ans && typeof ans.reason === 'string' ? ans.reason : 'Bunny did not allow this.');
      });
      res.on('error', () => deny('Bunny check failed'));
    });
    req.on('error', () => deny('Bunny check could not be reached'));
    req.write(body);
    req.end();
  });
} catch (e) { deny('Bunny check failed'); }
`;

/** The sha256 of the hook text: checked before each run. */
export const hookSha256 = () => createHash('sha256').update(HOOK_SOURCE).digest('hex');

/** Write the hook into `dir` (rewritten at every run start). Returns { path, sha256 }. */
export async function writeHook(dir) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(dir, { recursive: true });
  const path = join(dir, HOOK_FILE_NAME);
  await writeFile(path, HOOK_SOURCE, { mode: 0o600 });
  return { path, sha256: hookSha256() };
}

/** Is the file on disk still exactly Bunny's hook? Checked before the run starts: a changed file is not run. */
export async function hookIntact(path) {
  const { readFile } = await import('node:fs/promises');
  try { return createHash('sha256').update(await readFile(path)).digest('hex') === hookSha256(); } catch { return false; }
}
