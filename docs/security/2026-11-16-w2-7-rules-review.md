# W2-7 permission rules by command and path — Security review

Date: 2026-11-16 · Session: Security · Reviewed: `791dc98` on `claude/builder-w2-7` (on lane A `9fb372f`): `src/server/permissionRules.js`, the rule routes and the checks in `src/server/app.js`, `canon()` and `hidden` in `src/server/workspace.js`, the Settings screen. Owner's go: board Q3 (`d8b34d7`).
Method: code reading; then probes on throwaway folders in the temp folder and an invented profile (`BUNNY_DATA_DIR`, fake upstream, port 5871, stopped afterwards). `docs/security/w2-7-probe/probe.mjs` asks the rule engine and **Windows PowerShell 5.1's own parser** (nothing is executed) what each command really contains, and flags a command that PowerShell would run but the rules did not see (output: `probe-output.txt`); `probe2.mjs` does real reads and writes through the file tools to see what a path spelling really reaches. I did not run the builder's tests or the e2e suite.

## Verdict: **FAIL** — one HIGH, two MEDIUM. The path rules hold. The command rules and the place the rules are stored do not yet.

## What held
- **Order and modes.** Plan mode is checked before the rules (`planRefuses` precedes `checkToolCall` in both call sites), so an Allow cannot make an edit run in Plan. Ask asks in every mode; Deny stops the call and tells the model not to look for a way around it. `start_process` goes through the same engine.
- **Path rules against the file system.** Judged on the path as typed, as collapsed (`a/../secrets/x`), and as the real file after links (`canon()`), and an Allow needs all of them to allow. Held in 25 spellings, tested with real reads and writes (`probe2.mjs`): case, `\` and `/`, `./`, `//`, `..` detours, a junction at the top and a junction inside an allowed folder, a short 8.3 name (`SECRET~1`), `::$DATA`, `::$INDEX_ALLOCATION`, the absolute path, a trailing dot or space on the file. A trailing dot or space on a *folder* name (`secrets-private./x`) is not matched by the rule, but it does not reach the folder either (Windows does not resolve it to the folder through this API: the write was not made), so I do not count it. Denied paths are left out of `list_files`, `search_files` and `find_files` walks. An Allow path rule does not cover `docs/../secrets/x` or a link out of `docs`.
- **Allow grammar, simple cases.** Allow needs every part to match and refuses a command with `$( )`, backticks, `( )`, `{ }`, control characters or a redirect to a file; all of `;`, `&&`, `||`, `|`, `&`, newline, and the 20 other separators I tried (`> f`, `2>`, `*>`, `| Out-File`, `| tee`, `-and (…)`, comments, here-strings, a `＼uFF1B` look-alike) were refused or split correctly. Deny and Ask look inside `$( )` and backticks.
- The `try` and `check` routes run nothing.

## Findings

