# S1 line for ENGINE-RULES: `--permission-prompt-tool mcp__bunny__approve` (ER-4, spec 3.7.4)

Run 2026-11-19 by Builder C, with the pinned real binary (Claude Code 2.1.311, win32-x64, from the pinned npm tarball), the real `startClaude` / `buildRun` / `createApproveServer` / `createBridge` of this branch, Bunny's own Messages translator in front of a scripted model (a Chat Completions stand-in, no account, no network, no real model), an invented project folder and an isolated home under a scratchpad folder. Driver: `er4.mjs` (not shipped). Nothing real was read or written.

**Result: the line passes for 2.1.311.** The pin carries `promptTool: true`; a pin change needs the line run again (Security sign-off per pin).

| # | What was shown | Observed |
|---|---|---|
| 1 | A question reaches the bridge and waits for a card; Allow runs the tool, Deny stops it | `allow`: the command ran (marker file). `deny`: it did not, the model saw "The person said no." Answered at **120 s**: ran (see the timeout finding below). |
| 2a | Prompt tool unreachable (server closed before the run) | The engine said `MCP tool mcp__bunny__approve (passed via --permission-prompt-tool) not found`; the tool did **not** run; the run ended with an error (a deny). |
| 2b | Server closed while a question was pending (crash) | `ECONNRESET`; tool did not run. |
| 2c | Handler throws | Bunny answers deny ("could not judge"); tool did not run. |
| 2d | No answer inside Bunny's limit (4 s in the spike, 150 s in the app) | Bunny answers deny; tool did not run. |
| 2e | Engine killed | The run ends; no tool runs (the same layers as S1 (c)). |
| 3 | The model cannot call the prompt tool | The tool is **not in the model's tool list** (a scripted call to `mcp__bunny__approve` got `No such tool available`; no request reached the server). No `--disallowedTools` entry is needed. The hook also denies the name as a floor (`mcp__bunny__*`). |
| 4 | A floor deny beats an engine allow and the prompt tool's Allow | With the owner's allow rule `Read(//c/.../fakedata/**)` and a decide that says allow: `File is in a directory that is denied by your permission settings`; the data was not read. The floor is in `permissions.deny`, and `floorOnly` denies it in the hook as well. |
| 5 | The engine's own rules work as set in Bunny | An `ask` rule gives a card (allowed: ran). A `deny` rule stops the tool with no question. An `allow` rule that matches runs it with no card (a redirect in the command defeats a prefix rule, as in Claude Code itself: it asked). |
| 6 | Hook with no opinion | The hook prints `{}` and exits 0 for anything off the floor; Claude Code then applies its own rules and asks the prompt tool. |

## Findings that changed the build

1. **Claude Code ends a waiting MCP tool after 60 s** ("The operation timed out", a deny). A card answered at 120 s was too late. `MCP_TOOL_TIMEOUT=200000` (above Bunny's 150 s limit) is now set for runs with the option off; the 120 s answer then ran.
2. With the prompt tool on, three interactive tools appear in `system/init` (`AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`): they are added to `--disallowedTools` for those runs, so the expected tool list stays the pinned one.
3. **The Messages translator works with the real binary** (this is the local-mode smoke for Claude Code): a scripted Chat upstream gave tool calls and text through `/v1/messages`; the engine started, sent its side requests, ran the tool and finished. The thinking block with the fixed signature `bunny` was not exercised (the scripted model sent no reasoning): UNKNOWN until a provider that streams reasoning is tried.

Not shown: a run with the real model behind it; any account sign-in.
