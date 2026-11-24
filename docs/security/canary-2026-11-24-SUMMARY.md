# Canary run, 2026-11-24 (rerun with saved results)

Raw evidence: `docs/security/canary-2026-11-24.json`, sha256 `a49569774676472cb3beab5998b12ce14af7c5d52f436ef65ac6a6119f494165`. It holds, for every run, the request count, each request's size and markers, and the stub's behaviour. Every run saw at least one request.

Owner's word for the third download: "Yes, download both" (docs/plans/2026-11-20-v0.1.15-plan.md on main). Both files were checked against pins.json before anything ran: claude-code-win32-x64-2.1.311.tgz sha256 32a33376...9ee6 (136,547,707 bytes), codex-x86_64-pc-windows-msvc.exe.zip sha256 b1634415...a158 (214,674,329 bytes). Local stub endpoint, dummy tokens, empty account folders, no sign-in. The binaries and the scratch folder were deleted afterwards. Runner: `scripts/canary-engines.mjs` (v2).

| Run | Requests | Markers in the requests | Markers in the SECOND request (lazy runs) |
|---|---|---|---|
| claude-static-user-root | 1 | none |  |
| claude-static-user-sub | 1 | none |  |
| claude-static-default-sub-CONTROL | 1 | MARK_ROOT_CLAUDE_MD, MARK_DOTCLAUDE_CLAUDE_MD, MARK_SUB_CLAUDE_MD |  |
| claude-static-default-root-CONTROL | 1 | MARK_ROOT_CLAUDE_MD, MARK_DOTCLAUDE_CLAUDE_MD |  |
| claude-lazy-user-root | 2 | none | none |
| claude-lazy-default-root-CONTROL | 2 | MARK_ROOT_CLAUDE_MD, MARK_DOTCLAUDE_CLAUDE_MD, MARK_SUB_CLAUDE_MD | MARK_ROOT_CLAUDE_MD, MARK_DOTCLAUDE_CLAUDE_MD, MARK_SUB_CLAUDE_MD |
| codex-max0-root | 1 | none |  |
| codex-max0-sub | 1 | none |  |
| codex-default-root-CONTROL | 1 | MARK_ROOT_AGENTS_MD |  |
| codex-default-sub-CONTROL | 1 | MARK_ROOT_AGENTS_MD, MARK_SUB_AGENTS_MD |  |

Reading: with `--setting-sources user` Claude Code sent no folder instruction file, not even in the second request after it read `sub/x.txt` (the lazy subfolder case); with default sources the same fixture sends them, including `MARK_SUB_CLAUDE_MD` in the second request, so the check can see the case. Codex with `project_doc_max_bytes = 0` sent no AGENTS.md at the git root or in the subfolder; with the default it sent the root file at the root and both files from the subfolder.

S-F13B (command/exec under Codex's unelevated sandbox): see `docs/spikes/cli-engines/s-f13b/S-F13B-codex-command-exec.md`.
