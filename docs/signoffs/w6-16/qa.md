---
piece: w6-16
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Candidate head 591bf83 (holds 81fddb6, 54dee4b). e2e/w019-w616.mjs 20/20, desktop-style app (only picked folders, window-only writes), invented folders, scripted model, an invented local MCP connector, the real Customize page. Limits: a plain token request is refused (403); a folder never picked is refused with 'folder picker' wording; picked folders are accepted for a skill and a connector and stored as real paths. Reach: the skill's words are in a chat in A and in a subfolder of A, NOT in B, NOT in A2 (a name that only starts like A), NOT in a chat with no folder; read_skill from B answers 'There is no skill called ...' (does not reveal it), from A returns it; the connector tool is offered in A only, a call by name from B and a call through call_connector_tool from B never reach the connector, from A it does. Customize (light, dark, phone): rows say 'Only in: projA' for the skill and the connector, label 5.75:1 light / 6.38:1 dark, no overflow, no page error. Taking the limit off (empty list) works with no folder check. Not walked: a limited PLUGIN's parts and the helper-gets-only-scoped-skills rule (Builder's tests).
