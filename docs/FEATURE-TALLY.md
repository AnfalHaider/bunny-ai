# Feature tally — reference desktop app → Bunny AI

**Date:** 2026-11-12  
**Reference side:** the private feature inventory (kept off the repo) — every row there is
marked (V) observed in the shipped MSIX/npm artifacts or (I) inferred.  
**Bunny side:** this repository, checked by test, not by claim.

Status: **D** done and covered by a test · **P** partial · **M** missing.
A **D** row names the test that fails if the feature breaks. No test, no **D**.

`scope` says what parity means: **core** (a conversation needs it), **app** (a
surface a desktop AI app is known for), **platform** (OS/desktop integration), **enterprise**
(org admin, hardware, cloud-specific).

---

## 1. Conversation core

The spine of the product: sending, streaming, keeping and shaping a thread.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 1.1 | Stream a reply token by token | core | **D** | `connect, pick a model, chat, and reload into the same thread` |
| 1.2 | Enter sends, Shift+Enter newlines | core | **D** | `Enter sends and Shift+Enter adds a line` |
| 1.3 | Stop generation mid-stream | core | **D** | `stopping a reply ends the stream` |
| 1.4 | Conversation survives a reload | core | **D** | `connect, pick a model, chat, and reload into the same thread` |
| 1.5 | Sidebar of past conversations | core | **D** | `list is newest-first` |
| 1.6 | Delete a conversation | core | **D** | `remove deletes one session and leaves the rest` |
| 1.7 | Auto-title from the first message | core | **D** | `appending a user turn names the chat after it` |
| 1.8 | Rename a conversation | app | **D** | `a new chat can be renamed through PATCH` |
| 1.9 | Copy a message | app | **D** | `a message can be copied from its action bar` |
| 1.10 | Retry the last reply | app | **D** | `retrying a reply asks again and keeps one answer` |
| 1.11 | Edit a message and resend | app | **D** | `editing a message replaces it and asks again` |
| 1.12 | Branch a conversation at a turn | app | **D** | `a branch copies the transcript up to the chosen turn and points at its parent` |
| 1.13 | Markdown with code blocks | core | **D** | `a reply is rendered as Markdown, with a copyable code block` |
| 1.14 | Syntax highlighting | app | **D** | `code in a reply is highlighted` |
| 1.15 | File and image attachments | app | **D** | `a file can be attached to a message` |
| 1.16 | /clear | app | **D** | `/clear starts a new chat and keeps the old one` |
| 1.17 | /compact | app | **D** | `/compact adds a labelled summary and keeps the conversation on screen` |
| 1.24 | The model’s thinking, folded above the reply | app | **D** | `an artifact the model makes gets a card and opens beside the chat; its thinking is folded` |
| 1.25 | Compaction with a summary the model writes | app | **D** | `compacting uses a summary the model writes, and the plain one when the model cannot` |
| 1.18 | Automatic compaction | app | **D** | `a chat that fills up is compacted before the next message` |
| 1.19 | Context meter | app | **D** | `the context meter counts what the transcript will cost` |
| 1.20 | /export a transcript | app | **D** | `export returns a markdown transcript and a json one` |
| 1.21 | Search past conversations | app | **D** | `search matches message text, not only titles` |
| 1.22 | Incognito chat | app | **D** | `an incognito chat leaves nothing behind` |
| 1.23 | Greeting on a fresh page | app | **D** | `a fresh page greets you and centres the composer` |

## 2. Models and providers

Which model answers, and how a key gets there honestly.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 2.1 | Connected and popular groups | core | **D** | `every provider from the picker screen is listed` |
| 2.2 | Connect with an API key | core | **D** | `connect, pick a model, chat, and reload into the same thread` |
| 2.3 | Disconnect a provider | core | **D** | `disconnecting clears the provider` |
| 2.4 | Discover a provider model list | core | **D** | `normalises an OpenAI-compatible list` |
| 2.5 | Grouped searchable model picker | core | **D** | `the picker filters models by search` |
| 2.6 | Full keyboard control in the picker | app | **D** | `the model picker is driven from the keyboard` |
| 2.7 | Model stored per conversation | core | **D** | `update changes title, provider and model but never the transcript` |
| 2.8 | Default model for new chats | core | **D** | `settings round-trip and persist to disk` |
| 2.9 | Key-unverified honesty chip | core | **D** | `a public model list connects but leaves the key unverified` |
| 2.10 | Local model server | app | **D** | `a local server connects with no key and offers its models` |
| 2.11 | OAuth sign-in providers | app | **D** | `the sign-in routes give a code and then connect the provider` |
| 2.12 | Model aliases and allowlist | app | **D** | `the settings screen saves an allowed-model list` |
| 2.13 | Per-provider usage display | app | **D** | `the settings screen shows what each provider was used for` |
| 2.14 | Each provider speaks its own dialect | core | **D** | `Anthropic points at the OpenAI shape and uses its own header` |
| 2.15 | Models the account cannot reach are marked in the picker | core | **D** | `a model the account cannot reach is remembered and marked` |
| 2.16 | Retryable provider refusals are retried once | core | **D** | `a request that asks for more than the balance covers is retried smaller` |
| 2.17 | A silent provider is reported instead of hanging | core | **D** | `a provider that goes silent is reported instead of hanging` |
| 2.18 | The provider's own error explanation reaches the person | core | **D** | `the provider explanation reaches the person` |
| 2.19 | An unverifiable key is not waved through | core | **D** | `the google 404-on-models quirk does not wave a bad key through` |
| 2.20 | Custom OpenAI-compatible providers | app | **D** | `a custom provider is added, chats with its own key header, survives a restart, and can be removed` |
| 2.22 | Another model answers when the picked one is busy | app | **D** | `when the picked model is busy, another answers and the reply says so` |
| 2.21 | ModelScope, SiliconFlow, Gitee AI and other popular providers | app | **D** | `ModelScope, SiliconFlow and Gitee AI are ready to connect with their own addresses` |

