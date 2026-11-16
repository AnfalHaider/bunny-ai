#!/usr/bin/env node
// Pre-tool guard. Enforces the session family's "Never" columns before a tool runs.
//
// Input: a JSON hook payload on stdin. Claude Code shape is the default:
//   { "tool_name": "Bash", "tool_input": { "command": "..." }, "cwd": "..." }
//   { "tool_name": "Write"|"Edit"|"MultiEdit", "tool_input": { "file_path": "..." }, "cwd": "..." }
// Other tools' payloads are normalised by adapters (see adapters/) before calling decide().
//
// Output: exit 0 = allow. Exit 2 + reason on stderr = block (Claude Code, Codex and
// Copilot-style hooks all treat exit 2 as "deny and tell the agent why").
// Not bootstrapped (no .bootstrap/policy.json) = always allow, silently.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadFlow } from './lib/flow.mjs';
import { currentRole, git, loadPolicy, loadRole, isRefusedPath, isRoleFile, recordViolation, repoRoot, scopeViolation, toRepoPath } from './lib/policy.mjs';
import { baseName, commandStarts, isCmd, parseShell } from './lib/shellparse.mjs';
import { checkShell, gitCall, pushDestinations } from './lib/shellrules.mjs';
import { simpleCommandTexts } from './lib/shellblank.mjs';
import { checkWrites } from './lib/shellwrites.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write_file', 'replace', 'edit_file']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3', 'py', 'perl', 'ruby', 'php', 'lua', 'tclsh', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd', 'eval', 'xargs', 'busybox', 'wscript', 'cscript', 'mshta', 'osascript', 'awk', 'gawk', 'invoke-expression', 'iex', 'start-process', 'invoke-command', 'source']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const MODEL_RANK = { haiku: 1, sonnet: 2, opus: 3, fable: 3 };
const MAX_COMMAND = 256 * 1024;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'run_shell_command', 'run_terminal_cmd']);

