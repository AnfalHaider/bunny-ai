# Canary second run, 2026-11-24: SUMMARY ONLY, NOT the raw evidence

The raw JSON of this run was lost (a later Playwright run emptied `test-results/`, where the runner wrote it). This file is the runner's console summary, kept so Security can see what it printed. It is not evidence: a rerun will commit `docs/security/canary-2026-11-24.json` (raw, per request).

Runner: `scripts/canary-engines.mjs` (v2), pinned files with sha256 and size checked against `pins.json` before running: claude-code 2.1.311 (136,547,707 bytes), codex 0.170.0 (214,674,329 bytes). Local stub endpoint, dummy tokens, no sign-in.

| Run | Requests | Markers seen in the request(s) |
|---|---|---|
| claude, `--setting-sources user`, cwd root | 1 | none |
| claude, `--setting-sources user`, cwd sub | 1 | none |
| claude, default sources, cwd sub (control) | 1 | root, .claude/, sub CLAUDE.md |
| claude, default sources, cwd root (control) | 1 | root, .claude/ CLAUDE.md |
| claude lazy (model Reads sub/x.txt), user sources | 2 | none (second request included) |
| claude lazy, default sources (control) | 2 | root, .claude/, sub CLAUDE.md |
| codex, `project_doc_max_bytes = 0`, git root, cwd root | 1 | none |
| codex, `project_doc_max_bytes = 0`, cwd sub | 1 | none |
| codex default (control), cwd root | 1 | root AGENTS.md |
| codex default (control), cwd sub | 1 | root and sub AGENTS.md |

S-F13B (`codex app-server` `command/exec`, `windows.sandbox = "unelevated"`, CODEX_HOME outside %TEMP%), only the final file check survived: written inside the project: yes; outside the project (workspaceWrite policy): no; inside under a readOnly policy: no; outside with no sandboxPolicy: no. Exit codes, timings and messages were lost.