### W27-1 HIGH — an Allow rule can be made to cover any command (backslash is not an escape in PowerShell)
`commandParts` treats `\` as an escape outside quotes and inside `"…"`, as a Unix shell does. `run_command` runs **Windows PowerShell 5.1**, where `\` is an ordinary character and the escape is the backtick. So these are one "simple command" to the rules and two or three to PowerShell (PowerShell's parser, `probe-output.txt`):

| command | rules see | PowerShell runs |
|---|---|---|
| `npm test \; Remove-Item x` | one part, matches `npm test*` → **allow applies, no question** | `npm`, `Remove-Item` |
| `npm test \| Remove-Item x` | same | `npm`, `Remove-Item` |
| `npm test \` + newline + `Remove-Item x` | same | `npm`, `Remove-Item` |
| `echo "x\" ; Remove-Item y ; echo "` | one quoted string → **allow applies** | `echo`, `Remove-Item`, `echo` |

The same trick makes a **Deny silent**: with `Remove-Item*` denied, `echo a \; Remove-Item x` and `echo "a\" ; Remove-Item x ; echo "` are not stopped. So "always allow `npm test*`" or "always allow `git status*`" is, for a model that knows the trick (or an injected one), an always-allow for every command, in every mode, and a Deny is skipped. This is the one that decides the verdict, because Allow is exactly the setting a person uses to stop being asked.
**Fix.** Split the way the shell does: outside quotes `\` is literal and the escape is the backtick; inside `"…"` the escape is the backtick and `""`; inside `'…'` only `''`. Better, ask PowerShell: parse the command with `[System.Management.Automation.Language.Parser]::ParseInput` (the probe does it in about 0.3 s) and judge the command names it finds (alias-resolved, with a dynamic or unreadable one counted as "unknown"); fall back to Ask when the parse reports errors. Add every row above to `test/permission-rules.test.js`.

### W27-2 MEDIUM — a Deny matches the text, so aliases and spellings of the same command slip past it
With `Remove-Item*` and `git push*` denied, none of these is stopped, though PowerShell runs the denied command: `rm -r x`, `ri -r x`, `del x`, `erase x`, `rd x`, `rmdir x`, `gci | ri`, `ls x | rm`, `& "Remove-Item" x`, `. Remove-Item x`, ``Re`move-Item x``, `git -C . push`, `git -c a=b push`, `git --no-pager push`, `git -P push`, `git.exe push`, ``git `push``, ``g`it push``, `GIT_X=1 git push`. Also missed (not in my probe): `cmd /c …`, `powershell -c "…"`, `iex "…"`, a command held in a variable (`$c="Remove-Item"; & $c x`). The screen's own starter, "Deny Remove-Item -Recurse*", does not stop `Remove-Item x -Recurse`, `-r` or `-Rec`. The Settings text says what a command pattern matches ("what Bunny is about to run"), but a person who adds "Deny Remove-Item" reads it as "Bunny never deletes".
**Fix.** At least: match the command *name* after normalising (strip backticks and quotes, drop `.exe`, resolve PowerShell's aliases: `rm ri del erase rd rmdir` → `Remove-Item`, `cp copy`, `mv move`, `cat type`, `gci ls dir` and so on), skip a leading `VAR=x`, and for `git <subcommand>` skip the global options (`-C x`, `-c x`, `--no-pager`, `-P`, `--git-dir`) before comparing. Treat a wrapper (`powershell`, `pwsh`, `cmd`, `bash`, `iex`, `Invoke-Expression`, `& $x`) as Ask whenever any Deny or Ask rule exists, because its contents cannot be judged. Say in the screen, once, that rules are a net for mistakes and not a lock against a determined model, and list the starters accordingly.

### W27-3 MEDIUM — the rules can be erased by whatever can run a command, and the page token is free to any local program
Tested on an invented profile: a plain `GET` of any page (`/src/ui/settings.html`, no cookie, no header) returns the launch token in its `<meta name="bunny-token">`; with it, `PUT /api/permission-rules` set a Deny and then replaced the list with an empty one, and `GET /api/settings` was readable. The request guard (S-1) keeps out other *web pages*; it was never meant to keep out a program on this computer. Before W2-7 that mattered for settings in general; now the model's own `run_command` can (a) remove the Deny rules over the local API, a few lines of PowerShell, and (b) in Auto mode, where `run_command` does not ask, do it with no question at all. Auto is exactly where a person leans on Deny rules ("never git push, even in Auto"). Writing `settings.json` directly is the weaker route: the server keeps settings in memory and the next settings save overwrites the file, so a direct edit only matters after a restart.
**Answer to "is `run_command` writing `settings.json` acceptable?"** The file itself: acceptable, with the restart caveat. The API route that does the same thing now: **not acceptable as built.**
**Fix (the D2-5 pattern).** In the desktop app, make rule changes something only the window can do: the Settings screen sends them through the preload bridge to the main process (a main-process write, or a one-time handle the server checks), and `PUT /api/permission-rules` is refused when the server runs desktop-mode (`folderPickerOnly`-style flag); keep today's behaviour for the plain-browser dev build. Cheaper and weaker alternative for this release: refuse `run_command`/`start_process` text that mentions `permission-rules`, `settings.json`, the data folder or `x-bunny-token` when any Deny or Ask rule exists, and record that it is a text net (see W27-2). Do the real fix next.

## Notes (no action needed for the verdict)
- **Path rules do not see inside commands.** `Get-Content secrets\key.pem` or `Set-Content secrets\x` via `run_command` is not judged by a path rule. The screen says so ("not what a command does"). A person who wants "never touch secrets" needs a command rule too, which W27-2 shows can be dodged; the honest end state is that a path Deny is a guarantee only against Bunny's file tools.
- Other tools that run programs (`add_connector`, `create_tool`, plugin hooks) are not under command rules.
- `translateChains` rewrites `&&` and `||` after the rules look at the original text; both forms split the same way, so no gap there.

## What I need to see to sign PASS
1. W27-1 fixed with the table above in the tests (and ideally the PowerShell-parser approach).
2. W27-3 fixed (rule writes only from the window in the desktop app), or Chief's and Builder's written decision to ship with the text net and a dated follow-up.
3. W27-2 at least for the aliases and `git` options of the starter rules, plus the one-line honesty note in Settings.
Re-run: `node docs/security/w2-7-probe/probe.mjs <checkout>` and `probe2.mjs`; it prints `BYPASSES: 0` for Part 1 when W27-1 and W27-2 are closed (Part 2's two "BYPASS" lines in `probe.mjs` for trailing dots are false alarms: `probe2.mjs` shows they do not reach the file).

## Not done
No packaged run; no real model driving the tools; I did not run `permission-rules*.test.js` or the e2e spec; the live data folder was not touched (invented profile only).