export function pushTargets(command, cwd) {
  // Returns destination branch names for every `git push` in the command.
  const out = [];
  for (const seg of command.split(/&&|\|\||;|\n/)) {
    const toks = seg.trim().split(/\s+/);
    const gi = toks.indexOf('git');
    if (gi < 0 || toks[gi + 1] !== 'push') continue;
    const args = toks.slice(gi + 2).filter((t) => !t.startsWith('-'));
    const refspecs = args.slice(1); // args[0] is the remote
    if (refspecs.length === 0) {
      const cur = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
      if (cur) out.push(cur);
      continue;
    }
    for (let r of refspecs) {
      r = r.replace(/^\+/, '');
      let dst = r.includes(':') ? r.split(':')[1] : r;
      if (dst === 'HEAD') dst = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || dst;
      out.push(dst.replace(/^(refs\/)?heads\//, ''));
    }
  }
  return out;
}

/** Destination branches of every `git push` in a parsed command line (global options and quotes understood). */
export function tokenPushTargets(parsed, cwd) {
  const out = [];
  const current = () => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  for (const cmd of parsed.commands) {
    for (const start of commandStarts(cmd.words)) {
      const words = cmd.words.slice(start);
      if (!words.length || !isCmd(words[0].text, 'git')) continue;
      const call = gitCall(words);
      if (call.sub === 'push') out.push(...pushDestinations(call.args, current));
    }
  }
  return out;
}

// Helper agents: at most N per session, on the cheapest model (flow.helpers). Counted per session id in
// .bootstrap/helpers/ (git-ignored); an allowed start is counted, a refused one is not.
function helperCheck(root, flow, { sessionId, model, subagentType }) {
  const h = { max_per_session: 2, model: 'haiku', ...((flow && flow.helpers) || {}) };
  if (!h.max_per_session) return 'This project allows no helper agents: do the work in this session.';
  if (subagentType === 'fork') return `A fork runs on this session's own model. Start a helper with model: "${h.model}" instead.`;
  const want = MODEL_RANK[h.model] || 1;
  if (!model || !MODEL_RANK[String(model).toLowerCase()]) return `Helpers must name the cheapest model: pass model: "${h.model}".`;
  if (MODEL_RANK[String(model).toLowerCase()] > want) return `Helpers run on the cheapest model (${h.model}), not ${model}. Pass model: "${h.model}".`;
  const id = String(sessionId || 'unknown').replace(/[^\w-]/g, '_');
  const dir = join(root, '.bootstrap', 'helpers'), f = join(dir, `${id}.json`);
  let n = 0; try { n = JSON.parse(readFileSync(f, 'utf8')).started || 0; } catch { /* first */ }
  if (n >= h.max_per_session) return `This session already started ${n} helper agent${n === 1 ? '' : 's'}, the most this project allows (${h.max_per_session}). Do the rest yourself.`;
  try { mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify({ started: n + 1 }) + '\n'); } catch { /* counting is best effort */ }
  return null;
}

export function decide({ tool, command = '', filePath = '', cwd = process.cwd(), sessionId = null, model = null, subagentType = null }) {
  // MSYS-style "/c/Users/..." from Git Bash means C:\Users\... on Windows.
  if (process.platform === 'win32') cwd = cwd.replace(/^\/([a-zA-Z])\//, '$1:/');
  // A cwd we cannot place must not switch the guard off: fall back to where the hook runs.
  let root = repoRoot(cwd);
  if (!root && cwd !== process.cwd()) { root = repoRoot(process.cwd()); if (root) cwd = process.cwd(); }
  if (!root) return { allow: true };
  // K-1 (Security B7, K1-2): a repository inside the project (git init sub; cd sub) is judged by the project, whatever policy.json it carries itself
  // (an agent could plant a permissive one there) and wherever the hook's cwd is. The project is CLAUDE_PROJECT_DIR when set, else the nearest
  // folder above the cwd (or above where the hook runs) that has a .bootstrap/policy.json.
  const withinDir = (child, dir) => { const c = resolvePath(child).toLowerCase(); const d = resolvePath(dir).toLowerCase(); return c === d || c.startsWith(d + sep); };
  const walkUp = (start) => { let d = resolvePath(start); for (;;) { if (existsSync(join(d, '.bootstrap', 'policy.json'))) return d; const up = dirname(d); if (up === d) return null; d = up; } };
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  // Order of trust: the variable, then where the hook itself runs, and only last the cwd the agent named (a planted nested policy sits nearest to it).
  const fromHook = walkUp(process.cwd());
  const project = (envDir && existsSync(join(envDir, '.bootstrap', 'policy.json')) && withinDir(root, envDir) ? resolvePath(envDir) : null)
    || (fromHook && withinDir(root, fromHook) ? fromHook : null) || walkUp(cwd);
  if (project && project !== resolvePath(root) && withinDir(root, project)) root = project;
  const policy = loadPolicy(root);
  if (!policy) return { allow: true };
  const role = currentRole(root);
  // The merged flow role (brief + company + project overrides, incl. custom sessions) wins when a flow exists.
  let brief = loadRole(root, role) || {};
  if (existsSync(join(root, '.bootstrap', 'flow.json'))) {
    try { const r = loadFlow(root).flow.roles[role]; if (r) brief = { ...brief, ...r, deny_commands: r.deny_commands || brief.deny_commands }; } catch { /* keep the brief */ }
  }

  if (AGENT_TOOLS.has(tool)) {
    let flow = null; try { flow = loadFlow(root).flow; } catch { /* defaults */ }
    const why = helperCheck(root, flow, { sessionId, model, subagentType });
    return why ? { allow: false, reason: `Blocked: ${why}` } : { allow: true };
  }

  if (SHELL_TOOLS.has(tool)) {
    // K-1 (QA): the host cuts a hook off at 10 s, and a cut-off hook must not become a pass. Reading a 1 MB command takes 2-13 s, so nothing that long is read at all.
    if (command.length > MAX_COMMAND) {
      return { allow: false, reason: `Blocked for role "${role}": the command is ${Math.round(command.length / 1024)} KB, over the ${MAX_COMMAND / 1024} KB the guard reads within its time limit. Put the text in a file with the Write tool and run a short command.` };
    }
    // The hook-skip, hooks-folder and role rules read WORDS through the tokenizer (policy.shell_parse).
    // When the command cannot be read with confidence (unclosed quote, bash/PowerShell ambiguity) or the
    // switch is off, the old regexes over the raw text apply as well: stricter, with their false blocks.
    // K-1 (Security B4): the session role cannot be set through the Windows environment either ([Environment]::SetEnvironmentVariable, setx, Set-Item env:)
    if ((/BOOTSTRAP_ROLE/i.test(command) && /SetEnvironmentVariable|\bsetx(\.exe)?\b|\bSet-Item\b|\bNew-ItemProperty\b|\bSet-ItemProperty\b|\bsp\b/i.test(command)) || /\breg(\.exe)?\s+add\b[^\n]*Environment/i.test(command)) {
      return { allow: false, reason: `Blocked for role "${role}": the session role cannot be set from a command. The Chief of Staff assigns roles.` };
    }
    // K-1 (review): a remote's fetch refspec set from the command line or the configuration can write the live branch label
    if (!policy.releases.live_pushers.includes(role) && /\bgit\b[^\n]*\bremote\.[^\s=]+\.(fetch|push|mirror)\b/i.test(command)) {
      return { allow: false, reason: `Blocked for role "${role}": a remote's fetch or push refspec cannot be set from a command (it can write the live branch label).` };
    }
    const parsed = policy.shell_parse === false ? null : parseShell(command);
    const strict = !parsed || parsed.uncertain;
    // Item 5: a deny_all pattern is judged against each simple command with quoted text and here-document bodies blanked, so a flag in a
    // message, or in the next command of a chain, no longer trips it. Patterns marked "whole" and every pattern on a command that cannot be
    // read with confidence (strict) still see the raw text; so do the project's own destructive commands and the role's deny_commands.
    // ANSI-C ($'...') and locale ($"...") quoting can spell a flag the tokenizer reads differently: then the hook-skip patterns
    // (legacy_deny_all) run over the raw text too.
    const ansi = command.includes("$'") || command.includes('$"');
    const texts = strict ? null : simpleCommandTexts(command);
    const denyAll = policy.deny_all.map((e) => (typeof e === 'string' ? { pattern: e } : e));
    // A command that hands text to an interpreter or another shell (node -e "...", python -c, bash -c, eval, xargs) keeps the raw-text check:
    // what is inside its quotes is code, not a message.
    // Read from the tokenizer's words (quotes resolved), not from the blanked text: python3, node22, a quoted command word, and git's own
    // program runners (rebase --exec, submodule foreach, bisect run) all count.
    const isInterp = (w) => INTERPRETERS.has(baseName(w.text)) || /^(python|pythonw|node|nodejs|ruby|perl|php)[\d.]*$/i.test(baseName(w.text));
    const gitRunner = (cmd) => cmd.words.some((w) => isCmd(w.text, 'git')) && cmd.words.some((w) => ['--exec', '-x', 'foreach', 'run'].includes(w.text) || /^--exec=/.test(w.text));
    const quotedHead = (cmd) => commandStarts(cmd.words).some((k) => cmd.words[k]?.quoted); // a command word in quotes is not a plain program name
    const interpreter = !strict && parsed.commands.some((cmd) => cmd.words.some(isInterp) || quotedHead(cmd) || gitRunner(cmd));
    const hits = (e) => {
      const re = new RegExp(e.pattern);
      if (strict || e.whole || interpreter) return re.test(command);
      return texts.some((t) => re.test(t)) || (ansi && re.test(command));
    };
    const patterns = [
      ...denyAll.filter(hits).map((e) => e.pattern),
      ...[...(policy.destructive_commands || []), ...(brief.deny_commands || []), ...(strict || ansi ? policy.legacy_deny_all || [] : [])].filter((pat) => new RegExp(pat).test(command)),
    ];
    if (patterns.length) {
      return { allow: false, reason: `Blocked for role "${role}": command matches a rule in .bootstrap/policy.json or roles/${role}.md (${patterns[0]}). If the owner wants this, they run it themselves, or the Chief of Staff records their word first.` };
    }
    if (parsed) {
      const why = checkShell(parsed, { role, livePushers: policy.releases.live_pushers, cwd, root, liveBranch: policy.branches.live });
      if (why) return { allow: false, reason: `Blocked for role "${role}": ${why}` };
      // A2 and E: a seatbelt over the files a command writes (A1 is the authoritative check, at commit).
      if (policy.shell_write_check !== false) {
        const wrote = checkWrites(parsed, { root, cwd, policy, brief, role });
        if (wrote) return { allow: false, reason: `Blocked for role "${role}": ${wrote}` };
      }
    }
    if (/push/i.test(command)) {
      // Both readings: the tokenizer's and the old split on spaces. A live branch found by either is refused.
      const targets = [
        ...(parsed ? tokenPushTargets(parsed, cwd) : []),
        ...(/\bgit\b[\s\S]*\bpush\b/.test(command) ? pushTargets(command, cwd) : []),
      ];
      for (const dst of targets) {
        if (dst === policy.branches.live && !policy.releases.live_pushers.includes(role)) {
          return { allow: false, reason: `Blocked: only ${policy.releases.live_pushers.join(' / ')} may push "${dst}" (you are "${role}"). Live moves only on the owner's word (AGENTS.md, section 7E).` };
        }
      }
    }
    return { allow: true };
  }

  if (WRITE_TOOLS.has(tool) && filePath) {
    if (role !== 'chief-of-staff' && isRoleFile(filePath, cwd)) return { allow: false, reason: 'Blocked: that is the worktree\'s role file; the role is assigned by the Chief of Staff (bootstrap role).' };
    const rel = toRepoPath(root, filePath, cwd);
    if (isRefusedPath(rel)) return { allow: false, reason: `Blocked: that path could not be read safely (${rel.refused}).` };
    if (rel === null) return { allow: true }; // outside the project: not ours to police
    const why = scopeViolation(rel, policy, brief, role) ?? recordViolation(rel, policy, role);
    if (why) return { allow: false, reason: `Blocked: ${why}` };
  }
  return { allow: true };
}

function main() {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {
    process.stderr.write('guard: malformed hook payload; blocking to be safe.\n');
    process.exit(2);
  }
  const input = payload.tool_input || payload.toolInput || {};
  const res = decide({
    tool: payload.tool_name || payload.toolName || '',
    command: input.command || '',
    filePath: input.file_path || input.path || input.notebook_path || '',
    cwd: payload.cwd || process.cwd(),
    sessionId: payload.session_id || payload.sessionId || null,
    model: input.model || null,
    subagentType: input.subagent_type || null,
  });
  if (res.allow) process.exit(0);
  process.stderr.write(res.reason + '\n');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
