/**
 * Cutting a command line into the commands it runs, for the person's permission rules (permissionRules.js).
 *
 * run_command runs in Windows PowerShell, but a rule has to hold whichever way a line is read, so a line is cut THREE ways:
 *   A  PowerShell's quoting: a backtick escapes, "" and '' are literal quotes, a backslash is a plain character
 *   B  quote-blind: only ; | & and line breaks separate (what a stray quote cannot hide)
 *   C  POSIX quoting: a backslash escapes (what bash or sh would read)
 * A Deny or Ask rule fires if ANY reading of ANY part matches. An Allow rule applies only if EVERY part of ALL THREE readings is
 * covered, so any doubt becomes a question. Each part is also normalised before matching (PowerShell aliases, a quoted or
 * backtick-split command name, a call operator, ".exe", a leading VAR=x, git's global options), and the text after
 * "cmd /c", "powershell -Command" and the like is judged too.
 *
 * It is a guard rail, not a sandbox: it does not see what a program does once it runs.
 */

const BREAKS = new Set(['\n', '\r', '\u2028', '\u2029', '\u0085']);
const isControl = (c) => c < ' ' && c !== '\t' && c !== '\n';

/** A: PowerShell quoting. Returns { parts, unsafe }. */
export function splitPowerShell(src) {
  const parts = [];
  let cur = '';
  let quote = null;
  let unsafe = false;
  const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) parts.push(t); cur = ''; };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote === "'") {
      if (c === "'") { if (src[i + 1] === "'") { cur += "''"; i += 1; continue; } quote = null; }
      cur += c;
      continue;
    }
    if (quote === '"') {
      if (c === '`') { cur += c + (src[i + 1] ?? ''); i += 1; continue; }
      if (c === '"') { if (src[i + 1] === '"') { cur += '""'; i += 1; continue; } quote = null; }
      else if (c === '$' && src[i + 1] === '(') unsafe = true;
      cur += c;
      continue;
    }
    if (c === '`') { cur += c + (src[i + 1] ?? ''); i += 1; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(' || c === ')' || c === '{' || c === '}') { unsafe = true; flush(); continue; }
    if (c === '>' || c === '<') {
      if (c === '>' && src[i + 1] === '&') { cur += c; continue; } // 2>&1 is plumbing
      if (c === '>') unsafe = true;
      cur += c;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || BREAKS.has(c)) {
      if (c === '&' && (src[i - 1] === '>' || src[i + 1] === '>')) { cur += c; continue; } // 2>&1, &>
      if ((c === '|' || c === '&') && src[i + 1] === c) i += 1;
      flush();
      continue;
    }
    if (isControl(c)) { unsafe = true; flush(); continue; }
    cur += c;
  }
  flush();
  return { parts, unsafe };
}

