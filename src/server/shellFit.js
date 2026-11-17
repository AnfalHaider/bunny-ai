/**
 * W6-7 / W6-8, kept small on purpose: run_command always runs in Windows PowerShell 5.1 (the one shell the permission
 * rules and the command checks were written for). This file only helps the model say the right thing:
 *   - shellHint: when a command written for cmd or a POSIX shell fails, the PowerShell way to say it
 *   - looksLikeServer: a server or watcher belongs to start_process, so run_command refuses it and names that tool
 * Nothing here starts a program or picks a different shell.
 */

// Words written for POSIX shells that PowerShell does not know. The value is what to write instead.
const HINTS = {
  ls: 'dir (or Get-ChildItem)',
  cat: 'type (or Get-Content)',
  rm: 'del (or Remove-Item)',
  grep: 'findstr (or Select-String)',
  cp: 'copy (or Copy-Item)',
  mv: 'move (or Move-Item)',
  touch: 'New-Item -ItemType File name.txt',
  'mkdir -p': 'mkdir (it creates the parent folders already)',
  export: '$env:NAME = "value"',
  pwd: 'cd (or Get-Location)',
  which: 'where.exe (or Get-Command)',
  head: 'Get-Content -TotalCount 10',
  tail: 'Get-Content -Tail 10',
  sed: 'the -replace operator',
  awk: 'Select-String and the -split operator',
  chmod: 'nothing: Windows has no chmod',
  'set NAME=value': '$env:NAME = "value"',
};

/** The first word of each piece of a line joined by && || ; or |, with quoted text blanked out. */
function pieces(command) {
  const bare = String(command ?? '').replace(/"[^"]*"|'[^']*'/g, '""');
  return bare.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean)
    .map((piece) => ({ piece, word: piece.split(/\s+/)[0].toLowerCase() }));
}

/** A short "write it this way in PowerShell" for a line written for cmd or a POSIX shell, or null. */
export function shellHint(command) {
  const keys = new Set();
  for (const { piece, word } of pieces(command)) {
    if (word === 'mkdir' && /\s-p\b/.test(piece)) keys.add('mkdir -p');
    else if (word === 'set' && /^set\s+[A-Za-z_][A-Za-z0-9_]*=/.test(piece)) keys.add('set NAME=value');
    else if (word !== 'set' && Object.hasOwn(HINTS, word) && word !== 'mkdir') keys.add(word);
  }
  if (!keys.size) return null;
  return `This runs in PowerShell. ${[...keys].map((k) => `${k} -> ${HINTS[k]}`).join('; ')}.`;
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

/** Does this command start something that keeps running? A trailing unquoted "&" counts too: that is a background job. */
export function looksLikeServer(command) {
  const bare = String(command ?? '').trim().replace(/"[^"]*"|'[^']*'/g, '""');
  if (/(^|[^&])&\s*$/.test(bare)) return true;
  return pieces(command).some((p) => SERVER_PATTERNS.some((re) => re.test(p.piece)));
}
