// Item 5: the guard's old whole-string patterns (deny_all) judged the raw command text, so a flag in a quoted message, or in the next
// command of a chain, tripped them ("git push ...; git worktree remove --force d" counted as a force push). This reads the text the
// way a shell does just enough to fix that: quoted spans and here-document bodies are blanked, then the line is cut into simple commands.
//
// ANSI-C ($'...') and locale ($"...") quoting stay as written: they can spell a flag the tokenizer would read differently, which is
// why the patterns still run over the raw text there. It is a seatbelt next to lib/shellparse.mjs, not a second parser.

/** The command line as its simple commands, with quoted text and here-document bodies replaced by spaces. */
export function simpleCommandTexts(command) {
  const src = String(command ?? '');
  const blank = (n) => ' '.repeat(n);
  let out = '';
  const pendingHeredocs = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) { out += src.slice(i, i + 2); i += 2; continue; }
    if (c === "'" || c === '"') {
      const ansi = src[i - 1] === '$';
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += (c === '"' || ansi) && src[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, src.length);
      if (j >= src.length) { out += src.slice(i); i = src.length; break; } // unclosed: keep it, the caller treats the line as uncertain anyway
      out += ansi ? src.slice(i, end) : blank(end - i);
      i = end;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z0-9_.-]+))/.exec(src.slice(i));
      if (m) { pendingHeredocs.push({ delim: m[2] ?? m[3] ?? m[4], strip: m[1] === '-' }); out += src.slice(i, i + m[0].length); i += m[0].length; continue; }
    }
    if (c === '\n' && pendingHeredocs.length) {
      out += '\n';
      i += 1;
      for (const h of pendingHeredocs.splice(0)) {
        for (;;) {
          if (i >= src.length) break;
          let e = src.indexOf('\n', i);
          if (e < 0) e = src.length;
          const line = src.slice(i, e);
          out += blank(line.length);
          i = Math.min(e + 1, src.length);
          if (e < src.length) out += '\n';
          if ((h.strip ? line.trim() : line.replace(/\r$/, '')) === h.delim) break;
        }
      }
      continue;
    }
    out += c;
    i += 1;
  }
  // 2>&1, >&2 and &> are redirections, not command separators
  return out.replace(/([<>])&/g, '$1_').replace(/&>/g, '_>').split(/;|&&|\|\||\||&|\n|\(|\)|`/).map((s) => s.trim()).filter(Boolean);
}
