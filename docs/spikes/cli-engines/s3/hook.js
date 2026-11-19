// Spike S3: the PreToolUse hook (stand-in for Bunny's hook), placed in the isolated CLINE_DIR/hooks. Not Bunny code.
// Env: HOOK_LOG (jsonl path), HOOK_MODE = log | deny | allow | crash | garbage | hang | exit1 ; HOOK_ALLOW = comma list of tool names to allow even in deny mode.
// Cline reads a hook's answer from stdout: JSON with {cancel, errorMessage, review, contextModification}; a "HOOK_CONTROL<TAB>" line also works.
const fs = require('fs');
const mode = process.env.HOOK_MODE || 'deny';
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch { /* keep going */ }
  const tool = ev.preToolUse?.toolName ?? ev.preToolUse?.tool ?? ev.toolCall?.name ?? ev.tool_name ?? ev.toolName ?? ev.tool ?? null;
  fs.appendFileSync(process.env.HOOK_LOG, JSON.stringify({ t: new Date().toISOString(), mode, tool, keys: Object.keys(ev), payload: raw.slice(0, 1500) }) + '\n');
  if (mode === 'crash') throw new Error('forced crash');
  if (mode === 'killed') process.kill(process.pid, 'SIGKILL');
  if (mode === 'exit1') process.exit(1);
  if (mode === 'garbage') { process.stdout.write('not json {{{'); process.exit(0); }
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  const allowed = (process.env.HOOK_ALLOW || '').split(',').includes(tool);
  if (mode === 'log' || mode === 'allow' || allowed) { process.stdout.write(JSON.stringify({ cancel: false })); process.exit(0); }
  process.stdout.write(JSON.stringify({ cancel: true, errorMessage: 'Bunny spike: denied' }));
  process.exit(0);
});
