# QA - session log

Newest entry on top. Only this session writes this file.

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
