// The guard's shell-command rules, read through the tokenizer (lib/shellparse.mjs) instead of
// regular expressions over the raw text. A rule judges WORDS: prose that merely mentions a flag,
// text inside quotes, and heredoc bodies are data and never match.
//
// Covers: C (skipping the commit hooks), A3 (pointing git at another hooks folder), A5 (setting the
// role from a command), the live-branch push target parse, and force pushes. The write-target rules
// (A2) and the record-folder rules (E) live in lib/shellwrites.mjs.
import { baseName, commandStarts, commandWord, isCmd, parseShell } from './shellparse.mjs';

const SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'];
const SHELL_FLAGS = new Set(['-c', '-lc', '-ic', '-cl', '-command', '-c:', '/c', '/k']);
const HOOK_SKIP_SUBS = new Set(['push', 'merge', 'am', 'rebase', 'cherry-pick', 'revert', 'pull']);
const ROLE_WORD = /^(\$env:|env:)?BOOTSTRAP_ROLE(\s*=|$)/i;

const NO_HOOKS = 'skipping git hooks is not allowed: the hooks are how the family\'s limits are enforced. Fix what the hook reports.';

/** "--no-verify" and every unique prefix git accepts ("--no-ve", "--no-verif"). */
export function isHookSkipLong(w) {
  return typeof w === 'string' && w.length >= 6 && w.startsWith('--no-v') && '--no-verify'.startsWith(w);
}

/**
 * Parse one git command: global options, then the subcommand and its arguments.
 * `words` start at the git word. Returns { sub, args, configs }, args as plain strings.
 */
export function gitCall(words) {
  const configs = [];
  let i = 1;
  let sub = null;
  const SEP_VALUE = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--attr-source']);
  while (i < words.length) {
    const w = words[i].text;
    if (w === '-c') { configs.push(words[i + 1]?.text ?? ''); i += 2; continue; }
    if (w === '--config-env') { configs.push(words[i + 1]?.text ?? ''); i += 2; continue; }
    if (w.startsWith('--config-env=')) { configs.push(w.slice('--config-env='.length)); i += 1; continue; }
    if (SEP_VALUE.has(w)) { i += 2; continue; }
    if (w.startsWith('-')) { i += 1; continue; }
    sub = w;
    break;
  }
  return { sub, args: words.slice(i + 1).map((x) => x.text), configs };
}

/** Does `git commit` get a hook-skip flag? Message and file values are skipped so a message can say anything. */
function commitSkipsHooks(args) {
  const LONG_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--template', '--cleanup', '--fixup', '--squash', '--pathspec-from-file', '--trailer']);
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === '--') break;
    if (a.startsWith('--')) {
      if (isHookSkipLong(a)) return true;
      if (LONG_VALUE.has(a)) k += 1;
      continue;
    }
    if (a.length > 1 && a[0] === '-') {
      for (let j = 1; j < a.length; j += 1) {
        const ch = a[j];
        if (ch === 'n') return true;
        if ('mFCct'.includes(ch)) { if (j === a.length - 1) k += 1; break; } // the rest of the word, or the next word, is a value
        if ('uS'.includes(ch)) break; // optional attached value
      }
    }
  }
  return false;
}

function pushForces(args) {
  const VALUE_OPTS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === '--') break;
    if (a === '--force' || a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes')) return true;
    if (VALUE_OPTS.has(a)) { k += 1; continue; }
    if (/^-[A-Za-z]+$/.test(a)) {
      if (a.includes('f')) return true;
      if (a.endsWith('o')) k += 1;
      continue;
    }
    if (!a.startsWith('-') && a.startsWith('+')) return true; // +refspec forces
  }
  return false;
}

/** Destination branch names of a parsed `git push`, as guard.pushTargets returned them. */
export function pushDestinations(args, currentBranch) {
  const VALUE_OPTS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
  const positional = [];
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (VALUE_OPTS.has(a)) { k += 1; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const refspecs = positional.slice(1);
  if (!refspecs.length) return currentBranch() ? [currentBranch()] : [];
  return refspecs.map((r0) => {
    const r = r0.replace(/^\+/, '');
    let dst = r.includes(':') ? r.split(':')[1] : r;
    if (dst === 'HEAD') dst = currentBranch() || dst;
    return dst.replace(/^refs\/heads\//, '');
  });
}

function refuseGit(call) {
  const { sub, args, configs } = call;
  for (const c of configs) {
    const key = String(c).split('=')[0].toLowerCase();
    if (key === 'core.hookspath') return 'pointing git at another hooks folder is not allowed (it would skip the pre-commit and pre-push checks).';
    if (key.startsWith('alias.') && /\b(commit|push)\b/i.test(String(c).slice(key.length))) return `a one-off git alias for commit or push can hide a hook skip; run the real command. ${NO_HOOKS}`;
  }
  if (sub === 'config' && args.some((a) => /core\.hookspath/i.test(a))) return 'changing the git hooks folder is not allowed (it would skip the pre-commit and pre-push checks).';
  if (sub === 'commit' && commitSkipsHooks(args)) return NO_HOOKS;
  if (HOOK_SKIP_SUBS.has(sub)) {
    const end = args.indexOf('--');
    if ((end < 0 ? args : args.slice(0, end)).some(isHookSkipLong)) return NO_HOOKS;
  }
  if (sub === 'push' && pushForces(args)) return 'force pushes are not allowed.';
  if (sub === 'reset' && args.includes('--hard')) return '"git reset --hard" is not allowed: it throws work away. Use a new commit or a branch.';
  return null;
}

/**
 * The rules above over every command in a parsed command line. Returns a reason string or null.
 * `ctx` = { role }. Recurses into `sh -c "..."` and friends.
 */
export function checkShell(parsed, ctx, depth = 0) {
  for (const cmd of parsed.commands) {
    // A5: the role is not set from a command line.
    if (cmd.words.some((w) => ROLE_WORD.test(w.text))) return 'the session role cannot be set from a command. The Chief of Staff assigns roles.';
    for (const start of commandStarts(cmd.words)) {
      const words = cmd.words.slice(start);
      if (!words.length) continue;
      const head = words[0].text;
      if (isCmd(head, 'git')) {
        const why = refuseGit(gitCall(words));
        if (why) return why;
      }
      if (words.some((w) => /(^|[\\/])bootstrap\.mjs$/.test(w.text)) && words.some((w) => w.text === 'role') &&
          ctx.role !== 'unassigned' && ctx.role !== 'chief-of-staff') {
        return `a session that already has a role ("${ctx.role}") does not change it. The Chief of Staff assigns roles.`;
      }
      if (depth < 4 && SHELLS.some((s) => isCmd(head, s))) {
        const at = words.findIndex((w, k) => k > 0 && SHELL_FLAGS.has(w.text.toLowerCase()));
        if (at > 0 && words[at + 1]) {
          const inner = words.slice(at + 1).map((w) => w.text).join(' ');
          const why = checkShell(parseShell(inner), ctx, depth + 1);
          if (why) return why;
        }
      }
    }
  }
  return null;
}

export { baseName, commandWord };
