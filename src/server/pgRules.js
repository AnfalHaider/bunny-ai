/**
 * PERMISSIONS-GAPS (v0.1.15): the three new kinds of permission rule and the built-in read-only commands.
 *
 *   PG-1  kind 'domain'  a website: "ask before example.com", "never *.paste.io". Judged on read_url, download_file, the browser
 *                        and a remote connector's address, on the final address and on every redirect hop.
 *   PG-2  kind 'tool'    a tool by name: "notion:*" (connector id + the connector's own tool name), "browser_*", "computer_*".
 *   PG-3  kind 'agent'   helpers and other chats: helper:*, helper:<job>, chat:start, chat:message.
 *   PG-5  a short fixed list of commands that only read, which run without a card in Ask mode.
 *
 * Order is the usual one: deny, then ask, then allow. An allow never weakens a fixed protection (Security's PG1-b, PG2-c, PG3-a):
 * it skips the Ask-mode card for reads, edits and commands only, never for a send or a build, and never for chat:message.
 * Pure functions only: app.js decides what to do with a verdict.
 */
import { splitPowerShell } from './commandSplit.js';

// ---- text matching (the same * wildcard as the command rules, case-blind)

export function wildcard(pattern, text) {
  const pat = String(pattern).toLowerCase();
  const str = String(text).toLowerCase();
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

const STAR = 'zzstarzz';

// ---- PG-1: websites

/** The host of an address as a rule sees it: lowercase, no trailing dot, punycode, IP literals in dotted form, no port. null when it has none. */
export function hostOf(address) {
  let u;
  try { u = new URL(String(address ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  return host || null;
}

/** A rule's host pattern in the same form: what the person typed may be a whole address, may have a port or capitals. null when it is not a host. */
export function normaliseHostPattern(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '');
  if (!/^\[.*\]$|^[^:]*$/.test(text.replace(/:\d+$/, ''))) return null;
  text = text.replace(/:\d+$/, '').replace(/\.+$/, '');
  if (!text) return null;
  if (text === '*') return '*';
  if (/[^\w*.[\]:-]/u.test(text) && !/[^\x00-\x7f]/.test(text)) return null;
  let host;
  try { host = new URL(`http://${text.replace(/\*/g, STAR)}/`).hostname.toLowerCase(); } catch { return null; }
  if (!host) return null;
  return host.split(STAR).join('*').replace(/\.+$/, '');
}

function strongest(rules, test) {
  let best = null;
  const rank = { deny: 3, ask: 2, allow: 1 };
  for (const r of rules) {
    if (!test(r)) continue;
    if (!best || rank[r.effect] > rank[best.effect]) best = { effect: r.effect, rule: r };
  }
  return best;
}

/** A rule's verdict on an address: { effect, rule } or null. Deny beats ask beats allow. */
export function checkDomain(rules, address) {
  const host = hostOf(address);
  if (!host) return null;
  return strongest(rules.filter((r) => r.kind === 'domain'), (r) => wildcard(r.pattern, host));
}

// ---- PG1-c: the browser panel (Electron's webRequest: every request of every panel page)

const approvedSites = new Map(); // host -> time the person's yes runs out. Server and window share one process, so the card's answer reaches the panel.
const APPROVAL_MS = 10 * 60 * 1000;
export function approveSite(host, { now = Date.now(), ttl = APPROVAL_MS } = {}) { if (host) approvedSites.set(host, now + ttl); }
export function siteApproved(host, now = Date.now()) { const until = approvedSites.get(host); if (until && until > now) return true; approvedSites.delete(host); return false; }

/**
 * May this request of a panel page go out? Deny blocks every kind of request. Ask blocks every sub-resource (no card can stop a page mid-load, Settings says so);
 * a top-level page on an ask host loads only when the person just said yes to it in a card (the server's gate recorded that with approveSite).
 */
export function panelAllows(rules, { url, resourceType }, now = Date.now()) {
  const v = checkDomain(rules, url);
  if (!v || v.effect === 'allow') return true;
  if (v.effect === 'deny') return false;
  return resourceType === 'mainFrame' && siteApproved(hostOf(url), now);
}

// ---- PG-2: tools by name

/** The name a tool rule matches: a connector's id plus its own tool name (a rename of either cannot escape a rule), else the tool's name. */
export function toolKey(name, entry = null) {
  return entry?.server?.id && entry?.tool?.name ? `${entry.server.id}:${entry.tool.name}` : String(name);
}

export function checkToolName(rules, key) {
  return strongest(rules.filter((r) => r.kind === 'tool'), (r) => wildcard(r.pattern, key));
}

// ---- PG-3: helpers and other chats

/** The agent pattern a call falls under, or null when it is not an agent call. */
export function agentKey(name, args = {}) {
  if (name === 'run_subagent') {
    const job = String(args?.job ?? '').toLowerCase().replace(/[^a-z]/g, '');
    return `helper:${['code', 'research', 'see', 'chat'].includes(job) ? job : 'code'}`;
  }
  if (name === 'start_session' || name === 'move_to_new_chat') return 'chat:start';
  if (name === 'message_session') return 'chat:message';
  return null;
}

export const AGENT_PATTERNS = ['helper:*', 'helper:code', 'helper:research', 'helper:see', 'helper:chat', 'chat:start', 'chat:message'];

export function checkAgent(rules, key) {
  return strongest(rules.filter((r) => r.kind === 'agent'), (r) => wildcard(r.pattern, key));
}

/** May an allow rule skip the Ask-mode card for this call? Never for a message to another chat (it speaks for the person). */
export function allowSkipsCard(name) {
  return name !== 'message_session';
}

// ---- rule validation for the three kinds (called from permissionRules.checkRule)

export const NEW_KINDS = ['domain', 'tool', 'agent'];

/** Returns { pattern } or { error } for a rule of one of the new kinds. */
export function checkNewKind(kind, rawPattern) {
  const text = String(rawPattern ?? '').replace(/\s+/g, ' ').trim();
  if (kind === 'domain') {
    const host = normaliseHostPattern(text);
    if (!host) return { error: 'Type a website, like example.com or *.example.com.' };
    if ((host.match(/\*/g) ?? []).length > 4) return { error: 'That pattern has too many * in it.' };
    return { pattern: host };
  }
  if (kind === 'tool') {
    if (!/^[\w.*:-]{1,200}$/u.test(text)) return { error: 'A tool name has letters, numbers, - _ . : and * only, like browser_* or notion:*.' };
    return { pattern: text };
  }
  if (kind === 'agent') {
    const low = text.toLowerCase();
    if (!AGENT_PATTERNS.includes(low)) return { error: `Choose one of: ${AGENT_PATTERNS.join(', ')}.` };
    return { pattern: low };
  }
  return { error: 'Choose a kind of rule.' };
}

// ---- PG-5: built-in read-only commands

/** The fixed list, for Settings to show read-only. */
export const READ_ONLY_COMMANDS = Object.freeze([
  'git status', 'git diff', 'git log',
  'dir / ls / Get-ChildItem', 'type / cat / Get-Content',
  'npm ls', 'node --version',
]);

const GIT_FIXED = ['-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'diff.external=', '--no-pager'];
const GIT_FLAGS = {
  status: /^(-s|--short|-b|--branch|--porcelain|--porcelain=v1|--porcelain=v2|--no-color|--ignored|--untracked-files=(no|normal|all))$/,
  diff: /^(--stat|--shortstat|--numstat|--name-only|--name-status|--cached|--staged|--no-color|--no-renames|-w|--ignore-all-space|-U\d{1,2})$/,
  log: /^(--oneline|--graph|--decorate|--no-color|--stat|--name-only|--name-status|-p|--patch|--no-merges|--abbrev-commit|-\d{1,3}|-n)$/,
};
const LS_NAMES = new Set(['dir', 'ls', 'gci', 'get-childitem']);
const CAT_NAMES = new Set(['type', 'cat', 'gc', 'get-content']);
const LS_FLAGS = /^(-recurse|-name|-file|-directory|-force|\/b|\/s|\/a|\/ad|\/-c)$/i;
const CAT_FLAGS = /^(-totalcount|-tail|-head)$/i;
// anything that lets a line do more than the plain words it shows
const BAD_CHARS = /[`"'$%^@{}()<>|&,]|\0|[\x00-\x08\x0b-\x1f]/;

/** Is this one argument a path or a revision (not a flag)? */
const isPlainArg = (a) => !a.startsWith('-') && !/^\/[a-z-]+$/i.test(a) && !/^[a-z]:/i.test(a) && !a.startsWith('~') && !a.startsWith('\\\\') && !a.startsWith('//') && !/^[\\/]/.test(a);

/**
 * If every part of this command is one of the listed read-only forms with listed flags, returns { command } (git forms rewritten with
 * fixed options, PG5-a). Otherwise null. `pathOk(arg)` is asked for every path argument and answers true only for a path inside the
 * folder that the person's read rules allow (PG5-b); a path it cannot vouch for makes the whole command ask.
 */
export async function readOnlyCommand(command, pathOk) {
  const text = String(command ?? '');
  if (!text.trim() || BAD_CHARS.test(text.replace(/\n/g, ' '))) return null;
  const { parts, unsafe } = splitPowerShell(text);
  if (unsafe || !parts.length || parts.length > 6) return null;
  const rewritten = [];
  for (const part of parts) {
    const out = await oneReadOnly(part.split(' ').filter(Boolean), pathOk);
    if (!out) return null;
    rewritten.push(out);
  }
  return { command: rewritten.join('; ') };
}

async function pathsOk(args, pathOk) {
  for (const a of args) { if (!isPlainArg(a) || /[<>|]/.test(a) || !(await pathOk(a))) return false; }
  return true;
}

async function oneReadOnly(tokens, pathOk) {
  const name = tokens[0]?.toLowerCase();
  const rest = tokens.slice(1);
  if (name === 'node') return rest.length === 1 && /^(--version|-v)$/.test(rest[0]) ? 'node --version' : null;
  if (name === 'npm') return rest.length === 1 && /^(ls|list)$/.test(rest[0]) ? `npm ${rest[0]}` : null;
  if (name === 'git') {
    const sub = rest[0]?.toLowerCase();
    if (!GIT_FLAGS[sub]) return null; // also refuses git's own -c, -C and --git-dir in front: only the exact listed forms
    const args = rest.slice(1);
    const flags = [];
    const plain = [];
    let afterDashes = false;
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a === '--' && !afterDashes) { afterDashes = true; continue; }
      if (afterDashes || isPlainArg(a)) {
        if (sub === 'log' && i > 0 && args[i - 1].toLowerCase() === '-n' && /^\d{1,4}$/.test(a)) { flags.push(a); continue; } // log --oneline -n 20
        plain.push(a);
      } else if (GIT_FLAGS[sub].test(a) && !(sub === 'log' && a === '-n' && !/^\d{1,4}$/.test(args[i + 1] ?? ''))) flags.push(a);
      else return null; // an unknown flag gets a card
    }
    if (!(await pathsOk(plain, pathOk))) return null;
    const extra = (sub === 'diff' || (sub === 'log' && flags.some((f) => /^(-p|--patch)$/.test(f)))) ? ['--no-ext-diff', '--no-textconv'] : [];
    return ['git', ...GIT_FIXED, sub, ...extra, ...flags, ...(plain.length ? ['--', ...plain] : [])].join(' ');
  }
  if (LS_NAMES.has(name) || CAT_NAMES.has(name)) {
    const ls = LS_NAMES.has(name);
    const plain = [];
    const flags = [];
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (!ls && CAT_FLAGS.test(a)) { if (!/^\d{1,6}$/.test(rest[i + 1] ?? '')) return null; flags.push(a, rest[i + 1]); i += 1; continue; }
      if (ls && LS_FLAGS.test(a)) { flags.push(a); continue; }
      if (isPlainArg(a)) { plain.push(a); continue; }
      return null;
    }
    if (!ls && !plain.length) return null; // "type" with nothing would read the pipeline, not a file
    if (!(await pathsOk(plain, pathOk))) return null;
    return [tokens[0], ...flags, ...plain].join(' ');
  }
  return null;
}