## 3. Artifacts

The defining surface: something the model made, shown beside the chat.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 3.1 | Artifact side panel | app | **D** | `a reply can be kept as an artifact beside the chat` |
| 3.2 | Promote a reply to an artifact | app | **D** | `a reply can be kept as an artifact beside the chat` |
| 3.3 | Sandboxed HTML rendering | app | **D** | `an HTML artifact is shown in a sandboxed frame` |
| 3.4 | Version history and restore | app | **D** | `an artifact keeps every version and can restore an older one` |
| 3.5 | Open an artifact separately | app | **D** | `an artifact can be opened on its own` |
| 3.6 | Print an artifact | app | **D** | `an artifact shows a thumbnail and can be printed` |
| 3.7 | Star an artifact | app | **D** | `an artifact can be starred and deleted` |
| 3.8 | Charts and diagrams in artifacts | app | **D** | `an artifact that is data is drawn as a chart` |
| 3.9 | Artifact thumbnails | app | **D** | `an artifact shows a thumbnail and can be printed` |
| 3.10 | The model makes artifacts itself | app | **D** | `in Chat mode the model can make an artifact, which opens as a sandboxed page` |

## 4. Sessions and structure

How conversations are organised once there are many.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 4.1 | Flat conversation list | core | **D** | `list is newest-first` |
| 4.2 | Nested child conversations | app | **D** | `a branch copies the transcript up to the chosen turn and points at its parent` |
| 4.3 | Projects | app | **D** | `a project holds conversations and its instructions reach the model` |
| 4.4 | Project instructions | app | **D** | `a project holds conversations and its instructions reach the model` |
| 4.5 | Star a conversation | app | **D** | `pinned chats sort above newer unpinned ones` |
| 4.6 | Archive a conversation | app | **D** | `an archived chat leaves the list unless asked for` |
| 4.7 | Import history | app | **D** | `a transcript from another tool can be imported` |
| 4.8 | Date buckets and Recents in the sidebar | app | **D** | `the sidebar groups chats under a date bucket` |

## 5. Shell, settings and platform

The frame around the conversation.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 5.1 | Light, dark and system theme | core | **D** | `theme choice survives a reload` |
| 5.2 | Phone-width layout | core | **D** | `a phone-width window does not scroll sideways` |
| 5.3 | Settings screen | core | **D** | `settings reports test mode is on` |
| 5.4 | Secrets encrypted per user | core | **D** | `DPAPI round-trips a secret` |
| 5.5 | Keyboard shortcuts and command palette | app | **D** | `the command palette opens with Ctrl+K and runs a command` |
| 5.6 | Installable as a desktop app | app | **D** | `the app can be installed as a desktop app` |
| 5.7 | Multiple windows and popouts | app | **D** | `a chat can be opened in its own window` |
| 5.8 | Voice input and read-aloud | app | **D** | `a reply can be read aloud` |
| 5.9 | Notifications when a reply is ready | app | **D** | `notifications can be switched on` |
| 5.10 | Check for a newer version | app | **D** | `the version is shown, and a newer GitHub release is reported` |
| 5.11 | Multi-language UI | app | **D** | `the interface can speak another language` |
| 5.12 | Accessibility labels and focus order | core | **D** | `every connect button has its own name` |
| 5.13 | Open chat title in the topbar | app | **D** | `the topbar names the open chat` |
| 5.14 | Session rail show / hide | app | **D** | `the session rail shows environment and connectors` |
| 5.15 | Sign in with GitHub or Google | app | **D** | `signing in to GitHub: from the CLI, from a token, and out again; tokens never come back` |

## 6. Memory, connectors and automation

The agentic surfaces: memory, tools, schedules.

