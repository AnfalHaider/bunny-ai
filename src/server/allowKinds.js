/**
 * AGENT-FLOW F9 (the owner: "Yes, add it"): "Allow for this chat" on a permission card. A KIND is one narrow, named class of action; once the person gives it, the same kind stops asking until the chat ends.
 * This file is the pure part: how a kind is made from a call's OWN arguments (never from text), how it is matched, when none is offered (with fixed reasons), and the words. Security F9-1 to F9-7.
 *
 *   command   a fixed list of program + sub-command pairs gets a wide kind ("npm run"); every other plain command gets only its exact text; anything Bunny cannot read gets none
 *   edit      one folder (real path) inside the workspace and below it; never the workspace root; never a file that runs later
 *   connector a connector's id plus the tool's ORIGINAL name; never a tool that sends or buys
 *   computer  all four computer actions, for THIS REPLY only (kept in memory by the app, never in a chat)
 *   browser   the exact host of the panel's current page (no subdomains), changes only; never a submit that sends typed text, a download or a purchase
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { analyseCommand } from './commandSplit.js';
import { runsLater } from './engines/staging.js';

export const MAX_KINDS = 50;

/** F9-1: the only program + sub-command pairs that get a wide kind. A one-word entry is a program that is its own command. */
export const COMMAND_PAIRS = Object.freeze([
  'npm run', 'npm test', 'pnpm run', 'pnpm test', 'yarn run', 'yarn test',
  'git status', 'git diff', 'git log', 'git show', 'git add', 'git commit',
  'dotnet build', 'dotnet test', 'cargo build', 'cargo test', 'go build', 'go test',
  'pytest', 'tsc', 'eslint', 'prettier --check',
]);
/** Programs that take a sub-command: an option before it ("git -c", "npm --prefix") means no kind at all. */
const SUBCOMMAND_PROGRAMS = new Set(['npm', 'pnpm', 'yarn', 'git', 'dotnet', 'cargo', 'go', 'pip', 'winget', 'choco']);
/** F9-8: options that move a command elsewhere or change what runs (also in their --opt=value form), project files named by a path, and any argument that leads outside the folder. */
const MOVING_OPTIONS = new Set(['--prefix', '--script-shell', '--userconfig', '--globalconfig', '--registry', '--cache', '--workspace', '-w', '--workspaces', '-c', '--dir', '--cwd', '--manifest-path', '--project', '--solution', '--root', '--config', '--git-dir', '--work-tree', '--output', '--output-file', '--config-file', '--ignore-path', '--rulesdir', '--resolve-plugins-relative-to', '--tsconfig', '-p', '--rootdir', '-r', '--require', '--plugin', '--plugins', '--resolve-plugins-relative-to', '--project-dir', '--outdir', '--outfile', '--out-dir']);
export function reachesOut(args) {
  for (const raw of args) {
    const [name, ...rest] = String(raw).split('=');
    if (MOVING_OPTIONS.has(name.toLowerCase()) || /^-C/.test(name) && name === '-C') return true;
    for (const value of [name.startsWith('-') ? rest.join('=') : String(raw)]) {
      if (!value) continue;
      if (/\.(sln|slnx|csproj|fsproj|vbproj)$/i.test(value)) return true; // dotnet with a project or solution file
      if (/(^|[\\/])\.\.([\\/]|$)/.test(value) || /^([\\/]|~|[A-Za-z]:)/.test(value)) return true; // up and out, absolute, home, or a drive
    }
  }
  return false;
}

