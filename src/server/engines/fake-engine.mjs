// CLI-ENGINES §5.1: a scripted stand-in for an engine, for tests and the gate (no real CLI, no network, no account). Run as a program: `node fake-engine.mjs <profile> [the CLI's own arguments]`.
// The script comes from the BUNNY_FAKE_SCRIPT environment variable (JSON) or the file named by BUNNY_FAKE_SCRIPT_FILE.
//
// profile `claude-code`: speaks Claude Code's stream-json. It reads the user message on stdin, prints `system/init`, then plays the steps:
//   { say: "text" }                                  an assistant text message
//   { tool: "Read", input: {...}, skipHook?: true }  a tool_use; like Claude Code it runs the PreToolUse hook found in the --settings file (the hook command and its environment) and acts on the answer:
//                                                    allow -> a successful tool_result (and the step's `marker` file is written, to show the tool "ran"); deny -> an is_error tool_result "PreToolUse:<tool> hook error: <reason>".
//                                                    skipHook simulates a dead hook: the tool just runs.
//   { rawLine: "..." }                               a line printed as it is (malformed output tests)
//   { result: { ... } }                              the final `result` (default: success)
//   { exit: 3 }  { hang: true }                      end at once with a code / print nothing and stay alive
// Options in the script object: { tools: [...] } overrides the init tool list; { noInit: true }.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const profile = process.argv[2];
const args = process.argv.slice(3);
const script = JSON.parse(process.env.BUNNY_FAKE_SCRIPT_FILE ? readFileSync(process.env.BUNNY_FAKE_SCRIPT_FILE, 'utf8') : (process.env.BUNNY_FAKE_SCRIPT || '{"steps":[]}'));
const out = (o) => process.stdout.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (profile === 'claude-code') {
  const restricted = args.includes('--restricted');
  const settingsPath = args[args.indexOf('--settings') + 1];
  const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const hookCommand = settings?.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command;
  const sessionId = 'fake-session-1';
  const tools = script.tools ?? (restricted ? ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'ToolSearch'] : ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Bash', 'WebFetch', 'ToolSearch']);

  const runHook = (payload) => new Promise((resolve) => {
    if (!hookCommand) { resolve({ decision: 'allow' }); return; }
    const m = /^"([^"]+)"\s+"([^"]+)"$/.exec(hookCommand);
    if (!m) { resolve({ decision: 'allow', note: 'the hook command could not be read' }); return; }
    const child = spawn(m[1], [m[2]], { env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let text = ''; child.stdout.on('data', (c) => { text += c; });
    child.on('close', (code) => {
      // Claude Code's rule: exit 0 with a JSON decision is honoured; any other exit code is a NON-blocking error and the tool runs
      if (code !== 0) { resolve({ decision: 'allow', note: `the hook exited with ${code}` }); return; }
      try { const d = JSON.parse(text).hookSpecificOutput; resolve({ decision: d.permissionDecision === 'deny' ? 'deny' : 'allow', reason: d.permissionDecisionReason }); } catch { resolve({ decision: 'allow', note: 'no decision printed' }); }
    });
    child.on('error', () => resolve({ decision: 'allow', note: 'the hook could not start' }));
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload));
  });

  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { stdin += c; if (stdin.includes('\n') && !started) { started = true; play(); } });
  process.stdin.on('end', () => { if (!started) { started = true; play(); } });
  let started = false;

  async function play() {
    if (!script.noInit) out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sessionId, tools, mcp_servers: [], model: 'fake', permissionMode: 'default', claude_code_version: '2.1.311' });
    let n = 0; let usage = { input_tokens: 10, output_tokens: 4 };
    for (const step of script.steps ?? []) {
      if (step.exit !== undefined) process.exit(step.exit);
      if (step.hang) { await sleep(60_000); continue; }
      if (step.delay) await sleep(step.delay);
      if (step.rawLine !== undefined) { out(step.rawLine); continue; }
      if (step.say !== undefined) {
        for (const part of String(step.say).match(/.{1,6}/gs) ?? []) out({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
        out({ type: 'assistant', session_id: sessionId, message: { id: `msg_${n}`, role: 'assistant', content: [{ type: 'text', text: String(step.say) }] } });
        continue;
      }
      if (step.tool) {
        n += 1; const id = step.id ?? `toolu_${n}`;
        out({ type: 'assistant', session_id: sessionId, message: { id: `msg_${n}`, role: 'assistant', content: [{ type: 'tool_use', id, name: step.tool, input: step.input ?? {} }] } });
        let verdict = { decision: 'allow' };
        if (!step.skipHook && !step.noResultId) verdict = await runHook({ hook_event_name: 'PreToolUse', tool_name: step.tool, tool_input: step.input ?? {}, tool_use_id: id, session_id: sessionId, cwd: process.cwd() });
        if (verdict.decision === 'deny') out({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: `PreToolUse:${step.tool} hook error: ${verdict.reason ?? 'denied'}` }] } });
        else {
          if (step.marker) writeFileSync(step.marker, 'the tool ran');
          const content = step.engineRefusal ? '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>' : (step.output ?? 'ok');
          out({ type: 'user', session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: step.resultId ?? id, is_error: Boolean(step.engineRefusal), content }] } });
        }
        continue;
      }
      if (step.result) { usage = step.result.usage ?? usage; }
    }
    const last = (script.steps ?? []).find((s) => s.result)?.result ?? {};
    out({ type: 'result', subtype: last.subtype ?? 'success', is_error: Boolean(last.is_error), result: last.result ?? 'done', stop_reason: 'end_turn', session_id: sessionId, usage });
    process.exit(0);
  }
} else {
  console.error(`fake-engine: unknown profile ${profile}`);
  process.exit(2);
}
