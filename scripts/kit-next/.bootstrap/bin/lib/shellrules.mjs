// The guard's shell-command rules, read through the tokenizer (lib/shellparse.mjs) instead of
// regular expressions over the raw text. A rule judges WORDS: prose that merely mentions a flag,
// text inside quotes, and heredoc bodies are data and never match.
//
// Covers: C (skipping the commit hooks), A3 (pointing git at another hooks folder), A5 (setting the
// role from a command), the live-branch push target parse, and force pushes. The write-target rules
// (A2) and the record-folder rules (E) live in lib/shellwrites.mjs.
import { baseName, commandStarts, commandWord, isCmd, parseShell } from './shellparse.mjs';
import { resolve as pathResolve } from 'node:path';
import { ghNotAllowed, isLong, pushShape, refuseLabelMove, refusePush, refuseRemote, refuseSymbolicRef } from './shellextra.mjs';
import { ALIAS_DEPTH, GIT_BUILTINS, GIT_DIR_ENV, aliasValue, refuseGitConfigs } from './shellgit.mjs';

const SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'];
const EVALS = ['eval', 'invoke-expression', 'iex'];
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
  const dirs = [];
  const SEP_VALUE = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--attr-source']);
  while (i < words.length) {
    const w = words[i].text;
    if (w === '-c') { configs.push(words[i + 1]?.text ?? ''); i += 2; continue; }
    if (w.length > 2 && w.startsWith('-c') && w[2] !== '-') { configs.push(w.slice(2)); i += 1; continue; } // the attached form: -ckey=value
    if (w === '--config-env') { configs.push(words[i + 1]?.text ?? ''); i += 2; continue; }
    if (w.startsWith('--config-env=')) { configs.push(w.slice('--config-env='.length)); i += 1; continue; }
    if (w === '-C') dirs.push(words[i + 1]?.text ?? '');
    if (SEP_VALUE.has(w)) { i += 2; continue; }
    if (w.startsWith('-')) { i += 1; continue; }
    sub = w;
    break;
  }
  const argWords = words.slice(i + 1);
  return { sub, args: argWords.map((x) => x.text), argWords, configs, dirs, globals: words.slice(1, i).map((x) => x.text) };
}

/** Does `git commit` get a hook-skip flag? Message and file values are skipped so a message can say anything. */
function commitSkipsHooks(args, argWords = []) {
  const LONG_VALUE = new Set(['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--template', '--cleanup', '--fixup', '--squash', '--pathspec-from-file', '--trailer']);
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k];
    if (a === '--') break;
    // a bare variable where a flag could be ($X may hold the skip flag): refuse rather than guess
    if (argWords[k] && argWords[k].dynamic && !argWords[k].quoted && /^[$`]/.test(a)) return true;
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
  const { refspecs } = pushShape(args); // --repo=origin (or --repo origin) names the remote, so every word left is a refspec
  if (!refspecs.length) return currentBranch() ? [currentBranch()] : [];
  return refspecs.map((r0) => {
    const r = r0.replace(/^\+/, '');
    let dst = r.includes(':') ? r.split(':')[1] : r;
    if (dst === 'HEAD') dst = currentBranch() || dst;
    return dst.replace(/^refs\/heads\//, '');
  });
}

/** `git push` that carries many branches at once: --all, --mirror, or a wildcard refspec. */
function pushesEverything(args) {
  // git accepts any unique prefix of a long option ("--al", "--mir"), so every prefix of these counts.
  const BULK = ['--all', '--mirror', '--branches'];
  const isBulk = (a) => {
    const name = a.split('=')[0];
    return name.startsWith('--') && name.length >= 3 && BULK.some((o) => o.startsWith(name));
  };
  // a bare ":" refspec means "every branch that already exists on both sides"
  return args.some((a) => isBulk(a) || (!a.startsWith('-') && (a.includes('*') || a === ':' || a === '+:')));
}

function refuseGit(call, ctx = {}) {
  const { sub, args, argWords, configs } = call;
  for (const c of configs) {
    const key = String(c).split('=')[0].toLowerCase();
    if (key === 'core.hookspath') return 'pointing git at another hooks folder is not allowed (it would skip the pre-commit and pre-push checks).';
    if (key.startsWith('alias.') && /\b(commit|push)\b/i.test(String(c).slice(key.length))) return `a one-off git alias for commit or push can hide a hook skip; run the real command. ${NO_HOOKS}`;
  }
  if (sub === 'config' && args.some((a) => /core\.hookspath/i.test(a))) return 'changing the git hooks folder is not allowed (it would skip the pre-commit and pre-push checks).';
  if (sub === 'commit' && commitSkipsHooks(args, argWords)) return NO_HOOKS;
  if (HOOK_SKIP_SUBS.has(sub)) {
    const end = args.indexOf('--');
    if ((end < 0 ? args : args.slice(0, end)).some(isHookSkipLong)) return NO_HOOKS;
  }
  if (sub === 'push' && pushForces(args)) return 'force pushes are not allowed.';
  if (sub === 'push' && !(ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role)
    && argWords.some((w, k) => k > 0 && w.dynamic && !w.text.startsWith('-') && /[$`]/.test(w.text))) {
    return 'a git push whose target is a variable or a command substitution cannot be checked against the live branch; name the branch you mean.';
  }
  const mayPushLive = (ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role);
  if (sub === 'push' && !mayPushLive && configs.some((c) => /^(remote\..*\.(push|mirror)|push\.default)(=|$)/i.test(String(c)))) {
    return 'overriding where a push goes (remote.*.push, remote.*.mirror, push.default) from the command line could move the live branch; name the branch you mean.';
  }
  if (sub === 'push' && pushesEverything(args) && !mayPushLive) {
    return 'pushing every branch at once (--all, --mirror, a wildcard refspec) could move the live branch; name the branch you mean.';
  }
  if (sub === 'reset' && args.includes('--hard')) return '"git reset --hard" is not allowed: it throws work away. Use a new commit or a branch.';
  return null;
}