/** B: quote-blind. Every ; | & ( ) { } and line break separates, whatever quotes are around it. */
export function splitBlind(src) {
  const parts = src.replace(/\d*>&\d*|&>/g, ' ').split(/[;|&(){}\n\r\u2028\u2029\u0085\u000b\u000c`]+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { parts, unsafe: false };
}

/** C: POSIX quoting (a backslash escapes). Returns { parts, unsafe }. */
export function splitPosix(src) {
  const parts = [];
  let cur = '';
  let quote = null;
  let unsafe = false;
  const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) parts.push(t); cur = ''; };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < src.length) { cur += c + src[i + 1]; i += 1; continue; }
      if (c === quote) quote = null;
      else if (quote === '"' && (c === '`' || (c === '$' && src[i + 1] === '('))) unsafe = true;
      cur += c;
      continue;
    }
    if (c === '\\' && i + 1 < src.length) { cur += c + src[i + 1]; i += 1; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '`') { unsafe = true; flush(); continue; }
    if (c === '(' || c === ')' || c === '{' || c === '}') { unsafe = true; flush(); continue; }
    if (c === '>' || c === '<') {
      if (c === '>' && src[i + 1] === '&') { cur += c; continue; }
      if (c === '>') unsafe = true;
      cur += c;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || BREAKS.has(c)) {
      if (c === '&' && (src[i - 1] === '>' || src[i + 1] === '>')) { cur += c; continue; }
      if ((c === '|' || c === '&') && src[i + 1] === c) i += 1;
      flush();
      continue;
    }
    if (isControl(c)) { unsafe = true; flush(); continue; }
    cur += c;
  }
  flush();
  return { parts, unsafe };
}

// ---- normalising one part

const ALIASES = new Map(Object.entries({
  rm: 'Remove-Item', ri: 'Remove-Item', del: 'Remove-Item', erase: 'Remove-Item', rd: 'Remove-Item', rmdir: 'Remove-Item',
  cp: 'Copy-Item', cpi: 'Copy-Item', copy: 'Copy-Item', mv: 'Move-Item', mi: 'Move-Item', move: 'Move-Item',
  ren: 'Rename-Item', rni: 'Rename-Item', sc: 'Set-Content', ac: 'Add-Content', clc: 'Clear-Content', ni: 'New-Item', md: 'mkdir',
  iex: 'Invoke-Expression', icm: 'Invoke-Command', saps: 'Start-Process', start: 'Start-Process', kill: 'Stop-Process', spps: 'Stop-Process',
  sal: 'Set-Alias', nal: 'New-Alias', sajb: 'Start-Job', ii: 'Invoke-Item', ipal: 'Import-Alias', epal: 'Export-Alias', si: 'Set-Item',
  ls: 'Get-ChildItem', dir: 'Get-ChildItem', gci: 'Get-ChildItem', cat: 'Get-Content', type: 'Get-Content', gc: 'Get-Content',
  sl: 'Set-Location', cd: 'Set-Location', chdir: 'Set-Location', iwr: 'Invoke-WebRequest', curl: 'Invoke-WebRequest', wget: 'Invoke-WebRequest', irm: 'Invoke-RestMethod',
}));
// things that run other text, or rename a command so a name no longer means what it says
const WRAPPER_WORDS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl', 'zsh', 'invoke-expression', 'invoke-command', 'start-process', 'set-alias', 'new-alias', 'start-job', 'start-threadjob', 'invoke-item', 'import-alias', 'export-alias', 'register-scheduledjob', 'schtasks']);
const INNER_FLAG = /^(\/c|\/k|-c|-command|-commandwithargs|-encodedcommand|-ec|-e)$/i;
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

/** The first word of a part and the rest. Quotes around the word are kept in `raw`. */
function firstWord(part) {
  const m = /^(\s*)((?:"[^"]*"|'[^']*'|`.|[^\s"'`])+)(\s*)([\s\S]*)$/.exec(part);
  return m ? { raw: m[2], rest: m[4] } : { raw: '', rest: part };
}

/** A command word as the shell would name it: quotes and backticks removed, a module prefix and ".exe" dropped, an alias expanded. */
export function commandName(raw) {
  let w = String(raw).replace(/`/g, '').replace(/^["']|["']$/g, '').replace(/["']/g, '');
  if (/^[A-Za-z]:[\\/]/.test(w) || w.includes('\\') || w.includes('/')) w = w.split(/[\\/]/).pop() ?? w; // Microsoft.PowerShell.Management\Remove-Item, C:\Git\git.exe
  w = w.replace(/\.(exe|cmd|bat|com)$/i, '');
  return ALIASES.get(w.toLowerCase()) ?? w;
}

/** git without its global options: "git -C . -c a=b --no-pager push" -> "git push". */
function stripGitGlobals(rest) {
  const words = rest.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let i = 0;
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i];
    if (GIT_GLOBAL_WITH_VALUE.has(w)) i += 2;
    else if (/^-c.+=/.test(w) || /^-C./.test(w) || /^--(git-dir|work-tree|namespace|exec-path)=/.test(w) || w === '-P' || w === '-p' || w === '--no-pager' || w === '--paginate' || w === '--no-optional-locks' || w === '--bare' || w === '--no-replace-objects') i += 1;
    else break;
  }
  return words.slice(i).join(' ');
}

/** The spellings of one part to match a Deny or Ask rule against, plus the inner command of a wrapper, plus whether it is a wrapper. */
export function normalisePart(part, depth = 0) {
  const variants = new Set([part]);
  const inner = [];
  let wrapper = false;
  let text = part;
  // a leading VAR=x, then call operators (& . with a space) and "& $x" / "& (...)"
  for (let guard = 0; guard < 8; guard += 1) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)(.*)$/.exec(text) ?? /^(?:&|\.)\s+(.*)$/.exec(text);
    if (!m) break;
    text = (m[2] ?? m[1]).trim();
    variants.add(text);
  }
  if (/^[&.]\s*[$(]/.test(part) || /^[&.]\s+\$/.test(part)) wrapper = true; // & $x, & (Get-Command ...): the command name is computed
  if (/[$(]/.test(commandName(firstWord(text).raw))) wrapper = true; // a name that still has a variable or a group in it
  const { raw, rest } = firstWord(text);
  if (!raw) return { variants: [...variants], inner, wrapper };
  const name = commandName(raw);
  const lowName = name.toLowerCase();
  let body = rest;
  if (lowName === 'git') body = stripGitGlobals(rest);
  const canonical = `${name}${body ? ` ${body}` : ''}`.trim();
  variants.add(canonical);
  if (WRAPPER_WORDS.has(lowName)) {
    wrapper = true;
    const words = rest.split(/\s+/).filter(Boolean);
    const at = words.findIndex((w) => INNER_FLAG.test(w));
    if (at >= 0 && depth < 3) {
      const innerText = words.slice(at + 1).join(' ').replace(/^["']|["']$/g, '');
      if (innerText) inner.push(innerText);
    } else if (lowName === 'invoke-expression' && rest.trim()) inner.push(rest.trim().replace(/^["']|["']$/g, ''));
  }
  // PowerShell drops a backtick before an ordinary character (git `push is git push)
  for (const v of [...variants]) if (v.includes('`')) variants.add(v.replace(/`(.)/g, '$1').replace(/`/g, ''));
  return { variants: [...variants], inner, wrapper };
}

/**
 * Everything the rules need to know about a command line:
 *   readings  the three lists of parts (A, B, C) an Allow must cover completely
 *   texts     every spelling a Deny or Ask is matched against
 *   unsafe    a redirection to a file, grouping, a script block or a control character was seen
 *   wrapper   something that runs other text (cmd /c, powershell -Command, iex, & $x, bash -c)
 */
export function analyseCommand(command, depth = 0) {
  // PowerShell reads the typographic quotes as quotes. Read the line with them as plain quotes too, and let nothing be allowed if they are there.
  const typographic = /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2013\u2014\u2015]/.test(String(command ?? ''));
  if (typographic && depth < 4) {
    // the en dash, em dash and horizontal bar are dashes to PowerShell: Remove-Item (en dash)Recurse is Remove-Item -Recurse
    const plain = String(command).replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2013\u2014\u2015]/g, '-');
    const other = analyseCommand(plain, depth + 1);
    const own = analyseCommand(String(command).replace(/[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u2013\u2014\u2015]/g, ''), depth + 1);
    return { readings: [...other.readings, ...own.readings], texts: [...new Set([...other.texts, ...own.texts])], unsafe: true, wrapper: other.wrapper || own.wrapper, whole: other.whole };
  }
  const whole = String(command ?? '').replace(/\s+/g, ' ').trim();
  const a = splitPowerShell(String(command ?? ''));
  const b = splitBlind(String(command ?? ''));
  const c = splitPosix(String(command ?? ''));
  const readings = [a.parts, b.parts, c.parts];
  const texts = new Set(whole ? [whole] : []);
  let wrapper = false;
  const queue = [...new Set([...a.parts, ...b.parts, ...c.parts])];
  for (const part of queue) {
    const n = normalisePart(part, depth);
    for (const v of n.variants) texts.add(v);
    if (n.wrapper) wrapper = true;
    if (depth < 3) {
      for (const innerText of n.inner) {
        const innerAnalysis = analyseCommand(innerText, depth + 1);
        for (const t of innerAnalysis.texts) texts.add(t);
        if (innerAnalysis.wrapper) wrapper = true;
      }
    }
  }
  // the alias:, function: and variable: drives redefine what a name means (Set-Item alias:rm ...), spelled any way
  if (/(alias|function|variable):/i.test(String(command ?? '').replace(/`/g, '').replace(/["']/g, ''))) wrapper = true;
  // a call operator followed by a variable, a group or a script block (& $x, & (Get-Command ...), . $profile): the name is computed
  if (/(?:^|[;|&\n\r{(])\s*[&.]\s*(?:[$(@]|["'][^"']*\$)/.test(String(command ?? ''))) wrapper = true;
  // the text inside $( ) and backtick pairs, for a Deny or Ask
  for (const m of String(command ?? '').matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    if (depth < 3) for (const t of analyseCommand(m[1] ?? m[2], depth + 1).texts) texts.add(t);
  }
  return { readings, texts: [...texts], unsafe: a.unsafe || b.unsafe || c.unsafe, wrapper, whole };
}
