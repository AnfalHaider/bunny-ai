// A2 and E: which files does a shell command write, and may this role write them?
//
// A SEATBELT, NOT A WALL. It reads the targets of the common write shapes through the tokenizer:
//   redirections (> >> 2> &> >|), tee, sed -i, cp / mv / rm / touch / mkdir / ln / dd of=,
//   git checkout|restore|rm|mv paths, PowerShell Set-Content / Add-Content / Out-File / Remove-Item /
//   Copy-Item / Move-Item / New-Item / Rename-Item, and cmd's del / copy / move / ren.
// `node -e`, `python -c`, a generated script or `npm run <x>` pass it. The authoritative check is
// A1 (the pre-commit and pre-push scope check), which sees what actually changed.
//
// Targets it cannot resolve ($VAR, globs, ~) are never blocked, unless their text names a protected
// path or a record folder outright. Behind policy.shell_write_check (default on).
import path from 'node:path';
import { baseName, commandStarts, isCmd } from './shellparse.mjs';
import { isRefusedPath, isRoleFile, recordViolation, scopeViolation, toRepoPath } from './policy.mjs';
import { gitCall, innerParsed } from './shellrules.mjs';

const NULLISH = new Set(['/dev/null', 'nul', 'con', '/dev/stdout', '/dev/stderr', '/dev/stdin', '-']);
const PROTECTED_MARKERS = ['bootstrap-role', '.bootstrap', '.githooks', '.git/hooks', '.git/config', 'agents.md', 'claude.md', '.claude/settings.json'];
const RECORD_MARKERS = ['docs/signoffs', 'docs/releases'];

const PS_PATH = new Set(['path', 'literalpath', 'filepath', 'destination', 'pspath']);
const PS_SWITCH = new Set(['force', 'recurse', 'nonewline', 'append', 'whatif', 'confirm', 'passthru', 'noclobber', 'usetransaction', 'wait', 'asbytestream', 'raw']);
const PS_PATH_FIRST = new Set(['set-content', 'add-content', 'out-file', 'clear-content', 'remove-item', 'new-item', 'rename-item', 'sc', 'ac', 'ni', 'ri', 'rni']);
const PS_COPY = new Set(['copy-item', 'cpi']);
const PS_MOVE = new Set(['move-item', 'mi']);

const ALL_POS = new Set(['rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'truncate', 'shred', 'del', 'erase', 'rd', 'md', 'mv', 'move', 'ren', 'rename', 'tee']);
const LAST_POS = new Set(['cp', 'install', 'ln', 'copy', 'xcopy']);
const VALUE_OPTS = { touch: new Set(['-d', '-t', '-r']), mkdir: new Set(['-m']), truncate: new Set(['-s', '-r']), cp: new Set(['-t']), install: new Set(['-t', '-m', '-o', '-g']), mv: new Set(['-t']) };

/** Split `args` into positional words and options; `valueOpts` take the next word as their value. */
function split(args, valueOpts = new Set(), slashFlags = false) {
  const pos = [];
  const opts = [];
  let end = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i].text;
    if (!end && t === '--') { end = true; continue; }
    if (!end && ((t.startsWith('-') && t.length > 1) || (slashFlags && /^\/[A-Za-z?]$/.test(t)))) {
      opts.push(args[i]);
      if (valueOpts.has(t)) i += 1;
      continue;
    }
    pos.push(args[i]);
  }
  return { pos, opts };
}

function psTargets(name, args) {
  const named = [];
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i].text;
    if (t.startsWith('-') && t.length > 1) {
      const [raw, inline] = t.slice(1).split(/:(.*)/s);
      const p = raw.toLowerCase();
      if (PS_PATH.has(p)) { const v = inline ?? args[i + 1]?.text; if (inline === undefined) i += 1; if (v !== undefined) named.push({ p, word: inline !== undefined ? { text: inline, quoted: args[i].quoted, dynamic: args[i].dynamic } : args[i] }); } else if (!PS_SWITCH.has(p) && inline === undefined) i += 1; // a value we do not need
      continue;
    }
    positional.push(args[i]);
  }
  const out = named.map((n) => n.word);
  const hasPath = named.some((n) => n.p !== 'destination');
  const hasDest = named.some((n) => n.p === 'destination');
  if (PS_PATH_FIRST.has(name)) { if (!hasPath && positional[0]) out.push(positional[0]); } else if (PS_COPY.has(name)) { if (!hasDest) { const d = positional[hasPath ? 0 : 1]; if (d) out.push(d); } } else if (PS_MOVE.has(name)) {
    if (!hasPath && positional[0]) out.push(positional[0]);
    if (!hasDest) { const d = positional[hasPath ? 0 : 1]; if (d) out.push(d); }
  }
  return out;
}

