// Spike S1: the PreToolUse hook (stand-in for Bunny's bridge hook). Not Bunny code.
// Env: HOOK_LOG (jsonl path), HOOK_MODE = deny | crash | garbage | hang | allow-canary-probe | exit1 ; BRIDGE_PORT (optional, a bridge that is asked)
// A real Bunny hook would wrap everything so that ANY failure prints a deny; this file lets each failure mode be forced to see what Claude Code does with it.
import { appendFileSync } from 'node:fs';

const mode = process.env.HOOK_MODE || 'deny';
const log = (o) => appendFileSync(process.env.HOOK_LOG, JSON.stringify({ t: new Date().toISOString(), mode, ...o }) + '\n');
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch { /* keep going */ }
  log({ event: ev.hook_event_name, tool: ev.tool_name, input: ev.tool_input, agent: ev.agent_id ?? null, cwd: ev.cwd });
  if (mode === 'deny' && (process.env.HOOK_ALLOW || '').split(',').includes(ev.tool_name)) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'allowed so the next tool can be reached' } })); process.exit(0); }
  if (mode === 'allow') { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'control run' } })); process.exit(0); }
  if (mode === 'crash') throw new Error('forced crash');
  if (mode === 'exit1') process.exit(1);
  if (mode === 'garbage') { process.stdout.write('this is not json {{{'); process.exit(0); }
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'bridge-closed') {
    // ask a bridge that is not listening; a safe hook turns the failure into deny
    try { const r = await fetch(`http://127.0.0.1:${process.env.BRIDGE_PORT}/decide`, { method: 'POST', body: raw, signal: AbortSignal.timeout(2000) }); await r.text(); }
    catch { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'bridge unreachable' } })); process.exit(0); }
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Bunny spike: denied' } }));
  process.exit(0);
});
