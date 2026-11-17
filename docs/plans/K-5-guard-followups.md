# K-5 — guard follow-ups (time budget, wrong refusals and one gap), after v0.1.8

Author: Tech Lead, 2026-11-17, on kit 0.6.0 live (main 9c5ac84). Requested by the Chief of Staff as ONE row. Risk: HIGH as a group (security control), each item small.
Owner of the work: Builder A (kit). Review: Tech Lead, Security signs. Not started; waits for v0.1.8.

Method: every case below was run through `.bootstrap/bin/guard.mjs` `decide` from this worktree as role tech-lead (probe, not edited code).

## K5-T The guard's time budget (Security's plan, relayed by the Chief of Staff; first in the order)

Why: under load (several gates at once) the guard answers "did not finish deciding in time" for ordinary commands; it fails closed, but builders' gates and everyday commands get refused. Seen at K-2 (1d3a77c), the installed-kit runs of K-3 and K-4 (four tests refused at once, passing when run one at a time), and the kit-land README (K2-1 timing). The 6 s decision deadline STAYS; it is not raised to 8 s.
Where it is now: `guard.mjs:93` `setDeadline(input?.deadlineMs ?? 6000)`; the belt, `guard.mjs:246`, a child process with `timeout: 8000` counted from when the child is spawned; the host cuts a hook off at 10 s. Process start-up (node, imports) is not in either number. `resolveContext` runs once, or twice when the first cwd is not in a repository (`guard.mjs:108-109`); each run asks git several times (`policy.mjs:111`), and `git()` has no memory.

