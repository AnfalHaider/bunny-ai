// A small quote-aware shell tokenizer, shared by the guard's command rules (C, A3, A2, E).
//
// It splits a command line into simple commands (on ; && || | & newline and parentheses), each with
// its WORDS (quotes resolved) and its REDIRECTIONS as separate items. Quoted text is data: it is never
// scanned for operators. Heredoc bodies and here-strings are data too. $(...) and `...` are parsed
// into extra commands marked `nested`.
//
// It is a seatbelt, not a shell: it follows the common bash and PowerShell shapes and reports
// `unbalanced: true` when it could not close a quote, and `uncertain: true` for that and for anything else it
// cannot read the same way bash and PowerShell would, so callers fall back to something stricter.
// It never throws.

const MAX_DEPTH = 6;
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'sudo', 'builtin', 'nice', 'stdbuf', '{', '!']);
const ESCAPABLE = new Set([' ', '"', "'", '$', ';', '&', '|', '<', '>', '(', ')', '`', '\\']);

/** @typedef {{ text: string, quoted: boolean, dynamic: boolean }} Word */
/** @typedef {{ op: string, fd: number|null, target: Word|null }} Redir */
/** @typedef {{ words: Word[], redirs: Redir[], nested: boolean }} Command */

export function parseShell(input) {
  const out = { commands: [], unbalanced: false, uncertain: false };
  try {
    parseInto(String(input ?? ''), out, false, 0);
  } catch {
    out.unbalanced = true;
  }
  out.uncertain = out.uncertain || out.unbalanced;
  return out;
}

/** Index of the command word in `words`, skipping NAME=value assignments and wrappers like env/sudo. */
export function commandWord(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i].text;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i += 1; continue; }
    if (WRAPPERS.has(baseName(w))) {
      i += 1;
      // env/sudo options and assignments come before the real command
      while (i < words.length && (/^-/.test(words[i].text) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text))) i += 1;
      continue;
    }
    return i;
  }
  return Math.max(0, words.length - 1);
}

/**
 * Is `word` the command `name`? Read two ways, because bash and Windows disagree about backslashes:
 * as a path ("C:\Git\git.exe") and with the backslashes dropped ("g\it" is git to bash).
 */
export function isCmd(word, name) {
  const text = String(word);
  return baseName(text) === name || baseName(text.replace(/\\/g, '')) === name;
}

/**
 * Every word position that may start the real command. Normally one. After a wrapper (env, sudo, nice...)
 * every later word is a candidate, because the wrapper's own options and their arguments cannot be told apart.
 */
export function commandStarts(words) {
  const starts = [commandWord(words)];
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i += 1;
  if (i < words.length && WRAPPERS.has(baseName(words[i].text))) {
    for (let j = i + 1; j < words.length; j += 1) if (!starts.includes(j)) starts.push(j);
  }
  return starts;
}

/** "C:\\Program Files\\Git\\cmd\\git.exe" -> "git" */
export function baseName(word) {
  const last = String(word).split(/[\\/]/).pop() || '';
  return last.replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
}

