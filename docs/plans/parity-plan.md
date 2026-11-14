# Bunny AI — Complete Feature Parity Implementation Plan

**Date:** 2026-11-15  
**Goal:** Implement everything from the private UI map, including previously "out of scope" / "Skip" items: computer use, plugins/marketplaces, integrated browser, folder/project workspace, rendered artifacts, side panes (diff, file, terminal, tasks), permission modes, effort/reasoning, ability labels, fallback chains.

**Source of truth:** the private UI map + the private feature inventory  
**Constraint:** Learn from the reference app, write our own code (no copying the reference app's code/strings/assets).

---

## Phase 1 — REA Analysis (understand the reference app's real implementation)

Analyze reference-app chunks for:
- Computer use (c10f0af0c-CBU3MLHE.js, c21f11e6d-_VkS4386.js)
- Plugins/marketplace (c08f249ae-EUQXT7E5.js, c00d06c82-BoUtxcQo.js)
- Terminal pane (c03935b01-BVzCRPnI.js)
- Diff pane (c00d06c82-BoUtxcQo.js)
- Side pane shell (c21f11e6d-_VkS4386.js)
- Artifact rendering (4bcade453...-Dicv6Oqg.js, c033ab825-zQNaGB3-.js)
- Folder/worktree (c0243d234-mxgJI_WH.js, c0273df7e-BcRoghdw.js)

---

## Phase 2 — Server-side APIs (new endpoints)

New API surface needed:
- `/api/computer/*` — computer use (screenshot, click, type, key, wait, reset)
- `/api/skills/*` — plugin/skill management (install, enable, marketplace, details)
- `/api/terminal/*` — terminal sessions (create, write, read, resize)
- `/api/diff/*` — diff computation between file states
- `/api/sessions/:id/folder` — set/get working folder for a session
- `/api/sessions/:id/branch` — set/get branch for a session
- `/api/sessions/:id/permission-mode` — permission mode per session
- `/api/sessions/:id/effort` — effort/reasoning level per session
- `/api/abilities` — ability labels per model (coding, reasoning, vision, etc.)

Extended existing:
- `/api/sessions` — add `folder`, `branch`, `permissionMode`, `effort`, `parentId` (linked sessions/tree)
- `/api/artifacts` — render HTML in sandboxed iframe, support more kinds
- `/api/providers` — add `abilityGroups` per model

---

## Phase 3 — UI/UX Shell Rewrite (index.html + app.css + chat.js)

New window layout per navigation map §1:
- Title bar / mode switch: Chat | Cowork | Code (Code only for v1, slot for others)
- Sidebar: sessions tree (linked children), projects, search, new session in folder
- Main transcript: streaming + tool-call blocks + permission prompts + task list + next-step box
- Side pane (tabbed): Diff | File | Terminal | Tasks | Plan | PR | Browser | Artifacts
- Composer: multi-line input, slash commands, @ mentions, attach, model picker (ability groups first), effort, permission mode, folder+branch chip
- Split view: two sessions side by side

---

## Phase 4 — Feature Implementation (in dependency order)

1. Folder/project workspace for sessions
2. Permission modes (ask/accept/plan/auto)
3. Effort/reasoning level per model
4. Ability labels on models
5. Fallback chain (within ability group, across providers, mid-turn)
6. Tool-call blocks in transcript (collapsible, with result)
7. Permission prompts inline (approve/deny)
8. Task list under latest message
9. Next-step box
10. Computer use (screenshot, click, type, key, wait, reset)
11. Plugins/skills marketplace
12. Integrated browser pane
13. Terminal pane
14. Diff pane
15. Rendered artifacts (HTML in sandbox)
16. Split view
17. Linked session tree (parent › child breadcrumb)

---

## Phase 5 — Tally & Tests

- Register all new features in `docs/features.js`
- Add Playwright tests for each new UI feature
- Run gate: unit + browser + visual screenshots

---

## Status: Phase 1 in progress