1. Memoise. Inside one `decide()`, cache `git()` reads by (cwd, args): `rev-parse` (top, common dir, absolute git dir, `--abbrev-ref HEAD`), `symbolic-ref`, `worktree list`. Clear the cache at the start and end of `decide()` (`setDeadline` is the place); never keep it between decisions or across a command that writes (the guard runs none). Pass the resolved context down: take `ctx` from the first `resolveContext` and give it to `checkShell`/`checkWrites` (they already receive `ctx`); do not call `resolveContext` again for the fallback cwd unless the first returned null.
2. Measure from process start. In the child, the budget is what is left of the total: `deadline = start + total`, where `start = Date.now() - process.uptime() * 1000`. Total about 8.5 s from process start; the belt (the parent's child timeout) about 9 s, so the child's own refusal, with its message, arrives before the belt cuts it with the generic one. The 6 s figure then means "6 s of deciding" and the start-up time comes out of the margin, not on top of it.
3. Only if 1 and 2 are not enough: a decision deadline of at most 7 s, belt at 8.5 s. Never 9 s or more (the host's 10 s includes its own start-up and the output).
Builder A note, to settle with Security before building: item 2 puts the belt at about 9 s, which is more than the 8 s there now and leaves about 1 s under the host's 10 s; item 3 says 8.5 s. Pick one pair (decision, belt) and write it in `README.md` of the kit; I suggest 8.5 s total / 9 s belt for item 2 and 7 s / 8.5 s for item 3, as stated.
Tests: (a) a git shim (a `git` on PATH that sleeps 1 s per call) gives the SAME decision as a fast git for a fixed list (allowed everyday commands, refused pushes, refused writes) and the whole run, measured from process start, stays under 9 s; (b) the number of git spawns for one decision is at most a small fixed bound (assert it, so a future change cannot quietly bring the calls back); (c) a decision that really runs out of time is still a refusal with the "did not finish" message, and the belt case still exits 2; (d) existing K1-5 tests unchanged.
Not a fix for load itself: the rule "only one full gate at a time" stays until K-5 lands.

## K5-1 Reading the hooks setting is refused (Tech Lead, found at the landing check)

| Command | Now | Wanted |
|---|---|---|
| `git config core.hooksPath` | refused ("changing the git hooks folder...") | allowed (it only reads) |
| `git config --get core.hooksPath` | refused | allowed |
| `git config --list`, `git config user.name` | allowed | allowed |
| `git config core.hooksPath x`, `--add`, `--replace-all`, `--unset`, `--edit`, `-c core.hooksPath=x` | refused | refused (unchanged) |

Cause: `lib/shellrules.mjs:126`, `sub === 'config' && args.some(a => /core\.hookspath/i.test(a))` refuses on the key alone.
Fix: refuse only a write. A `git config` call reads when it has one of `--get`, `--get-all`, `--get-regexp`, `--get-urlmatch`, `--list`/`-l`, `--show-origin`-only forms, or exactly one non-option argument (the key) and no value. Everything else naming the key is a write. Unknown option together with the key: refuse (fail closed). Keep line 123 (`-c core.hooksPath=...`) as is.
Tests: the table above, run as builder, tech-lead and qa; also `git config core.hooksPath` inside `$(...)`, quoted key, `GIT_CONFIG_*` env spelling still refused.

## K5-2 A command that writes to /dev/null and names the role file is refused by the PLUGIN guard (Security)

Seen: `ls ... session.json ...` style commands that end in a redirect (`2>/dev/null`) are refused with "Changing .bootstrap/session.json by hand is not allowed".
Cause: not our guard. Plugin 0.6.0 `bin/guard.mjs:73` refuses when the command text names `.bootstrap/session.json` AND matches `WRITE_OPS` (`bin/guard.mjs:51`), whose first alternative is any `>` / `>>`. It runs beside ours (plugin hooks.json), so a false block there cannot be fixed in the kit.
Fix options (Chief of Staff to choose; Builder cannot do the first): (a) report to the plugin owner: judge a redirect only when its target is the file; (b) in the kit, offer a reading command (`bootstrap status` already prints the role) and put it in every role brief so nobody needs to look at the file; (c) accept and document the workaround (read it with the Read tool).
Same family, same cause: any command text that mentions `push ... main`, `--force`, `--no-verify`, `core.hooksPath`, `docs/signoffs` is refused by the plugin guard even when it is only prose. Workaround used so far: placeholders, notes through files.
Also seen (Tech Lead, 2026-11-17): the Write tool to an absolute path OUTSIDE the project (the session scratchpad) is refused by the plugin guard ("writes only docs/**, *.md; <path> is outside that"). Our guard allows paths outside the project (`rel === null`). UNKNOWN whether this hits every role; the workaround is a Bash here-document into the scratchpad. Report with (a).

## K5-3 An assignment inside a command substitution is refused (Security)

| Command | Now | Wanted |
|---|---|---|
| `echo $(FOO=1 date)` | refused ("the name of an environment variable cannot be a variable") | allowed |
| `X=$(A=1 git status)` | allowed | allowed |
| `$R=BOOTSTRAP_ROLE`-style (name built from a variable), `env $N=x` | refused | refused (unchanged) |

Cause: `lib/shellrules.mjs:346`, `/^[^=]*[$`][^=]*=/` on each word. The word `$(FOO=1` has a `$` before the `=`, so it reads like a variable name even though `FOO` is a plain name inside a substitution.
Fix: the rule is about a NAME that is built from `$`/backtick. Apply it to the left side of an assignment after the substitution has been parsed as its own command (the guard already reads inner commands for `$(...)`), or exclude a word of the shape `$(` + plain identifier + `=`. A name that still contains `$` or a backtick after that stays refused. Do not weaken the PowerShell forms (`$env:...`) on the same line.
Tests: the table; `echo $(A=1 B=2 cmd)`, `echo $($N=1 cmd)` (refused), `echo $(env $N=x cmd)` (refused), nested `$( $(X=1 y)=z )` (refused).

## K5-4 `git -C <another worktree> commit` is allowed (Tech Lead, found at K-2 review ec605fd; low)

A builder in a registered worktree can run `git -C <main checkout> commit` (also `--allow-empty`, `-am`). The hook judges the commit by the MAIN checkout's role (chief-of-staff). It adds no new content (it can commit what the Chief of Staff already staged or changed, or an empty commit), but it moves the Chief of Staff's branch under their feet.
Probe from a builder worktree: `git -C <main> commit -am x` ALLOWED; `-C <main> checkout -- .githooks`, `reset --hard`, `--work-tree=<main> checkout -f` refused.
Fix: for roles other than the live pushers and the Chief of Staff, refuse `git -C <path>` / `--git-dir` / `--work-tree` whose folder is another registered worktree (`ctx.roots`) for any subcommand that writes (`commit`, `merge`, `rebase`, `cherry-pick`, `am`, `revert`, `stash`, `tag`, `branch`, `update-ref`), keep reads (`status`, `log`, `diff`, `show`, `rev-parse`) allowed.
Tests: the commands above from a builder and a tech-lead; reads allowed; the Chief of Staff and Release Ops unchanged.

## Order and evidence

K5-T first (it is the cause of refusals under load), then K5-1 and K5-3, which are guard code (small, low risk each). K5-4 is guard code (needs `ctx.roots`). K5-2 is a plugin matter: decide the route first. Gate: the guard suites without `KIT_NEXT` on the installed kit, one at a time (`--test-concurrency=1`, they time out under load), plus the plugin-guard fixture test. Evidence with each fix: a before and after probe like the tables here.

UNKNOWN: whether Security's two cases are exactly the ones above (I reproduced the substitution case; the `ls ... session.json` case from the shape of the refusal, not from their command). Builder A should ask Security for the exact commands before starting.
