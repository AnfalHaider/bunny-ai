# Bunny AI v0.1.14 against the Claude app and Cursor: gaps and features

Chief of Staff, 2026-11-20. For the owner's request: "give me a report of gaps and features vs claude app and cursor vs Bunny AI".

This is the Researcher's comparison (`docs/research/2026-11-20-bunny-vs-claude-cursor.md` on `claude/researcher-more-engines`, d420de83), corrected by the Chief of Staff against Bunny's own code at the v0.1.14 candidate (d7022bfe).

## Sources and limits

- **Claude:** from its official pages, some of them read only in part.
- **Cursor:** from search summaries of cursor.com and its forum. Treat each Cursor line as a lead to re-check.
- **Prices and plans:** change often.
- **Not run:** none of the three products was installed or measured.

## Corrections to the Researcher's draft

| Draft said | Checked at d7022bfe |
|---|---|
| "No branch-per-task isolation" in Bunny's own agent | Bunny has **"Give this chat its own copy of the project"** (W2-9): a real git worktree on a new branch, kept in Bunny's data folder, with Finish to merge or keep it (`src/server/worktrees.js`). That is level with Claude Code's and Cursor's worktrees. The remaining gap is a multi-step rewind. |
| Whether Bunny reads CLAUDE.md or AGENTS.md is UNKNOWN | **It does not read them from the opened folder.** A repository's CLAUDE.md is imported only when it arrives as part of a plugin, where it becomes a skill (`src/server/pluginImport.js:110`). Reading AGENTS.md, CLAUDE.md and `.cursor/rules` as folder instructions is a **real gap** (cheap to close). |
| Whether Bunny takes standard SKILL.md skills is UNKNOWN | **Yes.** SKILL.md skills, commands, Claude-style plugin manifests and `.mcp.json` are imported, and v0.1.14 makes them read as Bunny's (BRAND-BUNNY). |
| Whether Bunny creates Office files is UNKNOWN | **It reads them, but does not create them.** `src/server/documents.js` reads PDF, Word, Excel, PowerPoint and EPUB, and nothing writes .docx, .xlsx or .pptx. The gap is real. |
| Code signing is a High priority | **The owner declined it** ("We are not signing the code."). The SmartScreen note stays in the release notes. |
| v0.1.14 contents are "as planned" | They are now **as built and gated**: engines (Claude Code, Codex CLI), Search this PC, Quick ask web, the devices chip, the phone layout, one-row lists and Bunny naming. |

## Where Bunny is ahead

- **Model freedom:**
  - 23 providers, any OpenAI-compatible server, and local Ollama with no key;
  - automatic fall-back to another model, with everything read so far handed over;
  - per-chat model choice.
  - Neither rival lets you mix vendors and local models like this.
- **No account and local ownership:** keys sit in Windows DPAPI, and chats, memory and attachments stay on the PC.
- **Engines inside one app (new in v0.1.14):** Claude Code and Codex CLI run inside Bunny's chat, with Bunny's permission cards. Each runs Local (on your own models) or Account, and can be updated or rolled back from its row.
- **A permission model you can read:**
  - Deny beats Ask beats Allow;
  - rules by command or path, global or per folder, with a "Try a command" dry run.
  - On native Windows, Claude Code also runs commands without a sandbox, so the two are level there.
- **Searching this PC:** through Windows Search, with the files cited and private folders always excluded.
- **Phone and other devices on the home network:** per-device levels and an Activity log.

## Gaps, by priority

### High

1. **Reaching Bunny from outside the home network (OPEN-SIGNIN).** Planned for v0.1.15. It needs the owner's Tailscale test.
2. **A multi-step rewind.** Claude Code checkpoints before every prompt (`/rewind`); Bunny has one Undo per reply.
3. **Reading AGENTS.md, CLAUDE.md and `.cursor/rules` from the opened folder** as project instructions, shown to the person. This is cheap, and it is what both rivals do.
4. **Creating Word, Excel and PowerPoint files.** Claude creates them on every plan; Bunny only reads them.
5. **Confining commands on Windows** for Auto mode (AppContainer or a restricted token). This is research first, then Security. Today the README honestly says "a guard rail... not a sandbox".

### Medium

6. **Tool-level hooks (HOOK-MAP) and event triggers for schedules,** such as a webhook, a file change or a new pull request. Claude Code has hooks on every tool call and cloud routines; Cursor has Automations.
7. **An "auto-review" mode,** where a classifier checks each step, between Accept edits and Auto. Both rivals have one.
8. **Code search by meaning.** Cursor indexes the codebase; Bunny searches by text and pattern.
9. **Driving the person's own signed-in browser,** as Claude in Chrome does. Bunny's browser panel is its own. High risk: it needs Security.
10. **A Mac version.** This is the largest audience gap; Bunny is Windows-only.
11. **A Codex Account mode.** It needs a throwaway ChatGPT account to test. More engines (Gemini CLI, Qwen Code, OpenCode) wait for their spikes.
12. **Exporting an artifact or a chat as a file** to share, staying local-first.
13. **User-defined helper roles saved as files,** like Claude Code's subagents.

### Low

14. IDE plugins (VS Code, JetBrains).
15. Team features: shared projects and single sign-on.
16. Sync across devices.
17. A hosted cloud runner.
18. Enterprise installers.

These are largely excluded on purpose by Bunny's one-person, local-first design.

## Known small items carried to v0.1.15

- **PIC-OFFSET, PERM-REFINE:** deferred by the owner.
- **The full Deny / Ask / Allow list editor** with an add-rule line, as drawn in v12. v0.1.14 ships the three full-width boxes.
- **Showing the floor flag on the Allow path**, or turning it into an Ask. This is HIGH: it needs Security and the owner's go.
- **"Bunny's own tools"** sits oddly under the "file tools" heading of the Always protected list.
- **The licence link in About** is clipped by a few pixels at about 720 px.
- **GATE-MARKS:** the gate should name the failing unit test (built at 277cc305 and passed by Tech Lead).
- **The palette** does not redraw when the chat list arrives late.
- **An intermittent unit failure,** seen in two gates and never named. It is the reason for GATE-MARKS.
