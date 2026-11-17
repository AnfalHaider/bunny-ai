# Running the family in other tools

<!-- Reference file of the bootstrap-environment skill. Full matrix and sources: docs/compatibility.md in the kit repo. -->

`node .bootstrap/bin/adapt.mjs <tool>` writes the tool's native files from the same sources
(`AGENTS.md`, this skill, `.bootstrap/roles/`). `adapt list` shows what each tool gets. It never
overwrites a file.

**Tailor to the tool's limits, and probe them first (R14).** Decide the mode from what the tool can do:

| The tool has… | Mode | Enforcement |
|---|---|---|
| subagents or parallel sessions + per-agent permissions + blocking hooks (Claude Code, Copilot, Kiro, Antigravity) | full family | guard hook + per-role permissions + pre-push |
| subagents, weak per-agent limits (Cursor, Codex, Devin, OpenCode) | full family, roles as separate launches or subagents | guard where hooks exist + **pre-push** |
| one agent with a shell (Cline, Aider, Zed, Junie, Amp) | **single agent playing roles in turn**: it says which role it is acting as and runs `bootstrap role <id>` before switching | pre-push only |
| no filesystem or shell (ChatGPT) | **advisor**: Chief of Staff + Librarian write rows, briefs and decisions; a tool with a shell does the work | none locally; server-side branch protection |

Always, in every mode:
- The pre-push hook is installed (`git config core.hooksPath .githooks`). It is the one check every tool and human goes through.
- Turn on branch protection and required checks for the live and dev branches on the server. It is the only layer that also binds cloud agents.
- Keep `AGENTS.md` small. Codex caps it at 32 KiB, Antigravity at 24 KB per file, and Cursor recommends ≤500 lines per rule.
- Keep MCP tool counts low. Some tools silently drop tools past a cap.
- Sessions in different tools talk only through the board and their logs. There is no shared message bus.

A tool whose hook config format you have not checked against its current docs is wired by hand and
smoke-tested (R2) before anyone relies on it. Plugin-bundled hooks fail open in some tools (Devin), so
project-level hooks are preferred.
