/**
 * Permission rules (W2-7): "always allow npm test*", "never run Remove-Item -Recurse*", "never edit secrets/**".
 *
 * A rule is { id, kind: 'command' | 'path', pattern, effect: 'deny' | 'ask' | 'allow', ops?: 'edits' | 'reads' }, kept globally
 * and per folder. Rules are checked BEFORE the permission mode; Plan mode still refuses edits whatever a rule says.
 * Precedence: deny, then ask, then allow. Patterns are simple wildcards (* and **), never regular expressions.
 *
 * What a command rule matches is the command the model asked to run, cut into its simple commands (; && || | & and new lines,
 * quotes respected). A deny or ask rule fires if ANY of them matches (the whole text and the text inside $( ) and backticks too);
 * an allow rule applies only if EVERY simple command matches an allow rule and the command has no command substitution and no
 * redirection to a file, so "npm test; rm -rf x" is not allowed by "npm test*". Path rules judge the paths Bunny's own file tools
 * are given (read_file, list_files, search_files, find_files, write_file, edit_file, multi_edit); they do not look inside what a
 * command does.
 */
import { posix } from 'node:path';
import { analyseCommand, splitPowerShell } from './commandSplit.js';
import { globMatcher } from './glob.js';

export const MAX_RULES = 200;
export const MAX_PATTERN = 200;
const EFFECTS = ['deny', 'ask', 'allow'];
const STRENGTH = { deny: 3, ask: 2, allow: 1 };

/** Validate and tidy one rule from the settings screen. Returns { rule } or { error }. */
export function checkRule(raw) {
  const kind = raw?.kind === 'path' ? 'path' : raw?.kind === 'command' ? 'command' : null;
  if (!kind) return { error: 'Choose Command or Path.' };
  if (!EFFECTS.includes(raw?.effect)) return { error: 'Choose Deny, Ask or Allow.' };
  const pattern = String(raw?.pattern ?? '').replace(/\s+/g, ' ').trim();
  if (!pattern) return { error: 'Type a pattern first.' };
  if (pattern.length > MAX_PATTERN) return { error: `A pattern can be at most ${MAX_PATTERN} characters.` };
  if (/[\r\n\0]/.test(String(raw?.pattern ?? ''))) return { error: 'A pattern is one line.' };
  const rule = { id: typeof raw?.id === 'string' && raw.id ? raw.id.slice(0, 64) : `r_${Math.random().toString(36).slice(2, 10)}`, kind, pattern, effect: raw.effect };
  if (kind === 'path') {
    const text = pattern.replace(/\\/g, '/');
    if (/^([A-Za-z]:|\/|~)/.test(text)) return { error: 'A path pattern is relative to the folder: it cannot start with a drive, a slash or ~.' };
    if (text.split('/').includes('..')) return { error: 'A path pattern cannot leave the folder. Remove the ..\\ and try again.' };
    if ((text.match(/\*/g) ?? []).length > 12) return { error: 'That pattern has too many * in it.' };
    rule.ops = raw?.ops === 'reads' ? 'reads' : 'edits';
  }
  return { rule };
}

/** The stored rules, tidied: unknown or broken entries are dropped, never trusted. */
export function normaliseRules(stored) {
  const clean = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_RULES).map((r) => checkRule(r).rule).filter(Boolean);
  const folders = {};
  for (const [folder, list] of Object.entries(stored?.folders && typeof stored.folders === 'object' ? stored.folders : {})) {
    const rules = clean(list);
    if (rules.length) folders[folder] = rules;
  }
  return { global: clean(stored?.global), folders };
}

/** Rules that apply in a folder, strongest scope first: that folder's own, then the global ones. */
export function rulesFor(stored, folder) {
  const all = normaliseRules(stored);
  const key = Object.keys(all.folders).find((f) => folder && f.toLowerCase() === String(folder).toLowerCase());
  return [
    ...(key ? all.folders[key].map((r) => ({ ...r, scope: 'This folder' })) : []),
    ...all.global.map((r) => ({ ...r, scope: 'All folders' })),
  ];
}

// ---- commands

