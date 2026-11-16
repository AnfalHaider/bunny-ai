/**
 * A small glob matcher for the workspace tools (search_files include/exclude, find_files).
 *
 *   *      anything except /          **     anything, including /          ?   one character except /
 *   {a,b}  either a or b              a pattern with no / matches the file name at any depth ("*.js")
 *   a pattern ending in / or naming a folder ("src/**") matches everything below it
 *
 * Paths are relative to the workspace, with forward slashes.
 */

function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open < 0) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    if (pattern[i] === '{') depth += 1;
    else if (pattern[i] === '}') { depth -= 1; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return [pattern];
  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  const parts = [];
  let level = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    if (pattern[i] === '{') level += 1;
    else if (pattern[i] === '}') level -= 1;
    else if (pattern[i] === ',' && level === 0) { parts.push(pattern.slice(from, i)); from = i + 1; }
  }
  parts.push(pattern.slice(from, close));
  return parts.flatMap((p) => expandBraces(head + p + tail));
}

function oneToRegExp(glob) {
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  const anywhere = !g.includes('/');
  if (g.endsWith('/')) g += '**';
  let out = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i += 1;
        if (g[i + 1] === '/') { i += 1; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // "src" or "src/**" style patterns also cover what is inside the folder.
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${out}(?:/.*)?$`, 'i');
}

/** "*.js, *.ts" or one per line; a comma inside {a,b} stays part of its pattern. */
function splitList(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '{') depth += 1;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if ((c === ',' && depth === 0) || c === '\n') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** A function path => boolean for one pattern or a list (a path matching any of them counts). Empty means "match everything". */
export function globMatcher(patterns) {
  const list = (Array.isArray(patterns) ? patterns : splitList(String(patterns ?? '')))
    .map((p) => String(p).trim()).filter(Boolean);
  if (!list.length) return () => true;
  const res = list.flatMap(expandBraces).map(oneToRegExp);
  return (path) => res.some((re) => re.test(path));
}