// ---- G1-1: gh writes. A GitHub Release is what every installed copy auto-updates to, so publishing and merging with gh
// are for the live pushers only, and deleting or editing a release is the owner's alone.
const GH_OWNER_ONLY = [['release', 'delete'], ['release', 'edit'], ['release', 'delete-asset']];
// a bare variable standing for a whole word: its value cannot be read
const BARE_VARIABLE = /^(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\(.*\)|`.*`)$/;
const GH_READ_RELEASE = new Set(['view', 'list', 'download']);
const GH_REFUSED_FOR_NON_LIVE = [
  ['pr', 'merge'], ['pr', 'close'], ['pr', 'ready'],
  ['secret', '*'], ['variable', '*'], ['ruleset', '*'],
  ['workflow', 'run'], ['workflow', 'enable'], ['workflow', 'disable'],
  ['label', 'delete'], ['alias', '*'], ['extension', 'install'], ['extension', 'exec'], ['auth', 'token'],
];
const GH_REPO_WRITES = new Set(['edit', 'delete', 'rename', 'archive', 'sync', 'deploy-key']);
const GH_BODY_FLAGS = /^(-f|-F|--field|--raw-field|--input)(=|$)|^-[fF]./;
const GH_FLAGS_WITH_VALUE = new Set(['-R', '--repo', '-H', '--hostname']);

/** gh's group and subcommand, skipping its global flags ("gh -R o/r release create"). */
function ghCall(words) {
  const rest = [];
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i].text;
    if (GH_FLAGS_WITH_VALUE.has(w)) { i += 1; continue; }
    if (w.startsWith('-')) continue;
    rest.push(i);
    if (rest.length === 2) break;
  }
  return { group: words[rest[0]]?.text ?? null, sub: words[rest[1]]?.text ?? null, at: rest };
}

/** The HTTP method gh api will use: -X/--method, else POST when a body flag is present, else GET. null = cannot tell. */
function ghApiMethod(words) {
  let method = null;
  let body = false;
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i];
    const t = w.text;
    if (t === '-X' || t === '--method') {
      const v = words[i + 1];
      if (!v || v.dynamic) return null;
      method = v.text.toUpperCase();
      i += 1;
    } else if (/^-X./.test(t)) method = t.slice(2).toUpperCase();
    else if (t.startsWith('--method=')) method = t.slice('--method='.length).toUpperCase();
    else if (GH_BODY_FLAGS.test(t)) body = true;
    else if (w.dynamic && BARE_VARIABLE.test(t)) return null; // quoted or not: its value cannot be read
  }
  return method ?? (body ? 'POST' : 'GET');
}