/** Position just after the closer that matches the opener at `open` ("(" or "`"), or -1. */
function findClose(src, open, opener) {
  if (opener === '`') {
    for (let i = open + 1; i < src.length; i += 1) {
      if (src[i] === '\\') { i += 1; continue; }
      if (src[i] === '`') return i + 1;
    }
    return -1;
  }
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') { i += 1; continue; }
    if (c === "'") { const j = src.indexOf("'", i + 1); if (j < 0) return -1; i = j; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return -1;
      i = j;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

function parseInto(src, out, nested, depth) {
  const n = src.length;
  let words = [];
  let redirs = [];
  let buf = null;
  let pending = null; // a redirection operator waiting for its target word
  const heredocs = []; // delimiters whose bodies start after the next newline

  const start = () => { if (!buf) buf = { t: '', q: false, d: false }; return buf; };
  const flushWord = () => {
    if (!buf) return;
    const w = { text: buf.t, quoted: buf.q, dynamic: buf.d };
    buf = null;
    if (pending) {
      redirs.push({ op: pending.op, fd: pending.fd, target: w });
      if (pending.op === '<<' || pending.op === '<<-') heredocs.push({ delim: w.text.replace(/\\/g, ''), strip: pending.op === '<<-' });
      pending = null;
    } else words.push(w);
  };
  const endCommand = () => {
    flushWord();
    if (pending) { redirs.push({ op: pending.op, fd: pending.fd, target: null }); pending = null; }
    if (words.length || redirs.length) out.commands.push({ words, redirs, nested });
    words = [];
    redirs = [];
  };
  const subst = (i, opener) => {
    // Parses $(...) or `...` into nested commands; returns the index after it. The text stays in the word.
    const open = opener === '`' ? i : i + 1;
    const close = findClose(src, open, opener);
    const b = start();
    b.d = true;
    if (close < 0) { out.unbalanced = true; b.t += src.slice(i); return n; }
    if (depth >= MAX_DEPTH) { out.uncertain = true; b.t += src.slice(i, close); return close; }
    b.t += src.slice(i, close);
    parseInto(src.slice(open + 1, close - 1), out, true, depth + 1);
    return close;
  };

  let i = 0;
  while (i < n) {
    const c = src[i];

    if (c === "'") {
      const b = start();
      b.q = true;
      const j = src.indexOf("'", i + 1);
      if (j < 0) { out.unbalanced = true; b.t += src.slice(i + 1); i = n; break; }
      b.t += src.slice(i + 1, j);
      i = j + 1;
      continue;
    }

    if (c === '"') {
      const b = start();
      b.q = true;
      i += 1;
      let closed = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) {
          if (src[i + 1] === '"') out.uncertain = true; // bash and PowerShell read a backslash-quote differently
          b.t += src[i + 1];
          i += 2;
          continue;
        }
        if (d === '"') { closed = true; i += 1; break; }
        if (d === '$' && src[i + 1] === '(') { i = subst(i, '('); continue; }
        if (d === '`') { i = subst(i, '`'); continue; }
        if (d === '$') b.d = true;
        b.t += d;
        i += 1;
      }
      if (!closed) out.unbalanced = true;
      continue;
    }

    if (c === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; } // line continuation
      if (i + 1 < n && ESCAPABLE.has(src[i + 1])) { const b = start(); b.q = true; b.t += src[i + 1]; i += 2; continue; }
      start().t += c; // a Windows path separator is just a character
      i += 1;
      continue;
    }

    if (c === '$' && src[i + 1] === '(') { i = subst(i, '('); continue; }
    if (c === '`') { i = subst(i, '`'); continue; }

    if (c === ' ' || c === '\t' || c === '\r') { flushWord(); i += 1; continue; }

    if (c === '\n') {
      endCommand();
      i += 1;
      // heredoc bodies start here and are data until the delimiter line
      for (const h of heredocs.splice(0)) {
        let found = false;
        while (i < n) {
          let e = src.indexOf('\n', i);
          if (e < 0) e = n;
          const line = src.slice(i, e);
          i = Math.min(n, e + 1);
          if ((h.strip ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === h.delim) { found = true; break; }
        }
        if (!found) out.uncertain = true;
      }
      continue;
    }

    if (c === '#' && !buf) {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }

    if (c === ';' || c === '(' || c === ')') { endCommand(); i += 1; continue; }
    if (c === '|') { endCommand(); i += src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1; continue; }
    if (c === '&') {
      if (src[i + 1] === '>') { // &> and &>>
        flushWord();
        const op = src[i + 2] === '>' ? '&>>' : '&>';
        pending = { op, fd: null };
        i += op.length;
        continue;
      }
      endCommand();
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }

    if (c === '>' || c === '<') {
      let fd = null;
      if (buf && !buf.q && /^\d+$/.test(buf.t)) { fd = Number(buf.t); buf = null; } else flushWord();
      let op = c;
      const next = src[i + 1];
      if (c === '>') {
        if (next === '>') op = '>>';
        else if (next === '|') op = '>|';
        else if (next === '&') op = '>&';
      } else if (next === '<' && src[i + 2] === '<') op = '<<<';
      else if (next === '<' && src[i + 2] === '-') op = '<<-';
      else if (next === '<') op = '<<';
      else if (next === '&') op = '<&';
      else if (next === '>') op = '<>';
      if (pending) endCommand();
      pending = { op: op === '<<<' ? '<<<' : op, fd };
      i += op.length;
      continue;
    }

    const b = start();
    if (c === '$' || c === '*' || c === '?' || c === '[' || c === '%') b.d = true;
    b.t += c;
    i += 1;
  }
  endCommand();
}
