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
import { currentRole, git, loadPolicy, loadRole, matchesAny, repoRoot, toRepoPath } from './lib/policy.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write_file', 'replace', 'edit_file']);
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

export function decide({ tool, command = '', filePath = '', cwd = process.cwd() }) {
  const root = repoRoot(cwd);
  if (!root) return { allow: true };
  const policy = loadPolicy(root);
  if (!policy) return { allow: true };
  const role = currentRole(root);
  const brief = loadRole(root, role) || {};

  if (SHELL_TOOLS.has(tool)) {
    for (const pat of [...policy.deny_all, ...(policy.destructive_commands || []), ...(brief.deny_commands || [])]) {
      if (new RegExp(pat).test(command)) {
        return { allow: false, reason: `Blocked for role "${role}": command matches a rule in .bootstrap/policy.json or roles/${role}.md (${pat}). If the owner wants this, they run it themselves, or the Chief of Staff records their word first.` };
      }
    }
    if (/\bgit\s+push\b/.test(command)) {
      for (const dst of pushTargets(command, cwd)) {
        if (dst === policy.branches.live && !policy.releases.live_pushers.includes(role)) {
          return { allow: false, reason: `Blocked: only ${policy.releases.live_pushers.join(' / ')} may push "${dst}" (you are "${role}"). Live moves only on the owner's word (AGENTS.md, section 7E).` };
        }
      }
    }
    return { allow: true };
  }

  if (WRITE_TOOLS.has(tool) && filePath) {
    const rel = toRepoPath(root, filePath, cwd);
    if (rel.startsWith('..')) return { allow: true }; // outside the project: not ours to police
    if (matchesAny(rel, policy.protected_globs) && role !== 'chief-of-staff') {
      return { allow: false, reason: `Blocked: ${rel} is protected toolkit config. Only the Chief of Staff changes it, on the owner's typed word.` };
    }
    const scope = brief.write_globs;
    if (Array.isArray(scope) && scope.length && !matchesAny(rel, scope)) {
      return { allow: false, reason: `Blocked: role "${role}" writes only ${scope.join(', ')}; ${rel} is outside that. File a board row for the role that owns it.` };
    }
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
