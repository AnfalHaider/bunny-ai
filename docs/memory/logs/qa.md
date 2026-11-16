# QA - session log

Newest entry on top. Only this session writes this file.

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