function refuseGh(words, ctx) {
  const { group, sub, at } = ghCall(words);
  const live = (ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role);
  const ownerOnly = 'changes or removes a published release that every installed copy updates from: only the owner runs it.';
  // Tech Lead 51562ee: gh auth status prints the sign-in token with --show-token (-t): refused for every role, live pushers too
  if (group === 'auth' && words.some((w) => /^--show-token(=|$)/.test(w.text) || /^-[A-Za-z]*t[A-Za-z]*$/.test(w.text))) return '"gh auth" with --show-token (-t) prints the sign-in token: it is refused for every role.';
  if (GH_OWNER_ONLY.some(([g, s]) => g === group && s === sub)) return `"gh ${group} ${sub}" ${ownerOnly}`;
  if (group === 'release' && sub === 'upload' && words.some((w) => /^--clobber(=|$)/.test(w.text))) return `"gh release upload --clobber" replaces a published file: it ${ownerOnly}`;
  if (group === 'api') {
    // the same edits through the API: a write to a release or a tag ref, for every role
    const method = ghApiMethod(words);
    if (method !== 'GET' && method !== 'HEAD' && words.some((w) => /\/releases(\/|$)|git\/refs\/tags|\/git\/tags/.test(w.text))) return `a gh api write to a release or tag ${ownerOnly}`;
  }
  if (live) return null;
  const positional = group === 'api' ? at.slice(0, 1) : at;
  if (positional.some((k) => words[k].dynamic && !words[k].quoted && BARE_VARIABLE.test(words[k].text))) return 'a gh command whose group or subcommand is a variable cannot be read: spell it out.'; // release-ops, hotfix and the Chief of Staff: their own limits are the pre-push scope check
  const offer = 'Ask release-ops (npm run release) or the Chief of Staff.';
  if (group !== 'api') return ghNotAllowed(words, group, sub, ctx); // W5S-2: reads, pr comment, pr create on claude/*; everything else is refused
  if (group === 'api') {
    const method = ghApiMethod(words);
    if (method === null) return 'gh api with a method the guard cannot read (a variable) is refused: spell the method out.';
    if (method !== 'GET' && method !== 'HEAD') return `gh api ${method} writes to GitHub (a release, a ref, a branch). ${offer}`;
    if (words.some((w) => /mutation/i.test(w.text))) return `a GraphQL mutation writes to GitHub. ${offer}`;
  }
  return null;
}

/**
 * G1-3, for roles that may not push live: git configuration and alias writes, a git directory or work tree pointed
 * somewhere else, and subcommands that are not git's own (an alias is expanded and its command judged; an unknown word is refused).
 */