function wildcard(pattern, text) {
  const pat = pattern.toLowerCase();
  const str = text.toLowerCase();
  let p = 0; let t = 0; let star = -1; let mark = 0;
  while (t < str.length) {
    if (p < pat.length && pat[p] === '*') { star = p; p += 1; mark = t; }
    else if (p < pat.length && pat[p] === str[t]) { p += 1; t += 1; }
    else if (star >= 0) { p = star + 1; mark += 1; t = mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p += 1;
  return p === pat.length;
}

/** The command cut into simple commands (PowerShell quoting). `unsafe` = grouping, a redirection to a file, a substitution or a control character. */
export function commandParts(command) {
  const { parts, unsafe } = splitPowerShell(String(command ?? ''));
  return { parts, inner: [], unsafe, whole: String(command ?? '').replace(/\s+/g, ' ').trim() };
}

const WRAPPER_NOTE = 'a wrapper (cmd /c, powershell -Command, iex, & $x) can hide what it runs';

/**
 * A rule's verdict on a command: { effect, rule } or null. Deny beats ask beats allow.
 * Deny and Ask are matched against every spelling of every part, read three ways (see commandSplit.js). An Allow applies only when
 * every part of all three readings is covered and nothing in the line is unsafe. A wrapper (cmd /c, powershell -Command, iex, & $x)
 * asks whenever any Deny or Ask rule exists, because what it runs cannot be read.
 */
export function checkCommand(rules, command) {
  const list = rules.filter((r) => r.kind === 'command');
  if (!list.length) return null;
  const analysis = analyseCommand(command);
  for (const effect of ['deny', 'ask']) {
    for (const r of list) if (r.effect === effect && analysis.texts.some((t) => wildcard(r.pattern, t))) return { effect, rule: r };
  }
  const guard = list.find((r) => r.effect === 'deny' || r.effect === 'ask');
  if (analysis.wrapper && guard) return { effect: 'ask', rule: { pattern: WRAPPER_NOTE, scope: guard.scope ?? 'All folders', effect: 'ask' } };
  const allows = list.filter((r) => r.effect === 'allow');
  if (!allows.length || analysis.unsafe) return null;
  let first = null;
  for (const reading of analysis.readings) {
    if (!reading.length) return null;
    for (const part of reading) {
      const r = allows.find((x) => wildcard(x.pattern, part));
      if (!r) return null;
      first ??= r;
    }
  }
  return { effect: 'allow', rule: first };
}

// ---- paths

const norm = (p) => {
  let t = String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  // Windows reads "key.txt::$DATA" and "key.txt." as key.txt, and "secrets.\\x" as secrets\\x
  if (process.platform === 'win32') t = t.split('/').map((seg) => seg.split(':')[0].replace(/[. ]+$/, '') || seg).join('/');
  return t;
};

/** A rule's verdict on one path for an operation ('edits' or 'reads'): { effect, rule } or null. */
export function checkPath(rules, rel, op) {
  const path = norm(rel);
  const list = rules.filter((r) => r.kind === 'path' && r.ops === op);
  let best = null;
  for (const r of list) {
    if (!globMatcher(r.pattern)(path === '' ? '.' : path)) continue;
    if (!best || STRENGTH[r.effect] > STRENGTH[best.effect]) best = { effect: r.effect, rule: r };
  }
  return best;
}

/**
 * The verdict on a path given as several spellings (as typed, collapsed, and the real file the tool will touch): a Deny or Ask on
 * any of them stands; an Allow needs every one of them to be allowed.
 */
export function checkPaths(rules, candidates, op) {
  const results = candidates.filter((c) => typeof c === 'string').map((c) => checkPath(rules, c, op));
  for (const effect of ['deny', 'ask']) { const hit = results.find((r) => r?.effect === effect); if (hit) return hit; }
  return results.length && results.every((r) => r?.effect === 'allow') ? results[0] : null;
}

/** Is reading this path denied? For the file listings, which skip such paths. */
export function readDenied(rules, rel) {
  return checkPath(rules, rel, 'reads')?.effect === 'deny';
}

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit', 'download_file']); // W613-1: a download writes a file, so the person's edit rules judge it too
const READ_TOOLS = new Set(['read_file', 'list_files', 'search_files', 'find_files']);

/** The verdict for one workspace tool call, or null when no rule speaks. */
export function checkToolCall(rules, name, args = {}, canonPath = null) {
  if (name === 'run_command' || name === 'start_process') return checkCommand(rules, args.command);
  // "a/../secrets/x" is collapsed first, and the real file (after links) is judged too
  const spellings = (p) => [norm(p), posix.normalize(norm(p) || '.'), canonPath];
  const judge = (p, op) => {
    const verdict = checkPaths(rules, spellings(p), op);
    // Where this path really leads cannot be worked out (a dangling link...): with a path rule in play, that is a question for the person
    if (canonPath === false && verdict?.effect !== 'deny') {
      const some = rules.find((r) => r.kind === 'path' && r.ops === op);
      if (some) return { effect: 'ask', rule: { pattern: `where ${norm(p) || '.'} really leads cannot be worked out`, scope: some.scope ?? 'All folders' } };
    }
    return verdict;
  };
  if (EDIT_TOOLS.has(name)) return judge(args.path, 'edits');
  if (READ_TOOLS.has(name)) return judge(args.path ?? '.', 'reads');
  return null;
}

/** "Your rule "git push*" (All folders)" */
export function describeRule(verdict) {
  return `"${verdict.rule.pattern}" (${verdict.rule.scope ?? 'All folders'})`;
}

/** A new Allow that a Deny already covers never applies: say so. Returns the covering rule or null. */
export function coveredByDeny(rules, rule) {
  if (rule.effect !== 'allow') return null;
  if (rule.kind === 'command') return rules.find((r) => r.kind === 'command' && r.effect === 'deny' && wildcard(r.pattern, rule.pattern)) ?? null;
  return rules.find((r) => r.kind === 'path' && r.effect === 'deny' && r.ops === rule.ops && globMatcher(r.pattern)(norm(rule.pattern))) ?? null;
}
