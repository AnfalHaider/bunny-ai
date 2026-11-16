/**
 * A small glob matcher for the workspace tools (search_files include/exclude, find_files).
 *
 *   *      anything except /          **     anything, including /          ?   one character except /
 *   {a,b}  either a or b              a pattern with no / matches the file name at any depth ("*.js")
 *   a pattern ending in / or naming a folder ("src/**") matches everything below it
 *
 * Paths are relative to the workspace, with forward slashes. Matching is case-insensitive.
 *
 * It does not build regular expressions: a pattern like "*a*a*a*a*b" over a long path must not take exponential time, because the
 * pattern comes from the model. Each path segment is matched with the two-pointer wildcard method, and "**" is a dynamic program over
 * segments, so the work is bounded by (pattern segments x path segments) plus the segment lengths.
 */

const MAX_PATTERN = 300;     // characters in one pattern
const MAX_EXPANDED = 256;    // patterns one {a,b} list may expand to
const MAX_STARS = 12;        // wildcards in one pattern

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
  const all = parts.flatMap((p) => expandBraces(head + p + tail));
  if (all.length > MAX_EXPANDED) throw new Error(`That file pattern expands to more than ${MAX_EXPANDED} patterns; use fewer {a,b} choices.`);
  return all;
}

/** One pattern as segments; "**" (alone in a segment) stays "**", any other run of stars inside a segment is one "*". */
function compile(glob) {
  if (glob.length > MAX_PATTERN) throw new Error(`A file pattern is longer than ${MAX_PATTERN} characters.`);
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  if ((g.match(/\*/g) ?? []).length > MAX_STARS) throw new Error(`A file pattern has more than ${MAX_STARS} wildcards.`);
  const anywhere = !g.includes('/');
  if (g.endsWith('/')) g += '**';
  const segs = g.split('/').filter((s) => s !== '' && s !== '.').map((s) => (/^\*+$/.test(s) && s.length > 1 ? '**' : s.replace(/\*{2,}/g, '*').toLowerCase()));
  // a bare name matches at any depth, and a folder pattern covers what is inside it
  if (anywhere) segs.unshift('**');
  if (segs[segs.length - 1] !== '**') segs.push('**');
  // "**/**" is "**"
  return segs.filter((s, i) => !(s === '**' && segs[i - 1] === '**'));
}

/** One segment against a pattern with * and ?: linear-time greedy matching with one backtrack point. */
function segmentMatches(pat, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === text[t])) { p += 1; t += 1; }
    else if (p < pat.length && pat[p] === '*') { star = p; p += 1; mark = t; }
    else if (star >= 0) { p = star + 1; mark += 1; t = mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p += 1;
  return p === pat.length;
}

/** Pattern segments against path segments: "**" takes zero or more whole segments. Dynamic program, no recursion. */
function pathMatches(pat, parts) {
  const P = pat.length;
  const N = parts.length;
  // ok[j] = the pattern from segment i matches parts from j; filled from the last pattern segment backwards
  let next = new Array(N + 1).fill(false);
  next[N] = true; // an empty remainder matches an empty remainder
  for (let i = P - 1; i >= 0; i -= 1) {
    const cur = new Array(N + 1).fill(false);
    if (pat[i] === '**') {
      cur[N] = next[N];
      for (let j = N - 1; j >= 0; j -= 1) cur[j] = next[j] || cur[j + 1];
    } else {
      for (let j = 0; j < N; j += 1) cur[j] = next[j + 1] && segmentMatches(pat[i], parts[j]);
    }
    next = cur;
  }
  return next[0];
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
  if (list.length > 50) throw new Error('Give at most 50 file patterns.');
  const compiled = list.flatMap(expandBraces).map(compile);
  if (compiled.length > MAX_EXPANDED) throw new Error(`Those file patterns expand to more than ${MAX_EXPANDED} patterns.`);
  return (path) => {
    const parts = String(path).replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.').map((s) => s.toLowerCase());
    return compiled.some((pat) => pathMatches(pat, parts));
  };
}
