/**
 * Which shell a run_command line should go to on Windows, and which lines are
 * servers that keep running (those belong to start_process, not run_command).
 *
 * Pure functions, so the rules can be tested without a Windows machine:
 *   cmd        - written for cmd.exe (dir, type, copy, set NAME=value ...)
 *   bash       - written POSIX-style (ls, cat, grep, export ...), run in Git Bash when it is installed
 *   powershell - everything else (the default, as before)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Words only cmd.exe understands (PowerShell would reject their switches or misread them).
const CMD_WORDS = new Set(['dir', 'type', 'copy', 'move', 'del', 'erase', 'ren', 'rename', 'md', 'rd', 'rmdir', 'cls', 'mklink', 'xcopy', 'robocopy', 'vol', 'tree']);

// Words written for POSIX shells. Windows has no such commands, so they go to Git Bash when it is there.
const POSIX_WORDS = new Set(['ls', 'cat', 'grep', 'egrep', 'sed', 'awk', 'head', 'tail', 'touch', 'export', 'which', 'pwd', 'chmod', 'cp', 'mv', 'rm', 'wc', 'printenv']);

// What to use instead on Windows, said once when a POSIX command fails without Git Bash.
const HINTS = {
  ls: 'dir',
  cat: 'type',
  rm: 'del',
  grep: 'findstr',
  cp: 'copy',
  mv: 'move',
  touch: 'type nul > name.txt (or New-Item -ItemType File name.txt)',
  'mkdir -p': 'mkdir (it creates the parent folders already)',
  export: '$env:NAME = "value"',
  pwd: 'cd',
  which: 'where',
  head: 'Get-Content -TotalCount 10',
  tail: 'Get-Content -Tail 10',
  sed: 'the -replace operator in PowerShell',
  awk: 'PowerShell commands such as Select-String',
  chmod: 'nothing: Windows has no chmod',
};

/** The first word of each piece of a line joined by && || ; or |, with quoted text blanked out. */
function firstWords(command) {
  const bare = String(command ?? '').replace(/"[^"]*"|'[^']*'/g, '""');
  return bare.split(/&&|\|\||;|\|/).map((piece) => piece.trim()).filter(Boolean)
    .map((piece) => ({ piece, word: piece.split(/\s+/)[0].toLowerCase() }));
}

/** Where Git for Windows installs bash.exe (not the WSL launcher in System32). */
export function findGitBash(env = process.env) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const root of roots) {
    const bash = join(root, 'Git', 'bin', 'bash.exe');
    if (existsSync(bash)) return bash;
  }
  return null;
}

/**
 * Pick the shell for one run_command line.
 * On anything but Windows the line stays in PowerShell, exactly as before.
 * Returns { shell, command, hint }: hint is a short translation for a POSIX command
 * that cannot run here (no Git Bash), or null.
 */
export function fitShell(command, { platform = process.platform, hasGitBash = false } = {}) {
  const cmd = String(command ?? '').trim();
  if (platform !== 'win32') return { shell: 'powershell', command: cmd, hint: null };
  const pieces = firstWords(cmd);
  const posix = pieces.filter((p) => POSIX_WORDS.has(p.word) || (p.word === 'mkdir' && /\s-p\b/.test(p.piece)));
  if (posix.length) {
    if (hasGitBash) return { shell: 'bash', command: cmd, hint: null };
    const words = [...new Set(posix.map((p) => (p.word === 'mkdir' ? 'mkdir -p' : p.word)))];
    const tips = words.filter((w) => HINTS[w]).map((w) => `${w} -> ${HINTS[w]}`);
    const hint = tips.length
      ? `Windows has no ${words.join(', ')} here. Use ${tips.join('; ')}. Or install Git for Windows, and these run as written.`
      : null;
    return { shell: 'powershell', command: cmd, hint };
  }
  const first = pieces[0];
  if (first && (CMD_WORDS.has(first.word) || (first.word === 'set' && (/^set\s*$/i.test(first.piece) || /^set\s+\S+=/i.test(first.piece))))) {
    return { shell: 'cmd', command: cmd, hint: null };
  }
  return { shell: 'powershell', command: cmd, hint: null };
}

// Well-known commands that start a server or watcher and never return.
const SERVER_PATTERNS = [
  /^npm\s+(start|run\s+(dev|serve))\b/i,
  /^npx\s+(vite|serve)\b/i,
  /^node\s+server\.js\b/i,
  /^(python3?|py)\s+-m\s+http\.server\b/i,
  /^flask\s+run\b/i,
  /^uvicorn\b/i,
  /^next\s+dev\b/i,
  /^nodemon\b/i,
];

/**
 * Does this command start something that keeps running (so run_command would wait
 * until it timed out)? A trailing unquoted "&" counts too: that is a background job.
 */
export function looksLikeServer(command) {
  const bare = String(command ?? '').trim().replace(/"[^"]*"|'[^']*'/g, '""');
  if (/(^|[^&])&\s*$/.test(bare)) return true;
  return firstWords(command).some((p) => SERVER_PATTERNS.some((re) => re.test(p.piece)));
}