/** The reasons shown under a card that offers no kind: FIXED strings, keyed by the case, never model text (Security a). */
export const REASONS = Object.freeze({
  compound: 'it has more than one part, so Bunny cannot tell what exactly will run',
  path: "this command is named by a path or has options Bunny can't check",
  sends: 'this sends or buys something',
  sending: 'sending always asks',
  building: 'adding tools and connectors always asks',
  askRule: 'your own Ask rule asks every time',
  protectedPath: 'this file can run code later, so it asks every time',
  root: "this edits the project's top folder, so it asks every time",
  helper: 'a helper is asking',
  pcText: 'this chat has read text from your PC files, so it asks every time',
  scheduled: 'a scheduled run has nobody to ask',
  noHost: "Bunny could not tell which site this page is on",
});
export const reasonLine = (key) => (REASONS[key] ? `Asked every time: ${REASONS[key]}` : '');
export const DEVICE_LINE = '"For this chat" can be given only on the PC.';

// ---------------------------------------------------------------- finding a program the way the shell would, without the current folder (F9-1)

/** The absolute path a bare program name resolves to through PATH, with the working folder and "." left out so a planted file cannot take the kind over. null when it is not a file on PATH (a builtin, a cmdlet). */
export function resolveProgram(name, { cwd, env = process.env, exists = existsSync, isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } } } = {}) {
  if (!/^[A-Za-z0-9_.+-]+$/.test(String(name))) return null;
  const skip = new Set([cwd ? resolve(cwd).toLowerCase() : null, resolve('.').toLowerCase()].filter(Boolean));
  const paths = String(env.PATH ?? env.Path ?? '').split(delimiter).map((p) => p.trim().replace(/^"|"$/g, '')).filter((p) => p && p !== '.' && isAbsolute(p));
  const exts = process.platform === 'win32' || env.PATHEXT ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const hasExt = /\.[A-Za-z0-9]{1,4}$/.test(name);
  for (const dir of paths) {
    if (skip.has(resolve(dir).toLowerCase())) continue;
    for (const ext of hasExt ? [''] : ['', ...exts]) {
      const candidate = join(dir, name + ext);
      if (exists(candidate) && isFile(candidate) && (ext !== '' || hasExt || process.platform !== 'win32')) return resolve(candidate).toLowerCase();
    }
  }
  return null;
}

// ---------------------------------------------------------------- the plain words of a command

/** The words of a command made only of plain words and simple quotes, or null: any metacharacter, variable, substitution, redirect, pipe, group or control character makes it unreadable. */
export function plainWords(command) {
  const text = String(command ?? '');
  if (!text.trim() || /[\0\r\n]/.test(text)) return null;
  const words = []; let cur = ''; let quote = null; let has = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '$' || c === '`' || (quote === '"' && c === '%')) return null;
      cur += c; continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) words.push(cur); cur = ''; has = false; continue; }
    if (/[&|;<>(){}$`^%*?\[\]~!#,@]/.test(c)) return null; // a pipe, a redirect, a group, a variable, a glob: not plain
    cur += c;
  }
  if (quote) return null;
  if (cur || has) words.push(cur);
  return words.length ? words : null;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * The kind a command call may be given, from the command text alone (plus where its program is on PATH):
 *   { kind: { type: 'command', mode: 'pair'|'exact', key, program, exe, label, button, ruleText?, pattern }, reason: null }  or  { kind: null, reason: <REASONS key> }
 * A command named by a path, with an option before its sub-command, or that Bunny cannot read gets no kind at all, not even the exact one.
 */
export function commandKind(command, { cwd = null, env = process.env, resolve: resolver = resolveProgram } = {}) {
  const whole = norm(command);
  const analysis = analyseCommand(String(command ?? ''));
  const words = plainWords(command);
  if (!words || analysis.unsafe || analysis.wrapper || analysis.readings.some((r) => r.length > 1)) return { kind: null, reason: 'compound' };
  const first = words[0];
  if (/[\\/:]/.test(first) || /^\.+$/.test(first) || !/^[A-Za-z0-9_.+-]+$/.test(first)) return { kind: null, reason: 'path' };
  const program = first.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
  const second = words[1]?.toLowerCase();
  if (SUBCOMMAND_PROGRAMS.has(program) && words.length > 1 && second.startsWith('-')) return { kind: null, reason: 'path' }; // git -c, npm --prefix: options before the sub-command
  const exe = resolver(first, { cwd, env });
  const pairKey = COMMAND_PAIRS.find((p) => {
    const [pp, ps] = p.split(' ');
    return program === pp && (ps === undefined || second === ps);
  });
  const dangerous = (program === 'git' && words.slice(1).some((w) => w === 'push' || w === '-c')) || reachesOut(words.slice(pairKey?.includes(' ') ? 2 : 1)); // F9-8: an option or argument that can move the command out of the folder gets only the exact kind
  if (pairKey && !dangerous) {
    return { kind: { type: 'command', mode: 'pair', key: pairKey, program, exe, label: `${pairKey} commands`, button: `Allow \`${pairKey}\` commands in this chat`, pattern: `${pairKey} *`, ruleWords: pairKey }, reason: null };
  }
  return { kind: { type: 'command', mode: 'exact', key: whole, program, exe, label: whole.length > 60 ? `${whole.slice(0, 57)}…` : whole, button: `Allow \`${whole.length > 80 ? `${whole.slice(0, 77)}…` : whole}\` (this exact command) in this chat`, pattern: whole, ruleWords: whole }, reason: null };
}