| # | Reference feature | Scope | Bunny | Evidence / test |
|---|---|---|---|---|
| 6.1 | Memory kept across chats | app | **D** | `a memory reaches the model, and is not stored as a turn` |
| 6.2 | Memory editor and privacy toggles | app | **D** | `a memory can be written and switched off` |
| 6.3 | MCP server configuration | app | **D** | `an MCP server is added and refused when it is not an address` |
| 6.4 | MCP tools in a conversation | app | **D** | `a tool the model asks for is run and the answer comes back` |
| 6.5 | Connectors with OAuth | app | **D** | `the token arrives once the person has signed in` |
| 6.6 | Scheduled and recurring tasks | app | **D** | `a due schedule runs and leaves a chat behind` |
| 6.7 | Computer use | enterprise | **D** | `screen text is given at the centre of each line, in the pixels of the shown picture` |
| 6.8 | Skills | app | **D** | `a skill that is on reaches the model` |
| 6.9 | Hooks | app | **D** | `a hook runs when a message is sent` |
| 6.10 | Plugins and marketplaces | app | **D** | `installing a plugin adds and switches on its skills and connectors, and records the plugin` |
| 6.11 | Memories suggested from a chat | app | **D** | `a chat can suggest a memory, and it is kept only when accepted` |
| 6.12 | The model asks for a capability it lacks | app | **D** | `asking for Code mode: the person picks a folder and the file tools arrive in the same reply` |
| 6.13 | Programs that keep running | app | **D** | `a started program keeps running, is read in pieces, and stops` |
| 6.14 | Tools the model builds, with approval | app | **D** | `building a tool always asks, even in Auto mode, and the tool is usable at once` |
| 6.15 | Sub-agents working side by side | app | **D** | `two helpers run side by side, report back, and are kept as chats nested under this one` |
| 6.16 | Chats that message each other | app | **D** | `one chat can message another and read it; a background chat works on its own` |
| 6.17 | GitHub repositories, issues and pull requests | app | **D** | `the GitHub tools read and write through the API with the signed-in token` |
| 6.18 | Undo the model's file changes | app | **D** | `the file changes of a reply can be undone, once` |
| 6.19 | A plan the model keeps visible | app | **D** | `the plan is shown as a live checklist and kept with the reply, without a step line per update` |
| 6.20 | The model remembers and schedules | app | **D** | `the AI can remember a fact and schedule a task; both ask first in Manual` |
| 6.21 | Local connectors (MCP servers run as a program) | app | **D** | `a local connector is only added with the command confirmed, and its tools reach the chat` |
| 6.22 | Gmail, Calendar and Drive | app | **D** | `the Google tools search mail, draft without sending, read the calendar and export a Doc` |
| 6.23 | Scheduled tasks with tools, unattended | app | **D** | `incognito chats and scheduled tasks send the key in the provider header; scheduled runs get tools` |
| 6.25 | The model asks questions with tailored choices and reasons | app | **D** | `the model asks with choices and gets the one the person clicked, in the same reply` |
| 6.26 | The model remembers its steps and continues after a cut-off | app | **D** | `on the next message the model is told what it already did, and to carry on after a cut-off` |
| 6.27 | Bunny narrates its steps, runs tool calls written as text, and never ends silently | app | **D** | `a written-out tool call runs, the words before it stay with the step, and a silent end gets a report` |
| 6.29 | Long command output keeps its end; Stop and the time limit end the whole command | app | **D** | `Stop ends a running command at once, with everything it started` |
| 6.30 | A failed reply is kept in the chat with its reason | app | **D** | `a model error is saved in the chat as the reason the reply stopped` |
| 6.31 | Large chat imports (JSON, JSON Lines, Markdown) in many formats | app | **D** | `a large import (over the normal request limit) goes through` |
| 6.28 | Commands work in Windows PowerShell 5.1: && chains, a folder to run in, readable output | app | **D** | `run_command runs in a subfolder with cwd, and a silent failure says where its output went` |
| 6.24 | Helpers on the model suited to their work | app | **D** | `a helper can run on a different model: named outright, chosen for the job, or the chat model when one fails` |

---

## Score

**115 of 115** features are done and covered by a test.

| Status | Count |
|---|---|
| done | 115 |
| partial | 0 |
| missing | 0 |

### By area

| Area | done | partial | missing | total |
|---|---|---|---|---|
| Conversation | 25 | 0 | 0 | 25 |
| Providers | 22 | 0 | 0 | 22 |
| Artifacts | 10 | 0 | 0 | 10 |
| Structure | 8 | 0 | 0 | 8 |
| Shell | 15 | 0 | 0 | 15 |
| Automation | 31 | 0 | 0 | 31 |
| Settings | 4 | 0 | 0 | 4 |

### What this means

Bunny AI now covers the surfaces a desktop AI app is known for: the chat and
providers spine, artifacts beside the chat, branching, projects, memory, MCP tools,
schedules, hooks, skills, import, search, a command palette and four languages,
and an agent that makes artifacts, asks for what it lacks, runs helpers side by side,
works with GitHub, controls the desktop when allowed, and can undo its file changes.

This file is generated by `scripts/feature-tally.mjs` from `docs/features.js`;
`test/tally.test.js` fails when the committed file is stale.
