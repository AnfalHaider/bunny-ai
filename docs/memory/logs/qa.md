# QA - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - Builder fixes re-checked at 9ca3f77

Gate 7 of 7 (134 e2e). Fixed and confirmed: Q2-29 (D2 passes in four combinations), Q2-30 (T4b), Q2-31 (D3), edited-file counts (+2 −1), the live "Trying..." line (stays 32 s to 62 s), junction escape test still clean. D1 24 of 24, S-1 33 of 33. Only Q2-7 remains: `#pane-plan` is still in `index.html` (the "no dead pane remains" check fails 8 of 8); waiting for the removal and for the release sha. **No new lesson.**

## 2026-11-16 - Builder batch re-checked at d2dbf82

Gate 7 of 7 (130 e2e). Verified fixed: Q2-28 (D1 walk 24 of 24), Q2-27 (S-1 walk 33 of 33), Q2-24 and Q2-26 (per-mode tests pass, Auto computer-use click not driven), both T-3 gaps ("is slow, trying ..." at 32 s; Auto names the other failure), draft kept when a waiting message is cancelled by leaving, "Checking your connection..." then one send. New `test/q2-escape.test.js`: a junction pointing outside cannot be written through or read through the panes. Still open: Q2-7 (Plan pane unreachable), Q2-29, Q2-30, Q2-31. Final sign-offs (release-0.1.5, D1 PASS) wait for the release sha. **Lesson:** after a decision flips a safety default, re-read every test that drives the dangerous case (Auto computer-use click) before running it: now it really clicks.

## 2026-11-16 - D-2 panes walked at 5f36e04