/** Does an allowed command kind cover this call? Recomputed from the call's own text now; the program must still resolve to the same absolute path. */
export function commandMatches(kind, command, opts = {}) {
  if (kind?.type !== 'command') return false;
  const now = commandKind(command, opts);
  if (!now.kind || now.kind.mode !== kind.mode || now.kind.key !== kind.key) return false; // a pair covers calls of the same pair; an exact kind only the same text, never a prefix
  return (now.kind.exe ?? null) === (kind.exe ?? null);
}

// ---------------------------------------------------------------- edits

/** Files that run later (a hook, a script, a workflow, a task, package.json): outside every edit kind (F9-2). The same list the restricted-engine staging uses. */
const slashes = (rel) => String(rel).split(String.fromCharCode(92)).join('/');
const runsLaterFile = (rel) => runsLater(rel) || /(^|\/)\.git(\/|$)/i.test(slashes(rel)) || /(^|\/)\.husky\//i.test(slashes(rel));

const middleCut = (s, max = 40) => (s.length <= max ? s : `${s.slice(0, Math.ceil((max - 1) / 2))}…${s.slice(-Math.floor((max - 1) / 2))}`);

/** The kind for an edit of `abs` inside `root`: the real folder of the file, relative to the root, never the root itself. */
export function editKind(abs, root, { real = (p) => { try { return realpathSync(p); } catch { return null; } } } = {}) {
  if (!abs || !root) return { kind: null, reason: 'path' };
  const realRoot = real(root); if (!realRoot) return { kind: null, reason: 'path' };
  let dir = dirname(resolve(abs)); let found = null;
  for (let i = 0; i < 64 && !found; i += 1) { found = real(dir); if (!found) { const up = dirname(dir); if (up === dir) break; dir = up; } }
  if (!found) return { kind: null, reason: 'path' };
  const rel = relative(realRoot, found).split(sep).join('/');
  if (rel.startsWith('..') || isAbsolute(rel)) return { kind: null, reason: 'path' };
  const relFile = relative(realRoot, resolve(abs)).split(sep).join('/');
  if (runsLaterFile(relFile)) return { kind: null, reason: 'protectedPath' };
  if (rel === '') return { kind: null, reason: 'root' };
  const shown = `${rel}/`;
  return { kind: { type: 'edit', key: found.toLowerCase(), dir: found, rel: shown, label: `Edits in ${middleCut(shown)}`, title: found, button: `Allow edits in \`${middleCut(shown)}\` in this chat`, pattern: `${rel}/**` }, reason: null };
}
export function editMatches(kind, abs, root, opts = {}) {
  if (kind?.type !== 'edit') return false;
  const now = editKind(abs, root, opts);
  if (!now.kind) return false; // a file that runs later, or the root, is never covered
  const folder = kind.key; const here = now.kind.key;
  return here === folder || here.startsWith(`${folder}${sep}`.toLowerCase()) || here.startsWith(`${folder}/`);
}

