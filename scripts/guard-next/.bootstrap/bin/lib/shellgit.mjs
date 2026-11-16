// G1-3: git configuration, aliases and subcommands that are not git's own, for roles that may not push live.
// Read through the tokenizer's words (lib/shellparse.mjs); used by lib/shellrules.mjs.
import { execFileSync } from 'node:child_process';

/** git's own subcommands (from `git help -a`, plus the ones Git for Windows ships). Anything else is an alias or an external program. */
export const GIT_BUILTINS = new Set(`add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-ref-format checkout cherry cherry-pick
  citool clean clone column commit commit-graph commit-tree config count-objects credential describe diff diff-files diff-index diff-tree difftool
  fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref for-each-repo format-patch fsck gc get-tar-commit-id gitk gui
  grep hash-object help hook index-pack init interpret-trailers lfs log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base
  merge-file merge-index merge-tree mergetool mktag mktree multi-pack-index mv name-rev notes pack-objects pack-redundant pack-refs patch-id
  prune prune-packed pull push range-diff read-tree rebase reflog remote repack replace request-pull rerere reset restore rev-list rev-parse
  revert rm scalar send-email shortlog show show-branch show-index show-ref sparse-checkout stage stash status stripspace submodule switch symbolic-ref
  tag unpack-file unpack-objects update-index update-ref update-server-info var verify-commit verify-pack verify-tag version whatchanged worktree write-tree`.split(/\s+/));

export const ALIAS_DEPTH = 3;
const ALIAS_BAD_VALUE = /(^!)|\b(commit|push|merge|rebase|am|cherry-pick)\b/i;
const CONFIG_HARD_KEYS = /^(include\.path|includeif\..*\.path|core\.(hookspath|fsmonitor|sshcommand|editor|pager|askpass|attributesfile)|credential\..*helper|credential\.helper|url\..*\.(insteadof|pushinsteadof)|remote\..*\.(push|mirror|url|pushurl)|push\.(default|followtags)|branch\..*\.(pushremote|remote))$/;
const CONFIG_READ_FLAGS = /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|--show-origin|--show-scope|--name-only|--get-color|--get-colorbool)$/;
const CONFIG_WRITE_FLAGS = /^(--add|--replace-all|--unset|--unset-all|--rename-section|--remove-section|-e|--edit)$/;
const CONFIG_SCOPE_FLAGS = /^(--global|--system|--file|-f|--includes|--blob)(=|$)/;
const CONFIG_VALUE_FLAGS = new Set(['--file', '-f', '--blob', '--type', '--default', '--comment', '--value']);
// git 2.46 subcommand forms: "git config set key value"
const CONFIG_FORMS = new Set(['set', 'unset', 'get', 'list', 'edit', 'rename-section', 'remove-section']);
export const GIT_DIR_ENV = /^(\$env:|env:)?(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_CONFIG|GIT_EXEC_PATH|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_SSH_COMMAND|GIT_SSH|GIT_ASKPASS)(\s*=|$)/i;

/** Is this key/value one a role may not set (from "git config" or "git -c")? Returns a reason or null. */
export function configRefusal(key, value = '') {
  const k = String(key).toLowerCase();
  if (k.startsWith('alias.')) {
    return ALIAS_BAD_VALUE.test(String(value)) ? 'an alias that runs commit, push, merge, rebase or a shell command can hide a hook skip or a push to the live branch.' : null;
  }
  if (CONFIG_HARD_KEYS.test(k)) return `changing git's "${key}" could skip the hooks or move where a push goes.`;
  return null;
}

/** Parsed "git config ...": is it a write, in which scope, with which key and value. */
export function configCall(args) {
  const flags = [];
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('-')) { flags.push(a); if (CONFIG_VALUE_FLAGS.has(a)) i += 1; } else pos.push(a);
  }
  let form = null;
  if (CONFIG_FORMS.has(pos[0]) && (pos.length >= 2 || pos[0] === 'list' || pos[0] === 'edit')) form = pos.shift(); // "set", "unset"...: the key is the next word
  const reads = flags.some((f) => CONFIG_READ_FLAGS.test(f)) || form === 'get' || form === 'list';
  const write = flags.some((f) => CONFIG_WRITE_FLAGS.test(f)) || ['set', 'unset', 'edit', 'rename-section', 'remove-section'].includes(form) || (!reads && pos.length >= 2);
  return { form, flags, key: pos[0] ?? '', value: pos[1] ?? '', write, scoped: flags.some((f) => CONFIG_SCOPE_FLAGS.test(f)) };
}

/**
 * The refusals of item 2 on one parsed git call. `call` is shellrules' gitCall result (with `globals`, the words before the subcommand).
 * Returns a reason or null. Live pushers are not asked.
 */
export function refuseGitConfigs(call) {
  const { sub, args, configs, globals = [] } = call;
  for (const c of configs) {
    const eq = String(c).indexOf('=');
    const why = configRefusal(eq < 0 ? c : c.slice(0, eq), eq < 0 ? '' : c.slice(eq + 1));
    if (why) return `"-c ${String(c).slice(0, 40)}": ${why}`;
  }
  if (globals.some((w) => /^--(git-dir|work-tree)(=|$)/.test(w))) return 'pointing git at another git directory or work tree (--git-dir, --work-tree) is not allowed.';
  if (sub === 'config') {
    const c = configCall(args);
    if (c.write) {
      if (c.form === 'edit' || c.flags.some((f) => /^(-e|--edit|--rename-section|--remove-section)$/.test(f)) || c.form === 'rename-section' || c.form === 'remove-section') return 'editing or renaming git configuration sections is not allowed: the guard cannot see what it changes. Set one key at a time.';
      if (c.scoped) return 'writing git configuration to the global or system scope, or to another file, is not allowed; set it in this repository only.';
      const why = configRefusal(c.key, c.value);
      if (why) return `"git config ${c.key}": ${why}`;
    }
  }
  if (sub === 'commit-tree') return '"git commit-tree" builds commits outside the hooks; use git commit.';
  if (sub === 'update-ref' && args.some((a) => /^refs\/(heads|tags)\//.test(a))) return '"git update-ref" on a branch or tag moves it outside the hooks; use git commit, merge or push.';
  return null;
}

/** An alias's expansion (a git command line without the word "git"), or null when `word` is not an alias in that folder. */
export function aliasValue(word, ctx = {}) {
  if (typeof ctx.aliasOf === 'function') return ctx.aliasOf(word) ?? null;
  try {
    const out = execFileSync('git', ['config', '--get', `alias.${word}`], { cwd: ctx.cwd ?? process.cwd(), encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch { return null; }
}