function refuseGitMore(call, cmd, ctx, depth) {
  if ((ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role)) return null;
  const why = refuseGitConfigs(call);
  if (why) return why;
  const { sub } = call;
  const where0 = (c, cx) => { let w = cx.cwd ?? process.cwd(); for (const d of c.dirs ?? []) w = pathResolve(w, d); return w; };
  if (sub === 'checkout-index' && call.args.some((a) => isLong(a, '--prefix', 3) || isLong(a, '--all', 3) || isLong(a, '--stdin', 4) || /^-[A-Za-z]*a/.test(a))) return '"git checkout-index" with --prefix, --all or --stdin writes files the guard cannot see; name the files.';
  if (sub === 'push') { const why3 = refusePush(call.args, where0(call, ctx)); if (why3) return why3; }
  // K-1 (Security B6): `git hook run` runs a hook by hand, outside the commit
  if (sub === 'hook') return '"git hook" runs hooks outside the commit; not allowed for this role.';
  // K-1 (Security B3): a fetch or pull whose refspec writes the live branch label (git fetch origin +main:main)
  if ((sub === 'fetch' || sub === 'pull') && ctx.liveBranch) {
    const live = String(ctx.liveBranch).toLowerCase();
    if (call.args.some((x) => /^--refmap(=|$)/.test(x))) return '"git fetch --refmap" can write the live branch label; not allowed for this role.';
    for (const a of call.args.filter((x) => !x.startsWith('-'))) {
      const dest = a.replace(/^\+/, '').split(':')[1];
      if (dest !== undefined && (dest.includes('*') || dest.replace(/^refs\/heads\//i, '').toLowerCase() === live)) return `fetching into "${ctx.liveBranch}" moves the live branch label; not allowed for this role.`;
    }
  }
  if (sub === 'remote') { const why4 = refuseRemote(call.args); if (why4) return why4; }
  if (sub === 'symbolic-ref') { const why6 = refuseSymbolicRef(call.args); if (why6) return why6; }
  if (sub === 'branch' || sub === 'checkout' || sub === 'switch' || sub === 'worktree') { const why5 = refuseLabelMove(sub, call.args, ctx.liveBranch); if (why5) return why5; }
  if (!sub || GIT_BUILTINS.has(sub)) return null;
  // the alias is looked up where git will run: every -C moves the folder, in order
  let where = ctx.cwd ?? process.cwd();
  for (const d of call.dirs ?? []) where = pathResolve(where, d);
  const value = aliasValue(sub, { ...ctx, cwd: where });
  if (value === null) return `"git ${sub}" is not a git command the guard knows (not a built-in, not an alias here): an unknown subcommand can run any program.`;
  if (depth >= ALIAS_DEPTH) return `the git alias "${sub}" is nested too deep to read.`;
  const expanded = value.startsWith('!') ? value.slice(1) : `git ${value}`;
  const why2 = checkShell(parseShell(expanded), ctx, depth + 1);
  if (why2) return `the git alias "${sub}" (${value.slice(0, 40)}) is refused: ${why2}`;
  if (value.startsWith('!')) return `the git alias "${sub}" runs a shell command; the guard only allows aliases of git commands.`;
  return null;
}

const NPX = new Set(['npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'npm', 'xargs', 'timeout', 'watch', 'setsid', 'start', 'start-process', 'invoke-command', 'call', 'runas']);

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A variable cannot be checked, so it is refused too: ids here are always spelled out.
const okId = (w) => !w.dynamic && ID.test(w.text) && !w.text.includes('..');

/**
 * E: the bootstrap command's own words (its argv), never "the rest of the line".
 *  role     only a session with no role yet, or the Chief of Staff, assigns one (A5)
 *  signoff  piece and role ids must be plain names (no path); a role signs only for itself, the Chief of Staff for anyone
 *  require  piece and role ids must be plain names
 */
function checkBootstrapCli(args, ctx) {
  const sub = args[0]?.text;
  if (sub === 'role' && ctx.role !== 'unassigned' && ctx.role !== 'chief-of-staff') {
    return `a session that already has a role ("${ctx.role}") does not change it. The Chief of Staff assigns roles.`;
  }
  if (sub === 'signoff') {
    const piece = args[1];
    if (piece && !piece.text.startsWith('-') && !okId(piece)) return 'a sign-off piece id must be a plain name (letters, digits, dot, dash), never a path.';
    const at = args.findIndex((w) => w.text === '--role');
    const role = at >= 0 ? args[at + 1] : null;
    if (role) {
      if (!okId(role)) return 'a sign-off role id must be a plain name, never a path.';
      if (role.text !== ctx.role) { // kit 0.6.0: nobody signs for another role, the Chief of Staff included
        return `a sign-off is signed by its own role: you are "${ctx.role}", not "${role.text}". Ask that role to sign.`;
      }
    }
  }
  // K-1 (kit 0.6.0): who may run the record commands, refused here before the command runs (the command checks again itself)
  const second = args[1]?.text;
  const only = (who, what) => (who.includes(ctx.role) ? null : `\`bootstrap ${what}\` is for ${who.join(' / ')} only (you are "${ctx.role}").`);
  if (sub === 'upgrade') { const w = only(['chief-of-staff'], 'upgrade'); if (w) return w; }
  if (sub === 'kit' && second === 'apply') { const w = only(['chief-of-staff'], 'kit apply'); if (w) return w; }
  if (sub === 'flow' && second === 'apply') { const w = only(['chief-of-staff'], 'flow apply'); if (w) return w; }
  if (sub === 'approve') { const w = only(['chief-of-staff'], 'approve'); if (w) return w; }
  if (sub === 'piece' && !args.some((x) => x.text === '--suggest')) { const w = only(['chief-of-staff'], 'piece'); if (w) return w; }
  if (sub === 'release') { const w = only(['chief-of-staff', 'release-ops', 'hotfix'], 'release'); if (w) return w; }
  if ((sub === 'approve' || sub === 'piece') && args[1] && !args[1].text.startsWith('-') && !okId(args[1])) return 'a piece id must be a plain name (letters, digits, dot, dash), never a path.';
  if (sub === 'require' && ctx.role !== 'chief-of-staff' && ctx.role !== 'security') {
    return `only the Chief of Staff or Security sets which roles must sign a piece (you are "${ctx.role}").`;
  }
  if (sub === 'require' && args.slice(1).some((w) => !w.text.startsWith('-') && !okId(w))) {
    return 'sign-off piece and role ids must be plain names, never paths.';
  }
  return null;
}

/** The command line inside `sh -c "..."`, `eval ...` and friends, parsed; or null when `words` is not one of those. */
export function innerParsed(words) {
  const head = words[0]?.text ?? '';
  if (EVALS.some((e) => isCmd(head, e)) && words.length > 1) return parseShell(words.slice(1).map((w) => w.text).join(' '));
  if (SHELLS.some((s) => isCmd(head, s))) {
    const at = words.findIndex((w, k) => k > 0 && SHELL_FLAGS.has(w.text.toLowerCase()));
    if (at > 0 && words[at + 1]) return parseShell(words.slice(at + 1).map((w) => w.text).join(' '));
  }
  return null;
}

/**
 * The rules above over every command in a parsed command line. Returns a reason string or null.
 * `ctx` = { role }. Recurses into `sh -c "..."` and friends.
 */
export function checkShell(parsed, ctx, depth = 0) {
  for (const cmd of parsed.commands) {
    // G1-5: the name of an environment variable is never a variable ($R=BOOTSTRAP_ROLE, env $N=x): the role cannot be hidden that way.
    if (ctx.role !== 'chief-of-staff' && cmd.words.some((w) => (/^[^=]*[$`][^=]*=/.test(w.text) && !w.text.startsWith('-')) || /^\$\{?env:[^=]*[$`]/i.test(w.text))) {
      return 'the name of an environment variable cannot be a variable: the guard cannot see what it sets.';
    }
    // A5: the role is not set from a command line.
    if (cmd.words.some((w) => ROLE_WORD.test(w.text))) return 'the session role cannot be set from a command. The Chief of Staff assigns roles.';
    // K-1 (Security B4): and not through the Windows environment either ([Environment]::SetEnvironmentVariable, setx, Set-Item env:)
    if (cmd.words.some((w) => /BOOTSTRAP_ROLE/i.test(w.text)) && cmd.words.some((w) => /SetEnvironmentVariable|^setx(\.exe)?$|^set-item$|^si$|^new-itemproperty$/i.test(w.text))) return 'the session role cannot be set from a command. The Chief of Staff assigns roles.';
    if (!(ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role) && cmd.words.some((w) => GIT_DIR_ENV.test(w.text))) {
      return 'setting GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE or GIT_COMMON_DIR points git at other files than the ones the hooks watch.';
    }
    for (const start of commandStarts(cmd.words)) {
      const words = cmd.words.slice(start);
      if (!words.length) continue;
      const head = words[0].text;
      const external = /^git-(.+)$/.exec(baseName(head));
      if (external && !GIT_BUILTINS.has(external[1]) && !(ctx.livePushers ?? ['release-ops', 'hotfix']).includes(ctx.role)) {
        return `"${baseName(head)}" is an external git program, not one of git's own commands: it can run anything.`;
      }
      if (isCmd(head, 'git')) {
        const call = gitCall(words);
        const why = refuseGit(call, ctx) ?? refuseGitMore(call, cmd, ctx, depth);
        if (why) return why;
      }
      if (isCmd(head, 'gh')) {
        const why = refuseGh(words, ctx);
        if (why) return why;
      } else if (NPX.has(baseName(head))) {
        const at = words.findIndex((w, k) => k > 0 && isCmd(w.text, 'gh'));
        if (at > 0) { const why = refuseGh(words.slice(at), ctx); if (why) return why; }
      }
      const bi = words.findIndex((w) => /(^|[\\/])bootstrap\.mjs$/.test(w.text));
      if (bi >= 0) {
        const why = checkBootstrapCli(words.slice(bi + 1), ctx);
        if (why) return why;
      }
      if (depth < 4 && EVALS.some((e) => isCmd(head, e)) && words.length > 1) {
        const why = checkShell(parseShell(words.slice(1).map((w) => w.text).join(' ')), ctx, depth + 1);
        if (why) return why;
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