/** The words a command writes (or deletes), by the shapes listed at the top. */
export function targetsOf(words) {
  const head = words[0].text;
  const names = [baseName(head), baseName(head.replace(/\\/g, ''))];
  const is = (...list) => names.find((n) => list.includes(n));
  const args = words.slice(1);

  if (is('git')) {
    const call = gitCall(words);
    const rest = words.slice(words.length - call.args.length);
    if (call.sub === 'checkout') { const at = call.args.indexOf('--'); return at < 0 ? [] : rest.slice(at + 1); }
    if (call.sub === 'restore') return split(rest, new Set(['--source', '-s'])).pos;
    if (call.sub === 'rm' || call.sub === 'mv' || call.sub === 'checkout-index') return split(rest).pos;
    return [];
  }
  const ps = is(...PS_PATH_FIRST, ...PS_COPY, ...PS_MOVE);
  if (ps && !is('rm', 'del', 'erase', 'copy', 'move', 'ren', 'rename', 'rd', 'md', 'mkdir', 'rmdir', 'touch')) return psTargets(ps, args);

  const all = is(...ALL_POS);
  if (all) return split(args, VALUE_OPTS[all] ?? new Set(), true).pos;
  const last = is(...LAST_POS);
  if (last) {
    const { pos, opts } = split(args, VALUE_OPTS[last] ?? new Set(), true);
    const t = opts.findIndex((o) => o.text === '-t');
    if (t >= 0) { const at = args.findIndex((a) => a.text === '-t'); return args[at + 1] ? [args[at + 1]] : []; }
    return pos.length > 1 ? [pos[pos.length - 1]] : [];
  }
  if (is('dd')) return args.filter((a) => a.text.startsWith('of=')).map((a) => ({ ...a, text: a.text.slice(3) }));
  if (is('sed')) {
    const inPlace = args.some((a) => /^-[A-Za-z]*i/.test(a.text) || a.text.startsWith('--in-place'));
    if (!inPlace) return [];
    const { pos, opts } = split(args, new Set(['-e', '-f', '--expression', '--file']));
    const hasScript = opts.some((o) => ['-e', '-f', '--expression', '--file'].includes(o.text) || /^--(expression|file)=/.test(o.text));
    return hasScript ? pos : pos.slice(1);
  }
  return [];
}

function protectedMarker(text) {
  const low = text.toLowerCase().replace(/\\/g, '/');
  if (PROTECTED_MARKERS.some((m) => low.includes(m))) return 'protected';
  if (RECORD_MARKERS.some((m) => low.includes(m))) return 'record';
  return null;
}

function judge(word, ctx, cwd) {
  const text = word.text;
  if (!text || NULLISH.has(text.toLowerCase())) return null;
  const abs = path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text);
  if (word.dynamic || (cwd === null && !abs)) {
    // Cannot be resolved. Only a literal mention of a protected path or a record folder is blocked.
    const kind = protectedMarker(text);
    if (kind === 'protected' && ctx.role !== 'chief-of-staff') return `${text} names protected toolkit config (the path has a variable in it, but the protected part is spelled out). Only the Chief of Staff changes it.`;
    if (kind === 'record' && !(ctx.policy.records?.writers || []).includes(ctx.role)) return `${text} names a sign-off or release record folder. Write there with the bootstrap command, not a shell write.`;
    return null;
  }
  if (ctx.role !== 'chief-of-staff' && isRoleFile(text, cwd ?? ctx.cwd)) return `${text} is the worktree's role file; the role is assigned by the Chief of Staff (bootstrap role).`;
  const rel = toRepoPath(ctx.root, text, cwd ?? ctx.cwd);
  if (isRefusedPath(rel)) return `${text}: that path could not be read safely (${rel.refused}).`;
  if (rel === null) return null;
  return scopeViolation(rel, ctx.policy, ctx.brief, ctx.role) ?? recordViolation(rel, ctx.policy, ctx.role);
}

/**
 * Check every write target in a parsed command line. ctx = { root, cwd, policy, brief, role }.
 * Returns a reason string, or null. Tracks `cd` between commands so "cd docs && echo x > a.js" is read right.
 */
export function checkWrites(parsed, ctx, depth = 0) {
  let cwd = ctx.cwd;
  for (const cmd of parsed.commands) {
    const candidates = [];
    for (const r of cmd.redirs) {
      if (!r.target) continue;
      const writes = ['>', '>>', '>|', '&>', '&>>'].includes(r.op) || (r.op === '>&' && !/^(\d+|-)$/.test(r.target.text));
      if (writes) candidates.push(r.target);
    }
    if (cmd.words.length) {
      for (const start of commandStarts(cmd.words)) {
        const words = cmd.words.slice(start);
        if (!words.length) continue;
        if (!cmd.nested && ['cd', 'pushd', 'set-location', 'sl', 'chdir'].some((n) => isCmd(words[0].text, n))) {
          const dest = words.slice(1).find((w) => !w.text.startsWith('-'));
          if (!dest || dest.dynamic || cwd === null) cwd = dest ? null : cwd;
          else cwd = path.resolve(cwd, dest.text);
          continue;
        }
        candidates.push(...targetsOf(words));
        const inner = depth < 4 ? innerParsed(words) : null;
        if (inner) {
          const why = checkWrites(inner, { ...ctx, cwd: cwd ?? ctx.cwd }, depth + 1);
          if (why) return why;
        }
      }
    }
    for (const w of candidates) {
      const why = judge(w, ctx, cwd);
      if (why) return why;
    }
  }
  return null;
}