Gate 7 of 7 (128 e2e). Changes (git and plain folders, checkpoint cards, counts, diff, Undo to here), Files (tree, read-only file view, changed lines marked), Session (folder, branch, model, mode, effort, tokens, running programs, Auto's pick) all pass in four widths and themes: Q2-4, Q2-5, Q2-6 fixed. Q2-7 partly: the Plan pane fills but has no tab to open it. Path-escape tests (17 attempts on each route, a junction pointing outside, UNC and drive paths, unchosen folders) all refused. Permission tests now follow the Chief of Staff's decision (Auto: build runs without asking; Manual and Accept edits ask; computer-use clicks follow the mode; the Auto click is not driven because it would click this screen). **Lesson:** a phone has one pane at a time, so a walk that sends a message must close the pane first; a script that does not looks like a bug in the app.

## 2026-11-16 - D1 signed FAIL at 2cfeec5; T-3 and D-2 walked at 6ef4ccf

- **D1** at 2cfeec5: gate 7 of 7; my d1 sign-off is FAIL for Q2-28 (phone Settings pills one at a time). Re-sign on the release sha once fixed.
- **6ef4ccf** gate 7 of 7 (123 e2e). A stray test server on port 5199 from an earlier run made the e2e step fail in 2 s ("already used") twice; kill it before running the gate.
- **T-3 core** (Q2-10 to 13): a model that never answers now switches in 33 s (picked), 63 s (Auto) and stops after 93 s with one saved note; before it was 122, 242 and 363 s with red lines. **T-3 offline:** calm line, waiting bubble, Offline chip, Cancel, replace, exactly-once resend, local model answers: all pass, also with real offline emulation. New: Q2-30 (a closed local provider is tried offline and fails in red).
- **D-2:** grouped steps, narration, reload and 26 older chats pass in four combinations. New: Q2-29 (a non-zero exit code is not marked Failed), Q2-31 (after Stop, the Stopped report appears only after a reload).
- **Lesson:** when a check passes on a clean profile and fails on a reused one, the reused profile is the suspect: start every walk on a fresh data folder.

## 2026-11-16 - Builder fixes re-walked at 4405dc0; D1 walked

Gate 7 of 7 (111 e2e). Verified fixed: Q2-1, 2, 3, 8, 9, 17, 19, 23 (table in `docs/plans/audit-q2.md`). New: Q2-27 (a false "restarted" banner when the in-app browser opens Bunny's own API) and Q2-28 (D1: on a phone each Settings pill is as wide as the strip, so one section is visible at a time; `.nav-row { width: 100% }` at `src/ui/app.css:259`). D1 walk `e2e/q2-d1-walk.mjs`: 22 of 24 (the two failures are Q2-28). Add-a-provider button, custom form before Popular providers, full-width phone Automation buttons and the purple bunny (accent token `#6a4fd8` / `#b3a1ff`, grumpy the same) all pass. D1 not signed: waiting for its sha. **Lesson:** a check I wrote to match what I had seen (one pill in view) passed a layout that was wrong; assert what a person needs to see (several pills at once), not what the screen shows.

## 2026-11-16 - S-1 signed (PASS at 09b35e4) and G-1 checked at 560e636

- **S-1:** `e2e/q2-s1-walk.mjs` 33 of 33 on an invented profile with the guard ON: 17 guard checks, 16 real-page checks, 4 key-based providers, a custom gateway, built-in Ollama, OAuth sign-in starts, speech audio (wav, 7.2 s), sandboxed artifact, in-app browser, popout, export, terminal. Sign-off `docs/signoffs/s-1/qa.md`. Finding Q2-23: a tab left open across a restart fails silently. Not run: Electron, a live Google return with a known state.
- **Gate:** at 09b35e4 it is 6 of 7 on this machine (only G-1 test A1, the hook file's LF endings, because `core.autocrlf` is true and `.gitattributes` first arrives in 560e636). At 560e636 it is 7 of 7 (420 unit, 92 e2e). App code is identical between the two shas. A working copy that already holds the hook with CRLF must be regenerated (`git checkout -- scripts/guard-next/.githooks`) before A1 passes; a fresh clone is fine.
- **G-1 at 560e636:** `node --test test/guard-next*.test.js` passes inside the full gate. `e2e/q2-g1-realworld.mjs` runs the staged guard as role qa in a throwaway repo: 29 of 29 as expected (docs, test, e2e and log writes allowed; app code and policy refused; git add by path, a sign-off by exact path, commit, plain push and push of my own claude branch, gate, tests, Playwright, audit scripts allowed; push to main, force push, `--no-verify`, `commit -n`, `reset --hard`, a sign-off for another role, the profile reset refused). Not exercised: `npm run release` (the guard does not read it; the script refuses a non-release role).
- **Lesson:** a gate that passes on the author's machine can fail on a Windows default checkout (CRLF); run the gate from a fresh checkout, not a reused working copy.

## 2026-11-16 - Q-2: every control audited on an invented profile

**Question asked (owner, relayed):** "go through all the navigation items, all settings, then make detailed tests to evaluate that everything is working without bugs and efficiently. dont assume anything."

**What I did**

- Drove every control of the chat shell, the side panes, Code mode, Settings (15 sections), Providers, Automation and Customize on an invented profile (`BUNNY_DATA_DIR` temp, `BUNNY_FAKE_UPSTREAM=1`), with a scripted model where a real reply shape was needed. 316 controls inventoried from the live DOM: 245 PASS, 23 FAIL, 48 UNKNOWN (`docs/plans/audit-q2-inventory.md`).
- Reproduced all six of the owner's screenshots, with timings for the model fallback (122 s, 242 s, 363 s).
- Found 22 defects (5 High, 9 Medium, 8 Low): `docs/plans/audit-q2.md`. The two that matter most: Plan mode does not stop a write the model asks for anyway (Q2-1), and a permission mode chosen in a new chat silently reverts (Q2-2). Changes and Files panes are markup only (Q2-4, Q2-5).
- Added 23 unit tests (17 `todo` pinned to defects) and 17 browser tests (10 `test.fail` pinned to defects); the gate passes 6/6 with them.

**Not covered:** the installed Electron app (so `window.prompt` in Rename, Q2-17, is a likely defect, not a verified one), external sign-ins, voice, and three unexplained headless-Chromium crashes (Q2-U1).

**Lesson:** a check that passes on a fresh chat can hide a bug that only shows in a chat that already has replies (Q2-19 Stop; Q2-2 mode). Run each interaction twice: once on a new chat and once on one that has history.

## 2026-11-16 - B-1 sign-off: PASS at 332f44a

`node scripts/bootstrap.mjs` exit 0 and `node scripts/gate.mjs` 6/6 on the Builder's fix (shell only for npm/npx `.cmd`). Sign-off committed as `4a399f0`. No lesson.

## 2026-11-16 - 0.1.4 screens walked on an invented profile

57 of 57 checks passed after fixing my own script (`docs/qa/2026-11-16-0.1.4-walk.md`, `70c1742`). Lesson: when a script fails on its first run, check the script before filing a defect: all 12 first-run failures were mine.
