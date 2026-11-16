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
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { currentRole, git, loadPolicy, loadRole, isRefusedPath, isRoleFile, recordViolation, repoRoot, scopeViolation, toRepoPath } from './lib/policy.mjs';
import { baseName, commandStarts, isCmd, parseShell } from './lib/shellparse.mjs';
import { checkShell, gitCall, pushDestinations } from './lib/shellrules.mjs';
import { simpleCommandTexts } from './lib/shellblank.mjs';
import { checkWrites } from './lib/shellwrites.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write_file', 'replace', 'edit_file']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python2', 'python3', 'py', 'perl', 'ruby', 'php', 'lua', 'tclsh', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd', 'eval', 'xargs', 'busybox', 'wscript', 'cscript', 'mshta', 'osascript', 'awk', 'gawk', 'invoke-expression', 'iex', 'start-process', 'invoke-command', 'source']);
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
      out.push(dst.replace(/^refs\/heads\//, ''));
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

export function decide({ tool, command = '', filePath = '', cwd = process.cwd() }) {
  const root = repoRoot(cwd);
  if (!root) return { allow: true };
  const policy = loadPolicy(root);
  if (!policy) return { allow: true };
  const role = currentRole(root);
  const brief = loadRole(root, role) || {};

  if (SHELL_TOOLS.has(tool)) {
    // The hook-skip, hooks-folder and role rules read WORDS through the tokenizer (policy.shell_parse).
    // When the command cannot be read with confidence (unclosed quote, bash/PowerShell ambiguity) or the
    // switch is off, the old regexes over the raw text apply as well: stricter, with their false blocks.
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
      const why = checkShell(parsed, { role, livePushers: policy.releases.live_pushers, cwd });
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
  });
  if (res.allow) process.exit(0);
  process.stderr.write(res.reason + '\n');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
