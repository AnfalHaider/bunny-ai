---
piece: w4-14
role: security
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

leave_plan_mode cannot escalate: the capability card is answered only through the window-only capability route (403 for any other caller, tested); granted moves the chat to Ask (never Auto), persists that choice and adds only the existing workspace and process tools, each still asking in Ask; refused unless the chat is in Plan mode with a usable folder; not offered to scheduled runs, and helpers never get request_capability; a reply that already ended gets no answer (card never reaches a window) so it times out as no. Prompt changes are text only; no new spawn path (the added tools are the existing ones). UI uses textContent. 59 tests pass. LOW, usability only: asksToRunCommands also matches a real decision such as 'Should I run the migration command now?' and hides that question for the first three; the fourth is shown.