// ---------------------------------------------------------------- connector tools, computer, browser

const SENDS = /(^|[_\-. ])(send|email|mail|message|sms|post|publish|tweet|pay|payment|charge|buy|purchase|order|transfer|delete|remove|destroy|drop|submit|checkout)([_\-. ]|$)/i;
export function connectorKind({ serverId, serverName, toolName }) {
  if (!serverId || !toolName) return { kind: null, reason: 'building' };
  if (SENDS.test(String(toolName))) return { kind: null, reason: 'sends' };
  const name = `${String(serverName ?? 'Connector').slice(0, 40)}: ${String(toolName).slice(0, 60)}`;
  return { kind: { type: 'connector', key: `${serverId}::${toolName}`, label: name, button: `Allow ${name} in this chat` }, reason: null };
}
export const connectorMatches = (kind, { serverId, toolName }) => kind?.type === 'connector' && kind.key === `${serverId}::${toolName}` && !SENDS.test(String(toolName));

export const COMPUTER_TOOLS = Object.freeze(['computer_click', 'computer_type', 'computer_key', 'computer_scroll']);
export const computerKind = () => ({ kind: { type: 'computer', key: 'computer', label: 'Controlling this PC', button: 'Allow controlling this PC for this task', thisReplyOnly: true }, reason: null });

/** `host` is what the main process reported for the panel's current page. Only a plain host with no credentials; a call that submits typed text is once only. */
export function browserKind(host, { name, parsed } = {}) {
  if (name === 'browser_capture' || (name === 'browser_type' && parsed?.submit === true)) return { kind: null, reason: 'sends' };
  const h = String(host ?? '').toLowerCase();
  if (!/^([a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]{2,45}\])$/.test(h)) return { kind: null, reason: 'noHost' }; // a name, an IPv4 literal, localhost, or a bracketed IPv6 literal: the exact host only
  return { kind: { type: 'browser', key: h, label: `Actions on ${h}`, button: `Allow actions on ${h} in this chat` }, reason: null };
}
export const browserMatches = (kind, host) => kind?.type === 'browser' && kind.key === String(host ?? '').toLowerCase();

// ---------------------------------------------------------------- the list kept on the chat

/** What is stored: only these fields, made from a checked kind. At most MAX_KINDS; the same kind is never stored twice. */
export const storable = (kind) => ({ type: kind.type, key: String(kind.key).slice(0, 400), label: String(kind.label).slice(0, 120), ...(kind.mode ? { mode: kind.mode } : {}), ...(kind.program ? { program: kind.program } : {}), ...(kind.exe !== undefined ? { exe: kind.exe } : {}), ...(kind.dir ? { dir: String(kind.dir).slice(0, 500) } : {}), ...(kind.rel ? { rel: String(kind.rel).slice(0, 200) } : {}), ...(kind.title ? { title: String(kind.title).slice(0, 500) } : {}) });
export function addKind(list, kind, at = new Date().toISOString()) {
  const next = Array.isArray(list) ? list.filter((k) => !(k.type === kind.type && k.key === kind.key)) : [];
  next.push({ ...storable(kind), at });
  return next.slice(-MAX_KINDS);
}

/** The rule text a tick would save, shown on the card before saving (F9-6): { text, rule } or null when the kind cannot be saved (computer, browser, connector). Allow only. */
export function saveRuleFor(kind, folder) {
  if (kind?.type === 'command') return { text: `Allow \`${kind.pattern}\` in ${folder}`, rule: { kind: 'command', effect: 'allow', pattern: kind.pattern } };
  if (kind?.type === 'edit') return { text: `Allow edits to \`${kind.pattern}\` in ${folder}`, rule: { kind: 'path', effect: 'allow', pattern: kind.pattern, ops: 'edits' } };
  return null;
}
